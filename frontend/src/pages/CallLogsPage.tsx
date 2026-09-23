import { useState, useEffect } from 'react';
import {
  History,
  PhoneIncoming,
  PhoneOutgoing,
  Clock,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Filter,
  Search,
  Loader2,
  Phone,
  CheckCircle2,
  XCircle,
  Zap,
  User,
  Bot,
  X,
} from 'lucide-react';
import { callsApi } from '../services/api';
import { Select } from '../components/ui/Select';

interface CallRecord {
  id: string;
  session_id: string;
  agent_id: string;
  agent_name: string;
  from_number: string;
  to_number: string;
  direction: string;
  status: string;
  duration_seconds: number;
  tokens_used: number;
  started_at: string;
  ended_at: string | null;
  transcript_count: number;
}

interface Transcript {
  role: string;
  content: string;
  timestamp: string;
}

const statusConfig: Record<string, { color: string; bgVar: string; icon: any }> = {
  completed: { color: 'var(--success)', bgVar: 'rgba(16,185,129,0.08)', icon: CheckCircle2 },
  active: { color: 'var(--info)', bgVar: 'rgba(59,130,246,0.08)', icon: Zap },
  initiated: { color: 'var(--primary)', bgVar: 'rgba(37,99,235,0.08)', icon: Phone },
  connecting: { color: 'var(--primary)', bgVar: 'rgba(37,99,235,0.08)', icon: Phone },
  failed: { color: 'var(--danger)', bgVar: 'rgba(239,68,68,0.08)', icon: XCircle },
  ended: { color: 'var(--text-muted)', bgVar: 'rgba(100,116,139,0.08)', icon: CheckCircle2 },
};

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds === 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const CallLogsPage = () => {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [loadingTranscripts, setLoadingTranscripts] = useState(false);
  
  const [directionFilter, setDirectionFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const fetchCalls = async () => {
    setLoading(true);
    try {
      const params: any = { limit: 50, offset: 0, days: 90 };
      if (directionFilter) params.direction = directionFilter;
      if (statusFilter) params.status = statusFilter;
      
      const resp = await callsApi.list(params);
      setCalls(resp.data.calls || []);
      setTotal(resp.data.total || 0);
    } catch (err) {
      console.error('Failed to fetch calls:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
  }, [directionFilter, statusFilter]);

  const handleExpandCall = async (callId: string) => {
    if (expandedCallId === callId) {
      setExpandedCallId(null);
      setTranscripts([]);
      return;
    }
    setExpandedCallId(callId);
    setLoadingTranscripts(true);
    try {
      const resp = await callsApi.detail(callId);
      setTranscripts(resp.data.transcripts || []);
    } catch (err) {
      console.error('Failed to fetch transcripts:', err);
      setTranscripts([]);
    } finally {
      setLoadingTranscripts(false);
    }
  };

  const filteredCalls = searchQuery
    ? calls.filter(c =>
        c.to_number?.includes(searchQuery) ||
        c.from_number?.includes(searchQuery) ||
        c.agent_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.session_id?.includes(searchQuery)
      )
    : calls;

  return (
    <div className="max-w-[1400px] mx-auto pb-24 animate-in fade-in duration-300 relative">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 relative z-10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <History size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)]">Call Logs</h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 font-medium ml-[52px]">{total} total call records logged</p>
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 border border-[var(--border)] hover:bg-[var(--surface-secondary)] text-[var(--text-primary)] px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer self-start md:self-auto"
        >
          <Filter size={13} />
          Filters
          {(directionFilter || statusFilter) && (
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />
          )}
        </button>
      </div>

      {/* FILTERS */}
      {showFilters && (
        <div className="mb-6 card p-4 animate-in fade-in duration-200">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
              <input
                className="input-field pl-9"
                placeholder="Search numbers, agents..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>
            
            <Select
              value={directionFilter}
              onChange={val => setDirectionFilter(val)}
              options={[
                { value: '', label: 'All Directions' },
                { value: 'inbound', label: 'Inbound' },
                { value: 'outbound', label: 'Outbound' }
              ]}
            />
            
            <Select
              value={statusFilter}
              onChange={val => setStatusFilter(val)}
              options={[
                { value: '', label: 'All Statuses' },
                { value: 'completed', label: 'Completed' },
                { value: 'active', label: 'Active' },
                { value: 'initiated', label: 'Initiated' },
                { value: 'failed', label: 'Failed' }
              ]}
            />
          </div>
          
          {(directionFilter || statusFilter || searchQuery) && (
            <button
              onClick={() => { setDirectionFilter(''); setStatusFilter(''); setSearchQuery(''); }}
              className="mt-3 text-xs font-medium flex items-center gap-1 transition-colors"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={10} /> Clear All
            </button>
          )}
        </div>
      )}

      {/* CALL LIST */}
      <div className="space-y-2">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-[var(--primary)]" size={24} />
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="w-full flex flex-col items-center justify-center py-20 px-4 border border-[var(--border)] rounded-2xl bg-[var(--surface-secondary)]/10 text-center">
            <div className="w-12 h-12 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] shadow-sm mb-4">
              <History size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider mb-1">No call records found</h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm">No call sessions have been recorded yet. Trigger an outbound call or call an inbound number to see logs here.</p>
          </div>
        ) : (
          filteredCalls.map(call => {
            const isExpanded = expandedCallId === call.id;
            const statusCfg = statusConfig[call.status] || statusConfig.ended;
            const StatusIcon = statusCfg.icon;

            return (
              <div key={call.id} className="group">
                <div
                  onClick={() => handleExpandCall(call.id)}
                  className="card flex items-center justify-between p-4 cursor-pointer"
                  style={isExpanded ? { borderColor: 'var(--border-hover)', boxShadow: 'var(--card-hover-shadow)' } : {}}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Direction Icon */}
                    <div 
                      className="p-2 rounded-lg shrink-0"
                      style={{
                        backgroundColor: call.direction === 'inbound' ? 'rgba(59,130,246,0.08)' : 'rgba(37,99,235,0.08)',
                        border: `1px solid ${call.direction === 'inbound' ? 'rgba(59,130,246,0.15)' : 'rgba(37,99,235,0.15)'}`,
                        color: call.direction === 'inbound' ? 'var(--info)' : 'var(--primary)'
                      }}
                    >
                      {call.direction === 'inbound' ? <PhoneIncoming size={16} /> : <PhoneOutgoing size={16} />}
                    </div>

                    {/* Call Info */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {call.direction === 'outbound' ? call.to_number : call.from_number || 'Unknown'}
                        </p>
                        <span className="badge text-[10px] py-0.5">{call.direction}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                          {call.agent_name}
                        </span>
                        <span style={{ color: 'var(--text-muted)' }}>·</span>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {call.started_at ? new Date(call.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="hidden sm:flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                      <Clock size={12} />
                      <span className="text-xs font-mono">{formatDuration(call.duration_seconds)}</span>
                    </div>

                    {call.transcript_count > 0 && (
                      <div className="hidden sm:flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                        <MessageSquare size={12} />
                        <span className="text-xs font-mono">{call.transcript_count}</span>
                      </div>
                    )}

                    <span 
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium"
                      style={{ 
                        backgroundColor: statusCfg.bgVar,
                        border: `1px solid ${statusCfg.color}20`,
                        color: statusCfg.color 
                      }}
                    >
                      <StatusIcon size={10} />
                      {call.status}
                    </span>

                    <div style={{ color: 'var(--text-muted)' }}>
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  </div>
                </div>

                {/* Transcript */}
                {isExpanded && (
                  <div className="mt-1 ml-4 mr-1 p-4 rounded-lg animate-in fade-in duration-200" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <MessageSquare size={13} style={{ color: 'var(--text-muted)' }} />
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Transcript</span>
                    </div>

                    {loadingTranscripts ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="animate-spin" size={18} style={{ color: 'var(--text-muted)' }} />
                      </div>
                    ) : transcripts.length === 0 ? (
                      <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>
                        No transcript data available
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                        {transcripts.map((t, i) => (
                          <div key={i} className={`flex gap-2 ${t.role === 'agent' ? '' : 'flex-row-reverse'}`}>
                            <div 
                              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                              style={{
                                backgroundColor: t.role === 'agent' ? 'rgba(139,92,246,0.08)' : 'rgba(59,130,246,0.08)',
                                border: `1px solid ${t.role === 'agent' ? 'rgba(139,92,246,0.15)' : 'rgba(59,130,246,0.15)'}`,
                                color: t.role === 'agent' ? '#8B5CF6' : 'var(--info)'
                              }}
                            >
                              {t.role === 'agent' ? <Bot size={12} /> : <User size={12} />}
                            </div>
                            <div 
                              className="max-w-[75%] p-2.5 rounded-lg text-sm"
                              style={{
                                backgroundColor: t.role === 'agent' ? 'var(--surface)' : 'rgba(59,130,246,0.06)',
                                border: `1px solid ${t.role === 'agent' ? 'var(--border)' : 'rgba(59,130,246,0.1)'}`,
                                color: 'var(--text-primary)'
                              }}
                            >
                              <p className="leading-relaxed">{t.content}</p>
                              <span className="text-[10px] font-mono mt-1 block" style={{ color: 'var(--text-muted)' }}>
                                {t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : ''}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="mt-3 pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ borderTop: '1px solid var(--border)' }}>
                      <div>
                        <span className="text-[10px] font-semibold block" style={{ color: 'var(--text-muted)' }}>Session</span>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{call.session_id}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold block" style={{ color: 'var(--text-muted)' }}>Duration</span>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{formatDuration(call.duration_seconds)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold block" style={{ color: 'var(--text-muted)' }}>From</span>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{call.from_number || '—'}</span>
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold block" style={{ color: 'var(--text-muted)' }}>To</span>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{call.to_number || '—'}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CallLogsPage;
