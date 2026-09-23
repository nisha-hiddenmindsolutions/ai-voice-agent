import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Phone, 
  PhoneOutgoing, 
  History, 
  Plus, 
  Trash2, 
  Smartphone, 
  Loader2, 
  X, 
  Key, 
  Server, 
  Copy, 
  Check,
  ShieldCheck,
  ToggleLeft,
  Zap,
  Link2,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import api, { numbersApi, callsApi, telephonyApi, agentApi } from '../services/api';
import { useAgentStore } from '../store/useAgentStore';
import { Select } from './ui/Select';
import toast from 'react-hot-toast';
import { BackButton } from './BackButton';

interface Number {
  id: string;
  number: string;
  provider: string;
  agent_id?: string;
  sip_trunk_id?: string;
}

interface Call {
  id: string;
  session_id: string;
  status: string;
  started_at: string;
  to_number: string;
}

export const TelephonyPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'gateways' | 'twilio'>('gateways');
  const [numbers, setNumbers] = useState<Number[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  
  // Link Number State
  const [newNumber, setNewNumber] = useState({ 
    number: '', 
    provider: 'twilio', 
    agent_id: '' 
  });
  
  // Outbound State
  const [targetNumber, setTargetNumber] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  
  // SIP Trunk Provisioning State
  const [sipConfig, setSipConfig] = useState({
    termination_uri: '',
    auth_username: '',
    auth_password: '',
    trunk_name: ''
  });
  const [trunks, setTrunks] = useState<any[]>([]);
  const [telephonyStatus, setTelephonyStatus] = useState<any>(null);
  
  // Legacy Twilio Secrets State
  const [twilioKeys, setTwilioKeys] = useState({
    twilio_account_sid: '',
    twilio_auth_token: '',
    twilio_phone_number: ''
  });
  
  const [loading, setLoading] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [provisioningTrunks, setProvisioningTrunks] = useState(false);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  
  const { agents } = useAgentStore();

  const fetchTelephonyData = async () => {
    try {
      const [numResp, callResp, agentsResp] = await Promise.all([
        numbersApi.list(),
        callsApi.list(),
        agentApi.list()
      ]);
      setNumbers(numResp.data || []);
      setCalls(callResp.data?.calls || []);
      useAgentStore.getState().setAgents(agentsResp.data || []);
    } catch (err) {
      console.error("Failed to fetch telephony data", err);
    }
  };

  const fetchTrunks = async () => {
    try {
      const [trunkResp, statusResp] = await Promise.all([
        telephonyApi.listTrunks(),
        telephonyApi.status()
      ]);
      setTrunks(trunkResp.data);
      setTelephonyStatus(statusResp.data);
    } catch (err) {
      console.error("Failed to fetch trunk data", err);
    }
  };

  const fetchTwilioKeys = async () => {
    try {
      const resp = await api.get('/keys/');
      const keys = resp.data.keys || {};
      setTwilioKeys({
        twilio_account_sid: keys.twilio_account_sid || '',
        twilio_auth_token: keys.twilio_auth_token || '',
        twilio_phone_number: keys.twilio_phone_number || ''
      });
    } catch (err) {
      console.error("Failed to fetch Twilio secrets profile", err);
    }
  };

  useEffect(() => {
    fetchTelephonyData();
    fetchTrunks();
    fetchTwilioKeys();
  }, []);

  const handleAddNumber = async () => {
    if (!newNumber.number.trim()) {
      toast.error('E.164 phone number required');
      return;
    }
    setLoading(true);
    try {
      await numbersApi.create(newNumber);
      setIsAdding(false);
      setNewNumber({ number: '', provider: 'twilio', agent_id: '' });
      fetchTelephonyData();
      toast.success('Number successfully registered in PSTN registry.');
    } catch (err) {
      toast.error('Link registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNumber = async (numberId: string) => {
    const toastId = toast.loading('Removing number...');
    try {
      await numbersApi.delete(numberId);
      toast.success('PSTN number removed from registry.', { id: toastId });
      fetchTelephonyData();
    } catch (err) {
      toast.error('Failed to delete number', { id: toastId });
    }
  };

  const handleSaveTwilioKeys = async () => {
    setSavingKeys(true);
    try {
      const isMasked = (value: string) => value.includes('*') || value.includes('...');
      const payload: Record<string, string> = {};
      if (twilioKeys.twilio_account_sid.trim() && !isMasked(twilioKeys.twilio_account_sid)) {
        payload.twilio_account_sid = twilioKeys.twilio_account_sid.trim();
      }
      if (twilioKeys.twilio_auth_token.trim() && !isMasked(twilioKeys.twilio_auth_token)) {
        payload.twilio_auth_token = twilioKeys.twilio_auth_token.trim();
      }
      if (twilioKeys.twilio_phone_number.trim() && !isMasked(twilioKeys.twilio_phone_number)) {
        payload.twilio_phone_number = twilioKeys.twilio_phone_number.trim();
      }
      if (Object.keys(payload).length === 0) {
        toast.error('No new Twilio credentials to save.');
        return;
      }
      await api.post('/keys/', payload);
      toast.success('Twilio credentials successfully updated & vaulted.');
      fetchTwilioKeys();
    } catch (err) {
      toast.error('Failed to save secure profile credentials.');
    } finally {
      setSavingKeys(false);
    }
  };

  const handleTriggerCall = async () => {
    if (!selectedAgentId) {
      toast.error('Please select an active voice agent');
      return;
    }
    if (!targetNumber.trim()) {
      toast.error('Target customer phone number required');
      return;
    }
    if (!telephonyStatus?.outbound_active) {
      toast.error('No active outbound SIP trunk found. Create the LiveKit SIP bridge first, or save Twilio credentials and use the Outbound trial fallback page.');
      return;
    }
    
    setLoading(true);
    try {
      await telephonyApi.outbound({
        to_number: targetNumber,
        agent_id: selectedAgentId,
        use_twilio_fallback: false,
      });
      toast.success('Outbound call initiated via LiveKit SIP.');
      fetchTelephonyData();
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || 'Outbound call dispatch failed';
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleProvisionTrunks = async () => {
    if (!sipConfig.termination_uri.trim()) {
      toast.error('Twilio SIP Termination URI is required');
      return;
    }
    if (!sipConfig.auth_username.trim() || !sipConfig.auth_password.trim()) {
      toast.error('SIP authentication credentials are required');
      return;
    }
    
    const phoneNumbers = numbers.map(n => n.number);
    if (phoneNumbers.length === 0) {
      toast.error('Register at least one phone number in the PSTN Registry first');
      return;
    }

    setProvisioningTrunks(true);
    try {
      await telephonyApi.provisionTrunks({
        termination_uri: sipConfig.termination_uri,
        auth_username: sipConfig.auth_username,
        auth_password: sipConfig.auth_password,
        phone_numbers: phoneNumbers,
        trunk_name: sipConfig.trunk_name || undefined,
      });
      toast.success('SIP trunks provisioned successfully!');
      fetchTrunks();
      setSipConfig({ termination_uri: '', auth_username: '', auth_password: '', trunk_name: '' });
    } catch (err: any) {
      const errMsg = err.response?.data?.detail || 'Trunk provisioning failed';
      toast.error(errMsg);
    } finally {
      setProvisioningTrunks(false);
    }
  };

  const handleDeleteTrunk = async (trunkId: string) => {
    try {
      await telephonyApi.deleteTrunk(trunkId);
      toast.success('SIP trunk removed.');
      fetchTrunks();
    } catch (err) {
      toast.error('Failed to delete trunk');
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const resolveWebhookUrl = (path: string) => {
    const origin = window.location.origin;
    const backendBase = origin.includes('localhost') || origin.includes('127.0.0.1')
      ? origin.replace('5173', '8000')
      : origin;
    return `${backendBase}/api/v1/telephony/twilio${path}`;
  };

  return (
    <div className="animate-in fade-in duration-500 space-y-6 font-sans text-[var(--text-primary)]">
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-6">
        <div>
          <div className="mb-4">
            <BackButton fallbackPath="/" label="Overview" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Telephony Hub
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]"></span>
            </span>
            <p className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wider">Enterprise Inbound & Outbound Calling</p>
          </div>
        </div>

        {/* HIGH-END NAVIGATION TABS */}
        <div className="flex bg-[var(--surface-secondary)] p-1 rounded-xl border border-[var(--border)] self-start lg:self-auto shadow-sm relative overflow-hidden">
          <button
            onClick={() => setActiveTab('gateways')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 relative z-10 cursor-pointer ${
              activeTab === 'gateways'
                ? 'text-[var(--primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Server size={13} />
            Call Center
            {activeTab === 'gateways' && (
              <motion.div 
                layoutId="telephonyActiveTab"
                className="absolute inset-0 bg-[var(--surface)] border border-[var(--border)] shadow-sm rounded-lg -z-10"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab('twilio')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 relative z-10 cursor-pointer ${
              activeTab === 'twilio'
                ? 'text-[var(--primary)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Key size={13} />
            SIP Gateways
            {activeTab === 'twilio' && (
              <motion.div 
                layoutId="telephonyActiveTab"
                className="absolute inset-0 bg-[var(--surface)] border border-[var(--border)] shadow-sm rounded-lg -z-10"
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        </div>
      </div>

      {activeTab === 'gateways' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Outbound Dialer Column */}
          <div className="lg:col-span-2 space-y-6">
            <div className="card space-y-5">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2 border-b border-[var(--border)] pb-3">
                <PhoneOutgoing size={16} className="text-[var(--primary)]" />
                Outbound Dispatch Control
              </h2>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Target Persona</label>
                    <Select 
                      value={selectedAgentId}
                      onChange={val => setSelectedAgentId(val)}
                      options={[
                        { value: '', label: 'Select Voice Agent...' },
                        ...agents.map(a => ({ value: a.id, label: a.agentName }))
                      ]}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Destination Number</label>
                    <input 
                      className="input-field font-mono"
                      placeholder="+1XXXXXXXXXX"
                      value={targetNumber}
                      onChange={e => setTargetNumber(e.target.value)}
                    />
                  </div>
                </div>

                {/* Dynamic Selected Agent Visual Profile */}
                <AnimatePresence mode="wait">
                  {selectedAgentId ? (
                    (() => {
                      const selectedAgent = agents.find(a => a.id === selectedAgentId);
                      if (!selectedAgent) return null;
                      return (
                        <motion.div
                          key={selectedAgent.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.2 }}
                          className="p-4 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl flex items-start gap-4"
                        >
                          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-base shadow-sm shrink-0">
                            {selectedAgent.agentName.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-sm text-[var(--text-primary)]">{selectedAgent.agentName}</h4>
                              <span className="text-[8px] text-indigo-600 font-bold uppercase tracking-widest bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded">
                                Persona Loaded
                              </span>
                            </div>
                            <p className="text-xs text-[var(--text-secondary)] line-clamp-1 italic">
                              "{selectedAgent.prompt || 'No system instructions provided.'}"
                            </p>
                            <div className="flex gap-2 mt-2">
                              <span className="px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                                Voice: {selectedAgent.tts?.voice || 'Default'}
                              </span>
                              <span className="px-2 py-0.5 bg-[var(--surface)] border border-[var(--border)] rounded text-[8px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                                Lang: {selectedAgent.language || 'hi-IN'}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })()
                  ) : (
                    <div className="p-4 border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface-secondary)] text-center text-xs text-[var(--text-muted)] font-medium py-6">
                      No agent selected. Pick a target persona above to preview system parameters.
                    </div>
                  )}
                </AnimatePresence>

                {/* Highly Reassuring Status Banner */}
                <div className="flex items-center gap-3 p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl">
                  {telephonyStatus?.outbound_active ? (
                    <>
                      <CheckCircle2 size={16} className="text-[var(--success)] shrink-0" />
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-bold text-[var(--success)] uppercase tracking-wider">Outbound Bridge Active</p>
                        <p className="text-[9px] text-[var(--text-secondary)] leading-tight">Ready for high-reliability Twilio & LiveKit call dispatch.</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={16} className="text-[var(--primary)] shrink-0 animate-pulse" />
                      <div className="space-y-0.5">
                        <p className="text-[10px] font-bold text-[var(--primary)] uppercase tracking-wider">REST Outbound Active</p>
                        <p className="text-[9px] text-[var(--text-secondary)] leading-tight">Standard Twilio REST Direct Dialer active for trial testing.</p>
                      </div>
                    </>
                  )}
                </div>
                
                <button 
                  onClick={handleTriggerCall}
                  disabled={loading}
                  className="btn-primary w-full shadow-lg shadow-blue-500/10 hover:shadow-blue-500/20 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none"
                >
                  {loading ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <>
                      <Smartphone size={15} />
                      Execute Outbound Dispatch
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Calls log */}
            <div className="card">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider mb-4 flex items-center gap-2 border-b border-[var(--border)] pb-3">
                <History size={16} className="text-[var(--text-secondary)]" />
                Dispatch Node Logs
              </h2>
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
                {calls.length === 0 ? (
                  <div className="py-12 px-6 text-center border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface-secondary)] flex flex-col items-center justify-center gap-3">
                    <div className="p-3 bg-[var(--surface)] rounded-full border border-[var(--border)] text-[var(--text-muted)] shadow-sm">
                      <History size={20} />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">No Active Sessions</p>
                      <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed max-w-[220px] mx-auto">
                        Trigger an outbound dispatch call above to see live routing sessions and logs.
                      </p>
                    </div>
                  </div>
                ) : calls.map(call => {
                  const statusColors: Record<string, string> = {
                    initiated: 'bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20',
                    failed: 'bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/20',
                    connecting: 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/20',
                  };
                  const statusColor = statusColors[call.status.toLowerCase()] || 'bg-[var(--surface-secondary)] text-[var(--text-secondary)] border-[var(--border)]';
                  
                  return (
                    <div key={call.id} className="flex items-center justify-between p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl hover:border-[var(--border-hover)] transition-all duration-200 group">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-[var(--surface)] border border-[var(--border)] rounded-lg text-[var(--primary)] group-hover:bg-[var(--primary)] group-hover:text-white transition-all duration-200">
                          <Phone size={14} />
                        </div>
                        <div className="space-y-0.5">
                          <p className="font-mono text-xs font-semibold text-[var(--text-primary)] tracking-wide">{call.to_number}</p>
                          <p className="text-[9px] text-[var(--text-muted)] font-medium mt-0.5">
                            {new Date(call.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 border text-[9px] rounded font-bold uppercase tracking-wider flex items-center gap-1 ${statusColor}`}>
                          <span className={`w-1 h-1 rounded-full ${call.status.toLowerCase() === 'initiated' ? 'bg-[var(--success)] animate-pulse' : 'bg-current'}`} />
                          {call.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Numbers list Column */}
          <div className="space-y-6">
             <div className="card">
                <div className="flex justify-between items-center mb-4 border-b border-[var(--border)] pb-3">
                  <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">PSTN Registry</h2>
                  <button 
                      onClick={() => setIsAdding(true)}
                      className="p-1.5 bg-[var(--surface-secondary)] hover:bg-[var(--border)] text-[var(--text-primary)] border border-[var(--border)] rounded-lg transition-all cursor-pointer"
                      title="Link Phone Number"
                  >
                      <Plus size={14} />
                  </button>
                </div>
                <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                  {numbers.length === 0 ? (
                    <div className="py-12 px-6 text-center border border-dashed border-[var(--border)] rounded-xl bg-[var(--surface-secondary)] flex flex-col items-center justify-center gap-3">
                      <div className="p-3 bg-[var(--surface)] rounded-full border border-[var(--border)] text-[var(--text-muted)] shadow-sm">
                        <Phone size={20} />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider">No Numbers Linked</p>
                        <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed max-w-[200px] mx-auto">
                          Link your Twilio number to start routing inbound calls to agents.
                        </p>
                      </div>
                      <button 
                        onClick={() => setIsAdding(true)}
                        className="btn-outline h-8 px-3 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 mt-2 cursor-pointer"
                      >
                        <Plus size={11} /> Link Number
                      </button>
                    </div>
                  ) : numbers.map(num => {
                    const assignedAgent = agents.find(a => a.id === num.agent_id);
                    return (
                      <div key={num.id} className="p-3 bg-[var(--surface-secondary)] rounded-xl border border-[var(--border)] flex justify-between items-center group hover:border-[var(--border-hover)] transition-all duration-200">
                        <div className="space-y-1.5 min-w-0">
                          <p className="font-mono font-semibold text-[var(--text-primary)] tracking-wide text-xs truncate">{num.number}</p>
                          <div className="flex flex-wrap items-center gap-1">
                            <span className="text-[8px] text-[var(--text-secondary)] font-bold uppercase tracking-widest bg-[var(--surface)] border border-[var(--border)] px-1.5 py-0.5 rounded">
                              {num.provider}
                            </span>
                            {assignedAgent && (
                              <span className="text-[8px] text-[var(--primary)] font-bold uppercase tracking-widest bg-blue-500/5 border border-blue-500/10 px-1.5 py-0.5 rounded">
                                → {assignedAgent.agentName}
                              </span>
                            )}
                            {num.sip_trunk_id ? (
                              <span className="text-[8px] text-[var(--success)] font-bold uppercase tracking-widest bg-emerald-500/5 border border-emerald-500/10 px-1.5 py-0.5 rounded">
                                SIP
                              </span>
                            ) : (
                              <span className="text-[8px] text-[var(--text-muted)] font-bold uppercase tracking-widest bg-[var(--surface)] border border-[var(--border)] px-1.5 py-0.5 rounded">
                                PSTN
                              </span>
                            )}
                          </div>
                        </div>
                        <button 
                          onClick={() => handleDeleteNumber(num.id)}
                          className="text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-all duration-200 p-1 hover:bg-red-500/5 rounded border border-transparent hover:border-red-500/10 cursor-pointer"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
             </div>
          </div>
        </div>
      ) : (
        /* LIVEKIT SIP TRUNK CONFIGURATION HUB */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-200">
          <div className="lg:col-span-2 space-y-6">
            {/* LiveKit SIP Trunk Provisioning */}
            <div className="card space-y-5">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2 border-b border-[var(--border)] pb-3">
                <Zap size={16} className="text-[var(--primary)] animate-pulse" />
                LiveKit SIP Trunk Manager
              </h2>

              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Twilio SIP Termination URI</label>
                    <input 
                      type="text"
                      className="input-field font-mono"
                      placeholder="my-trunk.pstn.twilio.com"
                      value={sipConfig.termination_uri}
                      onChange={e => setSipConfig({...sipConfig, termination_uri: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Trunk Identifier Name</label>
                    <input 
                      type="text"
                      className="input-field font-medium"
                      placeholder="twilio-outbound-trunk"
                      value={sipConfig.trunk_name}
                      onChange={e => setSipConfig({...sipConfig, trunk_name: e.target.value})}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">SIP Username</label>
                    <input 
                      type="text"
                      className="input-field"
                      placeholder="twilio-trunk-user"
                      value={sipConfig.auth_username}
                      onChange={e => setSipConfig({...sipConfig, auth_username: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">SIP Password</label>
                    <input 
                      type="password"
                      className="input-field font-mono"
                      placeholder="••••••••••••••"
                      value={sipConfig.auth_password}
                      onChange={e => setSipConfig({...sipConfig, auth_password: e.target.value})}
                    />
                  </div>
                </div>

                <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed font-semibold">
                  Registered E.164 numbers ({numbers.length} active nodes) will route through this gateway configuration dynamically on the SIP network.
                </p>

                <button 
                  onClick={handleProvisionTrunks}
                  disabled={provisioningTrunks}
                  className="btn-primary w-full hover:shadow-lg transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none mt-2"
                >
                  {provisioningTrunks ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    <>
                      <Zap size={14} />
                      Provision Native SIP Gateways
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Active Gateways List */}
            {trunks.length > 0 && (
              <div className="card space-y-4">
                <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2 border-b border-[var(--border)] pb-3">
                  <Link2 size={16} className="text-[var(--primary)]" />
                  Provisioned Endpoints
                </h2>
                <div className="space-y-2">
                  {trunks.map(trunk => (
                    <div key={trunk.id} className="p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl flex justify-between items-center group hover:border-[var(--border-hover)] transition-all duration-200">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-mono text-xs font-semibold text-[var(--text-primary)] truncate">{trunk.name}</p>
                          <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                            trunk.trunk_type === 'inbound' 
                              ? 'bg-blue-500/10 text-[var(--primary)] border border-blue-500/20'
                              : 'bg-emerald-500/10 text-[var(--success)] border border-emerald-500/20'
                          }`}>
                            {trunk.trunk_type}
                          </span>
                        </div>
                        <p className="text-[9px] text-[var(--text-muted)] font-mono leading-none truncate">{trunk.livekit_trunk_id || trunk.id}</p>
                      </div>
                      <button 
                        onClick={() => handleDeleteTrunk(trunk.id)}
                        className="text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-all duration-200 p-1 hover:bg-red-500/5 rounded border border-transparent hover:border-red-500/10"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Primary Twilio REST API Credentials */}
            <div className="card space-y-5">
              <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2 border-b border-[var(--border)] pb-3">
                <Key size={16} className="text-[var(--primary)]" />
                Twilio Account Credentials (REST)
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Twilio Account SID</label>
                    <input 
                      type="text" 
                      className="input-field" 
                      placeholder="ACXXXXXXXX" 
                      value={twilioKeys.twilio_account_sid} 
                      onChange={e => setTwilioKeys({...twilioKeys, twilio_account_sid: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Twilio Assigned Number</label>
                    <input 
                      type="text" 
                      className="input-field font-mono" 
                      placeholder="+1XXXXXXXXXX" 
                      value={twilioKeys.twilio_phone_number} 
                      onChange={e => setTwilioKeys({...twilioKeys, twilio_phone_number: e.target.value})} 
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Twilio Auth Token</label>
                    <input 
                      type="password" 
                      className="input-field font-mono" 
                      placeholder="••••••••••••••••••••••••••••••••" 
                      value={twilioKeys.twilio_auth_token} 
                      onChange={e => setTwilioKeys({...twilioKeys, twilio_auth_token: e.target.value})} 
                    />
                  </div>
                </div>
                <button 
                  onClick={handleSaveTwilioKeys} 
                  disabled={savingKeys} 
                  className="btn-outline w-full hover:shadow transition-all duration-200 mt-2"
                >
                  {savingKeys ? <Loader2 className="animate-spin" size={16} /> : <><ShieldCheck size={14} className="text-[var(--success)]" /> Sync Twilio Profile</>}
                </button>
              </div>
            </div>
          </div>

          {/* SETUP INSTRUCTIONS SIDEBAR */}
          <div className="space-y-6">
            <div className="card space-y-5">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider flex items-center gap-2 border-b border-[var(--border)] pb-3">
                <ToggleLeft size={16} className="text-[var(--primary)]" />
                SIP Routing Hook
              </h2>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed font-medium">
                Direct your incoming Twilio traffic to our LiveKit SIP bridge gateway to answer dynamically:
              </p>

              <div className="space-y-4">
                <div className="space-y-1">
                  <span className="text-[9px] text-[var(--text-secondary)] font-extrabold uppercase tracking-widest block mb-1">Twilio Inbound Webhook</span>
                  <div className="flex bg-[var(--surface-secondary)] rounded-xl border border-[var(--border)] p-3 items-center justify-between shadow-sm min-w-0">
                    <span className="font-mono text-[9px] text-[var(--text-secondary)] truncate flex-1 min-w-0 mr-2">
                      {resolveWebhookUrl('/inbound')}
                    </span>
                    <button
                      onClick={() => handleCopy(resolveWebhookUrl('/inbound'), 'Twilio Webhook')}
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                    >
                      {copiedText === 'Twilio Webhook' ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[9px] text-[var(--text-secondary)] font-extrabold uppercase tracking-widest block mb-1">LiveKit SIP Origination URI</span>
                  <div className="flex bg-[var(--surface-secondary)] rounded-xl border border-[var(--border)] p-3 items-center justify-between shadow-sm min-w-0">
                    <span className="font-mono text-[9px] text-[var(--text-secondary)] truncate flex-1 min-w-0 mr-2">
                      {telephonyStatus?.origination_uri || 'sip:sip.livekit.cloud;transport=tcp'}
                    </span>
                    <button
                      onClick={() => handleCopy(telephonyStatus?.origination_uri || 'sip:sip.livekit.cloud;transport=tcp', 'Origination URI')}
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                    >
                      {copiedText === 'Origination URI' ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>

                <div className="border-t border-[var(--border)] pt-4 space-y-3">
                  <strong className="text-[var(--text-primary)] uppercase tracking-wider text-[10px] block">Instructions:</strong>
                  <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl text-[9px] leading-relaxed font-semibold">
                    <strong className="text-[var(--primary)] block mb-1">Method A: Webhook routing (Fastest)</strong>
                    <p className="text-[var(--text-secondary)]">
                      1. Copy the webhook URL above.<br />
                      2. Paste it in your Twilio Console under Phone Number &rarr; Voice Config &rarr; Webhook.<br />
                      3. Test inbound calling immediately!
                    </p>
                  </div>
                  <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl text-[9px] leading-relaxed font-semibold">
                    <strong className="text-[var(--success)] block mb-1">Method B: SIP Trunking (Trunk Core)</strong>
                    <p className="text-[var(--text-secondary)]">
                      1. Copy the LiveKit SIP Origination URI.<br />
                      2. Paste it in your Twilio Elastic SIP Trunk Origination.<br />
                      3. Add SIP Gateways on the left to verify active auth handshakes.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LINK PHONE NUMBER MODAL */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[100] animate-in fade-in duration-200">
          <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-[390px] rounded-2xl p-6 shadow-xl relative overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-5 border-b border-[var(--border)] pb-3">
              <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">Link PSTN Endpoint</h2>
              <button onClick={() => setIsAdding(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 hover:bg-[var(--surface-secondary)] rounded-lg transition-all">
                <X size={15} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">E.164 Phone Number</label>
                <input 
                  className="input-field font-mono"
                  placeholder="+1XXXXXXXXXX"
                  value={newNumber.number}
                  onChange={e => setNewNumber({...newNumber, number: e.target.value})}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Provider Node Gateway</label>
                <Select 
                  value={newNumber.provider}
                  onChange={val => setNewNumber({...newNumber, provider: val})}
                  options={[
                    { value: 'twilio', label: 'Twilio Node Gateway' },
                    { value: 'custom', label: 'Generic Custom SIP Node' }
                  ]}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Assigned Voice Agent</label>
                <Select 
                  value={newNumber.agent_id}
                  onChange={val => setNewNumber({...newNumber, agent_id: val})}
                  options={[
                    { value: '', label: 'No Agent (Disable Inbound)' },
                    ...agents.map(a => ({ value: a.id, label: a.agentName }))
                  ]}
                />
              </div>

              <button 
                onClick={handleAddNumber}
                disabled={loading}
                className="btn-primary w-full mt-2"
              >
                {loading ? <Loader2 className="animate-spin" size={16} /> : (
                  <>
                    <Smartphone size={14} />
                    Register PSTN Node
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
