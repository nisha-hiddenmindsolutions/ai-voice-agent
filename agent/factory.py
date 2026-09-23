"""
agent/factory.py — LiveKit Agents 1.6.x

Creates a configured livekit.agents.Agent from the JSON metadata blob
dispatched by the backend. The worker entrypoint should do:

    from factory import create_agent, create_vad

    async def entrypoint(ctx: JobContext):
        config = json.loads(ctx.job.metadata)
        agent  = create_agent(config)
        session = AgentSession(vad=create_vad(config))
        await session.start(ctx.room, agent=agent)
        await session.generate_reply()        # speaks first_message if set

NOTE ON API KEYS:
LLM / STT / TTS provider API keys are always BYOK (bring-your-own-key),
configured by the user through the frontend UI and resolved server-side
in `agent_metadata_service.py` before being placed on the dispatch
metadata blob (`config["llm"]["apiKey"]`, `config["stt"]["apiKey"]`,
`config["tts"]["apiKey"]`). This factory intentionally does NOT fall back
to any `os.getenv(...)` value for these keys — if a key is missing from
the config, provider init fails loudly instead of silently picking up a
key from the worker process's environment.
"""

import logging
import datetime
from typing import Any, Dict, List, Optional

from livekit.agents import (
    Agent,
    NOT_GIVEN,
    NotGivenOr,
    APIConnectOptions,
    DEFAULT_API_CONNECT_OPTIONS,
)
from livekit.agents import llm, stt as agents_stt, tts as agents_tts, vad as agents_vad
from livekit.plugins import groq, openai, deepgram, silero

# `agent/` (this file's own directory) is the directory main.py lives in and
# is what ends up on sys.path when the worker is launched as `python
# agent/main.py`, so `tools` resolves as a top-level package here — not a
# relative import (this module has no package context to be relative from).
from tools import build_tools, build_tools_section

try:
    from livekit.plugins import sarvam
except ImportError:
    sarvam = None  # type: ignore

try:
    from livekit.plugins import elevenlabs
except ImportError:
    elevenlabs = None  # type: ignore

try:
    from livekit.plugins import cartesia
except ImportError:
    cartesia = None  # type: ignore

logger = logging.getLogger("agent-factory")


# ---------------------------------------------------------------------------
# BYOK key enforcement
# ---------------------------------------------------------------------------
class MissingAPIKeyError(RuntimeError):
    """Raised when a provider is selected but no BYOK key was supplied."""


def _require_key(api_key: Optional[str], provider: str, kind: str) -> str:
    """
    Ensures a provider API key was actually supplied via the config blob
    (i.e. set by the user in the frontend UI). We deliberately never fall
    back to process environment variables for these — BYOK only.
    """
    if not api_key or not api_key.strip():
        raise MissingAPIKeyError(
            f"No {kind.upper()} API key configured for provider '{provider}'. "
            f"Add one in the frontend under Settings → API Keys."
        )
    return api_key.strip()


# ---------------------------------------------------------------------------
# Sarvam language normalisation
# ---------------------------------------------------------------------------
SARVAM_SUPPORTED_LANGS = {
    "en-IN", "hi-IN", "bn-IN", "ta-IN", "te-IN",
    "gu-IN", "kn-IN", "ml-IN", "mr-IN", "pa-IN", "od-IN",
}

_SARVAM_BASE_MAP: Dict[str, str] = {
    "en": "en-IN", "hi": "hi-IN", "bn": "bn-IN",
    "ta": "ta-IN", "te": "te-IN", "gu": "gu-IN",
    "kn": "kn-IN", "ml": "ml-IN", "mr": "mr-IN",
    "pa": "pa-IN", "od": "od-IN", "or": "od-IN",
}


def normalize_sarvam_lang(lang: str) -> str:
    """Normalise any language tag to a Sarvam-supported BCP-47 code."""
    if not lang:
        return "en-IN"
    lang = lang.strip()
    if lang in SARVAM_SUPPORTED_LANGS:
        return lang
    if "-" in lang:
        base = lang.split("-")[0].lower()
        return _SARVAM_BASE_MAP.get(base, "en-IN")
    return _SARVAM_BASE_MAP.get(lang.lower(), "en-IN")


