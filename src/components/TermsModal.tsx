'use client';

import { useState, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { pad } from 'viem';

interface TermsModalProps {
  isOpen: boolean;
  onAccept: () => void;
  onClose: () => void;
}

export default function TermsModal({ isOpen, onAccept, onClose }: TermsModalProps) {
  const [checks, setChecks] = useState({
    termsAndPrivacy: false,
    cookiePolicy: false,
    enableTrading: false,
  });

  const allChecked = Object.values(checks).every((v) => v);

  const handleCheckChange = (key: keyof typeof checks) => {
    setChecks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleStartTrading = () => {
    if (!allChecked) {
      alert('Please accept all terms to continue');
      return;
    }
    onAccept();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-[2px] flex items-center justify-center z-[10000] animate-[fadeIn_0.3s_ease]">
      <div className="bg-[#1d1d1f] border border-[#605d5d] w-[606px] max-w-[90%] max-h-[90vh] flex flex-col animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)] md:max-h-[90vh] md:w-[606px] max-md:w-[95%] max-md:max-h-[85vh]">
        <div className="flex items-center justify-between border-b border-[#605d5d]">
          <div className="w-full h-[70px] flex items-center pl-5">
            <h2 className="text-lg font-medium text-white m-0 tracking-[-0.9px] max-md:text-base">
              Terms of Use, Privacy Policy, and Cookie Policy
            </h2>
          </div>

          <div className="w-20 h-[70px] border-l border-[#605d5d] flex items-center justify-center cursor-pointer transition-colors duration-300 ease-in-out hover:bg-white hover:text-black group">
            <button 
              className="bg-none border-none text-[#6f7681] cursor-pointer p-0 w-6 h-6 flex items-center justify-center transition-all duration-300 ease-in-out hover:text-white hover:scale-110 active:scale-95 group-hover:text-black group-hover:scale-110" 
              onClick={onClose}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M18 6L6 18M6 6L18 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="pt-3 pb-0 flex flex-col gap-0 overflow-y-auto flex-1">
          <div className="flex flex-col gap-6 flex-1 pb-6">
            <div className="flex items-start gap-2.5 px-4">
              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                <input
                  type="checkbox"
                  id="termsAndPrivacy"
                  checked={checks.termsAndPrivacy}
                  onChange={() => handleCheckChange('termsAndPrivacy')}
                  className="appearance-none w-4 h-4 border border-white/50 rounded bg-black cursor-pointer relative transition-all duration-200 ease-in-out hover:border-white/70 checked:bg-white checked:border-black checked:after:content-[''] checked:after:absolute checked:after:left-1 checked:after:top-[1px] checked:after:w-[5px] checked:after:h-[9px] checked:after:border-solid checked:after:border-black checked:after:border-t-0 checked:after:border-r-[2px] checked:after:border-b-[2px] checked:after:border-l-0 checked:after:rotate-45"
                />
              </div>
              <label htmlFor="termsAndPrivacy" className="flex-1 text-base text-[#a2a2a0] leading-[1.4] tracking-[-0.8px] cursor-pointer max-md:text-sm">
                You acknowledge that you have read, understood, and agreed to{' '}
                <a href="/terms" target="_blank" className="text-[#00ff24] no-underline transition-opacity duration-200 ease-in-out hover:opacity-80">
                  terms of use
                </a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" className="text-[#00ff24] no-underline transition-opacity duration-200 ease-in-out hover:opacity-80">
                  privacy policy
                </a>
              </label>
            </div>

            <div className="flex items-start gap-2.5 px-4">
              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                <input
                  type="checkbox"
                  id="cookiePolicy"
                  checked={checks.cookiePolicy}
                  onChange={() => handleCheckChange('cookiePolicy')}
                  className="appearance-none w-4 h-4 border border-white/50 rounded bg-black cursor-pointer relative transition-all duration-200 ease-in-out hover:border-white/70 checked:bg-white checked:border-black checked:after:content-[''] checked:after:absolute checked:after:left-1 checked:after:top-[1px] checked:after:w-[5px] checked:after:h-[9px] checked:after:border-solid checked:after:border-black checked:after:border-t-0 checked:after:border-r-[2px] checked:after:border-b-[2px] checked:after:border-l-0 checked:after:rotate-45"
                />
              </div>
              <label htmlFor="cookiePolicy" className="flex-1 text-base text-[#a2a2a0] leading-[1.4] tracking-[-0.8px] cursor-pointer max-md:text-sm">
                Cookies and browser data are essential for proper functioning of the site, by using
                the site you agree to{' '}
                <a href="/cookies" target="_blank" className="text-[#00ff24] no-underline transition-opacity duration-200 ease-in-out hover:opacity-80">
                  cookie policy
                </a>
              </label>
            </div>

            <div className="flex items-start gap-2.5 px-4">
              <div className="flex-shrink-0 w-6 h-6 flex items-center justify-center">
                <input
                  type="checkbox"
                  id="enableTrading"
                  checked={checks.enableTrading}
                  onChange={() => handleCheckChange('enableTrading')}
                  className="appearance-none w-4 h-4 border border-white/50 rounded bg-black cursor-pointer relative transition-all duration-200 ease-in-out hover:border-white/70 checked:bg-white checked:border-black checked:after:content-[''] checked:after:absolute checked:after:left-1 checked:after:top-[1px] checked:after:w-[5px] checked:after:h-[9px] checked:after:border-solid checked:after:border-black checked:after:border-t-0 checked:after:border-r-[2px] checked:after:border-b-[2px] checked:after:border-l-0 checked:after:rotate-45"
                />
              </div>
              <label htmlFor="enableTrading" className="flex-1 text-base text-[#a2a2a0] leading-[1.4] tracking-[-0.8px] cursor-pointer max-md:text-sm">
                Enable trading: this will enable one click trading on the application [required]
              </label>
            </div>
          </div>

          <button
            className={`w-full m-0 bg-[#8a8a8a] text-[#3d4855] border-none py-5 px-6 text-lg font-medium cursor-pointer flex items-center justify-center gap-3 tracking-[-0.4px] transition-all duration-200 ease-in-out rounded-none mt-auto disabled:bg-white/30 disabled:text-[rgba(27,39,58,0.5)] disabled:cursor-not-allowed hover:enabled:bg-white hover:enabled:text-black active:enabled:translate-y-0 [&_svg]:stroke-current ${
              !allChecked ? 'disabled' : ''
            }`}
            onClick={handleStartTrading}
            disabled={!allChecked}
          >
            Start Trading
            <svg width="18" height="16" viewBox="0 0 18 16" fill="none">
              <path
                d="M1 8H17M17 8L10 1M17 8L10 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}