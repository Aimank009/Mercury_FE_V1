// ========================================
// CONTRACT-ACCURATE MULTIPLIER CALCULATIONS
// Exact port from ChronoGridLib.sol
// ========================================

const PRECISION = BigInt(1e18);
const MAX_B = BigInt(10e6);         // 10 USDC (reduced for dramatic multiplier decay)
const MIN_B = BigInt(2e6);          // 2 USDC (reduced for dramatic multiplier decay)
const BASE_PRICE = BigInt(2e17);    // 0.2 (>40 sec)
const BASE_PRICE_1 = BigInt(35e16); // 0.35 (>25 && <=40 sec)
const BASE_PRICE_2 = BigInt(5e17);  // 0.5 (>15 && <=25 sec)
const BASE_PRICE_3 = BigInt(66e16); // 0.66 (<=15 sec)
const TIME_THRESHOLD = 5 * 60;      // 5 minutes = 300 seconds
const DECAY_RATE = 3;
const SHARE_REDEMPTION_VALUE = BigInt(1e6);

/**
 * Exponential decay approximation (Taylor series)
 * EXACT PORT from ChronoGridLib.sol exponentialDecay()
 * 
 * Calculates e^(-x) using Taylor series expansion:
 * e^(-x) ≈ 1 - x + x²/2 - x³/6 + x⁴/24 - x⁵/120
 */
function exponentialDecay(x: bigint): bigint {
  if (x === BigInt(0)) return PRECISION;
  if (x >= BigInt(5) * PRECISION) return BigInt(0);

  let result = PRECISION;
  
  // Term 1: -x
  let term = x;
  result = result > term ? result - term : BigInt(0);

  // Term 2: +x²/2
  term = (x * x) / (BigInt(2) * PRECISION);
  result = result + term;

  // Term 3: -x³/6
  term = (x * x * x) / (BigInt(6) * PRECISION * PRECISION);
  result = result > term ? result - term : BigInt(0);

  // Term 4: +x⁴/24
  term = (x * x * x * x) / (BigInt(24) * PRECISION * PRECISION * PRECISION);
  result = result + term;

  // Term 5: -x⁵/120
  term = (x * x * x * x * x) / (BigInt(120) * PRECISION * PRECISION * PRECISION * PRECISION);
  result = result > term ? result - term : BigInt(0);

  return result;
}

/**
 * Calculate current B parameter based on time until start
 * EXACT PORT from ChronoGridLib.sol _calculateCurrentB()
 * 
 * B decays from MAX_B to MIN_B over TIME_THRESHOLD using exponential decay
 * 
 * @param startTime - Unix timestamp when the grid starts (timeperiodId)
 * @returns Dynamic B value (in USDC with 1e6 precision)
 */
export function calculateDynamicB(startTime: number): bigint {
  const currentTime = Math.floor(Date.now() / 1000);
  const timeUntilStart = startTime > currentTime ? startTime - currentTime : 0;

  // If time until start >= threshold, return MAX_B
  if (timeUntilStart >= TIME_THRESHOLD) {
    return MAX_B;
  }

  // Calculate decay progress
  const progress = BigInt((TIME_THRESHOLD - timeUntilStart) * Number(PRECISION)) / BigInt(TIME_THRESHOLD);
  const progressSquared = (progress * progress) / PRECISION;
  const exponent = (BigInt(DECAY_RATE) * progressSquared) / PRECISION;
  const expValue = exponentialDecay(exponent);

  // Calculate dynamic B
  const range = MAX_B - MIN_B;
  const dynamicB = MIN_B + (range * expValue) / PRECISION;

  return dynamicB;
}

/**
 * Calculate price per share (multiplier)
 * NEW OPTIMIZED LOGIC with 0.2 base + dynamic B decay
 * 
 * Strategy:
 * 1. If existingShares = 0: Use time-based tiers (0.2, 0.35, 0.5, 0.66)
 * 2. If existingShares > 0: Use MAX(time-based, 0.2) + volume adjustment
 * 
 * This ensures:
 * - First user gets time urgency pricing
 * - Subsequent users get smooth decay (no multiplier increase bug)
 * - Dynamic B amplifies decay exponentially
 * 
 * @param existingShares - Total shares in the grid (from Supabase)
 * @param startTime - Unix timestamp when grid starts (timeperiodId)
 * @returns Price per share in 1e18 precision
 */
