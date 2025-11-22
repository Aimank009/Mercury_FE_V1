import { useEffect, useState } from 'react';
import clsx from 'clsx';

interface SessionNotificationProps {
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
  onClose?: () => void;
}

export default function SessionNotification({
  message,
  type,
  duration = 5000,
  onClose,
}: SessionNotificationProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(() => onClose?.(), 300);
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return '❌';
      case 'info':
        return 'ℹ️';
      default:
        return '📢';
    }
  };

  const borderColors = {
    success: 'border-l-[#00ff24]',
    error: 'border-l-[#ff4646]',
    info: 'border-l-[#3b82f6]',
  }[type];

  return (
    <div
      className={clsx(
        'fixed top-20 right-5 min-w-[300px] max-w-[500px] px-5 py-4 flex items-center gap-3 rounded-xl border border-white/20 border-l-4 bg-[rgba(26,26,30,0.98)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-md z-[10000] transition-transform duration-300',
        borderColors,
        isVisible ? 'animate-session-slide-in' : 'animate-session-slide-out'
      )}
    >
      <span className="text-xl">{getIcon()}</span>
      <span className="text-[#eeedec] text-sm leading-relaxed flex-1">{message}</span>
      <button
        className="w-6 h-6 flex items-center justify-center text-2xl text-[#999] hover:text-[#eeedec] transition-colors"
        onClick={() => {
          setIsVisible(false);
          setTimeout(() => onClose?.(), 300);
        }}
      >
        ×
      </button>
    </div>
  );
}