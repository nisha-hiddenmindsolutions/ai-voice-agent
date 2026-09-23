import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Code, 
  Check, 
  Plus
} from 'lucide-react';
import { agentApi, toolApi } from '../services/api';
import { useAgentStore } from '../store/useAgentStore';
import toast from 'react-hot-toast';

const AgentToolsPage = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { setAgents } = useAgentStore();

  const [agent, setAgent] = useState<any>(null);
  const [availableTools, setAvailableTools] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!agentId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        const [agentRes, toolsRes] = await Promise.all([
          agentApi.get(agentId),
          toolApi.list()
        ]);
        setAgent(agentRes.data);
        setAvailableTools(toolsRes.data || []);
      } catch (err) {
        console.error('Failed to load agent tools data:', err);
        toast.error('Failed to sync agent tools registry');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [agentId]);

  const handleToggleTool = async (toolId: string) => {
    if (!agent || isUpdating) return;
    
    setIsUpdating(true);
    const currentTools = agent.tools || [];
    const isSelected = currentTools.includes(toolId);
    
    const nextTools = isSelected 
      ? currentTools.filter((id: string) => id !== toolId)
      : [...currentTools, toolId];

    const updatedAgent = { ...agent, tools: nextTools };
    const toastId = toast.loading(isSelected ? 'Unlinking tool...' : 'Linking tool...');

    try {
      const resp = await agentApi.createOrUpdate(updatedAgent);
      setAgent(resp.data);
      
      // Update global agents store
      const resList = await agentApi.list();
      setAgents(resList.data);
      
      toast.success(isSelected ? 'Tool unlinked' : 'Tool linked successfully!', { id: toastId });
    } catch (err) {
      console.error('Failed to update agent tools:', err);
      toast.error('Failed to update agent tools configuration', { id: toastId });
    } finally {
      setIsUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4 animate-in fade-in duration-300">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
        <span className="text-[11px] font-mono text-[var(--text-muted)] tracking-wider">Syncing tools registry...</span>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto pb-24 animate-in fade-in duration-500 font-sans">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between border-b border-[var(--border)] pb-6 mb-8 gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            Agent Tools
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
            Select the tools and actions this agent is authorized to trigger during live voice conversations.
          </p>
        </div>

        <button 
          onClick={() => navigate('/tools')}
          className="btn-primary h-10 text-xs font-bold uppercase tracking-wider px-4 flex items-center gap-1.5"
        >
          <Plus size={14} />
          Create New Tool
        </button>
      </div>

      {availableTools.length === 0 ? (
        <div className="p-16 text-center border border-dashed border-[var(--border)] rounded-2xl bg-[var(--surface-secondary)]/30 max-w-xl mx-auto">
          <Code size={36} className="mx-auto text-[var(--text-muted)] mb-3" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">No Tools Registered</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1.5 max-w-sm mx-auto leading-relaxed">
            Register external webhooks or API workflows first in the main tools panel to link them here.
          </p>
          <button 
            onClick={() => navigate('/tools')}
            className="mt-4 btn-outline text-xs"
          >
            Go to Tools Marketplace
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {availableTools.map(tool => {
            const isSelected = (agent.tools || []).includes(tool.id);
            return (
              <button 
                key={tool.id}
                onClick={() => handleToggleTool(tool.id)}
                disabled={isUpdating}
                className={`card p-5 text-left flex flex-col justify-between min-h-[140px] group cursor-pointer ${
                  isSelected 
                    ? 'border-[var(--primary)] bg-[var(--primary)]/5 ring-1 ring-[var(--primary)] shadow-sm' 
                    : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-hover)] hover:bg-[var(--surface-secondary)]/50'
                }`}
              >
                <div className="flex justify-between items-center w-full">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    isSelected ? 'bg-[var(--primary)] text-white' : 'bg-[var(--surface-secondary)] border border-[var(--border)] text-[var(--text-muted)]'
                  }`}>
                    <Code size={16} />
                  </div>
                  {isSelected ? (
                    <div className="flex items-center gap-1 bg-[var(--primary)]/10 text-[var(--primary)] text-[9px] font-bold px-2 py-0.5 rounded border border-[var(--primary)]/20">
                      <Check size={10} /> Active
                    </div>
                  ) : (
                    <span className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider">Unlinked</span>
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--text-primary)] mt-3 group-hover:text-[var(--primary)]">{tool.name}</h4>
                  <p className="text-xs text-[var(--text-muted)] line-clamp-1 italic mt-1 leading-normal">{tool.description || 'Custom webhook callback module.'}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}

    </div>
  );
};

export default AgentToolsPage;
