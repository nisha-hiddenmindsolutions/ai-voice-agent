import React, { useState, useEffect } from 'react';
import { 
  ArrowRight, 
  ShieldCheck, 
  Zap, 
  Trash2, 
  FileJson, 
  X, 
  Info,
  Phone,
  Copy,
  Check,
  Smartphone,
  Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';

interface Integration {
    id: string;
    provider: string;
    integration_type: string;
    scopes: string[];
    created_at: string;
}

import {
  SiN8n,
} from "@icons-pack/react-simple-icons";

const GoogleIcon = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0 animate-fade-in" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05" />
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335" />
  </svg>
);

const MicrosoftIcon = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 23 23" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="11" height="11" fill="#F25022" />
    <rect x="12" y="0" width="11" height="11" fill="#7FBA00" />
    <rect x="0" y="12" width="11" height="11" fill="#00A4EF" />
    <rect x="12" y="12" width="11" height="11" fill="#FFB900" />
  </svg>
);

const TwilioIcon = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#F22F46" />
    <circle cx="9" cy="9" r="2" fill="white" />
    <circle cx="15" cy="9" r="2" fill="white" />
    <circle cx="9" cy="15" r="2" fill="white" />
    <circle cx="15" cy="15" r="2" fill="white" />
  </svg>
);

const N8nIcon = ({ size = 22 }: { size?: number }) => (
  <SiN8n color="default" size={size} className="shrink-0" />
);

const MakeIcon = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" style={{ width: size, height: size }} className="shrink-0" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#EA2B8C" opacity="0.15"/>
    <path d="M12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6ZM14.5 13H9.5V11H14.5V13Z" fill="#EA2B8C"/>
  </svg>
);

