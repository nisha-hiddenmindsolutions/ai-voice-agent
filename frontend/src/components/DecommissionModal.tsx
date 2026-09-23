import React from 'react';
import { Trash2, AlertTriangle, X } from 'lucide-react';

interface DecommissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  itemName: string;
  loading?: boolean;
}

export const DecommissionModal: React.FC<DecommissionModalProps> = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  itemName,
  loading = false 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 z-[300] animate-in fade-in duration-300">
      <div className="bg-zinc-900/95 border border-red-500/30 w-full max-w-md rounded-3xl p-8 shadow-[0_0_50px_rgba(239,68,68,0.15)] relative overflow-hidden">
        
        {/* Top scan lines/glows */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-red-500/50 to-transparent" />
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-red-500/5 blur-[80px] rounded-full" />
        
        <div className="absolute top-0 right-0 p-6">
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-col items-center text-center space-y-5 relative">
          {/* Glowing Warning Icon */}
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-500 shadow-inner relative">
            <div className="absolute inset-0 bg-red-500/10 rounded-2xl animate-pulse blur-md" />
            <AlertTriangle size={32} className="relative z-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-zinc-100 tracking-wider uppercase">{title}</h2>
            <p className="text-zinc-400 text-sm leading-relaxed max-w-xs">
              Confirming this action will <span className="text-red-400 font-bold uppercase tracking-wide">permanently remove</span> the connection to <span className="inline-block text-red-400 font-semibold bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded text-xs font-mono">"{itemName}"</span>.
            </p>
          </div>

          <div className="flex flex-col w-full gap-3 pt-4">
            <button 
              onClick={onConfirm}
              disabled={loading}
              className="w-full h-12 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold uppercase tracking-wider transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 shadow-[0_8px_20px_rgba(239,68,68,0.2)]"
            >
              <Trash2 size={16} />
              {loading ? 'Disconnecting...' : 'Confirm Disconnect'}
            </button>
            <button 
              onClick={onClose}
              className="w-full h-11 rounded-xl border border-zinc-800 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 text-xs font-semibold uppercase tracking-wider transition-all active:scale-[0.98]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
