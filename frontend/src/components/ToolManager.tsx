import React, { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, X, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { toolApi } from '../services/api';
import { DecommissionModal } from './DecommissionModal';
import { BackButton } from './BackButton';
import { Select } from './ui/Select';

const GoogleCalendarIcon = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 48 48" style={{ width: size, height: size }} className="shrink-0 animate-fade-in">
    <rect width="22" height="22" x="13" y="13" fill="#fff" />
    <polygon fill="#1e88e5" points="25.68,20.92 26.688,22.36 28.272,21.208 28.272,29.56 30,29.56 30,18.616 28.56,18.616" />
    <path fill="#1e88e5" d="M22.943,23.745c0.625-0.574,1.013-1.37,1.013-2.249c0-1.747-1.533-3.168-3.417-3.168 c-1.602,0-2.972,1.009-3.33,2.453l1.657,0.421c0.165-0.664,0.868-1.146,1.673-1.146c0.942,0,1.709,0.646,1.709,1.44 c0,0.794-0.767,1.44-1.709,1.44h-0.997v1.728h0.997c1.081,0,1.993,0.751,1.993,1.64c0,0.904-0.866,1.64-1.931,1.64 c-0.962,0-1.784-0.61-1.914-1.418L17,26.802c0.262,1.636,1.81,2.87,3.6,2.87c2.007,0,3.64-1.511,3.64-3.368 C24.24,25.281,23.736,24.363,22.943,23.745z" />
    <polygon fill="#fbc02d" points="34,42 14,42 13,38 14,34 34,34 35,38" />
    <polygon fill="#4caf50" points="38,35 42,34 42,14 38,13 34,14 34,34" />
    <path fill="#1e88e5" d="M34,14l1-4l-1-4H9C7.343,6,6,7.343,6,9v25l4,1l4-1V14H34z" />
    <polygon fill="#e53935" points="34,34 34,42 42,34" />
    <path fill="#1565c0" d="M39,6h-5v8h8V9C42,7.343,40.657,6,39,6z" />
    <path fill="#1565c0" d="M9,42h5v-8H6v5C6,40.657,7.343,42,9,42z" />
  </svg>
);

const GoogleSheetsIcon = ({ size = 22 }: { size?: number }) => (
  <svg viewBox="0 0 48 48" style={{ width: size, height: size }} className="shrink-0 animate-fade-in" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="22" height="22" x="13" y="13" fill="#fff" />
    <path d="M38 13V35C38 36.6569 36.6569 38 35 38H13V42H35C38.866 42 42 38.866 42 35V13H38Z" fill="#0F9D58" />
    <path d="M13 13V35H35V13H13ZM18.5 30H15.5V27H18.5V30ZM18.5 24H15.5V21H18.5V24ZM18.5 18H15.5V15H18.5V15.5V18ZM25.5 30H20.5V27H25.5V30ZM25.5 24H20.5V21H25.5V24ZM25.5 18H20.5V15H25.5V18ZM32.5 30H27.5V27H32.5V30ZM32.5 24H27.5V21H32.5V24ZM32.5 18H27.5V15H32.5V18Z" fill="#0F9D58" />
    <path d="M34 14L35 10L34 6H9C7.34315 6 6 7.34315 6 9V34L10 35L14 34V14H34Z" fill="#0F9D58" />
  </svg>
);

