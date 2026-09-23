import asyncio
import logging
import json
import pathlib
import ssl
import aiohttp
from dotenv import load_dotenv
import os

# --- SSL BYPASS (CRITICAL FOR WINDOWS DEV) ---
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

from livekit import rtc
from livekit.agents import (
    cli, JobContext, WorkerOptions, AutoSubscribe, JobProcess,
    llm, RoomInputOptions, metrics,
)
from livekit.agents import StopResponse
from livekit.agents.voice import Agent, AgentSession, UserInputTranscribedEvent, ConversationItemAddedEvent

# Local Imports
# pyrefly: ignore [missing-import]
from factory import create_agent, create_vad

# --- CONFIG ---
_AGENT_DIR = pathlib.Path(__file__).parent
_ROOT = _AGENT_DIR.parent
dotenv_path = _ROOT / ".env"
load_dotenv(dotenv_path if dotenv_path.exists() else None)

# --- LOGGING ---
# All the noisy per-track/per-turn "[HMS DEBUG]" messages are logged at
# DEBUG level (not INFO) so production runs quietly by default. Set
# AGENT_LOG_LEVEL=DEBUG in the environment to see them again when
# troubleshooting a specific call locally.
_LOG_LEVEL = os.getenv("AGENT_LOG_LEVEL", "INFO").upper()
log_formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

class SilenceWarningFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if "input speech hasn't started yet" in msg or "Input is shorter by" in msg:
            return False
        return True

silence_filter = SilenceWarningFilter()

file_handler = logging.FileHandler(_ROOT / "agent.log")
file_handler.setFormatter(log_formatter)
file_handler.addFilter(silence_filter)

console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
console_handler.addFilter(silence_filter)

logging.basicConfig(level=_LOG_LEVEL, handlers=[file_handler, console_handler])
logger = logging.getLogger("voice-forge-agent")
logger.setLevel(_LOG_LEVEL)

# API endpoint for transcript logging
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")
INTERNAL_BACKEND_URL = os.getenv("INTERNAL_BACKEND_URL", "http://localhost:8000")

async def log_transcript(session_id: str, role: str, content: str):
    """Sends transcript to the backend API."""
    url = f"{INTERNAL_BACKEND_URL}/api/v1/calls/sessions/{session_id}/transcripts"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json={"role": role, "content": content}) as resp:
                if resp.status != 200:
                    logger.warning(f"Failed to log transcript: {resp.status}")
    except Exception as e:
        logger.warning(f"Error logging transcript: {e}")


async def report_call_metrics(session_id: str, payload: dict):
    """
    Sends the real per-call STT/LLM/TTS/EOU metrics summary to the backend
    (see PUT /calls/sessions/{session_id}/metrics). This is what replaces
    the previously hardcoded "412ms" neuralLatency mock on the dashboard
    with actual measured numbers. Best-effort: a failure here should never
    affect the call itself, since it only runs after the call has ended.
    """
    url = f"{INTERNAL_BACKEND_URL}/api/v1/calls/sessions/{session_id}/metrics"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.put(url, json=payload) as resp:
                if resp.status != 200:
                    logger.warning(f"Failed to report call metrics: {resp.status}")
    except Exception as e:
        logger.warning(f"Error reporting call metrics: {e}")


def _resolve_farewell_keywords(termination_keywords) -> list[str]:
    """
    Single source of truth for farewell/termination phrase resolution.

    Both the user-turn interrupt path (VoiceForgeAgent.on_user_turn_completed)
    and the agent-speech fallback path (_on_conversation_item in entrypoint)
    need the exact same keyword list — this used to be copy-pasted in two
    places and had already drifted (the agent-speech fallback included
    "thank you"/"thanks"/"thank u", the user-turn path didn't). Keeping one
    function means both paths always agree on what counts as a farewell.
    """
    if isinstance(termination_keywords, str) and termination_keywords.strip():
        return [k.strip().lower() for k in termination_keywords.split(",") if k.strip()]
    if isinstance(termination_keywords, list):
        return [str(k).strip().lower() for k in termination_keywords if str(k).strip()]
    return [
        "bye", "goodbye", "thank you", "thank u", "thanks", "take care",
        "have a great", "have a nice", "see you",
        "dhanyawad", "shukriya", "alvida", "phir milenge",
    ]