export function calculatePricePerShare(
  existingShares: bigint,
  startTime: number
): bigint {
  const currentB = calculateDynamicB(startTime);
  const currentTime = Math.floor(Date.now() / 1000);
  const timeUntilStart = startTime - currentTime;
  
  let basePrice: bigint;
  
  if (existingShares === BigInt(0)) {
    // First user: Time-based pricing only
    if (timeUntilStart > 40) {
      basePrice = BASE_PRICE;      // 0.2 → 5.0x
    } else if (timeUntilStart > 25) {
      basePrice = BASE_PRICE_1;    // 0.35 → 2.857x
    } else if (timeUntilStart > 15) {
      basePrice = BASE_PRICE_2;    // 0.5 → 2.0x
    } else {
      basePrice = BASE_PRICE_3;    // 0.66 → 1.515x
    }
    
    // First user pays ONLY base price (no share adjustment)
    return basePrice;
    
  } else {
    // Subsequent users: MAX(time-based, 0.2) + volume adjustment with dynamic B
    let timeBasedPrice: bigint;
    
    if (timeUntilStart > 40) {
      timeBasedPrice = BASE_PRICE;      // 0.2
    } else if (timeUntilStart > 25) {
      timeBasedPrice = BASE_PRICE_1;    // 0.35
    } else if (timeUntilStart > 15) {
      timeBasedPrice = BASE_PRICE_2;    // 0.5
    } else {
      timeBasedPrice = BASE_PRICE_3;    // 0.66
    }
    
    // Use MAX to prevent multiplier from going up
    basePrice = timeBasedPrice > BASE_PRICE ? timeBasedPrice : BASE_PRICE;
    
    // Add volume adjustment with DYNAMIC B decay
    let pricePerShare = basePrice + (existingShares * PRECISION) / currentB;
    
    // Cap at max price (1:1 redemption)
    const maxPrice = (SHARE_REDEMPTION_VALUE * PRECISION) / BigInt(1e6);
    if (pricePerShare > maxPrice) {
      pricePerShare = maxPrice;
    }
    
    return pricePerShare;
  }
}

/**
 * Calculate shares received for a given bet amount
 * 
 * @param existingShares - Total shares in the grid
 * @param amount - Bet amount in USDC (as bigint with 1e6 precision)
 * @param startTime - Unix timestamp when grid starts
 * @returns { shares, pricePerShare }
 */
export function calculateShares(
  existingShares: bigint,
  amount: bigint,
  startTime: number
): { shares: bigint; pricePerShare: bigint } {
  const pricePerShare = calculatePricePerShare(existingShares, startTime);
  const shares = (amount * PRECISION) / pricePerShare;
  
  return { shares, pricePerShare };
}

/**
 * Calculate multiplier from price per share
 * Multiplier = 1.0 / pricePerShare
 * 
 * @param pricePerShare - Price per share in 1e18 precision
 * @returns Multiplier as decimal number
 */
export function calculateMultiplier(pricePerShare: bigint): number {
  return Number(PRECISION) / Number(pricePerShare);
}

/**
 * Format multiplier for display (e.g., "5.00x")
 * 
 * @param pricePerShare - Price per share in 1e18 precision
 * @returns Formatted string like "5.00x"
 */
export function formatMultiplier(pricePerShare: bigint): string {
  const multiplier = calculateMultiplier(pricePerShare);
  return multiplier.toFixed(2) + 'x';
}

/**
 * Get multiplier as a number (for calculations)
 * 
 * @param pricePerShare - Price per share in 1e18 precision
 * @returns Multiplier value
 */
export function getMultiplierValue(pricePerShare: bigint): number {
  return calculateMultiplier(pricePerShare);
}

/**
 * Convert USDC dollars to contract format (1e6 precision)
 * 
 * @param dollars - Amount in dollars (e.g., 100.50)
 * @returns Amount in 1e6 format
 */
export function toUSDCFormat(dollars: number): bigint {
  return BigInt(Math.floor(dollars * 1e6));
}

/**
 * Convert from contract format (1e6) to dollars
 * 
 * @param amount - Amount in 1e6 format
 * @returns Amount in dollars
 */
export function fromUSDCFormat(amount: bigint): number {
  return Number(amount) / 1e6;
}

/**
 * Convert decimal shares to USDC format (1e6)
 * 
 * @param shares - Shares in decimal format (e.g., 0.4)
 * @returns Shares in 1e6 format (e.g., 400000n)
 */
