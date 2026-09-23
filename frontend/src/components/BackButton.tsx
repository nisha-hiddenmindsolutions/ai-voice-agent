import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  fallbackPath?: string;
  label?: string;
}

export const BackButton: React.FC<BackButtonProps> = ({ 
  fallbackPath = '/', 
  label = 'Back' 
}) => {
  const navigate = useNavigate();

  const handleBack = () => {
    // Better logic: if there is navigation history within this SPA session, go back.
    // Otherwise, fallback safely to the intended dashboard/parent page.
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate(fallbackPath);
    }
  };

  return (
    <button 
      onClick={handleBack} 
      className="btn-back-premium cursor-pointer group flex items-center gap-2"
      title={`Go back to ${label}`}
    >
      <ArrowLeft size={14} className="transition-transform duration-200 group-hover:-translate-x-1" />
      <span>Back</span>
    </button>
  );
};

export default BackButton;
