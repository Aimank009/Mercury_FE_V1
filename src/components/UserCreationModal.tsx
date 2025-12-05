import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { generateAvatarImage } from '../lib/avatarGenerator';
import { useDisconnect } from 'wagmi';
import { triggerProfileRefresh } from '../hooks/useUserProfile';
import { assignReferralCode } from '../utils/generateReferralCode';

interface UserCreationModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  walletAddress: string;
  usedReferralCode: string | null;
}

export default function UserCreationModal({ isOpen, onSuccess, walletAddress, usedReferralCode }: UserCreationModalProps) {
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState('');
  const [isCheckingExistingUser, setIsCheckingExistingUser] = useState(true);
  const { disconnect } = useDisconnect();

  // Check if user already exists in database - if so, skip the modal
  useEffect(() => {
    const checkExistingUser = async () => {
      if (!isOpen || !walletAddress) {
        setIsCheckingExistingUser(false);
        return;
      }

      try {
        // Normalize wallet address to lowercase for consistent comparison
        const normalizedAddress = walletAddress.toLowerCase();
        console.log('🔍 UserCreationModal: Checking for existing user:', walletAddress, '(normalized:', normalizedAddress, ')');
        
        const { data: existingUser, error: fetchError } = await supabase
          .from('users')
          .select('wallet_address, username')
          .ilike('wallet_address', normalizedAddress) // Case-insensitive!
          .maybeSingle();

        if (fetchError) {
          console.error('Error checking existing user:', fetchError);
          setIsCheckingExistingUser(false);
          return;
        }

        if (existingUser) {
          // ✅ USER EXISTS - Skip modal entirely!
          console.log('✅ UserCreationModal: Existing user found, skipping modal:', existingUser.username);
          
          // Update localStorage
          localStorage.setItem(`mercury_access_granted_${walletAddress.toLowerCase()}`, 'true');
          
          // Trigger profile refresh so Navbar loads the profile
          triggerProfileRefresh();
          
          // Call onSuccess to close modal and proceed
          onSuccess();
          return;
        }
        
        console.log('👋 UserCreationModal: New user, showing form');
        setIsCheckingExistingUser(false);
        
      } catch (err) {
        console.error('Exception checking existing user:', err);
        setIsCheckingExistingUser(false);
      }
    };

    checkExistingUser();
  }, [isOpen, walletAddress, onSuccess]);

  useEffect(() => {
    if (isOpen && walletAddress && !isCheckingExistingUser) {
      generateAvatar();
    }
  }, [isOpen, walletAddress, isCheckingExistingUser]);

  const generateAvatar = async () => {
    setIsGeneratingAvatar(true);
    try {
      const result = await generateAvatarImage(walletAddress, 512);
      setAvatarUrl(result.dataURL);
    } catch (err) {
      console.error('Failed to generate avatar:', err);
    } finally {
      setIsGeneratingAvatar(false);
    }
  };

  const handleClose = () => {
    disconnect();
  };

  const handleSubmit = async () => {
    if (!username) {
      setError('Please enter a username');
      return;
    }
    if (!agreedToTerms) {
      setError('You must agree to the Terms and Policy');
      return;
    }
    
    setIsLoading(true);
    setError('');

    // Get used referral code from props or localStorage
    const referralCodeToUse = usedReferralCode || localStorage.getItem(`mercury_used_referral_${walletAddress.toLowerCase()}`) || null;
    console.log('🔑 Referral code to use:', { usedReferralCode, fromLocalStorage: localStorage.getItem(`mercury_used_referral_${walletAddress.toLowerCase()}`), final: referralCodeToUse });

    try {
      // Check if username is taken
      const { data: existingUser } = await supabase
        .from('users')
        .select('wallet_address')
        .eq('username', username)
        .maybeSingle();

      if (existingUser) {
        setError('Username already taken');
        setIsLoading(false);
        return;
      }

      // Generate referral code BEFORE creating user
      let newUserReferralCode = '';
      try {
        const { generateReferralCode } = await import('../utils/generateReferralCode');
        newUserReferralCode = await generateReferralCode(username);
        console.log('🎟️ Generated referral code:', newUserReferralCode);
      } catch (refError) {
        console.error('⚠️ Failed to generate referral code:', refError);
        // Continue with empty referral code
      }

      // Using the RPC function we defined in SQL
      // Keep wallet address as-is (checksum format from wagmi)
      if (!newUserReferralCode) {
        console.warn('No referral code generated, proceeding without it');
      }
      const { error: rpcError } = await supabase
        .rpc('create_user_profile', { 
          p_wallet_address: walletAddress,
          p_username: username,
          p_avatar_url: avatarUrl,
          p_used_referral: referralCodeToUse, // Store the access code as used_referral
          p_user_referral: newUserReferralCode || null
        });
        console.log("create user profile usr");
        
        
        if (rpcError) {
          // If RPC fails (maybe function not created yet or signature mismatch), try direct insert
          console.warn('RPC failed, trying direct insert:', rpcError);
          const { error: insertError } = await supabase
          .from('users')
          .insert([
            { 
              wallet_address: walletAddress, 
              username: username,
              avatar_url: avatarUrl,
              used_referral: referralCodeToUse, // Store the access code as used_referral
              user_referral: newUserReferralCode || null,
              num_referral: 0,
              xp: 0
            }
          ]);
          console.log("create user profile usr cbsjdhcbdshjb");
          
        if (insertError) throw insertError;
        console.log('✅ User created with referral code:', newUserReferralCode);
      } else {
        console.log('✅ User created via RPC with referral code:', newUserReferralCode);
      }

      // Trigger profile refresh so Navbar updates immediately
      triggerProfileRefresh();
      
      onSuccess();
    } catch (err: any) {
      console.error('Error creating profile:', err);
      if (err.code === '23505') { // Unique violation
        setError('This wallet is already registered.');
        // If already registered, trigger refresh and log them in
        triggerProfileRefresh();
        onSuccess();
      } else {
        setError('Failed to create profile. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading while checking for existing user
  if (isCheckingExistingUser && isOpen) {
    return (
      <div className="fixed inset-0 bg-black/30 backdrop-blur-[12px] flex items-center justify-center z-[10000]">
        <div className="text-white text-sm font-mono">Checking account...</div>
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-[12px] flex items-center justify-center z-[10000] animate-[fadeIn_0.3s_ease]">
      <div 
        className="relative flex flex-col items-center p-8"
        style={{
          width: '407px',
          height: '520px', // Slightly taller for avatar
          borderRadius: '24px',
          backgroundColor: '#0B140D',
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

        <div className="text-center -mt-2 flex flex-col items-center w-full">
          <p className="text-[#6F7681] text-[18px] mb-2 font-500 tracking-wide font-geist">Welcome to</p>
           <img 
            src="/image copy.png" 
            alt="MERCURY" 
            className="h-8 object-contain"
            style={{
              filter: 'drop-shadow(0 0 20px rgba(0,255,36,0.3))'
            }}
          />
          
          {/* Avatar Display */}
          <div className="relative w-32 h-32 mb-6">
            {isGeneratingAvatar ? (
              <div className="w-full h-full rounded-full bg-[#1a1a1a] animate-pulse flex items-center justify-center border border-[#333]">
                <span className="text-[#444] text-xs">Generating...</span>
              </div>
            ) : (
              <div className="relative w-full h-full mt-6">
                 <div className="absolute inset-0 rounded-full  bg-[#00FF24] blur-md opacity-20"></div>
                 <img 
                  src={avatarUrl} 
                  alt="Avatar" 
                  className="w-full h-full rounded-full object-cover border-2 border-[#fff]/80 relative z-10"
                  style={{ boxShadow: '0 0 30px rgba(0,0,0,0.5)' }}
                />
              </div>
            )}
          </div>

          <p className="text-white text-[18px] font-400 mt-4 font-geist">What should we call you ?</p>
        </div>

        <div className="w-full flex-1 flex flex-col justify-between px-4 pb-2 mt-2">
          <div className="flex flex-col gap-4">
            <div className="relative w-full">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#666] font-mono text-sm pointer-events-none">@</span>
              <input
                type="text"
                value={username}
                onChange={(e) => {
                  const val = e.target.value.replace(/@/g, '');
                  setUsername(val);
                  if (error) setError('');
                }}
                placeholder="Username"
                className={`w-full bg-[#1a1a1a] border rounded-lg pl-9 pr-4 py-3 text-left placeholder:text-[#444] focus:outline-none transition-colors font-mono text-sm ${
                  error 
                    ? 'text-[#FF3B30] border-[#FF3B30] focus:border-[#FF3B30]' 
                    : 'text-white border-[#333] focus:border-[#00ff24]'
                }`}
                style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    borderColor: error ? '#FF3B30' : 'rgba(255, 255, 255, 0.1)'
                }}
              />
            </div>
            
            <div className="flex items-center justify-center gap-2 mt-2">
                <div 
                    className={`w-5 h-5 rounded border flex items-center justify-center cursor-pointer transition-colors ${agreedToTerms ? 'bg-[#00FF24] border-[#00FF24]' : 'bg-transparent border-[#444]'}`}
                    onClick={() => setAgreedToTerms(!agreedToTerms)}
                >
                    {agreedToTerms && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 3L4.5 8.5L2 6" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    )}
                </div>
                <span className="text-[#888] text-[16px] font-400 font-geist">
                    Agree to <span className="underline cursor-pointer hover:text-white">Terms</span> and <span className="underline cursor-pointer hover:text-white">Policy</span>
                </span>
            </div>

            {error && (
                <p className="text-[#FF3B30] text-[16px] font-400 text-center font-geist tracking-wide">{error}</p>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={isLoading || !username || !agreedToTerms}
            className="w-[359px]  bg-[#00FF24]/80 hover:bg-[#00cc1f] disabled:opacity-50 disabled:cursor-not-allowed text-black font-500 py-3 rounded-[8px] transition-all duration-200 font-geist text-[16px] tracking-wide absolute bottom-4 left-1/2 -translate-x-1/2"
            style={{
                boxShadow: '0px 0px 20px rgba(0, 255, 36, 0.2)'
            }}
          >
            {isLoading ? 'Creating Profile...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
