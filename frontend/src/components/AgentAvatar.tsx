import agentIcon from '../assets/agent-3d-icon-png-download-6381256.webp';
import maleAgentIcon from '../assets/male-agent-icon.webp';

export const AgentAvatar = ({ 
  name, 
  className = "w-12 h-12", 
  agent 
}: { 
  name: string; 
  className?: string; 
  agent?: any;
}) => {
  const nameLower = (name || '').toLowerCase();
  
  // Voice voice checks for male voice indicators
  let isMale = false;
  if (agent && agent.tts && agent.tts.voice) {
    const v = agent.tts.voice.toLowerCase();
    if (v === 'shubh' || v === 'aditya' || v === 'echo') {
      isMale = true;
    }
  } else if (
    nameLower.includes('ramu') || 
    nameLower.includes('male') || 
    nameLower.includes('boy') || 
    nameLower.includes('man') || 
    nameLower.includes('shubh') || 
    nameLower.includes('aditya')
  ) {
    isMale = true;
  }

  // Base gradients
  let fromColor = "#EC4899"; // Pink (Female default)
  let toColor = "#8B5CF6"; // Purple

  if (isMale) {
    fromColor = "#3B82F6"; // Blue (Male)
    toColor = "#6366F1"; // Indigo
  }

  const isLarge = className.includes('w-24');
  const iconSize = isLarge ? 64 : 32;
  const currentIcon = isMale ? maleAgentIcon : agentIcon;

  return (
    <div 
      className={`relative flex items-center justify-center rounded-3xl overflow-hidden shadow-sm shrink-0 border transition-all duration-300 ${className}`} 
      style={{ 
        background: `linear-gradient(135deg, ${fromColor}15 0%, ${toColor}10 100%)`, 
        borderColor: `${fromColor}30`
      }}
    >
      {/* Soft Ambient Inner Glow */}
      <div 
        className="absolute inset-0 opacity-20" 
        style={{ 
          background: `radial-gradient(circle at center, ${fromColor}30 0%, transparent 70%)` 
        }} 
      />

      {/* Floating Center Icon (Custom 3D Agent webp asset) */}
      <div className="relative z-10 flex items-center justify-center">
        <img 
          src={currentIcon} 
          alt={name} 
          className="object-contain"
          style={{ 
            width: `${iconSize}px`, 
            height: `${iconSize}px`,
            filter: `drop-shadow(0 4px 10px ${fromColor}30)`
          }} 
        />
      </div>
    </div>
  );
};
