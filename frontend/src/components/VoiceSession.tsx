import { useEffect, useState } from 'react';
import { Track } from 'livekit-client';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  BarVisualizer,
  useVoiceAssistant,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from '@livekit/components-react';
import { Mic, MicOff, PhoneOff, Activity } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import toast from 'react-hot-toast';
import '@livekit/components-styles';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VoiceSessionProps {
  token: string;
  url: string;
  onDisconnect: () => void;
  agentName?: string;
}

// ─── State config — each voice state gets a distinct color signal ──────────────

const STATE_CONFIG = {
  speaking: { label: 'RESPONDING', color: '#60A5FA', glow: 'rgba(96,165,250,0.18)', ring: 'rgba(96,165,250,0.4)' },
  listening: { label: 'LISTENING', color: '#FBBF24', glow: 'rgba(251,191,36,0.18)', ring: 'rgba(251,191,36,0.4)' },
  thinking: { label: 'THINKING', color: '#A78BFA', glow: 'rgba(167,139,250,0.18)', ring: 'rgba(167,139,250,0.4)' },
  connecting: { label: 'CONNECTING', color: '#71717A', glow: 'rgba(113,113,122,0.1)', ring: 'rgba(113,113,122,0.3)' },
  idle: { label: 'STANDBY', color: '#71717A', glow: 'rgba(113,113,122,0.1)', ring: 'rgba(113,113,122,0.3)' },
} as const;

type Cfg = (typeof STATE_CONFIG)[keyof typeof STATE_CONFIG];

// ─── Root ─────────────────────────────────────────────────────────────────────