const N8NIcon = ({ size = 22 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size }} className="shrink-0 animate-fade-in" viewBox="0 0 48 48">
<path fill="#37474f" d="M35,37c-2.2,0-4-1.8-4-4s1.8-4,4-4s4,1.8,4,4S37.2,37,35,37z"></path><path fill="#37474f" d="M35,43c-3,0-5.9-1.4-7.8-3.7l3.1-2.5c1.1,1.4,2.9,2.3,4.7,2.3c3.3,0,6-2.7,6-6s-2.7-6-6-6 c-1,0-2,0.3-2.9,0.7l-1.7,1L23.3,16l3.5-1.9l5.3,9.4c1-0.3,2-0.5,3-0.5c5.5,0,10,4.5,10,10S40.5,43,35,43z"></path><path fill="#37474f" d="M14,43C8.5,43,4,38.5,4,33c0-4.6,3.1-8.5,7.5-9.7l1,3.9C9.9,27.9,8,30.3,8,33c0,3.3,2.7,6,6,6 s6-2.7,6-6v-2h15v4H23.8C22.9,39.6,18.8,43,14,43z"></path><path fill="#e91e63" d="M14,37c-2.2,0-4-1.8-4-4s1.8-4,4-4s4,1.8,4,4S16.2,37,14,37z"></path><path fill="#37474f" d="M25,19c-2.2,0-4-1.8-4-4s1.8-4,4-4s4,1.8,4,4S27.2,19,25,19z"></path><path fill="#e91e63" d="M15.7,34L12.3,32l5.9-9.7c-2-1.9-3.2-4.5-3.2-7.3c0-5.5,4.5-10,10-10c5.5,0,10,4.5,10,10 c0,0.9-0.1,1.7-0.3,2.5l-3.9-1c0.1-0.5,0.2-1,0.2-1.5c0-3.3-2.7-6-6-6s-6,2.7-6,6c0,2.1,1.1,4,2.9,5.1l1.7,1L15.7,34z"></path>
</svg>
);

