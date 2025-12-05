import { getQuickMultiplier, getGridMultiplier } from '../lib/gridPredictions';
import {
  calculateDynamicB,
  calculatePricePerShare,
  calculateShares,
  getMultiplierValue,
  toUSDCFormat,
  toShareFormat
} from '../lib/contractMultiplier';

export interface CellBetInfo {
  multiplier: number;
  betAmount: number;
  payout: number;
  nextUserMultiplier?: number;
}

export interface CachedMultiplier {
  multiplier: number;
  timestamp: number;
  timeUntilStart: number;
  existingShares?: number;
  isOptimistic?: boolean;
}

/**
 * Get time-based bucket for cache key
 * Groups time into buckets to recalculate when crossing thresholds
 */
export const getTimeBucket = (timeUntilStart: number): string => {
  if (timeUntilStart <= 15) return 'bucket_0-15';
  if (timeUntilStart <= 25) return 'bucket_15-25';
  if (timeUntilStart <= 40) return 'bucket_25-40';
  return 'bucket_40+';
};

/**
 * Calculate multiplier and payout for a cell at time of bet
 * @param cellTime - Unix timestamp of the grid cell
 * @param priceLevel - Price level of the cell
 * @param priceDecimals - Number of decimal places
 * @param multiplierCache - Optional cache map for multipliers
 * @returns Cell bet information with multiplier, betAmount, and payout
 */
export const calculateCellBetInfo = (
  cellTime: number,
  priceLevel: number,
  priceDecimals: number = 2,
  multiplierCache?: Map<string, CachedMultiplier>
): CellBetInfo => {
  const timeperiodId = Math.floor(cellTime / 5) * 5; // 5-second grids
  const timeUntilStart = timeperiodId - Math.floor(Date.now() / 1000);
  const timeBucket = getTimeBucket(timeUntilStart);
  const cacheKey = `${timeperiodId}_${priceLevel.toFixed(priceDecimals)}_${timeBucket}`;
  
  // Use cached multiplier if available, otherwise get quick estimate
  const cached = multiplierCache?.get(cacheKey);
  const multiplier = cached ? cached.multiplier : getQuickMultiplier(timeperiodId);
  
  // Get bet amount from localStorage
  const savedAmount = typeof window !== 'undefined' ? localStorage.getItem('userAmount') : null;
  const betAmount = savedAmount ? parseFloat(savedAmount) :1.0;
  const payout = betAmount * multiplier;
  
  // DON'T calculate nextUserMultiplier here - wait for bet confirmation
  // This ensures 100% accuracy with real data from Supabase
  
  return { 
    multiplier, 
    betAmount, 
    payout, 
    nextUserMultiplier: undefined  // Will be calculated after confirmation
  };
};

/**
 * Calculate REAL next user multiplier after bet confirmation
 * Fetches actual total_share from Supabase and calculates with real data
 * 
 * @param timeperiodId - Unix timestamp of the grid
 * @param priceLevel - Price level of the cell
 * @param priceMin - Min price of grid (in 1e8 format)
 * @param priceMax - Max price of grid (in 1e8 format)
 * @param priceStep - Price step size
 * @returns Next user's multiplier with REAL data, or undefined if not available
 */
