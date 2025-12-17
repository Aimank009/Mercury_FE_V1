import { useState } from 'react';
import { ethers } from 'ethers';
import { useSessionTrading } from '../contexts/SessionTradingContext';
import { PRICE_STEP, CONTRACTS, DEFAULT_CHAIN_ID, API_URLS, STORAGE_KEYS } from '../config';
import { storage, formatNumber, formatUSD } from '../utils';
import { supabase } from '../lib/supabaseClient';

// ========================================
// CONFIGURATION
// ========================================
const SERVER_URL = API_URLS.RELAYER;
const CHAIN_ID = DEFAULT_CHAIN_ID;
const WRAPPER_CONTRACT_ADDRESS = CONTRACTS.WRAPPER;

// ========================================
// EIP-712 Domain & Types for BetOrder
// ========================================
const domain = {
  name: "MercuryTrade", // Must match contract constructor
  version: "1",
  chainId: CHAIN_ID,
  verifyingContract: WRAPPER_CONTRACT_ADDRESS
};

const types = {
  BetOrder: [
    { name: "user", type: "address" },
    { name: "timeperiodId", type: "uint256" },
    { name: "priceMin", type: "uint256" },
    { name: "priceMax", type: "uint256" },
    { name: "amount", type: "uint256" },
    // { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
};

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Convert price in USD to 8 decimals (as used by Hyperliquid oracle)
 * Example: 39.0 USD -> 3900000000 (39 * 10^8)
 * Example: 24.5 USD -> 2450000000 (24.5 * 10^8)
 */
function priceToRaw(priceUSD: number): string {
  return BigInt(Math.floor(priceUSD * 1e8)).toString();
}

/**
 * Convert raw price (8 decimals) back to USD
 * Example: 3900000000 -> 39.0 USD
 */
function rawToPrice(raw: string): number {
  return Number(raw) / 1e8;
}

/**
 * Convert amount in USD to 6 decimals (USDC/USDTO format)
 * Example: 100 USD -> 100000000 (100 * 10^6)
 * Example: 50.5 USD -> 50500000 (50.5 * 10^6)
 */
function amountToRaw(amountUSD: number): string {
  return BigInt(Math.floor(amountUSD * 1e6)).toString();
}

/**
 * Convert raw amount (6 decimals) back to USD
 * Example: 100000000 -> 100 USD
 */
function rawToAmount(raw: string): number {
  return Number(raw) / 1e6;
}

/**
 * Convert datetime to Unix timestamp (for timeperiodId)
 * Example: "2025-01-21T16:10:00" -> 1737475800
 */
function datetimeToTimestamp(datetimeString: string): number {
  return Math.floor(new Date(datetimeString).getTime() / 1000);
}

/**
 * Get the time when the graph started plotting
 */
function getGraphStartTime(): number | null {
  // Check if we're in the browser (not SSR)
  if (typeof window === 'undefined') {
    console.warn('⚠️ Cannot access localStorage during SSR');
    return null;
  }
  
  const startTimeStr = storage.get<string>(STORAGE_KEYS.GRAPH_START_TIME);
  console.log('🔍 Raw value from localStorage:', startTimeStr);
  
  if (!startTimeStr) {
    console.warn('⚠️ Graph start time not found in localStorage');
    return null;
  }
  
  const startTime = parseInt(startTimeStr);
  console.log('📊 Parsed graph start time:', startTime, new Date(startTime * 1000).toISOString());
  console.log('📊 Original string:', startTimeStr);
  console.log('📊 Difference:', startTime - parseInt(startTimeStr));
  return startTime;
}

/**
 * Get stored session info
 */

function getStoredSession(): any | null {
  if (typeof window === 'undefined') return null;
  
  console.log('🔍 Looking for session in localStorage...');
  
  // First try to find any trading session in localStorage
  let sessionData = null;
  let sessionKey = null;
  
  // Look for session with pattern tradingSession_*
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('tradingSession_')) {
      sessionData = storage.get<string>(key);
      sessionKey = key;
      console.log('✅ Found session with key:', key);
      break;
    }
  }
  
  // Fallback to mercurySession for backward compatibility
  if (!sessionData) {
    sessionData = storage.get<string>(STORAGE_KEYS.MERCURY_SESSION);
    sessionKey = STORAGE_KEYS.MERCURY_SESSION;
    if (sessionData) {
      console.log('✅ Found session with key: mercurySession');
    }
  }
  
  if (!sessionData) {
    console.log('❌ No session found. Available localStorage keys:', 
      Array.from({length: localStorage.length}, (_, i) => localStorage.key(i))
    );
    return null; // Return null instead of throwing
  }
  
  const session = typeof sessionData === 'string' ? JSON.parse(sessionData) : sessionData;
  
  // Check if expired
  const now = Math.floor(Date.now() / 1000);
  
  console.log('🔍 SESSION EXPIRY CHECK:');
  console.log('  - Session expiry (seconds):', session.expiry);
  console.log('  - Current time (seconds):', now);
  console.log('  - Session expiry (date):', new Date(session.expiry * 1000).toISOString());
  console.log('  - Current time (date):', new Date(now * 1000).toISOString());
  console.log('  - Time difference (seconds):', session.expiry - now);
  console.log('  - Time difference (hours):', (session.expiry - now) / 3600);
  console.log('  - Is expired?', session.expiry < now);
  
  if (session.expiry < now) {
    console.log('❌ Session expired:', { 
      expiry: new Date(session.expiry * 1000).toISOString(),
      now: new Date(now * 1000).toISOString(),
      timeDifference: session.expiry - now
    });
    if (sessionKey) {
      localStorage.removeItem(sessionKey);
    }
    return null; // Return null instead of throwing
  }
  
  console.log('✅ Valid session found:', { 
    userAddress: session.userAddress,
    sessionKey: session.sessionKeyAddress,
    expiry: new Date(session.expiry * 1000).toISOString(),
    availableProperties: Object.keys(session)
  });
  
  return session;
}