export const IntegrationsPage: React.FC = () => {
    const [userIntegrations, setUserIntegrations] = useState<Integration[]>([]);
    const [loading, setLoading] = useState(true);
    
    // Service Account Google Modal
    const [showKeyModal, setShowKeyModal] = useState(false);
    const [jsonKey, setJsonKey] = useState('');
    
    // Twilio Modal & Secrets State
    const [showTwilioModal, setShowTwilioModal] = useState(false);
    const [hasTwilio, setHasTwilio] = useState(false);
    const [twilioKeys, setTwilioKeys] = useState({
        twilio_account_sid: '',
        twilio_auth_token: '',
        twilio_phone_number: ''
    });

    // Automation Integrations (n8n & Make)
    const [hasN8n, setHasN8n] = useState(false);
    const [n8nWebhookUrl, setN8nWebhookUrl] = useState('');
    const [hasMake, setHasMake] = useState(false);
    const [makeWebhookUrl, setMakeWebhookUrl] = useState('');
    const [showAutomationModal, setShowAutomationModal] = useState(false);
    const [automationProvider, setAutomationProvider] = useState<'n8n' | 'make' | null>(null);
    const [automationInput, setAutomationInput] = useState('');

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [copiedText, setCopiedText] = useState<string | null>(null);

    const integrationsMetadata = [
        {
            id: 'google',
            name: 'Google Workspace',
            description: 'Link your Google Account to authorize Sheets, Calendar, and automated workflows.',
            icon: GoogleIcon,
        },
        {
            id: 'microsoft',
            name: 'Microsoft 365',
            description: 'Outlook & Excel tasks.',
            icon: MicrosoftIcon,
        },
        {
            id: 'twilio',
            name: 'Twilio Telephony',
            description: 'Direct cellular calls & inbound routing.',
            icon: TwilioIcon,
        }
    ];

    const fetchIntegrations = async () => {
        try {
            const [intResp, keyResp] = await Promise.all([
                api.get('/integrations/'),
                api.get('/keys/')
            ]);
            setUserIntegrations(intResp.data);
            
            const keys = keyResp.data.keys || {};
            setTwilioKeys({
                twilio_account_sid: keys.twilio_account_sid || '',
                twilio_auth_token: keys.twilio_auth_token || '',
                twilio_phone_number: keys.twilio_phone_number || ''
            });
            
            setHasTwilio(!!keys.twilio_account_sid && !!keys.twilio_phone_number);
        } catch (err) {
            console.error('Failed to fetch integrations or secrets profile', err);
        } finally {
            setTimeout(() => setLoading(false), 500);
        }
    };

    useEffect(() => {
        fetchIntegrations();

        // Check for OAuth outcome in URL
        const params = new URLSearchParams(window.location.search);
        if (params.get('status') === 'success') {
            toast.success('Integration Connected successfully!');
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (params.get('status') === 'error') {
            toast.error('OAuth authorization failed. Please verify credentials.');
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }, []);

    const handleConnect = async (provider: string) => {
        try {
            const resp = await api.get(`/integrations/${provider}/authorize`);
            if (resp.data.url) {
                window.location.href = resp.data.url;
            }
        } catch (err) {
            toast.error(`Failed to initialize ${provider.toUpperCase()} Gateway.`);
        }
    };

    const handleServiceAccountSubmit = async () => {
        if (!jsonKey.trim()) return toast.error('Please paste your JSON key');
        
        setIsSubmitting(true);
        const toastId = toast.loading('Connecting Integration...');
        try {
            const credentials = JSON.parse(jsonKey);
            await api.post('/integrations/service-account', {
                provider: 'google',
                credentials
            });
            
            toast.success('Integration Connected successfully!', { id: toastId });
            setShowKeyModal(false);
            setJsonKey('');
            fetchIntegrations();
        } catch (err) {
            console.error('Failed to save service account', err);
            toast.error('Invalid JSON key or Authorization failure', { id: toastId });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSaveTwilioKeys = async () => {
        setIsSubmitting(true);
        const toastId = toast.loading('Vaulting Twilio secrets...');
        try {
            await api.post('/keys/', twilioKeys);
            toast.success('Twilio Telephony Active!', { id: toastId });
            setShowTwilioModal(false);
            fetchIntegrations();
        } catch (err) {
            toast.error('Credential synchronization failed.', { id: toastId });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDisconnect = async (id: string) => {
        try {
            await api.delete(`/integrations/${id}`);
            toast.success('Integration disconnected.');
            fetchIntegrations();
        } catch (err) {
            toast.error('Failed to disconnect.');
        }
    };

    const handleCopy = (text: string, label: string) => {
        navigator.clipboard.writeText(text);
        setCopiedText(label);
        toast.success(`${label} copied to clipboard`);
        setTimeout(() => setCopiedText(null), 2000);
    };

    const getStatus = (provider: string) => {
        return userIntegrations.find(i => i.provider === provider);
    };

    const resolveWebhookUrl = (path: string) => {
        const origin = window.location.origin;
        const backendBase = origin.includes('localhost') || origin.includes('127.0.0.1')
          ? origin.replace('5173', '8000')
          : origin;
        return `${backendBase}/api/v1/telephony/twilio${path}`;
    };

  return (
    <div className="max-w-[1400px] mx-auto pb-12 animate-in fade-in duration-500 font-sans text-[var(--text-primary)] relative">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 relative z-10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <Zap size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)]">Integrations Hub</h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 font-medium ml-[52px]">Configure enterprise connected accounts, telephony trunks, and workflow webhooks.</p>
        </div>

        <div className="flex items-center gap-3.5 self-start md:self-auto">
          <div className="h-10 px-4 border border-[var(--border)] bg-[var(--surface-secondary)] rounded-xl flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--success)] shadow-sm">
            <ShieldCheck size={14} className="text-[var(--success)]" />
            <span>Vault Encrypted</span>
          </div>
        </div>
      </div>

      {/* INTEGRATION GRID */}
      <div className="relative z-10">
        {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-60 card animate-pulse bg-[var(--surface-secondary)]/50" />
                    ))}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {integrationsMetadata.map((int) => {
                        const isTwilio = int.id === 'twilio';
                        const isN8n = int.id === 'n8n';
                        const isMake = int.id === 'make';
                        
                        const isConnected = isTwilio 
                            ? hasTwilio 
                            : isN8n 
                                ? hasN8n 
                                : isMake 
                                    ? hasMake 
                                    : !!getStatus(int.id);
                        
                        const oauthIntegration = (isTwilio || isN8n || isMake) ? null : getStatus(int.id);
                        
                        return (
                            <div 
                                key={int.id}
                                className="card-shimmer flex flex-col justify-between min-h-[270px] relative overflow-hidden group cursor-default"
                            >
                                <div>
                                    {/* TOP BRAND ICON & STATUS */}
                                    <div className="flex items-start justify-between mb-5">
                                        <div className="w-14 h-14 rounded-2xl bg-[var(--surface-secondary)] border border-[var(--border)] flex items-center justify-center shadow-sm p-3">
                                            <int.icon size={26} />
                                        </div>
 
                                        <span className={`px-2.5 py-0.5 border text-[9px] rounded font-extrabold uppercase tracking-widest flex items-center gap-1 ${
                                            isConnected 
                                                ? 'bg-emerald-500/10 border-emerald-500/20 text-[var(--success)] animate-pulse' 
                                                : 'bg-[var(--surface-secondary)] border-[var(--border)] text-[var(--text-muted)]'
                                        }`}>
                                            <span className={`w-1 h-1 rounded-full ${isConnected ? 'bg-[var(--success)]' : 'bg-current'}`} />
                                            {isTwilio 
                                                ? (hasTwilio ? 'Active Node' : 'Offline')
                                                : isN8n 
                                                    ? (hasN8n ? 'Active' : 'Offline')
                                                    : isMake 
                                                        ? (hasMake ? 'Active' : 'Offline')
                                                        : oauthIntegration ? (oauthIntegration.integration_type === 'SERVICE_ACCOUNT' ? 'Service Active' : 'OAuth Active') : 'Offline'
                                            }
                                        </span>
                                    </div>
 
                                    {/* INFO TEXT */}
                                    <div className="space-y-1.5 mb-5">
                                        <h3 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
                                            {int.name}
                                        </h3>
                                        <p className="text-[var(--text-secondary)] text-sm font-medium leading-relaxed">
                                            {int.description}
                                        </p>
                                    </div>
                                </div>
 
                                {/* CONTEXT ACTION BUTTONS */}
                                <div>
                                    {isTwilio ? (
                                        <button 
                                            onClick={() => setShowTwilioModal(true)}
                                            className={`${hasTwilio ? 'btn-outline' : 'btn-primary'} w-full flex items-center justify-between px-4 text-xs font-bold uppercase tracking-wider h-10`}
                                        >
                                            <span>{hasTwilio ? 'Edit Credentials' : 'Link Twilio Trunk'}</span>
                                            <ArrowRight size={13} />
                                        </button>
                                    ) : (isN8n || isMake) ? (
                                        <div className="space-y-2">
                                            {isConnected ? (
                                                <button 
                                                    onClick={() => {
                                                        if (isN8n) { setHasN8n(false); setN8nWebhookUrl(''); }
                                                        else { setHasMake(false); setMakeWebhookUrl(''); }
                                                        toast.success(`${int.name} disconnected`);
                                                    }}
                                                    className="btn-danger w-full flex items-center justify-center gap-1.5 h-10"
                                                >
                                                    <Trash2 size={13} />
                                                    Disconnect
                                                </button>
                                            ) : (
                                                <button 
                                                    onClick={() => {
                                                        setAutomationProvider(int.id as 'n8n' | 'make');
                                                        setAutomationInput(int.id === 'n8n' ? n8nWebhookUrl : makeWebhookUrl);
                                                        setShowAutomationModal(true);
                                                    }}
                                                    className="btn-primary w-full flex items-center justify-between px-4 text-xs font-bold uppercase tracking-wider h-10"
                                                >
                                                    <span>{`Link ${int.name}`}</span>
                                                    <ArrowRight size={13} />
                                                </button>
                                            )}
                                        </div>
                                    ) : oauthIntegration ? (
                                        <button 
                                            onClick={() => handleDisconnect(oauthIntegration.id)}
                                            className="btn-danger w-full flex items-center justify-center gap-1.5 h-10"
                                        >
                                            <Trash2 size={13} />
                                            Disconnect Server
                                        </button>
                                    ) : (
                                        <button 
                                            onClick={() => handleConnect(int.id)}
                                            className="btn-primary w-full flex items-center justify-between px-4 text-xs font-bold uppercase tracking-wider h-10 shadow-sm"
                                        >
                                            <span>OAuth Gateway Login</span>
                                            <ArrowRight size={13} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* NEURAL ADVISORY TIP */}
                    <div className="xl:col-span-3 p-4 bg-[var(--surface-secondary)] border border-dashed border-[var(--border)] rounded-2xl flex flex-col md:flex-row items-center gap-3 mt-2 shadow-sm">
                        <div className="w-9 h-9 rounded-xl bg-blue-500/5 flex items-center justify-center shrink-0 border border-blue-500/10">
                            <Zap size={15} className="text-[var(--primary)] animate-pulse" />
                        </div>
                        <div className="flex-1 space-y-0.5">
                            <h4 className="text-[var(--text-primary)] text-xs font-bold uppercase tracking-wider">Gateway Configuration Advisory</h4>
                            <p className="text-[var(--text-secondary)] text-[11px] leading-relaxed font-semibold">
                                The <span className="text-[var(--primary)] font-bold">Twilio Telephony Integration</span> connects real virtual numbers to AI voice agents, dispatching automated conversations dynamically through local SIP gateways.
                            </p>
                        </div>
                    </div>
                </div>
            )}
            </div>

            {/* GOOGLE SERVICE ACCOUNT MODAL */}
            {showKeyModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[100] animate-in fade-in duration-200">
                    <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-md rounded-2xl overflow-hidden shadow-xl animate-in zoom-in-95 duration-200 flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-blue-500/5 border border-blue-500/10 flex items-center justify-center">
                                    <FileJson className="text-[var(--primary)]" size={15} />
                                </div>
                                <div>
                                    <h2 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider leading-none">Google Service Account</h2>
                                    <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider mt-1">Direct credential configuration</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowKeyModal(false)}
                                className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                            >
                                <X size={15} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl flex gap-2.5">
                                <Info size={15} className="text-[var(--primary)] shrink-0 mt-0.5" />
                                <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed font-semibold">
                                    Paste the complete credentials JSON object of your <span className="text-[var(--primary)] font-bold">Google Cloud Service Account key</span> file here.
                                </p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">JSON Key Content</label>
                                <textarea 
                                    className="w-full h-32 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3 font-mono text-[10px] text-[var(--primary)] outline-none focus:border-[var(--border-focus)] transition resize-none leading-relaxed"
                                    placeholder='{ "type": "service_account", ... }'
                                    value={jsonKey}
                                    onChange={(e) => setJsonKey(e.target.value)}
                                />
                            </div>

                            <button 
                                onClick={handleServiceAccountSubmit}
                                disabled={isSubmitting}
                                className="btn-primary w-full h-11"
                            >
                                {isSubmitting ? 'Verifying Link...' : 'Sync Service Credentials'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* TWILIO GATEWAY CONFIGURATION MODAL */}
            {showTwilioModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[100] animate-in fade-in duration-200">
                    <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-[500px] rounded-2xl overflow-hidden shadow-xl animate-in zoom-in-95 duration-200 flex flex-col relative">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-red-500/5 border border-red-500/10 flex items-center justify-center">
                                    <Phone className="text-[var(--primary)]" size={15} />
                                </div>
                                <div>
                                    <h2 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider leading-none">Twilio Connection</h2>
                                    <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider mt-1">Configure Vault Telephony secrets</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowTwilioModal(false)}
                                className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                            >
                                <X size={15} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Twilio Account SID</label>
                                    <input 
                                        className="input-field"
                                        placeholder="ACXXXXXXXXXXXXXXXX"
                                        value={twilioKeys.twilio_account_sid}
                                        onChange={e => setTwilioKeys({...twilioKeys, twilio_account_sid: e.target.value})}
                                    />
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Twilio Phone Number</label>
                                    <input 
                                        className="input-field font-mono"
                                        placeholder="+1XXXXXXXXXX"
                                        value={twilioKeys.twilio_phone_number}
                                        onChange={e => setTwilioKeys({...twilioKeys, twilio_phone_number: e.target.value})}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Twilio Auth Token</label>
                                    <input 
                                        type="password"
                                        className="input-field font-mono"
                                        placeholder="Vaulted Secure Token"
                                        value={twilioKeys.twilio_auth_token}
                                        onChange={e => setTwilioKeys({...twilioKeys, twilio_auth_token: e.target.value})}
                                    />
                                </div>
                            </div>

                            {/* WEBHOOK CORNER */}
                            <div className="border-t border-[var(--border)] pt-4 space-y-3">
                                <h3 className="text-[9px] font-bold text-[var(--text-primary)] uppercase tracking-wider">Twilio callback webhooks</h3>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-1">
                                        <span className="text-[9px] text-[var(--text-muted)] font-extrabold uppercase tracking-widest">Inbound Route Hook</span>
                                        <div className="flex bg-[var(--surface-secondary)] rounded-xl border border-[var(--border)] p-2.5 items-center justify-between shadow-sm min-w-0">
                                            <span className="font-mono text-[8px] text-[var(--text-secondary)] truncate flex-1 min-w-0 mr-1">
                                                {resolveWebhookUrl('/inbound')}
                                            </span>
                                            <button
                                                onClick={() => handleCopy(resolveWebhookUrl('/inbound'), 'Inbound Hook')}
                                                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                                            >
                                                {copiedText === 'Inbound Hook' ? <Check size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-1">
                                        <span className="text-[9px] text-[var(--text-muted)] font-extrabold uppercase tracking-widest">Outbound Flow Hook</span>
                                        <div className="flex bg-[var(--surface-secondary)] rounded-xl border border-[var(--border)] p-2.5 items-center justify-between shadow-sm min-w-0">
                                            <span className="font-mono text-[8px] text-[var(--text-secondary)] truncate flex-1 min-w-0 mr-1">
                                                {resolveWebhookUrl('/flow')}
                                            </span>
                                            <button
                                                onClick={() => handleCopy(resolveWebhookUrl('/flow'), 'Outbound Flow Hook')}
                                                className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                                            >
                                                {copiedText === 'Outbound Flow Hook' ? <Check size={11} className="text-[var(--success)]" /> : <Copy size={11} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <button 
                                onClick={handleSaveTwilioKeys}
                                disabled={isSubmitting}
                                className="btn-primary w-full h-11 flex items-center justify-center mt-2"
                            >
                                {isSubmitting ? (
                                    <Loader2 className="animate-spin" size={16} />
                                ) : (
                                    <>
                                        <Smartphone size={14} />
                                        Sync Twilio Profile
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* AUTOMATION MODAL (n8n / Make.com) */}
            {showAutomationModal && automationProvider && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[100] animate-in fade-in duration-200">
                    <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-md rounded-2xl overflow-hidden shadow-xl animate-in zoom-in-95 duration-200 flex flex-col relative">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-[var(--surface-secondary)] border border-[var(--border)] flex items-center justify-center p-1">
                                    {automationProvider === 'n8n' ? <N8nIcon size={16} /> : <MakeIcon size={16} />}
                                </div>
                                <div>
                                    <h2 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider leading-none">
                                        {automationProvider === 'n8n' ? 'n8n Automation' : 'Make.com Flow'}
                                    </h2>
                                    <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider mt-1">
                                        Link Voice Transcripts & Webhooks
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => { setShowAutomationModal(false); setAutomationInput(''); }}
                                className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
                            >
                                <X size={15} />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl flex gap-2.5">
                                <Info size={15} className="text-[var(--primary)] shrink-0 mt-0.5" />
                                <p className="text-[10px] text-[var(--text-secondary)] leading-relaxed font-semibold">
                                    Enter your workflow webhook URL. When a call completes, a payload containing transcripts, caller intelligence, and duration will automatically dispatch.
                                </p>
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">
                                    {automationProvider === 'n8n' ? 'n8n Webhook URL' : 'Make Custom Webhook URL'}
                                </label>
                                <input 
                                    className="input-field"
                                    placeholder={automationProvider === 'n8n' ? "https://n8n.yourdomain.com/webhook/..." : "https://hook.us1.make.com/..."}
                                    value={automationInput}
                                    onChange={e => setAutomationInput(e.target.value)}
                                />
                            </div>

                            <button 
                                onClick={() => {
                                    if (!automationInput.trim()) {
                                        toast.error('Webhook URL is required');
                                        return;
                                    }
                                    if (automationProvider === 'n8n') {
                                        setHasN8n(true);
                                        setN8nWebhookUrl(automationInput);
                                    } else {
                                        setHasMake(true);
                                        setMakeWebhookUrl(automationInput);
                                    }
                                    setShowAutomationModal(false);
                                    toast.success(`${automationProvider === 'n8n' ? 'n8n' : 'Make.com'} automation linked successfully!`);
                                }}
                                className="btn-primary w-full h-11"
                            >
                                Link Workflow
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
