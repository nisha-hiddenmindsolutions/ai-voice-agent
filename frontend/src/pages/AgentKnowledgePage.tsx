import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FileText, Trash2, UploadCloud, AlertCircle, ArrowLeft,
  BookOpen, Loader2, Settings2, ChevronDown, ChevronUp,
  Plug, Save, RefreshCw, CheckCircle2, XCircle, Eye, EyeOff,
  Cpu, Database, Scissors,
} from 'lucide-react';
import { agentApi, knowledgeApi } from '../services/api';
import { Select } from '../components/ui/Select';
import toast from 'react-hot-toast';

// ─────────────────────────────────────────────────────────────────────────────
// Types — mirror the backend Pydantic schemas exactly
// ─────────────────────────────────────────────────────────────────────────────

interface KnowledgeDoc {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  index_status: 'indexed' | 'reindexing' | 'failed';
  embedding_model_used: string;
  created_at: string;
}

interface RAGConfig {
  agent_id: string;
  embedding_provider: string;
  embedding_model: string;
  embedding_dim: number;
  embedding_api_key_set: boolean;
  vector_db_provider: string;
  vector_db_url: string | null;
  vector_db_index: string | null;
  vector_db_api_key_set: boolean;
  chunk_strategy: string;
  chunk_size: number;
  chunk_overlap: number;
  updated_at: string | null;
}

