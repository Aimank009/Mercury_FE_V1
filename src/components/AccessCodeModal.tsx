import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useDisconnect } from 'wagmi';

interface AccessCodeModalProps {
  isOpen: boolean;
  onSuccess: () => void;
}

export default function AccessCodeModal({ isOpen, onSuccess }: AccessCodeModalProps) {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const { disconnect } = useDisconnect();

  const handleClose = () => {
    disconnect();
    // The modal will close automatically because useOnboarding will detect disconnection
  };

  const handleSubmit = async () => {
    if (!code) return;
    setIsLoading(true);
    setError('');

    try {
      // Call the Postgres function we created
      const { data, error } = await supabase
        .rpc('check_access_code', { input_code: code });

      if (error) throw error;

      if (data === true) {
        onSuccess();
      } else {
        setError('Invalid access code');
      }
    } catch (err) {
      console.error('Error checking code:', err);
      setError('Verification failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[12px] flex items-center justify-center z-[10000] animate-[fadeIn_0.3s_ease]">
      <div 
        className="relative flex flex-col items-center p-8"
        style={{
          width: '407px',
          height: '393px',
          borderRadius: '24px',
          backgroundColor: '#0B140D',
          // Gradient border trick: padding-box background + border-box gradient
          background: `
            linear-gradient(#0B140D, #0B140D) padding-box,
            linear-gradient(180deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0) 100%) border-box
          `,
          border: '1px solid transparent',
          boxShadow: '0px 8px 32px rgba(0, 0, 0, 0.5)'
        }}
      >
        {/* Close Button */}
        <button 
            className="absolute top-5 right-5 flex items-center justify-center transition-all duration-200 hover:scale-105 hover:bg-white/20"
            style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                border: 'none',
                cursor: 'pointer'
            }}
            onClick={handleClose}
        >
             <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13 1L1 13M1 1L13 13" stroke="white" strokeOpacity="0.6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
        </button>

        <div className="text-center -mt-2 flex flex-col items-center">
          <p className="text-[#6F7681] text-[18px] mb-2 font-400 tracking-wide font-['Geist_Mono'] ">Welcome to</p>
          <img 
            src="/image copy.png" 
            alt="MERCURY" 
            className="h-8 object-contain"
            style={{
              filter: 'drop-shadow(0 0 20px rgba(0,255,36,0.3))'
            }}
          />
        </div>

        <div className="w-full flex-1 flex flex-col justify-between px-4 pb-2 mt-8">
          <div className="flex flex-col gap-2 mt-2">
            <label className="text-white text-[18px] font-500 text-center font-['Geist_Mono']">Enter Access Code:</label>
            <input
              type="text"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                if (error) setError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code && !isLoading) {
                  handleSubmit();
                }
              }}
              placeholder="XXX-XXX-XXX-XXX"
              className={`w-full bg-[#1a1a1a] border rounded-lg px-4 py-3 text-center placeholder:text-[#444] focus:outline-none transition-colors font-mono uppercase text-sm ${
                error 
                  ? 'text-[#FF3B30] focus:border-[#FF3B30]' 
                  : 'text-white focus:border-[#00ff24]'
              }`}
              style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  borderColor: error ? '#FF5E5E' : 'rgba(255, 255, 255, 0.1)'
              }}
            />
            {error && (
                <p className="text-[#FF5E5E] text-[14px] font-400 text-center font-['Geist_Mono'] mt-2 tracking-wide">{error}</p>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={isLoading || !code}
            className="w-[359px] -ml-6 bg-[#00FF24]/80 hover:bg-[#00cc1f]  disabled:cursor-not-allowed text-black font-500 py-3 rounded-[8px] transition-all duration-200 font-['Geist_Mono']  text-[16px] tracking-wide"
            style={{
                boxShadow: '0px 0px 20px rgba(0, 255, 36, 0.2)'
            }}
          >
            {isLoading ? 'Verifying...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
