import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import hmsLogo from '../assets/HMS logo.png';
import { Mail, Lock, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import toast from 'react-hot-toast';

const LoginPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const setAuth = useAuthStore(state => state.setAuth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await authApi.login({ username: email, password });
      const token = res.data.access_token;
      
      // Step 1: Set token immediately so interceptors can use it
      setAuth(token, null as any);
      
      // Step 2: Fetch full profile
      const userRes = await authApi.me();
      
      // Step 3: Update store with full profile
      setAuth(token, userRes.data);
      
      toast.success('Login Successful');
      navigate('/');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden select-none"
      style={{ backgroundColor: 'var(--background)' }}
    >
      {/* Dot Grid */}
      <div className="absolute inset-0 bg-grid-pattern pointer-events-none opacity-40" />

      <div className="w-full max-w-[440px] z-10 animate-slide-up">
        
        {/* LOGO & HEADER */}
        <div className="flex flex-col items-center mb-8">
          <div 
            className="w-16 h-16 rounded-2xl overflow-hidden mb-5 p-3 flex items-center justify-center relative group bg-[var(--surface-secondary)] border border-[var(--border)]"
            style={{ 
              boxShadow: '0 8px 32px -4px rgba(79, 70, 229, 0.08)'
            }}
          >
            <img 
              src={hmsLogo} 
              alt="HMS Logo" 
              className="w-10 h-10 object-contain transition-transform duration-300 group-hover:scale-105" 
            />
          </div>
          
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
            HMS Voice Forge
          </h1>
          <p className="text-xs font-semibold text-[var(--text-muted)] mt-1.5 uppercase tracking-widest">
            Voice AI Agent Orchestrator
          </p>
        </div>

        {/* CARD */}
        <div 
          className="card p-8 relative overflow-hidden backdrop-blur-[24px]"
          style={{ 
            boxShadow: '0 24px 64px -12px rgba(0, 0, 0, 0.06)' 
          }}
        >
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-[var(--primary)]/30" />

          <form onSubmit={handleLogin} className="space-y-5">
            {/* EMAIL */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  className="input-field pl-10 h-11 focus:ring-2 focus:ring-[var(--primary)]/10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* PASSWORD */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Password</label>
                <a href="#forgot" className="text-[10px] font-bold text-[var(--primary)] hover:underline">Forgot?</a>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  className="input-field pl-10 h-11 focus:ring-2 focus:ring-[var(--primary)]/10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>

            {/* SUBMIT */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-12 rounded-xl font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all group/btn btn-shine flex items-center justify-center gap-2"
              style={{
                backgroundColor: 'var(--primary)',
                color: '#fff',
                boxShadow: '0 6px 24px -4px rgba(79, 70, 229, 0.35)'
              }}
            >
              {loading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <>
                  <Sparkles size={14} />
                  Enter Voice Studio
                  <ArrowRight size={16} className="group-hover/btn:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* FOOTER */}
        <div className="mt-7 text-center">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            New to Voice Forge?{' '}
            <Link to="/register" className="font-extrabold transition-colors hover:underline" style={{ color: 'var(--primary)' }}>
              Create Account
            </Link>
          </p>
        </div>

        {/* Trust Badges */}
        <div className="mt-6 flex items-center justify-center gap-4">
          {['AES-256', 'SOC2', 'GDPR'].map(badge => (
            <span 
              key={badge}
              className="text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md"
              style={{ 
                color: 'var(--text-muted)', 
                backgroundColor: 'var(--surface-secondary)',
                border: '1px solid var(--border)' 
              }}
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
