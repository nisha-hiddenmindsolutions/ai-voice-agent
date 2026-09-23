import { create } from 'zustand';

interface Agent {
  id: string;
  agentName: string;
  description: string;
  prompt: string;
  status: 'live' | 'paused' | 'draft';
  language: string;
  stt: any;
  llm: any;
  tts: any;
  tools: any[];
  first_message?: string;
  expressive_mode?: boolean;
}

interface User {
  id: string;
  balance: number;
  apiKeys: Record<string, string>;
}

interface AgentStore {
  agents: Agent[];
  user: User | null;
  activeSession: { room: string; status: string; url: string; token: string; agentName?: string } | null;
  activePage: string;
  editingAgent: Agent | null;
  setAgents: (agents: Agent[]) => void;
  setUser: (user: User) => void;
  setActiveSession: (session: { room: string; status: string; url: string; token: string; agentName?: string } | null) => void;
  setActivePage: (page: string) => void;
  setEditingAgent: (agent: Agent | null) => void;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],
  user: null,
  activeSession: null,
  activePage: 'agents',
  editingAgent: null,
  setAgents: (agents) => set({ agents }),
  setUser: (user) => set({ user }),
  setActiveSession: (activeSession) => set({ activeSession }),
  setActivePage: (activePage) => set({ activePage }),
  setEditingAgent: (editingAgent) => set({ editingAgent }),
}));
