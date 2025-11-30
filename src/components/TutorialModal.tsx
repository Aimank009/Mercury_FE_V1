'use client';

interface TutorialModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

export default function TutorialModal({ isOpen, onComplete }: TutorialModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0  backdrop-blur-[12px] flex items-center justify-center z-[10001] animate-[fadeIn_0.3s_ease]">
      <div className="bg-[#000] border border-[#162A19] rounded-[24px] w-[400px] max-w-[90%] md:max-h-[90vh] flex flex-col animate-[slideUp_0.3s_cubic-bezier(0.16,1,0.3,1)] relative">
        <div className="p-6 px-4 md:p-5 md:px-4 flex flex-col gap-[10px] text-center">
          <p className="text-lg md:text-lg font-medium text-[#6f7681] tracking-[-0.9px] m-0">Welcome to</p>
          {/* <h1 className="font-['Geist_Mono'] text-2xl md:text-xl font-normal tracking-[2px] m-0 [text-shadow:0px_2px_5.8px_rgba(0,255,36,0.3)] bg-gradient-to-b from-[#00ff24] to-[#00cc1f] bg-clip-text text-transparent">
            MERCURY
          </h1> */}
        </div>

        <div className="px-[76px] md:px-6 flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <div className="flex justify-center items-center w-full h-[224px] md:h-[180px] bg-black rounded-xl">
              {/* Video will be added later */}
              <img src="/image copy.png" alt="" className=" rounded-xl w-full h-full object-contain pl-5" />
            </div>
            <div className="flex gap-[5px] w-full">
              <div className="flex-1 h-1.5 bg-[#00ff24] rounded-xl transition-colors duration-300" />
              <div className="flex-1 h-1.5 bg-white/10 rounded-xl transition-colors duration-300" />
              <div className="flex-1 h-1.5 bg-white/10 rounded-xl transition-colors duration-300" />
            </div>
          </div>

          <div className="flex flex-col gap-4 pb-6">
            <div className="flex items-start gap-[11px]">
              <svg className="flex-shrink-0 w-[18px] h-[18px] text-[#00ff24]" width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M15.1875 3.9375L6.9375 12.1875L3.9375 9.1875"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="flex-shrink-0 text-sm md:text-[13px] font-medium text-white tracking-[-0.7px] whitespace-nowrap">single tap :</span>
              <p className="flex-1 text-xs md:text-[11px] text-[#929aa8] tracking-[-0.6px] leading-[1.5] m-0">
                Place orders by tapping on the block, this creates a binary order with desired
                expiry and predetermined amount
              </p>
            </div>

            <div className="flex items-start gap-[11px]">
              <svg className="flex-shrink-0 w-[18px] h-[18px] text-[#00ff24]" width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M2 2H16V16H2V2Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M2 6H16M2 10H16M6 2V16M10 2V16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M11 11L13 13"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span className="flex-shrink-0 text-sm md:text-[13px] font-medium text-white tracking-[-0.7px] whitespace-nowrap">click &amp; drag:</span>
              <p className="flex-1 text-xs md:text-[11px] text-[#929aa8] tracking-[-0.6px] leading-[1.5] m-0">
                M + click and drag to select multiple grids* and place multiple orders, double click
                the selection to confirm
              </p>
            </div>
          </div>
        </div>
        <div className="flex justify-center items-center w-full">
        <button 
          className="w-[80%] mb-4 bg-[#00FF24] rounded-[24px] text-[#000] border-1 border-[#00F92366] py-2 px-4 text-base font-400 cursor-pointer flex items-center justify-center gap-[10px] tracking-[-0.8px] transition-all duration-200 mt-auto hover:bg-[#000] hover:text-[#00570C] hover:border-[#00570C] hover:border "
          onClick={onComplete}
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