export const calculateRealNextUserMultiplier = async (
  timeperiodId: number,
  priceLevel: number,
  priceMin: number,
  priceMax: number,
  priceStep: number = 0.01
): Promise<number | undefined> => {
  try {
    console.log('🔴 [REAL Next User Multiplier] Fetching real data...');
    
    // Import betService to fetch total_share
    const { fetchTotalShare } = await import('./betService');
    
    // Fetch REAL total_share from Supabase
    const totalShareStr = await fetchTotalShare(timeperiodId, priceMin, priceMax);

    if (!totalShareStr) {
      console.log('⚠️  No total_share found yet');
      return undefined;
    }

    // Convert from USDC precision (1e6) to decimal
    const realTotalShares = parseFloat(totalShareStr) / 1e6;
    console.log(`✅ Real total_share (raw): ${totalShareStr}`);
    console.log(`✅ Real total_share (decimal): ${realTotalShares}`);

    // Get bet amount
    const savedAmount = typeof window !== 'undefined' ? localStorage.getItem('userAmount') : null;
    const betAmount = savedAmount ? parseFloat(savedAmount) : 1.0;

    // Calculate what NEXT user will see (with current real shares)
    // Convert decimal shares (0.4) back to 1e6 format (400000) before BigInt conversion
    const existingSharesBigInt = toShareFormat(realTotalShares);
    const betAmountUSDC = toUSDCFormat(betAmount);
    
    // ============================================
    // COMPREHENSIVE B DECAY & MULTIPLIER LOGGING
    // ============================================
    
    const currentTime = Math.floor(Date.now() / 1000);
    const timeUntilStart = timeperiodId - currentTime;
    const dynamicB = calculateDynamicB(timeperiodId);
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`⏰ Time until start: ${timeUntilStart} seconds (${Math.floor(timeUntilStart / 60)}:${(timeUntilStart % 60).toString().padStart(2, '0')})`);
    console.log(`🎚️  Dynamic B: ${(Number(dynamicB) / 1e6).toFixed(6)} USDC`);
    console.log(`   📉 B Progress: ${((10 - Number(dynamicB) / 1e6) / 8 * 100).toFixed(1)}% decayed (10 → ${(Number(dynamicB) / 1e6).toFixed(2)} → 2)`);
    
    // Show time-based pricing tier
    let timeTier = '';
    if (timeUntilStart > 40) timeTier = '>40 sec (0.2 base)';
    else if (timeUntilStart > 25) timeTier = '25-40 sec (0.35 base)';
    else if (timeUntilStart > 15) timeTier = '15-25 sec (0.5 base)';
    else timeTier = '<15 sec (0.66 base)';
    console.log(`📍 Time tier: ${timeTier}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    console.log(`🔢 Existing shares: ${realTotalShares.toFixed(4)} (${existingSharesBigInt.toString()} in 1e6)`);
    console.log(`💵 Bet amount: $${betAmount} (${betAmountUSDC.toString()} in 1e6)`);
    
    const { shares: nextUserShares } = calculateShares(
      existingSharesBigInt,
      betAmountUSDC,
      timeperiodId
    );
    
    console.log(`➕ Next user shares: ${(Number(nextUserShares) / 1e6).toFixed(4)} (${nextUserShares.toString()} in 1e6)`);
    
    const nextSharesTotal = existingSharesBigInt + nextUserShares;
    console.log(`📊 Total shares after bet: ${(Number(nextSharesTotal) / 1e6).toFixed(4)} (${nextSharesTotal.toString()} in 1e6)`);
    
    const nextPricePerShare = calculatePricePerShare(nextSharesTotal, timeperiodId);
    console.log(`💰 Next price per share: ${(Number(nextPricePerShare) / 1e18).toFixed(6)} ($${nextPricePerShare.toString()})`);
    
    // Break down the price calculation for debugging (FIXED: use existing shares, not total!)
    const shareAdjustment = (Number(existingSharesBigInt) * 1e18) / Number(dynamicB);
    const shareAdjustmentDecimal = shareAdjustment / 1e18;
    console.log(`🔧 Share adjustment: ${shareAdjustmentDecimal.toFixed(6)} (from ${realTotalShares.toFixed(4)} shares / ${(Number(dynamicB) / 1e6).toFixed(2)} B)`);
    
    // Calculate base price for next user
    const timeBasedPrice = timeUntilStart > 40 ? 0.2 : timeUntilStart > 25 ? 0.35 : timeUntilStart > 15 ? 0.5 : 0.66;
    const effectiveBase = Math.max(timeBasedPrice, 0.2);
    console.log(`📊 Price breakdown: base=${effectiveBase.toFixed(2)} + shareAdj=${shareAdjustmentDecimal.toFixed(4)} = ${(effectiveBase + shareAdjustmentDecimal).toFixed(4)}`);
    
    const nextUserMultiplier = getMultiplierValue(nextPricePerShare);

    console.log(`🔴 REAL Next User Multiplier: ${nextUserMultiplier.toFixed(2)}x`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    return nextUserMultiplier;
  } catch (error) {
    console.error('❌ Error calculating REAL next user multiplier:', error);
    return undefined;
  }
};

/**
 * Get cell multiplier - returns cached value or fetches from database
 * Note: This function requires cache management which should be handled by a hook
 * This is the pure calculation logic without cache management
 * 
 * @param timeperiodId - Unix timestamp of the grid
 * @param priceLevel - Center price of the cell
 * @param priceStep - Price step size
 * @param priceDecimals - Number of decimal places
 * @param isMounted - Function to check if component is mounted (optional)
 * @returns Multiplier value
 */
export const getCellMultiplier = async (
  timeperiodId: number,
  priceLevel: number,
  priceStep: number = 0.01,
  priceDecimals: number = 2,
  isMounted?: () => boolean
): Promise<number> => {
  // Check if component is still mounted before making request
  if (isMounted && !isMounted()) {
    // Component is unmounting, return quick estimate instead of fetching
    return getQuickMultiplier(timeperiodId);
  }
  
  try {
    // Double-check mounted status before making the request
    if (isMounted && !isMounted()) {
      return getQuickMultiplier(timeperiodId);
    }
    
    // Fetch real multiplier and existingShares from database
    const res = await getGridMultiplier(timeperiodId, priceLevel, priceStep);

    // Check mounted status again after async operation
    if (isMounted && !isMounted()) {
      return getQuickMultiplier(timeperiodId);
    }

    return res.multiplier;
  } catch (error) {
    // Only log if still mounted
    if (!isMounted || isMounted()) {
      console.debug('Error fetching multiplier, using quick estimate:', error);
    }
    return getQuickMultiplier(timeperiodId);
  }
};

/**
 * Get bet count for a grid cell
 * @param timeperiodId - Unix timestamp
 * @param priceLevel - Price level
 * @param priceStep - Price step size
 * @param priceDecimals - Number of decimal places
 * @param allUsersBets - Map of all users' bets (key: grid_id, value: array of bets)
 * @returns Number of bets in this grid
 */
export const getCellBetCount = (
  timeperiodId: number,
  priceLevel: number,
  priceStep: number,
  priceDecimals: number,
  allUsersBets: Map<string, any[]>
): number => {
  // Convert to grid_id format used in allUsersBetsRef
  const priceMin = priceLevel - priceStep;
  const priceMax = priceLevel;
  const gridId = `${timeperiodId}_${priceMin.toFixed(priceDecimals)}_${priceMax.toFixed(priceDecimals)}`;
  
  const bets = allUsersBets.get(gridId);
  return bets ? bets.length : 0;
};

/**
 * Quick multiplier estimate (re-exported for convenience)
 */
export { getQuickMultiplier };