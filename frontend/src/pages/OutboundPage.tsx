import React, { useState, useEffect } from 'react';
import {
  PhoneOutgoing,
  Plus,
  Search,
  Loader2,
  X,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { callsApi, agentApi, telephonyApi, settingsApi } from '../services/api';
import { useAgentStore } from '../store/useAgentStore';
import toast from 'react-hot-toast';

interface OutboundSession {
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
}

const OutboundPage: React.FC = () => {
  const [calls, setCalls] = useState<OutboundSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  // Form State
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [destinationNumber, setDestinationNumber] = useState('');
  const [csvNumbers, setCsvNumbers] = useState('');

  // Always use Twilio REST fallback — no toggle needed
  const useTwilioFallback = true;

  // Trunk & credentials availability
  const [hasTwilioCredentials, setHasTwilioCredentials] = useState(false);

  const { agents, setAgents } = useAgentStore();

  const fetchOutboundData = async () => {
    try {
      const [callsResp, agentsResp, settingsResp] = await Promise.all([
        callsApi.list({ direction: 'outbound', limit: 50 }).catch(() => ({ data: { calls: [] } })),
        agentApi.list(),
        settingsApi.getTelephony().catch(() => ({ data: null })),
      ]);

      setCalls(callsResp.data?.calls || []);
      setAgents(agentsResp.data || []);

      // Check if Twilio credentials are configured
      // Backend returns masked values like "****1234" when set, or "" when not set
      const creds = settingsResp?.data;
      setHasTwilioCredentials(
        !!(creds?.twilio_account_sid && creds?.twilio_auth_token && creds?.twilio_phone_number)
      );
    } catch (err) {
      console.error('Failed to load outbound data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOutboundData();
  }, []);

  const handleCreateBatchCall = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedAgentId) {
      toast.error('Please select an active voice agent');
      return;
    }

    if (!hasTwilioCredentials) {
      toast.error('Twilio credentials not configured. Go to Settings → Telephony to add them.');
      return;
    }

    const numbersToDial = csvNumbers.trim()
      ? csvNumbers.split(/[\n,]+/).map(n => n.trim()).filter(Boolean)
      : [destinationNumber.trim()].filter(Boolean);

    if (numbersToDial.length === 0) {
      toast.error('Please specify at least one destination number');
      return;
    }

    setDispatching(true);
    let successCount = 0;

    for (const num of numbersToDial) {
      try {
        await telephonyApi.outbound({
          to_number: num,
          agent_id: selectedAgentId,
          use_twilio_fallback: useTwilioFallback,
        });
        successCount++;
      } catch (err: any) {
        console.error(`Failed dialing ${num}:`, err);
        toast.error(`Error dialing ${num}: ${err.response?.data?.detail || 'Dispatch failure'}`);
      }
    }

    if (successCount > 0) {
      toast.success(`Dispatched ${successCount} outbound session(s) successfully`);
      setIsDrawerOpen(false);
      setDestinationNumber('');
      setCsvNumbers('');
      setSelectedAgentId('');
      fetchOutboundData();
    }
    setDispatching(false);
  };

  const filteredCalls = calls.filter(call => {
    const term = searchQuery.toLowerCase();
    return (
      call.to_number?.includes(term) ||
      call.agent_name?.toLowerCase().includes(term) ||
      call.status?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6 text-[var(--text-primary)] relative pb-12">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 relative z-10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <PhoneOutgoing size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)]">
              Batch Calling
            </h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 font-medium ml-[52px]">
            Manage large-scale outbound voice campaigns and dispatch agents.
          </p>
        </div>
        <button
          onClick={() => setIsDrawerOpen(true)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer self-start md:self-auto btn-shine active:scale-[0.97]"
          style={{
            backgroundColor: 'var(--primary)',
            color: '#fff',
            boxShadow: '0 4px 14px -3px rgba(79, 70, 229, 0.4)',
          }}
        >
          <Plus size={14} />
          Create a batch call
        </button>
      </div>

      {/* Twilio Credentials Warning — only shown after loading completes */}
      {!loading && !hasTwilioCredentials && (
        <div className="flex items-center gap-3 p-3 rounded-xl border bg-red-500/5 border-red-500/20">
          <AlertCircle size={15} className="text-red-500 shrink-0" />
          <div>
            <p className="font-bold text-red-600 dark:text-red-400 text-[10px] uppercase tracking-wider">
              Twilio Credentials Required
            </p>
            <p className="text-[var(--text-muted)] text-[10px]">
              Go to <strong>Settings → Telephony</strong> and enter your Twilio Account SID, Auth Token, and Phone Number before making outbound calls.
            </p>
          </div>
        </div>
      )}

      {/* Credentials OK banner */}
      {!loading && hasTwilioCredentials && (
        <div className="flex items-center gap-3 p-3 rounded-xl border bg-emerald-500/5 border-emerald-500/20">
          <CheckCircle2 size={15} className="text-emerald-500 shrink-0" />
          <div>
            <p className="font-bold text-emerald-600 dark:text-emerald-400 text-[10px] uppercase tracking-wider">
              Twilio Credentials Configured
            </p>
            <p className="text-[var(--text-muted)] text-[10px]">
              Outbound calls are ready to dispatch via Twilio REST.
            </p>
          </div>
        </div>
      )}

      {/* SEARCH BAR */}
      <div className="relative max-w-full z-10">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={15} />
        <input
          type="text"
          placeholder="Search Batch Calls..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/20 text-xs font-semibold focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]"
        />
      </div>

      <div className="relative z-10">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-[var(--primary)]" size={24} />
          </div>
        ) : calls.length === 0 ? (
          <div className="w-full flex flex-col items-center justify-center py-20 px-4 border border-[var(--border)] rounded-2xl bg-[var(--surface-secondary)]/10 text-center">
            <div className="w-12 h-12 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] shadow-sm mb-4">
              <PhoneOutgoing size={20} />
            </div>
            <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider mb-1">
              No batch calls found
            </h3>
            <p className="text-xs text-[var(--text-muted)] max-w-sm mb-6">
              No batch calls found for the workspace. Create a call dispatch to trigger outbound campaigns.
            </p>
            <button
              onClick={() => setIsDrawerOpen(true)}
              className="flex items-center gap-1.5 border border-[var(--border)] hover:bg-[var(--surface-secondary)] text-[var(--text-primary)] px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer"
            >
              <Plus size={13} />
              Create a batch call
            </button>
          </div>
        ) : (
          <div className="border border-[var(--border)] rounded-2xl overflow-hidden bg-[var(--surface-secondary)]/10">
            <table className="w-full border-collapse text-left text-xs font-medium">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-secondary)]/20 text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
                  <th className="px-6 py-4">Destination</th>
                  <th className="px-6 py-4">Assigned Agent</th>
                  <th className="px-6 py-4">Started At</th>
                  <th className="px-6 py-4">Duration</th>
                  <th className="px-6 py-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {filteredCalls.map(call => {
                  const statusColors: Record<string, string> = {
                    initiated: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
                    failed: 'bg-red-500/10 text-red-500 border-red-500/20',
                    connecting: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
                    active: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
                    completed: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20',
                  };
                  const statusColor =
                    statusColors[call.status?.toLowerCase()] ||
                    'bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border)]';

                  return (
                    <tr key={call.id} className="hover:bg-[var(--surface-secondary)]/15">
                      <td className="px-6 py-4 font-mono font-bold text-[var(--text-primary)]">
                        {call.to_number}
                      </td>
                      <td className="px-6 py-4">
                        <span className="font-semibold text-[var(--text-secondary)]">{call.agent_name}</span>
                      </td>
                      <td className="px-6 py-4 text-[var(--text-muted)]">
                        {call.started_at
                          ? new Date(call.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
                          : 'Pending'}
                      </td>
                      <td className="px-6 py-4 font-semibold text-[var(--text-secondary)]">
                        {call.duration_seconds ? `${Math.round(call.duration_seconds)}s` : '0s'}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 border text-[10px] rounded font-bold uppercase tracking-wider ${statusColor}`}
                        >
                          {call.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* DRAWER */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[1000] flex justify-end">
          <div
            onClick={() => setIsDrawerOpen(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />
          <div className="relative w-full max-w-[420px] h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col z-10">
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]">
                  <PhoneOutgoing size={15} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-[var(--text-primary)]">Create Outbound Campaign</h2>
                  <p className="text-[10px] text-[var(--text-muted)]">Dispatch voice agents dynamically to targets</p>
                </div>
              </div>
              <button
                onClick={() => setIsDrawerOpen(false)}
                className="p-1 rounded-lg hover:bg-[var(--surface-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Drawer Form Body */}
            <form onSubmit={handleCreateBatchCall} className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">

              {/* Credentials warning inside drawer */}
              {!hasTwilioCredentials && (
                <div className="flex items-start gap-2.5 p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-[9px] text-red-600 dark:text-red-400 leading-relaxed">
                    Twilio credentials not configured. Go to <strong>Settings → Telephony</strong> to add your Account SID, Auth Token, and Phone Number before dispatching calls.
                  </p>
                </div>
              )}

              {/* Voice Agent Selector */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  Select Agent (Persona)
                </label>
                <select
                  value={selectedAgentId}
                  onChange={e => setSelectedAgentId(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10 text-xs font-semibold focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)] cursor-pointer"
                >
                  <option value="">Choose voice agent...</option>
                  {agents.map(agent => (
                    <option key={agent.id} value={agent.id}>
                      {agent.agentName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Single Destination Number */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  Single Destination Number
                </label>
                <input
                  type="text"
                  placeholder="+1XXXXXXXXXX"
                  value={destinationNumber}
                  disabled={!!csvNumbers.trim()}
                  onChange={e => setDestinationNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10 text-xs font-mono focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)] disabled:opacity-50"
                />
              </div>

              {/* Divider Or */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-[1px] bg-[var(--border)]" />
                <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Or</span>
                <div className="flex-1 h-[1px] bg-[var(--border)]" />
              </div>

              {/* Batch Import Field */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                  Batch Numbers (CSV / Line-separated)
                </label>
                <textarea
                  rows={4}
                  placeholder={"+12015550123\n+12015550124\n+12015550125"}
                  value={csvNumbers}
                  disabled={!!destinationNumber.trim()}
                  onChange={e => setCsvNumbers(e.target.value)}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10 text-xs font-mono focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)] disabled:opacity-50 resize-none"
                />
                <p className="text-[9px] text-[var(--text-muted)] font-medium leading-relaxed">
                  Enter one E.164 formatted number per line or separated by commas.
                </p>
              </div>

              {/* Info banner */}
              <div className="flex items-start gap-2.5 p-3.5 bg-[var(--surface-secondary)]/20 border border-[var(--border)] rounded-xl">
                <AlertCircle size={14} className="text-[var(--primary)] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-primary)]">
                    Automated Outbound Dispatch
                  </span>
                  <p className="text-[9px] text-[var(--text-muted)] leading-relaxed">
                    Ensure Twilio credentials and voice gateway are online before running batch campaigns.
                  </p>
                </div>
              </div>
            </form>

            {/* Footer Actions */}
            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-secondary)]/10 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsDrawerOpen(false)}
                className="px-4 py-2 border border-[var(--border)] hover:bg-[var(--surface-secondary)] text-[var(--text-primary)] rounded-lg text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBatchCall}
                disabled={dispatching || !hasTwilioCredentials}
                className="px-4 py-2 bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {dispatching ? <Loader2 className="animate-spin" size={12} /> : 'Dispatch Calls'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OutboundPage;