def _contains_farewell(text: str, farewells: list[str]) -> bool:
    text_lower = text.lower()
    return any(keyword in text_lower for keyword in farewells)


def prewarm(proc: JobProcess):
    """
    Preloads the Silero VAD model into process memory.

    FIX: Use silero.VAD.load() consistently so the prewarmed instance type
    matches what create_vad() expects and passes to AgentSession.
    """
    logger.info("Prewarming Agent Process: Loading VAD model...")
    from livekit.plugins import silero
    proc.userdata["vad"] = silero.VAD.load(
        min_speech_duration=0.3,
        min_silence_duration=0.8,
        activation_threshold=0.5,
    )


class VoiceForgeAgent(Agent):
    def __init__(self, *args, termination_keywords="", on_farewell_detected=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_farewell_detected = on_farewell_detected
        self.termination_keywords = termination_keywords

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        transcript = new_message.text_content.strip()
        # Filter out anything that contains no alphanumeric characters (to handle empty/noise turns)
        clean_transcript = "".join(c for c in transcript if c.isalnum())
        if not clean_transcript:
            logger.debug("[HMS DEBUG] Ignoring empty/silent user turn to prevent preemptive tool execution.")
            raise StopResponse()

        # Check if the user said farewell or thanks
        logger.debug(f"[HMS DEBUG] user_turn_completed transcript='{transcript.lower()}', configured termination_keywords='{self.termination_keywords}'")

        farewells = _resolve_farewell_keywords(self.termination_keywords)
        if _contains_farewell(transcript, farewells):
            logger.info(f"User farewell detected: '{transcript.lower()}'. Invoking farewell handler callback.")
            if self.on_farewell_detected:
                self.on_farewell_detected()
            raise StopResponse()

        await super().on_user_turn_completed(turn_ctx, new_message)


async def entrypoint(ctx: JobContext):
    """Main entry point for the HMS Voice Agent."""
    logger.info(f"--- [START] Job {ctx.job.id} for room {ctx.room.name} ---")

    # Set when the first remote audio track is actually flowing/subscribed —
    # used below to time the greeting off a real media signal instead of a
    # blind fixed sleep (see PRIORITY comment near session.say()).
    audio_ready_event = asyncio.Event()

    # Set up room event listeners for robust manual track subscription
    @ctx.room.on("track_published")
    def on_track_published(publication: rtc.TrackPublication, participant: rtc.RemoteParticipant):
        if publication.kind == rtc.TrackKind.KIND_AUDIO:
            logger.debug(f"[HMS DEBUG] Track published: {publication.sid} by {participant.identity}. Subscribing manually...")
            publication.set_subscribed(True)

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(track: rtc.Track, publication: rtc.TrackPublication, participant: rtc.RemoteParticipant):
        logger.debug(f"[HMS DEBUG] Track subscribed: {publication.sid} ({track.kind}) by {participant.identity}")
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            audio_ready_event.set()

    await ctx.connect(auto_subscribe=AutoSubscribe.SUBSCRIBE_ALL)

    # Wait for at least one participant to be present
    if not ctx.room.remote_participants:
        logger.info("Waiting for participant to join...")
        try:
            await ctx.wait_for_participant()
        except RuntimeError as e:
            logger.warning(f"Stop waiting: {e}")
            return

    # Ensure remote participant's audio tracks are subscribed manually as a fallback
    for p_id, p in ctx.room.remote_participants.items():
        logger.debug(f"[HMS DEBUG] Checking existing participant: {p.identity}")
        for pub_id, pub in p.track_publications.items():
            if pub.kind == rtc.TrackKind.KIND_AUDIO:
                logger.debug(f"[HMS DEBUG] Found audio track: {pub.sid}. Subscribed={pub.subscribed}")
                if not pub.subscribed:
                    logger.debug(f"[HMS DEBUG] Manually subscribing to track: {pub.sid}")
                    pub.set_subscribed(True)
                else:
                    # Track already subscribed before our listener attached —
                    # the "track_subscribed" event won't fire again for it,
                    # so signal readiness here instead.
                    audio_ready_event.set()

    # ── CONFIG RESOLUTION (Priority: dispatch metadata > dynamic SIP lookup > defaults) ──
    config = {}

    # PRIORITY 1: Job metadata from dispatch rule (set during trunk provisioning or outbound call)
    if ctx.job.metadata:
        try:
            config = json.loads(ctx.job.metadata)
            logger.info(f"--- [HMS CONFIG] Loaded config from dispatch metadata: agent={config.get('agentName', 'N/A')}, lang={config.get('language', 'N/A')} ---")
        except Exception as e:
            logger.warning(f"Failed to parse job metadata: {e}")

    # PRIORITY 2: Dynamic SIP routing fallback (when dispatch metadata is empty/missing)
    if not config:
        participant = next(iter(ctx.room.remote_participants.values()), None)
        dialed_number = None
        caller_number = None
        agent_id = None
        room_name = ctx.room.name

        if participant:
            dialed_number = participant.attributes.get("sip.trunkPhoneNumber")
            caller_number = participant.attributes.get("sip.phoneNumber")
            agent_id = participant.attributes.get("sip.agentId")
            room_name = participant.attributes.get("sip.roomName") or ctx.room.name

        if dialed_number:
            logger.info(f"--- [HMS CONFIG] Dynamic SIP call detected on: {dialed_number} from {caller_number} (Agent={agent_id}, Room={room_name}). Resolving agent config... ---")
            try:
                url = f"{INTERNAL_BACKEND_URL}/api/v1/numbers/inbound-config?number={dialed_number}&caller_number={caller_number or ''}&room_name={room_name}&agent_id={agent_id or ''}"
                async with aiohttp.ClientSession() as session:
                    async with session.get(url) as resp:
                        if resp.status == 200:
                            config = await resp.json()
                            logger.info(f"--- [HMS CONFIG] Dynamic config loaded successfully: agent={config.get('agentName', 'N/A')} ---")
                        else:
                            logger.warning(f"Backend inbound-config returned non-200 status: {resp.status}")
            except Exception as e:
                logger.error(f"Error fetching dynamic inbound-config from backend: {e}")

    # ── PRIORITY 3: Always refresh from the backend using whatever agent_id
    # we now have (from static dispatch metadata OR the dynamic SIP lookup
    # above). This is the fix for tools going stale: dispatch-rule metadata
    # is baked in once at trunk-provisioning time and never updated again,
    # so a Twilio-fallback outbound call (which relies on the *inbound*
    # dispatch rule's static metadata) could carry a tools list from months
    # ago even though the agent's tools were edited since. Re-fetching by
    # agent_id here guarantees inbound, native-SIP outbound, and
    # Twilio-fallback outbound calls all see the agent's CURRENT tools.
    # If the refresh fails (network blip, backend restart), we keep
    # whatever config we already resolved above rather than failing the call.
    resolved_agent_id = config.get("id") or config.get("agentId")
    if resolved_agent_id:
        try:
            url = f"{INTERNAL_BACKEND_URL}/api/v1/agents/{resolved_agent_id}/live-config"
            async with aiohttp.ClientSession() as session:
                async with session.get(url) as resp:
                    if resp.status == 200:
                        fresh_config = await resp.json()
                        logger.info(
                            f"--- [HMS CONFIG] Refreshed live config for agent_id={resolved_agent_id}: "
                            f"{len(fresh_config.get('tools', []))} tool(s) ---"
                        )
                        config = fresh_config
                    else:
                        logger.warning(
                            f"--- [HMS CONFIG] live-config refresh returned {resp.status} for "
                            f"agent_id={resolved_agent_id}; keeping previously resolved config ---"
                        )
        except Exception as e:
            logger.error(
                f"--- [HMS CONFIG] live-config refresh failed for agent_id={resolved_agent_id}: {e} "
                f"— keeping previously resolved config ---"
            )

    # ── BUILD COMPONENTS ──────────────────────────────────────────────────────
    prewarmed_vad = ctx.proc.userdata.get("vad")
    vad = create_vad(config, prewarmed_vad)

    from factory import _build_stt, _build_llm, _build_tts, _build_tools, _build_instructions

    stt_component = _build_stt(config)
    llm_component = _build_llm(config)
    tts_component = _build_tts(config, config.get("language") or "en")

    # _build_tools() already isolates failures per-tool, but we keep this
    # outer guard too: if something upstream of that (e.g. a totally
    # malformed `tools` list) still raises, we'd rather join the call with
    # zero tools than crash the job before the agent ever connects — which
    # from the caller's side looks like "stuck at connecting" forever with
    # no diagnostic.
    try:
        tools = _build_tools(config)
    except Exception as exc:
        logger.error(f"--- [TOOLS] _build_tools() failed entirely, continuing with no tools: {exc} ---")
        tools = []

    instructions  = _build_instructions(config, tools)

    def handle_farewell():
        async def disconnect_now():
            logger.info("--- [HMS SESSION TERMINATION] User farewell detected. Disconnecting session immediately. ---")
            await ctx.room.disconnect()
        asyncio.create_task(disconnect_now())

    termination_keywords = config.get("termination_keywords", "")
    agent = VoiceForgeAgent(
        instructions=instructions,
        tools=tools,
        stt=stt_component,
        llm=llm_component,
        tts=tts_component,
        termination_keywords=termination_keywords,
        on_farewell_detected=handle_farewell,
    )

    session = AgentSession(vad=vad)

    # --- Real latency/usage metrics ---
    # Replaces guesswork: LiveKit Agents emits a "metrics_collected" event
    # per STT/LLM/TTS/EOU/VAD operation with real measured numbers (time to
    # first token, time to first byte, end-of-utterance delay, token/char
    # counts). We log each one immediately for per-turn visibility in
    # agent.log, and also roll them into a UsageCollector so we can report
    # one real summary per call instead of a hardcoded dashboard value.
    usage_collector = metrics.UsageCollector()
    eou_delays: list[float] = []

    @session.on("metrics_collected")
    def _on_metrics_collected(event):
        metrics.log_metrics(event.metrics, logger=logger)
        usage_collector.collect(event.metrics)
        if isinstance(event.metrics, metrics.EOUMetrics):
            # end_of_utterance_delay is the closest real analogue to the
            # "Neural Latency" figure on the dashboard — the gap between the
            # user finishing speaking and the agent's reply starting.
            eou_delays.append(event.metrics.end_of_utterance_delay)
            logger.info(
                f"[METRICS] end_of_utterance_delay={event.metrics.end_of_utterance_delay:.3f}s "
                f"transcription_delay={event.metrics.transcription_delay:.3f}s"
            )

    # --- Event Callbacks ---
    @session.on("user_input_transcribed")
    def _on_user_speech(event: UserInputTranscribedEvent):
        if event.is_final:
            text = event.transcript or ""
            logger.info(f"User: {text}")
            asyncio.create_task(log_transcript(ctx.room.name, "user", text))

    @session.on("conversation_item_added")
    def _on_conversation_item(event: ConversationItemAddedEvent):
        item = event.item
        if isinstance(item, llm.ChatMessage) and item.role == "assistant":
            text = item.text_content or ""
            logger.info(f"Agent: {text}")
            asyncio.create_task(log_transcript(ctx.room.name, "agent", text))

            # Smart Session Auto-Termination: Check if the agent is bidding
            # farewell (fallback path). Uses the exact same keyword
            # resolution as VoiceForgeAgent.on_user_turn_completed so the
            # two paths can never silently disagree on what counts as a
            # farewell (see _resolve_farewell_keywords docstring).
            farewells = _resolve_farewell_keywords(config.get("termination_keywords", ""))

            if _contains_farewell(text, farewells):
                logger.info(f"[HMS FALLBACK SESSION TERMINATION] Farewell phrase detected in agent speech: '{text.lower()}'. Scheduling auto-disconnect.")
                async def disconnect_later():
                    # Allow 5 seconds for the TTS audio stream to play back fully to the user
                    await asyncio.sleep(5)
                    logger.info("[HMS FALLBACK SESSION TERMINATION] Disconnecting room session now.")
                    await ctx.room.disconnect()
                asyncio.create_task(disconnect_later())

    # --- Start Agent Session ---
    logger.info("Starting Agent Session...")
    await session.start(
        agent,
        room=ctx.room,
        room_input_options=RoomInputOptions(close_on_disconnect=False),
    )

    # Configurable greeting, timed off a REAL signal instead of a blind
    # fixed sleep. Previously this was `sip_delay = 7.5 if is_outbound else
    # 2.5` followed by an unconditional asyncio.sleep(sip_delay) — every
    # call paid the full delay even when the audio path was already up,
    # and a genuinely slow SIP answer could still exceed a short delay.
    # Now we wait for the audio_ready_event (set the moment a remote audio
    # track is subscribed — see entrypoint's track listeners above), with
    # the old fixed delay kept only as a safety-net upper bound.
    is_outbound = ctx.room.name.startswith("outbound_") or "outbound" in ctx.room.name.lower() or "twilio" in ctx.room.name.lower()
    max_wait = 7.5 if is_outbound else 2.5
    try:
        await asyncio.wait_for(audio_ready_event.wait(), timeout=max_wait)
        logger.info("Audio path confirmed active before greeting.")
    except asyncio.TimeoutError:
        logger.warning(f"No audio-ready signal observed within {max_wait}s; proceeding with greeting anyway.")

    # Use configurable first_message/greeting from agent config or fallback
    greeting = config.get("first_message") or config.get("greeting")
    if not greeting:
        stt_lang = config.get("language") or "en"
        agent_name = config.get("agentName", "")
        if stt_lang == "hi-IN":
            greeting = f"Namaste! Main {agent_name} hu, aapki kese madad kr sakta hu?" if agent_name else "Namaste! Aapki kya madad kr sakta hu?"
        else:
            greeting = f"Hello! I'm {agent_name}, how can I help you today?" if agent_name else "Hello! How can I help you today?"

    logger.info(f"Agent session started. Sending greeting: {greeting[:100]}...")
    await session.say(greeting, allow_interruptions=True)

    # Keep alive while connected
    while ctx.room.connection_state == rtc.ConnectionState.CONN_CONNECTED:
        await asyncio.sleep(1)

    # Report one real usage/latency summary per call to the backend (see
    # PUT /calls/sessions/{session_id}/metrics), replacing the old mocked
    # "412ms" dashboard figure with actual measured totals.
    summary = usage_collector.get_summary()
    avg_latency_ms = (sum(eou_delays) / len(eou_delays) * 1000) if eou_delays else None
    logger.info(
        f"[METRICS] Call summary room={ctx.room.name} "
        f"avg_response_latency_ms={avg_latency_ms} "
        f"llm_prompt_tokens={summary.llm_prompt_tokens} "
        f"llm_completion_tokens={summary.llm_completion_tokens} "
        f"tts_characters={summary.tts_characters_count} "
        f"stt_audio_duration={summary.stt_audio_duration:.1f}s"
    )
    await report_call_metrics(ctx.room.name, {
        "avg_response_latency_ms": round(avg_latency_ms, 1) if avg_latency_ms is not None else None,
        "eou_sample_count": len(eou_delays),
        "llm_prompt_tokens": summary.llm_prompt_tokens,
        "llm_completion_tokens": summary.llm_completion_tokens,
        "tts_characters_count": summary.tts_characters_count,
        "stt_audio_duration_seconds": summary.stt_audio_duration,
    })


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="voice-forge-agent-v5",
        )
    )