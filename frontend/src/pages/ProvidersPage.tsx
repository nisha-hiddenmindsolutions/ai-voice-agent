import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  RefreshCw, 
  Trash2, 
  CheckCircle2, 
  ExternalLink,
  Eye,
  EyeOff,
  Activity,
  Cpu,
  Database,
  Search,
  Sparkles,
  Lock,
  X
} from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';

interface ProviderModel {
  id: string;
  model_id: string;
  name: string;
  context_window: number;
  capabilities: any;
}

interface ProviderConnection {
  id: string;
  provider: string;
  status: string;
  created_at: string;
  models_count: number;
  models: ProviderModel[];
}

import {
  SiOpenai,
  SiAnthropic,
  SiDeepgram,
  SiElevenlabs,
} from "react-icons/si";

// Dynamic TypingMind Provider Icon component with robust vector fallbacks
const ProviderIcon: React.FC<{ provider: string; size?: number; className?: string }> = ({ provider, size = 20, className = "" }) => {
  const [useFallback, setUseFallback] = useState(false);

  // Curated fallback SVG and React Icon wrappers matching authentic provider colors
  const fallbacks: Record<string, React.ReactNode> = {
    openai: <SiOpenai color="#10A37F" size={size} className="shrink-0" />,
    openrouter: (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2L2 22h20L12 2zm0 4.5L18.5 19H5.5L12 6.5zm-2 5h4v2h-4v-2z" fill="#7C3AED" />
      </svg>
    ),
    anthropic: <SiAnthropic color="#D97706" size={size} className="shrink-0 bg-[#FDFBF7] p-0.5 rounded border border-[#E5E7EB]" />,
    groq: (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 10.9 21.1 10 20 10H12V14H18C17.5 16.3 15.4 18 12 18C8.7 18 6 15.3 6 12C6 8.7 8.7 6 12 6C14.3 6 16.3 7.3 17.3 9.3L20.9 7.7C19.2 4.3 15.9 2 12 2Z" fill="#F55036" />
      </svg>
    ),
    gemini: (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17Z" fill="#4285F4" />
      </svg>
    ),
    deepseek: (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" fill="#0054FF" />
        <path d="M7.5 12.5C7.5 10 9.5 8 12 8C14.5 8 16.5 10 16.5 12.5C16.5 15 14.5 17 12 17H7.5V12.5Z" fill="white" />
        <path d="M10 12.5C10 11.4 10.9 10.5 12 10.5C13.1 10.5 14 11.4 14 12.5C14 13.6 13.1 14.5 12 14.5H10V12.5Z" fill="#0054FF" />
      </svg>
    ),
    together_ai: (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17Z" fill="url(#togetherGrad)" />
      </svg>
    ),
    sarvam: (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="9" width="2.5" height="6" rx="1.25" fill="#FF9933"/>
        <rect x="7.5" y="6" width="2.5" height="12" rx="1.25" fill="#FF9933"/>
        <rect x="12" y="3" width="2.5" height="18" rx="1.25" fill="#128807"/>
        <rect x="16.5" y="6" width="2.5" height="12" rx="1.25" fill="#128807"/>
        <rect x="21" y="9" width="2.5" height="6" rx="1.25" fill="#128807"/>
      </svg>
    ),
    deepgram: <SiDeepgram color="#13EF95" size={size} className="shrink-0" />,
    elevenlabs: <SiElevenlabs color="#000000" size={size} className="shrink-0 bg-[#F2F0E4] p-0.5 rounded border border-[#E5E7EB]" />,
    cartesia: (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="url(#cartesiaGrad)" strokeWidth="2.5" strokeDasharray="3 3" />
        <circle cx="12" cy="12" r="6" stroke="url(#cartesiaGrad)" strokeWidth="2" />
        <circle cx="12" cy="12" r="2.5" fill="#EC4899" />
      </svg>
    ),
    assemblyai: (
      <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="10" width="3.5" height="4" rx="1.75" fill="#FF6D00" />
        <rect x="8.5" y="6" width="3.5" height="12" rx="1.75" fill="#6366F1" />
        <rect x="14" y="3" width="3.5" height="18" rx="1.75" fill="#FF6D00" />
        <rect x="19.5" y="8" width="3.5" height="8" rx="1.75" fill="#6366F1" />
      </svg>
    )
  };

  // Official TypingMind model-icons links
  const typingMindUrls: Record<string, string> = {
    openai: "https://raw.githubusercontent.com/TypingMind/model-icons/main/icons/openai.svg",
    openrouter: "https://raw.githubusercontent.com/TypingMind/model-icons/main/icons/openrouterai.png",
    anthropic: "https://raw.githubusercontent.com/TypingMind/model-icons/main/icons/claude.webp",
    groq: "https://raw.githubusercontent.com/TypingMind/model-icons/main/icons/groq.svg",
    gemini: "https://raw.githubusercontent.com/TypingMind/model-icons/main/icons/gemini.png",
    deepseek: "https://raw.githubusercontent.com/TypingMind/model-icons/main/icons/deepseek.png"
  };

  const imageUrl = typingMindUrls[provider];

  if (!imageUrl || useFallback) {
    return <div className={`flex items-center justify-center shrink-0 ${className}`}>{fallbacks[provider] || <span>🪐</span>}</div>;
  }

  return (
    <img 
      src={imageUrl} 
      alt={provider} 
      className={`shrink-0 object-contain ${className}`} 
      style={{ width: size, height: size }}
      onError={() => setUseFallback(true)}
    />
  );
};

// Map PROVIDER_METADATA to use dynamic brand logos
const OpenAILogo = () => <ProviderIcon provider="openai" size={20} />;
const OpenRouterLogo = () => <ProviderIcon provider="openrouter" size={20} />;
const AnthropicLogo = () => <ProviderIcon provider="anthropic" size={20} />;
const GroqLogo = () => <ProviderIcon provider="groq" size={20} />;
const GeminiLogo = () => <ProviderIcon provider="gemini" size={20} />;
const DeepSeekLogo = () => <ProviderIcon provider="deepseek" size={20} />;
const TogetherLogo = () => (
  <>
    <ProviderIcon provider="together_ai" size={20} />
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <linearGradient id="togetherGrad" x1="2" y1="12" x2="22" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4F46E5" />
          <stop offset="100%" stopColor="#EC4899" />
        </linearGradient>
      </defs>
    </svg>
  </>
);
const SarvamLogo = () => <ProviderIcon provider="sarvam" size={20} />;
const DeepgramLogo = () => <ProviderIcon provider="deepgram" size={20} />;
const ElevenLabsLogo = () => <ProviderIcon provider="elevenlabs" size={20} />;
const CartesiaLogo = () => (
  <>
    <ProviderIcon provider="cartesia" size={20} />
    <svg style={{ position: 'absolute', width: 0, height: 0 }}>
      <defs>
        <linearGradient id="cartesiaGrad" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3B82F6"/>
          <stop offset="0.5" stopColor="#EC4899"/>
          <stop offset="1" stopColor="#F59E0B"/>
        </linearGradient>
      </defs>
    </svg>
  </>
);
const AssemblyAILogo = () => <ProviderIcon provider="assemblyai" size={20} />;

const PROVIDER_METADATA: { 
  [key: string]: { 
    name: string; 
    tag: string; 
    desc: string; 
    placeholder: string; 
    docUrl: string; 
    logo: React.ComponentType;
  } 
} = {
  openai: {
    name: 'OpenAI platform',
    tag: 'LLM & TTS',
    desc: 'Access GPT-4o, GPT-4o Mini, and high-fidelity OpenAI TTS synthesis.',
    placeholder: 'sk-proj-...',
    docUrl: 'https://platform.openai.com/api-keys',
    logo: OpenAILogo,
  },
  openrouter: {
    name: 'OpenRouter API',
    tag: 'LLM gateway',
    desc: 'Access hundreds of open-weights models via a unified API token.',
    placeholder: 'sk-or-v1-...',
    docUrl: 'https://openrouter.ai/keys',
    logo: OpenRouterLogo,
  },
  anthropic: {
    name: 'Anthropic Claude',
    tag: 'LLM',
    desc: 'Powers world-class Claude 3.5 Sonnet, Claude 3 Opus, and Claude 3.5 Haiku.',
    placeholder: 'sk-ant-...',
    docUrl: 'https://console.anthropic.com/',
    logo: AnthropicLogo,
  },
  groq: {
    name: 'Groq cloud',
    tag: 'LLM & STT',
    desc: 'Powers ultra-low latency LLaMA & Mistral models and Groq Whisper STT.',
    placeholder: 'gsk_...',
    docUrl: 'https://console.groq.com/keys',
    logo: GroqLogo,
  },
  gemini: {
    name: 'Google Gemini',
    tag: 'LLM',
    desc: 'Ingest Google Gemini 2.5 Pro and Gemini 2.5 Flash models natively.',
    placeholder: 'AIzaSy...',
    docUrl: 'https://aistudio.google.com/',
    logo: GeminiLogo,
  },
  deepseek: {
    name: 'DeepSeek AI',
    tag: 'LLM',
    desc: 'Ingest low-cost, high-intelligence DeepSeek Chat (V3) models directly.',
    placeholder: 'sk-...',
    docUrl: 'https://platform.deepseek.com/',
    logo: DeepSeekLogo,
  },
  together_ai: {
    name: 'Together AI',
    tag: 'LLM',
    desc: 'High-speed host for LLaMA, Mixtral, and open-weights developer models.',
    placeholder: 'insert together api key...',
    docUrl: 'https://api.together.xyz/',
    logo: TogetherLogo,
  },
  sarvam: {
    name: 'Sarvam AI',
    tag: 'STT & TTS',
    desc: 'Access low-cost, ultra-premium Indic language speech-to-text and text-to-speech.',
    placeholder: 'insert sarvam api key...',
    docUrl: 'https://www.sarvam.ai/',
    logo: SarvamLogo,
  },
  deepgram: {
    name: 'Deepgram cloud',
    tag: 'STT & TTS',
    desc: 'Low-latency, hyper-accurate Speech-to-Text and Aura Text-to-Speech voices.',
    placeholder: 'insert deepgram api key...',
    docUrl: 'https://console.deepgram.com/',
    logo: DeepgramLogo,
  },
  elevenlabs: {
    name: 'ElevenLabs voices',
    tag: 'TTS',
    desc: 'Powers dynamic, multi-lingual emotional speech-to-text voices.',
    placeholder: 'insert elevenlabs key...',
    docUrl: 'https://elevenlabs.io/app/settings/api-keys',
    logo: ElevenLabsLogo,
  },
  cartesia: {
    name: 'Cartesia sonic',
    tag: 'TTS',
    desc: 'Powers extremely low-latency, conversational Cartesia voices.',
    placeholder: 'insert cartesia key...',
    docUrl: 'https://play.cartesia.ai/',
    logo: CartesiaLogo,
  },
  assemblyai: {
    name: 'AssemblyAI',
    tag: 'STT',
    desc: 'Hyper-accurate transcription models for conversational audio analytics.',
    placeholder: 'insert assemblyai key...',
    docUrl: 'https://www.assemblyai.com/',
    logo: AssemblyAILogo,
  }
};

const StatCard = ({
  icon,
  label,
  value,
  gradient,
  shadow,
  color = 'var(--text-secondary)'
}: any) => (
  <div className="card-shimmer stat-card-glow p-5 flex flex-col justify-between min-h-[140px] relative overflow-hidden">
    <div 
      className="absolute -right-8 -bottom-8 w-24 h-24 rounded-full blur-3xl opacity-15 pointer-events-none"
      style={{ background: gradient || `linear-gradient(135deg, ${color}, ${color}cc)` }}
    />
    <div className="flex items-center justify-between relative z-10">
      <div 
        className="w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg"
        style={{ 
          background: gradient || `linear-gradient(135deg, ${color}, ${color}cc)`,
          boxShadow: `0 4px 12px -2px ${shadow || `${color}40`}`
        }}
      >
        {icon}
      </div>
    </div>
    <div className="mt-3 relative z-10">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <h3 className="text-xl font-extrabold text-[var(--text-primary)] mt-1 tracking-tight">
        {value}
      </h3>
    </div>
  </div>
);

const ProvidersPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<ProviderConnection[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  
  // Wizard State
  const [wizardStep, setWizardStep] = useState(1);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyStatus, setVerifyStatus] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchConnections();
  }, []);

  const fetchConnections = async () => {
    try {
      const resp = await api.get('/providers/');
      setConnections(resp.data || []);
    } catch (err) {
      toast.error('Failed to sync provider connections.');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to disconnect ${name.toUpperCase()}? This will also remove all its fetched models.`)) {
      return;
    }
    const toastId = toast.loading(`Disconnecting ${name.toUpperCase()}...`);
    try {
      await api.delete(`/providers/${id}`);
      toast.success(`${name.toUpperCase()} disconnected`, { id: toastId });
      fetchConnections();
    } catch (err) {
      toast.error('Failed to disconnect provider', { id: toastId });
    }
  };

  const handleRefreshModels = async (id: string, name: string) => {
    const toastId = toast.loading(`Re-indexing ${name.toUpperCase()} models...`);
    try {
      const resp = await api.post(`/providers/${id}/refresh`);
      toast.success(resp.data.message || `Successfully synced models.`, { id: toastId });
      fetchConnections();
    } catch (err) {
      toast.error('Failed to refresh models.', { id: toastId });
    }
  };

  const startAddFlow = () => {
    setSelectedProvider('');
    setApiKey('');
    setWizardStep(1);
    setShowAddModal(true);
  };

  const handleConnectProvider = async () => {
    if (!selectedProvider) return;
    if (!apiKey.trim()) {
      toast.error('Please input a valid API key');
      return;
    }

    setVerifying(true);
    setWizardStep(3);
    setVerifyStatus('Establishing secure node connection...');

    try {
      setTimeout(() => setVerifyStatus('Verifying API token...'), 800);
      setTimeout(() => setVerifyStatus('Ingesting model schemas...'), 1600);
      
      await api.post('/providers/', {
        provider: selectedProvider,
        api_key: apiKey.trim()
      });

      setTimeout(() => {
        setVerifying(false);
        setWizardStep(4);
        toast.success(`Connected to ${selectedProvider.toUpperCase()}`);
        fetchConnections();
      }, 2400);

    } catch (err: any) {
      setVerifying(false);
      setWizardStep(2);
      const errMsg = err.response?.data?.detail || 'Verification failed. Please check key validity.';
      toast.error(errMsg);
    }
  };

  const filteredProviders = Object.keys(PROVIDER_METADATA).filter(key => 
    PROVIDER_METADATA[key].name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    PROVIDER_METADATA[key].tag.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] space-y-4 animate-in fade-in duration-200">
        <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
        <span className="text-[10px] font-mono text-[var(--text-muted)] tracking-wider">Accessing provider gateway...</span>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto pb-12 animate-in fade-in duration-500 font-sans text-[var(--text-primary)] relative">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 relative z-10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <Cpu size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)]">Provider Connections</h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 font-medium ml-[52px]">Connect model providers and sync infrastructure API keys.</p>
        </div>

        <button
          onClick={startAddFlow}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer self-start md:self-auto btn-shine active:scale-[0.97]"
          style={{
            backgroundColor: 'var(--primary)',
            color: '#fff',
            boxShadow: '0 4px 14px -3px rgba(79, 70, 229, 0.4)'
          }}
        >
          <Plus size={14} />
          Connect Provider
        </button>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8 relative z-10">
        <StatCard
          icon={<Cpu size={20} />}
          label="Connections"
          value={connections.length}
          gradient="linear-gradient(135deg, #4F46E5, #6366F1)"
          shadow="rgba(79, 70, 229, 0.25)"
        />
        <StatCard
          icon={<Database size={20} />}
          label="Models Synced"
          value={connections.reduce(
            (acc, curr) => acc + curr.models_count,
            0
          )}
          gradient="linear-gradient(135deg, #10B981, #06D6A0)"
          shadow="rgba(16, 185, 129, 0.25)"
        />
        <StatCard
          icon={<Activity size={20} />}
          label="Status"
          value="Operational"
          gradient="linear-gradient(135deg, #8B5CF6, #A78BFA)"
          shadow="rgba(139, 92, 246, 0.25)"
        />
        <StatCard
          icon={<Lock size={20} />}
          label="Security"
          value="AES-256"
          gradient="linear-gradient(135deg, #F59E0B, #FBBF24)"
          shadow="rgba(245, 158, 11, 0.25)"
        />
      </div>

      {/* PROVIDERS */}
      <div>
        <div className="mb-6 border-b border-[var(--border)] pb-3">
          <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
            Connected Gateways
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-medium">
            Active developer endpoints and synced model packages.
          </p>
        </div>

        {connections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-secondary)]/30 p-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4 text-[var(--text-muted)] shadow-sm">
              <Database size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">
              No providers connected
            </h3>
            <p className="text-xs text-[var(--text-muted)] mt-2 max-w-xs mx-auto leading-relaxed font-semibold">
              Connect OpenAI, Groq, OpenRouter or other platforms to enable voice agent LLMs.
            </p>
            {/* <button
              onClick={startAddFlow}
              className="mt-5 btn-primary shadow-sm"
            >
              Connect Provider
            </button> */}
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {connections.map((conn) => {
              const meta = PROVIDER_METADATA[conn.provider] || {
                name: conn.provider.toUpperCase(),
                tag: 'AI Provider',
                desc: 'Connected dynamic portal gateway.',
                logo: '🪐'
              };

              return (
                <div
                  key={conn.id}
                  className="card-shimmer flex flex-col justify-between min-h-[240px] relative overflow-hidden group cursor-default"
                >
                  {/* TOP */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-4">
                      {/* LOGO */}
                      <div className="w-12 h-12 rounded-xl border border-[var(--border)] bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-sm relative p-1.5">
                        <meta.logo />
                      </div>

                      {/* INFO */}
                      <div>
                        <h3 className="text-sm font-bold text-[var(--text-primary)] tracking-wide">
                          {meta.name}
                        </h3>

                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="px-1.5 py-0.5 rounded bg-[var(--surface-secondary)] border border-[var(--border)] text-[var(--text-muted)] text-[8px] font-extrabold uppercase tracking-widest leading-none">
                            {meta.tag}
                          </span>

                          <div className="flex items-center gap-1 text-[var(--success)] text-[10px] font-bold uppercase tracking-wider">
                            <div className="w-1 h-1 rounded-full bg-[var(--success)] animate-pulse" />
                            Active
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ACTIONS */}
                    <button
                      onClick={() =>
                        handleDisconnect(
                          conn.id,
                          conn.provider
                        )
                      }
                      className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--danger)] hover:border-red-500/20 transition-all duration-200 active:scale-95"
                      title="Decommission Link"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {/* DESC */}
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed font-semibold min-h-[36px]">
                    {meta.desc}
                  </p>

                  {/* MODELS */}
                  <div className="mt-4 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] shadow-inner">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider">
                        Synced Active Models
                      </span>
                      <span className="text-sm font-extrabold text-[var(--text-primary)]">
                        {conn.models_count}
                      </span>
                    </div>
                  </div>

                  {/* FOOTER */}
                  <div className="flex items-center gap-2.5 mt-4 relative z-20">
                    <button
                      onClick={() =>
                        handleRefreshModels(
                          conn.id,
                          conn.provider
                        )
                      }
                      className="flex-1 btn-outline h-10 text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5"
                    >
                      <RefreshCw size={13} />
                      Sync Models
                    </button>

                    <a
                      href={meta.docUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="h-10 px-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-hover)] transition flex items-center justify-center"
                      title="View Documentation"
                    >
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ADD PROVIDER WIZARD MODAL */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-[400px] overflow-hidden shadow-xl relative font-sans animate-in zoom-in-95 duration-200">
            
            {/* MODAL HEADER */}
            <div className="px-6 py-4 border-b border-[var(--border)] flex items-center justify-between relative z-10">
              <div className="space-y-0.5">
                <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Connect Provider Portal</h3>
                <span className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Establish infrastructure node</span>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 hover:bg-[var(--surface-secondary)] rounded-lg transition-all"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>

            {/* MODAL CONTENT */}
            <div className="p-6 space-y-4 relative z-10">
              
              {/* STEP INDICATOR */}
              <div className="flex items-center justify-between px-1">
                {[1, 2, 3, 4].map(step => (
                  <div key={step} className="flex items-center flex-1 last:flex-none">
                    <div className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono border transition-all ${
                      wizardStep === step 
                        ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm'
                        : wizardStep > step
                        ? 'bg-emerald-500/10 border-emerald-500/20 text-[var(--success)]'
                        : 'bg-[var(--surface-secondary)] border-[var(--border)] text-[var(--text-muted)]'
                    }`}>
                      {wizardStep > step ? <CheckCircle2 size={11} className="text-[var(--success)]" /> : step}
                    </div>
                    {step < 4 && (
                      <div className={`h-[1px] flex-1 mx-2 transition-all ${
                        wizardStep > step ? 'bg-[var(--success)]' : 'bg-[var(--border)]'
                      }`} />
                    )}
                  </div>
                ))}
              </div>

              {/* STEP 1: SELECT PROVIDER */}
              {wizardStep === 1 && (
                <div className="space-y-3 animate-in fade-in duration-200">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={13} />
                    <input 
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      className="input-field pl-9 text-xs" 
                      placeholder="Search providers..." 
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                    {filteredProviders.map(key => {
                      const meta = PROVIDER_METADATA[key];
                      const isConnected = connections.some(c => c.provider === key);
                      
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            setSelectedProvider(key);
                            setWizardStep(2);
                          }}
                          className={`p-2.5 rounded-xl text-left border flex items-center justify-between group ${
                            isConnected 
                              ? 'border-[var(--border)] bg-[var(--surface-secondary)]/50 opacity-70' 
                              : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--primary)] hover:bg-[var(--surface-secondary)]'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-white border border-[var(--border)] flex items-center justify-center overflow-hidden shrink-0 p-0.5 text-center flex-col">
                              <meta.logo />
                            </div>
                            <span className="text-[10px] font-bold text-[var(--text-primary)] truncate max-w-[80px] uppercase tracking-wider">{meta.name.replace(' platform','').replace(' API','').replace(' cloud','').replace(' AI','').replace(' voices','')}</span>
                          </div>
                          {isConnected && (
                            <span className="text-[8px] font-bold text-[var(--text-muted)] uppercase tracking-widest shrink-0">linked</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* STEP 2: ENTER API KEY */}
              {wizardStep === 2 && selectedProvider && (
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="flex items-center gap-3 border-b border-[var(--border)] pb-3">
                    <div className="w-8 h-8 rounded-lg bg-white border border-[var(--border)] flex items-center justify-center overflow-hidden shrink-0 p-1">
                      {React.createElement(PROVIDER_METADATA[selectedProvider].logo)}
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider leading-none">
                        Connect {PROVIDER_METADATA[selectedProvider].name}
                      </h4>
                      <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-widest mt-1">
                        BYOK secure encryption layer
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between pl-0.5">
                      <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                        API TOKEN
                      </label>
                      <a 
                        href={PROVIDER_METADATA[selectedProvider].docUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-[9px] text-[var(--primary)] hover:underline font-bold uppercase tracking-wider flex items-center gap-1"
                      >
                        <span>Get key</span>
                        <ExternalLink size={9} />
                      </a>
                    </div>
                    
                    <div className="relative">
                      <input 
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKey}
                        onChange={e => setApiKey(e.target.value)}
                        disabled={verifying}
                        className="input-field font-mono pr-9" 
                        placeholder={PROVIDER_METADATA[selectedProvider].placeholder} 
                      />
                      <button 
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        disabled={verifying}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-30"
                      >
                        {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button 
                      onClick={() => setWizardStep(1)}
                      disabled={verifying}
                      className="flex-1 btn-outline h-10 text-xs font-semibold uppercase tracking-wider"
                    >
                      Back
                    </button>
                    <button 
                      onClick={handleConnectProvider}
                      disabled={verifying}
                      className="flex-1 btn-primary h-10 text-xs font-semibold uppercase tracking-wider"
                    >
                      Authenticate
                    </button>
                  </div>
                </div>
              )}

              {/* STEP 3: TESTING CONNECTION & MODEL FETCH */}
              {wizardStep === 3 && (
                <div className="flex flex-col items-center justify-center py-6 space-y-4 animate-in fade-in duration-200">
                  <div className="relative w-10 h-10 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
                    <Sparkles className="text-[var(--primary)] animate-pulse" size={15} />
                  </div>
                  
                  <div className="text-center space-y-1">
                    <p className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">{verifyStatus}</p>
                    <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider">securing vault handshake...</p>
                  </div>
                </div>
              )}

              {/* STEP 4: SUCCESS */}
              {wizardStep === 4 && (
                <div className="flex flex-col items-center justify-center py-6 space-y-4 animate-in fade-in duration-200">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-[var(--success)] animate-bounce">
                    <CheckCircle2 size={20} />
                  </div>
                  
                  <div className="text-center space-y-1.5">
                    <h4 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Node connection established</h4>
                    <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed max-w-xs mx-auto font-semibold">
                      API settings saved successfully. Dynamic models are now active inside the assistant creator.
                    </p>
                  </div>

                  <button 
                    onClick={() => setShowAddModal(false)}
                    className="w-full btn-primary h-10 text-xs font-semibold uppercase tracking-wider"
                  >
                    Enter workspace
                  </button>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default ProvidersPage;
