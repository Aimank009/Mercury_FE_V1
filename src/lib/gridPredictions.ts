// ========================================
// GRID PREDICTION CALCULATIONS
// ========================================
// This file contains all calculations for showing predictable results
// when hovering over grid cells in the trading chart.

import { supabase } from './supabaseClient';
import { TABLES, API_URLS, STORAGE_KEYS } from '../config';

const SERVER_URL = API_URLS.RELAYER;

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface GridPrediction {
  // Input values
  betAmount: number;
  existingShares: number;
  timeperiodId: number;
  timeperiodDate: string;
  priceLevel: number;
  
  // Calculated values
  currentPrice: number;
  sharesReceived: number;
  redemptionValue: number;
  potentialPayout: number;
  multiplier: number;
  simplifiedMultiplier: number;
  profit: number;
  
  // Time-related
  liquidityParameter: number;
  hoursUntilStart: number;
  minutesUntilStart: number;
  secondsUntilStart: number;
  
  // Metadata
  isValid: boolean;
  gridId: string | null;
  assumptions: {
    estimatedOtherGridsBets: number;
    estimatedTotalShares: number;
    totalWinningShares: number;
  };
}

export interface GridStatistics {
  existingShares: number;
  otherGridsBets: number;
  estimatedTotalShares: number;
  gridId: string | null;
}

// ========================================
// CONFIGURATION CONSTANTS
// ========================================

const BASE_PRICE = 0.2; // Starting price (P₀) in dollars
const REDEMPTION_VALUE = 1.0; // R = $1 per share
const BASE_B = 10000; // Base liquidity parameter
const MIN_B = 1000; // Minimum b (close to start time)
const MAX_B = 50000; // Maximum b (far future)

// ========================================
// CORE CALCULATION FUNCTIONS
// ========================================


/**
 * Calculate current price based on existing shares and liquidity parameter
 * 
 * Formula: P = P₀ + (S / b)
 * Where:
 *   P = Current price per share
 *   P₀ = Base price (0.2)
 *   S = Existing shares in the grid
 *   b = Dynamic liquidity parameter
 * 
 * @param existingShares - Current shares in the grid
 * @param liquidityParameter - The b value (calculated based on time)
 * @param basePrice - Starting price (default 0.2)
 * @returns Current price in USD
 */
export function calculateCurrentPrice(
  existingShares: number,
  liquidityParameter: number,
  basePrice: number = BASE_PRICE
): number {
  return basePrice + (existingShares / liquidityParameter);
}

/**
 * Calculate shares user will receive for their bet
 * 
 * Formula: N = A / P
 * Where:
 *   N = Number of shares
 *   A = Bet amount (USD)
 *   P = Current price
 * 
 * @param betAmount - Amount user wants to bet (USD)
 * @param currentPrice - Current price per share
 * @returns Number of shares user will receive
 */
export function calculateSharesReceived(
  betAmount: number,
  currentPrice: number
): number {
  return betAmount / currentPrice;
}

/**
 * Calculate potential payout if user wins
 * 
 * Formula: V = N × R
 * Where:
 *   V = Payout value
 *   N = Number of shares
 *   R = Redemption value per share ($1)
 * 
 * @param sharesReceived - Number of shares user has
 * @param redemptionValue - Redemption value per share (default $1)
 * @returns Potential payout in USD
 */
export function calculatePotentialPayout(
  sharesReceived: number,
  redemptionValue: number = REDEMPTION_VALUE
): number {
  return sharesReceived * redemptionValue;
}

/**
 * Calculate profit multiplier
 * 
 * Simplified Formula: M = R / P = R / (P₀ + S/b)
 * Where:
 *   M = Multiplier
 *   R = Redemption value per share ($1)
 *   P = Current price per share
 *   A = Bet amount
 * 
 * Full calculation: M = (N × R) / A = (A/P × R) / A = R / P
 * 
 * @param potentialPayout - Potential payout in USD
 * @param betAmount - Original bet amount in USD
 * @returns Profit multiplier (e.g., 2.5x)
 */
export function calculateMultiplier(
  potentialPayout: number,
  betAmount: number
): number {
  return potentialPayout / betAmount;
}