# ---------------------------------------------------------------------------
# OpenRouter LLM — intercepts tool_choice="none" to avoid 404s
# ---------------------------------------------------------------------------
class OpenRouterLLM(openai.LLM):
    def chat(
        self,
        *,
        chat_ctx: llm.ChatContext,
        tools: list[llm.Tool] | None = None,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
        parallel_tool_calls: NotGivenOr[bool] = NOT_GIVEN,
        tool_choice: NotGivenOr[llm.ToolChoice] = NOT_GIVEN,
        extra_kwargs: NotGivenOr[dict[str, Any]] = NOT_GIVEN,
    ) -> llm.LLMStream:
        # tool_choice="none" causes OpenRouter 404; clear tools instead
        if tool_choice == "none":
            logger.info("OpenRouterLLM: intercepting tool_choice='none', clearing tools.")
            tools = None
            tool_choice = NOT_GIVEN

        return super().chat(
            chat_ctx=chat_ctx,
            tools=tools,
            conn_options=conn_options,
            parallel_tool_calls=parallel_tool_calls,
            tool_choice=tool_choice,
            extra_kwargs=extra_kwargs,
        )


# ---------------------------------------------------------------------------
# VAD factory
# ---------------------------------------------------------------------------
def create_vad(config: Dict[str, Any], prewarmed_vad=None) -> agents_vad.VAD:
    """
    Returns a VAD instance.  Pass prewarmed_vad from proc.userdata when the
    settings are default so the expensive Silero load is skipped.
    """
    vad_cfg = config.get("vad", {})
    speech_dur  = vad_cfg.get("min_speech_duration",  0.3)
    silence_dur = vad_cfg.get("min_silence_duration", 0.8)
    threshold   = vad_cfg.get("activation_threshold", 0.5)

    defaults = (speech_dur == 0.3 and silence_dur == 0.8 and threshold == 0.5)
    if prewarmed_vad and defaults:
        logger.info("VAD: using prewarmed instance.")
        return prewarmed_vad

    logger.info(f"VAD: loading new instance ({speech_dur}/{silence_dur}/{threshold}).")
    return silero.VAD.load(
        min_speech_duration=speech_dur,
        min_silence_duration=silence_dur,
        activation_threshold=threshold,
    )


# ---------------------------------------------------------------------------
# Internal builders
# ---------------------------------------------------------------------------
def _build_stt(config: Dict[str, Any]) -> agents_stt.STT:
    lang     = config.get("language") or "en"
    provider = config.get("stt", {}).get("provider", "groq")
    api_key  = config.get("stt", {}).get("apiKey") or ""

    logger.info(f"[STT] provider={provider} lang={lang}")

    if provider == "sarvam" and sarvam is not None:
        key = _require_key(api_key, "sarvam", "stt")
        norm = normalize_sarvam_lang(lang)
        # FIX: previously hardcoded model="saaras:v3" regardless of what the
        # frontend sent — the STT Model dropdown in the UI had no effect for
        # Sarvam. Now honors config["stt"]["model"], falling back to the
        # only model Sarvam actually offers today.
        model = config.get("stt", {}).get("model") or "saaras:v3"
        return sarvam.STT(
            api_key=key,
            model=model,
            language=norm,
        )
    if provider == "deepgram":
        key = _require_key(api_key, "deepgram", "stt")
        # FIX: previously didn't pass `model` at all, so the plugin's own
        # default was always used no matter what the user picked in the UI
        # (nova-2, nova-3, etc. were all silently ignored).
        model = config.get("stt", {}).get("model") or "nova-2"
        return deepgram.STT(
            api_key=key,
            model=model,
            language=lang,
        )
    if provider == "cartesia" and cartesia is not None:
        key = _require_key(api_key, "cartesia", "stt")
        # ink-2 only supports English; ink-whisper covers everything else.
        model = config.get("stt", {}).get("model") or ("ink-2" if lang.startswith("en") else "ink-whisper")
        return cartesia.STT(
            api_key=key,
            model=model,
            language=lang,
        )
    if provider == "groq":
        key = _require_key(api_key, "groq", "stt")
        # FIX: previously hardcoded model="whisper-large-v3" regardless of
        # what the user selected (e.g. whisper-large-v3-turbo).
        model = config.get("stt", {}).get("model") or "whisper-large-v3"
        return groq.STT(
            api_key=key,
            model=model,
            language=lang,
        )

    raise MissingAPIKeyError(f"Unsupported or unavailable STT provider: '{provider}'")