/**
 * Helper function to get nonce from localStorage or fetch from contract
 * Uses optimistic locking - increments nonce IMMEDIATELY to prevent race conditions
 */
async function getCurrentNonce(userAddress: string): Promise<number> {
  try {
    const localStorageKey = STORAGE_KEYS.NONCE(userAddress.toLowerCase(), CHAIN_ID);
    const storedNonce = storage.get<string>(localStorageKey);
    
    if (storedNonce !== null) {
      const nonce = parseInt(storedNonce);
      console.log('📊 Using nonce from localStorage:', nonce);
      
      // ✅ OPTIMISTIC INCREMENT: Increment immediately to prevent race conditions
      // If multiple orders are placed rapidly, each gets a unique nonce
      storage.set(localStorageKey, (nonce + 1).toString());
      console.log('✅ Optimistically incremented nonce to:', nonce + 1);
      
      return nonce;
    }
    
    // If no stored nonce, fetch from contract
    console.log('📊 No stored nonce found, fetching from contract...');
    const provider = new ethers.providers.Web3Provider(window.ethereum as any);
    const contract = new ethers.Contract(
      CONTRACTS.WRAPPER,
      [
        {
          "inputs": [{"internalType": "address", "name": "_user", "type": "address"}],
          "name": "getNonce",
          "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
          "stateMutability": "view",
          "type": "function"
        }
      ],
      provider
    );
    
    const nonce = await contract.getNonce(userAddress);
    const nonceNumber = nonce.toNumber();
    console.log('📊 Fetched current nonce from contract:', nonceNumber);
    
    // Store INCREMENTED nonce for next use (optimistic locking)
    storage.set(localStorageKey, (nonceNumber + 1).toString());
    console.log('💾 Stored incremented nonce in localStorage:', nonceNumber + 1);
    
    return nonceNumber;
  } catch (error) {
    console.error('❌ Failed to fetch nonce:', error);
    throw new Error(`Failed to fetch nonce: ${error}`);
  }
}

/**
 * Helper function to increment nonce in localStorage after successful bet
 * NOTE: This is now handled optimistically in getCurrentNonce()
 * This function is kept for backwards compatibility but should not be used
 * @deprecated Use optimistic increment in getCurrentNonce() instead
 */
function incrementStoredNonce(userAddress: string): void {
  const localStorageKey = STORAGE_KEYS.NONCE(userAddress.toLowerCase(), CHAIN_ID);
  const storedNonce = storage.get<string>(localStorageKey);
  
  if (storedNonce !== null) {
    const currentNonce = parseInt(storedNonce);
    const newNonce = currentNonce + 1;
    storage.set(localStorageKey, newNonce.toString());
    console.log('✅ Incremented nonce in localStorage:', currentNonce, '->', newNonce);
  } else {
    console.warn('⚠️ No nonce found in localStorage to increment');
  }
}

/**
 * Helper function to rollback nonce when transaction fails
 * Decrements the optimistically incremented nonce
 */
function rollbackNonce(userAddress: string): void {
  const localStorageKey = STORAGE_KEYS.NONCE(userAddress.toLowerCase(), CHAIN_ID);
  const storedNonce = storage.get<string>(localStorageKey);
  
  if (storedNonce !== null) {
    const currentNonce = parseInt(storedNonce);
    if (currentNonce > 0) {
      const newNonce = currentNonce - 1;
      storage.set(localStorageKey, newNonce.toString());
      console.log('🔄 Rolled back nonce in localStorage:', currentNonce, '->', newNonce);
    } else {
      console.warn('⚠️ Cannot rollback nonce below 0');
    }
  } else {
    console.warn('⚠️ No nonce found in localStorage to rollback');
  }
}

/**
 * Helper function to check user balance in contract
 */
async function checkUserBalance(userAddress: string): Promise<{balance: number, balanceUSD: number}> {
  try {
    const provider = new ethers.providers.Web3Provider(window.ethereum as any);
    const contract = new ethers.Contract(
      CONTRACTS.WRAPPER,
      [
        {
          "inputs": [{"internalType": "address", "name": "_user", "type": "address"}],
          "name": "getBalance",
          "outputs": [{"internalType": "uint256", "name": "", "type": "uint256"}],
          "stateMutability": "view",
          "type": "function"
        }
      ],
      provider
    );
    
    const balance = await contract.getBalance(userAddress);
    const balanceUSD = balance.toNumber() / 1e6; // Convert from 6 decimals to USD
    console.log('💰 User balance in contract:', balance.toString(), `($${balanceUSD})`);
    return { balance: balance.toNumber(), balanceUSD };
  } catch (error) {
    console.error('❌ Failed to fetch balance from contract:', error);
    throw new Error(`Failed to fetch balance: ${error}`);
  }
}

export interface OrderPlacementResult {
  success: boolean;
  txHash?: string;
  error?: string;
  isSpecificError?: boolean; // Flag for errors that should show prominent pop-ups
  isSessionError?: boolean; // Flag for session errors that should show session popup
}

export interface OrderParams {
  timeperiod: string | Date | number;
  priceMin: number;
  priceMax: number;
  amount: number;
  orderNonce?: number;
}

