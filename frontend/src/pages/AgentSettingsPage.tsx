import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Trash2, 
  Check, 
  Info
} from 'lucide-react';
import { agentApi } from '../services/api';
import { useAgentStore } from '../store/useAgentStore';
import toast from 'react-hot-toast';
import { DecommissionModal } from '../components/DecommissionModal';

const AgentSettingsPage = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { setAgents } = useAgentStore();

  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const [formData, setFormData] = useState<any>({
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
    if (!agentId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const resp = await agentApi.get(agentId);
        setAgent(resp.data);
        setFormData(resp.data);
      } catch (err) {
        console.error('Failed to load agent settings data:', err);
        toast.error('Failed to sync agent settings');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [agentId]);

  const handleSave = async () => {
    if (!formData.agentName.trim()) return toast.error("Agent name required");
    
    setIsSaving(true);
    const toastId = toast.loading("Saving settings...");
    
    try {
      const resp = await agentApi.createOrUpdate({ ...formData, id: agentId });
      setAgent(resp.data);
      setFormData(resp.data);

      const resList = await agentApi.list();
      setAgents(resList.data);
      
      toast.success("Settings updated successfully", { id: toastId });
    } catch (err) {
      console.error('Failed to save settings:', err);
      toast.error("Failed to update agent settings", { id: toastId });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!agentId) return;
    setIsDeleting(true);
    const toastId = toast.loading(`Deleting ${agent.agentName}...`);

    try {
      await agentApi.delete(agentId);
      toast.success(`${agent.agentName} deleted`, { id: toastId });
      setShowDeleteModal(false);

      const resList = await agentApi.list();
      setAgents(resList.data);

      navigate('/agents');
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('Failed to delete agent', { id: toastId });
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4 animate-in fade-in duration-300">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
        <span className="text-[11px] font-mono text-[var(--text-muted)] tracking-wider">Syncing settings workspace...</span>
      </div>
    );
  }

  return (
    <div className="max-w-[1000px] mx-auto pb-24 animate-in fade-in duration-500 font-sans">
      
      {/* HEADER */}
      <div className="flex items-center justify-between border-b border-[var(--border)] pb-6 mb-8">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Settings & Advanced
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Calibrate speech-detection VAD triggers and manage agent status lifecycles.
          </p>
        </div>

        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="btn-primary h-10 text-xs font-bold uppercase tracking-wider px-5 shadow-sm flex items-center gap-1.5"
        >
          <Check size={14} />
          Save Settings
        </button>
      </div>

      <div className="space-y-6">
        
        {/* IDENTITY */}
        <div className="card p-6 space-y-4">
          <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider border-b border-[var(--border)] pb-3">
            Agent Profile Profile
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 flex-1 min-w-0">
              <label className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Agent Name</label>
              <input 
                value={formData.agentName} 
                onChange={e => setFormData({ ...formData, agentName: e.target.value })} 
                className="input-field" 
                placeholder="e.g. Concierge AI" 
              />
            </div>

            <div className="space-y-1.5 flex-1 min-w-0">
              <label className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Description</label>
              <input 
                value={formData.description} 
                onChange={e => setFormData({ ...formData, description: e.target.value })} 
                className="input-field" 
                placeholder="Brief summary of agent scope..." 
              />
            </div>
          </div>
        </div>

        {/* VAD SETTINGS */}
        <div className="card p-6 space-y-6">
          <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
            <div>
              <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Audio Signal Processing</h3>
              <p className="text-[10px] text-[var(--text-secondary)] mt-0.5">Calibrate connection latency and noise thresholds.</p>
            </div>
            <span className="px-2.5 py-0.5 border border-emerald-500/20 bg-emerald-500/10 text-[var(--success)] text-[9px] rounded font-bold uppercase tracking-wider leading-none">Advanced Audio</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
            <SensitivitySlider 
              label="Activation Threshold" 
              value={formData.vad.activation_threshold} 
              min={0.1} 
              max={0.9} 
              step={0.05} 
              onChange={(v: number) => setFormData({...formData, vad: {...formData.vad, activation_threshold: v}})} 
              sub="VAD threshold detection floor." 
            />
            <SensitivitySlider 
              label="Speech Resilience" 
              value={formData.vad.min_speech_duration} 
              min={0.05} 
              max={1.0} 
              step={0.05} 
              onChange={(v: number) => setFormData({...formData, vad: {...formData.vad, min_speech_duration: v}})} 
              sub="Minimum sound duration floor." 
            />
            <SensitivitySlider 
              label="Silence Tolerance" 
              value={formData.vad.min_silence_duration} 
              min={0.1} 
              max={3.0} 
              step={0.1} 
              onChange={(v: number) => setFormData({...formData, vad: {...formData.vad, min_silence_duration: v}})} 
              sub="Delay buffer before speaker changes." 
            />
            <SensitivitySlider 
              label="Signal Padding" 
              value={formData.vad.padding_duration} 
              min={0.05} 
              max={1.0} 
              step={0.05} 
              onChange={(v: number) => setFormData({...formData, vad: {...formData.vad, padding_duration: v}})} 
              sub="Padding border boundaries." 
            />
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

        {/* DANGER ZONE */}
        <div className="card border-red-500/20 bg-red-500/5 p-6 space-y-4">
          <h3 className="text-xs font-bold text-red-500 uppercase tracking-wider border-b border-red-500/10 pb-3">
            Danger Zone
          </h3>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            Decommissioning this agent completely wipes its prompt guidelines, configurations, and records from the live gateway registry. This action is irreversible.
          </p>
          <button 
            onClick={() => setShowDeleteModal(true)}
            className="h-10 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 border border-red-600"
          >
            <Trash2 size={14} />
            Decommission Agent
          </button>
        </div>

      </div>

      <DecommissionModal 
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
        title="Delete Agent"
        itemName={agent?.agentName || ''}
        loading={isDeleting}
      />

    </div>
  );
};

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

export default AgentSettingsPage;
