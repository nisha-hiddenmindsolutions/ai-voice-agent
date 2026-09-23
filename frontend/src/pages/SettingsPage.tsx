import { useState, useEffect } from 'react';
import {
  Shield,
  Phone,
  Globe,
  Bell,
  Clock,
  Key,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Server,
  User,
  Mail,
  Calendar,
  Hash,
  Zap,
  Languages,
  Timer,
} from 'lucide-react';
import { settingsApi } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { Select } from '../components/ui/Select';
import toast from 'react-hot-toast';

const SettingsPage = () => {
  const user = useAuthStore(state => state.user);

  // Telephony
  const [telephony, setTelephony] = useState({
    twilio_account_sid: '',
    twilio_auth_token: '',
    twilio_phone_number: '',
    default_agent_id: '',
    has_sip_trunks: false,
    inbound_active: false,
    outbound_active: false,
    trunk_count: 0,
  });

  // General
  const [general, setGeneral] = useState({
    timezone: 'UTC',
    default_language: 'en',
    notifications_enabled: true,
    auto_disconnect_seconds: 300,
  });

  // Account
  const [account, setAccount] = useState<any>(null);

  // Loading
  const [savingTelephony, setSavingTelephony] = useState(false);
  const [savingGeneral, setSavingGeneral] = useState(false);

  const [activeSection, setActiveSection] = useState<'telephony' | 'general' | 'account'>('telephony');

  useEffect(() => {
    const load = async () => {
      try {
        const [telResp, genResp, accResp] = await Promise.all([
          settingsApi.getTelephony(),
          settingsApi.getGeneral(),
          settingsApi.getAccount(),
        ]);
        setTelephony(telResp.data);
        setGeneral(genResp.data);
        setAccount(accResp.data);
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    load();
  }, []);

  const handleSaveTelephony = async () => {
    setSavingTelephony(true);
    try {
      // isMasked: the backend returns "****abcd" for existing values.
      // We only skip sending if the value is masked (already saved).
      // If empty → the user cleared it; skip to avoid overwriting with blank.
      // If changed (no asterisks, non-empty) → send it.
      const isMasked = (value?: string) =>
        !!value && value.includes('*');

      const payload: any = {
        default_agent_id: telephony.default_agent_id || null,
      };

      const sid = telephony.twilio_account_sid.trim();
      if (sid && !isMasked(sid)) {
        payload.twilio_account_sid = sid;
      }

      const token = telephony.twilio_auth_token.trim();
      if (token && !isMasked(token)) {
        payload.twilio_auth_token = token;
      }

      const phone = telephony.twilio_phone_number.trim();
      if (phone && !isMasked(phone)) {
        payload.twilio_phone_number = phone;
      }

      await settingsApi.updateTelephony(payload);
      // Re-fetch so masked values reload correctly
      const refreshed = await settingsApi.getTelephony();
      setTelephony(refreshed.data);
      toast.success('Telephony settings saved.');
    } catch (err) {
      toast.error('Failed to save telephony settings.');
    } finally {
      setSavingTelephony(false);
    }
  };

  const handleSaveGeneral = async () => {
    setSavingGeneral(true);
    try {
      await settingsApi.updateGeneral(general);
      toast.success('General settings saved.');
    } catch (err) {
      toast.error('Failed to save general settings.');
    } finally {
      setSavingGeneral(false);
    }
  };

  const sections = [
    { id: 'telephony' as const, label: 'Telephony', icon: Phone },
    { id: 'general' as const, label: 'General', icon: Globe },
    { id: 'account' as const, label: 'Account', icon: User },
  ];

  return (
    <div className="max-w-[1400px] mx-auto pb-24 animate-in fade-in duration-300 relative">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8 relative z-10">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <Shield size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)]">Settings</h1>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1 font-medium ml-[52px]">System configuration and preferences</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* SIDEBAR NAV */}
        <div className="lg:col-span-1">
          <div className="card p-2 sticky top-24">
            <nav className="space-y-1">
              {sections.map(s => (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
                  style={{
                    backgroundColor: activeSection === s.id ? 'var(--sidebar-item-active-bg)' : 'transparent',
                    color: activeSection === s.id ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                    border: activeSection === s.id ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                  }}
                >
                  <s.icon size={16} />
                  {s.label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* MAIN CONTENT */}
        <div className="lg:col-span-3 space-y-6">
          {/* TELEPHONY SECTION */}
          {activeSection === 'telephony' && (
            <div className="animate-in fade-in duration-300 space-y-4">
              {/* SIP Trunk Status */}
              <div className="card p-6">
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-4" style={{ color: 'var(--text-primary)' }}>
                  <Server size={15} style={{ color: 'var(--warning)' }} />
                  SIP Trunk Status
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <StatusBox 
                    label="Provisioned" 
                    value={`${telephony.trunk_count} Trunks`} 
                    isActive={telephony.has_sip_trunks} 
                  />
                  <StatusBox 
                    label="Inbound" 
                    value={telephony.inbound_active ? 'Active' : 'Inactive'} 
                    isActive={telephony.inbound_active} 
                  />
                  <StatusBox 
                    label="Outbound" 
                    value={telephony.outbound_active ? 'Active' : 'Inactive'} 
                    isActive={telephony.outbound_active} 
                  />
                </div>
              </div>

              {/* Twilio Credentials */}
              <div className="card p-6">
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-4" style={{ color: 'var(--text-primary)' }}>
                  <Key size={15} style={{ color: 'var(--warning)' }} />
                  Twilio Credentials
                </h2>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <InputField
                      label="Account SID"
                      value={telephony.twilio_account_sid}
                      onChange={(v: string) => setTelephony({ ...telephony, twilio_account_sid: v })}
                      placeholder="ACXXXXXXXX"
                      icon={<Hash size={13} />}
                    />
                    <InputField
                      label="Phone Number"
                      value={telephony.twilio_phone_number}
                      onChange={(v: string) => setTelephony({ ...telephony, twilio_phone_number: v })}
                      placeholder="+1234567890"
                      icon={<Phone size={13} />}
                      mono
                    />
                  </div>
                  <InputField
                    label="Auth Token"
                    value={telephony.twilio_auth_token}
                    onChange={(v: string) => setTelephony({ ...telephony, twilio_auth_token: v })}
                    placeholder="Secure token"
                    icon={<Shield size={13} />}
                    type="password"
                  />

                  <button
                    onClick={handleSaveTelephony}
                    disabled={savingTelephony}
                    className="w-full bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {savingTelephony ? <Loader2 className="animate-spin" size={16} /> : (
                      <>
                        <Save size={14} />
                        Save Telephony Settings
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* GENERAL SECTION */}
          {activeSection === 'general' && (
            <div className="animate-in fade-in duration-300 space-y-4">
              <div className="card p-6">
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-4" style={{ color: 'var(--text-primary)' }}>
                  <Globe size={15} style={{ color: 'var(--primary)' }} />
                  Preferences
                </h2>

                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Timezone */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                        <Clock size={12} /> Timezone
                      </label>
                      <Select
                        value={general.timezone}
                        onChange={val => setGeneral({ ...general, timezone: val })}
                        options={[
                          { value: 'UTC', label: 'UTC' },
                          { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
                          { value: 'America/New_York', label: 'America/New_York (EST)' },
                          { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
                          { value: 'Europe/London', label: 'Europe/London (GMT)' },
                          { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
                          { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
                          { value: 'Australia/Sydney', label: 'Australia/Sydney (AEDT)' }
                        ]}
                      />
                    </div>

                    {/* Default Language */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                        <Languages size={12} /> Default Language
                      </label>
                      <Select
                        value={general.default_language}
                        onChange={val => setGeneral({ ...general, default_language: val })}
                        options={[
                          { value: 'en', label: 'English' },
                          { value: 'hi-IN', label: 'Hindi' },
                          { value: 'es', label: 'Spanish' },
                          { value: 'fr', label: 'French' },
                          { value: 'de', label: 'German' },
                          { value: 'ja', label: 'Japanese' }
                        ]}
                      />
                    </div>
                  </div>

                  {/* Auto-disconnect Timer */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                      <Timer size={12} /> Auto-Disconnect Timer (seconds)
                    </label>
                    <input
                      type="number"
                      className="input-field font-mono"
                      value={general.auto_disconnect_seconds}
                      onChange={e => setGeneral({ ...general, auto_disconnect_seconds: parseInt(e.target.value) || 300 })}
                      min={30}
                      max={3600}
                    />
                  </div>

                  {/* Notifications Toggle */}
                  <div className="flex items-center justify-between p-4 rounded-lg" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center gap-3">
                      <Bell size={15} style={{ color: 'var(--text-muted)' }} />
                      <div>
                        <span className="text-sm font-medium block" style={{ color: 'var(--text-primary)' }}>Notifications</span>
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Receive alerts for call events</span>
                      </div>
                    </div>
                    <button
                      onClick={() => setGeneral({ ...general, notifications_enabled: !general.notifications_enabled })}
                      className="w-11 h-6 rounded-full transition-all duration-300 relative"
                      style={{ backgroundColor: general.notifications_enabled ? 'var(--success)' : 'var(--border)' }}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white shadow-md absolute top-0.5 transition-all duration-300 ${
                        general.notifications_enabled ? 'left-5.5' : 'left-0.5'
                      }`} />
                    </button>
                  </div>

                  <button
                    onClick={handleSaveGeneral}
                    disabled={savingGeneral}
                    className="w-full bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 px-4 py-2.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {savingGeneral ? <Loader2 className="animate-spin" size={16} /> : (
                      <>
                        <Save size={14} />
                        Save General Settings
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ACCOUNT SECTION */}
          {activeSection === 'account' && (
            <div className="animate-in fade-in duration-300 space-y-4">
              <div className="card p-6">
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-4" style={{ color: 'var(--text-primary)' }}>
                  <User size={15} style={{ color: '#8B5CF6' }} />
                  Account Information
                </h2>

                <div className="space-y-2">
                  <InfoRow icon={<User size={13} />} label="Full Name" value={account?.full_name || user?.full_name || '—'} />
                  <InfoRow icon={<Mail size={13} />} label="Email" value={account?.email || user?.email || '—'} />
                  <InfoRow icon={<Calendar size={13} />} label="Member Since" value={account?.created_at ? new Date(account.created_at).toLocaleDateString() : '—'} />
                  <InfoRow icon={<Zap size={13} />} label="Active Agents" value={String(account?.agent_count || 0)} />
                  <InfoRow icon={<Phone size={13} />} label="Phone Numbers" value={String(account?.number_count || 0)} />
                </div>
              </div>

              {/* API Key */}
              <div className="card p-6">
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-4" style={{ color: 'var(--text-primary)' }}>
                  <Key size={15} style={{ color: 'var(--warning)' }} />
                  API Access
                </h2>
                <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                  <span className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--text-muted)' }}>User ID</span>
                  <code className="text-xs font-mono break-all" style={{ color: 'var(--text-secondary)' }}>{account?.user_id || '—'}</code>
                </div>
              </div>

              {/* Danger Zone */}
              <div className="p-6 rounded-xl" style={{ backgroundColor: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
                <h2 className="text-sm font-semibold flex items-center gap-2 mb-2" style={{ color: 'var(--danger)' }}>
                  <AlertCircle size={15} />
                  Danger Zone
                </h2>
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                  Irreversible actions. Proceed with caution.
                </p>
                <button className="px-4 py-2 border border-red-500/20 bg-red-500/5 hover:bg-red-500/10 text-red-500 rounded-lg text-xs font-bold transition-colors cursor-pointer">
                  Delete All Call Data
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Reusable Components ─────────────────────────────────────────────────────

const StatusBox = ({ label, value, isActive }: { label: string; value: string; isActive: boolean }) => (
  <div className="p-4 rounded-lg" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
    <div className="flex items-center gap-2 mb-2">
      {isActive ? (
        <CheckCircle2 size={14} style={{ color: 'var(--success)' }} />
      ) : (
        <AlertCircle size={14} style={{ color: 'var(--warning)' }} />
      )}
      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
    <span className="text-lg font-bold" style={{ color: isActive ? 'var(--success)' : 'var(--text-muted)' }}>
      {value}
    </span>
  </div>
);

const InputField = ({ label, value, onChange, placeholder, icon, type = 'text', mono = false }: any) => (
  <div className="space-y-1.5">
    <label className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span> {label}
    </label>
    <input
      type={type}
      className={`input-field ${mono ? 'font-mono' : ''}`}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  </div>
);

const InfoRow = ({ icon, label, value }: any) => (
  <div className="flex items-center justify-between p-3 rounded-lg" style={{ backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
    <div className="flex items-center gap-2.5">
      <span style={{ color: 'var(--text-muted)' }}>{icon}</span>
      <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</span>
    </div>
    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</span>
  </div>
);

export default SettingsPage;