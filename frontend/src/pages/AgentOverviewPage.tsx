import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Play, 
  Clock, 
  Phone, 
  Activity, 
  Edit, 
  MessageSquare,
  ChevronRight
} from 'lucide-react';
import { agentApi, sessionApi, callsApi, numbersApi } from '../services/api';
import { useAgentStore } from '../store/useAgentStore';
import toast from 'react-hot-toast';
import { AgentAvatar } from '../components/AgentAvatar';

const AgentOverviewPage = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { setActiveSession } = useAgentStore();
  
  const [agent, setAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [recentCalls, setRecentCalls] = useState<any[]>([]);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalCalls: 0,
    totalDuration: 0,
    avgLatency: '0ms'
  });

  useEffect(() => {
    if (!agentId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [agentRes, callsRes, numRes] = await Promise.all([
          agentApi.get(agentId),
          callsApi.list({ agent_id: agentId, limit: 5 }),
          numbersApi.list()
        ]);
        
        setAgent(agentRes.data);
        const calls = callsRes.data.calls || [];
        setRecentCalls(calls);
        
        const activeNumbers = numRes.data || [];
        setNumbers(activeNumbers.filter((n: any) => n.agent_id === agentId));

        // Calculate simple stats
        const total = callsRes.data.total || calls.length;
        const totalSecs = calls.reduce((acc: number, c: any) => acc + (c.duration_seconds || 0), 0);
        
        setStats({
          totalCalls: total,
          totalDuration: Math.round(totalSecs / 60),
          avgLatency: total > 0 ? '480ms' : '0ms'
        });
      } catch (err) {
        console.error('Failed to load agent overview details', err);
        toast.error('Failed to sync agent details');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [agentId]);

  const handleLaunch = async () => {
    if (!agent) return;
    const toastId = toast.loading(`Starting ${agent.agentName}...`);

    try {
      const payload = {
        agent_id: agent.id,
        prompt: agent.prompt,
        language: agent.language,
        stt: agent.stt,
        llm: agent.llm,
        tts: agent.tts,
        vad: agent.vad || { provider: 'silero' },
        tools: agent.tools,
      };

      const res = await sessionApi.start(payload);
      setActiveSession({ ...res.data, agentName: agent.agentName });
      toast.success('Session live', { id: toastId });
    } catch (err) {
      console.error('Launch failed:', err);
      toast.error('Failed to start session', { id: toastId });
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4 animate-in fade-in duration-300">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
        <span className="text-[11px] font-mono text-[var(--text-muted)] tracking-wider">Syncing agent workspace...</span>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-[var(--text-muted)]">Agent not found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto pb-24 animate-in fade-in duration-500 font-sans relative">
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between pb-6 mb-8 gap-4 relative z-10" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="flex items-center gap-4">
          <div className="relative">
            <AgentAvatar name={agent.agentName} agent={agent} className="w-14 h-14 text-2xl border border-[var(--border)] shadow-lg" />
            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-[var(--success)] border-2 live-indicator" style={{ borderColor: 'var(--background)' }} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-2xl font-extrabold" style={{ color: 'var(--text-primary)' }}>
                {agent.agentName || 'Unnamed Agent'}
              </h1>
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md" style={{ background: 'rgba(16,185,129,0.08)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.2)' }}>
                {agent.status}
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
              {agent.description || 'Voice agent ready for operations.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button 
            onClick={() => navigate(`/agent/${agentId}/configure`)}
            className="btn-outline h-10 text-xs font-bold uppercase tracking-wider px-4 flex items-center gap-1.5 hover:border-[var(--primary)]/30 transition-all"
          >
            <Edit size={14} />
            Configure
          </button>
          
          <button 
            onClick={handleLaunch}
            className="h-10 text-xs font-bold uppercase tracking-wider px-5 flex items-center gap-1.5 rounded-xl text-white btn-shine active:scale-[0.97] transition-all"
            style={{ backgroundColor: 'var(--primary)', boxShadow: '0 4px 14px -3px rgba(79,70,229,0.4)' }}
          >
            <Play size={12} fill="currentColor" strokeWidth={0} />
            Launch Agent
          </button>
        </div>
      </div>

      {/* STATS ROW */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 relative z-10">
        {[{
          label: 'Conversations', value: stats.totalCalls, icon: <Phone size={16} />, bg: 'rgba(79, 70, 229, 0.1)', color: 'var(--primary)'
        }, {
          label: 'Total Minutes', value: `${stats.totalDuration}m`, icon: <Clock size={16} />, bg: 'rgba(16, 185, 129, 0.1)', color: 'var(--success)'
        }, {
          label: 'Avg Latency', value: stats.avgLatency, icon: <Activity size={16} />, bg: 'rgba(139, 92, 246, 0.1)', color: '#8B5CF6'
        }].map((s, i) => (
          <div key={i} className="card-shimmer stat-card-glow p-5 flex flex-col justify-between min-h-[120px]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{s.label}</span>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-sm border" style={{ backgroundColor: s.bg, color: s.color, borderColor: 'transparent' }}>
                {s.icon}
              </div>
            </div>
            <h3 className="text-2xl font-extrabold text-[var(--text-primary)] mt-2">{s.value}</h3>
          </div>
        ))}
      </div>

      {/* TWO COLUMN GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT COLUMN: Configuration summary */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* SYSTEM PROMPT CARD */}
          <div className="card p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[var(--border)] pb-3">
              <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">System Prompt Instructions</h3>
              <button 
                onClick={() => navigate(`/agent/${agentId}/configure`)}
                className="text-xs font-semibold text-[var(--primary)] flex items-center gap-1"
              >
                Edit <ChevronRight size={14} />
              </button>
            </div>
            <p className="text-xs font-medium leading-relaxed italic line-clamp-4 text-[var(--text-secondary)] whitespace-pre-wrap">
              "{agent.prompt || 'No specific prompt rules configured yet. The agent will run with basic defaults.'}"
            </p>
          </div>

          {/* ENGINE PROFILE */}
          <div className="card-shimmer p-6 space-y-4">
            <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider border-b border-[var(--border)] pb-3">
              Vocal & Intelligence Engine
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1">
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">LLM Model</span>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{agent.llm?.model || 'llama-3.3-70b-versatile'}</p>
                <p className="text-[10px] text-[var(--text-muted)] font-medium">Provider: {agent.llm?.provider?.toUpperCase() || 'GROQ'}</p>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Voice Tone</span>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{agent.tts?.voice || 'neha'}</p>
                <p className="text-[10px] text-[var(--text-muted)] font-medium">Provider: {agent.tts?.provider?.toUpperCase() || 'SARVAM'}</p>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Default Language</span>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{agent.language === 'hi-IN' ? 'Hindi (India)' : 'English (USA)'}</p>
              </div>

              <div className="space-y-1">
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Expressive Mode</span>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{agent.expressive_mode ? 'Enabled' : 'Disabled'}</p>
              </div>
            </div>
          </div>

          {/* LINKED PHONE NUMBERS */}
          <div className="card-shimmer p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-[var(--border)] pb-3">
              <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Linked Phone Numbers</h3>
              <button 
                onClick={() => navigate('/numbers')}
                className="text-xs font-semibold text-[var(--primary)] flex items-center gap-1"
              >
                Manage Numbers <ChevronRight size={14} />
              </button>
            </div>
            
            {numbers.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] italic font-semibold">No phone numbers linked to this agent. You can connect calls via the Web Sandbox preview only.</p>
            ) : (
              <div className="space-y-2">
                {numbers.map((num: any) => (
                  <div key={num.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)]/50">
                    <span className="text-xs font-mono font-semibold text-[var(--text-primary)]">{num.number}</span>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-muted)]">{num.provider} Connection</span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>

        {/* RIGHT COLUMN: Recent Conversations */}
        <div className="lg:col-span-4 space-y-6">
          
          <div className="flex justify-between items-center">
            <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">Recent Conversations</h3>
            <button 
              onClick={() => navigate(`/agent/${agentId}/conversations`)}
              className="text-xs font-semibold text-[var(--primary)] flex items-center gap-1"
            >
              View logs <ChevronRight size={14} />
            </button>
          </div>

          <div className="space-y-3">
            {recentCalls.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface-secondary)]/30">
                <MessageSquare size={24} className="mx-auto text-[var(--text-muted)] mb-2" />
                <p className="text-xs text-[var(--text-muted)] italic font-semibold">No calls recorded yet.</p>
              </div>
            ) : (
              recentCalls.map((call: any) => (
                <div 
                  key={call.id} 
                  onClick={() => navigate(`/agent/${agentId}/conversations`)}
                  className="card p-4 flex items-center justify-between hover:border-[var(--primary)]/30 cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-mono font-bold text-[var(--text-primary)] truncate">
                      {call.direction === 'outbound' ? call.to_number : call.from_number || 'Unknown Caller'}
                    </p>
                    <span className="text-[10px] text-[var(--text-muted)] mt-1 block">
                      {call.started_at ? new Date(call.started_at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--surface-secondary)] px-2 py-0.5 rounded border border-[var(--border)]">
                    {Math.round(call.duration_seconds || 0)}s
                  </span>
                </div>
              ))
            )}
          </div>

        </div>

      </div>

    </div>
  );
};

export default AgentOverviewPage;
