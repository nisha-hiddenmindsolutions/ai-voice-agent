import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import hmsLogo from '../assets/HMS logo.png';
import { Mail, Lock, User, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { authApi } from '../services/api';
import toast from 'react-hot-toast';

const RegisterPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.register({ email, password, full_name: fullName });
      toast.success('Account created successfully');
      navigate('/login');
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Registration failed');
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
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--text-primary)] text-center">
            HMS Voice Forge
          </h1>
          <p className="text-xs mt-1.5 font-semibold tracking-widest uppercase text-[var(--text-muted)]">
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
          <div className="mb-5">
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Create your account</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Get started with HMS Voice Agents immediately.</p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            
            {/* NAME */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Full Name
              </label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                <input
                  type="text"
                  required
                  placeholder="Your full name"
                  className="input-field pl-10 focus:ring-2 focus:ring-[var(--primary)]/10"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
            </div>

            {/* EMAIL */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  className="input-field pl-10 focus:ring-2 focus:ring-[var(--primary)]/10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
            </div>

            {/* PASSWORD */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16} />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  className="input-field pl-10 focus:ring-2 focus:ring-[var(--primary)]/10"
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
                  Create Account
                  <ArrowRight size={16} className="group-hover/btn:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* FOOTER */}
        <div className="mt-7 text-center">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Already have an account?{' '}
            <Link to="/login" className="font-extrabold transition-colors hover:underline" style={{ color: 'var(--primary)' }}>
              Sign In
            </Link>
          </p>
        </div>

        {/* Trust Badges */}
        <div className="mt-6 flex items-center justify-center gap-4">
          {['AES-256', 'SOC2', 'GDPR'].map(badge => (
            <span 
              key={badge}
              className="text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md"
              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-secondary)', border: '1px solid var(--border)' }}
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
