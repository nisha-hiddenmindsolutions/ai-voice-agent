import { useState, useEffect } from 'react';
import { useAgentStore } from '../store/useAgentStore';
import { 
  Brain, 
  Mic, 
  Volume2, 
  Info,
  Zap,
  Code,
  Activity,
  Sparkles,
  Command,
  Monitor
} from 'lucide-react';
import api, { agentApi, sessionApi, toolApi, numbersApi } from '../services/api';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { BackButton } from '../components/BackButton';
import { AgentAvatar } from '../components/AgentAvatar';
import { Select } from '../components/ui/Select';

const LLM_MODELS = {
  groq: [
    { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 (70B)' },
    { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 (8B)' },
    { id: 'mixtral-8x7b-32768', name: 'Mixtral (Reasoning)' }
  ],
  cerebras: [
    { id: 'llama-3.3-70b', name: 'Llama 3.3 (70B) - Cerebras Speed' },
    { id: 'llama3.1-8b', name: 'Llama 3.1 (8B) - Cerebras Speed' }
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o (Flagship)' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Legacy' }
  ],
  openrouter: [
    { id: 'openrouter/anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'openrouter/google/gemini-pro', name: 'Gemini Pro' },
    { id: 'openrouter/mistralai/mistral-medium', name: 'Mistral Medium' }
  ]
};

const TTS_VOICES = {
  sarvam: [
    { id: 'neha', name: 'Neha (Female - Crystal Clear Premium)' },
    { id: 'shreya', name: 'Shreya (Female - Customer Care Premium)' },
    { id: 'ritu', name: 'Ritu (Female - Customer Care)' },
    { id: 'shubh', name: 'Shubh (Male - Premium)' },
    { id: 'aditya', name: 'Aditya (Male - Storyteller)' }
  ],
  openai: [
    { id: 'alloy', name: 'Alloy (Neutral)' },
    { id: 'echo', name: 'Echo (Male - Deep)' },
    { id: 'shimmer', name: 'Shimmer (Female - High)' }
  ]
};

// Providers whose voice list is a fixed catalogue rather than something we
// fetch per-key (sarvam/openai voices don't come back from /providers/).
// Everything else (cartesia, elevenlabs) gets its voice list live from that
// provider's key via GET /providers/ (see dynamicModels below) — same
// pattern as AgentConfigurePage.tsx already uses.
const STATIC_VOICE_PROVIDERS = new Set(['sarvam', 'openai']);

// FIX: this file used to hardcode a single default `model` per STT/TTS
// provider (e.g. groq -> 'whisper-large-v3', cartesia -> 'sonic-2') and
// silently forced that value on every provider switch, with no dropdown for
// the user to see or change it. That meant e.g. Groq's whisper-large-v3-turbo
// or Cartesia's sonic-english were never selectable even though the backend
// (GET /providers/) actually returns them. Model selection for STT/TTS now
// works exactly like the LLM step: the model list is filtered out of
// `dynamicModels[provider]` by capability type (see getSttModelOptions /
// getTtsModelOptions below) and the first entry from that *live* list is
// used as the default when a provider is chosen — never a hardcoded string.

// Which of llm / stt / tts each provider can actually serve — mirrors what
// agent/factory.py on the backend knows how to build. A provider only shows
// up in a given dropdown if the user has connected it (i.e. saved a working
// API key on the Providers page) AND it supports that capability.
// FIX: the STT/TTS "Signal Provider" dropdowns below used to be hardcoded
// (['sarvam','deepgram'] / ['sarvam','openai']) regardless of whether the
// user had actually connected those providers with an API key. That let
// people pick a provider with no key on file, which then failed at call
// time. Now these lists are derived from GET /providers/, same as the LLM
// step already did.
const PROVIDER_CAPABILITIES: Record<string, Array<'llm' | 'stt' | 'tts'>> = {
  groq: ['llm', 'stt'],
  cerebras: ['llm'],
  openai: ['llm', 'tts'],
  openrouter: ['llm'],
  anthropic: ['llm'],
  gemini: ['llm'],
  deepseek: ['llm'],
  together_ai: ['llm'],
  sarvam: ['stt', 'tts'],
  deepgram: ['stt'],
  cartesia: ['stt', 'tts'],
  elevenlabs: ['tts'],
};

const BLUEPRINTS = [
  {
    name: "Real Estate Closer",
    icon: "🏘️",
    prompt: "You are a high-performing real estate closer. Your tone is professional, persuasive, and knowledgeable. Focus on lead qualification and property value points.",
    vad: { activation_threshold: 0.5, min_speech_duration: 0.3, min_silence_duration: 0.8 },
    llm: { provider: 'groq', model: 'llama-3.3-70b-versatile' }
  },
  {
    name: "Concierge AI",
    icon: "🤵",
    prompt: "You are an elegant concierge. You assist with scheduling, recommendations, and local knowledge. Your tone is refined, helpful, and sophisticated.",
    vad: { activation_threshold: 0.5, min_speech_duration: 0.3, min_silence_duration: 0.8 },
    llm: { provider: 'openai', model: 'gpt-4o-mini' }
  },
  {
    name: "Technical Support",
    icon: "⚙️",
    prompt: "You are a technical support engineer. You are patient, analytical, and structured. Use step-by-step reasoning to resolve issues.",
    vad: { activation_threshold: 0.5, min_speech_duration: 0.3, min_silence_duration: 0.8 },
    llm: { provider: 'groq', model: 'mixtral-8x7b-32768' }
  }
];

const PreviewStat = ({ label, value }: { label: string; value: string | number }) => (
  <div className="flex justify-between items-center py-2 border-b border-[var(--border)] last:border-none">
    <span className="text-xs text-[var(--text-secondary)] font-semibold uppercase tracking-wider">{label}</span>
    <span className="text-xs font-bold text-[var(--text-primary)] truncate max-w-[180px]">{value}</span>
  </div>
);

const CreateAgentPage = () => {
  const { editingAgent, setAgents, setActiveSession } = useAgentStore();
  const [step, setStep] = useState(1);
  const [wizardStage, setWizardStage] = useState<'select_path' | 'custom_name' | 'custom_goal' | 'configure'>(
    editingAgent ? 'configure' : 'select_path'
  );
  const [isLoading, setIsLoading] = useState(true);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  const [userNumbers, setUserNumbers] = useState<any[]>([]);
  const [selectedNumberId, setSelectedNumberId] = useState<string>('none');
  const navigate = useNavigate();

  // Dynamic Provider Model state variables
  const [dynamicModels, setDynamicModels] = useState<any>(LLM_MODELS);
  const [availableProviders, setAvailableProviders] = useState<string[]>(['groq', 'cerebras', 'openai', 'openrouter']);
  const [providerLabels, setProviderLabels] = useState<string[]>(['Groq Inference', 'Cerebras Speed', 'OpenAI Premium', 'OpenRouter Global']);
  // Populated from GET /providers/ — only providers the user has actually
  // connected (saved a valid API key for) show up here. Starts empty; the
  // "no provider connected" hint renders until this is populated.
  const [sttProviders, setSttProviders] = useState<string[]>([]);
  const [sttProviderLabels, setSttProviderLabels] = useState<string[]>([]);
  const [ttsProviders, setTtsProviders] = useState<string[]>([]);
  const [ttsProviderLabels, setTtsProviderLabels] = useState<string[]>([]);

  const [formData, setFormData] = useState<any>(editingAgent || {
    agentName: '',
    description: '',
    prompt: '',
    status: 'draft',
    language: 'hi-IN',
    stt: { provider: 'sarvam', model: 'saaras:v3', language: 'hi-IN' },
    llm: { provider: 'groq', model: 'llama-3.3-70b-versatile', temperature: 0.7 },
    tts: { provider: 'sarvam', model: 'bulbul:v3', voice: 'neha', pace: 1.0 },
    vad: { activation_threshold: 0.5, min_speech_duration: 0.3, min_silence_duration: 0.8, padding_duration: 0.1 },
    tools: []
  });

  useEffect(() => {
    if (editingAgent) setFormData(editingAgent);
    
    // Fetch dynamic provider models
    const fetchDynamicProviders = async () => {
      try {
        const res = await api.get('/providers/');
        const connections = res.data || [];

        const labelMapping: Record<string, string> = {
          groq: 'Groq Inference',
          cerebras: 'Cerebras Speed',
          openai: 'OpenAI Premium',
          openrouter: 'OpenRouter Global',
          anthropic: 'Anthropic Claude',
          gemini: 'Google Gemini',
          deepseek: 'DeepSeek AI',
          together_ai: 'Together AI',
          sarvam: 'Sarvam AI',
          deepgram: 'Deepgram Cloud',
          elevenlabs: 'ElevenLabs Voices',
          cartesia: 'Cartesia Sonic',
          assemblyai: 'AssemblyAI'
        };

        const mergedModels = { ...LLM_MODELS };
        const pList = ['groq', 'cerebras', 'openai', 'openrouter'];
        const pLabels = ['Groq Inference', 'Cerebras Speed', 'OpenAI Premium', 'OpenRouter Global'];
        const sttList: string[] = [];
        const sttLabels: string[] = [];
        const ttsList: string[] = [];
        const ttsLabels: string[] = [];

        connections.forEach((conn: any) => {
          // Only trust connections the backend reports as actually connected
          // — a saved-but-invalid key shouldn't be selectable either.
          if (conn.status && conn.status !== 'connected') return;

          const pName = conn.provider.toLowerCase();
          const label = labelMapping[pName] || conn.provider.toUpperCase();
          const caps = PROVIDER_CAPABILITIES[pName] || [];

          if (conn.models && conn.models.length > 0) {
            // FIX: capability `type` was previously dropped here, leaving
            // only {id, name}. A provider like Groq returns BOTH chat
            // models and Whisper STT models in one flat list, and Cartesia
            // returns voice identities alongside its STT/TTS model names —
            // without `type` surviving the mapping, there was no way to
            // tell these apart later, so e.g. Groq's whisper models could
            // leak into the LLM "Core Inference Model" dropdown. Keep
            // `type` (from the backend's `capabilities.type`, defaulting to
            // 'llm' when absent) so downstream filtering by capability is
            // accurate for every provider.
            const parsed = conn.models.map((m: any) => ({
              id: m.model_id,
              name: m.name || m.model_id,
              type: m.capabilities?.type || 'llm'
            }));

            // FIX: this used to push *any* connected provider with a
            // non-empty models list into the LLM dropdown, even ones that
            // only support STT/TTS (e.g. connecting Cartesia — which
            // returns voice entries here — was making "Cartesia" show up
            // as a selectable Intelligence Provider). Only add it to the
            // LLM list if it actually has that capability.
            if (caps.includes('llm') && !pList.includes(pName)) {
              pList.push(pName);
              pLabels.push(label);
            }
            // Merge/Override models lists — used for LLM models AND as the
            // live per-account voice catalogue for non-static TTS providers.
            (mergedModels as any)[pName] = parsed;
          }

          // FIX: previously STT/TTS providers were a hardcoded list here,
          // so an agent could be configured with a provider that had no API
          // key on file. Now: only a connected provider whose capabilities
          // include stt/tts shows up in that dropdown.
          if (caps.includes('stt') && !sttList.includes(pName)) {
            sttList.push(pName);
            sttLabels.push(label);
          }
          if (caps.includes('tts') && !ttsList.includes(pName)) {
            ttsList.push(pName);
            ttsLabels.push(label);
          }
        });

        setDynamicModels(mergedModels);
        setAvailableProviders(pList);
        setProviderLabels(pLabels);
        setSttProviders(sttList);
        setSttProviderLabels(sttLabels);
        setTtsProviders(ttsList);
        setTtsProviderLabels(ttsLabels);

        // If the form's current STT/TTS provider isn't actually connected
        // (e.g. it's still sitting on the 'sarvam' default), snap it to the
        // first connected option so the wizard never proposes launching an
        // agent with an unconnected provider.
        setFormData((prev: any) => {
          let next = prev;
          if (sttList.length > 0 && !sttList.includes(prev.stt.provider)) {
            const p = sttList[0];
            // FIX: model defaults to the first model the provider's own API
            // actually returned for STT (mergedModels[p], type==='stt'),
            // never a hardcoded string.
            const sttModels = ((mergedModels as any)[p] || []).filter((m: any) => m.type === 'stt');
            next = { ...next, stt: { ...next.stt, provider: p, model: sttModels[0]?.id || '' } };
          }
          if (ttsList.length > 0 && !ttsList.includes(prev.tts.provider)) {
            const p = ttsList[0];
            const voiceList = STATIC_VOICE_PROVIDERS.has(p)
              ? (TTS_VOICES[p as keyof typeof TTS_VOICES] || [])
              : ((mergedModels as any)[p] || []).filter((m: any) => m.type === 'voice');
            const ttsModels = ((mergedModels as any)[p] || []).filter((m: any) => m.type === 'tts');
            next = { ...next, tts: { ...next.tts, provider: p, model: ttsModels[0]?.id || '', voice: voiceList[0]?.id || next.tts.voice } };
          }
          return next;
        });
      } catch (err) {
        console.error("Failed to load dynamic provider configurations", err);
        setSttProviders([]);
        setSttProviderLabels([]);
        setTtsProviders([]);
        setTtsProviderLabels([]);
      }
    };

    const loadData = async () => {
      try {
        const [toolsRes, numRes] = await Promise.all([
          toolApi.list(),
          numbersApi.list()
        ]);
        setAvailableTools(toolsRes.data || []);
        
        const activeNumbers = numRes.data || [];
        setUserNumbers(activeNumbers);
        
        if (editingAgent) {
          const bound = activeNumbers.find((n: any) => n.agent_id === editingAgent.id);
          if (bound) setSelectedNumberId(bound.id);
        }
        await fetchDynamicProviders();
      } catch (err) {
        console.error('Failed initialization', err);
        toast.error('Failed to index tool registers');
      } finally {
        setTimeout(() => setIsLoading(false), 300);
      }
    };
    loadData();
  }, [editingAgent]);

  const applyBlueprint = (bp: typeof BLUEPRINTS[0]) => {
    setFormData({
      ...formData,
      prompt: bp.prompt,
      vad: { ...formData.vad, ...bp.vad },
      llm: { ...formData.llm, ...bp.llm }
    });
    toast.success(`${bp.name} blueprint configured successfully!`, { icon: '🎯' });
    setWizardStage('custom_name');
  };

  const handleSave = async (launchImmediate = false) => {
    if (!formData.agentName.trim()) return toast.error("Assistant name required");
    
    const actionText = editingAgent ? 'Modifying Assistant...' : 'Provisioning Assistant...';
    const processToast = toast.loading(actionText);

    try {
      let savedAgent;
      if (editingAgent) {
        const resp = await agentApi.createOrUpdate({ ...formData, id: editingAgent.id });
        savedAgent = resp.data;
      } else {
        const resp = await agentApi.createOrUpdate(formData);
        savedAgent = resp.data;
      }

      // Check number assignment state
      if (selectedNumberId !== 'none') {
        await numbersApi.update(selectedNumberId, { agent_id: savedAgent.id });
      } else if (editingAgent) {
        // If it was editing, let's see if we should detach
        const bound = userNumbers.find((n: any) => n.agent_id === editingAgent.id);
        if (bound) {
          await numbersApi.update(bound.id, { agent_id: null });
        }
      }

      // Re-fetch agents list in state
      const resList = await agentApi.list();
      setAgents(resList.data);

      if (launchImmediate) {
        toast.loading('Starting real-time Voice Gateway...', { id: processToast });
        const startPayload = {
          agent_id: savedAgent.id,
          prompt: savedAgent.prompt,
          language: savedAgent.language,
          stt: savedAgent.stt,
          llm: savedAgent.llm,
          tts: savedAgent.tts,
          vad: savedAgent.vad || { provider: 'silero' },
          tools: savedAgent.tools,
        };
        const sessionRes = await sessionApi.start(startPayload);
        setActiveSession({ ...sessionRes.data, agentName: savedAgent.agentName });
        toast.success('Voice Agent Live', { id: processToast });
      } else {
        toast.success('Assistant Saved successfully', { id: processToast });
        navigate('/agents');
      }
    } catch (err) {
      console.error('Save failed:', err);
      toast.error('Failed to save assistant', { id: processToast });
    }
  };

  const renderStepIndicator = () => (
    <div className="max-w-3xl mx-auto mb-10 flex items-center justify-between relative px-4 z-10">
      {/* Background connecting track line */}
      <div className="absolute top-[18px] left-8 right-8 h-[2px] bg-[var(--border)] -z-10" />
      
      {/* Active connecting track line */}
      <div 
        className="absolute top-[18px] left-8 h-[2px] bg-[var(--accent)] -z-10 transition-all duration-300" 
        style={{ width: `${((step - 1) / 3) * 88}%` }}
      />

      {[
        { id: 1, label: 'Identity', icon: <Brain size={13} /> },
        { id: 2, label: 'Voice Profile', icon: <Mic size={13} /> },
        { id: 3, label: 'Custom Actions', icon: <Command size={13} /> },
        { id: 4, label: 'Audio Engine', icon: <Activity size={13} /> }
      ].map((s) => {
        const isCurrent = step === s.id;
        const isCompleted = step > s.id;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              if (s.id === 1 || formData.agentName.trim()) {
                setStep(s.id);
              } else {
                toast.error("Assistant name required to navigate");
              }
            }}
            className="flex flex-col items-center gap-2.5 outline-none cursor-pointer"
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-300 font-mono text-xs font-bold ${
              isCurrent 
                ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-[0_0_12px_rgba(197,168,128,0.25)] scale-105' 
                : isCompleted
                  ? 'bg-[var(--primary)] text-[var(--on-primary)] border-[var(--primary)]'
                  : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]'
            }`}>
              {isCompleted ? '✓' : s.id}
            </div>
            <span className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
              isCurrent ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}>
              {s.label}
            </span>
          </button>
        );
      })}
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] space-y-4 animate-in fade-in duration-200">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
        <span className="text-[10px] font-mono text-[var(--text-muted)] tracking-wider">Preparing assistant workspace...</span>
      </div>
    );
  }

  const currentProvider = (formData.llm?.provider || 'groq') as keyof typeof LLM_MODELS;
  // FIX: dynamicModels[provider] can contain a mix of capability types (a
  // connected Groq key returns chat models AND Whisper STT models in one
  // list). Filter to type==='llm' so the Core Inference Model dropdown
  // never offers an STT/TTS model as an LLM choice.
  const currentModels = (dynamicModels[currentProvider] || LLM_MODELS.groq).filter(
    (m: any) => !m.type || m.type === 'llm'
  );

  // STT model options for the selected STT provider — pulled live from
  // whatever GET /providers/ returned for that provider's key (filtered to
  // type==='stt'), never a hardcoded per-provider string.
  const getSttModelOptions = (provider: string) => {
    if (!sttProviders.includes(provider)) return [];
    return (dynamicModels[provider] || []).filter((m: any) => m.type === 'stt');
  };

  // TTS model options for the selected TTS provider — same idea, filtered
  // to type==='tts' (kept separate from the voice *identity* list below).
  const getTtsModelOptions = (provider: string) => {
    if (!ttsProviders.includes(provider)) return [];
    return (dynamicModels[provider] || []).filter((m: any) => m.type === 'tts');
  };

  // Voice options for the selected TTS provider: sarvam/openai use a fixed
  // named-voice catalogue (neither provider exposes a "list voices" API for
  // these); cartesia/elevenlabs use the voice list actually fetched from
  // that provider's key (dynamicModels, type==='voice'). If the provider
  // isn't actually connected, this returns [] — the panel shows an empty
  // state instead of a stale/unrelated voice list.
  const getTtsVoiceOptions = (provider: string) => {
    if (!ttsProviders.includes(provider)) return [];
    if (STATIC_VOICE_PROVIDERS.has(provider)) {
      return TTS_VOICES[provider as keyof typeof TTS_VOICES] || [];
    }
    return (dynamicModels[provider] || []).filter((m: any) => m.type === 'voice');
  };

  if (wizardStage === 'select_path') {
    return (
      <div className="max-w-3xl mx-auto mt-6 animate-in fade-in duration-500">
        <div className="card shadow-xl p-0 overflow-hidden border border-[var(--border)] bg-[var(--card-bg)] flex flex-col">
          {/* Header Bar */}
          <div className="px-8 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-secondary)]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Step 1 of 3 &bull; Path Selection
            </span>
            <button
              onClick={() => navigate('/agents')}
              className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Exit Setup
            </button>
          </div>

          {/* Content Area */}
          <div className="p-8 space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                Create a Voice Assistant
              </h2>
              <p className="text-xs text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">
                Choose to construct a custom assistant from scratch or jumpstart your agent with a pre-configured industry blueprint.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Custom Assistant */}
              <button
                onClick={() => setWizardStage('custom_name')}
                className="card p-6 flex flex-col justify-between text-left border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-[0_12px_36px_rgba(197,168,128,0.06)] cursor-pointer group min-h-[220px]"
              >
                <div>
                  <div className="text-3xl mb-4">✨</div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)] mb-2 group-hover:text-[var(--accent)] transition-colors">Custom Assistant</h3>
                  <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    Build a customizable node. Tailor behavioral rules, pick custom models, and connect your business tools from scratch.
                  </p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent)] mt-4 flex items-center gap-1">
                  Configure custom &rarr;
                </span>
              </button>

              {/* Blueprint Templates suggestion window */}
              <div className="space-y-3">
                <span className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-wider block ml-1">Pre-built Blueprints</span>
                <div className="grid grid-cols-1 gap-2.5">
                  {BLUEPRINTS.map(bp => (
                    <button
                      key={bp.name}
                      onClick={() => applyBlueprint(bp)}
                      className="card p-4 flex items-center gap-3.5 text-left border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-[0_8px_24px_rgba(197,168,128,0.04)] cursor-pointer group"
                    >
                      <div className="text-2xl">{bp.icon}</div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-xs font-bold text-[var(--text-primary)] group-hover:text-[var(--accent)] transition-colors">{bp.name}</h4>
                        <p className="text-[10px] text-[var(--text-muted)] truncate italic mt-0.5">"{bp.prompt}"</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Footer Bar */}
          <div className="bg-[var(--surface-secondary)] border-t border-[var(--border)] px-8 py-4 flex items-center justify-between">
            <button
              onClick={() => navigate('/agents')}
              className="btn-outline h-9 px-4 text-[10px] font-bold uppercase tracking-wider"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (wizardStage === 'custom_name') {
    return (
      <div className="max-w-2xl mx-auto mt-12 animate-in fade-in duration-300">
        <div className="card shadow-xl p-0 overflow-hidden border border-[var(--border)] bg-[var(--card-bg)] flex flex-col">
          {/* Header Bar */}
          <div className="px-8 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-secondary)]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Step 2 of 3 &bull; Identity Configuration
            </span>
            <button
              onClick={() => setWizardStage('select_path')}
              className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Back to Start
            </button>
          </div>

          {/* Content Area */}
          <div className="p-12 flex flex-col items-center justify-center space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                What should we call your Assistant?
              </h2>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                Choose a clear, distinct name that reflects their voice role or corporate identity.
              </p>
            </div>

            <div className="w-full max-w-md pt-4">
              <input 
                value={formData.agentName} 
                onChange={e => setFormData({ ...formData, agentName: e.target.value })}
                className="w-full text-center text-2xl font-bold bg-transparent border-b-2 border-[var(--border)] focus:border-[var(--accent)] outline-none py-3 text-[var(--text-primary)] transition-all duration-200 placeholder-[var(--text-placeholder)]"
                placeholder="e.g. Sarah Concierge"
                autoFocus
                onKeyDown={e => {
                  if (e.key === 'Enter' && formData.agentName.trim()) {
                    setWizardStage('custom_goal');
                  }
                }}
              />
              <span className="text-[9px] text-[var(--text-muted)] font-mono text-center block mt-3 uppercase tracking-wider">
                Press Enter to continue
              </span>
            </div>
          </div>

          {/* Footer Bar */}
          <div className="bg-[var(--surface-secondary)] border-t border-[var(--border)] px-8 py-4 flex items-center justify-between">
            <button
              onClick={() => setWizardStage('select_path')}
              className="btn-outline h-9 px-4 text-[10px] font-bold uppercase tracking-wider"
            >
              Previous Step
            </button>
            <button
              disabled={!formData.agentName.trim()}
              onClick={() => setWizardStage('custom_goal')}
              className="btn-primary h-9 px-5 text-[10px] font-bold uppercase tracking-wider disabled:opacity-40 disabled:pointer-events-none"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (wizardStage === 'custom_goal') {
    return (
      <div className="max-w-2xl mx-auto mt-12 animate-in fade-in duration-300">
        <div className="card shadow-xl p-0 overflow-hidden border border-[var(--border)] bg-[var(--card-bg)] flex flex-col">
          {/* Header Bar */}
          <div className="px-8 py-4 border-b border-[var(--border)] flex items-center justify-between bg-[var(--surface-secondary)]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Step 3 of 3 &bull; Goal & Objectives
            </span>
            <button
              onClick={() => setWizardStage('custom_name')}
              className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              Modify Name
            </button>
          </div>

          {/* Content Area */}
          <div className="p-8 flex flex-col items-center justify-center space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
                What is the main goal of your Assistant?
              </h2>
              <p className="text-xs text-[var(--text-secondary)] max-w-md leading-relaxed">
                Describe the guidelines, responsibilities, or behaviors expected of the assistant.
              </p>
            </div>

            <div className="w-full pt-2">
              <textarea 
                value={formData.prompt} 
                onChange={e => setFormData({ ...formData, prompt: e.target.value })}
                className="w-full h-40 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-4 text-xs font-semibold leading-relaxed outline-none focus:border-[var(--accent)] transition-all duration-200 resize-none text-left"
                placeholder="Describe what you want this agent to do. For example: You are a high-performing concierge assistant..."
                autoFocus
              />
            </div>
          </div>

          {/* Footer Bar */}
          <div className="bg-[var(--surface-secondary)] border-t border-[var(--border)] px-8 py-4 flex items-center justify-between">
            <button
              onClick={() => setWizardStage('custom_name')}
              className="btn-outline h-9 px-4 text-[10px] font-bold uppercase tracking-wider"
            >
              Previous Step
            </button>
            <button
              onClick={() => setWizardStage('configure')}
              className="btn-primary h-9 px-5 text-[10px] font-bold uppercase tracking-wider"
            >
              Configure Settings &rarr;
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto pb-12 animate-in fade-in duration-500 font-sans text-[var(--text-primary)]">
      
      {/* HEADER */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-6">
        <div>
          <div className="mb-4">
            <BackButton fallbackPath="/agents" label="Agents" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {editingAgent ? 'Configure Assistant' : 'Register Assistant'}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]"></span>
            </span>
            <p className="text-[var(--text-secondary)] text-xs font-semibold uppercase tracking-wider">Configure and launch your AI voice assistant connection node</p>
          </div>
        </div>

        <div className="flex items-center gap-3 self-start lg:self-auto">
          <button 
            onClick={() => handleSave(false)} 
            className="btn-outline h-11 text-xs font-bold uppercase tracking-wider px-5"
          >
            Save Draft
          </button>
          <button 
            onClick={() => handleSave(true)} 
            className="btn-primary h-11 text-xs font-bold uppercase tracking-wider px-5 shadow-sm"
          >
            <Zap size={14} />
            Launch Agent
          </button>
        </div>
      </div>

      {renderStepIndicator()}

      {/* MAIN CONTENT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        
        {/* FORM PANEL */}
        <div className="space-y-6">
          {step === 1 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              {/* BLUEPRINTS */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-1 text-[var(--text-muted)]">
                  <Sparkles size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Agent Blueprints</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {BLUEPRINTS.map(bp => (
                    <button
                      key={bp.name}
                      onClick={() => applyBlueprint(bp)}
                      className="card p-5 border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-[0_8px_24px_rgba(197,168,128,0.06)] text-left cursor-pointer group"
                    >
                      <div className="text-3xl mb-3">{bp.icon}</div>
                      <h3 className="text-sm font-bold text-[var(--text-primary)] mb-1 tracking-wide group-hover:text-[var(--accent)] transition-colors">{bp.name}</h3>
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed italic line-clamp-3">"{bp.prompt}"</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* IDENTITY FORM */}
              <div className="card p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Assistant Name</label>
                    <input 
                      value={formData.agentName} 
                      onChange={e => setFormData({ ...formData, agentName: e.target.value })} 
                      className="input-field" 
                      placeholder="e.g. Identity Node-01" 
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Linked Phone Number</label>
                    <Select
                      value={selectedNumberId}
                      onChange={val => setSelectedNumberId(val)}
                      options={[
                        { value: 'none', label: 'No Phone Number (Web / Chat only)' },
                        ...userNumbers.map((num: any) => ({
                          value: num.id,
                          label: `${num.number} (${num.provider === 'twilio' ? 'Twilio Telephony' : num.provider.toUpperCase()})`
                        }))
                      ]}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <ConfigGroup 
                    label="Intelligence Provider" 
                    value={formData.llm.provider} 
                    options={availableProviders} 
                    labels={providerLabels}
                    onChange={(p: string) => {
                      const defaultModel = dynamicModels[p as keyof typeof dynamicModels]?.[0]?.id || '';
                      setFormData({ 
                        ...formData, 
                        llm: { ...formData.llm, provider: p, model: defaultModel } 
                      });
                    }} 
                  />
                  <ConfigGroup 
                    label="Core Inference Model" 
                    value={formData.llm.model} 
                    options={currentModels.map((m: any) => m.id)} 
                    labels={currentModels.map((m: any) => m.name)} 
                    onChange={(m: string) => setFormData({ ...formData, llm: { ...formData.llm, model: m } })} 
                  />
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <SensitivitySlider 
                    label="Creativity (Temperature)" 
                    value={formData.llm.temperature} 
                    min={0} 
                    max={2.0} 
                    step={0.1} 
                    onChange={(v: number) => setFormData({...formData, llm: {...formData.llm, temperature: v}})} 
                    sub="Higher values yield creative, diverse responses." 
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Behavioral Directives</label>
                  <textarea 
                    value={formData.prompt} 
                    onChange={e => setFormData({ ...formData, prompt: e.target.value })} 
                    className="w-full !py-4 h-48 resize-none rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 text-xs font-semibold leading-relaxed outline-none focus:border-[var(--border-focus)] transition" 
                    placeholder="Enter detailed directives, constraints, persona rules, and background domain knowledge..." 
                  />
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ProPanel label="STT (The Ear)" icon={<Monitor size={14} />}>
                  {sttProviders.length === 0 && (
                    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-600">
                      No STT provider connected yet. Add an API key on the Providers page first.
                    </div>
                  )}
                  <ConfigGroup 
                    label="Signal Provider" 
                    value={formData.stt.provider} 
                    options={sttProviders} 
                    labels={sttProviderLabels}
                    onChange={(p: string) => {
                      // FIX: previously only `provider` was updated here,
                      // leaving `model` stuck on the old provider's model
                      // name. Re-derive `model` from that provider's own
                      // live model list (first entry) every time.
                      const models = getSttModelOptions(p);
                      setFormData({
                        ...formData,
                        stt: { ...formData.stt, provider: p, model: models[0]?.id || '' },
                      });
                    }} 
                  />
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">STT Model</label>
                    <Select
                      value={formData.stt.model}
                      onChange={(m: string) => setFormData({ ...formData, stt: { ...formData.stt, model: m } })}
                      options={getSttModelOptions(formData.stt.provider).map((m: any) => ({ value: m.id, label: m.name }))}
                      placeholder="No models available"
                      className="w-full text-xs"
                    />
                  </div>
                  <ConfigGroup 
                    label="Primary Language" 
                    value={formData.language} 
                    options={['hi-IN', 'en-US']} 
                    labels={['Hindi (Indic Dialect)', 'English (Global Dialect)']}
                    onChange={(l: string) => setFormData({ ...formData, language: l, stt: { ...formData.stt, language: l } })} 
                  />
                </ProPanel>

                <ProPanel label="TTS (The Mouth)" icon={<Volume2 size={14} />}>
                  {ttsProviders.length === 0 && (
                    <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-600">
                      No TTS provider connected yet. Add an API key on the Providers page first.
                    </div>
                  )}
                  <ConfigGroup 
                    label="Signal Provider" 
                    value={formData.tts.provider} 
                    options={ttsProviders} 
                    labels={ttsProviderLabels}
                    onChange={(p: string) => {
                      // FIX: previously only `voice` was reset here, leaving
                      // `model` stuck on the old provider's model name (e.g.
                      // Sarvam's 'bulbul:v3' surviving a switch to OpenAI).
                      // Both `model` and `voice` now come from that
                      // provider's own live list, never a hardcoded string.
                      const voiceList = getTtsVoiceOptions(p);
                      const modelList = getTtsModelOptions(p);
                      setFormData({ 
                        ...formData, 
                        tts: {
                          ...formData.tts,
                          provider: p,
                          model: modelList[0]?.id || '',
                          voice: voiceList[0]?.id || '',
                        } 
                      });
                    }} 
                  />
                  {getTtsModelOptions(formData.tts.provider).length > 0 && (
                    <div className="space-y-1.5 mt-4">
                      <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">TTS Model</label>
                      <Select
                        value={formData.tts.model}
                        onChange={(m: string) => setFormData({ ...formData, tts: { ...formData.tts, model: m } })}
                        options={getTtsModelOptions(formData.tts.provider).map((m: any) => ({ value: m.id, label: m.name }))}
                        placeholder="No models available"
                        className="w-full text-xs"
                      />
                    </div>
                  )}
                  <div className="space-y-2 mt-4">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Voice Identity</label>
                    {getTtsVoiceOptions(formData.tts.provider).length === 0 ? (
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-4 text-[11px] font-semibold text-[var(--text-secondary)] text-center">
                        Select a connected TTS provider above to see its available voices.
                      </div>
                    ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[190px] overflow-y-auto pr-1 custom-scrollbar">
                      {getTtsVoiceOptions(formData.tts.provider).map((v: any) => {
                        const isSelected = formData.tts.voice === v.id;
                        const isMale = v.id === 'shubh' || v.id === 'aditya' || v.id === 'echo';
                        const isFemale = v.id === 'neha' || v.id === 'shreya' || v.id === 'ritu' || v.id === 'shimmer';
                        const tag = isMale ? 'Male' : isFemale ? 'Female' : 'Neutral';
                        
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => setFormData({ ...formData, tts: { ...formData.tts, voice: v.id } })}
                            className={`p-3 rounded-xl border text-left flex flex-col justify-between cursor-pointer min-h-[85px] relative overflow-hidden ${
                              isSelected 
                                ? 'border-[var(--accent)] bg-[var(--accent)]/5 ring-1 ring-[var(--accent)] shadow-[0_4px_12px_rgba(197,168,128,0.08)]' 
                                : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-hover)] hover:bg-[var(--surface-secondary)]/50'
                            }`}
                          >
                            <div className="flex items-center justify-between w-full">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                  isMale ? 'bg-blue-400 animate-pulse' : isFemale ? 'bg-rose-400 animate-pulse' : 'bg-amber-400 animate-pulse'
                                }`} />
                                <span className="text-[11px] font-bold text-[var(--text-primary)] truncate max-w-[85px]">{v.name.split(' (')[0]}</span>
                              </div>
                              <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded leading-none tracking-wider shrink-0 ${
                                isMale 
                                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20' 
                                  : isFemale 
                                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20' 
                                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                              }`}>
                                {tag}
                              </span>
                            </div>
                            <p className="text-[9px] text-[var(--text-muted)] line-clamp-1 italic mt-2 leading-normal">
                              {v.name.includes(' - ') ? v.name.split(' - ')[1].replace(')', '') : 'Premium synthesized speech.'}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                    )}
                  </div>
                </ProPanel>
              </div>

              <div className="card p-6 space-y-6">
                <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider border-b border-[var(--border)] pb-2">Speech Pace Adjustment</h3>
                <SensitivitySlider 
                  label="Vocal Tempo Pace" 
                  value={formData.tts.pace} 
                  min={0.6} 
                  max={1.5} 
                  step={0.05} 
                  onChange={(v: number) => setFormData({...formData, tts: {...formData.tts, pace: v}})} 
                  sub="Sets voice articulation rate speed." 
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="card p-6 space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Agent Tools Integration</h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">Connect operational tools to execute platform triggers.</p>
                </div>
                <button 
                  onClick={() => navigate('/tools')} 
                  className="btn-outline h-9 text-[11px] px-3 font-semibold uppercase tracking-wider"
                >
                  Marketplace
                </button>
              </div>

              {availableTools.length === 0 ? (
                <div className="p-16 text-center border border-dashed border-[var(--border)] rounded-2xl bg-[var(--surface-secondary)]/30">
                  <Command size={32} className="mx-auto text-[var(--text-muted)] mb-3" />
                  <p className="text-xs text-[var(--text-muted)] italic font-semibold">No tools available in current registry.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {availableTools.map(tool => {
                    const isSelected = (formData.tools || []).includes(tool.id);
                    return (
                      <button 
                        key={tool.id}
                        onClick={() => {
                          const current = formData.tools || [];
                          const next = isSelected 
                            ? current.filter((id: string) => id !== tool.id)
                            : [...current, tool.id];
                          setFormData({ ...formData, tools: next });
                        }}
                        className={`p-4 rounded-xl border text-left flex flex-col justify-between min-h-[110px] group ${
                          isSelected 
                            ? 'border-[var(--primary)] bg-[var(--primary)]/5 shadow-sm' 
                            : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-hover)] hover:bg-[var(--surface-secondary)]/50'
                        }`}
                      >
                        <div className="flex justify-between items-center w-full">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            isSelected ? 'bg-[var(--primary)] text-white' : 'bg-[var(--surface-secondary)] border border-[var(--border)] text-[var(--text-muted)]'
                          }`}>
                            <Code size={14} />
                          </div>
                          {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] animate-pulse" />}
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-[var(--text-primary)] mt-3">{tool.name}</h4>
                          <p className="text-[10px] text-[var(--text-muted)] line-clamp-1 italic mt-1 leading-normal">{tool.description || 'Custom module link.'}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="card p-6 space-y-8 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Audio Signal Processing</h3>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">Calibrate connection latency and noise thresholds.</p>
                </div>
                <span className="px-2.5 py-0.5 border border-emerald-500/20 bg-emerald-500/10 text-[var(--success)] text-[9px] rounded font-bold uppercase tracking-wider leading-none">Advanced Audio</span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <SensitivitySlider label="Activation Threshold" value={formData.vad.activation_threshold} min={0.1} max={0.9} step={0.05} onChange={(v: number) => setFormData({...formData, vad: {...formData.vad, activation_threshold: v}})} sub="VAD threshold detection floor." />
                <SensitivitySlider label="Speech Resilience" value={formData.vad.min_speech_duration} min={0.05} max={1.0} step={0.05} onChange={(v: number) => setFormData({...formData, vad: {...formData.vad, min_speech_duration: v}})} sub="Minimum sound duration floor." />
                <SensitivitySlider label="Silence Tolerance" value={formData.vad.min_silence_duration} min={0.1} max={3.0} step={0.1} onChange={(v: number) => setFormData({...formData, vad: {...formData.vad, min_silence_duration: v}})} sub="Delay buffer before speaker changes." />
                <SensitivitySlider label="Signal Padding" value={formData.vad.padding_duration} min={0.05} max={1.0} step={0.05} onChange={(v: number) => setFormData({...formData, vad: {...formData.vad, padding_duration: v}})} sub="Padding border boundaries." />
              </div>

              <div className="p-4 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl flex gap-3 shadow-inner">
                <div className="w-8 h-8 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] shrink-0 shadow-sm mt-0.5">
                  <Info size={14} />
                </div>
                <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed font-semibold">
                  Voice Activity Detection controls latency and sensitivity thresholds. Correct settings ensure stable, real-time responses with zero disruption.
                </p>
              </div>
            </div>
          )}

          {/* BOTTOM STEP CONTROLS */}
          <div className="mt-8 flex justify-between items-center py-4 border-t border-[var(--border)]">
            {step === 1 ? (
              <button 
                type="button"
                onClick={() => navigate('/agents')}
                className="btn-outline h-10 px-5 text-xs font-bold uppercase tracking-wider"
              >
                Cancel
              </button>
            ) : (
              <button 
                type="button"
                onClick={() => setStep(s => Math.max(1, s - 1))}
                className="btn-outline h-10 px-5 text-xs font-bold uppercase tracking-wider"
              >
                Previous Stage
              </button>
            )}
            <button 
              type="button"
              onClick={() => {
                if (step === 1 && !formData.agentName.trim()) return toast.error("Assistant name required");
                if (step < 4) setStep(s => s + 1);
                else handleSave(true);
              }}
              className="btn-primary h-10 px-6 text-xs font-bold uppercase tracking-wider shadow-sm"
            >
              {step < 4 ? 'Next Stage' : 'Save & Launch'}
            </button>
          </div>
        </div>

        {/* SIDEBAR PREVIEW (MATCHES PROFILE CARD STYLE EXACTLY) */}
        <div className="space-y-6">
          <div className="card p-6 flex flex-col justify-between sticky top-24 min-h-[350px]">
            <div className="flex flex-col items-center text-center">
              {/* AVATAR BOX WITH STATUS DOT */}
              <div className="relative mb-4">
                <AgentAvatar name={formData.agentName} agent={formData} className="w-20 h-20 text-4xl" />
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-lg bg-[var(--success)] border border-[var(--border)] animate-pulse" />
              </div>

              {/* NAME */}
              <h2 className="text-sm font-bold text-[var(--text-primary)] truncate max-w-[240px] uppercase tracking-wide leading-none">
                {formData.agentName || 'Unnamed Assistant'}
              </h2>

              {/* BADGE */}
              <div className="mt-3 px-2 py-0.5 rounded border border-[var(--primary)]/20 bg-[var(--primary)]/5 text-[var(--primary)] text-[8px] font-extrabold uppercase tracking-widest leading-none">
                Link Protocol Ready
              </div>
            </div>

            {/* PREVIEW STATS */}
            <div className="mt-6 border-t border-[var(--border)] pt-4 space-y-1">
              <PreviewStat 
                label="Intelligence" 
                value={dynamicModels[currentProvider]?.find((m: any) => m.id === formData.llm.model)?.name || formData.llm.model} 
              />
              <PreviewStat 
                label="Provider" 
                value={formData.llm.provider.toUpperCase()} 
              />
              <PreviewStat 
                label="Voice Identity" 
                value={formData.tts.voice} 
              />
              <PreviewStat 
                label="Language" 
                value={formData.language.split('-')[0].toUpperCase()} 
              />
              <PreviewStat 
                label="Pace Speed" 
                value={`${formData.tts.pace || 1.0}x`} 
              />
              <PreviewStat 
                label="VAD Threshold" 
                value={formData.vad.activation_threshold} 
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};

/* COMPONENT INTERACTION PARTS */
const ConfigGroup = ({ label, value, options, labels, onChange }: any) => (
  <div className="space-y-1.5 flex-1 min-w-0">
    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">{label}</label>
    <Select 
      value={value} 
      onChange={onChange}
      options={options.map((opt: string, i: number) => ({
        value: opt,
        label: labels[i] || opt.toUpperCase()
      }))}
    />
  </div>
);

const ProPanel = ({ label, icon, children }: any) => (
  <div className="card p-6 flex flex-col justify-between min-h-[220px]">
    <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3 mb-4">
      <div className="w-8 h-8 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] shrink-0 shadow-sm">
        {icon}
      </div>
      <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">{label}</h3>
    </div>
    <div className="space-y-4 flex-1">
      {children}
    </div>
  </div>
);

const SensitivitySlider = ({ label, value, min, max, step, onChange, sub }: any) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center">
      <span className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">{label}</span>
      <span className="text-xs font-extrabold text-[var(--primary)] font-mono">{value}</span>
    </div>
    <input 
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="w-full premium-slider appearance-none cursor-pointer"
    />
    <span className="text-[9px] text-[var(--text-muted)] italic font-semibold block">{sub}</span>
  </div>
);

export default CreateAgentPage;