export function toShareFormat(shares: number): bigint {
  // Round to avoid floating-point precision errors
  // This ensures clean conversion from decimal to 1e6 format
  return BigInt(Math.round(shares * 1e6));
}

/**
 * Convert price per share from string (database) to bigint
 * 
 * @param pricePerShareStr - Price per share from database as string
 * @returns Price per share as bigint
 */
export function parsePricePerShare(pricePerShareStr: string): bigint {
  return BigInt(pricePerShareStr);
}

/**
 * Get human-readable base price for current timeframe
 * Updated to match new MAX(time-based, 0.2) logic
 * 
 * @param existingShares - Total shares in grid
 * @param startTime - Unix timestamp when grid starts
 * @returns Base price as number
 */
export function getCurrentBasePrice(existingShares: bigint, startTime: number): number {
  const currentTime = Math.floor(Date.now() / 1000);
  const timeUntilStart = startTime - currentTime;
  
  // First user: pure time-based
  if (existingShares === BigInt(0)) {
    if (timeUntilStart > 40) {
      return 0.2;
    } else if (timeUntilStart > 25) {
      return 0.35;
    } else if (timeUntilStart > 15) {
      return 0.5;
    } else {
      return 0.66;
    }
  }
  
  // Subsequent users: MAX(time-based, 0.2)
  let timeBasedPrice: number;
  if (timeUntilStart > 40) {
    timeBasedPrice = 0.2;
  } else if (timeUntilStart > 25) {
    timeBasedPrice = 0.35;
  } else if (timeUntilStart > 15) {
    timeBasedPrice = 0.5;
  } else {
    timeBasedPrice = 0.66;
  }
  
  // Return MAX(time-based, 0.2)
  return Math.max(timeBasedPrice, 0.2);
}

/**
 * Debug function to show all calculation details
 * 
 * @param existingShares - Total shares in grid
 * @param startTime - Unix timestamp when grid starts
 * @returns Object with all calculation details
 */
export function getCalculationDetails(existingShares: bigint, startTime: number) {
  const currentTime = Math.floor(Date.now() / 1000);
  const timeUntilStart = startTime - currentTime;
  const dynamicB = calculateDynamicB(startTime);
  const basePrice = getCurrentBasePrice(existingShares, startTime);
  const pricePerShare = calculatePricePerShare(existingShares, startTime);
  const multiplier = getMultiplierValue(pricePerShare);
  
  return {
    currentTime,
    startTime,
    timeUntilStart,
    dynamicB: fromUSDCFormat(dynamicB),
    basePrice,
    existingShares: Number(existingShares),
    pricePerShare: Number(pricePerShare) / Number(PRECISION),
    multiplier,
    formattedMultiplier: formatMultiplier(pricePerShare)
  };
}

/**
 * Calculate multiplier from Supabase data
 * This is the main function to use with your database
 * 
 * @param sharesFromDB - shares_received from Supabase (string or number)
 * @param timeperiodId - timeperiod_id from Supabase (Unix timestamp)
 * @returns Formatted multiplier string
 */
export function getMultiplierFromDB(
  sharesFromDB: string | number,
  timeperiodId: number
): string {
  const shares = typeof sharesFromDB === 'string' ? BigInt(sharesFromDB) : BigInt(sharesFromDB);
  const pricePerShare = calculatePricePerShare(shares, timeperiodId);
  return formatMultiplier(pricePerShare);
}

/**
 * Calculate real-time multiplier for a grid
 * Fetches current shares and calculates based on current time
 * 
 * @param existingSharesStr - Total shares as string from DB
 * @param timeperiodId - Grid start time
 * @returns Multiplier information
 */
export function getRealtimeMultiplier(
  existingSharesStr: string,
  timeperiodId: number
): {
  multiplier: number;
  formattedMultiplier: string;
  pricePerShare: number;
  timeUntilStart: number;
} {
  const existingShares = BigInt(existingSharesStr || '0');
  const pricePerShare = calculatePricePerShare(existingShares, timeperiodId);
  const multiplier = getMultiplierValue(pricePerShare);
  const currentTime = Math.floor(Date.now() / 1000);
  const timeUntilStart = timeperiodId - currentTime;
  
  return {
    multiplier,
    formattedMultiplier: formatMultiplier(pricePerShare),
    pricePerShare: Number(pricePerShare) / Number(PRECISION),
    timeUntilStart
  };
}

