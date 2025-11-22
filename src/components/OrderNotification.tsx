import React, { useEffect, useState } from 'react';
import clsx from 'clsx';

interface OrderNotificationProps {
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
  onClose: () => void;
  isProminent?: boolean;
}

export default function OrderNotification({
  message,
  type,
  duration = 5000,
  onClose,
  isProminent = false,
}: OrderNotificationProps) {
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (isProminent) return;

    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300);
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose, isProminent]);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300);
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✅';
      case 'error':
        return isProminent ? '🚨' : '❌';
      case 'info':
      default:
        return 'ℹ️';
    }
  };

  const getTitle = () => {
    if (!isProminent) return null;

    if (message.toLowerCase().includes('insufficient')) return '💰 Insufficient Balance';
    if (message.toLowerCase().includes('profit cap')) return '📊 Profit Cap Exceeded';
    if (message.toLowerCase().includes('session expired')) return '⏰ Session Expired';
    return '⚠️ Error';
  };

  const baseClasses =
    'fixed top-5 right-5 z-[1000] min-w-[300px] max-w-[500px] rounded-none shadow-notification transition-all duration-300 cursor-pointer max-md:left-2 max-md:right-2 max-md:top-2 max-md:min-w-0 max-md:max-w-none';
  const visibilityClasses = isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full';
  const prominenceClasses = isProminent
    ? 'min-w-[350px] max-w-[600px] shadow-error-prominent animate-shake cursor-default max-md:min-w-0 max-md:max-w-none'
    : '';
  const typeClasses = {
    success: 'bg-gradient-to-br from-[#10b981] to-[#059669] text-white border-l-4 border-[#047857]',
    error: clsx(
      'bg-[#0a0a0a] text-white border border-[rgba(220,38,38,0.4)] shadow-error rounded-none',
      isProminent && '!bg-black border-[rgba(220,38,38,0.5)] shadow-error-prominent'
    ),
    info: 'bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white border-l-4 border-[#1d4ed8]',
  }[type];

  return (
    <div
      className={clsx(
        baseClasses,
        visibilityClasses,
        prominenceClasses,
        typeClasses,
        isVisible && 'animate-fade-in-right'
      )}
      onClick={!isProminent ? handleClose : undefined}
      style={{ cursor: isProminent ? 'default' : 'pointer' }}
    >
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="flex flex-1 items-start gap-3">
          <span className={clsx('text-xl mt-[2px]', isProminent && 'text-2xl')}>{getIcon()}</span>
          <div className="flex flex-1 flex-col gap-1">
            {isProminent && getTitle() && <div className="text-base font-bold mb-1">{getTitle()}</div>}
            <span className={clsx('text-sm font-medium leading-[1.4]', isProminent && 'text-[15px] leading-[1.5]')}>
              {message}
            </span>
          </div>
        </div>
        <button
          className={clsx(
            'w-6 h-6 flex items-center justify-center text-xl font-bold text-white rounded-none transition-colors mt-[2px]',
            type === 'error'
              ? 'hover:bg-[rgba(220,38,38,0.3)]'
              : 'hover:bg-[rgba(255,255,255,0.2)]',
            isProminent && 'cursor-pointer'
          )}
          onClick={handleClose}
        >
          ×
        </button>
      </div>
    </div>
  );
}