const CustomWebhookIcon = ({ size = 22 }: { size?: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" style={{ width: size, height: size }} className="shrink-0 animate-fade-in" viewBox="0 0 48 48">
    <path fill="#0053b3" d="M35,37c-2.2,0-4-1.8-4-4s1.8-4,4-4s4,1.8,4,4S37.2,37,35,37z"/>
    <path fill="#4Caf50" d="M35,43c-3,0-5.9-1.4-7.8-3.7l3.1-2.5c1.1,1.4,2.9,2.3,4.7,2.3c3.3,0,6-2.7,6-6s-2.7-6-6-6 c-1,0-2,0.3-2.9,0.7l-1.7,1L23.3,16l3.5-1.9l5.3,9.4c1-0.3,2-0.5,3-0.5c5.5,0,10,4.5,10,10S40.5,43,35,43z"/>
    <path fill="#4Caf50" d="M14,43C8.5,43,4,38.5,4,33c0-4.6,3.1-8.5,7.5-9.7l1,3.9C9.9,27.9,8,30.3,8,33c0,3.3,2.7,6,6,6 s6-2.7,6-6v-2h15v4H23.8C22.9,39.6,18.8,43,14,43z"/>
    <path fill="#2196F3" d="M14,37c-2.2,0-4-1.8-4-4s1.8-4,4-4s4,1.8,4,4S16.2,37,14,37z"/>
    <path fill="#2196F3" d="M25,19c-2.2,0-4-1.8-4-4s1.8-4,4-4s4,1.8,4,4S27.2,19,25,19z"/>
    <path fill="#2196F3" d="M15.7,34L12.3,32l5.9-9.7c-2-1.9-3.2-4.5-3.2-7.3c0-5.5,4.5-10,10-10c5.5,0,10,4.5,10,10 c0,0.9-0.1,1.7-0.3,2.5l-3.9-1c0.1-0.5,0.2-1,0.2-1.5c0-3.3-2.7-6-6-6s-6,2.7-6,6c0,2.1,1.1,4,2.9,5.1l1.7,1L15.7,34z"/>
</svg>
);

const renderToolIcon = (toolType: string, size = 22) => {
  switch (toolType) {
    case 'CALENDAR':
      return <GoogleCalendarIcon size={size} />;
    case 'SHEETS':
      return <GoogleSheetsIcon size={size} />;
    case 'N8N':
      return <N8NIcon size={size} />;
    default:
      return <CustomWebhookIcon size={size} />;
  }
};

interface Tool {
  id: string;
  name: string;
  description: string;
  tool_type: string;
  category: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  api_key?: string;
  body_template?: string;
  config: any;
  integration_id?: string;
}

interface Integration {
  id: string;
  provider: string;
  scopes: string[];
}

export const ToolManager: React.FC = () => {
  const [tools, setTools] = useState<Tool[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [isTestingConfig, setIsTestingConfig] = useState(false);
  const [testResult, setTestResult] = useState<{status: 'success' | 'failure', code?: number, error?: string, fullResponse?: any} | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [inspectorData, setInspectorData] = useState<any>(null);
  const [decommissioningItem, setDecommissioningItem] = useState<{id: string, name: string} | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [creationStep, setCreationStep] = useState<'type' | 'config'>('type');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newTool, setNewTool] = useState<Partial<Tool>>({
    name: '',
    description: '',
    tool_type: 'WEBHOOK',
    category: 'Webhooks',
    url: '',
    method: 'POST',
    headers: {},
    api_key: '',
    body_template: '{\n  "input": "{{input}}"\n}',
    config: {},
    integration_id: ''
  });

  const fetchTools = async () => {
    try {
      const res = await toolApi.list();
      setTools(res.data);
    } catch (err) {
      console.error("Failed to fetch tools", err);
      toast.error('Failed to sync marketplace');
    }
  };

  const fetchIntegrations = async () => {
    try {
      const res = await api.get('/integrations/');
      setIntegrations(res.data);
    } catch (err) {
      console.error("Failed to fetch integrations", err);
    }
  };

  useEffect(() => { 
    fetchTools(); 
    fetchIntegrations();
  }, []);

  const handleSave = async () => {
    const toastId = toast.loading('Registering Tool...');
    try {
      await toolApi.create(newTool);
      toast.success('Tool Connected successfully', { id: toastId });
      setIsAdding(false);
      fetchTools();
      // Reset form
      setCreationStep('type');
      setNewTool({
        name: '',
        description: '',
        tool_type: 'WEBHOOK',
        category: 'Webhooks',
        url: '',
        method: 'POST',
        headers: {},
        api_key: '',
        body_template: '{\n  "input": "{{input}}"\n}',
        config: {},
        integration_id: ''
      });
    } catch (err) {
      console.error("Failed to save tool", err);
      toast.error('Failed to authorize link', { id: toastId });
    }
  };

  const handleTestTool = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsTesting(id);
    const toastId = toast.loading('Testing Connection...');
    try {
      const res = await toolApi.test(id);
      if (res.data.status === 'success') {
        toast.success(`Active: HTTP ${res.data.code}`, { id: toastId });
        setInspectorData(res.data);
        setShowInspector(true);
      } else {
        toast.error(`Offline: ${res.data.error}`, { id: toastId });
      }
    } catch (err) {
      toast.error('Connection Timeout', { id: toastId });
    } finally {
      setIsTesting(null);
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
    const toastId = toast.loading(`Severing ${name}...`);
    try {
      await toolApi.delete(id);
      toast.success('Tool Disconnected', { id: toastId });
      setDecommissioningItem(null);
      fetchTools();
    } catch (err) {
      console.error("Failed to delete tool", err);
      toast.error('Decommission failed', { id: toastId });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleTestNewTool = async () => {
    if (!newTool.url) return toast.error("Webhook URL is required for testing");
    setIsTestingConfig(true);
    setTestResult(null);
    const toastId = toast.loading('Testing Webhook Endpoint...');
    try {
      const res = await toolApi.testConfig(newTool);
      if (res.data.status === 'success') {
        setTestResult({ status: 'success', code: res.data.code, fullResponse: res.data });
        toast.success(`Success: Node responded with ${res.data.code}`, { id: toastId });
      } else {
        setTestResult({ status: 'failure', error: res.data.error });
        toast.error(`Test Failed: ${res.data.error}`, { id: toastId });
      }
    } catch (err) {
      toast.error('Test Timeout', { id: toastId });
    } finally {
      setIsTestingConfig(false);
    }
  };

  return (
    <div className="max-w-[1400px] mx-auto pb-12 animate-in fade-in duration-500 font-sans text-[var(--text-primary)] relative">
      {/* HEADER SECTION */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-8 relative z-10">
        <div>
          <div className="mb-3">
            <BackButton fallbackPath="/" label="Dashboard" />
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--primary)]">
              <Zap size={18} className="text-white" />
            </div>
            <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--text-primary)]">Tool Marketplace</h1>
          </div>
          <div className="flex items-center gap-2 mt-1.5 ml-[52px]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]"></span>
            </span>
            <p className="text-[var(--text-secondary)] text-[10px] font-bold tracking-widest uppercase">Sync workflows & automated API relays</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCreationStep('type');
              setIsAdding(true);
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer btn-shine active:scale-[0.97]"
            style={{
              backgroundColor: 'var(--primary)',
              color: '#fff',
              boxShadow: '0 4px 14px -3px rgba(79, 70, 229, 0.4)'
            }}
          >
            <Plus size={15} />
            Add New Tool
          </button>
        </div>
      </div>

      {/* TOOLS GRID */}
      <div className="relative z-10">
        {tools.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center max-w-sm mx-auto animate-in fade-in duration-300 w-full col-span-full">
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center text-[var(--primary)] mb-5 border shadow-sm"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--surface-secondary)'
              }}
            >
              <Zap size={20} />
            </div>
            <h3 className="text-xs font-bold tracking-wider uppercase text-[var(--text-primary)]">
              No Tools Integrated Yet
            </h3>
            <p className="text-xs mt-2 mb-6 text-[var(--text-muted)] font-medium leading-relaxed">
              Connect external webhooks, automated n8n workflows, or direct Google Sheets & Calendar adapters to empower your AI voice agents.
            </p>
            <button
              onClick={() => {
                setCreationStep('type');
                setIsAdding(true);
              }}
              className="btn-primary h-9 px-4 text-xs font-bold uppercase tracking-wider shadow-sm flex items-center gap-1.5"
            >
              <Plus size={13} />
              Connect Your First Tool
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {tools.map((tool) => (
              <div
                key={tool.id}
                className="card flex flex-col justify-between min-h-[270px] relative overflow-hidden group cursor-default"
              >
                <div>
                  {/* TOP */}
                  <div className="flex items-start justify-between mb-5">
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-14 h-14 rounded-2xl bg-[var(--surface-secondary)] flex items-center justify-center border border-[var(--border)] shadow-sm p-3 shrink-0">
                        {renderToolIcon(tool.tool_type, 26)}
                      </div>

                      <div className="min-w-0">
                        <h3 className="text-base font-bold text-[var(--text-primary)] tracking-tight line-clamp-1">
                          {tool.name}
                        </h3>
                        <span className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-widest block mt-1">
                          {tool.category || tool.tool_type}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={(e) => handleTestTool(tool.id, e)}
                        className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--primary)] hover:border-[var(--border-hover)]"
                        title="Probe Link"
                      >
                        <Zap size={13} className={isTesting === tool.id ? 'animate-pulse text-[var(--primary)]' : ''} />
                      </button>

                      <button
                        onClick={(e) => handleDelete(tool.id, tool.name, e)}
                        className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--danger)] hover:border-red-500/20"
                        title="Decommission Link"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* DESCRIPTION */}
                  <p className="text-[var(--text-secondary)] text-sm leading-relaxed font-medium line-clamp-2 min-h-[40px]">
                    {tool.description || 'External integration adapter for cellular routing nodes.'}
                  </p>
                </div>

                {/* URL/INFO */}
                <div className="mt-5 p-3.5 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border)] shadow-inner">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-[var(--text-secondary)] font-bold uppercase tracking-wider">
                      {tool.tool_type === 'N8N' ? 'Orchestration Flow' : 'Endpoint Node'}
                    </span>
                    <span className="text-[8px] font-extrabold px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)]">
                      {tool.method}
                    </span>
                  </div>
                  <p className="mt-2 text-[9px] text-[var(--text-muted)] font-mono truncate leading-none">
                    {tool.tool_type === 'WEBHOOK' || tool.tool_type === 'N8N' ? tool.url : 'Native Relay Adapter'}
                  </p>
                </div>
              </div>
            ))}

            {/* ADD CARD */}
            <button
              onClick={() => {
                setCreationStep('type');
                setIsAdding(true);
              }}
              className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface-secondary)]/30 p-6 flex flex-col items-center justify-center min-h-[250px] hover:border-[var(--border-hover)] hover:bg-[var(--surface-secondary)]/50 group relative overflow-hidden text-center"
            >
              <div className="w-12 h-12 rounded-xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center text-[var(--text-secondary)] group-hover:text-[var(--accent)] group-hover:border-[var(--border-hover)] mb-4 shadow-sm">
                <Plus size={20} />
              </div>
              <h3 className="text-xs font-bold text-[var(--text-primary)] tracking-wide uppercase tracking-wider">
                Add New Tool
              </h3>
              <p className="text-[var(--text-muted)] text-xs mt-2 max-w-[200px] leading-relaxed font-medium">
                Connect webhooks, workflows and direct Google service integrations.
              </p>
            </button>
          </div>
        )}
      </div>

      {/* ADD/CONFIGURE MODAL */}
      {isAdding && (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
            
            {/* MODAL HEADER */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  {creationStep === 'type' ? 'Add Tool Template' : `Configure ${newTool.category}`}
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {creationStep === 'type' ? 'Select a pre-built adapter type.' : 'Complete configuration parameter values.'}
                </p>
              </div>
              <button
                onClick={() => setIsAdding(false)}
                className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] transition"
              >
                <X size={15} />
              </button>
            </div>

            {/* BODY */}
            <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar flex-1">
              {creationStep === 'type' ? (
                /* STEP 1: SELECT TYPE */
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  <button 
                    onClick={() => {
                        setNewTool({...newTool, tool_type: 'WEBHOOK', category: 'Webhooks', method: 'POST', body_template: '{\n  "input": "{{input}}"\n}'});
                        setCreationStep('config');
                    }}
                    className="flex flex-col items-center gap-3 p-5 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--surface)] transition text-center group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[var(--surface)] flex items-center justify-center border border-[var(--border)]"><CustomWebhookIcon size={20} /></div>
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">Custom Webhook</h4>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Connect any REST API endpoint</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                        setNewTool({...newTool, tool_type: 'N8N', category: 'n8n Workflows', method: 'POST'});
                        setCreationStep('config');
                    }}
                    className="flex flex-col items-center gap-3 p-5 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--surface)] transition text-center group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[var(--surface)] flex items-center justify-center border border-[var(--border)]"><N8NIcon size={20} /></div>
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">n8n Workflow</h4>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Budgeting, spreadsheets & custom flows</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                        setNewTool({...newTool, tool_type: 'CALENDAR', category: 'Google Apps', method: 'NATIVE'});
                        setCreationStep('config');
                    }}
                    className="flex flex-col items-center gap-3 p-5 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--surface)] transition text-center group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[var(--surface)] flex items-center justify-center border border-[var(--border)]"><GoogleCalendarIcon size={20} /></div>
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">Google Calendar</h4>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Schedule meetings & query events</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => {
                        setNewTool({...newTool, tool_type: 'SHEETS', category: 'Google Apps', method: 'NATIVE'});
                        setCreationStep('config');
                    }}
                    className="flex flex-col items-center gap-3 p-5 rounded-xl bg-[var(--surface-secondary)] border border-[var(--border)] hover:border-[var(--primary)] hover:bg-[var(--surface)] transition text-center group"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[var(--surface)] flex items-center justify-center border border-[var(--border)]"><GoogleSheetsIcon size={20} /></div>
                    <div>
                      <h4 className="text-xs font-bold text-[var(--text-primary)]">Google Sheets</h4>
                      <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Log session entries & user profiles</p>
                    </div>
                  </button>
                </div>
              ) : (
                /* STEP 2: CONFIGURE VALUES */
                <div className="space-y-4 animate-in slide-in-from-right-2 duration-200">
                  <div className="flex items-center gap-4 mb-1">
                    <button 
                      onClick={() => setCreationStep('type')}
                      className="text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider hover:underline"
                    >
                      ← Back to Templates
                    </button>
                  </div>

                  {/* NAME */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">
                      Tool Name
                    </label>
                    <input
                      value={newTool.name}
                      onChange={(e) =>
                        setNewTool({
                          ...newTool,
                          name: e.target.value,
                        })
                      }
                      placeholder="e.g. Appointment Scheduler"
                      className="input-field"
                    />
                  </div>

                  {/* DESCRIPTION */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">
                      Description
                    </label>
                    <textarea
                      value={newTool.description}
                      onChange={(e) =>
                        setNewTool({
                          ...newTool,
                          description: e.target.value,
                        })
                      }
                      placeholder="Describe what this tool does so the AI model knows when to execute it..."
                      className="w-full h-20 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3 text-xs outline-none resize-none focus:border-[var(--border-focus)] transition leading-relaxed font-medium text-[var(--text-primary)]"
                    />
                  </div>

                  {/* TYPE SPECIFIC CONFIGS */}
                  {newTool.tool_type === 'N8N' && (
                    <div className="space-y-3 animate-in fade-in duration-200">
                      <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl space-y-1">
                        <span className="text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider block">N8N INTEGRATION BRIDGE</span>
                        <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed font-medium">
                          Connect your n8n workflow. Configured fields will be securely passed as JSON payload variables.
                        </p>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">
                          n8n Webhook URL
                        </label>
                        <input 
                          className="input-field font-mono"
                          placeholder="https://your-n8n.com/webhook/..."
                          value={newTool.url}
                          onChange={e => setNewTool({...newTool, url: e.target.value})}
                        />
                      </div>

                      {/* Secret Scopes / Credentials */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Secret Scopes</label>
                          <button 
                            onClick={() => {
                              const config = newTool.config || {};
                              setNewTool({
                                ...newTool, 
                                config: {
                                  ...config, 
                                  [`field_${Object.keys(config).length + 1}`]: ''
                                }
                              });
                            }}
                            className="text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider hover:underline"
                          >
                            + Add Scope
                          </button>
                        </div>

                        <div className="space-y-2">
                          {Object.entries(newTool.config || {}).map(([key, value], idx) => (
                            <div key={idx} className="flex gap-2 items-center">
                              <input 
                                className="flex-1 h-9 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-xs font-mono outline-none focus:border-[var(--border-focus)] text-[var(--text-primary)]"
                                placeholder="Key"
                                value={key}
                                onChange={(e) => {
                                  const newConfig = {...(newTool.config || {})};
                                  delete newConfig[key];
                                  newConfig[e.target.value] = value;
                                  setNewTool({...newTool, config: newConfig});
                                }}
                              />
                              <input 
                                className="flex-[2] h-9 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 text-xs outline-none focus:border-[var(--border-focus)] text-[var(--text-primary)]"
                                placeholder="Value"
                                value={value as string}
                                onChange={(e) => {
                                  setNewTool({...newTool, config: {...(newTool.config || {}), [key]: e.target.value}});
                                }}
                              />
                              <button 
                                onClick={() => {
                                  const newConfig = {...(newTool.config || {})};
                                  delete newConfig[key];
                                  setNewTool({...newTool, config: newConfig});
                                }}
                                className="p-1.5 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                          {Object.keys(newTool.config || {}).length === 0 && (
                            <div className="text-center py-3 border border-[var(--border)] border-dashed rounded-xl">
                              <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider">No secret scopes defined</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {newTool.tool_type === 'CALENDAR' && (
                    <div className="space-y-3 animate-in fade-in duration-200">
                      <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl space-y-1">
                        <span className="text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider block">NATIVE CALENDAR ADAPTER</span>
                        <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed font-medium">
                          Allows agent to view and book events. Connect your Google account and paste a Calendar ID.
                        </p>
                      </div>

                      {/* Google Connection Status */}
                      {integrations.filter(i => i.provider === 'google').length > 0 ? (
                        <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Google Account Connected</span>
                          <span className="text-[9px] text-[var(--text-muted)] ml-auto">Auth handled automatically</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">No Google Account Connected</span>
                          <button onClick={() => window.location.href = '/integrations'} className="text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider ml-auto hover:underline">Connect Now</button>
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Calendar ID</label>
                        <input 
                          className="input-field font-mono"
                          placeholder="primary"
                          value={newTool.config?.calendarId || ''}
                          onChange={e => setNewTool({...newTool, config: {...newTool.config, calendarId: e.target.value}})}
                        />
                        <p className="text-[8px] text-[var(--text-muted)] ml-1 mt-0.5">Use "primary" for your main calendar, or paste a specific calendar ID.</p>
                      </div>
                    </div>
                  )}

                  {newTool.tool_type === 'SHEETS' && (
                    <div className="space-y-3 animate-in fade-in duration-200">
                      <div className="p-3 bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl space-y-1">
                        <span className="text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider block">GOOGLE SHEETS ADAPTER</span>
                        <p className="text-[9px] text-[var(--text-secondary)] leading-relaxed font-medium">
                          Log live conversations, caller details, and leads directly inside custom spreadsheet cells. Just paste your Google Sheet link below.
                        </p>
                      </div>

                      {/* Google Connection Status */}
                      {integrations.filter(i => i.provider === 'google').length > 0 ? (
                        <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl">
                          <div className="w-2 h-2 rounded-full bg-emerald-500" />
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Google Account Connected</span>
                          <span className="text-[9px] text-[var(--text-muted)] ml-auto">Auth handled automatically</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                          <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                          <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">No Google Account Connected</span>
                          <button onClick={() => window.location.href = '/integrations'} className="text-[9px] font-bold text-[var(--primary)] uppercase tracking-wider ml-auto hover:underline">Connect Now</button>
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Google Sheet URL</label>
                        <input 
                          className="input-field font-mono"
                          placeholder="https://docs.google.com/spreadsheets/d/... or paste just the ID"
                          value={newTool.config?.spreadsheetId || ''}
                          onChange={e => {
                              const val = e.target.value;
                              let finalId = val;
                              const match = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9\-_]+)/);
                              if (match && match[1]) {
                                  finalId = match[1];
                                  toast.success('Spreadsheet ID extracted from URL!');
                              }
                              setNewTool({...newTool, config: {...newTool.config, spreadsheetId: finalId}});
                          }}
                        />
                        <p className="text-[8px] text-[var(--text-muted)] ml-1 mt-0.5">Paste the full Google Sheet link — the spreadsheet ID will be extracted automatically.</p>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Sheet Tab / Range (optional)</label>
                        <input
                          className="input-field font-mono"
                          placeholder="Leave blank to auto-use the first tab"
                          value={newTool.config?.range || ''}
                          onChange={e => setNewTool({...newTool, config: {...newTool.config, range: e.target.value}})}
                        />
                        <p className="text-[8px] text-[var(--text-muted)] ml-1 mt-0.5">
                          Only needed if you want the agent to write to a specific tab, e.g. <code>Leads!A1</code>. By default the agent writes to whichever tab is first in the spreadsheet — it no longer assumes a tab literally named "Sheet1".
                        </p>
                      </div>
                    </div>
                  )}

                  {newTool.tool_type === 'WEBHOOK' && (
                    <div className="space-y-3 animate-in fade-in duration-200">
                      {/* URL */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">
                          Endpoint URL
                        </label>
                        <input
                          value={newTool.url}
                          onChange={(e) =>
                            setNewTool({
                              ...newTool,
                              url: e.target.value,
                            })
                          }
                          placeholder="https://api.example.com/webhook"
                          className="input-field font-mono"
                        />
                      </div>

                      {/* API KEY */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">API Key / Token (Secure)</label>
                        <input 
                          type="password"
                          className="input-field font-mono"
                          placeholder="••••••••••••••••"
                          value={newTool.api_key}
                          onChange={e => setNewTool({...newTool, api_key: e.target.value})}
                        />
                      </div>

                      {/* ADVANCED HTTP OPTIONS */}
                      <div className="border-t border-[var(--border)] pt-3 mt-1 space-y-3">
                        <button 
                          onClick={() => setShowAdvanced(!showAdvanced)}
                          className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5 hover:text-[var(--text-primary)] transition-colors"
                        >
                          {showAdvanced ? '− Hide' : '+ Show'} Advanced HTTP Settings
                        </button>

                        <div className={`space-y-3 overflow-hidden transition-all duration-300 ${showAdvanced ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'}`}>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">HTTP Method</label>
                              <Select 
                                value={newTool.method || 'POST'}
                                onChange={val => setNewTool({...newTool, method: val})}
                                options={['GET', 'POST', 'PUT']}
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Custom Headers (JSON)</label>
                              <input 
                                className="input-field font-mono text-xs"
                                placeholder='{"X-Header": "Value"}'
                                onChange={e => {
                                  try {
                                    setNewTool({...newTool, headers: JSON.parse(e.target.value)});
                                  } catch(err) {}
                                }}
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <label className="text-[9px] font-bold text-[var(--text-secondary)] uppercase tracking-wider ml-1">Body Template (JSON)</label>
                            <textarea 
                              rows={2}
                              className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] p-3 text-xs outline-none resize-none focus:border-[var(--border-focus)] transition font-mono leading-relaxed text-[var(--text-primary)]"
                              placeholder='{ "query": "{{query}}" }'
                              value={newTool.body_template}
                              onChange={e => setNewTool({...newTool, body_template: e.target.value})}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ACTIONS */}
                  <div className="flex items-center gap-3 pt-4 border-t border-[var(--border)]">
                    {newTool.tool_type === 'WEBHOOK' && (
                      <button
                        onClick={handleTestNewTool}
                        disabled={isTestingConfig}
                        className="btn-outline flex-1"
                      >
                        {isTestingConfig ? <RefreshCw className="animate-spin" size={13} /> : <Zap size={13} />}
                        Probe Path
                      </button>
                    )}

                    <button
                      onClick={handleSave}
                      className="btn-primary flex-1 shadow-lg shadow-blue-500/10"
                    >
                      Save Tool Connection
                    </button>
                  </div>

                  {/* PROBE RESULTS */}
                  {testResult && (
                    <div className={`p-3 rounded-xl border flex items-center justify-between animate-in slide-in-from-top-1 ${
                      testResult.status === 'success' ? 'bg-emerald-500/5 border-emerald-500/20 text-[var(--success)]' : 'bg-red-500/5 border-red-500/20 text-[var(--danger)]'
                    }`}>
                      <div className="flex items-center gap-2">
                        <div className={`w-1.5 h-1.5 rounded-full ${testResult.status === 'success' ? 'bg-[var(--success)]' : 'bg-[var(--danger)] animate-pulse'}`} />
                        <span className="text-[10px] font-bold uppercase tracking-wider leading-none">
                          {testResult.status === 'success' ? `Node Online (HTTP ${testResult.code})` : `Probe Failed: ${testResult.error}`}
                        </span>
                      </div>
                      {testResult.status === 'success' && (
                        <button 
                          onClick={() => { setInspectorData(testResult.fullResponse); setShowInspector(true); }}
                          className="px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] hover:border-[var(--border-hover)]"
                        >
                          Inspector
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* INSPECTOR MODAL */}
      {showInspector && inspectorData && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 z-[200] animate-in zoom-in-95 duration-200">
           <div className="bg-[var(--surface)] border border-[var(--border)] w-full max-w-2xl max-h-[75vh] rounded-2xl flex flex-col shadow-xl relative overflow-hidden">
              <div className="p-5 border-b border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`px-2 py-1 rounded text-xs font-bold ${inspectorData.code === 200 ? 'bg-emerald-500/10 text-[var(--success)]' : 'bg-amber-500/10 text-[var(--primary)]'}`}>
                    {inspectorData.code || '200'}
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider leading-none">Response Inspector</h3>
                    <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-wider mt-1 leading-none">Payload captured from live node</p>
                  </div>
                </div>
                <button onClick={() => setShowInspector(false)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-5 custom-scrollbar">
                <div className="bg-[var(--surface-secondary)] border border-[var(--border)] rounded-xl p-4 font-mono text-[10px] leading-relaxed text-[var(--primary)] max-h-[40vh] overflow-y-auto custom-scrollbar">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(inspectorData.response || inspectorData, null, 2)}</pre>
                </div>
              </div>

              <div className="p-4 border-t border-[var(--border)] flex justify-between items-center text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                <span>Foundry Diagnostics v1.0</span>
                <span>Data parsed successfully.</span>
              </div>
           </div>
        </div>
      )}

      {/* DECOMMISSION DIALOG */}
      <DecommissionModal 
        isOpen={!!decommissioningItem}
        onClose={() => setDecommissioningItem(null)}
        onConfirm={confirmDecommission}
        title="Disconnect Tool"
        itemName={decommissioningItem?.name || ''}
        loading={isDeleting}
      />
    </div>
  );
};