/**
 * Simplified multiplier calculation (direct formula)
 * 
 * Formula: M = R / P = R / (P₀ + S/b)
 * Where:
 *   R = Redemption value ($1)
 *   P = Current price
 * 
 * @param currentPrice - Current price per share
 * @param redemptionValue - Redemption value per share (default $1)
 * @returns Simplified multiplier estimate
 */
export function calculateSimplifiedMultiplier(
  currentPrice: number, 
  redemptionValue: number = REDEMPTION_VALUE
): number {
  return redemptionValue / currentPrice;
}

// ========================================
// COMPLETE PREDICTION CALCULATION
// ========================================

// Cache for grid lookups to improve performance
const gridCache = new Map<string, { gridId: string; priceMin: string; priceMax: string; shares: number; timestamp: number }>();
const CACHE_TTL = 60000; // 60 seconds cache (increased to reduce API calls)

// Pending requests map to prevent duplicate queries
const pendingRequests = new Map<string, Promise<{ gridId: string; shares: number } | null>>();

// Rate limiting - max concurrent requests
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 3;
const requestQueue: Array<() => void> = [];

async function waitForSlot(): Promise<void> {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return;
  }
  
  return new Promise((resolve) => {
    requestQueue.push(() => {
      activeRequests++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeRequests--;
  const next = requestQueue.shift();
  if (next) next();
}

/**
 * Calculate price range (min/max) for a grid cell
 * Each grid cell represents a price range based on priceStep
 * 
 * @param priceLevel - Center price of the cell (e.g., 38.12)
 * @param priceStep - Price step size (e.g., 0.01)
 * @returns { priceMin, priceMax } in cents × 10^8 format
 */
function calculatePriceRange(priceLevel: number, priceStep: number): { priceMin: string; priceMax: string } {
  // Grid cell covers from (priceLevel - priceStep/2) to (priceLevel + priceStep/2)
  const minPrice = priceLevel - (priceStep / 2);
  const maxPrice = priceLevel + (priceStep / 2);
  
  // Convert to cents × 10^8 (database format)
  const priceMinCents = Math.round(minPrice * 1e8).toString();
  const priceMaxCents = Math.round(maxPrice * 1e8).toString();
  
  return { priceMin: priceMinCents, priceMax: priceMaxCents };
}

/**
 * Fetch grid_id and existing shares in one optimized query
 * Step 1: Find grid_id from grid_created using timeperiod_id and price range
 * Step 2: Sum shares_received from bet_placed_with_session for that grid
 * 
 * @param timeperiodId - Unix timestamp of the grid (string)
 * @param priceMin - Minimum price of the grid (in cents × 10^8)
 * @param priceMax - Maximum price of the grid (in cents × 10^8)
 * @returns { gridId, shares } or null if not found
 */
async function fetchGridAndShares(
  timeperiodId: string, 
  priceMin: string, 
  priceMax: string
): Promise<{ gridId: string; shares: number } | null> {
  try {
    const cacheKey = `${timeperiodId}_${priceMin}_${priceMax}`;
    
    // Check cache first
    const cached = gridCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      return { gridId: cached.gridId, shares: cached.shares };
    }
    
    // Check if request is already pending (prevent duplicate queries)
    const pending = pendingRequests.get(cacheKey);
    if (pending) {
      return await pending;
    }
    
    // Create new request promise with rate limiting
    const requestPromise = (async () => {
      await waitForSlot(); // Rate limit
      try {
        // Step 1: Find grid_id from grid_created table
        const { data: gridData, error: gridError } = await supabase
          .from(TABLES.GRID_CREATED)
          .select('grid_id')
          .eq('timeperiod_id', timeperiodId)
          .eq('price_min', priceMin)
          .eq('price_max', priceMax)
          .limit(1)
          .maybeSingle();

        if (gridError) {
          // Don't spam console with connection errors
          if (!gridError.message?.includes('ERR_CONNECTION') && !gridError.message?.includes('Failed to fetch')) {
            console.error('❌ Error finding grid:', gridError);
          }
          return null;
        }

        if (!gridData) {
          return null;
        }

        const gridId = gridData.grid_id;
        
        // Step 2: Fetch total_share from bet_placed table
        // This table stores cumulative shares for each grid (updated on each bet)
        const { data: betPlacedData, error: betPlacedError } = await supabase
          .from('bet_placed')
          .select('total_share')
          .eq('timeperiod_id', timeperiodId)
          .eq('price_min', priceMin)
          .eq('price_max', priceMax)
          .maybeSingle();

        let totalShares = 0;
        if (!betPlacedError && betPlacedData && betPlacedData.total_share) {
          // total_share is stored as string in USDC format (1e6 precision)
          // Convert to actual share count
          const totalShareRaw = betPlacedData.total_share;
          totalShares = parseFloat(totalShareRaw as string) / 1e6;
        }
        
        const result = { gridId, shares: totalShares };
        gridCache.set(cacheKey, { ...result, priceMin, priceMax, timestamp: Date.now() });
        
        return result;
      } finally {
        releaseSlot(); // Release rate limit slot
        // Remove from pending requests
        pendingRequests.delete(cacheKey);
      }
    })();
    
    // Store pending request
    pendingRequests.set(cacheKey, requestPromise);
    
    return await requestPromise;
  } catch (err) {
    // Don't spam console with connection errors
    const errMsg = err instanceof Error ? err.message : String(err);
    if (!errMsg.includes('ERR_CONNECTION') && !errMsg.includes('Failed to fetch')) {
      console.error('❌ Exception fetching grid and shares:', err);
    }
    return null;
  }
}

/**
 * Calculate complete bet prediction with all metrics
 * This is the main function to use for hover tooltips
 * 
 * Uses the simplified formula:
 * M = R / P = R / (P₀ + S/b)
 * 
 * Where:
 * - A = Amount user wants to bet (dollars)
 * - S = Existing shares already in this grid (fetched from database)
 * - P₀ = Base price (0.2, 0.35, 0.5, or 0.66 based on conditions)
 * - b = Liquidity parameter (calculated from time until start)
 * - R = Redemption value per share ($1)
 * 
 * Step 1: Calculate current price: P = P₀ + (S / b)
 * Step 2: Calculate shares user will get: N = A / P
 * Step 3: Calculate redemption if user wins: V = N × R
 * Step 4: Calculate profit multiplier: M = V / A = R / P
 * 
 * @param betAmount - Amount user wants to bet (USD)
 * @param existingShares - Current shares in the grid (from database or 0)
 * @param timeUntilStart - Seconds until grid starts
 * @param basePrice - Starting price (default 0.2)
 * @param gridId - Grid ID if found, null otherwise
 * @returns Complete prediction with all metrics
 */
export function calculateBetPrediction(
  betAmount: number,
  existingShares: number,
  timeUntilStart: number,
  basePrice: number = BASE_PRICE,
  gridId: string | null = null
): Omit<GridPrediction, 'timeperiodId' | 'timeperiodDate' | 'priceLevel' | 'isValid'> {
  // Determine base price based on time and shares
  let effectiveBasePrice = 0;
  if (existingShares === 0) {
    if (timeUntilStart <= 15) {
      effectiveBasePrice = 0.66;
    } else if (timeUntilStart > 15 && timeUntilStart <= 25) {
      effectiveBasePrice = 0.5;
    } else if (timeUntilStart > 25 && timeUntilStart <= 40) {
      effectiveBasePrice = 0.35;
    } else {
      effectiveBasePrice = 0.2;
    }
  } else {
    effectiveBasePrice = 0.2;
  }
  
  // Step 1: Calculate current price (b logic removed, use BASE_B)
  const liquidityParameter = BASE_B;
  const currentPrice = calculateCurrentPrice(existingShares, liquidityParameter, effectiveBasePrice);
  const sharesReceived = calculateSharesReceived(betAmount, currentPrice);
  const redemptionValue = REDEMPTION_VALUE;
  const potentialPayout = calculatePotentialPayout(sharesReceived, redemptionValue);
  const multiplier = calculateMultiplier(potentialPayout, betAmount);
  const simplifiedMultiplier = calculateSimplifiedMultiplier(currentPrice, redemptionValue);
  const profit = potentialPayout - betAmount;
  const hoursUntilStart = timeUntilStart / 3600;
  const minutesUntilStart = timeUntilStart / 60;
  const secondsUntilStart = timeUntilStart;
  return {
    betAmount,
    existingShares,
    currentPrice,
    sharesReceived,
    redemptionValue,
    potentialPayout,
    multiplier,
    simplifiedMultiplier,
    profit,
    liquidityParameter,
    hoursUntilStart,
    minutesUntilStart,
    secondsUntilStart,
    gridId,
    assumptions: {
      estimatedOtherGridsBets: 0,
      estimatedTotalShares: 0,
      totalWinningShares: existingShares + sharesReceived
    }
  };
}

// ========================================
// SERVER COMMUNICATION (DEPRECATED - Now using direct Supabase queries)
// ========================================

/**
 * Get default grid statistics when no grid is found
 * @returns Default statistics with S = 0
 */
function getDefaultGridStatistics(): GridStatistics {
  return {
    existingShares: 0,
    otherGridsBets: 0,
    estimatedTotalShares: 0,
    gridId: null
  };
}

// ========================================
// MAIN PREDICTION FUNCTION FOR HOVER
// ========================================

/**
 * Get complete hover prediction for a grid cell
 * This is the main function to call when user hovers over a grid cell
 * 
 * REAL-TIME FLOW:
 * 1. Get mouse pointer coordinates
 * 2. Calculate price_min and price_max for that grid cell
 * 3. Query grid_created to find grid_id
 * 4. Query bet_placed_with_session to sum shares
 * 5. Calculate multiplier using M = R / (P₀ + S/b)
 * 
 * Uses the user's bet amount from AmountModal (stored in localStorage)
 * Returns immediately with S=0 if grid not found (smooth UX)
 * 
 * @param timeperiodId - Unix timestamp of the grid
 * @param priceLevel - Center price of the hovered cell (in dollars)
 * @param priceStep - Price step size (default 0.01)
 * @param betAmount - Amount to bet (from AmountModal or default)
 * @returns Complete prediction or null if invalid
 */
export async function getGridPrediction(
  timeperiodId: number,
  priceLevel: number,
  priceStep: number = 0.01,
  betAmount?: number
): Promise<GridPrediction | null> {
  try {
    // Get bet amount from localStorage (set by AmountModal) or use parameter
    const savedAmount = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.USER_AMOUNT) : null;
    const amount = betAmount || (savedAmount ? parseFloat(savedAmount) : 0.2);
    
    // Ensure minimum bet amount
    const finalAmount = Math.max(amount, 0.2);

    // Calculate time until grid starts
    const currentTime = Math.floor(Date.now() / 1000);
    const timeUntilStart = timeperiodId - currentTime;

    // Validate timeperiod
    if (timeUntilStart <= 0) {
      return null;
    }

    // Calculate price range from mouse position
    const { priceMin, priceMax } = calculatePriceRange(priceLevel, priceStep);

    // Fetch grid_id and shares in one optimized query
    const result = await fetchGridAndShares(
      timeperiodId.toString(),
      priceMin,
      priceMax
    );
    
    let existingShares = 0;
    let gridId: string | null = null;
    
    if (result) {
      gridId = result.gridId;
      existingShares = result.shares;
    } else {
      existingShares = 0;
    }

    // Calculate prediction using simplified formula
    const prediction = calculateBetPrediction(
      finalAmount,
      existingShares,
      timeUntilStart,
      BASE_PRICE,
      gridId
    );

    // Return complete prediction with metadata
    return {
      ...prediction,
      timeperiodId,
      timeperiodDate: new Date(timeperiodId * 1000).toISOString(),
      priceLevel,
      isValid: true
    };

  } catch (error) {
    console.error('❌ Failed to get hover prediction:', error);
    return null;
  }
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Format prediction for display in tooltip
 * @param prediction - The grid prediction
 * @returns Formatted strings for display
 */
export function formatPrediction(prediction: GridPrediction) {
  return {
    betAmount: `$${prediction.betAmount.toFixed(2)}`,
    currentPrice: `$${prediction.currentPrice.toFixed(4)}`,
    sharesReceived: prediction.sharesReceived.toFixed(2),
    potentialPayout: `$${prediction.potentialPayout.toFixed(2)}`,
    multiplier: `${prediction.multiplier.toFixed(2)}x`,
    simplifiedMultiplier: `${prediction.simplifiedMultiplier.toFixed(2)}x`,
    profit: `${prediction.profit >= 0 ? '+' : ''}$${prediction.profit.toFixed(2)}`,
    redemptionValue: `$${prediction.redemptionValue.toFixed(4)}`,
    timeUntilStart: `${prediction.minutesUntilStart.toFixed(1)} min`,
    liquidityParameter: prediction.liquidityParameter.toFixed(0)
  };
}

/**
 * Check if a prediction shows positive profit
 * @param prediction - The grid prediction
 * @returns True if profit is positive
 */
export function isProfitable(prediction: GridPrediction): boolean {
  return prediction.profit > 0;
}

/**
 * Get color based on profit
 * @param prediction - The grid prediction
 * @returns Color string for UI
 */
export function getProfitColor(prediction: GridPrediction): string {
  return prediction.profit > 0 ? '#00ff24' : '#ff3333';
}

/**
 * Calculate quick prediction for canvas hover (synchronous, no database call)
 * Uses S = 0 (no existing shares) for immediate display
 * Use this for fast canvas rendering, then fetch real data with getGridPrediction
 * 
 * @param timeperiodId - Unix timestamp of the grid
 * @param priceLevel - Price level being hovered
 * @param betAmount - Amount to bet (optional)
 * @returns Quick prediction with multiplier and profit
 */
export function calculateQuickPrediction(
  timeperiodId: number,
  priceLevel: number,
  betAmount?: number
): { multiplier: number; profit: number; payout: number } | null {
  try {
    // Get bet amount from localStorage (set by AmountModal) or use parameter/default
    const savedAmount = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEYS.USER_AMOUNT) : null;
    const amount = betAmount || (savedAmount ? parseFloat(savedAmount) : 0.2);
    const finalAmount = Math.max(amount, 0.2);

    // Calculate time until grid starts
    const currentTime = Math.floor(Date.now() / 1000);
    const timeUntilStart = timeperiodId - currentTime;
    
    // Validate timeperiod
    if (timeUntilStart <= 0) {
      return null;
    }

    // Use S = 0 for quick calculation (conservative estimate, no database call)
    const existingShares = 0;

    // Determine base price based on time and shares
    let effectiveBasePrice = 0;
    if (existingShares === 0) {
      if (timeUntilStart <= 15) {
        effectiveBasePrice = 0.66;
      } else if (timeUntilStart > 15 && timeUntilStart <= 25) {
        effectiveBasePrice = 0.5;
      } else if (timeUntilStart > 25 && timeUntilStart <= 40) {
        effectiveBasePrice = 0.35;
      } else {
        effectiveBasePrice = 0.2;
      }
    } else {
      effectiveBasePrice = 0.2;
    }

    // Calculate using simplified multiplier formula: M = R / P
  const liquidityParameter = BASE_B;
  const currentPrice = calculateCurrentPrice(existingShares, liquidityParameter, effectiveBasePrice);
    const simplifiedMultiplier = calculateSimplifiedMultiplier(currentPrice, REDEMPTION_VALUE);
    
    // Calculate payout and profit
    const payout = finalAmount * simplifiedMultiplier;
    const profit = payout - finalAmount;

    return {
      multiplier: simplifiedMultiplier,
      profit: profit,
      payout: payout
    };
  } catch (error) {
    console.error('Failed to calculate quick prediction:', error);
    return null;
  }
}

// ========================================
// PRE-FETCHING FOR PERFORMANCE
// ========================================

/**
 * Pre-fetch grid data for nearby cells to improve hover performance
 * This runs in the background and populates the cache
 * 
 * @param timeperiodId - Unix timestamp of the grid
 * @param priceLevel - Center price of the current cell
 * @param priceStep - Price step size (default 0.01)
 * @param count - Number of nearby grids to pre-fetch (default 3 above and below)
 */
export function prefetchNearbyGrids(
  timeperiodId: number,
  priceLevel: number,
  priceStep: number = 0.01,
  count: number = 3
): void {
  // Pre-fetch in background (don't await)
  void (async () => {
    try {
      const promises: Promise<any>[] = [];
      
      // Pre-fetch grids above and below current price
      for (let i = -count; i <= count; i++) {
        if (i === 0) continue; // Skip current cell (already fetching)
        
        const nearbyPrice = priceLevel + (i * priceStep);
        const { priceMin, priceMax } = calculatePriceRange(nearbyPrice, priceStep);
        
        // Start fetch without awaiting (fires and forgets, will cache result)
        promises.push(
          fetchGridAndShares(
            timeperiodId.toString(),
            priceMin,
            priceMax
          ).catch(err => {
            console.debug('Pre-fetch failed for nearby grid:', nearbyPrice, err);
            return null;
          })
        );
      }
      
      // Wait for all pre-fetches (optional, for debugging)
      await Promise.all(promises);
      console.log(`✅ Pre-fetched ${count * 2} nearby grids`);
    } catch (error) {
      console.debug('Pre-fetch error (non-critical):', error);
    }
  })();
}

// ========================================
// DYNAMIC MULTIPLIER CALCULATION FOR GRIDS
// ========================================

/**
 * Calculate dynamic multiplier for a grid cell
 * Formula: Multiplier = 1 / CurrentPrice
 * Where: CurrentPrice = base_price + S/b
 * 
 * @param timeperiodId - Unix timestamp of the grid
 * @param priceLevel - Center price of the cell
 * @param priceStep - Price step size (default 0.01)
 * @returns Multiplier value (e.g., 5.0 means 5x payout)
 */
export async function getGridMultiplier(
  timeperiodId: number,
  priceLevel: number,
  priceStep: number = 0.01
): Promise<{ multiplier: number; existingShares: number }> {
  try {
    // Calculate time until grid starts
    const now = Math.floor(Date.now() / 1000);
    const timeUntilStart = timeperiodId - now;
    
    // Calculate dynamic b (liquidity parameter)
  const b = BASE_B;
    
    // Calculate price range for this grid cell
    const { priceMin, priceMax } = calculatePriceRange(priceLevel, priceStep);
    
    // Fetch existing shares (S) from database
    const result = await fetchGridAndShares(
      timeperiodId.toString(),
      priceMin,
      priceMax
    );
    
    const existingShares = result ? result.shares : 0;
    
    // Determine base price based on time and shares
    let effectiveBasePrice = 0;
    if (existingShares === 0) {
      if (timeUntilStart <= 15) {
        effectiveBasePrice = 0.66;
      } else if (timeUntilStart > 15 && timeUntilStart <= 25) {
        effectiveBasePrice = 0.5;
      } else if (timeUntilStart > 25 && timeUntilStart <= 40) {
        effectiveBasePrice = 0.35;
      } else {
        effectiveBasePrice = 0.2;
      }
    } else {
      effectiveBasePrice = 0.2;
    }
    
    // Calculate current price: P = base_price + S/b
    const currentPrice = effectiveBasePrice + (existingShares / b);
    
    // Calculate multiplier: M = 1 / P
    const multiplier = 1 / currentPrice;
    
    return { multiplier, existingShares };
  } catch (error) {
    console.error('Error calculating grid multiplier:', error);
    // Return default multiplier if error (assuming S=0, time > 40s)
    return { multiplier: 1 / BASE_PRICE, existingShares: 0 };
  }
}

/**
 * Calculate multiplier synchronously (quick estimation without database query)
 * Uses S=0 assumption for instant display
 * 
 * @param timeperiodId - Unix timestamp of the grid
 * @returns Quick multiplier estimate
 */
export function getQuickMultiplier(timeperiodId: number): number {
  try {
    const now = Math.floor(Date.now() / 1000);
    const timeUntilStart = timeperiodId - now;
  const b = BASE_B;
    
    // Assume S=0 for quick calculation
    const existingShares = 0;
    
    // Determine base price based on time and shares
    let effectiveBasePrice = 0;
    if (existingShares === 0) {
      if (timeUntilStart <= 15) {
        effectiveBasePrice = 0.66;
      } else if (timeUntilStart > 15 && timeUntilStart <= 25) {
        effectiveBasePrice = 0.5;
      } else if (timeUntilStart > 25 && timeUntilStart <= 40) {
        effectiveBasePrice = 0.35;
      } else {
        effectiveBasePrice = 0.2;
      }
    } else {
      effectiveBasePrice = 0.2;
    }
    
    const currentPrice = effectiveBasePrice + (0 / b);
    const multiplier = 1 / currentPrice;
    
    return multiplier;
  } catch (error) {
    return 1 / BASE_PRICE; // 5.0x default
  }
}