def _build_llm(config: Dict[str, Any]) -> llm.LLM:
    provider    = config.get("llm", {}).get("provider", "groq")
    model       = config.get("llm", {}).get("model", "")
    temperature = config.get("llm", {}).get("temperature", 0.7)
    api_key     = config.get("llm", {}).get("apiKey") or ""

    logger.info(f"[LLM] provider={provider} model={model}")

    if provider == "cerebras":
        key = _require_key(api_key, "cerebras", "llm")
        return openai.LLM(
            api_key=key,
            base_url="https://api.cerebras.ai/v1",
            model=model or "llama-3.3-70b",
            temperature=temperature,
        )
    if provider == "openai":
        key = _require_key(api_key, "openai", "llm")
        return openai.LLM(
            api_key=key,
            model=model or "gpt-4o-mini",
            temperature=temperature,
        )
    if provider == "openrouter":
        key = _require_key(api_key, "openrouter", "llm")
        return OpenRouterLLM(
            api_key=key,
            base_url="https://openrouter.ai/api/v1",
            model=model or "meta-llama/llama-3.3-70b-instruct",
            temperature=temperature,
            extra_headers={
                "HTTP-Referer": "https://livekit.io",
                "X-Title": "LiveKit Voice Agent",
            },
        )
    if provider == "gemini":
        key = _require_key(api_key, "gemini", "llm")
        return openai.LLM(
            api_key=key,
            base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
            model=model or "gemini-2.5-flash",
            temperature=temperature,
        )
    if provider in ("together_ai", "together"):
        key = _require_key(api_key, "together_ai", "llm")
        return openai.LLM(
            api_key=key,
            base_url="https://api.together.xyz/v1",
            model=model or "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
            temperature=temperature,
        )
    if provider == "deepseek":
        key = _require_key(api_key, "deepseek", "llm")
        return openai.LLM(
            api_key=key,
            base_url="https://api.deepseek.com/v1",
            model=model or "deepseek-chat",
            temperature=temperature,
        )
    if provider == "anthropic":
        key = _require_key(api_key, "anthropic", "llm")
        from livekit.plugins import anthropic as anthropic_plugin
        return anthropic_plugin.LLM(
            api_key=key,
            model=model or "claude-3-5-sonnet-latest",
            caching="ephemeral",
        )
    if provider == "groq":
        key = _require_key(api_key, "groq", "llm")
        return groq.LLM(
            api_key=key,
            model=model or "llama-3.3-70b-versatile",
            temperature=temperature,
        )

    raise MissingAPIKeyError(f"Unsupported LLM provider: '{provider}'")


def _build_tts(config: Dict[str, Any], stt_lang: str) -> agents_tts.TTS:
    provider = config.get("tts", {}).get("provider", "sarvam")
    model    = config.get("tts", {}).get("model", "")
    voice    = config.get("tts", {}).get("voice", "")
    api_key  = config.get("tts", {}).get("apiKey") or ""

    logger.info(f"[TTS] provider={provider}")

    if provider == "openai":
        key = _require_key(api_key, "openai", "tts")
        return openai.TTS(
            api_key=key,
            model=model or "tts-1",
            voice=voice or "alloy",
        )
    if provider == "elevenlabs" and elevenlabs is not None:
        key = _require_key(api_key, "elevenlabs", "tts")
        return elevenlabs.TTS(
            api_key=key,
            model=model or "eleven_monolingual_v1",
            voice_id=voice or "21m00Tcm4TlvDq8ikWAM",
        )
    if provider == "cartesia" and cartesia is not None:
        key = _require_key(api_key, "cartesia", "tts")
        return cartesia.TTS(
            api_key=key,
            model=model or "sonic-2",
            voice=voice or "pf_rachel",
        )
    if provider == "sarvam":
        if sarvam is None:
            raise ImportError("livekit-plugins-sarvam not installed")
        key = _require_key(api_key, "sarvam", "tts")
        norm_lang = normalize_sarvam_lang(stt_lang)
        logger.info(f"[TTS] Sarvam lang: '{stt_lang}' → '{norm_lang}'")
        # FIX: previously hardcoded model="bulbul:v3" regardless of
        # config["tts"]["model"] — the TTS Model dropdown had no effect
        # for Sarvam. Now honors the configured value, falling back to the
        # only model Sarvam actually offers today.
        tts_model = model or "bulbul:v3"
        tts_instance = sarvam.TTS(
            api_key=key,
            target_language_code=norm_lang,
            speaker=voice or "shubh",
            model=tts_model,
        )
        # Patch stale WebSocket connection pool
        try:
            if hasattr(tts_instance, "_pool"):
                tts_instance._pool._max_session_duration = 45.0
                tts_instance._pool._mark_refreshed_on_get = True
        except Exception as patch_err:
            logger.warning(f"[TTS] Sarvam pool patch skipped: {patch_err}")
        return tts_instance

    raise MissingAPIKeyError(f"Unsupported or unavailable TTS provider: '{provider}'")


