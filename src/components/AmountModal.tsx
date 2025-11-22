'use client';

import { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '../config';

interface AmountModalProps {
  onAmountSet?: (amount: number) => void;
}

export default function AmountModal({ onAmountSet }: AmountModalProps) {
  const [amount, setAmount] = useState<number>(0.2);
  const [inputValue, setInputValue] = useState<string>('0.2');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [error, setError] = useState<string>('');
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const savedAmount = localStorage.getItem(STORAGE_KEYS.USER_AMOUNT);
    const savedCollapsed = localStorage.getItem(STORAGE_KEYS.MODAL_COLLAPSED);

    if (savedAmount) {
      const parsedAmount = parseFloat(savedAmount);
      if (parsedAmount >= 0.2) {
        setAmount(parsedAmount);
        setInputValue(savedAmount);
      }
    }
    if (savedCollapsed === 'true') {
      setIsCollapsed(true);
    }
  }, []);

  const handleInputChange = (value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setInputValue(value);
      setError('');

      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue >= 0) {
        setAmount(numValue);
      }
    }
  };

  const handleSetAmount = () => {
    const numValue = parseFloat(inputValue);

    if (inputValue === '' || isNaN(numValue)) {
      setError('Please enter a valid number');
      return;
    }

    if (numValue < 0.2) {
      setError('Amount must be at least $0.2');
      return;
    }

    setAmount(numValue);
    localStorage.setItem(STORAGE_KEYS.USER_AMOUNT, numValue.toString());
    onAmountSet?.(numValue);
    window.dispatchEvent(new Event('amountUpdated'));
    setError('');
    setIsCollapsed(true);
  };

  const handleQuickAmount = (amt: number) => {
    setAmount(amt);
    setInputValue(amt.toString());
    setError('');
  };

  const toggleCollapse = () => {
    const newCollapsed = !isCollapsed;
    setIsCollapsed(newCollapsed);
    localStorage.setItem(STORAGE_KEYS.MODAL_COLLAPSED, newCollapsed.toString());
  };

  const quickAmounts = [0.2, 0.5, 1, 2, 5, 10];

  return (
    <div
      className={`absolute right-0 z-[100] border border-mercury-border bg-mercury-bg transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        isCollapsed ? 'w-[41px] overflow-visible' : 'w-[322px]'
      }`}
    >
      <div className="relative flex h-[41px] items-center justify-end overflow-visible border-b border-mercury-border px-3 py-2.5">
        <button
          onClick={toggleCollapse}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          className="relative flex h-5 w-5 rotate-[-90deg] items-center justify-center text-white/60 transition hover:text-mercury-accent"
        >
          <svg
            width="20"
            height="21"
            viewBox="0 0 20 21"
            fill="none"
            className={`transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`}
          >
            <path
              d="M4 8L10 14L16 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          {showTooltip && (
            <span className="absolute bottom-[60px] right-[-200%] ml-2 rotate-90 whitespace-nowrap border border-mercury-border bg-white/60 px-2.5 py-2 font-geistMono text-[13px] text-mercury-bg shadow-tooltip backdrop-blur opacity-80">
              Bet Amount
            </span>
          )}
        </button>
      </div>

      {!isCollapsed && (
        <div className="space-y-3 p-3">
          <div className="flex flex-col gap-2.5">
            <input
              type="text"
              inputMode="decimal"
              className="w-full  border border-white/20 bg-mercury-input px-3.5 py-2.5 text-base text-mercury-muted placeholder:text-white/30 outline-none transition focus:border-mercury-accent focus:text-white"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              onBlur={() => {
                const numValue = parseFloat(inputValue);
                if (inputValue === '' || isNaN(numValue) || numValue < 0.2) {
                  setInputValue(amount.toString());
                }
              }}
              placeholder="0.2"
            />
            <div className="flex gap-3">
              {quickAmounts.slice(0, 3).map((amt) => (
                <button
                  key={amt}
                  onClick={() => handleQuickAmount(amt)}
                  className={`flex-1 border border-transparent px-4 py-2 text-base font-geistMono tracking-tight transition ${
                    amount === amt
                      ? 'border-white/30 bg-white/10 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              {quickAmounts.slice(3).map((amt) => (
                <button
                  key={amt}
                  onClick={() => handleQuickAmount(amt)}
                  className={`flex-1 border border-transparent px-4 py-2 text-base font-geistMono tracking-tight transition ${
                    amount === amt
                      ? 'border-white/30 bg-white/10 text-white'
                      : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white/80'
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              ⚠️ {error}
            </div>
          )}

          <div className="pt-3">
            <button
              className="w-full border border-white/30 bg-white/10 px-4 py-2 text-base font-medium text-white tracking-tight transition hover:bg-white/15 hover:border-white/50 active:scale-95"
              onClick={handleSetAmount}
            >
              Set Amount
            </button>
          </div>
        </div>
      )}
    </div>
  );
}