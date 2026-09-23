import { useState, useEffect } from 'react';
import { useAgentStore } from '../store/useAgentStore';
import { 
  Plus, 
  Play, 
  Clock, 
  BarChart3, 
  Activity,
  Phone,
  TrendingUp,
  Sparkles
} from 'lucide-react';
import { agentApi, sessionApi, dashboardApi } from '../services/api';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AgentAvatar } from '../components/AgentAvatar';

interface DashboardStats {
  computedMinutes: number;
  successfulCalls: number;
  callLatency: string;
  tokenBurn: string;
}

const DashboardPage = () => {
  const { agents, setActiveSession } = useAgentStore();
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const navigate = useNavigate();
  
  useEffect(() => {
    const loadData = async () => {
      try {
        const [agentsRes, statsRes] = await Promise.all([
          agentApi.list(),
          dashboardApi.stats()
        ]);
        useAgentStore.getState().setAgents(agentsRes.data);
        setStats(statsRes.data);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  const handleQuickLaunch = async (agent: any) => {
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

  return (
    <div className="max-w-[1400px] mx-auto pb-24 font-sans relative">

      {/* HERO HEADER */}
      <motion.div 
        initial={{ opacity: 0, y: 20 }} 
        animate={{ opacity: 1, y: 0 }} 
        transition={{ duration: 0.5 }}
        className="flex flex-col md:flex-row md:justify-between md:items-end gap-4 mb-10 relative z-10"
      >
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <Sparkles size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)]">Dashboard</h1>
          </div>
          <p className="text-sm text-[var(--text-muted)] font-medium ml-[52px]">Overview of your voice agents and performance metrics.</p>
        </div>

        <button 
          onClick={() => navigate('/agents/create')}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer self-start md:self-auto btn-shine active:scale-[0.97]"
          style={{
            backgroundColor: 'var(--primary)',
            color: '#fff',
            boxShadow: '0 4px 14px -3px rgba(79, 70, 229, 0.4)'
          }}
        >
          <Plus size={14} />
          Create Agent
        </button>
      </motion.div>

      {/* STATS GRID */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10 relative z-10">
        {[
          { label: "Total Minutes", value: stats?.computedMinutes?.toLocaleString() || "0", change: "+12.5%", icon: <Clock size={20} />, gradient: "linear-gradient(135deg, #4F46E5, #6366F1)", shadow: "rgba(79, 70, 229, 0.25)" },
          { label: "Successful Calls", value: stats?.successfulCalls?.toLocaleString() || "0", change: "+8.2%", icon: <Phone size={20} />, gradient: "linear-gradient(135deg, #10B981, #06D6A0)", shadow: "rgba(16, 185, 129, 0.25)" },
          { label: "Avg Latency", value: stats?.callLatency || "0ms", change: "-14ms", icon: <Activity size={20} />, gradient: "linear-gradient(135deg, #8B5CF6, #A78BFA)", shadow: "rgba(139, 92, 246, 0.25)" },
          { label: "Token Cost", value: stats?.tokenBurn || "$0.00", change: "+$2.40", icon: <BarChart3 size={20} />, gradient: "linear-gradient(135deg, #F59E0B, #FBBF24)", shadow: "rgba(245, 158, 11, 0.25)" },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
          >
            <StatCard {...stat} />
          </motion.div>
        ))}
      </div>

      {/* MAIN CONTENT */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8 relative z-10">
        
        {/* ACTIVE AGENTS */}
        <motion.div 
          className="lg:col-span-2 space-y-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Active Agents</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)', border: '1px solid var(--badge-border)' }}>{agents.length}</span>
            </div>
          </div>
          
          <div className="space-y-3">
            {isLoading ? (
              [1, 2, 3].map(i => (
                <div key={i} className="h-20 rounded-xl skeleton" />
              ))
            ) : agents.length > 0 ? (
              agents.slice(0, 4).map((agent, idx) => (
                <motion.div 
                  key={agent.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.06 }}
                  onClick={() => navigate(`/agent/${agent.id}/overview`)}
                  className="card-shimmer p-4 flex items-center justify-between group cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <AgentAvatar name={agent.agentName} agent={agent} className="w-10 h-10 text-lg shadow-sm" />
                    <div>
                      <h4 className="text-sm font-bold text-[var(--text-primary)] group-hover:text-[var(--primary)] transition-colors">{agent.agentName}</h4>
                      <p className="text-xs mt-0.5 font-medium text-[var(--text-muted)]">
                        {agent.llm?.model ? agent.llm.model.substring(0, 20) : 'Default model'} &bull; {agent.language}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden sm:flex flex-col items-end">
                      <div className="flex items-center gap-1.5 bg-[var(--success)]/10 px-2.5 py-1 rounded-full border border-[var(--success)]/20">
                         <div className="w-1.5 h-1.5 rounded-full bg-[var(--success)] live-indicator" />
                         <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--success)]">Active</span>
                      </div>
                      <span className="text-[10px] font-mono mt-1 font-semibold text-[var(--text-muted)]">ID: {agent.id.slice(0, 8)}</span>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleQuickLaunch(agent); }}
                      className="w-9 h-9 rounded-xl flex items-center justify-center border border-[var(--border)] bg-[var(--surface)] text-[var(--success)] hover:bg-[var(--success)]/10 hover:border-[var(--success)]/30 transition-all active:scale-90"
                      title="Launch Session"
                    >
                      <Play size={12} fill="currentColor" strokeWidth={0} />
                    </button>
                  </div>
                </motion.div>
              ))
            ) : (
              <div 
                className="p-12 rounded-xl text-center relative overflow-hidden"
                style={{ border: '2px dashed var(--border)' }}
              >
                <div className="absolute inset-0 mesh-gradient-bg opacity-50" />
                <div className="relative z-10">
                  <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center animate-gradient-shift" style={{ background: 'linear-gradient(135deg, var(--primary), #8B5CF6)' }}>
                    <Plus size={20} className="text-white" />
                  </div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>No agents configured yet</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Create your first voice agent to get started</p>
                  <button 
                    onClick={() => navigate('/agents/create')}
                    className="mt-4 btn-primary text-xs btn-shine"
                  >
                    Create Your First Agent
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* ACTIVITY LOG */}
        <motion.div 
          className="space-y-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Recent Activity</h3>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full" style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
              <span className="w-2 h-2 rounded-full live-indicator" style={{ backgroundColor: 'var(--success)' }} />
              <span className="text-[10px] font-bold text-[var(--success)]">Live</span>
            </div>
          </div>
          
          <div className="card-shimmer p-4 flex flex-col justify-between min-h-[300px] font-mono text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            <div className="space-y-3">
              {[
                { time: '16:59:10', tag: 'sys', msg: 'Secured AES-256 connection...', color: 'var(--primary)' },
                { time: '16:59:12', tag: 'gate', msg: 'Sarvam websocket validated.', color: 'var(--info)' },
                { time: '16:59:15', tag: 'route', msg: 'OpenRouter fallback active.', color: '#8B5CF6' },
                { time: '16:59:22', tag: 'compute', msg: 'Token rate: 0.0031 tok/s', color: 'var(--warning)', muted: true },
                { time: '16:59:30', tag: 'agent', msg: 'Connected successfully', color: 'var(--success)', highlight: true },
              ].map((log, i) => (
                <motion.div 
                  key={i} 
                  className="flex gap-2.5"
                  initial={{ opacity: 0, x: -5 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.5 + i * 0.08 }}
                >
                  <span style={{ color: 'var(--text-muted)' }}>{log.time}</span>
                  <span className="font-bold" style={{ color: log.color }}>[{log.tag}]</span>
                  <span className={log.highlight ? 'font-bold' : ''} style={{ color: log.highlight ? 'var(--success)' : log.muted ? 'var(--text-muted)' : undefined }}>
                    {log.msg}
                  </span>
                </motion.div>
              ))}
            </div>
            
            <div className="pt-3 flex items-center justify-between text-[11px] mt-4" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              <span>System Status</span>
              <span className="font-bold flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] live-indicator" />
                All Systems Operational
              </span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* CALL VOLUME CHART */}
      <motion.div 
        className="card-shimmer p-6 flex flex-col relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <BarChart3 size={15} style={{ color: 'var(--primary)' }} />
              Call Volume
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Weekly agent call bandwidth</p>
          </div>
          <span className="badge text-[11px]">7 day window</span>
        </div>
        
        <div className="flex-1 flex items-end gap-3 h-36 px-2">
          {[40, 65, 30, 85, 45, 78, 55].map((h, i) => (
            <div key={i} className="flex-1 group/bar relative h-full flex items-end">
              <motion.div 
                initial={{ height: 0 }}
                animate={{ height: `${h}%` }}
                transition={{ duration: 0.6, delay: 0.6 + i * 0.05 }}
                className="w-full rounded-lg transition-all duration-300 group-hover/bar:opacity-90"
                style={{ 
                  background: `linear-gradient(to top, var(--primary), #8B5CF6)`,
                  opacity: 0.15 + (h / 150),
                  border: '1px solid rgba(79, 70, 229, 0.15)' 
                }}
              />
              <div 
                className="invisible group-hover/bar:visible absolute -top-8 left-1/2 -translate-x-1/2 px-2.5 py-1 text-[11px] font-mono rounded-lg whitespace-nowrap shadow-lg z-10"
                style={{ 
                  backgroundColor: 'var(--card-bg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)' 
                }}
              >
                Day {i + 1}: <strong>{h}m</strong>
              </div>
            </div>
          ))}
        </div>
        
        <div className="mt-6 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="flex flex-col">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Daily Average</span>
            <span className="text-base font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
              54.2m <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>tokens</span>
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Total Usage</span>
            <span className="text-base font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>
              380m <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>tokens</span>
            </span>
          </div>
        </div>
      </motion.div>

    </div>
  );
};