export function useOrderPlacement() {
  const { sdk } = useSessionTrading();
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [lastOrderResult, setLastOrderResult] = useState<OrderPlacementResult | null>(null);

  /**
   * Helper function to dispatch error event for cell deselection
   */
  const dispatchErrorEvent = (errorMessage: string, timeperiodId?: number, priceMin?: string, priceMax?: string, amountUSD?: number) => {
    try {
      if (typeof window !== 'undefined') {
        const detail: any = {
          success: false,
          error: errorMessage
        };
        
        // Add grid data if available
        if (typeof timeperiodId !== 'undefined') {
          detail.timeperiodId = timeperiodId;
        }
        if (typeof priceMin !== 'undefined' && typeof priceMax !== 'undefined') {
          detail.priceMinUSD = rawToPrice(priceMin);
          detail.priceMaxUSD = rawToPrice(priceMax);
        }
        if (typeof amountUSD !== 'undefined') {
          detail.amountUSD = amountUSD;
        }
        
        window.dispatchEvent(new CustomEvent('orderPlaced', { detail }));
        console.log('🚨 Dispatched orderPlaced error event for cell deselection:', detail);
      }
    } catch (evErr) {
      console.warn('Could not dispatch orderPlaced error event', evErr);
    }
  };

  /**
   * Place a bet using session signature
   * @param {OrderParams} betParams - Bet parameters
   */
  const placeBet = async (betParams: OrderParams): Promise<OrderPlacementResult> => {
    console.log('🎲 Starting place bet...\n');

    setIsPlacingOrder(true);
    setLastOrderResult(null);

    // Declare variables at function level so they're available in catch block
    let timeperiodId: number | undefined;
    let priceMin: string | undefined;
    let priceMax: string | undefined;
    let amountUSD: number | undefined;

    try {
      // ========================================
      // STEP 1: Get Session Info
      // ========================================
      console.log('📍 STEP 1: Loading session...');
      const session = getStoredSession();
      
      console.log('✅ Session loaded:');
      console.log('   User:', session.userAddress);
      console.log('   Session Key:', session.sessionKeyAddress);
      
      // Detailed session analysis
      console.log('🔍 SESSION DATA ANALYSIS:');
      console.log('  📊 Session Structure:');
      console.log('    - Raw session:', JSON.stringify(session, null, 2));
      console.log('    - session.user:', session.user);
      console.log('    - session.userAddress:', session.userAddress);
      console.log('    - session.sessionKey:', session.sessionKey);
      console.log('    - session.sessionKeyAddress:', session.sessionKeyAddress);
      console.log('    - session.sessionPrivateKey:', session.sessionPrivateKey ? 'present' : 'missing');
      console.log('    - session.sessionKeyPrivateKey:', session.sessionKeyPrivateKey ? 'present' : 'missing');
      console.log('    - session.expiry:', session.expiry, '(type:', typeof session.expiry, ')');
      console.log('    - session.nonce:', session.nonce, '(type:', typeof session.nonce, ')');
      console.log('');

      // ========================================
      // STEP 2: Prepare Bet Parameters
      // ========================================
      console.log('📍 STEP 2: Preparing bet parameters...');

      // Convert timeperiod to Unix timestamp (this IS the timeperiodId!)
      if (betParams.timeperiod instanceof Date) {
        timeperiodId = Math.floor(betParams.timeperiod.getTime() / 1000);
      } else if (typeof betParams.timeperiod === 'string') {
        timeperiodId = datetimeToTimestamp(betParams.timeperiod);
      } else {
        timeperiodId = Math.floor(betParams.timeperiod); // Ensure integer
      }
      
      console.log('🕐 TimeperiodId calculation:', {
        input: betParams.timeperiod,
        timeperiodId: timeperiodId,
        timeperiodIdDate: new Date(timeperiodId! * 1000).toISOString(),
        currentTime: new Date().toISOString()
      });

      // Convert prices from USD to 8 decimals
      priceMin = priceToRaw(betParams.priceMin);
      priceMax = priceToRaw(betParams.priceMax);

      // Get amount from localStorage (set by AmountModal), default to 0.2 if not set
      const savedAmount = storage.get<string>(STORAGE_KEYS.USER_AMOUNT);
      
      if (savedAmount && parseFloat(savedAmount) > 0) {
        amountUSD = parseFloat(savedAmount);
        console.log('💰 Using amount from AmountModal:', amountUSD);
      } else {
        amountUSD = 1.0; // Default to 1.0 USD
        console.log('💰 No amount set, using default:', amountUSD);
      }
      
      // Ensure minimum amount is 0.2
      if (amountUSD < 0.2) {
        console.warn('⚠️ Amount too low, adjusting to minimum 0.2 USD');
        amountUSD = 0.2;
      }

      // Convert amount to 6 decimals (USDTO format)
      const amount = amountToRaw(amountUSD);

      // Use session expiry as deadline (from session creation)
      // session.expiry is already in seconds, no conversion needed
      const deadline = session.expiry;
      
      console.log('🔍 Session expiry (no conversion needed):');
      console.log('  - session.expiry (seconds):', session.expiry);
      console.log('  - deadline (seconds):', deadline);
      console.log('  - expiry as date:', new Date(session.expiry * 1000).toISOString());
      console.log('  - deadline as date:', new Date(deadline * 1000).toISOString());

      console.log('✅ Bet parameters prepared:');
      console.log('   Timeperiod ID:', timeperiodId, `(${new Date(timeperiodId * 1000).toISOString()})`);
      console.log('   Price Range:', betParams.priceMin, '-', betParams.priceMax, 'USD');
      console.log('   Price Min (raw):', priceMin);
      console.log('   Price Max (raw):', priceMax);
      console.log('   Amount:', amountUSD, 'USD =', amount, '(6 decimals)');
      console.log('   Amount Source:', savedAmount ? 'AmountModal (localStorage)' : 'Default (0.2)');
      console.log('   Order Nonce:', betParams.orderNonce || 1);
      console.log('   Deadline (session expiry):', deadline, `(${new Date(deadline * 1000).toISOString()})`);
      
      // Validate parameters
      if (priceMin >= priceMax) {
        const errorMessage = 'Invalid price range! Price minimum must be less than price maximum.';
        console.error('❌ ' + errorMessage);
        const errorResult = { success: false, error: errorMessage, isSpecificError: false };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, timeperiodId, priceMin, priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      if (timeperiodId <= Math.floor(Date.now() / 1000)) {
        const errorMessage = 'Invalid timeperiod! The selected time must be in the future.';
        console.error('❌ ' + errorMessage);
        const errorResult = { success: false, error: errorMessage, isSpecificError: false };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, timeperiodId, priceMin, priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      if (deadline <= Math.floor(Date.now() / 1000)) {
        const errorMessage = 'Session expired! Please create a new trading session to continue.';
        console.error('❌ ' + errorMessage);
        const errorResult = { success: false, error: errorMessage, isSpecificError: true };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, timeperiodId, priceMin, priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      
      // Additional validations for common contract revert reasons
      const currentTime = Math.floor(Date.now() / 1000);
      const timeUntilTimeperiod = (timeperiodId - currentTime);
      const timeUntilDeadline = (deadline - currentTime);
      
      console.log('🔍 Time validation:');
      console.log('  - Current time:', currentTime, new Date(currentTime * 1000).toISOString());
      console.log('  - Timeperiod:', timeperiodId, new Date(timeperiodId * 1000).toISOString());
      console.log('  - Time until timeperiod:', timeUntilTimeperiod, 'seconds');
      console.log('  - Session expiry (deadline):', deadline, new Date(deadline * 1000).toISOString());
      console.log('  - Time until session expiry:', timeUntilDeadline, 'seconds');
      
      // Check if timeperiod is too far in the future (common contract limitation)
      if (timeUntilTimeperiod > 86400) { // More than 24 hours
        console.warn('⚠️ Timeperiod is more than 24 hours in the future');
      }
      
      // Check if timeperiod is too close (common contract limitation)
      if (timeUntilTimeperiod < 60) { // Less than 1 minute
        console.warn('⚠️ Timeperiod is less than 1 minute in the future');
      }
      
      // Check if session is about to expire
      if (timeUntilDeadline < 60) { // Less than 1 minute
        console.warn('⚠️ Session expires in less than 1 minute');
      }
      
      // Check amount and price range
      console.log('💰 Amount and price validation:');
      console.log('  - Amount (USD):', betParams.amount);
      console.log('  - Amount (raw):', amount);
      console.log('  - Price min (USD):', betParams.priceMin);
      console.log('  - Price max (USD):', betParams.priceMax);
      console.log('  - Price range (USD):', betParams.priceMax - betParams.priceMin);
      console.log('  - Price min (raw):', priceMin);
      console.log('  - Price max (raw):', priceMax);
      
      // Check for minimum amount requirements
      if (parseFloat(amount) < 1000000) { // Less than 1 USD (6 decimals)
        console.warn('⚠️ Amount might be too small (less than $1)');
      }
      
      // Check for minimum price range
      const priceRangeUSD = betParams.priceMax - betParams.priceMin;
      if (priceRangeUSD < 0.01) { // Less than 1 cent
        console.warn('⚠️ Price range might be too small (less than $0.01)');
      }
      
      console.log('✅ Parameter validation passed');
      console.log('');

      // ========================================
      // STEP 3: Create Order Data
      // ========================================
      console.log('📍 STEP 3: Creating order data...');

      // Fetch current nonce from contract (contract uses nonces[user] in order hash)
      console.log('📊 Fetching current nonce from contract...');
      let currentNonce = await getCurrentNonce(session.user);
      
      // The contract expects the current nonce (before increment)
      // For first bet: nonce = 0, after increment it becomes 1
      // For second bet: nonce = 1, after increment it becomes 2
      console.log('📊 Nonce analysis:');
      console.log('  - Current nonce from contract:', currentNonce);
      console.log('  - This is the nonce BEFORE increment');
      console.log('  - Contract will increment it to:', currentNonce);
      
      // If you think nonce should be 1, let's try that
      // if (currentNonce === 0) {
      //   console.log('⚠️  Current nonce is 0 - this might be the issue');
      //   console.log('⚠️  If contract expects nonce to be 1 for first bet, we need to adjust');
      //   console.log('🔧 Trying nonce = 1 for first bet...');
      //   currentNonce = 1; // Override to 1 for first bet
      // }
      
      // Get user address from session (check multiple possible properties)
      console.log('🔍 Session properties available:', Object.keys(session));
      console.log('🔍 User address candidates:', {
        userAddress: session.userAddress,
        user: session.user,
        userAddress2: session.userAddress
      });
      
      const userAddress = session.userAddress || session.user;
      if (!userAddress) {
        console.error('❌ Available session properties:', Object.keys(session));
        const errorMessage = 'User address not found in session data. Please create a new session.';
        const errorResult = { success: false, error: errorMessage, isSpecificError: true };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, timeperiodId, priceMin, priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      
      // Check user balance in wrapper contract
      console.log('💰 Checking user balance in wrapper contract...');
      const { balance, balanceUSD } = await checkUserBalance(userAddress);
      
      // Validate balance is sufficient
      console.log('🔍 Balance validation:');
      console.log('  - User address:', userAddress);
      console.log('  - Balance in wrapper:', balance, `($${balanceUSD})`);
      console.log('  - Required amount:', amount, `($${amountUSD})`);
      console.log('  - Sufficient?', balanceUSD >= amountUSD);
      
      if (balanceUSD < amountUSD) {
        const errorMessage = `Insufficient wrapper balance! You have ${formatUSD(balanceUSD)} but need ${formatUSD(amountUSD)}. Please deposit ${formatUSD(amountUSD - balanceUSD)} more via the Deposit button.`;
        console.error('❌ ' + errorMessage);
        
        const errorResult = { 
          success: false, 
          error: errorMessage,
          isSpecificError: true // This will trigger the prominent pop-up
        };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, timeperiodId, priceMin, priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      console.log('✅ Balance check passed:', { balanceUSD, amountUSD });

      const graphStartTime = getGraphStartTime();
      const startTime = graphStartTime || timeperiodId; // Fallback to timeperiodId if graph start time not available
      
      console.log('📊 Start Time Details:');
      console.log('  - Graph start time:', graphStartTime ? `${graphStartTime} (${new Date(graphStartTime * 1000).toISOString()})` : 'Not available');
      console.log('  - Using start_time:', startTime, `(${new Date(startTime * 1000).toISOString()})`);
      console.log('  - Start time source:', graphStartTime ? 'Graph plotting start' : 'Timeperiod ID (fallback)');
      
      
      // The contract expects delegationExpiry as deadline, not session expiry
      // The nonce should be the current nonce from the contract (nonces[user])
      const orderData = {
        user: ethers.utils.getAddress(userAddress), // Ensure proper address format
        timeperiodId: ((timeperiodId - timeperiodId % 5)),
        priceMin: priceMin,
        priceMax: priceMax,
        amount: amount,
        //nonce: currentNonce, // This should match nonces[user] in the contract
        deadline: deadline ,// This should be delegationExpiry (session expiry)
        // start_time: timeperiodId.toString() // Current time as start_time
      };

      console.log('✅ Order data created:', {
        timeperiodId: timeperiodId,
        timeperiodIdType: typeof timeperiodId,
        timeperiodIdDate: new Date(timeperiodId * 1000).toISOString(),
        user: orderData.user,
        priceMin: priceMin,
        priceMinType: typeof priceMin,
        priceMax: priceMax,
        priceMaxType: typeof priceMax,
        amount: amount,
        amountType: typeof amount,
        //nonce: orderData.nonce,
        //nonceType: typeof orderData.nonce,
        nonceSource: session.nonce ? 'session.nonce' : 'default(1)',
        deadline: deadline,
        deadlineType: typeof deadline
      });
      
      console.log('📊 ORDER NONCE DETAILS:');
      //console.log('  - Nonce value:', orderData.nonce);
      //console.log('  - Nonce type:', typeof orderData.nonce);
      console.log('  - Nonce source: contract.getNonce() (current nonce)');
      console.log('  - Current nonce from contract:', currentNonce);
      console.log('  - This is correct for EIP-712 signing');
      console.log('  - Contract will increment nonce after verification');
      console.log('  - Session nonce (not used):', session.nonce);
      console.log('');

      // ========================================
      // STEP 4: Sign Order with Session Key
      // ========================================
      console.log('📍 STEP 4: Signing order with session key...');

      // Get current network chainId for EIP-712 domain
      const provider = new ethers.providers.Web3Provider(window.ethereum as any);
      const network = await provider.getNetwork();
      const currentChainId = network.chainId;
      
      // Update domain with current chainId
      const dynamicDomain = {
        name: "MercuryTrade",
        version: "1",
        chainId: currentChainId,
        verifyingContract: ethers.utils.getAddress(WRAPPER_CONTRACT_ADDRESS)
      };

      // Create wallet from session key private key
      const privateKey = session.sessionPrivateKey || session.sessionKeyPrivateKey;
      if (!privateKey) {
        const errorMessage = 'Session private key not found. Please create a new session.';
        const errorResult = { success: false, error: errorMessage, isSpecificError: true };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, timeperiodId, priceMin, priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      
      // Debug which property was used
      const keySource = session.sessionPrivateKey ? 'sessionPrivateKey' : 'sessionKeyPrivateKey';
      console.log('🔑 Using private key from:', keySource);
      console.log('🔑 Private key:', privateKey.slice(0, 10) + '...');
      console.log('🔑 Key source details:');
      console.log('  - session.sessionPrivateKey:', session.sessionPrivateKey ? 'present' : 'missing');
      console.log('  - session.sessionKeyPrivateKey:', session.sessionKeyPrivateKey ? 'present' : 'missing');
      // Create session key wallet and connect to provider
      const sessionKeyWallet = new ethers.Wallet(privateKey, provider);

      console.log('🔍 Session wallet details:');
      console.log('  - Address:', sessionKeyWallet.address);
      console.log('  - Expected session key:', session.sessionKey || session.sessionKeyAddress);
      
      // Check if session key addresses match
      const expectedSessionKey = session.sessionKey || session.sessionKeyAddress;
      if (sessionKeyWallet.address.toLowerCase() !== expectedSessionKey.toLowerCase()) {
        console.error('❌ Session key mismatch!');
        console.error('  - Wallet address:', sessionKeyWallet.address);
        console.error('  - Expected address:', expectedSessionKey);
        const errorMessage = 'Session key mismatch. Please create a new session.';
        const errorResult = { success: false, error: errorMessage, isSpecificError: true };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, timeperiodId, priceMin, priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      
      console.log('✅ Session key addresses match');

      // Debug EIP-712 domain
      console.log('🔍 EIP-712 Domain for order signing:');
      console.log('  - Domain:', JSON.stringify(dynamicDomain, null, 2));
      console.log('  - Types:', JSON.stringify(types, null, 2));
      console.log('  - Order Data:', JSON.stringify(orderData, null, 2));
      console.log('  - Current Chain ID:', currentChainId);
      
      // Validate domain parameters
      console.log('🔍 EIP-712 Domain Validation:');
      console.log('  - name:', dynamicDomain.name);
      console.log('  - version:', dynamicDomain.version);
      console.log('  - chainId:', dynamicDomain.chainId, '(type:', typeof dynamicDomain.chainId, ')');
      console.log('  - verifyingContract:', dynamicDomain.verifyingContract);
      console.log('  - verifyingContract length:', dynamicDomain.verifyingContract?.length);
      
      // Check if domain matches contract expectations
      console.log('🔍 CONTRACT COMPATIBILITY CHECK:');
      console.log('  - Expected contract address:', CONTRACTS.WRAPPER);
      console.log('  - Actual contract address:', dynamicDomain.verifyingContract);
      console.log('  - Address match:', dynamicDomain.verifyingContract === CONTRACTS.WRAPPER);
      console.log('  - Expected chainId:', CHAIN_ID);
      console.log('  - Actual chainId:', dynamicDomain.chainId);
      console.log('  - ChainId match:', dynamicDomain.chainId === CHAIN_ID);
      
      // Show exact parameters that will be sent to contract
      console.log('🔍 CONTRACT PARAMETERS PREVIEW:');
      console.log('  - user:', orderData.user);
      console.log('  - timeperiodId:', orderData.timeperiodId, '(type:', typeof orderData.timeperiodId, ')');
      console.log('  - priceMin:', orderData.priceMin, '(type:', typeof orderData.priceMin, ')');
      console.log('  - priceMax:', orderData.priceMax, '(type:', typeof orderData.priceMax, ')');
      console.log('  - amount:', orderData.amount, '(type:', typeof orderData.amount, ')');
      // console.log('  - nonce:', orderData.nonce, '(type:', typeof orderData.nonce, ')');
      console.log('  - deadline:', orderData.deadline, '(type:', typeof orderData.deadline, ')');
      console.log('  - User balance:', balance, `($${balanceUSD})`);
      console.log('  - Amount in USD:', amountUSD);
      console.log('  - Balance sufficient:', balanceUSD >= amountUSD);

      // Sign the order with EIP-712
      const orderSignature = await sessionKeyWallet._signTypedData(dynamicDomain, types, orderData);

      console.log('✅ Order signed!');
      console.log('   Signature:', orderSignature);
      console.log('   Signature length:', orderSignature.length);
      console.log('');

      // ========================================
      // STEP 5: Send to Server
      // ========================================
      console.log('📍 STEP 5: Sending bet to server...');
      
      // Get graph start time
      
      const requestBody = {
        user: session.user || session.userAddress,
        timeperiod_id: (timeperiodId - timeperiodId % 5).toString(),
        price_min: priceMin,
        price_max: priceMax,
        amount: amount,
        order_signature: orderSignature,
        nonce: currentNonce.toString(),
        deadline: deadline,
        start_time: (timeperiodId - (timeperiodId % 5)).toString()
      };

      console.log('📤 Request body being sent to server:');
      console.log(JSON.stringify(requestBody, null, 2));
      
      // Comprehensive parameter validation
      console.log('🔍 DETAILED PARAMETER ANALYSIS:');
      console.log('  📊 User Details:');
      console.log('    - user:', requestBody.user);
      console.log('    - user type:', typeof requestBody.user);
      console.log('    - user length:', requestBody.user?.length);
      
      console.log('  ⏰ Time Details:');
      console.log('    - timeperiod_id:', requestBody.timeperiod_id);
      console.log('    - timeperiod_id type:', typeof requestBody.timeperiod_id);
      console.log('    - timeperiod_id as date:', new Date(parseInt(requestBody.timeperiod_id) * 1000).toISOString());
      
      console.log('  💰 Price Details:');
      console.log('    - price_min:', requestBody.price_min);
      console.log('    - price_min type:', typeof requestBody.price_min);
      console.log('    - price_max:', requestBody.price_max);
      console.log('    - price_max type:', typeof requestBody.price_max);
      console.log('    - price_range:', parseInt(requestBody.price_max) - parseInt(requestBody.price_min));
      
      console.log('  💵 Amount Details:');
      console.log('    - amount:', requestBody.amount);
      console.log('    - amount type:', typeof requestBody.amount);
      console.log('    - amount as USD:', parseInt(requestBody.amount) / 1e6);
      
      console.log('  🔢 Nonce Details:');
      console.log('    - nonce:', requestBody.nonce);
      console.log('    - nonce type:', typeof requestBody.nonce);
      
      console.log('  ⏳ Deadline Details:');
      console.log('    - deadline:', requestBody.deadline);
      console.log('    - deadline type:', typeof requestBody.deadline);
      console.log('    - deadline as date:', new Date(parseInt(requestBody.deadline) * 1000).toISOString());
      
      console.log('  🔐 Signature Details:');
      console.log('    - order_signature length:', requestBody.order_signature?.length);
      console.log('    - order_signature starts with:', requestBody.order_signature?.slice(0, 10));

      const response = await fetch(`${SERVER_URL}/place-bet`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      let result;
      try {
        result = await response.json();
        console.log('📥 Server response:', result);
      } catch (jsonError) {
        console.error('❌ Failed to parse server response as JSON:', jsonError);
        console.log('📥 Raw response status:', response.status);
        console.log('📥 Raw response headers:', Object.fromEntries(response.headers.entries()));
        
        // Try to get response as text
        try {
          const responseText = await response.text();
          console.log('📥 Raw response text:', responseText);
        } catch (textError) {
          console.error('❌ Failed to get response as text:', textError);
        }
        
        const errorMessage = `Server error: ${response.status} ${response.statusText}. Please try again.`;
        const errorResult = { success: false, error: errorMessage, isSpecificError: false };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, timeperiodId, priceMin, priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      
      if (result.status !== 'ok') {
        console.error('❌ Server error details:', {
          error: result.error,
          status: result.status,
          response: result
        });
        
        // Decode and format specific contract errors for user-friendly pop-ups
        let errorMessage = result.error || 'Unknown error';
        let isSpecificError = false;
        
        // Check for insufficient balance error
        if (errorMessage.includes('0x8baa579f') || 
            errorMessage.toLowerCase().includes('insufficient balance') ||
            errorMessage.toLowerCase().includes('transfer failed')) {
          errorMessage = 'Insufficient wrapper balance! Please deposit more funds via the Deposit button before placing this bet.';
          isSpecificError = true;
        }
        // Check for profit cap exceeded error
        else if (errorMessage.toLowerCase().includes('profit cap exceeded') ||
                 errorMessage.toLowerCase().includes('max profit') ||
                 errorMessage.toLowerCase().includes('profit limit')) {
          errorMessage = 'Profit cap exceeded! This bet would exceed the maximum allowed profit. Please reduce your bet amount or choose a different price range.';
          isSpecificError = true;
        }
        // Check for session expired
        else if (errorMessage.toLowerCase().includes('session expired') ||
                 errorMessage.toLowerCase().includes('deadline passed')) {
          errorMessage = 'Session expired! Please create a new trading session to continue.';
          isSpecificError = true;
        }
        // Check for invalid signature
        else if (errorMessage.toLowerCase().includes('invalid signature') ||
                 errorMessage.toLowerCase().includes('signature mismatch')) {
          errorMessage = 'Invalid signature! Please create a new trading session and try again.';
          isSpecificError = true;
        }
        // Check for nonce issues
        else if (errorMessage.toLowerCase().includes('nonce') ||
                 errorMessage.toLowerCase().includes('replay')) {
          errorMessage = 'Transaction nonce error! Please refresh the page and try again.';
          isSpecificError = true;
        }
        // Generic execution reverted error
        else if (errorMessage.includes('execution reverted')) {
          errorMessage = 'Transaction failed! Please check your balance, session validity, and try again.';
          isSpecificError = true;
        }
        
        console.error('📋 Decoded error:', errorMessage);
        console.log('🎯 Is specific error (show pop-up):', isSpecificError);
        
        // 🔄 ROLLBACK: Decrement nonce since transaction failed
        rollbackNonce(orderData.user);
        
        const errorResult = { 
          success: false, 
          error: errorMessage,
          isSpecificError // Flag to indicate if this should show a prominent pop-up
        };
        setLastOrderResult(errorResult);
        dispatchErrorEvent(errorMessage, orderData.timeperiodId, orderData.priceMin, orderData.priceMax, amountUSD);
        setIsPlacingOrder(false);
        return errorResult;
      }
      console.log('');

      // ========================================
      // STEP 6: Update Trading Volume
      // ========================================
      if (result.status === 'ok') {
        console.log('🎉 BET PLACED SUCCESSFULLY!');
        console.log('   Transaction Hash:', result.tx_hash);
        
        // Update trading volume in users table
        try {
          console.log('💰 Updating trading volume...');
          const userAddress = orderData.user.toLowerCase();
          console.log('  - User address (lowercase):', userAddress);
          console.log('  - Bet amount (USD):', amountUSD);
          
          // First, try to get current volume using case-insensitive search
          const { data: existingUsers, error: fetchError } = await supabase
            .from('users')
            .select('trading_volume, wallet_address')
            .ilike('wallet_address', userAddress); // Case-insensitive match
          
          if (fetchError) {
            console.error('❌ Error fetching user:', fetchError);
          }
          
          // Find exact match (case-insensitive)
          const existingUser = existingUsers?.find(u => 
            u.wallet_address.toLowerCase() === userAddress
          );
          
          const currentVolume = existingUser?.trading_volume || 0;
          const newVolume = currentVolume + amountUSD;
          
          console.log('  - Current volume:', currentVolume);
          console.log('  - New volume:', newVolume);
          console.log('  - User exists?', !!existingUser);
          
          // Use RPC call or direct update with case-insensitive matching
          // First try to update existing user
          if (existingUser) {
            const { data: updateData, error: updateError, count } = await supabase
              .from('users')
              .update({
                trading_volume: newVolume
              })
              .eq('wallet_address', existingUser.wallet_address)
              .select(); // Select to verify update
            
            if (updateError) {
              console.error('❌ Error updating trading volume:', updateError);
              console.error('  - Error details:', JSON.stringify(updateError, null, 2));
              console.error('  - Error code:', updateError.code);
              console.error('  - Error message:', updateError.message);
            } else {
              // Verify the update actually happened
              if (updateData && updateData.length > 0) {
                const updatedVolume = updateData[0].trading_volume;
                console.log(`✅ Trading volume updated: $${currentVolume.toFixed(2)} → $${newVolume.toFixed(2)} (+$${amountUSD.toFixed(2)})`);
                console.log('  - Verified in response:', updatedVolume);
                
                // Double-check by fetching again
                const { data: verifyData, error: verifyError } = await supabase
                  .from('users')
                  .select('trading_volume')
                  .eq('wallet_address', existingUser.wallet_address)
                  .single();
                
                if (verifyData) {
                  console.log('  - Verified in DB:', verifyData.trading_volume);
                  if (Math.abs(verifyData.trading_volume - newVolume) > 0.01) {
                    console.warn('⚠️ WARNING: Volume mismatch! Update may have been blocked by RLS.');
                  }
                }
              } else {
                console.warn('⚠️ Update returned no data - may have been blocked by RLS');
              }
            }
          } else {
            // User doesn't exist, create new one
            console.log('  - Creating new user record...');
            const { data: insertData, error: insertError } = await supabase
              .from('users')
              .insert({
                wallet_address: userAddress,
                trading_volume: newVolume,
                xp: 0,
                referral: 0
              });
            
            if (insertError) {
              console.error('❌ Error creating user:', insertError);
              console.error('  - Error details:', JSON.stringify(insertError, null, 2));
              
              // If insert fails due to conflict, try update again
              if (insertError.code === '23505') { // Unique violation
                console.log('  - User already exists, trying update...');
                const { error: retryError } = await supabase
                  .from('users')
                  .update({
                    trading_volume: newVolume
                  })
                  .eq('wallet_address', userAddress);
                
                if (retryError) {
                  console.error('❌ Retry update also failed:', retryError);
                } else {
                  console.log(`✅ Trading volume updated (retry): $${newVolume.toFixed(2)}`);
                }
              }
            } else {
              console.log(`✅ New user created with trading volume: $${newVolume.toFixed(2)}`);
            }
          }
        } catch (volError: any) {
          console.error('❌ Error updating trading volume:', volError);
          console.error('  - Error message:', volError?.message);
          console.error('  - Error stack:', volError?.stack);
          // Don't fail the bet placement if volume update fails
        }
        
        // NOTE: Nonce is now incremented optimistically in getCurrentNonce()
        // No need to increment again here
        
        const successResult = { success: true, txHash: result.tx_hash };
        setLastOrderResult(successResult);
        // Dispatch a global event so other components (like the TradingChart) can
        // attach UI badges for this placed order immediately.
        try {
          if (typeof window !== 'undefined') {
            const detail = {
              timeperiodId: orderData.timeperiodId,
              // convert raw price back to USD for convenience
              priceMinUSD: rawToPrice(priceMin),
              priceMaxUSD: rawToPrice(priceMax),
              amountUSD: amountUSD
            };
            window.dispatchEvent(new CustomEvent('orderPlaced', { detail }));
            console.log('🚀 Dispatched orderPlaced event:', detail);
          }
        } catch (evErr) {
          console.warn('Could not dispatch orderPlaced event', evErr);
        }
        return successResult;
      } else {
        console.error('❌ Bet failed:', result.error);
        
        // 🔄 ROLLBACK: Decrement nonce since transaction failed
        rollbackNonce(orderData.user);
        
        const errorResult = { success: false, error: result.error };
        setLastOrderResult(errorResult);
        
        // Dispatch error event so TradingChart can deselect the failed cell
        try {
          if (typeof window !== 'undefined') {
            const detail = {
              timeperiodId: orderData.timeperiodId,
              priceMinUSD: rawToPrice(priceMin),
              priceMaxUSD: rawToPrice(priceMax),
              amountUSD: amountUSD,
              error: result.error
            };
            window.dispatchEvent(new CustomEvent('orderPlaced', { detail }));
            console.log('🚨 Dispatched orderPlaced error event:', detail);
          }
        } catch (evErr) {
          console.warn('Could not dispatch orderPlaced error event', evErr);
        }
        
        return errorResult;
      }

    } catch (error: any) {
      console.error('❌ Error placing bet:', error);
      
      // 🔄 ROLLBACK: Try to rollback nonce if we got far enough to have user address
      // Check which variables were initialized before the error
      try {
        const session = getStoredSession();
        if (session && (session.user || session.userAddress)) {
          const userAddress = session.user || session.userAddress;
          rollbackNonce(userAddress);
          console.log('🔄 Rolled back nonce after catch block error');
        }
      } catch (rollbackError) {
        console.warn('⚠️ Could not rollback nonce:', rollbackError);
      }
      
      // Format error message for specific cases
      let errorMessage = error.message || 'Unknown error occurred';
      let isSpecificError = error.isSpecificError || false; // Check if error was marked as specific
      
      // Check for specific error types that should show prominent pop-ups
      if (!isSpecificError) {
        if (errorMessage.toLowerCase().includes('insufficient balance') ||
            errorMessage.toLowerCase().includes('insufficient wrapper balance')) {
          isSpecificError = true;
        } else if (errorMessage.toLowerCase().includes('profit cap exceeded') ||
                   errorMessage.toLowerCase().includes('max profit') ||
                   errorMessage.toLowerCase().includes('profit limit')) {
          isSpecificError = true;
        } else if (errorMessage.toLowerCase().includes('session expired') ||
                   errorMessage.toLowerCase().includes('no session found')) {
          isSpecificError = true;
        }
      }
      
      const errorResult = { 
        success: false, 
        error: errorMessage,
        isSpecificError
      };
      setLastOrderResult(errorResult);
      
      // Dispatch error event for catch block errors too
      // Note: Some variables might not be initialized if error occurred early
      try {
        if (typeof window !== 'undefined') {
          // Try to construct detail with available data
          const detail: any = {
            error: error.message
          };
          
          // Only add these if they were initialized before the error
          if (typeof timeperiodId !== 'undefined') {
            detail.timeperiodId = timeperiodId;
          }
          if (typeof priceMin !== 'undefined' && typeof priceMax !== 'undefined') {
            detail.priceMinUSD = rawToPrice(priceMin);
            detail.priceMaxUSD = rawToPrice(priceMax);
          }
          if (typeof amountUSD !== 'undefined') {
            detail.amountUSD = amountUSD;
          }
          
          window.dispatchEvent(new CustomEvent('orderPlaced', { detail }));
          console.log('🚨 Dispatched orderPlaced exception event:', detail);
        }
      } catch (evErr) {
        console.warn('Could not dispatch orderPlaced exception event', evErr);
      }
      
      return errorResult;
    } finally {
      setIsPlacingOrder(false);
    }
  };

  /**
   * Place order from grid cell selection
   * @param timeOffset - Time offset in seconds from now
   * @param priceLevel - Price level in USD
   * @param amount - Amount to bet in USD (default: 10)
   */
  const placeOrderFromCell = async (
    timeOffset: number, 
    priceLevel: number, 
    amount: number = 1 // Increased from $10 to $50 for better contract compatibility
  ): Promise<OrderPlacementResult> => {
    console.log('🎯 placeOrderFromCell called:', { timeOffset, priceLevel, amount });
    
    // Check if session exists
    const session = getStoredSession();
    if (!session) {
      console.log('❌ No session found - showing prompt');
      return { success: false, error: 'No session found. Please create a session first.', isSessionError: true };
    }
    
    console.log('✅ Session found:', { 
      user: session.user || session.userAddress, 
      sessionKey: session.sessionKey || session.sessionKeyAddress,
      expiry: new Date(session.expiry * 1000).toISOString(),
      hasPrivateKey: !!(session.sessionPrivateKey || session.sessionKeyPrivateKey)
    });
    
    const timeperiod = Math.floor(Date.now() / 1000 + timeOffset);
    const priceMax = priceLevel;             
    const priceMin = priceLevel - PRICE_STEP;
    console.log('🎯 Order parameters:', {
      timeOffset,
      timeperiod,
      timeperiodId: timeperiod,
      timeperiodIdDate: new Date(timeperiod * 1000).toISOString(),
      currentTime: new Date().toISOString(),
      priceLevel: formatNumber(priceLevel, 8),
      priceStep: formatNumber(PRICE_STEP, 8),
      priceMin: formatNumber(priceMin, 8),
      priceMax: formatNumber(priceMax, 8),
      cellRange: `[${formatNumber(priceMin, 8)}, ${formatNumber(priceMax, 8)}]`,
      cellWidth: formatNumber(priceMax - priceMin, 8),
      amount
    });
    
    return placeBet({
      timeperiod,
      priceMin: priceMin,
      priceMax: priceMax,
      amount,
      orderNonce: Math.floor(Math.random() * 1000000)
    });
  };

  return {
    placeBet,
    placeOrderFromCell,
    isPlacingOrder,
    lastOrderResult,
    clearLastResult: () => setLastOrderResult(null)
  };
}
