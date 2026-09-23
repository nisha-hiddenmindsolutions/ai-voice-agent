import { Mic, Play, Trash2 } from 'lucide-react';

interface AgentCardProps {
  agent: {
    id: string;
    agentName: string;
    description: string;
    status: string;
  };
  onLaunch: (id: string) => void;
  onDelete: (id: string) => void;
}

const AgentCard: React.FC<AgentCardProps> = ({ agent, onLaunch, onDelete }) => {
  const statusColors: any = {
    live: 'bg-green-500/20 text-green-500 border-green-500/30',
    draft: 'bg-amber-500/20 text-amber-500 border-amber-500/30',
    paused: 'bg-red-500/20 text-red-500 border-red-500/30',
  };

  return (
    <div className="glass group hover:bg-card/60 p-5 rounded-3xl border border-border flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="w-12 h-12 bg-primary/20 text-primary rounded-2xl flex items-center justify-center font-bold text-xl">
          <Mic size={24} />
        </div>
        <div className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold border ${statusColors[agent.status]}`}>
          {agent.status}
        </div>
      </div>

      <div>
        <h3 className="text-lg font-bold text-foreground truncate">{agent.agentName}</h3>
        <p className="text-sm text-muted-foreground line-clamp-2 mt-1 min-h-[40px]">
          {agent.description || 'Professional AI assistant configured for task-specific interaction.'}
        </p>
      </div>

      <div className="flex gap-2 items-center-mt-2 pt-4 border-t border-border/50">
        <button 
          onClick={() => onLaunch(agent.id)}
          className="flex-1 bg-primary hover:bg-primary-hover text-on-primary text-sm font-bold py-2 rounded-xl flex items-center justify-center gap-2 transition-all shadow-lg shadow-primary/20"
        >
          <Play size={16} fill="currentColor" />
          Launch
        </button>
        <button 
          onClick={() => onDelete(agent.id)}
          className="p-2 aspect-square glass hover:bg-red-500/10 text-muted-foreground hover:text-red-500 rounded-xl transition-all"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
};

export default AgentCard;
