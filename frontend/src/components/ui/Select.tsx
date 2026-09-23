import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: (SelectOption | string)[];
  placeholder?: string;
  className?: string;
  align?: 'left' | 'right';
}

export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  className = '',
  align = 'left'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Normalize options to SelectOption objects
  const normalizedOptions: SelectOption[] = options.map(opt => {
    if (typeof opt === 'string') {
      return { value: opt, label: opt };
    }
    return opt;
  });

  const selectedOption = normalizedOptions.find(opt => opt.value === value);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    // Defer registration to the next frame to prevent immediate triggers from the bubbling phase
    let timer: any;
    if (isOpen) {
      timer = setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
      }, 0);
    }
    
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div className={`relative inline-block w-full text-left font-sans`} ref={containerRef}>
      {/* TRIGGER BUTTON */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className={`w-full h-10 px-4 rounded-[10px] border bg-[var(--input-bg)] text-sm flex items-center justify-between transition-all duration-200 outline-none cursor-pointer text-[var(--text-primary)] font-medium
          ${isOpen 
            ? 'border-[var(--border-focus)] ring-2 ring-[rgba(139,92,246,0.15)]' 
            : 'border-[var(--border)] hover:border-[var(--input-hover-border)]'
          } ${className}`}
      >
        <span className="truncate">
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown 
          size={15} 
          className={`text-[var(--text-muted)] transition-transform duration-200 shrink-0 ml-2
            ${isOpen ? 'transform rotate-180 text-[var(--primary)]' : ''}
          `}
        />
      </button>

      {/* DROPDOWN MENU */}
      {isOpen && (
        <div 
          className={`absolute z-[150] mt-2 w-full min-w-[200px] rounded-[10px] border border-[var(--border)] bg-[var(--surface-glass)] backdrop-blur-xl shadow-2xl p-1.5 overflow-hidden animate-in fade-in zoom-in duration-150
            ${align === 'right' ? 'right-0' : 'left-0'}
          `}
          style={{
            borderColor: 'rgba(139, 92, 246, 0.15)',
            boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(139, 92, 246, 0.05)'
          }}
        >
          <ul className="max-h-[220px] overflow-y-auto custom-scrollbar space-y-0.5">
            {normalizedOptions.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => handleSelect(option.value)}
                    className={`w-full px-3.5 py-2 text-xs font-semibold rounded-lg flex items-center justify-between transition-all duration-150 cursor-pointer
                      ${isSelected 
                        ? 'bg-[var(--primary)] text-white' 
                        : 'text-[var(--text-primary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--primary)]'
                      }
                    `}
                  >
                    <span className="truncate text-left">{option.label}</span>
                    {isSelected && (
                      <Check size={14} className="shrink-0 ml-2" />
                    )}
                  </button>
                </li>
              );
            })}
            {normalizedOptions.length === 0 && (
              <li className="px-3.5 py-3 text-xs text-center text-[var(--text-muted)] font-medium">
                No options available
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
