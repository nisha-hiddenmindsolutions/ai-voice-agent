import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';

const getApiBaseURL = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && (window.location.hostname.includes('ngrok') || window.location.hostname !== 'localhost')) {
    return `${window.location.origin}/api/v1`;
  }
  return 'http://localhost:8000/api/v1';
};

const api = axios.create({
  baseURL: getApiBaseURL(),
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  register: (data: any) => api.post('/auth/register', null, { params: data }),
  login: (data: any) => {
    const params = new URLSearchParams();
    Object.keys(data).forEach(key => params.append(key, data[key]));
    return api.post('/auth/login', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
  },
  me: () => api.get('/auth/me'),
  updateProfile: (data: { full_name?: string; avatar_url?: string }) => api.put('/auth/me', data),
};

export const agentApi = {
  list: () => api.get('/agents'),
  get: (id: string) => api.get(`/agents/${id}`),
  createOrUpdate: (data: any) => api.post('/agents', data),
  delete: (id: string) => api.delete(`/agents/${id}`),
  linkTool: (agent_id: string, tool_id: string) => api.post('/tools/link', null, { params: { agent_id, tool_id } }),
};

export const toolApi = {
  list: () => api.get('/tools/'),
  create: (tool: any) => api.post('/tools/', tool),
  delete: (id: string) => api.delete(`/tools/${id}`),
  test: (id: string) => api.post(`/tools/${id}/test`),
  testConfig: (config: any) => api.post('/tools/test-config', config),
};

export const sessionApi = {
  start: (config: any) => api.post('/sessions/start', config),
  health: () => api.get('/sessions/health'),
};

export const numbersApi = {
  list: () => api.get('/numbers/'),
  create: (data: any) => api.post('/numbers/', data),
  update: (id: string, data: any) => api.put(`/numbers/${id}`, data),
  delete: (id: string) => api.delete(`/numbers/${id}`),
};

export const callsApi = {
  list: (params?: {
    direction?: string;
    status?: string;
    agent_id?: string;
    days?: number;
    limit?: number;
    offset?: number;
  }) => api.get('/calls/', { params }),
  detail: (id: string) => api.get(`/calls/${id}`),
  transcripts: (id: string) => api.get(`/calls/${id}/transcripts`),
  outbound: (data: any) => api.post('/calls/outbound', data),
  updateStatus: (id: string, status: string, duration?: number) =>
    api.put(`/calls/${id}/status`, null, { params: { status, duration } }),
};

export const dashboardApi = {
  stats: () => api.get('/dashboard/stats'),
  analytics: (days?: number) => api.get('/dashboard/analytics', { params: { days: days || 30 } }),
};

export const telephonyApi = {
  // SIP Trunk Management
  provisionTrunks: (data: {
    termination_uri: string;
    auth_username: string;
    auth_password: string;
    phone_numbers: string[];
    trunk_name?: string;
    provider?: string;
    agent_id?: string;
    twilio_account_sid?: string;
    twilio_auth_token?: string;
  }) => api.post('/telephony/trunks', data),
  listTrunks: () => api.get('/telephony/trunks'),
  getTrunk: (id: string) => api.get(`/telephony/trunks/${id}`),
  deleteTrunk: (id: string) => api.delete(`/telephony/trunks/${id}`),
  updateTrunkAgent: (trunkId: string, agentId: string) =>
    api.put(`/telephony/trunks/${trunkId}/agent`, { agent_id: agentId }),

  // Dispatch Rules
  listDispatchRules: () => api.get('/telephony/dispatch-rules'),

  // Outbound Calls — native LiveKit SIP path
  outbound: (data: { to_number: string; agent_id: string; use_twilio_fallback?: boolean }) =>
    api.post('/telephony/outbound', { ...data, use_twilio_fallback: true }),

  // Status & Diagnostics
  status: () => api.get('/telephony/status'),
};

// Settings — save Twilio credentials to the vault
export const settingsApi = {
  getTelephony: () => api.get('/settings/telephony'),
  updateTelephony: (data: any) => api.put('/settings/telephony', data),

  // PUT /settings/secrets — stores twilio_account_sid, twilio_auth_token, twilio_phone_number
  saveSecrets: (data: {
    twilio_account_sid?: string;
    twilio_auth_token?: string;
    twilio_phone_number?: string;
    default_agent_id?: string;
  }) => api.put('/settings/telephony', data),

  getGeneral: () => api.get('/settings/general'),
  updateGeneral: (data: any) => api.put('/settings/general', data),

  getAccount: () => api.get('/settings/account'),
};

/**
 * @deprecated Use telephonyApi.outbound() with use_twilio_fallback=true instead.
 * The /telephony/twilio/outbound endpoint no longer exists. Use the unified
 * /telephony/outbound endpoint with use_twilio_fallback=true for trial accounts.
 */
export const twilioApi = {
  outbound: (data: { to_number: string; agent_id: string }) =>
    api.post('/telephony/outbound', { ...data, use_twilio_fallback: true }),
};

export const freeswitchApi = {
  outbound: (data: { to_number: string; agent_id: string; gateway: string; caller_id?: string }) =>
    api.post('/telephony/freeswitch/outbound', data),
  status: () => api.get('/settings/telephony'),
};

export const knowledgeApi = {
  // ── Documents ────────────────────────────────────────────────────────────
  list: (agentId: string) => api.get(`/knowledge/agent/${agentId}`),
  upload: (agentId: string, formData: FormData) =>
    api.post(`/knowledge/agent/${agentId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  delete: (documentId: string) => api.delete(`/knowledge/${documentId}`),

  // ── RAG Config ───────────────────────────────────────────────────────────
  getConfig: (agentId: string) =>
    api.get(`/knowledge/config/${agentId}`),

  saveConfig: (
    agentId: string,
    data: {
      embedding_provider: string;
      embedding_model: string;
      embedding_api_key?: string | null;
      vector_db_provider: string;
      vector_db_url?: string | null;
      vector_db_api_key?: string | null;
      vector_db_index?: string | null;
      chunk_strategy: string;
      chunk_size: number;
      chunk_overlap: number;
    }
  ) => api.post(`/knowledge/config/${agentId}`, data),

  testConnection: (data: {
    embedding_provider: string;
    embedding_model: string;
    embedding_api_key?: string | null;
    vector_db_provider: string;
    vector_db_url?: string | null;
    vector_db_api_key?: string | null;
    vector_db_index?: string | null;
  }) => api.post('/knowledge/config/test', data),

  reindex: (agentId: string) => api.post(`/knowledge/reindex/${agentId}`),
};

export default api;