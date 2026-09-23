import { useState, useEffect } from 'react';
import { useAgentStore } from '../store/useAgentStore';
import {
    Search,
    Play,
    Plus,
    RefreshCw,
    Globe,
    Cpu,
    X,
    Filter,
    Users,
    Trash2,
    Edit2,
    Phone
} from 'lucide-react';
import { agentApi, sessionApi, numbersApi } from '../services/api';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { DecommissionModal } from '../components/DecommissionModal';
import { BackButton } from '../components/BackButton';
import { AgentAvatar } from '../components/AgentAvatar';

const AgentsPage = () => {
    const { agents, setAgents, setEditingAgent, setActiveSession } = useAgentStore();
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [decommissioningItem, setDecommissioningItem] = useState<{id: string, name: string} | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [numbers, setNumbers] = useState<any[]>([]);
    const navigate = useNavigate();

    const fetchNumbers = async () => {
        try {
            const resp = await numbersApi.list();
            setNumbers(resp.data);
        } catch (err) {
            console.error("Failed to load active telephony numbers", err);
        }
    };

    const fetchAgents = async (silent = false) => {
        if (!silent) setIsLoading(true);
        else setIsRefreshing(true);

        try {
            const res = await agentApi.list();
            setAgents(res.data);
            fetchNumbers();
        } catch (err) {
            console.error('Fetch failed', err);
            toast.error('Failed to sync agents');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchAgents();
    }, []);

    const handleEdit = (agent: any, e: React.MouseEvent) => {
        e.stopPropagation();
        navigate(`/agent/${agent.id}/configure`);
    };

    const handleLaunch = async (agent: any, e: React.MouseEvent) => {
        e.stopPropagation();
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

    const handleDelete = async (id: string, name: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setDecommissioningItem({ id, name });
    };

    const confirmDecommission = async () => {
        if (!decommissioningItem) return;
        setIsDeleting(true);
        const { id, name } = decommissioningItem;

        const toastId = toast.loading(`Deleting ${name}...`);
        try {
            await agentApi.delete(id);
            toast.success(`${name} deleted`, { id: toastId });
            setDecommissioningItem(null);
            fetchAgents(true);
        } catch (err) {
            console.error('Delete failed:', err);
            toast.error('Failed to delete agent', { id: toastId });
        } finally {
            setIsDeleting(false);
        }
    };

    const filteredAgents = (agents || []).filter(a =>
        (a.agentName || 'Unnamed').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="max-w-[1400px] mx-auto pb-24 animate-in fade-in duration-300">

            {/* HEADER */}
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8">
                <div>
                    <div className="mb-3">
                        <BackButton fallbackPath="/" label="Dashboard" />
                    </div>
                    <h1 className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                        Agents
                    </h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Deploy, monitor and manage your AI voice agents.
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => fetchAgents(true)}
                        className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all ${isRefreshing ? 'animate-spin' : ''}`}
                        style={{ 
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--surface)',
                            color: 'var(--text-secondary)' 
                        }}
                        title="Refresh"
                    >
                        <RefreshCw size={16} />
                    </button>

                    <button
                        onClick={() => { setEditingAgent(null); navigate('/agents/create'); }}
                        className="btn-primary shadow-sm"
                    >
                        <Plus size={16} />
                        Create Agent
                    </button>
                </div>
            </div>

            {/* SEARCH & FILTERS */}
            <div className="flex flex-col md:flex-row items-center justify-between gap-3 mb-6">
                <div className="relative flex-1 w-full max-w-md">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2" size={16} style={{ color: 'var(--text-muted)' }} />
                    <input
                        type="text"
                        placeholder="Search agents..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="input-field pl-10 pr-10"
                    />
                    {searchTerm && (
                        <button onClick={() => setSearchTerm('')} className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                            <X size={14} />
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                    <button 
                        className="btn-outline text-xs"
                        style={{ height: '40px' }}
                    >
                        <Filter size={14} />
                        Filter
                    </button>
                    <div 
                        className="h-10 px-3 rounded-lg flex items-center gap-2 text-xs font-medium"
                        style={{ 
                            border: '1px solid var(--border)',
                            backgroundColor: 'var(--surface-secondary)',
                            color: 'var(--text-muted)' 
                        }}
                    >
                        <Users size={14} />
                        <span>{agents.length} Agents</span>
                    </div>
                </div>
            </div>

            {/* AGENTS GRID */}
            {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="h-64 rounded-lg skeleton" />
                    ))}
                </div>
            ) : filteredAgents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center max-w-sm mx-auto animate-in fade-in duration-300">
                    <div 
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-[var(--primary)] mb-5 border shadow-sm"
                        style={{
                            borderColor: 'var(--border)',
                            backgroundColor: 'var(--surface-secondary)'
                        }}
                    >
                        <Users size={20} />
                    </div>
                    <h3 className="text-xs font-bold tracking-wider uppercase text-[var(--text-primary)]">
                        No AI Agents Configured
                    </h3>
                    <p className="text-xs mt-2 mb-6 text-[var(--text-muted)] font-medium leading-relaxed">
                        Deploy a highly customizable virtual assistant equipped with LLM intelligence and premium text-to-speech voices.
                    </p>
                    <button
                        onClick={() => { setEditingAgent(null); navigate('/agents/create'); }}
                        className="btn-primary h-9 px-4 text-xs font-bold uppercase tracking-wider shadow-sm flex items-center gap-1.5"
                    >
                        <Plus size={13} />
                        Create Voice Agent
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredAgents.map((agent) => {
                        return (
                             <div
                                 key={agent.id}
                                 onClick={() => navigate(`/agent/${agent.id}/overview`)}
                                 className="card p-5 flex flex-col justify-between min-h-[260px] group cursor-pointer hover:border-[var(--primary)]/40 hover:shadow-md"
                             >
                                <div>
                                    {/* CARD TOP */}
                                    <div className="flex items-start justify-between mb-4">
                                        <div className="flex items-center gap-3">
                                            <AgentAvatar name={agent.agentName} agent={agent} className="w-11 h-11 text-xl" />

                                            <div>
                                                <h3 className="text-sm font-semibold line-clamp-1 group-hover:text-[var(--accent)] transition-colors" style={{ color: 'var(--text-primary)' }}>
                                                    {agent.agentName || 'Unnamed Agent'}
                                                </h3>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span className="badge-success text-[10px] py-0.5 px-2">
                                                        <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--success)' }} />
                                                        Active
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* ACTIONS */}
                                        <div className="flex items-center gap-1.5">
                                            <button 
                                                onClick={(e) => handleEdit(agent, e)}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                                                style={{ 
                                                    border: '1px solid var(--border)',
                                                    backgroundColor: 'var(--surface)',
                                                    color: 'var(--text-muted)' 
                                                }}
                                                title="Edit"
                                            >
                                                <Edit2 size={13} />
                                            </button>
                                            <button 
                                                onClick={(e) => handleDelete(agent.id, agent.agentName, e)}
                                                className="w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:text-red-500"
                                                style={{ 
                                                    border: '1px solid var(--border)',
                                                    backgroundColor: 'var(--surface)',
                                                    color: 'var(--text-muted)' 
                                                }}
                                                title="Delete"
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* PROMPT */}
                                    <p className="text-sm leading-relaxed line-clamp-3 min-h-[54px] italic" style={{ color: 'var(--text-secondary)' }}>
                                        "{agent.prompt || 'Voice assistant ready for operation.'}"
                                    </p>
                                </div>

                                {/* FOOTER */}
                                <div className="mt-4 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
                                    <div className="flex flex-wrap gap-1.5 max-w-[70%]">
                                        <Badge 
                                            label={agent.language.toUpperCase()} 
                                            icon={<Globe size={11} />} 
                                        />
                                        <Badge 
                                            label={agent.llm?.model ? agent.llm.model.split('/').pop()?.substring(0, 12) || agent.llm.model.substring(0, 12) : 'llama-3.3'} 
                                            icon={<Cpu size={11} />} 
                                        />
                                        {numbers.filter(n => n.agent_id === agent.id).length > 0 ? (
                                            numbers.filter(n => n.agent_id === agent.id).map(n => (
                                                <Badge 
                                                    key={n.id}
                                                    label={n.number} 
                                                    icon={<Phone size={10} />} 
                                                    onClick={(e) => { e.stopPropagation(); navigate('/numbers'); }}
                                                    className="cursor-pointer"
                                                />
                                            ))
                                        ) : (
                                            <Badge 
                                                label="Link Number" 
                                                icon={<Plus size={10} />} 
                                                onClick={(e) => { e.stopPropagation(); navigate('/numbers'); }}
                                                className="cursor-pointer"
                                            />
                                        )}
                                    </div>

                                    <button
                                        onClick={(e) => handleLaunch(agent, e)}
                                        className="h-8 px-3 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all group/btn"
                                        style={{ 
                                            border: '1px solid var(--border)',
                                            backgroundColor: 'var(--surface)',
                                            color: 'var(--text-secondary)' 
                                        }}
                                    >
                                        <Play size={10} fill="currentColor" strokeWidth={0} style={{ color: 'var(--success)' }} />
                                        <span>Launch</span>
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {/* ADD NEW CARD */}
                    <button
                        onClick={() => { setEditingAgent(null); navigate('/agents/create'); }}
                        className="rounded-xl p-6 flex flex-col items-center justify-center min-h-[260px] group"
                        style={{ 
                            border: '2px dashed var(--border)',
                            backgroundColor: 'transparent' 
                        }}
                    >
                        <div 
                            className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                            style={{ 
                                border: '1px solid var(--border)',
                                backgroundColor: 'var(--surface-secondary)',
                                color: 'var(--text-muted)' 
                            }}
                        >
                            <Plus size={20} />
                        </div>
                        <h3 className="text-sm font-semibold group-hover:text-[var(--accent)]" style={{ color: 'var(--text-primary)' }}>
                            Create Agent
                        </h3>
                        <p className="text-xs mt-1 text-center max-w-[200px]" style={{ color: 'var(--text-muted)' }}>
                            Set up a new AI voice assistant.
                        </p>
                    </button>
                </div>
            )}

            <DecommissionModal 
                isOpen={!!decommissioningItem}
                onClose={() => setDecommissioningItem(null)}
                onConfirm={confirmDecommission}
                title="Delete Agent"
                itemName={decommissioningItem?.name || ''}
                loading={isDeleting}
            />
        </div>
    );
};

interface BadgeProps {
    label: string;
    icon: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    className?: string;
}

const Badge = ({ label, icon, onClick, className }: BadgeProps) => (
    <div 
        onClick={onClick}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium leading-none select-none transition-all duration-200 ${className || ''}`}
        style={{ 
            backgroundColor: 'var(--badge-bg)',
            border: '1px solid var(--badge-border)',
            color: 'var(--badge-text)' 
        }}
    >
        {icon}
        <span>{label}</span>
    </div>
);

export default AgentsPage;
