import React, { useState, useEffect } from 'react';
import { Key, ShieldCheck, Save, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { BackButton } from '../components/BackButton';

export const KeysPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Mask toggle states
  const [showGroq, setShowGroq] = useState(false);
  const [showCerebras, setShowCerebras] = useState(false);
  const [showOpenAI, setShowOpenAI] = useState(false);
  const [showOpenRouter, setShowOpenRouter] = useState(false);
  const [showDeepgram, setShowDeepgram] = useState(false);
  const [showSarvam, setShowSarvam] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    groq_key: '',
    cerebras_key: '',
    openai_key: '',
    openrouter_key: '',
    deepgram_key: '',
    sarvam_key: ''
  });

  // Display metadata (keys returned from GET are masked)
  const [maskedKeys, setMaskedKeys] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    fetchKeys();
  }, []);

  const fetchKeys = async () => {
    try {
      const resp = await api.get('/keys/');
      const data = resp.data;
      setFormData({
        groq_key: '',
        cerebras_key: '',
        openai_key: '',
        openrouter_key: '',
        deepgram_key: '',
        sarvam_key: ''
      });
      setMaskedKeys(data.keys || {});
    } catch (err) {
      toast.error('Failed to sync BYOK credentials from registry');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const toastId = toast.loading('Synchronizing secure credential profiles...');
    try {
      await api.post('/keys/', {
        groq_key: formData.groq_key.trim() || undefined,
        cerebras_key: formData.cerebras_key.trim() || undefined,
        openai_key: formData.openai_key.trim() || undefined,
        openrouter_key: formData.openrouter_key.trim() || undefined,
        deepgram_key: formData.deepgram_key.trim() || undefined,
        sarvam_key: formData.sarvam_key.trim() || undefined
      });
      toast.success('BYOK profiles updated successfully!', { id: toastId });
      fetchKeys(); // Refresh key hints
    } catch (err) {
      toast.error('Failed to sync credentials', { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <div className="w-8 h-8 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Loading Secure Vault...</span>
      </div>
    );
  }

  const providers = [
    {
      id: 'openrouter',
      name: 'OpenRouter API',
      tag: 'LLM Multi-Provider',
      desc: 'Access hundreds of LLMs (Claude, GPT-4o, DeepSeek, Mistral) through a single unified endpoint.',
      show: showOpenRouter,
      setShow: setShowOpenRouter,
      keyName: 'openrouter_key',
      placeholder: 'sk-or-v1-...'
    },
    {
      id: 'openai',
      name: 'OpenAI Platform',
      tag: 'LLM & TTS',
      desc: 'Powers GPT-4o, GPT-4o Mini, and high-fidelity OpenAI TTS vocal synthesis.',
      show: showOpenAI,
      setShow: setShowOpenAI,
      keyName: 'openai_key',
      placeholder: 'sk-proj-...'
    },
    {
      id: 'groq',
      name: 'Groq Cloud',
      tag: 'LLM & STT',
      desc: 'Powers instant LLaMA & Mistral models alongside Groq Whisper audio transcription.',
      show: showGroq,
      setShow: setShowGroq,
      keyName: 'groq_key',
      placeholder: 'gsk_...'
    },
    {
      id: 'cerebras',
      name: 'Cerebras LLaMA',
      tag: 'LLM',
      desc: 'Powers extreme inference speeds for LLaMA 3.1 & 3.3 models.',
      show: showCerebras,
      setShow: setShowCerebras,
      keyName: 'cerebras_key',
      placeholder: 'csk-...'
    },
    {
      id: 'deepgram',
      name: 'Deepgram',
      tag: 'STT',
      desc: 'Powers low-latency, hyper-accurate Nova-2 audio speech-to-text.',
      show: showDeepgram,
      setShow: setShowDeepgram,
      keyName: 'deepgram_key',
      placeholder: 'Insert Deepgram Key'
    },
    {
      id: 'sarvam',
      name: 'Sarvam AI',
      tag: 'STT & TTS',
      desc: 'Powers multilingual Sarvam STT and high-quality Indian regional TTS voices (Bulbul).',
      show: showSarvam,
      setShow: setShowSarvam,
      keyName: 'sarvam_key',
      placeholder: 'Insert Sarvam API Key'
    }
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-4">
          <BackButton fallbackPath="/" label="Back" />
          <div className="space-y-1">
            <h1 className="text-xl md:text-2xl font-bold text-zinc-100 uppercase tracking-wider leading-tight">BYOK Provider Keys</h1>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(0,149,255,0.4)] animate-pulse" />
              <p className="text-zinc-500 text-xs font-bold uppercase tracking-wider leading-none">Bring Your Own Key Dashboard</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center md:justify-end gap-3 px-4 h-10 bg-zinc-900/10 border border-zinc-800 rounded-xl w-full md:w-auto">
          <ShieldCheck size={14} className="text-emerald-500 glow-accent" />
          <p className="text-xs font-bold text-zinc-100 uppercase tracking-wider leading-none">AES-256 GCM Secure Vault</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SECURE SIDEBAR TIP */}
        <div className="lg:col-span-1 space-y-6">
          <div className="card-vapi !p-6 flex flex-col gap-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Key size={18} />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Vault Security</h3>
              <p className="text-xs text-zinc-500 leading-relaxed font-semibold">
                Your keys are immediately encrypted at rest using high-grade symmetric wrappers. The dashboard decrypts key hashes only in memory during call execution, and <span className="text-primary font-bold">never</span> exposes the raw API key back to any UI.
              </p>
            </div>
            <div className="p-3.5 bg-zinc-900/10 border border-zinc-800 rounded-xl flex items-start gap-2.5">
              <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-500 leading-normal font-semibold">
                Leave key fields empty to keep your existing configured keys or default back to system keys.
              </p>
            </div>
          </div>
        </div>

        {/* BYOK CONFIGURATION FORM */}
        <form onSubmit={handleSave} className="lg:col-span-2 space-y-6">
          {providers.map((p) => {
            const hasKey = !!maskedKeys[p.keyName];
            return (
              <div key={p.id} className="card-vapi !p-6 space-y-4 hover:border-zinc-700 transition-colors duration-300">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <div className="space-y-0.5">
                    <span className="text-[8px] font-black text-primary uppercase tracking-[0.2em]">{p.tag}</span>
                    <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">{p.name}</h3>
                  </div>
                  {hasKey && (
                    <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 uppercase tracking-wider bg-emerald-500/5 px-2.5 py-1 rounded-lg border border-emerald-500/10">
                      <CheckCircle size={10} />
                      <span>Key Loaded ({maskedKeys[p.keyName]})</span>
                    </div>
                  )}
                </div>

                <p className="text-xs text-zinc-500 leading-relaxed font-semibold">{p.desc}</p>

                <div className="space-y-1.5 relative mt-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider ml-1">API Key Config</label>
                  <div className="relative">
                    <input 
                      type={p.show ? 'text' : 'password'}
                      value={formData[p.keyName as keyof typeof formData]}
                      onChange={e => setFormData({ ...formData, [p.keyName]: e.target.value })}
                      className="input-vapi w-full h-11 text-[11px] font-semibold pr-10"
                      placeholder={hasKey ? "••••••••••••••••" : p.placeholder}
                    />
                    <button 
                      type="button"
                      onClick={() => p.setShow(!p.show)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                    >
                      {p.show ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* SUBMIT BUTTON */}
          <button 
            type="submit"
            disabled={saving}
            className="w-full h-12 bg-primary hover:bg-primary/95 text-xs font-bold text-on-primary uppercase tracking-widest rounded-xl flex items-center justify-center gap-2 hover:shadow-[0_0_20px_rgba(0,102,255,0.25)] border border-primary/20 transition-all duration-300 disabled:opacity-55"
          >
            <Save size={14} />
            <span>{saving ? 'Synchronizing BYOK Profile...' : 'Save Keys Configuration'}</span>
          </button>
        </form>
      </div>
    </div>
  );
};
