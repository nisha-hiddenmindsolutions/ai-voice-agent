import { useState, useEffect } from 'react';
import {
  BarChart3,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  TrendingUp,
  Activity,
  Users,
  CheckCircle2,
  Loader2,
  Phone,
  Zap,
} from 'lucide-react';
import { dashboardApi } from '../services/api';
import { motion } from 'framer-motion';

interface AnalyticsData {
  total_calls: number;
  total_minutes: number;
  avg_duration_seconds: number;
  success_rate: number;
  inbound_count: number;
  outbound_count: number;
  daily_volume: { date: string; count: number; inbound: number; outbound: number }[];
  agent_stats: { agent_id: string; agent_name: string; call_count: number; total_minutes: number }[];
  status_breakdown: Record<string, number>;
}

const AnalyticsPage = () => {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState(30);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      try {
        const resp = await dashboardApi.analytics(timeRange);
        setData(resp.data);
      } catch (err) {
        console.error('Failed to load analytics:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, [timeRange]);

  const maxVolume = data ? Math.max(...data.daily_volume.map(d => d.count), 1) : 1;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--text-muted)' }} />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto pb-24 animate-in fade-in duration-300 relative">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <BarChart3 size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)]">Analytics</h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 font-medium ml-[52px]">Performance insights and call metrics</p>
        </div>

        {/* Time Range Selector */}
        <div className="flex p-1 rounded-lg self-start md:self-auto bg-[var(--surface-secondary)]/20 border border-[var(--border)]">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setTimeRange(d)}
              className={`px-3 py-1 rounded text-xs font-bold transition-colors cursor-pointer ${
                timeRange === d 
                  ? 'bg-black text-white dark:bg-white dark:text-black' 
                  : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Calls" value={data?.total_calls?.toLocaleString() || '0'} icon={<Phone size={16} />} color="var(--primary)" trend={`${timeRange}d`} />
        <StatCard label="Total Minutes" value={`${data?.total_minutes?.toLocaleString() || '0'}m`} icon={<Clock size={16} />} color="#06B6D4" trend="Computed" />
        <StatCard label="Avg Duration" value={`${Math.round(data?.avg_duration_seconds || 0)}s`} icon={<Activity size={16} />} color="var(--info)" trend="Per call" />
        <StatCard label="Success Rate" value={`${data?.success_rate || 0}%`} icon={<CheckCircle2 size={16} />} color="var(--success)" trend="Connected" />
      </div>

      {/* MAIN */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* VOLUME CHART */}
        <div className="lg:col-span-2 card-shimmer p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                <BarChart3 size={15} style={{ color: 'var(--primary)' }} />
                Call Volume
              </h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Daily distribution — last {timeRange} days</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'rgba(59,130,246,0.6)' }} />
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Inbound</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'rgba(6,182,212,0.6)' }} />
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Outbound</span>
              </div>
            </div>
          </div>

          <div className="flex items-end gap-1 h-44">
            {(data?.daily_volume || []).map((day, i) => {
              const height = maxVolume > 0 ? (day.count / maxVolume) * 100 : 0;
              const inboundPct = day.count > 0 ? (day.inbound / day.count) * 100 : 0;
              return (
                <div key={i} className="flex-1 group/bar relative h-full flex items-end">
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: `${Math.max(height, 2)}%` }}
                    transition={{ duration: 0.5, delay: i * 0.02 }}
                    className="w-full rounded-md overflow-hidden relative transition-all"
                    style={{ border: '1px solid var(--border)' }}
                  >
                    <div className="absolute bottom-0 left-0 right-0" style={{ backgroundColor: 'rgba(59,130,246,0.35)', height: `${inboundPct}%` }} />
                    <div className="absolute top-0 left-0 right-0" style={{ backgroundColor: 'rgba(6,182,212,0.25)', height: `${100 - inboundPct}%` }} />
                  </motion.div>
                  <div className="invisible group-hover/bar:visible absolute -top-10 left-1/2 -translate-x-1/2 px-2 py-1 text-[10px] font-mono rounded-md whitespace-nowrap shadow-md z-10" style={{ backgroundColor: 'var(--card-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
                    <strong>{day.count}</strong> calls
                    <div style={{ color: 'var(--text-muted)' }}>{new Date(day.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* DIRECTION */}
        <div className="card-shimmer p-5 flex flex-col">
          <h2 className="text-sm font-semibold mb-5 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <TrendingUp size={15} style={{ color: 'var(--primary)' }} />
            Direction Breakdown
          </h2>

          <div className="flex-1 flex flex-col justify-center space-y-5">
            <div className="relative w-36 h-36 mx-auto">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" strokeWidth="8" />
                {data && data.total_calls > 0 && (
                  <>
                    <motion.circle cx="50" cy="50" r="40" fill="none" stroke="rgb(96, 165, 250)" strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${(data.inbound_count / data.total_calls) * 251.3} 251.3`}
                      initial={{ strokeDasharray: '0 251.3' }}
                      animate={{ strokeDasharray: `${(data.inbound_count / data.total_calls) * 251.3} 251.3` }}
                      transition={{ duration: 1 }}
                    />
                    <motion.circle cx="50" cy="50" r="40" fill="none" stroke="rgb(6, 182, 212)" strokeWidth="8" strokeLinecap="round"
                      strokeDasharray={`${(data.outbound_count / data.total_calls) * 251.3} 251.3`}
                      strokeDashoffset={`${-(data.inbound_count / data.total_calls) * 251.3}`}
                      initial={{ strokeDasharray: '0 251.3' }}
                      animate={{ strokeDasharray: `${(data.outbound_count / data.total_calls) * 251.3} 251.3` }}
                      transition={{ duration: 1, delay: 0.3 }}
                    />
                  </>
                )}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{data?.total_calls || 0}</span>
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Total</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2">
                  <PhoneIncoming size={13} style={{ color: 'var(--info)' }} />
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Inbound</span>
                </div>
                <span className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{data?.inbound_count || 0}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2">
                  <PhoneOutgoing size={13} style={{ color: '#06B6D4' }} />
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Outbound</span>
                </div>
                <span className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{data?.outbound_count || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AGENT PERF + STATUS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Users size={15} style={{ color: 'var(--primary)' }} />
            Agent Performance
          </h2>
          {(data?.agent_stats || []).length === 0 ? (
            <div className="py-8 text-center text-xs font-medium rounded-lg" style={{ border: '2px dashed var(--border)', color: 'var(--text-muted)' }}>No agent data yet</div>
          ) : (
            <div className="space-y-2">
              {(data?.agent_stats || []).map((agent, i) => {
                const maxCalls = Math.max(...(data?.agent_stats || []).map(a => a.call_count), 1);
                const barWidth = (agent.call_count / maxCalls) * 100;
                return (
                  <div key={i} className="p-3 rounded-lg transition-all" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{agent.agent_name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-mono font-medium" style={{ color: 'var(--text-secondary)' }}>{agent.call_count} calls</span>
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{agent.total_minutes}m</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: `${barWidth}%` }} transition={{ duration: 0.8, delay: i * 0.1 }}
                        className="h-full rounded-full" style={{ background: 'linear-gradient(to right, var(--primary), #06B6D4)' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Zap size={15} style={{ color: 'var(--primary)' }} />
            Status Distribution
          </h2>
          {Object.keys(data?.status_breakdown || {}).length === 0 ? (
            <div className="py-8 text-center text-xs font-medium rounded-lg" style={{ border: '2px dashed var(--border)', color: 'var(--text-muted)' }}>No status data yet</div>
          ) : (
            <div className="space-y-2">
              {Object.entries(data?.status_breakdown || {}).map(([status, count], i) => {
                const totalForStatus = Object.values(data?.status_breakdown || {}).reduce((a, b) => a + b, 0);
                const pct = totalForStatus > 0 ? Math.round((count / totalForStatus) * 100) : 0;
                const colorMap: Record<string, string> = {
                  completed: 'var(--success)', active: 'var(--info)', initiated: 'var(--warning)', 
                  connecting: '#EAB308', failed: 'var(--danger)', ended: 'var(--text-muted)',
                };
                return (
                  <div key={status} className="p-3 rounded-lg transition-all" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colorMap[status] || 'var(--text-muted)' }} />
                        <span className="text-xs font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>{status}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold font-mono" style={{ color: 'var(--text-primary)' }}>{count}</span>
                        <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>({pct}%)</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                      <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: i * 0.1 }}
                        className="h-full rounded-full" style={{ backgroundColor: colorMap[status] || 'var(--text-muted)' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon, color, trend }: any) => (
        <div className="card-shimmer stat-card-glow p-4 flex flex-col justify-between min-h-[120px]">
    <div className="flex items-center justify-between">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 4px 12px -2px ${color}40` }}>
        {icon}
      </div>
      <span className="badge text-[10px] py-0.5">{trend}</span>
    </div>
    <div className="mt-3">
      <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <h3 className="text-xl font-bold mt-0.5" style={{ color: 'var(--text-primary)' }}>{value}</h3>
    </div>
  </div>
);

export default AnalyticsPage;