const VoiceSession = ({ token, url, onDisconnect, agentName = 'Voice Agent' }: VoiceSessionProps) => {
  const handleDisconnected = () => {
    toast('Session ended', {
      style: {
        background: '#09090b',
        color: '#ffffff',
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: '11px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      }
    });
    onDisconnect();
  };
  
  const handleError = (error: Error) => {
    toast.error(`Connection failed: ${error.message}`);
    setTimeout(onDisconnect, 3000);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', alignItems: 'flex-end',
      background: 'rgba(3, 4, 8, 0.95)',
      backdropFilter: 'blur(16px)',
      transition: 'background 0.5s'
    }}>
      <AnimatePresence>
        <motion.div
          key="card"
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          style={{
            width: '100%',
            height: '100dvh',
            background: 'radial-gradient(circle at center, #0A0D16 0%, #030407 100%)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          {/* Subtle Ambient Background Mesh */}
          <div className="absolute inset-0 bg-platform-mesh opacity-30 pointer-events-none" />

          <LiveKitRoom
            token={token} serverUrl={url}
            connect audio video={false}
            onDisconnected={handleDisconnected}
            onError={handleError}
            style={{ display: 'contents' }}
          >
            <VoiceSessionInner onDisconnect={onDisconnect} agentName={agentName} />
          </LiveKitRoom>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

// ─── Inner ────────────────────────────────────────────────────────────────────

const VoiceSessionInner = ({ onDisconnect, agentName }: { onDisconnect: () => void; agentName: string }) => {
  const [duration, setDuration] = useState(0);
  const { state, audioTrack, agent } = useVoiceAssistant();
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const tracks = useTracks([Track.Source.Microphone]);
  const localMicTrack = tracks.find((t: any) => t.participant.isLocal);
  const isMuted = !localParticipant?.isMicrophoneEnabled;
  const cfg: Cfg = STATE_CONFIG[state as keyof typeof STATE_CONFIG] ?? STATE_CONFIG.idle;

  const [agentJoined, setAgentJoined] = useState(false);

  useEffect(() => {
    if (agent) {
      setAgentJoined(true);
    } else if (agentJoined) {
      console.log('--- [HMS DEBUG] Agent left the room. Disconnecting session... ---');
      room.disconnect();
    }
  }, [agent, agentJoined, room]);

  useEffect(() => {
    const id = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!room) return;

    const handleRoomDisconnected = () => {
      console.log('--- [HMS DEBUG] Room disconnected event received ---');
      onDisconnect();
    };

    room.on('disconnected', handleRoomDisconnected);

    return () => {
      room.off('disconnected', handleRoomDisconnected);
    };
  }, [room, onDisconnect]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const toggleMic = async () => {
    if (!localParticipant) return;
    const next = !localParticipant.isMicrophoneEnabled;
    await localParticipant.setMicrophoneEnabled(next);
    toast(next ? '🎙 Microphone active' : '🔇 Microphone muted', {
      style: {
        background: '#111115',
        color: '#ffffff',
        border: '1px solid rgba(255,255,255,0.08)',
        fontSize: '11px',
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: '0.05em'
      },
    });
  };

  const endCall = () => { room.disconnect(); onDisconnect(); };

  return (
    <>
      <RoomAudioRenderer />

      {/* ── HEADER ── */}
      <header style={{
        flexShrink: 0,
        zIndex: 10,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '24px 32px',
        borderBottom: '1px solid rgba(255,255,255,0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <motion.div
            animate={{ opacity: [1, 0.4, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: cfg.color, flexShrink: 0,
              boxShadow: `0 0 10px ${cfg.color}`,
              transition: 'background 0.5s',
            }}
          />
          <span style={{
            fontFamily: 'ui-monospace,"Cascadia Code",monospace',
            fontSize: 12, letterSpacing: '0.2em',
            color: '#E4E4E7',
            fontWeight: 'bold',
            textTransform: 'uppercase',
          }}>
            {agentName}
          </span>
        </div>

        <span style={{
          fontFamily: 'ui-monospace,"Cascadia Code",monospace',
          fontSize: 12, letterSpacing: '0.1em',
          color: '#E4E4E7',
          padding: '6px 14px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
        }}>
          {fmt(duration)}
        </span>
      </header>

      {/* ── MAIN ── */}
      <main style={{
        flex: 1,
        overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '48px 28px 32px',
        position: 'relative',
        gap: 36,
      }}>
        {/* Soft immersive ambient glow sphere */}
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            width: 420, height: 420,
            borderRadius: '50%',
            background: cfg.glow,
            filter: 'blur(100px)',
            pointerEvents: 'none',
            transition: 'background 1s',
          }}
        />

        {/* Dynamic Glowing Orb Display */}
        <OrbDisplay state={state} cfg={cfg} />

        {/* State status pill */}
        <AnimatePresence mode="wait">
          <motion.p
            key={state}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            style={{
              fontFamily: 'ui-monospace,"Cascadia Code",monospace',
              fontSize: 10, letterSpacing: '0.3em',
              color: cfg.color, textTransform: 'uppercase',
              padding: '6px 18px',
              border: `1px solid ${cfg.color}35`,
              borderRadius: 999,
              background: `${cfg.color}08`,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.02), 0 4px 12px rgba(0,0,0,0.5)`,
              transition: 'all 0.5s',
              margin: 0,
              fontWeight: 600
            }}
          >
            ● {cfg.label}
          </motion.p>
        </AnimatePresence>

        {/* Waveform Visualization Interface */}
        <div style={{ width: '100%', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Agent main audio */}
          <div style={{ height: 64, width: '100%', display: 'flex', alignItems: 'center' }}>
            {audioTrack ? (
              <div className="w-full h-full text-zinc-100 flex items-center" style={{ filter: `drop-shadow(0 0 12px ${cfg.color}40)` }}>
                <BarVisualizer 
                  trackRef={audioTrack} 
                  style={{ width: '100%', height: '100%', color: cfg.color, transition: 'color 0.5s' }} 
                />
              </div>
            ) : (
              <IdleBars color={cfg.color} />
            )}
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />

          {/* User local mic visualization */}
          <div style={{ height: 16, width: '100%', opacity: 0.3 }}>
            {localMicTrack && (
              <BarVisualizer 
                trackRef={localMicTrack} 
                style={{ width: '100%', height: '100%', color: '#94A3B8' }} 
              />
            )}
          </div>
        </div>
      </main>

      {/* ── FOOTER DOCK (Premium Glassmorphism Dock) ── */}
      <footer style={{
        flexShrink: 0,
        zIndex: 10,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        gap: 16,
        padding: '24px 32px 48px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        background: 'rgba(7, 9, 15, 0.95)',
      }}>

        {/* Mic Toggle Button */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={toggleMic}
          aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          style={{
            width: 56, height: 56, borderRadius: 20, flexShrink: 0,
            border: isMuted 
              ? '1px solid rgba(239,68,68,0.4)' 
              : '1px solid rgba(255,255,255,0.08)',
            background: isMuted 
              ? 'rgba(239,68,68,0.08)' 
              : 'rgba(255,255,255,0.03)',
            color: isMuted ? '#EF4444' : '#E4E4E7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
          className="hover:bg-zinc-800/40 hover:border-zinc-700"
        >
          {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
        </motion.button>

        {/* End Call Button */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          onClick={endCall}
          aria-label="End call"
          style={{
            width: 84, height: 56, borderRadius: 20, flexShrink: 0,
            background: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
            border: 'none',
            color: '#ffffff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 8px 30px rgba(239,68,68,0.3)',
            transition: 'all 0.2s',
          }}
          className="hover:brightness-110 active:brightness-95"
        >
          <PhoneOff size={20} strokeWidth={2.5} />
        </motion.button>

        {/* Waveform/Latency Signal Display */}
        <motion.button
          whileTap={{ scale: 0.94 }}
          aria-label="Signal quality"
          style={{
            width: 56, height: 56, borderRadius: 20, flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(255,255,255,0.03)',
            color: '#71717A',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
          className="hover:bg-zinc-800/40 hover:border-zinc-700 hover:text-zinc-300"
        >
          <Activity size={18} />
        </motion.button>
      </footer>
    </>
  );
};

// ─── Orb ──────────────────────────────────────────────────────────────────────

const OrbDisplay = ({ state, cfg }: { state: string; cfg: Cfg }) => {
  const isSpeaking = state === 'speaking';
  const isThinking = state === 'thinking';
  const isListening = state === 'listening';

  return (
    <div style={{ position: 'relative', width: 200, height: 200, flexShrink: 0 }}>

      {/* Outer slow ring */}
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
        style={{
          position: 'absolute', inset: -16, borderRadius: '50%',
          border: `1px dashed ${cfg.color}25`,
          opacity: 0.5, transition: 'border-color 0.7s',
        }}
      />

      {/* Active pulse ring — scales when active */}
      <motion.div
        animate={isSpeaking
          ? { scale: [1, 1.15, 1], opacity: [0.4, 0.8, 0.4] }
          : { scale: 1, opacity: 0.15 }
        }
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute', inset: -6, borderRadius: '50%',
          border: `1px solid ${cfg.color}45`,
          transition: 'border-color 0.7s',
        }}
      />

      {/* Thinking state overlay */}
      {isThinking && (
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          style={{
            position: 'absolute', inset: 8, borderRadius: '50%',
            border: `2px solid ${cfg.color}35`,
            borderTopColor: cfg.color, borderLeftColor: 'transparent',
          }}
        />
      )}

      {/* Central Core Glowing Sphere */}
      <motion.div
        animate={
          isSpeaking ? { scale: [1, 1.05, 1] } :
            isListening ? { scale: [0.98, 1.03, 0.98] } :
              { scale: 1 }
        }
        transition={{ duration: isSpeaking ? 0.8 : 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: '100%', height: '100%', borderRadius: '50%',
          background: `radial-gradient(circle at 35% 32%, ${cfg.color}15 0%, #080A12 70%)`,
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: `inset 0 1px 1px rgba(255,255,255,0.08), 0 0 60px ${cfg.color}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.6s',
        }}
      >
        {/* Core dynamic neon signal dot */}
        <motion.div
          animate={{ opacity: [0.6, 1, 0.6], scale: [0.9, 1.15, 0.9] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            width: 16, height: 16, borderRadius: '50%',
            background: cfg.color,
            boxShadow: `0 0 20px ${cfg.color}, 0 0 40px ${cfg.color}60`,
            transition: 'background 0.5s, box-shadow 0.5s',
          }}
        />
      </motion.div>
    </div>
  );
};

// ─── Idle Bars (bounces elegantly matching current state) ─────────────────────

const IdleBars = ({ color }: { color: string }) => {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 5, height: '100%', opacity: 0.4,
      width: '100%'
    }}>
      {[12, 24, 16, 32, 20, 28, 14, 22, 18, 26, 10, 16, 12, 24, 16].map((h, i) => (
        <motion.div
          key={i}
          animate={{ scaleY: [0.3, 1, 0.3] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.08, ease: 'easeInOut' }}
          style={{
            width: 3, height: h, borderRadius: 2,
            background: color,
            transformOrigin: 'center',
            transition: 'background 0.5s',
            boxShadow: `0 0 8px ${color}50`
          }}
        />
      ))}
    </div>
  );
};

export default VoiceSession;