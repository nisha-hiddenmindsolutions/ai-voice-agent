import { Construction } from 'lucide-react';
import { BackButton } from '../components/BackButton';

const ComingSoonPage = ({ title }: { title: string }) => {

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] text-center space-y-6 animate-in fade-in slide-in-from-bottom-8 duration-700 relative overflow-hidden px-4">
      {/* GLOWING AMBIENT CORE */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/10 rounded-full blur-[140px] -z-10 pointer-events-none animate-pulse-slow" />
      
      {/* FLOATING SPHERE WITH ROTATING BORDER */}
      <div className="relative group">
        <div className="relative w-20 h-20 rounded-2xl bg-zinc-900/50 border border-zinc-850 flex items-center justify-center text-primary shadow-sm animate-neural-float duration-500">
          <Construction size={36} strokeWidth={1.5} className="text-primary" />
        </div>
      </div>
      
      <div className="space-y-3.5 relative z-10">
        <h1 className="text-2xl md:text-3xl font-heading font-black text-zinc-100 uppercase tracking-widest leading-tight">{title}</h1>
        <p className="text-zinc-500 max-w-sm mx-auto font-bold text-xs leading-relaxed uppercase tracking-wider opacity-85">
          Agent Blueprint Pending
        </p>
        <p className="text-zinc-600 max-w-md mx-auto font-medium text-sm leading-relaxed italic">
          "We are preparing this voice agent module by HMS. Link configured and awaiting final activation."
        </p>
      </div>

      <div className="relative z-10 mt-4">
        <BackButton fallbackPath="/" label="Return to Overview" />
      </div>

      {/* Cyber Grid Sub-overlay */}
      <div className="absolute inset-0 bg-cyber-grid opacity-20 pointer-events-none -z-20" />
    </div>
  );
};

export default ComingSoonPage;