def _build_tools(config: Dict[str, Any]) -> list[llm.FunctionTool]:
    """
    Thin wrapper kept so callers (create_agent, agent/main.py) don't need to
    know this delegates to the `tools` package. All actual tool-building
    logic — CALENDAR/SHEETS/WEBHOOK dispatch, per-tool try/except isolation,
    and the rag_system tool — lives in agent/tools/registry.py now. See
    agent/tools/__init__.py for how to add a new native integration.
    """
    return build_tools(config)


# ---------------------------------------------------------------------------
# Instructions builder
# ---------------------------------------------------------------------------
def _build_instructions(config: Dict[str, Any], tools: list[llm.FunctionTool]) -> str:
    agent_name = config.get("agentName") or config.get("agent_name") or "VoiceForge"
    lang_code  = config.get("language") or "en"
    lang_name  = (
        "Hindi"   if lang_code.startswith("hi") else
        "Tamil"   if lang_code.startswith("ta") else
        "Telugu"  if lang_code.startswith("te") else
        "Bengali" if lang_code.startswith("bn") else
        "Kannada" if lang_code.startswith("kn") else
        "Malayalam" if lang_code.startswith("ml") else
        "Marathi" if lang_code.startswith("mr") else
        "Gujarati" if lang_code.startswith("gu") else
        "Punjabi" if lang_code.startswith("pa") else
        "English"
    )
    now = datetime.datetime.now().astimezone().strftime("%Y-%m-%dT%H:%M:%S%z")

    instructions = (
        f"Your name is {agent_name}. The current date and time is {now}.\n"
        f"{config.get('prompt', 'You are a helpful assistant.')}\n\n"
        f"CRITICAL: Always respond in {lang_name}. Do not switch languages unless explicitly asked."
    )

    # Tool-usage instructions (RAG + CALENDAR/SHEETS/other) are generated
    # from the *actual* built tools, so they always match the real tool
    # names (e.g. `{name}_schedule_event`, not a single flat `{name}`).
    # See agent/tools/instructions.py — keeping this in one place avoids
    # the prompt drifting out of sync with what agent/tools/registry.py
    # actually builds.
    instructions += build_tools_section(config, tools)

    return instructions


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def create_agent(config: Dict[str, Any]) -> Agent:
    """
    Build and return a fully configured livekit.agents.Agent from the
    dispatch metadata blob.

    Usage in your worker entrypoint:

        async def entrypoint(ctx: JobContext):
            config  = json.loads(ctx.job.metadata)
            agent   = create_agent(config)
            session = AgentSession(vad=create_vad(config, ctx.proc.userdata.get("vad")))
            await session.start(ctx.room, agent=agent)

            first_msg = config.get("first_message", "")
            if first_msg:
                await session.generate_reply(instructions=first_msg)
    """
    stt_lang = config.get("language") or "en"

    stt_component  = _build_stt(config)
    llm_component  = _build_llm(config)
    tts_component  = _build_tts(config, stt_lang)
    tools          = _build_tools(config)
    instructions   = _build_instructions(config, tools)

    logger.info(
        f"[Factory] Agent built — "
        f"stt={type(stt_component).__name__} "
        f"llm={type(llm_component).__name__} "
        f"tts={type(tts_component).__name__} "
        f"tools={len(tools)}"
    )

    return Agent(
        instructions=instructions,
        stt=stt_component,
        llm=llm_component,
        tts=tts_component,
        tools=tools,
    )