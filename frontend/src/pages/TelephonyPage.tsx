import React, { useState, useEffect } from 'react';
import {
  Phone, Plus, Trash2, Loader2, X, Search, Zap, Key, Copy, Check,
  Server, ShieldCheck, AlertCircle, CheckCircle2, XCircle, Link,
  Webhook, ChevronRight,
} from 'lucide-react';
import { numbersApi, agentApi, telephonyApi, settingsApi } from '../services/api';
import { useAgentStore } from '../store/useAgentStore';
import toast from 'react-hot-toast';

interface PhoneNumber {
  id: string; number: string; provider: string; provider_sid?: string;
  agent_id?: string; sip_trunk_id?: string;
}

interface SipTrunk {
  id: string; name: string; numbers: string[]; termination_uri: string;
  trunk_type: string; livekit_trunk_id?: string; dispatch_rule_id?: string;
  agent_id?: string; provider?: string; status?: string; created_at?: string;
}

interface TelephonyStatus {
  provisioned: boolean; inbound_active: boolean; outbound_active: boolean;
  trunk_count: number; number_count: number; warnings: string[];
  sip_uri: string; origination_uri: string; trunks: SipTrunk[];
  phone_numbers: { number: string; provider: string; sip_trunk_id?: string }[];
}

const TelephonyPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'numbers' | 'sip' | 'settings'>('numbers');
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [trunks, setTrunks] = useState<SipTrunk[]>([]);
  const [telephonyStatus, setTelephonyStatus] = useState<TelephonyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const [twilioKeys, setTwilioKeys] = useState({ twilio_account_sid: '', twilio_auth_token: '', twilio_phone_number: '' });
  const [savingKeys, setSavingKeys] = useState(false);

  const [sipConfig, setSipConfig] = useState({ termination_uri: '', auth_username: '', auth_password: '', trunk_name: '', agent_id: '' });
  const [provisioningTrunk, setProvisioningTrunk] = useState(false);
  const [provisionResult, setProvisionResult] = useState<any>(null);

  const [bindingTrunkId, setBindingTrunkId] = useState<string | null>(null);

  const [importForm, setImportForm] = useState({ label: '', countryCode: '+91', phoneNumber: '', twilioSid: '' });

  const { agents, setAgents } = useAgentStore();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [numResp, agentsResp, trunkResp, statusResp, settingsResp] = await Promise.all([
        numbersApi.list(),
        agentApi.list(),
        telephonyApi.listTrunks().catch(() => ({ data: [] })),
        telephonyApi.status().catch(() => ({ data: null })),
        settingsApi.getTelephony().catch(() => ({ data: {} })),
      ]);
      setNumbers(numResp.data || []);
      setAgents(agentsResp.data || []);
      setTrunks(trunkResp.data || []);
      setTelephonyStatus(statusResp.data || null);
      const s = settingsResp.data || {};
      setTwilioKeys({ twilio_account_sid: s.twilio_account_sid || '', twilio_auth_token: '', twilio_phone_number: s.twilio_phone_number || '' });
      const saved = localStorage.getItem('hms_phone_labels');
      if (saved) setLabels(JSON.parse(saved));
    } catch (err) {
      toast.error('Could not load telephony settings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleImportNumber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importForm.phoneNumber.trim()) { toast.error('Phone number required'); return; }
    setIsImporting(true);
    const fullNumber = `${importForm.countryCode}${importForm.phoneNumber.trim().replace(/\D/g, '')}`;
    try {
      const resp = await numbersApi.create({ number: fullNumber, provider: 'twilio', provider_sid: importForm.twilioSid || undefined, agent_id: '' });
      const newNum = resp.data;
      if (importForm.label.trim() && newNum.id) {
        const updated = { ...labels, [newNum.id]: importForm.label.trim() };
        setLabels(updated);
        localStorage.setItem('hms_phone_labels', JSON.stringify(updated));
      }
      toast.success('Phone number imported');
      setIsDrawerOpen(false);
      setImportForm({ label: '', countryCode: '+91', phoneNumber: '', twilioSid: '' });
      fetchData();
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Import failed');
    } finally { setIsImporting(false); }
  };

  const handleDeleteNumber = async (id: string) => {
    if (!confirm('Remove this number?')) return;
    try {
      await numbersApi.delete(id);
      toast.success('Number removed');
      const updated = { ...labels }; delete updated[id];
      setLabels(updated); localStorage.setItem('hms_phone_labels', JSON.stringify(updated));
      fetchData();
    } catch { toast.error('Failed to remove number'); }
  };

  const handleAssignAgent = async (numberId: string, agentId: string) => {
    try { await numbersApi.update(numberId, { agent_id: agentId || null }); toast.success('Routing updated'); fetchData(); }
    catch { toast.error('Failed to assign agent'); }
  };

  const handleSaveTwilioKeys = async () => {
    setSavingKeys(true);
    try {
      // Strip empty strings so we don't overwrite existing vault secrets with blanks
      const payload: Record<string, string> = {};
      const isMasked = (value: string) => value.includes('*') || value.includes('...');
      if (twilioKeys.twilio_account_sid.trim() && !isMasked(twilioKeys.twilio_account_sid)) payload.twilio_account_sid = twilioKeys.twilio_account_sid.trim();
      if (twilioKeys.twilio_auth_token.trim() && !isMasked(twilioKeys.twilio_auth_token)) payload.twilio_auth_token = twilioKeys.twilio_auth_token.trim();
      if (twilioKeys.twilio_phone_number.trim() && !isMasked(twilioKeys.twilio_phone_number)) payload.twilio_phone_number = twilioKeys.twilio_phone_number.trim();
      if (Object.keys(payload).length === 0) { toast.error('No credentials to save'); setSavingKeys(false); return; }
      await settingsApi.saveSecrets(payload);
      toast.success('Credentials saved to vault');
      fetchData();
    }
    catch { toast.error('Failed to save credentials'); }
    finally { setSavingKeys(false); }
  };

  const handleProvisionTrunks = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sipConfig.termination_uri.trim()) { toast.error('Termination URI required'); return; }
    if (!sipConfig.auth_username.trim() || !sipConfig.auth_password.trim()) { toast.error('SIP auth credentials required'); return; }
    const phoneNumbers = numbers.map(n => n.number);
    if (phoneNumbers.length === 0) { toast.error('Import at least one phone number first'); return; }
    setProvisioningTrunk(true); setProvisionResult(null);
    try {
      const resp = await telephonyApi.provisionTrunks({
        termination_uri: sipConfig.termination_uri, auth_username: sipConfig.auth_username,
        auth_password: sipConfig.auth_password, phone_numbers: phoneNumbers,
        trunk_name: sipConfig.trunk_name || undefined, agent_id: sipConfig.agent_id || undefined,
        twilio_account_sid: twilioKeys.twilio_account_sid.includes('*') || twilioKeys.twilio_account_sid.includes('...') ? undefined : twilioKeys.twilio_account_sid || undefined,
        twilio_auth_token: twilioKeys.twilio_auth_token.includes('*') || twilioKeys.twilio_auth_token.includes('...') ? undefined : twilioKeys.twilio_auth_token || undefined,
      });
      setProvisionResult(resp.data);
      toast.success('SIP trunks provisioned!');
      setSipConfig({ termination_uri: '', auth_username: '', auth_password: '', trunk_name: '', agent_id: '' });
      fetchData();
    } catch (err: any) { toast.error(err.response?.data?.detail || 'Provisioning failed'); }
    finally { setProvisioningTrunk(false); }
  };

  const handleDeleteTrunk = async (trunkId: string) => {
    if (!confirm('Delete this SIP trunk?')) return;
    try { await telephonyApi.deleteTrunk(trunkId); toast.success('Trunk deleted'); fetchData(); }
    catch { toast.error('Failed to delete trunk'); }
  };

  const handleBindAgent = async (trunkId: string, agentId: string) => {
    if (!agentId) return;
    setBindingTrunkId(trunkId);
    try { await telephonyApi.updateTrunkAgent(trunkId, agentId); toast.success('Agent bound to trunk'); fetchData(); }
    catch (err: any) { toast.error(err.response?.data?.detail || 'Failed to bind agent'); }
    finally { setBindingTrunkId(null); }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text); setCopiedText(label); toast.success(`${label} copied`);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const backendBase = (() => {
    // Use VITE_API_URL env var first (same logic as api.ts)
    if (import.meta.env.VITE_API_URL) {
      // Strip trailing /api/v1 to get the bare origin
      return import.meta.env.VITE_API_URL.replace(/\/api\/v1\/?$/, '');
    }
    const origin = window.location.origin;
    // Local dev: Vite runs on :5173, backend on :8000
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return origin.replace(/:\d+$/, ':8000');
    }
    // Production/ngrok: frontend is proxied through the same origin as backend
    return origin;
  })();

  const inboundWebhookUrl = `${backendBase}/api/v1/telephony/twilio/inbound`;
  const livekitWebhookUrl = `${backendBase}/api/v1/telephony/livekit/webhook`;
  const originationUri = telephonyStatus?.origination_uri || 'sip:sip.livekit.cloud;transport=tcp';

  const filteredNumbers = numbers.filter(n => {
    const label = labels[n.id] || '';
    return label.toLowerCase().includes(searchQuery.toLowerCase()) || n.number.includes(searchQuery);
  });

  const inboundTrunks = trunks.filter(t => t.trunk_type === 'inbound');
  const outboundTrunks = trunks.filter(t => t.trunk_type === 'outbound');

  const StatusPill = ({ active, label }: { active: boolean; label: string }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${active ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-[var(--surface-secondary)] text-[var(--text-muted)] border-[var(--border)]'}`}>
      {active ? <CheckCircle2 size={10} /> : <XCircle size={10} />}{label}
    </span>
  );

  const CopyRow = ({ label, value }: { label: string; value: string }) => (
    <div className="space-y-1">
      <span className="text-[9px] font-extrabold uppercase tracking-widest text-[var(--text-secondary)] block">{label}</span>
      <div className="flex bg-[var(--surface)] rounded-lg border border-[var(--border)] p-2.5 items-center justify-between gap-2">
        <span className="font-mono text-[9px] text-[var(--text-secondary)] truncate flex-1">{value}</span>
        <button onClick={() => handleCopy(value, label)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer shrink-0">
          {copiedText === label ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 text-[var(--text-primary)] relative pb-12">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <Phone size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight">Telephony Hub</h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 font-medium ml-[52px]">Connect Twilio phone numbers to LiveKit SIP so agents can handle inbound and outbound calls.</p>
        </div>
        {telephonyStatus && (
          <div className="flex items-center gap-2 flex-wrap">
            <StatusPill active={telephonyStatus.inbound_active} label="Inbound" />
            <StatusPill active={telephonyStatus.outbound_active} label="Outbound" />
            {telephonyStatus.warnings.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border bg-amber-500/10 text-amber-500 border-amber-500/20">
                <AlertCircle size={10} />{telephonyStatus.warnings.length} warning{telephonyStatus.warnings.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>

      {/* WARNINGS */}
      {telephonyStatus?.warnings && telephonyStatus.warnings.length > 0 && (
        <div className="border border-amber-500/30 bg-amber-500/5 rounded-xl p-4 space-y-1.5">
          {telephonyStatus.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertCircle size={13} className="shrink-0 mt-0.5" /><span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* TABS */}
      <div className="flex border-b border-[var(--border)] gap-6">
        {([{ id: 'numbers', Icon: Phone, label: 'Phone Numbers' }, { id: 'sip', Icon: Zap, label: 'LiveKit SIP Bridge' }, { id: 'settings', Icon: Key, label: 'Connection Settings' }] as const).map(({ id, Icon, label }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`pb-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${activeTab === id ? 'border-black dark:border-white text-[var(--text-primary)]' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}>
            <Icon size={14} />{label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="animate-spin text-[var(--primary)]" size={24} /></div>
      ) : (
        <>
          {/* ── TAB: NUMBERS ── */}
          {activeTab === 'numbers' && (
            numbers.length === 0 ? (
              <div className="w-full flex flex-col items-center justify-center py-20 px-4 border border-[var(--border)] rounded-2xl bg-[var(--surface-secondary)]/10 text-center">
                <div className="w-12 h-12 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] shadow-sm mb-4"><Phone size={20} /></div>
                <h3 className="text-sm font-bold uppercase tracking-wider mb-1">No phone numbers</h3>
                <p className="text-xs text-[var(--text-muted)] max-w-sm mb-6">Import a Twilio phone number to route inbound voice calls to an agent.</p>
                <button onClick={() => setIsDrawerOpen(true)} className="flex items-center gap-1.5 border border-[var(--border)] hover:bg-[var(--surface-secondary)] text-[var(--text-primary)] px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer">
                  <Plus size={13} /> Import number
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="relative max-w-md flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={15} />
                    <input type="text" placeholder="Search numbers or labels..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/20 text-xs font-semibold focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                  </div>
                  <button onClick={() => setIsDrawerOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer btn-shine active:scale-[0.97]"
                    style={{ backgroundColor: 'var(--primary)', color: '#fff', boxShadow: '0 4px 14px -3px rgba(79,70,229,0.4)' }}>
                    <Plus size={13} /> Import number
                  </button>
                </div>
                <div className="border border-[var(--border)] rounded-2xl overflow-hidden bg-[var(--surface-secondary)]/10">
                  <table className="w-full border-collapse text-left text-xs font-medium">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface-secondary)]/20 text-[var(--text-muted)] uppercase tracking-wider text-[10px]">
                        <th className="px-6 py-4">Label</th><th className="px-6 py-4">Number</th><th className="px-6 py-4">Provider</th>
                        <th className="px-6 py-4">SIP Trunk</th><th className="px-6 py-4">Routing Agent</th><th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {filteredNumbers.map(num => {
                        const label = labels[num.id] || 'Primary Line';
                        const linked = trunks.find(t => t.numbers?.includes(num.number));
                        return (
                          <tr key={num.id} className="hover:bg-[var(--surface-secondary)]/15">
                            <td className="px-6 py-4 font-bold">{label}</td>
                            <td className="px-6 py-4 font-mono text-[var(--text-secondary)] tracking-wider">{num.number}</td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-[var(--surface-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">{num.provider}</span>
                            </td>
                            <td className="px-6 py-4">
                              {linked ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500"><CheckCircle2 size={10} /> Linked</span> : <span className="text-[10px] text-[var(--text-muted)]">—</span>}
                            </td>
                            <td className="px-6 py-4">
                              <select value={num.agent_id || ''} onChange={e => handleAssignAgent(num.id, e.target.value)}
                                className="px-3 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--primary)] cursor-pointer">
                                <option value="">No Agent</option>
                                {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
                              </select>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button onClick={() => handleDeleteNumber(num.id)} className="p-2 text-[var(--text-muted)] hover:text-red-500 rounded-lg hover:bg-red-500/5 border border-transparent hover:border-red-500/10 cursor-pointer"><Trash2 size={14} /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {/* ── TAB: SIP TRUNKS ── */}
          {activeTab === 'sip' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Provision form */}
              <div className="lg:col-span-2 border border-[var(--border)] rounded-2xl p-6 bg-[var(--surface-secondary)]/10 space-y-5">
                <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3">
                  <Zap size={16} className="text-[var(--primary)]" />
                  <h3 className="text-sm font-bold uppercase tracking-wider">Connect Twilio SIP to LiveKit</h3>
                </div>
                <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[10px] leading-relaxed text-[var(--text-secondary)]">
                  Twilio is the carrier that owns/dials the phone numbers. LiveKit SIP is the gateway that brings those calls into your voice agent. This form creates the LiveKit inbound/outbound trunk pair and points the outbound side to your Twilio Elastic SIP trunk.
                </div>
                <form onSubmit={handleProvisionTrunks} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Twilio Elastic SIP Termination URI</label>
                      <input type="text" placeholder="my-trunk.pstn.twilio.com" value={sipConfig.termination_uri} onChange={e => setSipConfig({ ...sipConfig, termination_uri: e.target.value })}
                        className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs font-mono focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Connection Name (optional)</label>
                      <input type="text" placeholder="my-trunk" value={sipConfig.trunk_name} onChange={e => setSipConfig({ ...sipConfig, trunk_name: e.target.value })}
                        className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs font-semibold focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">SIP Auth Username</label>
                      <input type="text" placeholder="Username" value={sipConfig.auth_username} onChange={e => setSipConfig({ ...sipConfig, auth_username: e.target.value })}
                        className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">SIP Auth Password</label>
                      <input type="password" placeholder="Password" value={sipConfig.auth_password} onChange={e => setSipConfig({ ...sipConfig, auth_password: e.target.value })}
                        className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs font-mono focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Route inbound calls to agent (optional)</label>
                    <select value={sipConfig.agent_id} onChange={e => setSipConfig({ ...sipConfig, agent_id: e.target.value })}
                      className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs font-semibold focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)] cursor-pointer">
                      <option value="">No agent — bind later</option>
                      {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
                    </select>
                    <p className="text-[9px] text-[var(--text-muted)]">Inbound calls will route to this agent immediately. You can change it any time from the trunk list.</p>
                  </div>

                  {numbers.length === 0 && (
                    <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg text-xs text-amber-600 dark:text-amber-400">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span>No phone numbers yet. Go to <strong>Phone Numbers</strong> tab and import one first.</span>
                    </div>
                  )}

                  <button type="submit" disabled={provisioningTrunk || numbers.length === 0}
                    className="w-full bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                    {provisioningTrunk ? <Loader2 className="animate-spin" size={14} /> : <><Zap size={13} /> Create LiveKit SIP Bridge</>}
                  </button>
                </form>

                {/* Post-provision success instructions */}
                {provisionResult && (
                  <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-emerald-500 text-xs font-bold"><CheckCircle2 size={14} /> LiveKit SIP bridge created — finish setup in Twilio Console</div>
                    <div className="space-y-2 text-xs text-[var(--text-secondary)]">
                      <p>1. Open <strong>Twilio Console → Elastic SIP Trunks → Origination</strong></p>
                      <p>2. Add this Origination URI:</p>
                      <div className="flex items-center gap-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-2">
                        <code className="font-mono text-[10px] flex-1 text-[var(--text-primary)]">{provisionResult.setup_instructions?.origination_uri || originationUri}</code>
                        <button onClick={() => handleCopy(provisionResult.setup_instructions?.origination_uri || originationUri, 'Origination URI')} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
                          {copiedText === 'Origination URI' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                        </button>
                      </div>
                      <p>3. Set Priority: <strong>1</strong>, Weight: <strong>1</strong></p>
                      {!provisionResult.inbound_trunk?.agent_attached && (
                        <p className="text-amber-500">⚠ No agent attached yet — use the trunk list to bind one before inbound calls work.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Active trunk list */}
              <div className="border border-[var(--border)] rounded-2xl p-6 bg-[var(--surface-secondary)]/10 space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-wider border-b border-[var(--border)] pb-2 flex items-center gap-2"><Server size={14} /> Active LiveKit SIP Trunks ({trunks.length})</h3>
                {trunks.length === 0 ? (
                  <p className="text-xs text-[var(--text-muted)] text-center py-10">No trunks provisioned yet.</p>
                ) : (
                  <div className="space-y-3">
                    {inboundTrunks.map(t => (
                      <div key={t.id} className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl space-y-2 hover:border-[var(--text-secondary)]">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0">
                            <p className="font-bold text-xs truncate">{t.name || 'Unnamed'}</p>
                            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase text-emerald-500"><Phone size={9} /> Inbound</span>
                          </div>
                          <button onClick={() => handleDeleteTrunk(t.id)} className="p-1.5 text-[var(--text-muted)] hover:text-red-500 rounded-lg hover:bg-red-500/5 cursor-pointer"><Trash2 size={12} /></button>
                        </div>
                        {/* Live agent binding */}
                        <div className="flex items-center gap-2">
                          <select value={t.agent_id || ''} onChange={e => handleBindAgent(t.id, e.target.value)} disabled={bindingTrunkId === t.id}
                            className="flex-1 px-2 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/20 text-[10px] font-semibold focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)] cursor-pointer">
                            <option value="">No agent bound</option>
                            {agents.map(a => <option key={a.id} value={a.id}>{a.agentName}</option>)}
                          </select>
                          {bindingTrunkId === t.id ? <Loader2 size={12} className="animate-spin text-[var(--primary)]" /> : t.agent_id ? <Link size={11} className="text-emerald-500 shrink-0" /> : <AlertCircle size={11} className="text-amber-500 shrink-0" />}
                        </div>
                      </div>
                    ))}
                    {outboundTrunks.map(t => (
                      <div key={t.id} className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl flex items-start justify-between hover:border-[var(--text-secondary)]">
                        <div className="min-w-0">
                          <p className="font-bold text-xs truncate">{t.name || 'Unnamed'}</p>
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase text-blue-500"><Zap size={9} /> Outbound</span>
                          <p className="font-mono text-[9px] text-[var(--text-muted)] truncate mt-0.5">{t.termination_uri}</p>
                        </div>
                        <button onClick={() => handleDeleteTrunk(t.id)} className="p-1.5 text-[var(--text-muted)] hover:text-red-500 rounded-lg hover:bg-red-500/5 cursor-pointer shrink-0"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TAB: SETTINGS ── */}
          {activeTab === 'settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                {/* Twilio Vault */}
                <div className="border border-[var(--border)] rounded-2xl p-6 bg-[var(--surface-secondary)]/10 space-y-5">
                  <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3"><Key size={16} className="text-[var(--primary)]" /><h3 className="text-sm font-bold uppercase tracking-wider">Twilio Credentials Vault</h3></div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Account SID</label>
                        <input type="text" placeholder="ACxxxxxxxxxxxxxxxx" value={twilioKeys.twilio_account_sid} onChange={e => setTwilioKeys({ ...twilioKeys, twilio_account_sid: e.target.value })}
                          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs font-mono focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Caller ID (E.164)</label>
                        <input type="text" placeholder="+919876543210" value={twilioKeys.twilio_phone_number} onChange={e => setTwilioKeys({ ...twilioKeys, twilio_phone_number: e.target.value })}
                          className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs font-mono focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Auth Token</label>
                      <input type="password" placeholder="Leave blank to keep existing" value={twilioKeys.twilio_auth_token} onChange={e => setTwilioKeys({ ...twilioKeys, twilio_auth_token: e.target.value })}
                        className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] text-xs font-mono focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                      <p className="text-[9px] text-[var(--text-muted)]">Stored encrypted. Leave blank to keep the current token.</p>
                    </div>
                    <button onClick={handleSaveTwilioKeys} disabled={savingKeys}
                      className="w-full bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50">
                      {savingKeys ? <Loader2 className="animate-spin" size={14} /> : <><ShieldCheck size={14} /> Save to Vault</>}
                    </button>
                  </div>
                </div>

                {/* LiveKit Webhook */}
                <div className="border border-[var(--border)] rounded-2xl p-6 bg-[var(--surface-secondary)]/10 space-y-4">
                  <div className="flex items-center gap-2 border-b border-[var(--border)] pb-3"><Webhook size={16} className="text-[var(--primary)]" /><h3 className="text-sm font-bold uppercase tracking-wider">LiveKit Webhook Setup</h3></div>
                  <p className="text-xs text-[var(--text-muted)]">Without this, calls stay in <code className="font-mono bg-[var(--surface-secondary)] px-1 rounded text-[10px]">connecting</code> status forever. Add in <strong>LiveKit Cloud → Project → Webhooks</strong>.</p>
                  <CopyRow label="Webhook URL" value={livekitWebhookUrl} />
                  <div className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-[9.5px] text-[var(--text-secondary)] space-y-1.5">
                    <p>✅ Events to enable: <strong>RoomFinished, ParticipantLeft, ParticipantJoined</strong></p>
                    <p>This webhook updates call status, saves transcripts, and calculates duration.</p>
                  </div>
                </div>
              </div>

              {/* Right column */}
              <div className="space-y-4">
                <div className="border border-[var(--border)] rounded-2xl p-5 bg-[var(--surface-secondary)]/10 space-y-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider border-b border-[var(--border)] pb-2 flex items-center gap-2"><AlertCircle size={14} /> Webhook Config</h3>
                  <CopyRow label="Twilio Voice Webhook" value={inboundWebhookUrl} />
                  <CopyRow label="LiveKit Origination URI" value={originationUri} />
                  <div className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl text-[9.5px] text-[var(--text-secondary)] space-y-1.5 leading-relaxed">
                    <p><strong>Inbound calls:</strong> Paste the Twilio Voice Webhook into your Twilio number's Voice webhook field.</p>
                    <p><strong>SIP routing:</strong> Paste the LiveKit Origination URI into Twilio Elastic SIP Trunk → Origination.</p>
                  </div>
                </div>

                {/* Setup checklist */}
                <div className="border border-[var(--border)] rounded-2xl p-5 bg-[var(--surface-secondary)]/10 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider border-b border-[var(--border)] pb-2">Setup Checklist</h3>
                  {[
                    { done: !!twilioKeys.twilio_account_sid, label: 'Twilio credentials saved' },
                    { done: numbers.length > 0, label: 'Phone number imported' },
                    { done: telephonyStatus?.inbound_active ?? false, label: 'LiveKit inbound trunk active' },
                    { done: telephonyStatus?.outbound_active ?? false, label: 'LiveKit outbound trunk active' },
                    { done: trunks.some(t => t.trunk_type === 'inbound' && !!t.agent_id), label: 'Agent routed from inbound trunk' },
                  ].map(({ done, label }) => (
                    <div key={label} className="flex items-center gap-2 text-xs">
                      {done ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" /> : <ChevronRight size={14} className="text-[var(--text-muted)] shrink-0" />}
                      <span className={done ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* IMPORT DRAWER */}
      {isDrawerOpen && (
        <div className="fixed inset-0 z-[1000] flex justify-end">
          <div onClick={() => setIsDrawerOpen(false)} className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" />
          <div className="relative w-full max-w-[420px] h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col z-10">
            <div className="flex items-center justify-between px-6 py-5 border-b border-[var(--border)]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)]"><Phone size={15} /></div>
                <div><h2 className="text-sm font-bold">Import phone number</h2><p className="text-[10px] text-[var(--text-muted)]">Add a Twilio number for call routing</p></div>
              </div>
              <button onClick={() => setIsDrawerOpen(false)} className="p-1 rounded-lg hover:bg-[var(--surface-secondary)] text-[var(--text-muted)] cursor-pointer"><X size={16} /></button>
            </div>
            <form onSubmit={handleImportNumber} className="flex-1 overflow-y-auto px-6 py-5 space-y-5 custom-scrollbar">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Label</label>
                <input type="text" placeholder="e.g. Sales Line India" value={importForm.label} onChange={e => setImportForm({ ...importForm, label: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10 text-xs font-semibold focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Phone Number</label>
                <div className="flex gap-2">
                  <select value={importForm.countryCode} onChange={e => setImportForm({ ...importForm, countryCode: e.target.value })}
                    className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/15 text-xs font-bold focus:outline-none focus:border-[var(--primary)] cursor-pointer text-[var(--text-primary)]">
                    <option value="+91">🇮🇳 +91</option><option value="+1">🇺🇸 +1</option><option value="+44">🇬🇧 +44</option>
                    <option value="+61">🇦🇺 +61</option><option value="+33">🇫🇷 +33</option><option value="+65">🇸🇬 +65</option>
                  </select>
                  <input type="text" placeholder="98765 43210" value={importForm.phoneNumber} onChange={e => setImportForm({ ...importForm, phoneNumber: e.target.value })}
                    className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10 text-xs font-mono font-bold focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">Twilio Account SID (optional)</label>
                <input type="text" placeholder="AC... — leave blank to use vault" value={importForm.twilioSid} onChange={e => setImportForm({ ...importForm, twilioSid: e.target.value })}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10 text-xs font-mono focus:outline-none focus:border-[var(--primary)] text-[var(--text-primary)]" />
              </div>
            </form>
            <div className="px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-secondary)]/10 flex justify-end gap-3">
              <button type="button" onClick={() => setIsDrawerOpen(false)} className="px-4 py-2 border border-[var(--border)] hover:bg-[var(--surface-secondary)] text-[var(--text-primary)] rounded-lg text-xs font-bold cursor-pointer">Cancel</button>
              <button onClick={handleImportNumber} disabled={isImporting}
                className="px-4 py-2 bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                {isImporting ? <Loader2 className="animate-spin" size={12} /> : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TelephonyPage;