interface TestResult {
  embedding_ok: boolean;
  vector_db_ok: boolean;
  errors: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Static provider / model maps — must stay in sync with EMBEDDING_DIMS in rag.py
// ─────────────────────────────────────────────────────────────────────────────

const EMBEDDING_PROVIDERS = [
  { value: 'gemini',  label: 'Google Gemini' },
  { value: 'openai',  label: 'OpenAI' },
  { value: 'cohere',  label: 'Cohere' },
  { value: 'voyage',  label: 'Voyage AI' },
];

const EMBEDDING_MODELS: Record<string, { value: string; label: string }[]> = {
  gemini: [
    { value: 'gemini-embedding-2',  label: 'gemini-embedding-2  (768d)' },
    { value: 'text-embedding-004',  label: 'text-embedding-004  (768d)' },
  ],
  openai: [
    { value: 'text-embedding-3-small',  label: 'text-embedding-3-small  (1536d)' },
    { value: 'text-embedding-3-large',  label: 'text-embedding-3-large  (3072d)' },
    { value: 'text-embedding-ada-002',  label: 'text-embedding-ada-002  (1536d)' },
  ],
  cohere: [
    { value: 'embed-english-v3.0',       label: 'embed-english-v3.0  (1024d)' },
    { value: 'embed-multilingual-v3.0',  label: 'embed-multilingual-v3.0  (1024d)' },
    { value: 'embed-english-light-v3.0', label: 'embed-english-light-v3.0  (384d)' },
  ],
  voyage: [
    { value: 'voyage-3',        label: 'voyage-3  (1024d)' },
    { value: 'voyage-3-lite',   label: 'voyage-3-lite  (512d)' },
    { value: 'voyage-finance-2',label: 'voyage-finance-2  (1024d)' },
    { value: 'voyage-law-2',    label: 'voyage-law-2  (1024d)' },
  ],
};

const VECTOR_DB_PROVIDERS = [
  { value: 'qdrant',    label: 'Qdrant' },
  { value: 'pinecone',  label: 'Pinecone' },
  { value: 'weaviate',  label: 'Weaviate' },
  { value: 'chroma',    label: 'ChromaDB' },
];

const CHUNK_STRATEGIES = [
  {
    value: 'fixed',
    label: 'Fixed Size',
    icon: '▦',
    desc: 'Fast & predictable. Best for dense reference docs and technical manuals.',
  },
  {
    value: 'sentence',
    label: 'Sentence',
    icon: '❝',
    desc: 'Preserves sentence boundaries. Best for Q&A and conversational content.',
  },
  {
    value: 'paragraph',
    label: 'Paragraph',
    icon: '¶',
    desc: 'Groups logical sections. Best for reports, legal docs, and structured FAQs.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const formatBytes = (bytes: number): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
};

// ─────────────────────────────────────────────────────────────────────────────
// ApiKeyInput — shows masked placeholder when key already stored on backend
// ─────────────────────────────────────────────────────────────────────────────

const ApiKeyInput = ({
  label,
  isSet,
  value,
  onChange,
  placeholder = 'Enter API key...',
}: {
  label: string;
  isSet: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) => {
  const [editing, setEditing] = useState(false);
  const [show, setShow]       = useState(false);

  if (isSet && !editing) {
    return (
      <div className="space-y-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</label>
        <div className="flex items-center justify-between h-10 px-4 rounded-[10px] border border-[var(--border)] bg-[var(--input-bg)]">
          <span className="text-[var(--text-muted)] tracking-widest text-xs font-mono">●●●●●●●●●●●●</span>
          <button type="button" onClick={() => setEditing(true)}
            className="text-[10px] font-bold text-[var(--primary)] hover:underline shrink-0 ml-3">
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
        {label}
        {isSet && (
          <span className="ml-1 normal-case font-normal text-[var(--text-muted)]">(blank = keep existing)</span>
        )}
      </label>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full h-10 px-4 pr-10 rounded-[10px] border border-[var(--border)] bg-[var(--input-bg)] text-sm text-[var(--text-primary)] font-medium placeholder:text-[var(--text-placeholder)] outline-none focus:border-[var(--border-focus)] transition-all"
        />
        <button type="button" onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors">
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// IndexStatusBadge
// ─────────────────────────────────────────────────────────────────────────────

const IndexStatusBadge = ({ status }: { status: KnowledgeDoc['index_status'] }) => {
  if (status === 'reindexing') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-amber-500/10 border border-amber-500/20 text-amber-400">
      <Loader2 size={9} className="animate-spin" /> Reindexing
    </span>
  );
  if (status === 'failed') return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-red-500/10 border border-red-500/20 text-red-400">
      <XCircle size={9} /> Failed
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Indexed
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Text input helper — shared style
// ─────────────────────────────────────────────────────────────────────────────

const TextInput = ({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <div className="space-y-1.5">
    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{label}</label>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-10 px-4 rounded-[10px] border border-[var(--border)] bg-[var(--input-bg)] text-sm text-[var(--text-primary)] font-medium placeholder:text-[var(--text-placeholder)] outline-none focus:border-[var(--border-focus)] transition-all"
    />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Main Page Component
// ─────────────────────────────────────────────────────────────────────────────

const AgentKnowledgePage = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate    = useNavigate();

  // ── Page-level state ──────────────────────────────────────────────────────
  const [agent,     setAgent]     = useState<any>(null);
  const [documents, setDocuments] = useState<KnowledgeDoc[]>([]);
  const [loading,   setLoading]   = useState(true);

  // ── Upload state ──────────────────────────────────────────────────────────
  const [uploading,  setUploading]  = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // ── Config panel toggle ───────────────────────────────────────────────────
  const [configOpen,   setConfigOpen]   = useState(false);
  const [savedConfig,  setSavedConfig]  = useState<RAGConfig | null>(null);

  // ── Embedding form fields ─────────────────────────────────────────────────
  const [embProvider, setEmbProvider] = useState('gemini');
  const [embModel,    setEmbModel]    = useState('gemini-embedding-2');
  const [embKey,      setEmbKey]      = useState('');
  const [embKeySet,   setEmbKeySet]   = useState(false);

  // ── Vector DB form fields ─────────────────────────────────────────────────
  const [vdbProvider, setVdbProvider] = useState('qdrant');
  const [vdbUrl,      setVdbUrl]      = useState('');
  const [vdbIndex,    setVdbIndex]    = useState('');
  const [vdbKey,      setVdbKey]      = useState('');
  const [vdbKeySet,   setVdbKeySet]   = useState(false);

  // ── Chunking fields ───────────────────────────────────────────────────────
  const [chunkStrategy, setChunkStrategy] = useState('fixed');
  const [chunkSize,     setChunkSize]     = useState(600);
  const [chunkOverlap,  setChunkOverlap]  = useState(150);

  // ── Action states ─────────────────────────────────────────────────────────
  const [savingConfig, setSavingConfig] = useState(false);
  const [testing,      setTesting]      = useState(false);
  const [testResult,   setTestResult]   = useState<TestResult | null>(null);
  const [reindexing,   setReindexing]   = useState(false);

  // True when any indexed doc was built with a different model than what's currently saved
  const modelMismatch = savedConfig
    ? documents.some(d => d.index_status === 'indexed' && d.embedding_model_used && d.embedding_model_used !== savedConfig.embedding_model)
    : false;

  // ── Load data on mount ────────────────────────────────────────────────────
  useEffect(() => {
    if (!agentId) return;
    (async () => {
      setLoading(true);
      try {
        const [agentRes, docRes, cfgRes] = await Promise.all([
          agentApi.get(agentId),
          knowledgeApi.list(agentId),
          knowledgeApi.getConfig(agentId),
        ]);
        setAgent(agentRes.data);
        setDocuments(docRes.data || []);
        applyConfig(cfgRes.data);
        setSavedConfig(cfgRes.data);
      } catch {
        toast.error('Failed to load knowledge base');
      } finally {
        setLoading(false);
      }
    })();
  }, [agentId]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const applyConfig = (cfg: RAGConfig) => {
    setEmbProvider(cfg.embedding_provider);
    setEmbModel(cfg.embedding_model);
    setEmbKeySet(cfg.embedding_api_key_set);
    setEmbKey('');
    setVdbProvider(cfg.vector_db_provider);
    setVdbUrl(cfg.vector_db_url || '');
    setVdbIndex(cfg.vector_db_index || '');
    setVdbKeySet(cfg.vector_db_api_key_set);
    setVdbKey('');
    setChunkStrategy(cfg.chunk_strategy);
    setChunkSize(cfg.chunk_size);
    setChunkOverlap(cfg.chunk_overlap);
    setTestResult(null);
  };

  const handleEmbProviderChange = (p: string) => {
    setEmbProvider(p);
    const first = EMBEDDING_MODELS[p]?.[0]?.value;
    if (first) setEmbModel(first);
    setTestResult(null);
  };

  // ── Test connection ───────────────────────────────────────────────────────
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await knowledgeApi.testConnection({
        embedding_provider: embProvider,
        embedding_model:    embModel,
        embedding_api_key:  embKey || null,
        vector_db_provider: vdbProvider,
        vector_db_url:      vdbUrl   || null,
        vector_db_api_key:  vdbKey   || null,
        vector_db_index:    vdbIndex || null,
      });
      setTestResult(res.data);
    } catch {
      toast.error('Connection test failed — check your credentials');
    } finally {
      setTesting(false);
    }
  };

  // ── Save config ───────────────────────────────────────────────────────────
  const handleSaveConfig = async () => {
    if (!agentId) return;
    setSavingConfig(true);
    const tid = toast.loading('Saving RAG configuration...');
    try {
      const res = await knowledgeApi.saveConfig(agentId, {
        embedding_provider: embProvider,
        embedding_model:    embModel,
        embedding_api_key:  embKey   || null,
        vector_db_provider: vdbProvider,
        vector_db_url:      vdbUrl   || null,
        vector_db_api_key:  vdbKey   || null,
        vector_db_index:    vdbIndex || null,
        chunk_strategy:     chunkStrategy,
        chunk_size:         chunkSize,
        chunk_overlap:      chunkOverlap,
      });
      setSavedConfig(res.data);
      applyConfig(res.data);
      toast.success('Configuration saved', { id: tid });
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to save configuration', { id: tid });
    } finally {
      setSavingConfig(false);
    }
  };

  // ── Re-index ──────────────────────────────────────────────────────────────
  const handleReindex = async () => {
    if (!agentId) return;
    if (!confirm('Re-embed all documents using the current configuration? This may take a while.')) return;
    setReindexing(true);
    setDocuments(prev => prev.map(d => ({ ...d, index_status: 'reindexing' as const })));
    const tid = toast.loading('Re-indexing all documents...');
    try {
      const res = await knowledgeApi.reindex(agentId);
      const { reindexed, failed, total } = res.data;
      toast.success(
        `Re-indexed ${reindexed}/${total} document${total !== 1 ? 's' : ''}${failed > 0 ? ` · ${failed} failed` : ''}`,
        { id: tid },
      );
      const docRes = await knowledgeApi.list(agentId);
      setDocuments(docRes.data || []);
    } catch {
      toast.error('Re-index failed', { id: tid });
      const docRes = await knowledgeApi.list(agentId);
      setDocuments(docRes.data || []);
    } finally {
      setReindexing(false);
    }
  };

  // ── Upload handlers ───────────────────────────────────────────────────────
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const processFile = useCallback(async (file: File) => {
    if (!agentId) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'txt') {
      toast.error('Only PDF (.pdf) and Text (.txt) files are supported.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast.error('File exceeds 15 MB limit.');
      return;
    }
    setUploading(true);
    const tid = toast.loading(`Indexing "${file.name}"...`);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await knowledgeApi.upload(agentId, fd);
      setDocuments(prev => [res.data, ...prev]);
      toast.success('Document indexed successfully', { id: tid });
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Upload failed', { id: tid });
    } finally {
      setUploading(false);
    }
  }, [agentId]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) await processFile(e.dataTransfer.files[0]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) await processFile(e.target.files[0]);
    e.target.value = '';
  };

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (docId: string, filename: string) => {
    if (!confirm(`Delete "${filename}" and remove its vector index?`)) return;
    const tid = toast.loading(`Deleting "${filename}"...`);
    try {
      await knowledgeApi.delete(docId);
      setDocuments(prev => prev.filter(d => d.id !== docId));
      toast.success('Document deleted', { id: tid });
    } catch {
      toast.error('Failed to delete document', { id: tid });
    }
  };

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4 animate-in fade-in duration-300">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--primary)] animate-spin" />
        <span className="text-[11px] font-mono text-[var(--text-muted)] tracking-wider">Syncing knowledge base...</span>
      </div>
    );
  }

  const modelOptions = (EMBEDDING_MODELS[embProvider] || []);

  // ─────────────────────────────────────────────────────────────────────────
  // JSX
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1400px] mx-auto pb-24 animate-in fade-in duration-500 font-sans relative z-10 space-y-6">

      {/* ── HEADER BANNER ────────────────────────────────────────────────── */}
      <div className="relative p-6 rounded-2xl border border-[var(--border)] bg-gradient-to-r from-[var(--surface-secondary)]/20 to-[var(--surface)]/10 shadow-sm backdrop-blur-md overflow-hidden">
        <div className="absolute top-0 right-0 w-[300px] h-[300px] rounded-full bg-[var(--primary)]/5 dark:bg-[var(--primary)]/8 blur-[80px] pointer-events-none z-0" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-muted)] mb-1">
              <span
                className="cursor-pointer hover:text-[var(--text-primary)] transition-colors"
                onClick={() => navigate(`/agent/${agentId}/overview`)}
              >
                {agent?.agentName || 'Agent'}
              </span>
              <span>/</span>
              <span className="text-[var(--text-secondary)] font-bold">Knowledge Base</span>
            </div>
            <h1 className="text-xl md:text-2xl font-black tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Knowledge Base · RAG System
            </h1>
            <p className="text-xs mt-1 max-w-[750px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Upload PDF or TXT files and configure your embedding model and vector database.
              The agent searches this indexed knowledge in real time to ground its answers.
            </p>
          </div>
          <button
            onClick={() => navigate(`/agent/${agentId}/overview`)}
            className="h-9 px-4 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg active:scale-[0.98] transition-all shrink-0"
          >
            <ArrowLeft size={14} />
            Agent Dashboard
          </button>
        </div>
      </div>

      {/* ── SECTION 1: RAG CONFIGURATION PANEL ───────────────────────────── */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] shadow-md overflow-hidden">

        {/* Collapse / expand header */}
        <button
          type="button"
          onClick={() => setConfigOpen(o => !o)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-[var(--surface-secondary)]/20 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">
              <Settings2 size={16} />
            </div>
            <div className="text-left">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-primary)]">
                RAG Configuration
              </p>
              {savedConfig && (
                <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {savedConfig.embedding_provider} / {savedConfig.embedding_model}
                  &nbsp;·&nbsp;{savedConfig.vector_db_provider}
                  &nbsp;·&nbsp;{savedConfig.chunk_strategy} chunks
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {savedConfig && (
              <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wider bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                <CheckCircle2 size={9} /> Configured
              </span>
            )}
            {configOpen
              ? <ChevronUp  size={16} className="text-[var(--text-muted)]" />
              : <ChevronDown size={16} className="text-[var(--text-muted)]" />
            }
          </div>
        </button>

        {/* Expanded body */}
        {configOpen && (
          <div className="border-t border-[var(--border)] px-6 py-6 space-y-5">

            {/* ── 1a. Embedding Model ─────────────────────────────────────── */}
            <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/10 space-y-4">
              <div className="flex items-center gap-2">
                <Cpu size={13} className="text-[var(--primary)]" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-primary)]">
                  Embedding Model
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Provider</label>
                  <Select
                    value={embProvider}
                    onChange={handleEmbProviderChange}
                    options={EMBEDDING_PROVIDERS}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Model</label>
                  <Select
                    value={embModel}
                    onChange={v => { setEmbModel(v); setTestResult(null); }}
                    options={modelOptions}
                  />
                </div>
              </div>
              <ApiKeyInput
                label="API Key"
                isSet={embKeySet}
                value={embKey}
                onChange={setEmbKey}
                placeholder="sk-... or AIzaSy..."
              />
            </div>

            {/* ── 1b. Vector Database ─────────────────────────────────────── */}
            <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/10 space-y-4">
              <div className="flex items-center gap-2">
                <Database size={13} className="text-[var(--accent)]" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-primary)]">
                  Vector Database
                </span>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Provider</label>
                <Select
                  value={vdbProvider}
                  onChange={v => { setVdbProvider(v); setTestResult(null); }}
                  options={VECTOR_DB_PROVIDERS}
                />
              </div>

              {/* Conditional credential fields */}
              <div className="space-y-4">
                {/* URL — Qdrant / Weaviate / Chroma */}
                {(vdbProvider === 'qdrant' || vdbProvider === 'weaviate' || vdbProvider === 'chroma') && (
                  <TextInput
                    label={vdbProvider === 'chroma' ? 'ChromaDB URL' : 'Cluster URL'}
                    value={vdbUrl}
                    onChange={setVdbUrl}
                    placeholder={
                      vdbProvider === 'qdrant'   ? 'https://xyz.qdrant.tech'
                      : vdbProvider === 'weaviate' ? 'https://xyz.weaviate.network'
                      : 'http://localhost:8080'
                    }
                  />
                )}
                {/* Index name — Pinecone only */}
                {vdbProvider === 'pinecone' && (
                  <TextInput
                    label="Index Name"
                    value={vdbIndex}
                    onChange={setVdbIndex}
                    placeholder="my-pinecone-index"
                  />
                )}
                {/* API key — not needed for Chroma */}
                {vdbProvider !== 'chroma' && (
                  <ApiKeyInput
                    label="API Key"
                    isSet={vdbKeySet}
                    value={vdbKey}
                    onChange={setVdbKey}
                    placeholder="Enter vector DB API key..."
                  />
                )}
              </div>
            </div>

            {/* ── 1c. Chunking Strategy ───────────────────────────────────── */}
            <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/10 space-y-4">
              <div className="flex items-center gap-2">
                <Scissors size={13} className="text-[var(--primary)]" />
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--text-primary)]">
                  Chunking Strategy
                </span>
              </div>

              {/* Strategy cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {CHUNK_STRATEGIES.map(s => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setChunkStrategy(s.value)}
                    className={`text-left p-4 rounded-xl border transition-all ${
                      chunkStrategy === s.value
                        ? 'border-[var(--primary)] bg-[var(--primary)]/8 shadow-sm'
                        : 'border-[var(--border)] bg-[var(--surface-secondary)]/10 hover:border-[var(--border-hover)]'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-sm leading-none">{s.icon}</span>
                      <span className={`text-[10px] font-extrabold uppercase tracking-wider ${
                        chunkStrategy === s.value ? 'text-[var(--primary)]' : 'text-[var(--text-secondary)]'
                      }`}>
                        {s.label}
                      </span>
                    </div>
                    <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">{s.desc}</p>
                  </button>
                ))}
              </div>

              {/* Sliders */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-1">
                {/* Chunk size */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Chunk Size</label>
                    <span className="text-[11px] font-extrabold text-[var(--primary)] tabular-nums">{chunkSize} chars</span>
                  </div>
                  <input
                    type="range" min={100} max={2000} step={50}
                    value={chunkSize}
                    onChange={e => {
                      const next = Number(e.target.value);
                      setChunkSize(next);
                      if (chunkOverlap > Math.floor(next / 2)) setChunkOverlap(Math.floor(next / 2));
                    }}
                    className="w-full h-1.5 rounded-full appearance-none bg-[var(--border)] accent-[var(--primary)] cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-[var(--text-muted)] font-bold">
                    <span>100</span><span>2000</span>
                  </div>
                </div>
                {/* Overlap */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Overlap</label>
                    <span className="text-[11px] font-extrabold text-[var(--primary)] tabular-nums">{chunkOverlap} chars</span>
                  </div>
                  <input
                    type="range" min={0} max={Math.floor(chunkSize / 2)} step={25}
                    value={chunkOverlap}
                    onChange={e => setChunkOverlap(Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none bg-[var(--border)] accent-[var(--primary)] cursor-pointer"
                  />
                  <div className="flex justify-between text-[9px] text-[var(--text-muted)] font-bold">
                    <span>0</span><span>{Math.floor(chunkSize / 2)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Test result ─────────────────────────────────────────────── */}
            {testResult && (
              <div className={`flex flex-wrap items-start gap-4 p-4 rounded-xl border text-xs font-medium ${
                testResult.embedding_ok && testResult.vector_db_ok
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400'
                  : 'border-red-500/20 bg-red-500/5 text-red-400'
              }`}>
                <div className="flex items-center gap-2 shrink-0">
                  {testResult.embedding_ok
                    ? <CheckCircle2 size={14} className="text-emerald-400" />
                    : <XCircle      size={14} className="text-red-400" />}
                  <span>Embedding {testResult.embedding_ok ? 'OK' : 'Failed'}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {testResult.vector_db_ok
                    ? <CheckCircle2 size={14} className="text-emerald-400" />
                    : <XCircle      size={14} className="text-red-400" />}
                  <span>Vector DB {testResult.vector_db_ok ? 'OK' : 'Failed'}</span>
                </div>
                {testResult.errors.length > 0 && (
                  <div className="w-full pt-2 border-t border-red-500/10 space-y-1">
                    {testResult.errors.map((e, i) => (
                      <p key={i} className="text-[10px] font-mono text-red-400">{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Model-mismatch re-index warning ─────────────────────────── */}
            {modelMismatch && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-amber-500/20 bg-amber-500/5">
                <AlertCircle size={16} className="text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-amber-400">Embedding model changed</p>
                  <p className="text-[10px] text-[var(--text-muted)] leading-relaxed mt-0.5">
                    Some documents were indexed with a different model. Re-index to rebuild all vectors with the current model.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleReindex}
                  disabled={reindexing}
                  className="h-9 px-4 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 rounded-lg active:scale-[0.98] transition-all disabled:opacity-50 shrink-0"
                >
                  {reindexing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Re-index All
                </button>
              </div>
            )}

            {/* ── Action buttons ───────────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing || savingConfig}
                className="h-9 px-5 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-lg active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {testing ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
                Test Connection
              </button>

              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={savingConfig || testing}
                className="h-9 px-5 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg active:scale-[0.98] transition-all disabled:opacity-50 shadow-sm"
              >
                {savingConfig ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                Save Configuration
              </button>

              {/* Manual re-index when no mismatch is detected */}
              {documents.length > 0 && !modelMismatch && (
                <button
                  type="button"
                  onClick={handleReindex}
                  disabled={reindexing}
                  className="h-9 px-5 text-[10px] font-extrabold uppercase tracking-wider flex items-center gap-2 border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-lg active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {reindexing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Re-index All
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── SECTIONS 2 + 3: Upload + Documents ───────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* ── SECTION 2: Upload ─────────────────────────────────────────── */}
        <div className="lg:col-span-5">
          <div className="card p-6 space-y-5 shadow-md rounded-2xl bg-[var(--card-bg)] border border-[var(--border)] hover:border-[var(--border-hover)] transition-all h-full flex flex-col">
            <div className="flex items-center gap-2.5 border-b border-[var(--border)] pb-3.5">
              <div className="p-2 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">
                <UploadCloud size={18} />
              </div>
              <h2 className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-primary)]">Upload Reference Files</h2>
            </div>

            {/* Drop zone */}
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={`relative flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl text-center min-h-[220px] transition-all cursor-pointer ${
                dragActive
                  ? 'border-[var(--primary)] bg-[var(--primary)]/5 shadow-inner scale-[1.01]'
                  : 'border-[var(--border)] bg-[var(--surface-secondary)]/10 hover:bg-[var(--surface-secondary)]/20'
              }`}
            >
              <input
                type="file"
                id="file-upload-input"
                multiple={false}
                accept=".pdf,.txt"
                onChange={handleFileChange}
                disabled={uploading}
                className="hidden"
              />
              <UploadCloud
                size={36}
                className={`mb-3 transition-all ${dragActive ? 'text-[var(--primary)] scale-110' : 'text-[var(--text-muted)] animate-pulse'}`}
              />
              <p className="text-xs font-bold text-[var(--text-primary)]">
                Drag & drop your file here, or{' '}
                <label htmlFor="file-upload-input" className="text-[var(--primary)] cursor-pointer hover:underline">
                  browse computer
                </label>
              </p>
              <p className="text-[9px] text-[var(--text-muted)] font-semibold mt-1">
                Supports PDF (.pdf) and Text (.txt) files up to 15 MB.
              </p>

              {uploading && (
                <div className="absolute inset-0 bg-[var(--background)]/90 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center space-y-3">
                  <Loader2 size={28} className="text-[var(--primary)] animate-spin" />
                  <div className="text-center">
                    <p className="text-xs font-extrabold text-[var(--text-primary)]">Indexing Document...</p>
                    <p className="text-[9px] text-[var(--text-muted)] font-mono mt-0.5">
                      Chunking · embedding · storing vectors
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Tip box */}
            <div className="flex gap-3 p-4 rounded-xl border border-[var(--primary)]/10 bg-[var(--primary)]/5 dark:bg-[var(--primary)]/5">
              <AlertCircle size={18} className="text-[var(--primary)] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--primary)]">How RAG Works</span>
                <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">
                  When a caller asks the agent a question, it runs a semantic search across your uploaded documents.
                  The most relevant chunks are injected into the LLM context so answers are grounded in your data.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── SECTION 3: Indexed Documents ─────────────────────────────── */}
        <div className="lg:col-span-7">
          <div className="card p-6 space-y-4 shadow-md rounded-2xl bg-[var(--card-bg)] border border-[var(--border)] hover:border-[var(--border-hover)] transition-all min-h-[350px] flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] shrink-0">
                  <BookOpen size={18} />
                </div>
                <h2 className="text-xs font-extrabold uppercase tracking-wider text-[var(--text-primary)]">Indexed Documents</h2>
              </div>
              <span className="text-[9px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[var(--surface-secondary)] border border-[var(--border)] text-[var(--text-secondary)]">
                {documents.length} File{documents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {documents.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-12 space-y-3">
                <div className="w-12 h-12 rounded-full bg-[var(--surface-secondary)]/40 flex items-center justify-center border border-[var(--border)]">
                  <FileText size={20} className="text-[var(--text-muted)]" />
                </div>
                <div>
                  <p className="text-xs font-bold text-[var(--text-secondary)]">No reference materials added yet.</p>
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">Upload files on the left to train your agent.</p>
                </div>
              </div>
            ) : (
              <div className="space-y-3 flex-1 max-h-[500px] overflow-y-auto pr-1 custom-scrollbar">
                {documents.map(doc => (
                  <div
                    key={doc.id}
                    className="flex items-start justify-between p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/15 hover:bg-[var(--surface-secondary)]/30 hover:border-[var(--primary)]/20 transition-all group"
                  >
                    {/* Left: icon + info */}
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="p-2 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] mt-0.5 shrink-0 group-hover:scale-105 transition-transform">
                        <FileText size={16} />
                      </div>
                      <div className="min-w-0">
                        {/* Filename */}
                        <p className="text-xs font-bold text-[var(--text-primary)] truncate" title={doc.filename}>
                          {doc.filename}
                        </p>

                        {/* Meta: type · size · date */}
                        <div className="flex flex-wrap items-center gap-2 mt-1">
                          <span className={`text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${
                            doc.file_type === 'pdf'
                              ? 'border-red-500/20 bg-red-500/10 text-red-400'
                              : 'border-blue-500/20 bg-blue-500/10 text-blue-400'
                          }`}>
                            {doc.file_type}
                          </span>
                          <span className="text-[9px] text-[var(--text-muted)] font-bold">{formatBytes(doc.file_size)}</span>
                          <span className="text-[9px] text-[var(--text-muted)]">·</span>
                          <span className="text-[9px] text-[var(--text-muted)] font-bold">{formatDate(doc.created_at)}</span>
                        </div>

                        {/* Status row: badge · chunks · model */}
                        <div className="flex flex-wrap items-center gap-2 mt-2">
                          <IndexStatusBadge status={doc.index_status} />
                          {doc.index_status === 'indexed' && doc.chunk_count > 0 && (
                            <span className="text-[9px] font-bold text-[var(--text-muted)]">
                              {doc.chunk_count} chunks
                            </span>
                          )}
                          {doc.embedding_model_used && (
                            <>
                              <span className="text-[9px] text-[var(--text-muted)]">·</span>
                              <span className="text-[9px] font-mono text-[var(--text-muted)]">
                                {doc.embedding_model_used}
                              </span>
                            </>
                          )}
                          {doc.index_status === 'failed' && (
                            <span className="text-[9px] text-red-400 font-medium">Retry via Re-index All</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: delete */}
                    <button
                      onClick={() => handleDelete(doc.id, doc.filename)}
                      disabled={doc.index_status === 'reindexing'}
                      className="p-2 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 active:scale-95 transition-all ml-2 shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
                      title={doc.index_status === 'reindexing' ? 'Cannot delete while reindexing' : 'Delete document'}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
};

export default AgentKnowledgePage;