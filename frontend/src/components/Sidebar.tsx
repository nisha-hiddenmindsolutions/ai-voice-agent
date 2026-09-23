import React, { useEffect } from 'react';
import { 
  Home,
  History, 
  Settings, 
  Key, 
  BarChart3, 
  Package,
  Share2,
  X,
  Phone,
  ArrowLeft,
  Eye,
  BookOpen,
  Wrench,
  Sliders,
  Plus,
  ChevronDown,
  PhoneOutgoing
} from 'lucide-react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAgentStore } from '../store/useAgentStore';
import { AgentAvatar } from './AgentAvatar';
import { agentApi } from '../services/api';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { agents, setAgents, setEditingAgent } = useAgentStore();

  // Sync agents list on mount if empty
  useEffect(() => {
    if (agents.length === 0) {
      agentApi.list()
        .then(res => setAgents(res.data))
        .catch(err => console.error("Sidebar agents load error:", err));
    }
  }, [agents.length]);

  const handleNewAgent = () => {
    setEditingAgent(null);
    navigate('/agents/create');
    onClose();
  };

  // Determine navigation state (Universal vs Agent-Specific)
  const match = location.pathname.match(/^\/agent\/([^/]+)/);
  const agentId = match ? match[1] : null;
  const currentAgent = agents.find(a => a.id === agentId);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <>
      {/* MOBILE OVERLAY */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-[90] lg:hidden"
          style={{ backgroundColor: 'var(--overlay-bg)' }}
          onClick={onClose}
        />
      )}

      <aside 
        className={`fixed inset-y-0 left-0 z-[100] w-64 flex flex-col border-r lg:sticky lg:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'} h-screen transition-transform duration-300`}
        style={{ 
          background: 'var(--sidebar-bg)', 
          borderColor: 'var(--sidebar-border)',
          boxShadow: '4px 0 24px -4px rgba(0, 0, 0, 0.03)'
        }}
      >
        <div className="flex items-center justify-between px-5 h-16 shrink-0 sidebar-glow">
          <NavLink to="/" onClick={onClose} className="flex items-center gap-2.5 group cursor-pointer">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center animate-gradient-shift" style={{ background: 'linear-gradient(135deg, var(--primary), #8B5CF6, var(--accent))' }}>
              <span className="text-[10px] font-black text-white">H</span>
            </div>
            <span className="text-[15px] font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>HMS</span>
            <span className="text-[9px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider leading-none" style={{ background: 'linear-gradient(135deg, rgba(79,70,229,0.1), rgba(139,92,246,0.05))', color: 'var(--primary)', border: '1px solid rgba(79,70,229,0.12)' }}>Voice</span>
          </NavLink>

          <button 
            onClick={onClose}
            className="p-1 rounded lg:hidden"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* WORKSPACE SELECTOR */}
        <div className="px-3 mb-4">
          <div className="flex items-center justify-between px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/30 text-xs font-semibold cursor-pointer hover:bg-[var(--surface-secondary)]/60 active:scale-[0.98]">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-4 h-4 rounded-full bg-[var(--primary)]/20 border border-[var(--primary)]/30 flex items-center justify-center shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />
              </div>
              <span className="truncate font-bold text-[12px] text-[var(--text-primary)]">Manish's Workspace</span>
            </div>
            <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0" />
          </div>
        </div>

        {/* NAVIGATION CONTENT */}
        <div className="flex-1 overflow-y-auto px-3 pb-6 space-y-6 custom-scrollbar">
          
          {agentId ? (
            /* ==================== AGENT WORKSPACE SIDEBAR ==================== */
            <div className="space-y-4">
              {/* Back to workspace Link */}
              <NavLink
                to="/"
                onClick={onClose}
                className="flex items-center gap-2 px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/30 hover:bg-[var(--surface-secondary)]/60"
              >
                <ArrowLeft size={12} /> Back to workspace
              </NavLink>

              {/* Current Active Agent Summary */}
              {currentAgent && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)]/20">
                  <AgentAvatar name={currentAgent.agentName} agent={currentAgent} className="w-8 h-8 text-sm font-bold shadow-sm shrink-0 border border-[var(--border)]" />
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold truncate text-[var(--text-primary)]">{currentAgent.agentName}</p>
                    <span className="text-[8px] font-extrabold uppercase px-1 py-0.2 rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 leading-none inline-block mt-0.5">Active</span>
                  </div>
                </div>
              )}

              {/* Agent Overview Link */}
              <NavLink
                to={`/agent/${agentId}/overview`}
                onClick={onClose}
                className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={({ isActive }) => ({
                  backgroundColor: isActive ? 'var(--sidebar-item-active-bg)' : 'transparent',
                  border: isActive ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                  color: isActive ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                })}
              >
                <Eye size={16} className="shrink-0" />
                <span className="text-[13px] font-bold">Overview</span>
              </NavLink>

              {/* Configure Section */}
              <div className="space-y-1">
                <div className="px-3 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Configure</span>
                </div>
                <nav className="space-y-0.5">
                  {[
                    { id: 'agent-config', path: `/agent/${agentId}/configure`, icon: Settings, label: 'Agent' },
                    { id: 'knowledge', path: `/agent/${agentId}/knowledge`, icon: BookOpen, label: 'Knowledge Base' },
                    { id: 'tools', path: `/agent/${agentId}/tools`, icon: Wrench, label: 'Tools' },
                    { id: 'settings', path: `/agent/${agentId}/settings`, icon: Sliders, label: 'Settings' },
                  ].map((item) => {
                    const isLinkActive = isActive(item.path);
                    return (
                      <NavLink
                        key={item.id}
                        to={item.path}
                        onClick={onClose}
                        className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg group"
                        style={{
                          backgroundColor: isLinkActive ? 'var(--sidebar-item-active-bg)' : 'transparent',
                          border: isLinkActive ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                          color: isLinkActive ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                        }}
                      >
                        <item.icon size={16} className="shrink-0" />
                        <span className="text-[13px] font-bold leading-none">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </nav>
              </div>

              {/* Monitor Section */}
              <div className="space-y-1">
                <div className="px-3 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Monitor</span>
                </div>
                <nav className="space-y-0.5">
                  {[
                    { id: 'conversations', path: `/agent/${agentId}/conversations`, icon: History, label: 'Conversations' },
                  ].map((item) => {
                    const isLinkActive = isActive(item.path);
                    return (
                      <NavLink
                        key={item.id}
                        to={item.path}
                        onClick={onClose}
                        className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg group"
                        style={{
                          backgroundColor: isLinkActive ? 'var(--sidebar-item-active-bg)' : 'transparent',
                          border: isLinkActive ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                          color: isLinkActive ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                        }}
                      >
                        <item.icon size={16} className="shrink-0" />
                        <span className="text-[13px] font-bold leading-none">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </nav>
              </div>
            </div>
          ) : (
            /* ==================== UNIVERSAL HOME WORKSPACE SIDEBAR ==================== */
            <div className="space-y-4">
              
              {/* Home Link (Directly below selector) */}
              <NavLink
                to="/"
                onClick={onClose}
                className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg"
                style={({ isActive }) => ({
                  backgroundColor: isActive ? 'var(--sidebar-item-active-bg)' : 'transparent',
                  border: isActive ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                  color: isActive ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                })}
              >
                <Home size={16} className="shrink-0" />
                <span className="text-[13px] font-bold">Home</span>
              </NavLink>

              {/* DYNAMIC AGENTS LIST */}
              <div className="space-y-1">
                <div className="px-3 mb-1 flex items-center justify-between group/agents-header">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Agents
                  </span>
                  <button 
                    onClick={handleNewAgent}
                    className="p-0.5 rounded hover:bg-[var(--surface-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    title="Create Agent"
                  >
                    <Plus size={12} />
                  </button>
                </div>
                <nav className="space-y-0.5 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
                  {agents.length === 0 ? (
                    <div className="px-3 py-3 text-center border border-dashed border-[var(--border)] rounded-lg bg-[var(--surface-secondary)]/10">
                      <button 
                        onClick={handleNewAgent}
                        className="text-[10px] text-[var(--primary)] font-bold uppercase tracking-wider hover:underline"
                      >
                        + Create Agent
                      </button>
                    </div>
                  ) : (
                    agents.map((agentItem) => {
                      const agentPath = `/agent/${agentItem.id}/overview`;
                      const isLinkActive = isActive(`/agent/${agentItem.id}`);
                      return (
                        <NavLink
                          key={agentItem.id}
                          to={agentPath}
                          onClick={onClose}
                          className="relative w-full flex items-center gap-3 px-3 py-2 rounded-lg group"
                          style={{
                            backgroundColor: isLinkActive ? 'var(--sidebar-item-active-bg)' : 'transparent',
                            border: isLinkActive ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                            color: isLinkActive ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                          }}
                        >
                          <AgentAvatar name={agentItem.agentName} agent={agentItem} className="w-5.5 h-5.5 text-[9px] font-bold shrink-0 shadow-sm border border-[var(--border)]" />
                          <span className="text-[13px] font-bold truncate">{agentItem.agentName}</span>
                        </NavLink>
                      );
                    })
                  )}
                </nav>
              </div>

              {/* Configure Section */}
              <div className="space-y-1">
                <div className="px-3 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Configure</span>
                </div>
                <nav className="space-y-0.5">
                  {[
                    { id: 'providers', path: '/providers', icon: Key, label: 'Providers' },
                    { id: 'webhooks', path: '/tools', icon: Package, label: 'Tools' },
                    { id: 'integrations', path: '/integrations', icon: Share2, label: 'Integrations' },
                    { id: 'settings', path: '/settings', icon: Settings, label: 'Settings' },
                  ].map((item) => {
                    const isLinkActive = isActive(item.path);
                    return (
                      <NavLink
                        key={item.id}
                        to={item.path}
                        onClick={onClose}
                        className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg group"
                        style={{
                          backgroundColor: isLinkActive ? 'var(--sidebar-item-active-bg)' : 'transparent',
                          border: isLinkActive ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                          color: isLinkActive ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                        }}
                      >
                        <item.icon size={16} className="shrink-0" />
                        <span className="text-[13px] font-bold leading-none">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </nav>
              </div>

              {/* Deploy Section */}
              <div className="space-y-1">
                <div className="px-3 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Deploy</span>
                </div>
                <nav className="space-y-0.5">
                  {[
                    { id: 'numbers', path: '/numbers', icon: Phone, label: 'Phone Numbers' },
                    { id: 'outbound', path: '/outbound', icon: PhoneOutgoing, label: 'Outbound' },
                  ].map((item) => {
                    const isLinkActive = isActive(item.path);
                    return (
                      <NavLink
                        key={item.id}
                        to={item.path}
                        onClick={onClose}
                        className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg group"
                        style={{
                          backgroundColor: isLinkActive ? 'var(--sidebar-item-active-bg)' : 'transparent',
                          border: isLinkActive ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                          color: isLinkActive ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                        }}
                      >
                        <item.icon size={16} className="shrink-0" />
                        <span className="text-[13px] font-bold leading-none">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </nav>
              </div>

              {/* Monitor Section */}
              <div className="space-y-1">
                <div className="px-3 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Monitor</span>
                </div>
                <nav className="space-y-0.5">
                  {[
                    { id: 'logs', path: '/logs', icon: History, label: 'Call Logs' },
                    { id: 'analytics', path: '/analytics', icon: BarChart3, label: 'Analytics' },
                  ].map((item) => {
                    const isLinkActive = isActive(item.path);
                    return (
                      <NavLink
                        key={item.id}
                        to={item.path}
                        onClick={onClose}
                        className="relative w-full flex items-center gap-3 px-3 py-2.5 rounded-lg group"
                        style={{
                          backgroundColor: isLinkActive ? 'var(--sidebar-item-active-bg)' : 'transparent',
                          border: isLinkActive ? '1px solid var(--sidebar-item-active-border)' : '1px solid transparent',
                          color: isLinkActive ? 'var(--sidebar-item-active-text)' : 'var(--text-secondary)',
                        }}
                      >
                        <item.icon size={16} className="shrink-0" />
                        <span className="text-[13px] font-bold leading-none">{item.label}</span>
                      </NavLink>
                    );
                  })}
                </nav>
              </div>

            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