const StatCard = ({ label, value, change, icon, gradient, shadow }: any) => (
  <div 
    className="card-shimmer stat-card-glow p-5 flex flex-col justify-between min-h-[155px] relative overflow-hidden"
  >
    {/* Background glow */}
    <div 
      className="absolute -right-8 -bottom-8 w-28 h-28 rounded-full blur-3xl opacity-15 pointer-events-none"
      style={{ background: gradient }}
    />
    
    <div className="flex items-center justify-between relative z-10">
      <div 
        className="w-11 h-11 rounded-xl flex items-center justify-center text-white shadow-lg"
        style={{ 
          background: gradient,
          boxShadow: `0 4px 14px -2px ${shadow}`
        }}
      >
        {icon}
      </div>
      <div className="flex items-center gap-1 px-2.5 py-1 rounded-full" style={{ backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.15)' }}>
        <TrendingUp size={11} style={{ color: 'var(--success)' }} />
        <span className="text-[10px] font-bold" style={{ color: 'var(--success)' }}>
          {change}
        </span>
      </div>
    </div>
    <div className="mt-4 relative z-10">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">{label}</p>
      <h3 className="text-2xl font-extrabold mt-1 tracking-tight text-[var(--text-primary)]">{value}</h3>
    </div>
  </div>
);

export default DashboardPage;
