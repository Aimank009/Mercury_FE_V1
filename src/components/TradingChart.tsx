'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useAccount } from 'wagmi';
import { usePriceFeed } from '../contexts/PriceFeedContext';
import { calculateQuickPrediction, getGridMultiplier, getQuickMultiplier } from '../lib/gridPredictions';
import { 
  calculateDynamicB, 
  calculatePricePerShare, 
  calculateShares,
  getMultiplierValue,
  toUSDCFormat,
  toShareFormat
} from '../lib/contractMultiplier';
import { useSoundEffects } from '../hooks/useSoundEffects';
import { useAllUsersBetsQuery } from '../hooks/useAllUsersBetsQuery';
import { UserBet } from '../hooks/useRealtimeBets';
import { useSettlementsWebSocket } from '../hooks/useSettlementsWebSocket';
import { supabase } from '../lib/supabaseClient';
import { PRICE_STEP, PRICE_DECIMALS, GRID_CONFIG, CHART_CONFIG, CHART_COLORS } from '../config';
import styles from './TradingChart.module.css';

const OTHER_USER_SETTLEMENT_TTL = 30_000; // milliseconds to keep other users' win/loss highlights visible

interface DataPoint {
  t: number; // Time in seconds
  v: number; // Price value
}

interface TradingChartProps {
    basePrice?: number;
  onCellSelect?: (timeOffset: number, priceLevel: number, cellKey: string) => Promise<{success: boolean; orderId?: string; error?: string}>;
  onMultipleSelectionChange?: (selections: Array<{ t: number; priceLevel: number }>) => void;
  onOrderPlaced?: (cells: Array<{ t: number; priceLevel: number; dragSessionId?: string }>) => void;
  priceStep?: number; // Price step for Y-axis labels (default: 0.1)
  priceDecimals?: number; // Number of decimal places to show (default: 1)
  isPlacingOrder?: boolean; // Whether an order is currently being placed
  onScrollStateChange?: (isScrolled: boolean) => void; // Callback when scroll state changes
  recenterTrigger?: number; // Increment this to trigger recenter from parent
}

export default function TradingChart({ 
  basePrice: initialBasePrice, 
  onCellSelect, 
  onMultipleSelectionChange,
  onOrderPlaced,
  priceStep = PRICE_STEP, 
  priceDecimals = PRICE_DECIMALS,
  isPlacingOrder = false,
  onScrollStateChange,
  recenterTrigger = 0
}: TradingChartProps) {
  const { currentPrice: wsPrice, isConnected } = usePriceFeed();
  const { playClick, playWin, playLoss } = useSoundEffects();
  const { address } = useAccount(); // Get user's wallet address
  
  // Connect to settlements WebSocket
  const { isConnected: settlementsConnected, lastMessage: settlementsMessage } = useSettlementsWebSocket();
  
  // Track last processed settlement to prevent duplicates
  const processedSettlementsRef = useRef<Set<string>>(new Set());
  const [, forceUpdate] = useState({});
  
  // Check user's bets against settlements by querying Supabase for exact bet data
  useEffect(() => {
    const checkSettlement = async () => {
      if (!settlementsMessage || !address) return;
      
      const settlementTimeperiodId = settlementsMessage.timeperiod_id;
      
      // Skip if we already processed this timeperiod
      if (processedSettlementsRef.current.has(settlementTimeperiodId)) {
        console.log(`⏭️ Skipping duplicate settlement for timeperiod ${settlementTimeperiodId}`);
        return;
      }
      
      // Mark this timeperiod as processed
      processedSettlementsRef.current.add(settlementTimeperiodId);
      // console.log(`✅ Processing NEW settlement for timeperiod ${settlementTimeperiodId}`);
      
      const settlementTimeperiodIdNum = parseInt(settlementTimeperiodId);
      const settlementPrice = parseFloat(settlementsMessage.price) / 1e8;
      
      console.log(`\n🏆 Settlement received: timeperiod ${settlementTimeperiodIdNum}, price $${settlementPrice.toFixed(priceDecimals)}`);
      
      try {
        // Query user's bets for this timeperiod
        const { data: userBets, error } = await supabase
          .from('bet_placed_with_session')
          .select('*')
          .ilike('user_address', address)
          .eq('timeperiod_id', settlementTimeperiodId)
          .in('status', ['pending', 'confirmed']); // Only check unsettled bets
        
        // console.log(`📊 Query result: found ${userBets?.length || 0} unsettled bet(s)`);
        
        if (error) {
          console.error('❌ Error querying user bets:', error);
          return;
        }
        
        if (!userBets || userBets.length === 0) {
          console.log(`  ⏭️  No unsettled bets found for this timeperiod`);
          return;
        }
        
        // Process each bet and update database
        const updatePromises = userBets.map(async (bet) => {
          const priceMin = parseFloat(bet.price_min) / 1e8;
          const priceMax = parseFloat(bet.price_max) / 1e8;
          
          // Check if settlement price is within bet's price range
          const isWin = settlementPrice >= priceMin && settlementPrice <= priceMax;
          const newStatus = isWin ? 'won' : 'lost';
          
          // Calculate cell key to find the bet in UI
          const cellTime = settlementTimeperiodIdNum + 2.5;
          const cellPriceLevel = priceMax;
          const cellKey = `${Math.round(cellTime * 10)}_${cellPriceLevel.toFixed(priceDecimals)}`;
          
          // Try to get multiplier from UI state (already stored when bet was placed)
          const existingBet = selectedCellsRef.current.get(cellKey);
          let calculatedMultiplier = 0;
          
          if (existingBet && existingBet.multiplier) {
            // Use the multiplier that was calculated when the bet was placed
            calculatedMultiplier = existingBet.multiplier;
            console.log(`  ✅ Using stored multiplier from UI: ${calculatedMultiplier.toFixed(2)}X`);
          } else {
            // Fallback: try to get from database or calculate (may be inaccurate after grid starts)
            calculatedMultiplier = bet.multiplier || 0;
            console.log(`  ⚠️ Using multiplier from database: ${calculatedMultiplier.toFixed(2)}X`);
          }
          
          // Determine multiplier: keep calculated multiplier if win, set to 0 if loss
          const finalMultiplier = isWin ? calculatedMultiplier : 0;
          
          console.log(`  📊 Bet ${bet.event_id.substring(0, 10)}... - ${newStatus.toUpperCase()}`);
          console.log(`     Original multiplier: ${calculatedMultiplier.toFixed(2)}X`);
          console.log(`     Final multiplier (${isWin ? 'WIN' : 'LOSS'}): ${finalMultiplier.toFixed(2)}X`);
          
          // Update database with settlement result
          const { error: updateError } = await supabase
            .from('bet_placed_with_session')
            .update({ 
              status: newStatus, 
              settled_at: new Date().toISOString(),
              settlement_price: Math.floor(settlementPrice * 1e8), // Store in cents
              multiplier: finalMultiplier // Keep multiplier if win, 0 if loss
            })
            .eq('event_id', bet.event_id);
          
          if (updateError) {
            console.error('❌ Error updating bet status:', updateError);
            return null;
          }
          
          // Update UI (reuse cellKey and existingBet from above)
          if (existingBet) {
            existingBet.status = newStatus;
            existingBet.timestamp = Date.now();
            if (isWin) {
              soundsRef.current.playWin();
              console.log(`  ✅ WIN! Bet ${bet.event_id} updated in database`);
            } else {
              soundsRef.current.playLoss();
              console.log(`  ❌ LOSS! Bet ${bet.event_id} updated in database`);
            }
          } else {
            // Bet not in UI yet - add it with settled status
            // Calculate multiplier for restored bet
            const betInfo = calculateCellBetInfo(cellTime, cellPriceLevel);
            
            selectedCellsRef.current.set(cellKey, {
              t: cellTime,
              priceLevel: cellPriceLevel,
              status: newStatus,
              orderId: bet.event_id || bet.grid_id,
              priceMin: priceMin,
              priceMax: priceMax,
              timestamp: Date.now(),
              multiplier: isWin ? betInfo.multiplier : 0, // Keep multiplier if win, 0 if loss
              betAmount: betInfo.betAmount,
              payout: isWin ? betInfo.payout : 0
            });
            
            if (isWin) {
              soundsRef.current.playWin();
              console.log(`  ✅ WIN! (restored) Bet ${bet.event_id} updated in database`);
            } else {
              soundsRef.current.playLoss();
              console.log(`  ❌ LOSS! (restored) Bet ${bet.event_id} updated in database`);
            }
          }
          
          return { cellKey, status: newStatus };
        });
        
        await Promise.all(updatePromises);
        
        // Trigger re-render
        forceUpdate({});
        
      } catch (error) {
        console.error('❌ Exception checking settlement:', error);
      }
    };
    
    checkSettlement();
  }, [settlementsMessage, address, priceDecimals, priceStep]);

  // Track settlements for ALL users so their grids can be highlighted (win/loss) for others
  useEffect(() => {
    if (!settlementsMessage) return;

    const settlementTimeperiodId = parseInt(settlementsMessage.timeperiod_id, 10);
    const settlementPriceRaw = settlementsMessage.price;

    if (Number.isNaN(settlementTimeperiodId) || !settlementPriceRaw) {
      return;
    }

    const settlementPrice = parseFloat(settlementPriceRaw) / 1e8;
    if (Number.isNaN(settlementPrice)) {
      return;
    }

    const nowTs = Date.now();
    let updated = false;

    // Query database for ALL bets in this timeperiod (not just ones in memory)
    const checkAllBets = async () => {
      try {
        const { data: allBets, error } = await supabase
          .from('bet_placed_with_session')
          .select('price_min, price_max, timeperiod_id')
          .eq('timeperiod_id', settlementTimeperiodId.toString());

        if (error) {
          console.error('❌ Error fetching bets for settlement:', error);
          return;
        }

        if (!allBets || allBets.length === 0) {
          return;
        }

        // Process each bet to determine win/loss and create grid_id
        allBets.forEach(bet => {
          const priceMin = parseFloat(bet.price_min) / 1e8;
          const priceMax = parseFloat(bet.price_max) / 1e8;
          
          if (Number.isNaN(priceMin) || Number.isNaN(priceMax)) return;

          // Create grid_id matching the format used in allUsersBetsRef
          const gridId = `${settlementTimeperiodId}_${priceMin.toFixed(2)}_${priceMax.toFixed(2)}`;

          const status: 'win' | 'loss' = settlementPrice >= priceMin && settlementPrice <= priceMax ? 'win' : 'loss';
          otherUsersSettlementsRef.current.set(gridId, { status, timestamp: nowTs });
          updated = true;
        });

        if (updated) {
          forceUpdate({});
        }
      } catch (error) {
        console.error('❌ Exception checking all bets for settlement:', error);
      }
    };

    checkAllBets();
  }, [settlementsMessage, forceUpdate]);

  // Periodically clean up stale settlement highlights
  useEffect(() => {
    const interval = setInterval(() => {
      const nowTs = Date.now();
      let removed = false;

      otherUsersSettlementsRef.current.forEach((value, key) => {
        if (nowTs - value.timestamp > OTHER_USER_SETTLEMENT_TTL) {
          otherUsersSettlementsRef.current.delete(key);
          removed = true;
        }
      });

      if (removed) {
        forceUpdate({});
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [forceUpdate]);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const priceRef = useRef<number>(wsPrice > 0 ? wsPrice : (initialBasePrice || 38.12));
  const targetPriceRef = useRef<number>(wsPrice > 0 ? wsPrice : (initialBasePrice || 38.12));
  const historyRef = useRef<DataPoint[]>([]);
  const hoverRef = useRef<{
    t: number;
    gyIndex: number;
  } | null>(null);
  const soundsRef = useRef({ playClick, playWin, playLoss });
  const selectedCellsRef = useRef<Map<string, { 
    t: number; 
    priceLevel: number; 
    dragSessionId?: string;
    status: 'pending' | 'confirmed' | 'won' | 'lost';
    orderId?: string;
    priceMin: number;
    priceMax: number;
    timestamp: number; // For fade animation
    multiplier?: number; // Multiplier at time of bet
    betAmount?: number; // Amount bet (in USD)
    payout?: number; // Calculated payout (betAmount × multiplier)
    nextUserMultiplier?: number; // Multiplier next user will see (RED)
  }>>(new Map());
  const lastClickRef = useRef<{ cellKey: string; time: number } | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const currentDragSessionRef = useRef<string | null>(null);
  const mouseDownTimeRef = useRef<number>(0);
  const hasDraggedRef = useRef<boolean>(false);
  const hasStartedPlottingRef = useRef<boolean>(false);
  const isInDragSelectionModeRef = useRef<boolean>(false); // Track if double-click activated drag mode
  
  // All users' bets: Store bets from all users for real-time visualization
  const allUsersBetsRef = useRef<Map<string, UserBet[]>>(new Map()); // key: grid_id, value: array of bets
  
  // Track settlements for ALL users so their grids can be highlighted (win/loss) for others
  const otherUsersSettlementsRef = useRef<Map<string, { status: 'win' | 'loss'; timestamp: number }>>(new Map());
  
  // Track if component is still mounted (prevents requests during reload/unmount)
  const isMountedRef = useRef(true);
  
  // 2D panning state (both horizontal and vertical)
  const isPanning2DRef = useRef<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number; priceOffset: number; timeOffset: number } | null>(null);
  const priceOffsetRef = useRef<number>(0); // Vertical offset in price units
  const timeOffsetRef = useRef<number>(0); // Horizontal time offset in seconds
  const isRecenteringRef = useRef<boolean>(false); // Track if we're animating recenter
  const recenterStartPriceOffsetRef = useRef<number>(0); // Store starting price offset for animation
  const recenterStartTimeOffsetRef = useRef<number>(0); // Store starting time offset for animation
  const recenterStartTimeRef = useRef<number>(0); // Store animation start time

  const [showOrderPopup, setShowOrderPopup] = useState(false);
  const [orderDetails, setOrderDetails] = useState<{ count: number; cells: Array<{ t: number; priceLevel: number }> } | null>(null);
  const [gridIdInfo, setGridIdInfo] = useState<{ gridId: string; timeperiodId: string; priceMin: string; priceMax: string; isWinner?: boolean; hasBet?: boolean } | null>(null);
  const [showGridIdPopup, setShowGridIdPopup] = useState(false);
  const [isWaitingForGrid, setIsWaitingForGrid] = useState(false);
  const [showWalletWarning, setShowWalletWarning] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [showInvalidSignaturePopup, setShowInvalidSignaturePopup] = useState(false);
  
  // Helper function to clear nonce storage
  const clearNonceStorage = () => {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('nonce_')) {
        localStorage.removeItem(key);
        console.log(`Cleared: ${key}`);
      }
    });
  };

  // Helper function to clear session storage
  const clearSessionStorage = () => {
    if (!address) return;
    
    const sessionKey = `tradingSession_${address}`;
    const sessionKeyLower = `tradingSession_${address.toLowerCase()}`;
    
    localStorage.removeItem(sessionKey);
    localStorage.removeItem(sessionKeyLower);
    console.log(`✅ Deleted session for ${address}`);
  };

  // WebSocket real-time bets
  // Use state for price range to prevent hook re-render issues
  const [priceRange, setPriceRange] = useState({ 
    min: (wsPrice > 0 ? wsPrice : (initialBasePrice || 38.12)) - (100 * priceStep),
    max: (wsPrice > 0 ? wsPrice : (initialBasePrice || 38.12)) + (100 * priceStep)
  });
  
  // Update sound functions ref when they change
  useEffect(() => {
    soundsRef.current = { playClick, playWin, playLoss };
  }, [playClick, playWin, playLoss]);
  
  const { 
    bets: realtimeBets, 
    isLoading: betsLoading,
    error: wsError 
  } = useAllUsersBetsQuery({
    currentTime: Math.floor(Date.now() / 1000),
    priceMin: priceRange.min,
    priceMax: priceRange.max,
    timeWindowSeconds: 300,
    enabled: true // Enabled for real-time updates
  });

  // Chart configuration
  const DURATION = CHART_CONFIG.DURATION_SECONDS - 6; // Chart history duration (reduced by 6 seconds for better performance)
  const UPDATE_MS = CHART_CONFIG.UPDATE_INTERVAL_MS; // Update interval for smooth 60fps animation
  const GRID_SEC = GRID_CONFIG.GRID_SECONDS; // Each grid cell represents 5 seconds
  const CELL_SIZE = GRID_CONFIG.CELL_SIZE; // Grid cell size in pixels
  
  // Cache for dynamic multipliers - stores real multipliers from database
  const multiplierCache = useRef<Map<string, { multiplier: number; timestamp: number; timeUntilStart: number; existingShares?: number; isOptimistic?: boolean }>>(new Map());
  const MULTIPLIER_CACHE_TTL = 5000; // 5 seconds cache (shorter to adapt to time changes)
  
  // Fetch queue to prevent duplicate requests
  const multiplierFetchQueue = useRef<Set<string>>(new Set());
  
  /**
   * Get time-based bucket for cache key
   * Groups time into buckets to recalculate when crossing thresholds
   */
  const getTimeBucket = (timeUntilStart: number): string => {
    if (timeUntilStart <= 15) return 'bucket_0-15';
    if (timeUntilStart <= 25) return 'bucket_15-25';
    if (timeUntilStart <= 40) return 'bucket_25-40';
    return 'bucket_40+';
  };
  
  /**
   * Calculate multiplier and payout for a cell at time of bet
   * @param cellTime - Unix timestamp of the grid cell
   * @param priceLevel - Price level of the cell
   * @returns { multiplier, betAmount, payout, nextUserMultiplier }
   */
  const calculateCellBetInfo = (cellTime: number, priceLevel: number) => {
    const timeperiodId = Math.floor(cellTime / 5) * 5; // 5-second grids
    const timeUntilStart = timeperiodId - Math.floor(Date.now() / 1000);
    const timeBucket = getTimeBucket(timeUntilStart);
    const cacheKey = `${timeperiodId}_${priceLevel.toFixed(priceDecimals)}_${timeBucket}`;
    const cached = multiplierCache.current.get(cacheKey);
    const multiplier = cached ? cached.multiplier : getQuickMultiplier(timeperiodId);
    
    // Get bet amount from localStorage
    const savedAmount = typeof window !== 'undefined' ? localStorage.getItem('userAmount') : null;
    const betAmount = savedAmount ? parseFloat(savedAmount) : 0.2;
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
   * @param priceMin - Min price of grid
   * @param priceMax - Max price of grid
   * @returns Next user's multiplier with REAL data
   */
  const calculateRealNextUserMultiplier = async (
    timeperiodId: number,
    priceLevel: number,
    priceMin: number,
    priceMax: number
  ): Promise<number | undefined> => {
    try {
      console.log('🔴 [REAL Next User Multiplier] Fetching real data...');
      
      // Fetch REAL total_share from Supabase
      const { data: betPlacedData, error } = await supabase
        .from('bet_placed')
        .select('total_share')
        .eq('timeperiod_id', timeperiodId.toString())
        .eq('price_min', priceMin)
        .eq('price_max', priceMax)
        .maybeSingle();

      if (error || !betPlacedData || !betPlacedData.total_share) {
        console.log('⚠️  No total_share found yet');
        return undefined;
      }

      // Convert from USDC precision (1e6) to decimal
      const realTotalShares = parseFloat(betPlacedData.total_share) / 1e6;
      console.log(`✅ Real total_share (raw): ${betPlacedData.total_share}`);
      console.log(`✅ Real total_share (decimal): ${realTotalShares}`);

      // Get bet amount
      const savedAmount = typeof window !== 'undefined' ? localStorage.getItem('userAmount') : null;
      const betAmount = savedAmount ? parseFloat(savedAmount) : 0.2;

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
   * @param timeperiodId - Unix timestamp of the grid
   * @param priceLevel - Center price of the cell
   * @returns { multiplier, betCount } or quick estimate if fetching
   */
  const getCellMultiplier = async (timeperiodId: number, priceLevel: number) => {
    // Check if component is still mounted before making request
    if (!isMountedRef.current) {
      // Component is unmounting, return quick estimate instead of fetching
      return getQuickMultiplier(timeperiodId);
    }
    
    const now = Math.floor(Date.now() / 1000);
    const timeUntilStart = timeperiodId - now;
    const timeBucket = getTimeBucket(timeUntilStart);
    const cacheKey = `${timeperiodId}_${priceLevel.toFixed(priceDecimals)}_${timeBucket}`;
    
    // Check cache first - but also verify the time bucket hasn't changed
    const cached = multiplierCache.current.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < MULTIPLIER_CACHE_TTL) {
      // Verify time bucket is still valid
      const currentBucket = getTimeBucket(timeperiodId - Math.floor(Date.now() / 1000));
      if (currentBucket === timeBucket) {
        return cached.multiplier;
      }
    }
    
    // Check if already fetching
    if (multiplierFetchQueue.current.has(cacheKey)) {
      // Return quick estimate while fetching
      return getQuickMultiplier(timeperiodId);
    }
    
    // Add to fetch queue
    multiplierFetchQueue.current.add(cacheKey);
    
    try {
      // Double-check mounted status before making the request
      if (!isMountedRef.current) {
        return getQuickMultiplier(timeperiodId);
      }
      
      // Fetch real multiplier and existingShares from database
      const res = await getGridMultiplier(timeperiodId, priceLevel, priceStep);

      // Check mounted status again after async operation
      if (!isMountedRef.current) {
        return getQuickMultiplier(timeperiodId);
      }

      // Cache the result with time information and existingShares
      multiplierCache.current.set(cacheKey, {
        multiplier: res.multiplier,
        timestamp: Date.now(),
        timeUntilStart
      });

      // Attach existingShares to a secondary cache map or reuse the same object
      // We'll encode it into the same value object for simplicity
      const cached = multiplierCache.current.get(cacheKey);
      if (cached) cached.existingShares = res.existingShares;

      return res.multiplier;
    } catch (error) {
      // Only log if still mounted
      if (isMountedRef.current) {
        console.debug('Error fetching multiplier, using quick estimate:', error);
      }
      return getQuickMultiplier(timeperiodId);
    } finally {
      // Remove from fetch queue
      multiplierFetchQueue.current.delete(cacheKey);
    }
  };
  
  /**
   * Get bet count for a grid cell
   * @param timeperiodId - Unix timestamp
   * @param priceLevel - Price level
   * @returns Number of bets in this grid
   */
  const getCellBetCount = (timeperiodId: number, priceLevel: number): number => {
    // Convert to grid_id format used in allUsersBetsRef
    const priceMin = priceLevel - priceStep ;
    const priceMax = priceLevel;
    const gridId = `${timeperiodId}_${priceMin.toFixed(priceDecimals)}_${priceMax.toFixed(priceDecimals)}`;
    
    const betsInGrid = allUsersBetsRef.current.get(gridId);
    if (betsInGrid && betsInGrid.length > 0) {
      return betsInGrid.length;
    }
    let totalCount = 0;
  for (const [betGridId, bets] of Array.from(allUsersBetsRef.current.entries())) {
    const bet = bets[0];
    if (bet && bet.timeperiod_id === timeperiodId) {
      // Parse grid_id to get the bet's actual price range
      const gridIdParts = betGridId.split('_');
      if (gridIdParts.length === 3) {
        const betPriceMin = parseFloat(gridIdParts[1]);
        const betPriceMax = parseFloat(gridIdParts[2]);
        // Check if cell's price range overlaps with bet's price range
        if (priceMax > betPriceMin && priceMin < betPriceMax) {
          totalCount += bets.length; // Add ALL bets from this grid
        }
      }
    }
  }
  return totalCount;
  };

  // Update target price from WebSocket
    useEffect(() => {
    if (wsPrice > 0) {
      // If this is the first real price update, set immediately (no interpolation)
      if (priceRef.current === 38.12 || Math.abs(wsPrice - priceRef.current) > 100) {
        priceRef.current = wsPrice;
      }
      targetPriceRef.current = wsPrice;
    }
  }, [wsPrice]);

  // Process real-time bets and group by grid_id (EXCLUDE current user's bets)
  useEffect(() => {
    if (realtimeBets && realtimeBets.length > 0) {
      // Filter out current user's bets - only show OTHER users' bets
      const otherUsersBets = address 
        ? realtimeBets.filter(bet => bet.user_address.toLowerCase() !== address.toLowerCase())
        : realtimeBets;
      
      const betsByGrid = new Map<string, UserBet[]>();
      
      otherUsersBets.forEach(bet => {
        if (!betsByGrid.has(bet.grid_id)) {
          betsByGrid.set(bet.grid_id, []);
        }
        betsByGrid.get(bet.grid_id)!.push(bet);
      });
      
      allUsersBetsRef.current = betsByGrid;
      console.log('📊 Updated OTHER users bets (excluding yours):', betsByGrid.size, 'unique grids');
      if (betsByGrid.size > 0) {
        console.log('📊 Sample grid IDs:', Array.from(betsByGrid.keys()).slice(0, 3));
        betsByGrid.forEach((bets, gridId) => {
          console.log(`   Grid ${gridId}: ${bets.length} bet(s) from users:`, bets.map(b => b.user_address.substring(0, 10) + '...'));
        });
      }
    }
  }, [realtimeBets, address]); // Added address to dependencies

  // Manage mounted state to prevent requests during reload/unmount
  useEffect(() => {
    // Component is mounted
    isMountedRef.current = true;
    
    // Cleanup on unmount
    return () => {
      isMountedRef.current = false;
      // Clear all pending fetch requests
      multiplierFetchQueue.current.clear();
    };
  }, []);

  // Load user's bets from localStorage on page load (instant restore)
  useEffect(() => {
    if (typeof window === 'undefined' || !address) return;

    try {
      const storageKey = `mercury_user_bets_${address.toLowerCase()}`;
      const savedBets = localStorage.getItem(storageKey);
      
      if (savedBets) {
        const parsed = JSON.parse(savedBets);
        const now = Date.now() / 1000;
        let restoredCount = 0;

        parsed.forEach((item: any) => {
          // Only restore bets that are less than 1 hour old
          if (item.t && now - item.t < 3600) {
            // Recalculate multiplier and payout for restored bets
            const betInfo = calculateCellBetInfo(item.t, item.priceLevel);
            
            selectedCellsRef.current.set(item.cellKey, {
              t: item.t,
              priceLevel: item.priceLevel,
              status: item.status || 'confirmed',
              orderId: item.orderId,
              priceMin: item.priceMin,
              priceMax: item.priceMax,
              timestamp: item.timestamp,
              multiplier: item.multiplier || betInfo.multiplier,
              betAmount: item.betAmount || betInfo.betAmount,
              payout: item.payout || betInfo.payout
            });
            restoredCount++;
          }
        });

        if (restoredCount > 0) {
          console.log('⚡ Instantly restored', restoredCount, 'bets from localStorage');
          forceUpdate({});
        }
      }
    } catch (error) {
      console.error('Error loading bets from localStorage:', error);
    }
  }, [address]);

  // Save user's bets to localStorage whenever they change
  useEffect(() => {
    if (typeof window === 'undefined' || !address) return;

    const saveInterval = setInterval(() => {
      if (selectedCellsRef.current.size > 0) {
        try {
          const storageKey = `mercury_user_bets_${address.toLowerCase()}`;
          const betsArray = Array.from(selectedCellsRef.current.entries()).map(([cellKey, bet]) => ({
            cellKey,
            t: bet.t,
            priceLevel: bet.priceLevel,
            status: bet.status,
            orderId: bet.orderId,
            priceMin: bet.priceMin,
            priceMax: bet.priceMax,
            timestamp: bet.timestamp,
            multiplier: bet.multiplier,
            betAmount: bet.betAmount,
            payout: bet.payout
          }));
          
          localStorage.setItem(storageKey, JSON.stringify(betsArray));
        } catch (error) {
          console.error('Error saving bets to localStorage:', error);
        }
      }
    }, 2000); // Save every 2 seconds

    return () => clearInterval(saveInterval);
  }, [address]);

  // Load user's previous bets from database on page load
  useEffect(() => {
    const loadUserBets = async () => {
      if (!address) {
        console.log('⚠️ No wallet address connected, skipping bet restoration');
        return;
      }

      try {
        console.log('🔄 Loading user bets from database for address:', address);
        
        // Fetch user's bets from last 24 hours
        const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - 86400;
        
        const { data: userBets, error } = await supabase
          .from('bet_placed_with_session')
          .select('*')
          .eq('user_address', address.toLowerCase())
          .gte('timeperiod_id', twentyFourHoursAgo)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('❌ Error loading user bets:', error);
          return;
        }

        if (!userBets || userBets.length === 0) {
          console.log('ℹ️ No previous bets found for user');
          return;
        }

        console.log('✅ Loaded', userBets.length, 'bets from database');

        // Restore bets to selectedCellsRef
        const now = Date.now() / 1000;
        let restoredCount = 0;

        userBets.forEach((bet) => {
          // Calculate cell time (center of 5-second period)
          const cellTime = bet.timeperiod_id + 2.5;
          
          // Calculate price level from price range
          const priceMin = parseFloat(bet.price_min) / 1e8;
          const priceMax = parseFloat(bet.price_max) / 1e8;
          const midpoint = (priceMin + priceMax) / 2;
          const priceLevel = Math.floor(midpoint / priceStep) * priceStep + priceStep;

          // Create cell key
          const cellKey = `${Math.round(cellTime * 10)}_${priceLevel.toFixed(priceDecimals)}`;

          // Skip if bet is too old
          if (cellTime < now - 3600) return;

          // Use status directly from database (pending, confirmed, won, lost)
          const status = bet.status || 'confirmed';

          // Recalculate multiplier and payout for restored bets
          const betInfo = calculateCellBetInfo(cellTime, priceLevel);

          selectedCellsRef.current.set(cellKey, {
            t: cellTime,
            priceLevel: priceLevel,
            status: status as 'pending' | 'confirmed' | 'won' | 'lost',
            orderId: bet.event_id || bet.grid_id,
            priceMin: priceMin,
            priceMax: priceMax,
            timestamp: bet.settled_at ? new Date(bet.settled_at).getTime() : bet.timeperiod_id * 1000,
            multiplier: betInfo.multiplier,
            betAmount: betInfo.betAmount,
            payout: betInfo.payout
          });

          restoredCount++;
        });

        console.log('✅ Restored', restoredCount, 'bets with their Win/Loss status');
        forceUpdate({});

      } catch (error) {
        console.error('❌ Exception loading user bets:', error);
      }
    };

    loadUserBets();
  }, [address, priceStep, priceDecimals]);

  // Keyboard event listener for multi-select mode (M key)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') {
        if (!isInDragSelectionModeRef.current) {
          isInDragSelectionModeRef.current = true;
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.style.cursor = 'crosshair';
          }
          console.log('🎯 Multi-select mode ENABLED (press M again to disable)');
        } else {
          isInDragSelectionModeRef.current = false;
          const canvas = canvasRef.current;
          if (canvas) {
            canvas.style.cursor = 'default';
          }
          console.log('❌ Multi-select mode DISABLED');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Cleanup old multiplier cache entries periodically
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      let removedCount = 0;
      
      multiplierCache.current.forEach((value, key) => {
        if (now - value.timestamp > MULTIPLIER_CACHE_TTL) {
          multiplierCache.current.delete(key);
          removedCount++;
        }
      });
      
      if (removedCount > 0) {
        console.debug(`🧹 Cleaned up ${removedCount} old multiplier cache entries`);
      }
    }, 60000); // Clean up every 60 seconds
    
    return () => clearInterval(cleanupInterval);
  }, []);

  // Invalidate multiplier cache when new bets are placed (real-time updates)
  // OPTIMISTIC UI: Show estimated multiplier immediately, then correct with real data
  useEffect(() => {
    if (realtimeBets && realtimeBets.length > 0) {
      realtimeBets.forEach((bet) => {
        (async () => {
          try {
            const timeperiodId = Math.floor(bet.timeperiod_id / GRID_SEC) * GRID_SEC; // normalize to grid period
            const now = Math.floor(Date.now() / 1000);
            const timeUntilStart = timeperiodId - now;
            const timeBucket = getTimeBucket(timeUntilStart);
            const cacheKey = `${timeperiodId}_${bet.price_level.toFixed(priceDecimals)}_${timeBucket}`;

            // ⚡ STEP 1: OPTIMISTIC UPDATE (INSTANT - <1ms)
            // Estimate new total shares using cached data
            const cached = multiplierCache.current.get(cacheKey);
            const previousExistingShares = cached?.existingShares || 0;
            const estimatedExistingShares = previousExistingShares + bet.shares;
            
            // Determine base price using contract-accurate logic
            let effectiveBasePrice: number;
            if (estimatedExistingShares === bet.shares) {
              // This is the FIRST bet in this grid (estimated = new bet's shares)
              if (timeUntilStart <= 15) effectiveBasePrice = 0.66;
              else if (timeUntilStart <= 25) effectiveBasePrice = 0.5;
              else if (timeUntilStart <= 40) effectiveBasePrice = 0.35;
              else effectiveBasePrice = 0.2;
            } else {
              // Subsequent bets: use MAX(time-based, 0.2) = 0.2
              effectiveBasePrice = 0.2;
            }
            
            // Calculate dynamic B using contract-accurate exponential decay
            const b = calculateDynamicB(timeperiodId);
            const bNumber = Number(b) / 1e6; // Convert from USDC units (1e6) to decimal
            
            // Calculate optimistic multiplier using exact contract formula
            const currentPrice = effectiveBasePrice + (estimatedExistingShares / bNumber);
            const optimisticMultiplier = 1 / currentPrice;
            
            // Update cache INSTANTLY with optimistic value
            multiplierCache.current.set(cacheKey, {
              multiplier: optimisticMultiplier,
              timestamp: Date.now(),
              timeUntilStart,
              existingShares: estimatedExistingShares,
              isOptimistic: true  // Flag as optimistic
            });
            
            console.log('⚡ OPTIMISTIC multiplier (instant):', {
              cacheKey,
              previousShares: previousExistingShares,
              newBetShares: bet.shares,
              estimatedTotal: estimatedExistingShares,
              basePrice: effectiveBasePrice,
              dynamicB: bNumber.toFixed(2),
              price: currentPrice.toFixed(4),
              multiplier: optimisticMultiplier.toFixed(2) + 'x',
              latency: '<1ms'
            });

            // ✅ STEP 2: FETCH REAL DATA (background - non-blocking)
            if (typeof (bet as any).total_share === 'number') {
              // Fast path: total_share is already in payload (from useRealtimeBets)
              const realExistingShares = (bet as any).total_share as number;
              
              // Recalculate with REAL shares using contract logic
              // NOTE: total_share includes the current bet, so if realExistingShares === bet.shares, this is the FIRST bet
              let realBasePrice: number;
              if (realExistingShares === bet.shares) {
                // This is the FIRST bet in this grid (total_share = current bet's shares)
                if (timeUntilStart <= 15) realBasePrice = 0.66;
                else if (timeUntilStart <= 25) realBasePrice = 0.5;
                else if (timeUntilStart <= 40) realBasePrice = 0.35;
                else realBasePrice = 0.2;
              } else {
                // Subsequent bets: use MAX(time-based, 0.2) = 0.2
                realBasePrice = 0.2;
              }
              
              const realPrice = realBasePrice + (realExistingShares / bNumber);
              const realMultiplier = 1 / realPrice;
              
              // Update cache with REAL value
              multiplierCache.current.set(cacheKey, {
                multiplier: realMultiplier,
                timestamp: Date.now(),
                timeUntilStart,
                existingShares: realExistingShares,
                isOptimistic: false  // Confirmed with real data
              });
              
              // 📊 LOG DIFFERENCE for debugging
              const difference = Math.abs(optimisticMultiplier - realMultiplier);
              const percentDiff = (difference / realMultiplier) * 100;
              const diffSymbol = difference < 0.01 ? '✅' : difference < 0.1 ? '⚠️' : '❌';
              
              console.log(`${diffSymbol} REAL multiplier (confirmed):`, {
                cacheKey,
                realShares: realExistingShares,
                optimistic: optimisticMultiplier.toFixed(4) + 'x',
                real: realMultiplier.toFixed(4) + 'x',
                difference: difference.toFixed(4),
                percentDiff: percentDiff.toFixed(2) + '%',
                accuracy: percentDiff < 1 ? 'EXCELLENT' : percentDiff < 5 ? 'GOOD' : 'NEEDS_REVIEW'
              });
              
            } else {
              // Fallback: fetch from database (slower path)
              console.log('⏳ Fetching real multiplier from database...');
              const fetchStartTime = Date.now();
              
              const res = await getGridMultiplier(timeperiodId, bet.price_level, priceStep);
              
              const fetchLatency = Date.now() - fetchStartTime;
              
              multiplierCache.current.set(cacheKey, {
                multiplier: res.multiplier,
                timestamp: Date.now(),
                timeUntilStart,
                existingShares: res.existingShares,
                isOptimistic: false
              });
              
              // 📊 LOG DIFFERENCE for debugging
              const difference = Math.abs(optimisticMultiplier - res.multiplier);
              const percentDiff = (difference / res.multiplier) * 100;
              const diffSymbol = difference < 0.01 ? '✅' : difference < 0.1 ? '⚠️' : '❌';
              
              console.log(`${diffSymbol} REAL multiplier (from DB):`, {
                cacheKey,
                realShares: res.existingShares,
                optimistic: optimisticMultiplier.toFixed(4) + 'x',
                real: res.multiplier.toFixed(4) + 'x',
                difference: difference.toFixed(4),
                percentDiff: percentDiff.toFixed(2) + '%',
                dbLatency: fetchLatency + 'ms',
                accuracy: percentDiff < 1 ? 'EXCELLENT' : percentDiff < 5 ? 'GOOD' : 'NEEDS_REVIEW'
              });
            }
          } catch (err) {
            console.error('❌ Error in optimistic multiplier update:', err);
            // If anything fails, fall back to invalidation
            const prefix = `${bet.timeperiod_id}_${bet.price_level.toFixed(priceDecimals)}_`;
            const keysToRemove: string[] = [];
            multiplierCache.current.forEach((_, key) => {
              if (key.startsWith(prefix)) keysToRemove.push(key);
            });
            keysToRemove.forEach(k => multiplierCache.current.delete(k));
          }
        })();
      });
    }
  }, [realtimeBets, priceStep, priceDecimals]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Update price with smooth interpolation
    let lastUpdateTime = 0;
    const updatePrice = (currentTime: number) => {
      // Check if we should start plotting (UTC seconds is multiple of 5)
      if (!hasStartedPlottingRef.current) {
        const now = new Date();
        const utcSeconds = now.getUTCSeconds();
        
        if (utcSeconds % 5 === 0) {
          hasStartedPlottingRef.current = true;
          const unixTime = Math.floor(now.getTime() / 1000);
          console.log('📊 Starting plot at UTC seconds:', utcSeconds);
          console.log('📊 Unix timestamp:', unixTime);
          console.log('📊 Full date:', now.toISOString());
        } else {
          // Keep checking until we hit a multiple of 5
          requestAnimationFrame(updatePrice);
          return;
        }
      }

      if (currentTime - lastUpdateTime >= UPDATE_MS) {
        const t = Date.now() / 1000;
        const currentPrice = priceRef.current;
        const targetPrice = targetPriceRef.current;
        
        // Smooth interpolation towards target price
        const lerpFactor = 0.2; // Increased from 0.1 for faster, smoother movement
        const newPrice = currentPrice + (targetPrice - currentPrice) * lerpFactor;
        
        // If no WebSocket data, add small random movement for demo
        if (wsPrice <= 0) {
          const randomMovement = (Math.random() - 0.5) * 0.0001;
          targetPriceRef.current = targetPrice + randomMovement;
        }
        
        priceRef.current = newPrice;
        historyRef.current = [
          ...historyRef.current.filter((d) => t - d.t < DURATION * 2),
          { t, v: newPrice },
        ];
        lastUpdateTime = currentTime;
      }
      requestAnimationFrame(updatePrice);
    };
    
    const gen = requestAnimationFrame(updatePrice);

    // Helper function to draw spinner in cell corner
    const drawSpinner = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number = 8) => {
      const time = Date.now() / 1000;
      const rotation = (time * 4) % (Math.PI * 2); // 4 radians per second
      
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      
      // Draw spinner circle with gap
      ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, size / 2, 0, Math.PI * 1.5);
      ctx.stroke();
      
      ctx.restore();
    };

    // Helper function to draw the person icon SVG
    const drawPersonIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number = 6, color: string = "#0B0B0B") => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(size / 6, size / 6); // Scale from 6x6 viewBox to desired size
      
      ctx.fillStyle = color;
      ctx.beginPath();
      // SVG path converted to canvas path
      ctx.moveTo(5.86715, 5.19613);
      ctx.bezierCurveTo(5.49225, 4.53816, 4.90685, 4.02548, 4.20519, 3.74063);
      ctx.bezierCurveTo(4.55412, 3.47893, 4.81187, 3.11408, 4.94192, 2.69775);
      ctx.bezierCurveTo(5.07197, 2.28143, 5.06773, 1.83474, 4.9298, 1.42096);
      ctx.bezierCurveTo(4.79187, 1.00718, 4.52725, 0.647291, 4.17342, 0.392262);
      ctx.bezierCurveTo(3.81959, 0.137234, 3.39448, 0, 2.95832, 0);
      ctx.bezierCurveTo(2.52216, 0, 2.09705, 0.137234, 1.74322, 0.392262);
      ctx.bezierCurveTo(1.38938, 0.647291, 1.12476, 1.00718, 0.986835, 1.42096);
      ctx.bezierCurveTo(0.848908, 1.83474, 0.84467, 2.28143, 0.974719, 2.69775);
      ctx.bezierCurveTo(1.10477, 3.11408, 1.36251, 3.47893, 1.71144, 3.74063);
      ctx.bezierCurveTo(1.00978, 4.02548, 0.424384, 4.53816, 0.0494893, 5.19613);
      ctx.bezierCurveTo(0.0262595, 5.23349, 0.0107769, 5.27513, 0.00396202, 5.31858);
      ctx.bezierCurveTo(-0.00285287, 5.36204, -0.000860972, 5.40642, 0.00981934, 5.44909);
      ctx.bezierCurveTo(0.0204996, 5.49176, 0.0396503, 5.53185, 0.0661328, 5.56697);
      ctx.bezierCurveTo(0.0926154, 5.60209, 0.125889, 5.63153, 0.163976, 5.65353);
      ctx.bezierCurveTo(0.202063, 5.67554, 0.244185, 5.68966, 0.287839, 5.69506);
      ctx.bezierCurveTo(0.331493, 5.70046, 0.375787, 5.69703, 0.418088, 5.68497);
      ctx.bezierCurveTo(0.460389, 5.67291, 0.499834, 5.65247, 0.534077, 5.62486);
      ctx.bezierCurveTo(0.56832, 5.59725, 0.596662, 5.56304, 0.617419, 5.52426);
      ctx.bezierCurveTo(1.11289, 4.66785, 1.98789, 4.15707, 2.95832, 4.15707);
      ctx.bezierCurveTo(3.92875, 4.15707, 4.80375, 4.66813, 5.29922, 5.52426);
      ctx.bezierCurveTo(5.3442, 5.59659, 5.41555, 5.64859, 5.49818, 5.66928);
      ctx.bezierCurveTo(5.58081, 5.68996, 5.66825, 5.6777, 5.742, 5.63509);
      ctx.bezierCurveTo(5.81576, 5.59247, 5.87005, 5.52285, 5.8934, 5.44093);
      ctx.bezierCurveTo(5.91676, 5.35902, 5.90734, 5.27123, 5.86715, 5.19613);
      ctx.moveTo(1.53644, 2.07895);
      ctx.bezierCurveTo(1.53644, 1.79772, 1.61983, 1.52282, 1.77607, 1.28899);
      ctx.bezierCurveTo(1.93231, 1.05517, 2.15438, 0.872922, 2.41419, 0.765304);
      ctx.bezierCurveTo(2.674, 0.657686, 2.95989, 0.629528, 3.23571, 0.684391);
      ctx.bezierCurveTo(3.51153, 0.739255, 3.76488, 0.874675, 3.96373, 1.07353);
      ctx.bezierCurveTo(4.16259, 1.27238, 4.29801, 1.52573, 4.35287, 1.80155);
      ctx.bezierCurveTo(4.40773, 2.07737, 4.37958, 2.36326, 4.27196, 2.62307);
      ctx.bezierCurveTo(4.16434, 2.88289, 3.9821, 3.10495, 3.74827, 3.26119);
      ctx.bezierCurveTo(3.51444, 3.41743, 3.23954, 3.50082, 2.95832, 3.50082);
      ctx.bezierCurveTo(2.58135, 3.50039, 2.21994, 3.35044, 1.95338, 3.08388);
      ctx.bezierCurveTo(1.68682, 2.81732, 1.53688, 2.45592, 1.53644, 2.07895);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };

    let frame;
    const draw = () => {
      const now = Date.now() / 1000;
      const w = canvas.width;
      const h = canvas.height;
      
      const centerX = w / 2;
      const pxPerSec = CELL_SIZE / GRID_SEC;
      const price = priceRef.current;
      
      // Handle smooth recenter animation (both X and Y axes)
      if (isRecenteringRef.current) {
        const elapsed = Date.now() - recenterStartTimeRef.current;
        const duration = 500; // 500ms animation duration
        
        if (elapsed >= duration) {
          // Animation complete - reset both offsets
          priceOffsetRef.current = 0;
          timeOffsetRef.current = 0;
          isRecenteringRef.current = false;
        } else {
          // Smooth easing (ease-out cubic)
          const progress = elapsed / duration;
          const easeOut = 1 - Math.pow(1 - progress, 3);
          
          // Interpolate both offsets from start to 0
          priceOffsetRef.current = recenterStartPriceOffsetRef.current * (1 - easeOut);
          timeOffsetRef.current = recenterStartTimeOffsetRef.current * (1 - easeOut);
        }
      }
      
      const priceOffset = priceOffsetRef.current; // Get vertical pan offset once

      // Clear canvas with dark background
      ctx.fillStyle = "#141414";
      ctx.fillRect(0, 0, w, h);

      const baseOffsetX = (now % GRID_SEC) * pxPerSec;
      const offsetX = baseOffsetX - (timeOffsetRef.current % GRID_SEC) * pxPerSec;
      const visible = historyRef.current.filter((d) => now - d.t < DURATION);
      const prices = visible.map((d) => d.v);
      const minPrice = Math.min(...prices, price - 0.3);
      const maxPrice = Math.max(...prices, price + 0.3);
      const range = maxPrice - minPrice;

      // Draw grid
      ctx.strokeStyle = CHART_COLORS.GRID_LINE;
      ctx.lineWidth = 1;
      const gridW = CELL_SIZE;
      const gridH = CELL_SIZE;

      // Vertical grid lines (time)
      for (let i = -Math.ceil(w / gridW) - 1; i < Math.ceil(w / gridW) + 2; i++) {
        const x = centerX + i * gridW - offsetX;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // Horizontal grid lines (price)
      const pxPerPrice = gridH / priceStep;
      
      // Calculate visible price range dynamically based on canvas height and offset
      // This ensures infinite scrolling with no gaps
      const visiblePriceRange = (h / pxPerPrice);
      const topVisiblePrice = price + priceOffset + visiblePriceRange / 2;
      const bottomVisiblePrice = price + priceOffset - visiblePriceRange / 2;
      
      // Start from the lowest visible price level (snapped to grid)
      const startPrice = Math.floor(bottomVisiblePrice / priceStep) * priceStep;
      const numPriceLevels = Math.ceil(visiblePriceRange / priceStep) + 2; // +2 for buffer
      
      // Draw grid lines for all visible price levels
      for (let i = 0; i < numPriceLevels; i++) {
        const priceLevel = startPrice + i * priceStep;
        const y = h / 2 - (priceLevel - price - priceOffset) * pxPerPrice;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Price labels on left - draw for all visible levels
      ctx.fillStyle = CHART_COLORS.TEXT;
      ctx.font = "300 13px 'Geist Mono',monospace,monospace";
      ctx.textAlign = "right";
      for (let i = 0; i < numPriceLevels; i++) {
        const priceLevel = startPrice + i * priceStep;
        const y = h / 2 - (priceLevel - price - priceOffset) * pxPerPrice;
        if (y > 0 && y < h) {
          ctx.fillText(`${priceLevel.toFixed(priceDecimals)}`, 60, y + 4);
        }
      }
      
      // Draw price scale drag handle indicator (vertical grip bars)
      // const gripX = 68;
      // const gripY = h / 2;
      // const gripHeight = 30;
      
      
      // // Draw grip background (green)
      // ctx.fillStyle = "rgba(136, 136, 136, 0.15)";
      // ctx.fillRect(gripX - 4, gripY - gripHeight / 2, 8, gripHeight);
      
      // // Draw grip lines (3 horizontal bars in green)
      // ctx.fillStyle = "rgba(136, 136, 136, 0.5)";
      // for (let i = -1; i <= 1; i++) {
      //   ctx.fillRect(gripX - 3, gripY + i * 6, 6, 2);
      // }

      // Draw price line - following Figma design exactly
      if (visible.length > 1) {
        const oldestX = centerX - (now - visible[0].t) * pxPerSec + (timeOffsetRef.current * pxPerSec);
        const nowX = centerX + (timeOffsetRef.current * pxPerSec);
        
        // Create gradient from Figma: #00FF24 (bright green) to #046712 (darker green at 40%)
        const lineGradient = ctx.createLinearGradient(oldestX, 0, nowX, 0);
        lineGradient.addColorStop(0, "#046712"); // Darker green at tail (from Figma)
        lineGradient.addColorStop(0.4, "#046712"); // Keep darker green up to 40%
        lineGradient.addColorStop(1, "#00FF24"); // Bright green at NOW (from Figma)
        
        // Set up shadow from Figma: X: 0, Y: 1, Blur: 6.2, Color: #00FF24 at 60%
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 1; // Y: 1 from Figma
        ctx.shadowBlur = 6.2; // Blur: 6.2 from Figma
        ctx.shadowColor = "rgba(0, 255, 36, 0.6)"; // #00FF24 at 60% opacity from Figma
        
        // Draw the line with Figma specs: 1.5px thickness
        ctx.strokeStyle = lineGradient;
        ctx.lineWidth = 1.5; // 1.5px from Figma
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        
        ctx.beginPath();
        visible.forEach((d, i) => {
          const x = centerX - (now - d.t) * pxPerSec + (timeOffsetRef.current * pxPerSec);
          const y = h / 2 - (d.v - price - priceOffset) * pxPerPrice;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        // Reset shadow
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.shadowBlur = 0;
      }

      // Calculate NOW line position once (moves with time offset)
      const nowLineX = centerX + (timeOffsetRef.current * pxPerSec);

      // Green NOW line - moves with time offset
      ctx.strokeStyle = "#00ff24";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nowLineX, 0);
      ctx.lineTo(nowLineX, h);
      ctx.stroke();

      ctx.font = "900 16px 'Geist Mono',monospace";
      ctx.textAlign = "center";
      
      // Draw NOW text with black border
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1;
      ctx.strokeText("NOW", nowLineX, 20);
      
      // Fill NOW text in white
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText("NOW", nowLineX, 20);

      // Current price dot - positioned at the endpoint of the price line at NOW line
      const currentPriceDotY = h / 2 + priceOffset * pxPerPrice;
      ctx.beginPath();
      ctx.arc(nowLineX, currentPriceDotY, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#00ff24";
      ctx.fill();

      // Price badge - follows the dot with gradient background
      const badgeX = nowLineX + 15;
      const badgeY = currentPriceDotY - 12;
      const badgeWidth = 80;
      const badgeHeight = 24;
      const badgeRadius = 12;
      
      // Create gradient from Figma design (left to right: darker green gradient)
      const priceGradient = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeWidth, badgeY);
      priceGradient.addColorStop(0, '#004D0A');
      priceGradient.addColorStop(1, '#00650D');
      
      // Draw rounded rectangle with gradient (manual path for compatibility)
      ctx.fillStyle = priceGradient;
      ctx.beginPath();
      ctx.moveTo(badgeX + badgeRadius, badgeY);
      ctx.lineTo(badgeX + badgeWidth - badgeRadius, badgeY);
      ctx.quadraticCurveTo(badgeX + badgeWidth, badgeY, badgeX + badgeWidth, badgeY + badgeRadius);
      ctx.lineTo(badgeX + badgeWidth, badgeY + badgeHeight - badgeRadius);
      ctx.quadraticCurveTo(badgeX + badgeWidth, badgeY + badgeHeight, badgeX + badgeWidth - badgeRadius, badgeY + badgeHeight);
      ctx.lineTo(badgeX + badgeRadius, badgeY + badgeHeight);
      ctx.quadraticCurveTo(badgeX, badgeY + badgeHeight, badgeX, badgeY + badgeHeight - badgeRadius);
      ctx.lineTo(badgeX, badgeY + badgeRadius);
      ctx.quadraticCurveTo(badgeX, badgeY, badgeX + badgeRadius, badgeY);
      ctx.closePath();
      ctx.fill();
      
      // Draw price text
      ctx.fillStyle = "#FAFAFA";
      ctx.font = "bold 13px 'Geist Mono',monospace";
      ctx.textAlign = "left";
      ctx.fillText(`$${price.toFixed(priceDecimals)}`, badgeX + 8, currentPriceDotY + 4);

      // Connection status indicator
      ctx.fillStyle = isConnected ? "#00ff24" : "#ff3333";
      ctx.font = "12px 'Geist Mono',monospace";
      ctx.textAlign = "left";
      // Order placement status
      if (isPlacingOrder) {
        ctx.fillStyle = "#ffa500";
        ctx.font = "12px 'Geist Mono',monospace";
        ctx.textAlign = "left";
        ctx.fillText("🔄 Placing Order...", 20, 50);
      }

      // Time labels on top
      ctx.fillStyle = "rgba(238, 237, 236, 1)";
      ctx.font = "300 13px 'Geist Mono',monospace,monospace";
      ctx.textAlign = "center";
      for (let i = -Math.ceil(w / gridW) - 1; i < Math.ceil(w / gridW) + 2; i++) {
        const x = centerX + i * gridW - offsetX;
        const timeOffset = i * GRID_SEC;
        const tOffsetSec = timeOffset - (now % GRID_SEC);
        const tCell = now + tOffsetSec - timeOffsetRef.current;
        const secondsFromNow = Math.round(tCell - now);
        const label =
          secondsFromNow === 0
            ? "0s"
            : secondsFromNow > 0
            ? `+${secondsFromNow}s`
            : `${secondsFromNow}s`;
        ctx.fillText(label, x, 15);
      }

      // Draw multiplier and bet count on all visible cells
      const xOriginForCells = centerX - offsetX;
      
      // Calculate visible price range based on viewport and scroll offset
      const cellVisiblePriceRange = h / pxPerPrice;
      const cellTopVisiblePrice = price + priceOffset + cellVisiblePriceRange / 2;
      const cellBottomVisiblePrice = price + priceOffset - cellVisiblePriceRange / 2;
      const startPriceForCells = Math.floor(cellBottomVisiblePrice / priceStep) * priceStep;
      const numPriceLevelsForCells = Math.ceil(cellVisiblePriceRange / priceStep) + 4; // +4 for buffer
      
      // Get hover info for comparison
      const currentHover = hoverRef.current;
      
      for (let i = -Math.ceil(w / gridW) - 1; i < Math.ceil(w / gridW) + 2; i++) {
        const cellX = Math.round(xOriginForCells + i * gridW);
        
        // Calculate timeperiod for this cell (needed for settlement check)
        const cellTime = now + (i * GRID_SEC) - timeOffsetRef.current;
        const timeperiodId = Math.floor(cellTime / GRID_SEC) * GRID_SEC;
        
        // Draw for ALL visible price levels (based on scroll position)
        for (let j = 0; j < numPriceLevelsForCells; j++) {
          const priceLevel = startPriceForCells + j * priceStep;
          const cellY = Math.round(h / 2 - (priceLevel - price - priceOffset) * pxPerPrice);
          
          // Check if cell is visible on screen
          if (cellY + gridH < 0 || cellY > h) continue;
          
          // Build grid IDs early to check for settlements
          const priceMin1 = priceLevel - priceStep;
          const priceMax1 = priceLevel;
          const gridId1 = `${timeperiodId}_${priceMin1.toFixed(2)}_${priceMax1.toFixed(2)}`;
          const gridId2 = `${timeperiodId}_${(priceLevel - priceStep).toFixed(2)}_${priceLevel.toFixed(2)}`;
          
          // Check for settlement state BEFORE skipping (so settlement cells stay visible)
          const settlementState = otherUsersSettlementsRef.current.get(gridId1) 
            || otherUsersSettlementsRef.current.get(gridId2);
          
          // Quick check for other users' bets (to keep those cells visible too)
          const hasOtherUsersBetsQuick = !!(allUsersBetsRef.current.get(gridId1) || allUsersBetsRef.current.get(gridId2));
          
          const touchesNowLine = cellX <= nowLineX && cellX + gridW >= nowLineX;
          const isPastCell = cellX + gridW < nowLineX;
          
          // Skip cells past/touching NOW line UNLESS they have settlements or other users' bets
          if ((touchesNowLine || isPastCell) && !settlementState && !hasOtherUsersBetsQuick) {
            continue;
          }
          
          // Skip drawing multiplier if this is the EXACT hovered cell
          // We need to check if this cell's visual position matches the hover position
          let isHoveredCell = false;
          if (currentHover) {
            // Calculate the hovered cell's position
            const hoverCenterX = centerX + (currentHover.t - now) * pxPerSec;
            const hoverLeft = Math.round(hoverCenterX - gridW / 2);
            const basePriceForHover = Math.floor(price / priceStep) * priceStep;
            const hoverTop = Math.round(h / 2 - (basePriceForHover - price - priceOffset) * pxPerPrice + currentHover.gyIndex * gridH);
            
            // Check if this cell overlaps with the hover cell (within a small tolerance)
            const xMatch = Math.abs(cellX - hoverLeft) < 2;
            const yMatch = Math.abs(cellY - hoverTop) < 2;
            
            isHoveredCell = xMatch && yMatch;
          }
          
          if (isHoveredCell) {
            // console.log('Skipping hovered cell at:', { cellX, cellY });
            continue; // Skip this cell, will be drawn in hover section
          }
          
          // Calculate time until start and get time bucket for cache
          // Now correctly reflects the time until the VISUAL cell starts (accounting for pan offset)
          const timeUntilStart = timeperiodId - now;
          const timeBucket = getTimeBucket(timeUntilStart);
          const cacheKey = `${timeperiodId}_${priceLevel.toFixed(priceDecimals)}_${timeBucket}`;
          
          // Get cached multiplier or use quick estimate
          const cached = multiplierCache.current.get(cacheKey);
          
          // Always recalculate if time bucket might have changed or cache is stale
          let multiplier: number;
          if (cached && (Date.now() - cached.timestamp) < MULTIPLIER_CACHE_TTL) {
            multiplier = cached.multiplier;
          } else {
            // Use quick calculation (immediate, no database call)
            multiplier = getQuickMultiplier(timeperiodId);
            
            // Trigger async fetch for database value if not already fetching
            if (!multiplierFetchQueue.current.has(cacheKey)) {
              getCellMultiplier(timeperiodId, priceLevel).catch(err => 
                console.debug('Failed to fetch multiplier:', err)
              );
            }
          }
          
          // Get bet count for this grid
          const betCount = getCellBetCount(timeperiodId, priceLevel);
          
          // Check if this cell is selected (to skip drawing corner multiplier)
          // MUST match the cellKey format used in getCellAtPosition()
          const snappedCellTime = Math.floor(cellTime / GRID_SEC) * GRID_SEC + GRID_SEC / 2;
          const cellKey = `${Math.round(snappedCellTime * 10)}_${priceLevel.toFixed(priceDecimals)}`;
          const isSelectedCell = selectedCellsRef.current.has(cellKey);
          
          // Only draw corner multiplier if cell is NOT selected
          // (Hover overlay will draw its own centered multiplier on top)
          if (!isSelectedCell) {
            // Check if other users have bets on this grid - if so, show RED nextUserMultiplier
            // Try multiple gridId formats to match realtimeBets (which uses 2 decimals)
            // Format 1: priceLevel ± priceStep/2 (centered on priceLevel)
            const priceMin1 = priceLevel - priceStep;
            const priceMax1 = priceLevel;
            const gridId1 = `${timeperiodId}_${priceMin1.toFixed(2)}_${priceMax1.toFixed(2)}`;
            
            // Format 2: priceLevel - priceStep to priceLevel (matches getCellBetCount logic)
            const priceMin2 = priceLevel - priceStep;
            const priceMax2 = priceLevel;
            const gridId2 = `${timeperiodId}_${priceMin2.toFixed(2)}_${priceMax2.toFixed(2)}`;
            

            let otherUsersBets = allUsersBetsRef.current.get(gridId1);
if (!otherUsersBets) {
  otherUsersBets = allUsersBetsRef.current.get(gridId2);
}
            // Check both formats (realtimeBets uses 2 decimals, so try both)
            
            if (!otherUsersBets || otherUsersBets.length === 0) {
              const allMatchingBets: UserBet[] = [];
              for (const [gridId, bets] of Array.from(allUsersBetsRef.current.entries())) {
                const bet = bets[0];
                if (bet && bet.timeperiod_id === timeperiodId) {
                  const priceTolerance = priceStep / 10;
                  if (Math.abs(bet.price_level - priceLevel) < priceTolerance) {
                    // Add ALL bets from this grid, not just the first one
                    allMatchingBets.push(...bets);
                  }
                }
              }
              if (allMatchingBets.length > 0) {
                otherUsersBets = allMatchingBets;
              }
            }
            
            // Also check all bets by parsing grid_id to get exact price range
            // This handles cases where gridId format might differ slightly
            if (!otherUsersBets || otherUsersBets.length === 0) {
              for (const [gridId, bets] of Array.from(allUsersBetsRef.current.entries())) {
                const bet = bets[0];
                if (bet && bet.timeperiod_id === timeperiodId) {
                  // Only show multiplier in the EXACT cell where the bet was placed
                  // Match by price_level (center of the bet's price range) with small tolerance
                  const priceTolerance = priceStep / 10; // Very small tolerance for floating point comparison
                  if (Math.abs(bet.price_level - priceLevel) < priceTolerance) {
                    otherUsersBets = bets;
                    break;
                  }
                }
              }
            }

            // Check for settlement state (win/loss) for other users' bets
            const settlementState = otherUsersSettlementsRef.current.get(gridId1) 
              || otherUsersSettlementsRef.current.get(gridId2);
            const touchesNowLine = cellX <= nowLineX && cellX + gridW >= nowLineX;
            const isPastCell = cellX + gridW < nowLineX;
            const hasOtherUsersBets = !!(otherUsersBets && otherUsersBets.length > 0);
            
            // Keep drawing grids that have other users' bets or settlements even after NOW line
            if ((touchesNowLine || isPastCell) && !hasOtherUsersBets && !settlementState) {
              continue;
            }
            
            // Draw win/loss highlight for other users' settled bets
            if (settlementState) {
              const isWin = settlementState.status === 'win';
              ctx.save();
              ctx.lineWidth = 2;
              ctx.strokeStyle = isWin ? "#4ADE80" : "#F87171";
              ctx.fillStyle = isWin ? "rgba(74, 222, 128, 0.12)" : "rgba(248, 113, 113, 0.12)";
              ctx.fillRect(cellX, cellY, gridW, gridH);
              ctx.strokeRect(cellX, cellY, gridW, gridH);
              
              // Draw bet count badge for settlement cells
              const settlementBetCount = otherUsersBets && otherUsersBets.length > 0 
                ? otherUsersBets.length 
                : betCount;
              
              if (settlementBetCount > 0) {
                const badgeY = Math.round(cellY + gridH - 12);
                const badgeHeight = 11;
                const iconSize = 10;
                const badgeWidth = iconSize + 4 + (settlementBetCount.toString().length * 6) + 8;
                const badgeX = Math.round(cellX + gridW / 2 - badgeWidth / 2);
                
                // Draw badge background with win/loss color
                ctx.fillStyle = isWin ? "rgba(74, 222, 128, 0.9)" : "rgba(248, 113, 113, 0.9)";
                ctx.beginPath();
                ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 12);
                ctx.fill();
                
                // Draw user icon
                const iconX = badgeX + 4;
                const badgeCenterY = Math.round(badgeY + badgeHeight / 2);
                const iconY = Math.round(badgeCenterY - iconSize / 2);
                drawPersonIcon(ctx, iconX, iconY, iconSize, "#ffffff");
                
                // Draw bet count
                ctx.fillStyle = "#ffffff";
                ctx.font = "10px 'Geist Mono',monospace";
                ctx.textAlign = "left";
                ctx.textBaseline = "middle";
                ctx.fillText(`${settlementBetCount}`, iconX + iconSize + 2, badgeCenterY);
              }
              
              ctx.restore();
            } else if (hasOtherUsersBets) {
              // ctx.strokeStyle = "#3B82F6"; // Blue color
              // ctx.lineWidth = 2;
              // ctx.strokeRect(cellX, cellY, gridW, gridH);
            }
            
            let displayMultiplier = multiplier;
            let multiplierColor = "#ffffff"; // Default white
            
            // If other users have bets, calculate and show RED nextUserMultiplier
            if (otherUsersBets && otherUsersBets.length > 0) {
              const totalShares = otherUsersBets.reduce((sum, bet) => sum + bet.shares, 0);
              const existingSharesBigInt = toShareFormat(totalShares);
              const nextPricePerShare = calculatePricePerShare(existingSharesBigInt, timeperiodId);
              const nextUserMultiplier = getMultiplierValue(nextPricePerShare);
              displayMultiplier = nextUserMultiplier;
              multiplierColor = "#FFDA00"; // RED color

              // ctx.strokeStyle = "#3B82F6"; // Blue color
              // ctx.lineWidth = 2;
              // ctx.strokeRect(cellX, cellY, gridW, gridH);
              
              // Debug logging (can be removed later)
              if (Math.random() < 0.01) { // Log 1% of the time to avoid spam
                console.log('🔴 Showing RED multiplier:', {
                  timeperiodId,
                  priceLevel,
                  gridId1,
                  gridId2,
                  foundBets: otherUsersBets.length,
                  nextUserMultiplier: nextUserMultiplier.toFixed(2)
                });
              }
            }
            
            // Draw multiplier (red if other users bet, white otherwise)
            ctx.fillStyle = multiplierColor;
            ctx.font = "10px 'Geist Mono',monospace";
            ctx.textAlign = "left";
            
            // Add pulsing glow effect for yellow multiplier (#FFDA00)
            if (multiplierColor === "#FFDA00") {
              const pulseIntensity = (Math.sin(Date.now() / 500) + 1) / 2; // 0 to 1, ~1 second cycle
              const glowIntensity = 0.7 + (pulseIntensity * 0.3); // Pulse between 0.7 and 1.0 (very bright)
              // Draw multiple layers for stronger glow effect
              ctx.shadowBlur = 50 * glowIntensity; // Much larger blur for visible glow
              ctx.shadowColor = "#FFDA00";
              // Draw the text multiple times with different blur levels for layered glow
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellX + 4, cellY + 12);
              ctx.shadowBlur = 30 * glowIntensity;
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellX + 4, cellY + 12);
              ctx.shadowBlur = 15 * glowIntensity;
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellX + 4, cellY + 12);
              // Final draw without shadow for crisp text
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellX + 4, cellY + 12);
            } else {
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellX + 4, cellY + 12);
            }
            
            // Reset shadow after drawing
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
          }
          
          // Draw bet count if > 1 (with user icon)
          if (betCount > 1) {
            // Draw background pill
            ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
            ctx.beginPath();
            ctx.roundRect(cellX + 4, cellY + 16, 20, 10, 6);
            ctx.fill();
            
            // Draw user icon (simplified)
            ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
            drawPersonIcon(ctx, cellX + 6, cellY + 20, 6);
            
            // Draw count
            ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
            ctx.font = "6px 'Geist Mono',monospace";
            ctx.fillText(`${betCount}`, cellX + 14, cellY + 24);
          }
        }
      }

      // Draw all selected cells with state-based colors
      selectedCellsRef.current.forEach((selected, cellKey) => {
        const selCenterX = centerX + (selected.t - now) * pxPerSec + (timeOffsetRef.current * pxPerSec);
        const selLeft = Math.round(selCenterX - gridW / 2);
        const selRight = selLeft + gridW;
        const selTop = Math.round(h / 2 - (selected.priceLevel - price - priceOffset) * pxPerPrice);

        if (selLeft + gridW >= 0 && selLeft <= w && selTop + gridH >= 0 && selTop <= h) {
          const isTouchingOrCrossedNowLine = selLeft <= nowLineX;
          
          // Handle fade out animation for lost bets
          if (selected.status === 'lost') {
            const elapsed = now * 1000 - selected.timestamp;
            const visibleDuration = 20000; // Stay visible for 20 seconds
            const fadeDuration = 850; // Then fade out over 850ms
            const totalDuration = visibleDuration + fadeDuration;
            
            if (elapsed >= totalDuration) {
              // Remove after fade completes
              selectedCellsRef.current.delete(cellKey);
              return;
            }
            
            // Stay at full opacity for 1 minute, then fade
            const alpha = elapsed < visibleDuration ? 1 : 1 - ((elapsed - visibleDuration) / fadeDuration);
            // Red state from Figma
            ctx.fillStyle = `rgba(255, 94, 94, ${0.1 * alpha})`;
            ctx.fillRect(selLeft, selTop, gridW, gridH);
            ctx.strokeStyle = `rgba(255, 94, 94, ${0.6 * alpha})`;
            ctx.lineWidth = 1;
            ctx.strokeRect(selLeft, selTop, gridW, gridH);
            
            // Draw corner indicators with fade
            const cornerSize = 5.5;
            ctx.strokeStyle = `rgba(255, 94, 94, ${alpha})`;
            ctx.lineWidth = 1;
            
            // Top-left
            ctx.beginPath();
            ctx.moveTo(selLeft, selTop + cornerSize);
            ctx.lineTo(selLeft, selTop);
            ctx.lineTo(selLeft + cornerSize, selTop);
            ctx.stroke();
            
            // Top-right
            ctx.beginPath();
            ctx.moveTo(selLeft + gridW - cornerSize, selTop);
            ctx.lineTo(selLeft + gridW, selTop);
            ctx.lineTo(selLeft + gridW, selTop + cornerSize);
            ctx.stroke();
            
            // Bottom-left
            ctx.beginPath();
            ctx.moveTo(selLeft, selTop + gridH - cornerSize);
            ctx.lineTo(selLeft, selTop + gridH);
            ctx.lineTo(selLeft + cornerSize, selTop + gridH);
            ctx.stroke();
            
            // Bottom-right
            ctx.beginPath();
            ctx.moveTo(selLeft + gridW - cornerSize, selTop + gridH);
            ctx.lineTo(selLeft + gridW, selTop + gridH);
            ctx.lineTo(selLeft + gridW, selTop + gridH - cornerSize);
            ctx.stroke();
            
            // Draw multiplier and payout with fade
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
            ctx.textAlign = "center";
            
            // Show multiplier and payout if available
            if (selected.multiplier && selected.payout) {
              // Calculate all positions from rounded selTop to ensure integer pixels
              const multiplierY = Math.round(selTop + gridH / 2 - 12);
              const amountY = Math.round(selTop + gridH / 2 + 4);
              
              // Draw multiplier - match yellow cell font
              ctx.font = "200 11px 'Geist Mono',monospace";
              ctx.fillText(`${selected.multiplier.toFixed(2)}X`, selLeft + gridW / 2, multiplierY);
              
              // Draw payout amount - match yellow cell font
              ctx.font = "300 14px 'Geist Mono',monospace";
              ctx.fillText(`$${selected.payout.toFixed(2)}`, selLeft + gridW / 2, amountY);
            } else {
              // Fallback
              const amountY = Math.round(selTop + gridH / 2 + 4);
              ctx.font = "600 12px 'Geist Mono',monospace";
              ctx.fillText(`$${selected.priceLevel.toFixed(priceDecimals)}`, selLeft + gridW / 2, amountY);
            }
            ctx.textAlign = "left";
            
            // Draw red bet count badge - match yellow badge styling
            // Get actual bet count for this cell (include current user's bet + other users' bets)
            const selectedTimeperiodId = Math.floor(selected.t / GRID_SEC) * GRID_SEC;
            const otherUsersBetCount = getCellBetCount(selectedTimeperiodId, selected.priceLevel);
            // Include current user's bet (1) if this cell is selected
            const selectedBetCount = otherUsersBetCount + 1;
            
            const badgeRed = Math.round(selTop + gridH - 12);
            const badgeY = Math.round(badgeRed - 2);
            ctx.fillStyle = `rgba(255, 94, 94, ${alpha})`;
            ctx.beginPath();
            const badgeWidth = 30;
            const badgeHeight = 11;
            const badgeRadius = 12;
            ctx.roundRect(Math.round(selLeft + gridW / 2 - badgeWidth / 2), badgeY, badgeWidth, badgeHeight, badgeRadius);
            ctx.fill();
            
            const iconSize = 10;
            const iconX = Math.round(selLeft + gridW / 2 - badgeWidth / 2 + 4);
            const badgeCenterY = Math.round(badgeY + badgeHeight / 2);
            const iconY = Math.round(badgeCenterY - iconSize / 2);
            // Draw white icon for red badge
            drawPersonIcon(ctx, iconX, iconY, iconSize, "#ffffff");
            ctx.fillStyle = "#ffffff";
            ctx.font = "10px 'Geist Mono',monospace";
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText(`${selectedBetCount}`, iconX + iconSize + 2, badgeCenterY);
            
            return;
          }
          
          // State-based rendering
          switch (selected.status) {
            case 'pending':
              // Hover state styling with spinner
              ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
              ctx.fillRect(selLeft, selTop, gridW, gridH);
              ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
              ctx.lineWidth = 2;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Draw multiplier and payout in center (white text)
              ctx.fillStyle = "#fff";
              ctx.textAlign = "center";
              
              // console.log('========== RENDERING PENDING CELL ==========');
              // console.log('Cell has multiplier:', selected.multiplier);
              // console.log('Cell has payout:', selected.payout);
              // console.log('Cell has nextUserMultiplier:', selected.nextUserMultiplier);
              // console.log('===========================================');
              
              if (selected.multiplier && selected.payout) {
                // Calculate all positions from rounded selTop to ensure integer pixels
                const multiplierY = Math.round(selTop + gridH / 2 - 12);
                const amountY = Math.round(selTop + gridH / 2 + 6);
                
                // Draw current user multiplier (white, larger, bold)
                ctx.font = "200 11px 'Geist Mono',monospace";
                ctx.fillText(`${selected.multiplier.toFixed(2)}X`, selLeft + gridW / 2, multiplierY);
                
                // Draw payout amount
                ctx.font = "300 15px 'Geist Mono',monospace";
                ctx.fillText(`$${selected.payout.toFixed(2)}`, selLeft + gridW / 2, amountY);
                
                // Draw next user's multiplier (RED) below - only for pending (calculating...)
                // Will show real value after confirmation
                // ctx.fillStyle = "#888888";
                // ctx.font = "200 8px 'Geist Mono',monospace";
                // ctx.fillText(`Next: calculating...`, selLeft + gridW / 2, selTop + gridH / 2 + 22);
              }
              ctx.textAlign = "left";
              
              // Draw spinner in top-right corner
              drawSpinner(ctx, selLeft + gridW - 10, selTop + 10, 8);
              break;
              
            case 'confirmed': {
              // Yellow color for confirmed orders (from Figma)
              ctx.fillStyle = "rgba(255, 218, 0, 0.1)";
              ctx.fillRect(selLeft, selTop, gridW, gridH);
              ctx.strokeStyle = "rgba(255, 218, 0, 0.6)";
              ctx.lineWidth = 1;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Draw corner indicators
              const cornerSize = 5.5;
              ctx.strokeStyle = "#FFDA00";
              ctx.lineWidth = 1;
              
              // Top-left
              ctx.beginPath();
              ctx.moveTo(selLeft, selTop + cornerSize);
              ctx.lineTo(selLeft, selTop);
              ctx.lineTo(selLeft + cornerSize, selTop);
              ctx.stroke();
              
              // Top-right
              ctx.beginPath();
              ctx.moveTo(selLeft + gridW - cornerSize, selTop);
              ctx.lineTo(selLeft + gridW, selTop);
              ctx.lineTo(selLeft + gridW, selTop + cornerSize);
              ctx.stroke();
              
              // Bottom-left
              ctx.beginPath();
              ctx.moveTo(selLeft, selTop + gridH - cornerSize);
              ctx.lineTo(selLeft, selTop + gridH);
              ctx.lineTo(selLeft + cornerSize, selTop + gridH);
              ctx.stroke();
              
              // Bottom-right
              ctx.beginPath();
              ctx.moveTo(selLeft + gridW - cornerSize, selTop + gridH);
              ctx.lineTo(selLeft + gridW, selTop + gridH);
              ctx.lineTo(selLeft + gridW, selTop + gridH - cornerSize);
              ctx.stroke();
              
              // Draw multiplier and payout in center
              ctx.fillStyle = "#fff";
              ctx.textAlign = "center";
              
              // Show multiplier and payout if available
              if (selected.multiplier && selected.payout) {
                // Calculate all positions from rounded selTop to ensure integer pixels
                const multiplierY = Math.round(selTop + gridH / 2 - 12);
                const amountY = Math.round(selTop + gridH / 2 + 4);
                
                // Draw current user multiplier (white, larger, bold)
                ctx.font = "200 11px 'Geist Mono',monospace";
                ctx.fillText(`${selected.multiplier.toFixed(2)}X`, selLeft + gridW / 2, multiplierY);
                
                // Draw payout amount - positioned to create equal spacing with multiplier and badge
                ctx.font = "300 14px 'Geist Mono',monospace";
                ctx.fillText(`$${selected.payout.toFixed(2)}`, selLeft + gridW / 2, amountY);
                
                // Draw next user's multiplier (RED) below - REAL value after confirmation
                if (selected.nextUserMultiplier) {
                  // console.log(`>>> DRAWING REAL RED MULTIPLIER: ${selected.nextUserMultiplier.toFixed(2)}X`);
                  ctx.fillStyle = "#FF4444";
                  ctx.font = "bold 12px 'Geist Mono',monospace";  // Bigger and bold
                  // ctx.fillText(`Next: ${selected.nextUserMultiplier.toFixed(2)}X`, selLeft + gridW / 2, selTop + gridH / 2 + 22);
                } else {
                //   // Still loading
                // //   ctx.fillStyle = "#888888";
                // //   ctx.font = "200 8px 'Geist Mono',monospace";
                // //   ctx.fillText(`Next: loading...`, selLeft + gridW / 2, selTop + gridH / 2 + 22);
                }
              } else {
                // Fallback to price
                const amountY = Math.round(selTop + gridH / 2 + 4);
                ctx.font = "600 12px 'Geist Mono',monospace";
                ctx.fillText(`$${selected.priceLevel.toFixed(priceDecimals)}`, selLeft + gridW / 2, amountY);
              }
              ctx.textAlign = "left";
              
              // Draw yellow bet count badge at bottom with proper spacing from text
              // Get actual bet count for this cell (include current user's bet + other users' bets)
              const selectedTimeperiodId = Math.floor(selected.t / GRID_SEC) * GRID_SEC;
              const otherUsersBetCount = getCellBetCount(selectedTimeperiodId, selected.priceLevel);
              // Include current user's bet (1) if this cell is selected
              const selectedBetCount = otherUsersBetCount + 1;
              
              // Calculate badge position from rounded selTop and round it
              const badgeYellow = Math.round(selTop + gridH - 12);
              const badgeY = Math.round(badgeYellow - 2);
              ctx.fillStyle = "#FFDA00";
              ctx.beginPath();
              const badgeWidth = 30;
              const badgeHeight = 11;
              const badgeRadius = 12; // Canvas will clamp this to height/2
              ctx.roundRect(Math.round(selLeft + gridW / 2 - badgeWidth / 2), badgeY, badgeWidth, badgeHeight, badgeRadius);
              ctx.fill();
              
              ctx.fillStyle = "#0b0b0b";
              const iconSize = 10;
              const iconX = Math.round(selLeft + gridW / 2 - badgeWidth / 2 + 4);
              const badgeCenterY = Math.round(badgeY + badgeHeight / 2);
              const iconY = Math.round(badgeCenterY - iconSize / 2);
              drawPersonIcon(ctx, iconX, iconY, iconSize);
              ctx.font = "10px 'Geist Mono',monospace";
              ctx.textAlign = "left";
              ctx.textBaseline = "middle";
              ctx.fillText(`${selectedBetCount}`, iconX + iconSize + 2, badgeCenterY);
              break;
            }
              
            case 'won': {
              const elapsedWin = now * 1000- selected.timestamp;
              const pulseDuration = 3000; // 2 second pulse animation
              const pulseProgress = Math.min(elapsedWin / pulseDuration, 1);
              
              // Draw expanding green pulse rings
              const maxPulseRadius = gridW * 1.5;
              const numPulses = 3;
              for (let p = 0; p < numPulses; p++) {
                const pulseDelay = p * 200; // Stagger pulses
                const pulseElapsed = elapsedWin - pulseDelay;
                if (pulseElapsed > 0 && pulseElapsed < pulseDuration) {
                  const pulseAlpha = 1 - (pulseElapsed / pulseDuration);
                  const pulseRadius = (pulseElapsed / pulseDuration) * maxPulseRadius;
                  
                  ctx.strokeStyle = `rgba(0, 255, 36, ${0.4 * pulseAlpha})`;
                  ctx.lineWidth = 2;
                  ctx.beginPath();
                  ctx.arc(selLeft + gridW / 2, selTop + gridH / 2, pulseRadius, 0, Math.PI * 2);
                  ctx.stroke();
                }
              }
              
              // Green profit state from Figma
              ctx.fillStyle = "rgba(0, 255, 36, 0.3)";
              ctx.fillRect(selLeft, selTop, gridW, gridH);
              ctx.strokeStyle = "rgba(0, 255, 36, 0.3)";
              ctx.lineWidth = 1;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Draw corner indicators
              const cornerSizeWon = 5.5;
              ctx.strokeStyle = "#00ff24";
              ctx.lineWidth = 1;
              
              // Top-left
              ctx.beginPath();
              ctx.moveTo(selLeft, selTop + cornerSizeWon);
              ctx.lineTo(selLeft, selTop);
              ctx.lineTo(selLeft + cornerSizeWon, selTop);
              ctx.stroke();
              
              // Top-right
              ctx.beginPath();
              ctx.moveTo(selLeft + gridW - cornerSizeWon, selTop);
              ctx.lineTo(selLeft + gridW, selTop);
              ctx.lineTo(selLeft + gridW, selTop + cornerSizeWon);
              ctx.stroke();
              
              // Bottom-left
              ctx.beginPath();
              ctx.moveTo(selLeft, selTop + gridH - cornerSizeWon);
              ctx.lineTo(selLeft, selTop + gridH);
              ctx.lineTo(selLeft + cornerSizeWon, selTop + gridH);
              ctx.stroke();
              
              // Bottom-right
              ctx.beginPath();
              ctx.moveTo(selLeft + gridW - cornerSizeWon, selTop + gridH);
              ctx.lineTo(selLeft + gridW, selTop + gridH);
              ctx.lineTo(selLeft + gridW, selTop + gridH - cornerSizeWon);
              ctx.stroke();
              
              // Draw multiplier and price/payout in green
              ctx.fillStyle = "#76ff5e";
              ctx.textAlign = "center";
              
              // Show multiplier and payout if available
              if (selected.multiplier && selected.payout) {
                // Calculate all positions from rounded selTop to ensure integer pixels
                const multiplierY = Math.round(selTop + gridH / 2 - 12);
                const amountY = Math.round(selTop + gridH / 2 + 4);
                
                // Draw multiplier - match yellow cell font
                ctx.font = "200 11px 'Geist Mono',monospace";
                ctx.fillText(`${selected.multiplier.toFixed(2)}X`, selLeft + gridW / 2, multiplierY+4);
                
                // Draw payout amount - match yellow cell font
                ctx.font = "300 14px 'Geist Mono',monospace";
                ctx.fillText(`$${selected.payout.toFixed(2)}`, selLeft + gridW / 2, amountY+9);
              } else {
                // Fallback
                const amountY = Math.round(selTop + gridH / 2 + 4);
                ctx.font = "600 12px 'Geist Mono',monospace";
                ctx.fillText(`$${selected.priceLevel.toFixed(priceDecimals)}`, selLeft + gridW / 2, amountY);
              }
              
              // Draw sliding payout text (powerup style)
              const payoutDuration = 2000; // 1.5 seconds
              if (elapsedWin < payoutDuration) {
                const payoutProgress = elapsedWin / payoutDuration;
                const slideDistance = 80; // pixels to slide up
                const payoutY = selTop - (payoutProgress * slideDistance);
                const payoutAlpha = 1 - payoutProgress;
                
                // Calculate payout profit (payout - betAmount)
                const profit = selected.payout && selected.betAmount 
                ? selected.payout - selected.betAmount 
                : selected.payout || 0;
              const payoutText = `+$${profit.toFixed(2)}`;
                
                // Draw gradient text with stroke (simulating the CSS gradient)
                ctx.save();
                
                // Create gradient for text fill
                const gradient = ctx.createLinearGradient(
                  selLeft + gridW / 2,
                  payoutY - 12,
                  selLeft + gridW / 2,
                  payoutY + 12
                );
                gradient.addColorStop(0, '#A0FFAD');
                gradient.addColorStop(0.54, '#00B019');
                gradient.addColorStop(1, '#FAFAFA');
                
                ctx.font = "italic 800 24px 'Geist Mono',monospace";
                ctx.textAlign = "center";
                ctx.letterSpacing = "-2px";
                
                // Draw white stroke
                ctx.strokeStyle = `rgba(255, 255, 255, ${payoutAlpha})`;
                ctx.lineWidth = 3;
                ctx.strokeText(payoutText, selLeft + gridW / 2, payoutY);
                
                // Draw gradient fill
                ctx.globalAlpha = payoutAlpha;
                ctx.fillStyle = gradient;
                ctx.fillText(payoutText, selLeft + gridW / 2, payoutY);
                
                ctx.restore();
              }
              
              ctx.textAlign = "left";
              
              
             
           
              
              
              break;
            }
              
            default:
              // Fallback to old behavior
              if (isTouchingOrCrossedNowLine) {
                ctx.fillStyle = "rgba(255,0,0,0.15)";
                ctx.fillRect(selLeft, selTop, gridW, gridH);
                ctx.strokeStyle = "rgba(255,0,0,0.9)";
              } else {
                ctx.fillStyle = "rgba(255, 218, 0, 0.31)";
                ctx.fillRect(selLeft, selTop, gridW, gridH);
                ctx.strokeStyle = "#FFDA00";
              }
              ctx.lineWidth = 1.5;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
          }
        }
      });

      // Draw ALL USERS' BETS with semi-transparent styling
      if (allUsersBetsRef.current.size > 0) {
        allUsersBetsRef.current.forEach((bets, gridId) => {
          if (bets.length === 0) return;
          
          // Parse grid_id to get timeperiod_id and price range
          // Format: "timeperiod_priceMin_priceMax" e.g., "1762348865_40.99_41.05"
          const parts = gridId.split('_');
          if (parts.length < 3) return;
          
          const timeperiodId = parseInt(parts[0]);
          const priceMin = parseFloat(parts[1]);
          const priceMax = parseFloat(parts[2]);
          
          // Calculate the priceLevel using the SAME snapping logic as clicks
          // The database has exact prices, but we need to map to the grid cell
          const midpoint = (priceMin + priceMax) / 2;
          // Snap to grid: round down to nearest priceStep, then add priceStep
          const priceLevel = Math.floor(midpoint / priceStep) * priceStep + priceStep;
          
          // Calculate cell position - use the CENTER of the 5-second period
          // timeperiodId is the START of the period, so add 2.5 to get center
          const cellTime = timeperiodId + 2.5;
          const selCenterX = centerX + (cellTime - now) * pxPerSec + (timeOffsetRef.current * pxPerSec);
          const selLeft = Math.round(selCenterX - gridW / 2);
          
          // Calculate Y position - align with grid lines
          const selTop = Math.round(h / 2 - (priceLevel - price - priceOffset) * pxPerPrice);
          
          // Round to nearest pixel to avoid sub-pixel rendering artifacts
          const selLeftRounded = selLeft;
          const selTopRounded = selTop;
          
          // Only draw if the cell is visible on screen
          if (selLeftRounded + gridW >= 0 && selLeftRounded <= w && selTopRounded + gridH >= 0 && selTopRounded <= h) {
            // Calculate total stats
            const totalAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);
            const totalShares = bets.reduce((sum, bet) => sum + bet.shares, 0);
            const bettorCount = new Set(bets.map(b => b.user_address)).size;
            const avgMultiplier = bets.length > 0 
              ? bets.reduce((sum, bet) => sum + bet.multiplier, 0) / bets.length 
              : 0;
            
            // Calculate what NEXT user will see
            const existingSharesBigInt = toShareFormat(totalShares);
            const nextPricePerShare = calculatePricePerShare(existingSharesBigInt, timeperiodId);
            const nextUserMultiplier = getMultiplierValue(nextPricePerShare);
            
            // Blue overlay and border removed - only show multiplier text
            
            // Draw NEXT multiplier centered in RED
            ctx.fillStyle = "#FF4444";  // Bright red
            ctx.font = "bold 14px 'Geist Mono',monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const centerX = selLeftRounded + gridW / 2;
            const centerY = selTopRounded + gridH / 2;
            // ctx.fillText(`Next: ${nextUserMultiplier.toFixed(2)}x`, centerX, centerY);
            
            // Reset styles
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
          }
        });
      }

      // Draw drag indicator
      if (isDraggingRef.current) {
        ctx.fillStyle = "rgba(255, 218, 0, 0.31)";
        ctx.strokeStyle = "rgba(255, 200, 0, 0.5)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        // Draw a visual hint at the top showing drag mode is active
        ctx.fillRect(0, 0, w, 5);
        ctx.setLineDash([]);
      }

      // Draw hover cell (white state from Figma)
      const hover = hoverRef.current;
      if (hover && !isDraggingRef.current && !isPanning2DRef.current) {
        // Use the same calculation as selected cells to ensure alignment
        const hoverCenterX = centerX + (hover.t - now) * pxPerSec;
        const hoverLeft = Math.round(hoverCenterX - gridW / 2);
        const basePriceHover = Math.floor(price / priceStep) * priceStep;
        const hoverTop = Math.round(h / 2 - (basePriceHover - price - priceOffset) * pxPerPrice + hover.gyIndex * gridH);
        const priceLevel = basePriceHover - hover.gyIndex * priceStep;  // Changed: subtract instead of add
        const cellKey = `${Math.round(hover.t * 10)}_${priceLevel.toFixed(priceDecimals)}`;
        const isSelected = selectedCellsRef.current.has(cellKey);

        if (hoverLeft + gridW >= 0 && hoverLeft <= w && hoverTop + gridH >= 0 && hoverTop <= h && !isSelected) {
          // White hover state background
          ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
          ctx.fillRect(hoverLeft, hoverTop, gridW, gridH);
          
          // White border
          ctx.strokeStyle = "rgba(217, 217, 217, 0.1)";
          ctx.lineWidth = 1;
          ctx.strokeRect(hoverLeft, hoverTop, gridW, gridH);
          
          // Draw corner indicators (small L shapes)
          const cornerSize = 5.5;
          ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
          ctx.lineWidth = 1;
          
          // Top-left corner
          ctx.beginPath();
          ctx.moveTo(hoverLeft, hoverTop + cornerSize);
          ctx.lineTo(hoverLeft, hoverTop);
          ctx.lineTo(hoverLeft + cornerSize, hoverTop);
          ctx.stroke();
          
          // Top-right corner
          ctx.beginPath();
          ctx.moveTo(hoverLeft + gridW - cornerSize, hoverTop);
          ctx.lineTo(hoverLeft + gridW, hoverTop);
          ctx.lineTo(hoverLeft + gridW, hoverTop + cornerSize);
          ctx.stroke();
          
          // Bottom-left corner
          ctx.beginPath();
          ctx.moveTo(hoverLeft, hoverTop + gridH - cornerSize);
          ctx.lineTo(hoverLeft, hoverTop + gridH);
          ctx.lineTo(hoverLeft + cornerSize, hoverTop + gridH);
          ctx.stroke();
          
          // Bottom-right corner
          ctx.beginPath();
          ctx.moveTo(hoverLeft + gridW - cornerSize, hoverTop + gridH);
          ctx.lineTo(hoverLeft + gridW, hoverTop + gridH);
          ctx.lineTo(hoverLeft + gridW, hoverTop + gridH - cornerSize);
          ctx.stroke();
          
          // Get user's bet amount from localStorage
          const savedAmount = typeof window !== 'undefined' ? localStorage.getItem('userAmount') : null;
          const userBetAmount = savedAmount ? parseFloat(savedAmount) : 0.2; // Default to $0.2
          
          // Calculate timeperiod for this hovered cell
          const hoverCellTime = hover.t- timeOffsetRef.current;
          const hoverTimeperiodId = Math.floor(hoverCellTime / GRID_SEC) * GRID_SEC;
          
          // Calculate time until start and get time bucket
          const hoverTimeUntilStart = hoverTimeperiodId - now;
          const hoverTimeBucket = getTimeBucket(hoverTimeUntilStart);
          const hoverCacheKey = `${hoverTimeperiodId}_${priceLevel.toFixed(priceDecimals)}_${hoverTimeBucket}`;
          
          // Check if other users have bets on this grid - if so, use RED nextUserMultiplier
          const priceMin = priceLevel - priceStep / 2;
          const priceMax = priceLevel + priceStep / 2;
          // Use 2 decimals to match useRealtimeBets grid ID format
          const gridId1 = `${hoverTimeperiodId}_${priceMin.toFixed(2)}_${priceMax.toFixed(2)}`;
          const gridId2 = `${hoverTimeperiodId}_${(priceLevel - priceStep).toFixed(2)}_${priceLevel.toFixed(2)}`;
          
          let otherUsersBets = allUsersBetsRef.current.get(gridId1);
          if (!otherUsersBets) {
            otherUsersBets = allUsersBetsRef.current.get(gridId2);
          }
          
          // Also check all bets by price_level match
          if (!otherUsersBets || otherUsersBets.length === 0) {
            for (const [gridId, bets] of Array.from(allUsersBetsRef.current.entries())) {
              const bet = bets[0];
              if (bet && bet.timeperiod_id === hoverTimeperiodId) {
                const priceTolerance = priceStep / 10;
                if (Math.abs(bet.price_level - priceLevel) < priceTolerance) {
                  otherUsersBets = bets;
                  break;
                }
              }
            }
          }
          
          let hoverMultiplier: number;
          let multiplierColor = "#fff"; // Default white
          
          // If other users have bets, calculate and use RED nextUserMultiplier
          if (otherUsersBets && otherUsersBets.length > 0) {
            const totalShares = otherUsersBets.reduce((sum, bet) => sum + bet.shares, 0);
            const existingSharesBigInt = toShareFormat(totalShares);
            const nextPricePerShare = calculatePricePerShare(existingSharesBigInt, hoverTimeperiodId);
            const nextUserMultiplier = getMultiplierValue(nextPricePerShare);
            hoverMultiplier = nextUserMultiplier;
            multiplierColor = "#FFDA00";
          } else {
            // Get cached multiplier or use quick estimate (regular multiplier)
            const hoverCached = multiplierCache.current.get(hoverCacheKey);
            if (hoverCached && (Date.now() - hoverCached.timestamp) < MULTIPLIER_CACHE_TTL) {
              hoverMultiplier = hoverCached.multiplier;
            } else {
              hoverMultiplier = getQuickMultiplier(hoverTimeperiodId);
              
              // Trigger async fetch if not already fetching
              if (!multiplierFetchQueue.current.has(hoverCacheKey)) {
                getCellMultiplier(hoverTimeperiodId, priceLevel).catch(err => 
                  console.debug('Failed to fetch hover multiplier:', err)
                );
              }
            }
          }
          
          // Calculate potential payout (user amount × multiplier)
          const hoverPayout = userBetAmount * hoverMultiplier;
          
          // Get bet count for this hovered grid
          const hoverBetCount = (otherUsersBets && otherUsersBets.length > 0) 
  ? otherUsersBets.length 
  : getCellBetCount(hoverTimeperiodId, priceLevel);
          
          // Draw multiplier and payout - centered like yellow cell, but RED if other users bet
          ctx.textAlign = "center";
          
          // Calculate positions exactly like yellow cell
          const multiplierY = Math.round(hoverTop + gridH / 2 - 12);
          const amountY = Math.round(hoverTop + gridH / 2 + 4);
          
          // Draw multiplier - RED if other users bet, white otherwise
          ctx.fillStyle = multiplierColor;
          ctx.font = "200 11px 'Geist Mono',monospace";
          
          // Add pulsing glow effect for yellow multiplier (#FFDA00)
          if (multiplierColor === "#FFDA00") {
            const pulseIntensity = (Math.sin(Date.now() / 500) + 1) / 2; // 0 to 1, ~1 second cycle
            const glowIntensity = 0.7 + (pulseIntensity * 0.3); // Pulse between 0.7 and 1.0 (very bright)
            // Draw multiple layers for stronger glow effect
            ctx.shadowBlur = 60 * glowIntensity; // Much larger blur for visible glow
            ctx.shadowColor = "#FFDA00";
            // Draw the text multiple times with different blur levels for layered glow
            ctx.fillText(`${hoverMultiplier.toFixed(1)}X`, hoverLeft + gridW / 2, multiplierY);
            ctx.shadowBlur = 40 * glowIntensity;
            ctx.fillText(`${hoverMultiplier.toFixed(1)}X`, hoverLeft + gridW / 2, multiplierY);
            ctx.shadowBlur = 20 * glowIntensity;
            ctx.fillText(`${hoverMultiplier.toFixed(1)}X`, hoverLeft + gridW / 2, multiplierY);
            // Final draw without shadow for crisp text
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            ctx.fillText(`${hoverMultiplier.toFixed(1)}X`, hoverLeft + gridW / 2, multiplierY);
          } else {
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            ctx.fillText(`${hoverMultiplier.toFixed(1)}X`, hoverLeft + gridW / 2, multiplierY);
          }
          
          // Reset shadow after drawing
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          
          // Draw payout amount - white
          ctx.fillStyle = "#fff";
          ctx.font = "300 14px 'Geist Mono',monospace";
          ctx.fillText(`$${hoverPayout.toFixed(2)}`, hoverLeft + gridW / 2, amountY);
          
          ctx.textAlign = "left";
          
          // Draw bet count badge at bottom - match yellow badge styling exactly but in black/white
          // Always show badge if there are bets, or show 0 if no bets
          const badgeWhite = Math.round(hoverTop + gridH - 12);
          const badgeY = Math.round(badgeWhite - 2);
          ctx.fillStyle = "#ffffff"; // White badge instead of yellow
          ctx.beginPath();
          const badgeWidth = 30; // Same as yellow
          const badgeHeight = 11; // Same as yellow
          const badgeRadius = 12; // Same as yellow
          ctx.roundRect(Math.round(hoverLeft + gridW / 2 - badgeWidth / 2), badgeY, badgeWidth, badgeHeight, badgeRadius);
          ctx.fill();
          
          // Black icon and text on white badge (same as yellow cell but inverted colors)
          const iconSize = 10; // Same as yellow
          const iconX = Math.round(hoverLeft + gridW / 2 - badgeWidth / 2 + 4); // Same spacing
          const badgeCenterY = Math.round(badgeY + badgeHeight / 2);
          const iconY = Math.round(badgeCenterY - iconSize / 2);
          drawPersonIcon(ctx, iconX, iconY, iconSize, "#0b0b0b"); // Black icon on white badge
          ctx.fillStyle = "#0b0b0b"; // Black text on white badge
          ctx.font = "10px 'Geist Mono',monospace"; // Same font as yellow
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(`${hoverBetCount}`, iconX + iconSize + 2, badgeCenterY);
          
          // Reset text properties
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        }
      }

      // Shadow gradient from NOW line to the right (future) - drawn LAST to overlay everything
      // Very minimal for first 20 seconds, then gradually increases darkness
      const twentySecondsX = nowLineX + (20 * pxPerSec);
      const gradientEndX = w; // Extend to right edge of canvas
      
      // Only draw gradient if it extends beyond the NOW line
      if (gradientEndX > nowLineX) {
        const shadowGradient = ctx.createLinearGradient(nowLineX, 0, gradientEndX, 0);
        
        // Start completely transparent at NOW line
        shadowGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
        
        // Very minimal darkness at 20 seconds (about 15% opacity - visible but subtle)
        const twentySecondsProgress = (twentySecondsX - nowLineX) / (gradientEndX - nowLineX);
        if (twentySecondsProgress < 1) {
          shadowGradient.addColorStop(twentySecondsProgress, 'rgba(0, 0, 0, 0.15)');
        }
        
        // Gradually increase darkness after 20 seconds
        // At 50 seconds: ~35% opacity
        const fiftySecondsX = nowLineX + (50 * pxPerSec);
        const fiftySecondsProgress = Math.min((fiftySecondsX - nowLineX) / (gradientEndX - nowLineX), 1);
        if (fiftySecondsProgress > twentySecondsProgress && fiftySecondsProgress < 1) {
          shadowGradient.addColorStop(fiftySecondsProgress, 'rgba(0, 0, 0, 0.35)');
        }
        
        // At 110 seconds: ~55% opacity
        const oneTenSecondsX = nowLineX + (110 * pxPerSec);
        const oneTenSecondsProgress = Math.min((oneTenSecondsX - nowLineX) / (gradientEndX - nowLineX), 1);
        if (oneTenSecondsProgress > fiftySecondsProgress && oneTenSecondsProgress < 1) {
          shadowGradient.addColorStop(oneTenSecondsProgress, 'rgba(0, 0, 0, 0.55)');
        }
        
        // Maximum darkness at the end: ~75% opacity - creates visible darkening effect
        shadowGradient.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
        
        // Draw the gradient overlay - this will darken all elements including multipliers
        ctx.fillStyle = shadowGradient;
        ctx.fillRect(nowLineX, 0, gradientEndX - nowLineX, h);
      }

      requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      // Mark as unmounted to prevent new requests
      isMountedRef.current = false;
      
      // Cancel animation frames
      cancelAnimationFrame(frame);
      cancelAnimationFrame(gen);
      window.removeEventListener("resize", resize);
      
      // Clear fetch queue to cancel pending requests
      multiplierFetchQueue.current.clear();
    };
  }, [isConnected]);

  // Helper function to get cell info at mouse position
  const getCellAtPosition = (x: number, y: number) => {
    const canvas = canvasRef.current!;
    const w = canvas.width;
    const h = canvas.height;
    const centerX = w / 2 - CELL_SIZE / 2;
    const pxPerSec = CELL_SIZE / GRID_SEC;
    const now = Date.now() / 1000;
    const baseOffsetX = (now % GRID_SEC) * pxPerSec;
    const offsetX = baseOffsetX - (timeOffsetRef.current % GRID_SEC) * pxPerSec;
    const price = priceRef.current;
    const priceOffset = priceOffsetRef.current;
    
    // Calculate NOW line position
    const nowLineX = centerX + (timeOffsetRef.current * pxPerSec);

    const gridW = CELL_SIZE;
    const gridH = CELL_SIZE;

    const xOrigin = centerX - offsetX;
    const gxIndex = Math.floor((x - xOrigin) / gridW);
    const gx = xOrigin + gxIndex * gridW;

    const basePrice = Math.floor(price / priceStep) * priceStep;
    const pxPerPrice = gridH / priceStep;
    const gyIndex = Math.floor((y - (h / 2 - (basePrice - price - priceOffset) * pxPerPrice)) / gridH);
    const gy = h / 2 - (basePrice - price - priceOffset) * pxPerPrice + gyIndex * gridH;

    // Check if within cell bounds and right of NOW line
    if (x < nowLineX || x < gx || x > gx + gridW || y < gy || y > gy + gridH) {
      return null;
    }

    const timeOffsetSecNum = ((gx + gridW / 2 - centerX) / pxPerSec);
    // When dragging left (negative timeOffsetRef), we're moving into the future
    // So we need to SUBTRACT the timeOffsetRef (which inverts the negative to positive)
    const cellTime = now + timeOffsetSecNum - timeOffsetRef.current;
    
    console.log('🔍 getCellAtPosition debug:', {
      now,
      timeOffsetSecNum,
      timeOffsetRefCurrent: timeOffsetRef.current,
      cellTime,
      calculationBreakdown: `${now} + ${timeOffsetSecNum} - ${timeOffsetRef.current} = ${cellTime}`
    });
    
    const clickedPrice = price + priceOffset - (y - h / 2) / pxPerPrice;
    const priceLevel = Math.floor(clickedPrice / priceStep) * priceStep + priceStep;

    // Snap cellTime to the nearest 5-second grid interval to match database timeperiod_id
    const snappedCellTime = Math.floor(cellTime / GRID_SEC) * GRID_SEC + GRID_SEC / 2;

    return {
      t: cellTime,
      priceLevel,
      gyIndex,
      timeOffsetSecNum,
      cellKey: `${Math.round(snappedCellTime * 10)}_${priceLevel.toFixed(priceDecimals)}`
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Handle 2D panning - drag when mouse is held down
    if (isPanning2DRef.current && panStartRef.current) {
      const deltaX = x - panStartRef.current.x;
      const deltaY = y - panStartRef.current.y;
      
      const gridH = CELL_SIZE;
      const pxPerPrice = gridH / priceStep;
      const priceDelta = deltaY / pxPerPrice;
      
      const pxPerSec = CELL_SIZE / GRID_SEC;
      const timeDelta = deltaX / pxPerSec;
      
      // Update both offsets simultaneously for diagonal dragging
      priceOffsetRef.current = panStartRef.current.priceOffset + priceDelta;
      timeOffsetRef.current = panStartRef.current.timeOffset + timeDelta;
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const centerX = w / 2-CELL_SIZE/2;
    const pxPerSec = CELL_SIZE / GRID_SEC;
    const now = Date.now() / 1000;
    const baseOffsetX = (now % GRID_SEC) * pxPerSec;
    const offsetX = baseOffsetX - (timeOffsetRef.current % GRID_SEC) * pxPerSec;
    const price = priceRef.current;
    const priceOffset = priceOffsetRef.current; // Get the price offset for scrolling
    
    // Calculate NOW line position
    const nowLineX = centerX + (timeOffsetRef.current * pxPerSec);

    const gridW = CELL_SIZE;
    const gridH = CELL_SIZE;

    const xOrigin = centerX - offsetX;
    const gxIndex = Math.floor((x - xOrigin) / gridW);
    const gx = xOrigin + gxIndex * gridW;

    const basePrice = Math.floor(price / priceStep) * priceStep;
    const pxPerPrice = gridH / priceStep;
    // Account for price offset when calculating grid index
    const gyIndex = Math.floor((y - (h / 2 - (basePrice - price - priceOffset) * pxPerPrice)) / gridH);
    const gy = h / 2 - (basePrice - price - priceOffset) * pxPerPrice + gyIndex * gridH;

    // Handle drag selection (only if in drag selection mode after double-click)
    if (dragStartRef.current && mouseDownTimeRef.current > 0 && isInDragSelectionModeRef.current) {
      const dragDistance = Math.sqrt(
        Math.pow(x - dragStartRef.current.x, 2) + 
        Math.pow(y - dragStartRef.current.y, 2)
      );
      
      // If moved more than 5 pixels, consider it a drag
      if (dragDistance > 5 && !isDraggingRef.current) {
        isDraggingRef.current = true;
        hasDraggedRef.current = true;
        
        // Select the starting cell
        const startCellInfo = getCellAtPosition(dragStartRef.current.x, dragStartRef.current.y);
        if (startCellInfo) {
          const priceRange = priceStep; // Use priceStep for range
          const betInfo = calculateCellBetInfo(startCellInfo.t, startCellInfo.priceLevel);
          
          // ✅ Check if other users have bet on this grid (drag-select start cell)
          const priceMin = startCellInfo.priceLevel - priceRange / 2;
          const priceMax = startCellInfo.priceLevel + priceRange / 2;
          const timeperiodId = Math.floor(startCellInfo.t / GRID_SEC) * GRID_SEC;
          // ✅ Use 2 decimals to match useRealtimeBets grid ID format
          const gridId = `${timeperiodId}_${priceMin.toFixed(2)}_${priceMax.toFixed(2)}`;
          const otherUsersBets = allUsersBetsRef.current.get(gridId);
          
          let finalMultiplier = betInfo.multiplier;
          let finalPayout = betInfo.payout;
          
          if (otherUsersBets && otherUsersBets.length > 0) {
            const totalShares = otherUsersBets.reduce((sum, bet) => sum + bet.shares, 0);
            const existingSharesBigInt = toShareFormat(totalShares);
            const nextPricePerShare = calculatePricePerShare(existingSharesBigInt, timeperiodId);
            const redMultiplier = getMultiplierValue(nextPricePerShare);
            finalMultiplier = redMultiplier;
            finalPayout = betInfo.betAmount * redMultiplier;
          }
          
          selectedCellsRef.current.set(startCellInfo.cellKey, {
            t: startCellInfo.t,
            priceLevel: startCellInfo.priceLevel,
            dragSessionId: currentDragSessionRef.current || undefined,
            status: 'confirmed',
            priceMin,
            priceMax,
            timestamp: Date.now(),
            multiplier: finalMultiplier,
            betAmount: betInfo.betAmount,
            payout: finalPayout,
            nextUserMultiplier: betInfo.nextUserMultiplier
          });
        }
      }
      
      if (isDraggingRef.current) {
        const cellInfo = getCellAtPosition(x, y);
        if (cellInfo) {
          // Add cell to selection during drag with the current drag session ID
          if (!selectedCellsRef.current.has(cellInfo.cellKey)) {
            const priceRange = priceStep; // Use priceStep for range
            const betInfo = calculateCellBetInfo(cellInfo.t, cellInfo.priceLevel);
            
            // ✅ Check if other users have bet on this grid (during drag)
            const priceMin = cellInfo.priceLevel - priceRange / 2;
            const priceMax = cellInfo.priceLevel + priceRange / 2;
            const timeperiodId = Math.floor(cellInfo.t / GRID_SEC) * GRID_SEC;
            // ✅ Use 2 decimals to match useRealtimeBets grid ID format
            const gridId = `${timeperiodId}_${priceMin.toFixed(2)}_${priceMax.toFixed(2)}`;
            const otherUsersBets = allUsersBetsRef.current.get(gridId);
            
            let finalMultiplier = betInfo.multiplier;
            let finalPayout = betInfo.payout;
            
            if (otherUsersBets && otherUsersBets.length > 0) {
              const totalShares = otherUsersBets.reduce((sum, bet) => sum + bet.shares, 0);
              const existingSharesBigInt = toShareFormat(totalShares);
              const nextPricePerShare = calculatePricePerShare(existingSharesBigInt, timeperiodId);
              const redMultiplier = getMultiplierValue(nextPricePerShare);
              finalMultiplier = redMultiplier;
              finalPayout = betInfo.betAmount * redMultiplier;
            }
            
            selectedCellsRef.current.set(cellInfo.cellKey, { 
              t: cellInfo.t, 
              priceLevel: cellInfo.priceLevel,
              dragSessionId: currentDragSessionRef.current || undefined,
              status: 'confirmed',
              priceMin,
              priceMax,
              timestamp: Date.now(),
              multiplier: finalMultiplier,
              betAmount: betInfo.betAmount,
              payout: finalPayout,
              nextUserMultiplier: betInfo.nextUserMultiplier
            });
          } else {
            // Update existing cell's drag session ID
            const existing = selectedCellsRef.current.get(cellInfo.cellKey)!;
            selectedCellsRef.current.set(cellInfo.cellKey, {
              ...existing,
              dragSessionId: currentDragSessionRef.current || undefined
            });
          }
        }
        return;
      }
    }

    // Disable hover for cells to the left of the yellow NOW line
    if (x < nowLineX+CELL_SIZE) {
      hoverRef.current = null;
      return;
    }

    if (x < gx || x > gx + gridW || y < gy || y > gy + gridH) {
      hoverRef.current = null;
      return;
    }

    const timeOffsetSecNum = ((gx + gridW / 2 - centerX) / pxPerSec);
    hoverRef.current = { t: now + timeOffsetSecNum, gyIndex };
  };

  const handleMouseLeave = () => {
    hoverRef.current = null;
    isDraggingRef.current = false;
    dragStartRef.current = null;
    hasDraggedRef.current = false;
    mouseDownTimeRef.current = 0;
    // Don't reset isInDragSelectionModeRef - M key should persist until pressed again
    
    // Reset 2D panning when cursor leaves canvas
    isPanning2DRef.current = false;
    panStartRef.current = null;
    
    // Reset cursor - maintain crosshair if in multi-select mode
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = isInDragSelectionModeRef.current ? 'crosshair' : 'default';
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const w = canvas.width;
    const centerX = w / 2 - CELL_SIZE / 2;
    const pxPerSec = CELL_SIZE / GRID_SEC;
    const nowLineX = centerX + (timeOffsetRef.current * pxPerSec);

    // Check if we're in multi-select mode and clicking on a valid cell
    if (isInDragSelectionModeRef.current && x >= nowLineX + CELL_SIZE) {
      const cellInfo = getCellAtPosition(x, y);
      if (cellInfo) {
        // Start drag selection in multi-select mode
        mouseDownTimeRef.current = Date.now();
        hasDraggedRef.current = false;
        isDraggingRef.current = false;
        dragStartRef.current = { x, y };
        currentDragSessionRef.current = `drag_${Date.now()}_${Math.random()}`;
        canvas.style.cursor = 'crosshair';
        return; // Don't enable panning
      }
    }

    // Normal click - enable panning
    isPanning2DRef.current = true;
    panStartRef.current = {
      x: x,
      y: y,
      priceOffset: priceOffsetRef.current,
      timeOffset: timeOffsetRef.current
    };
    canvas.style.cursor = 'grabbing';
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    
    // Check if this was just a click (no panning movement)
    const wasPanning = isPanning2DRef.current;
    const hadMovement = panStartRef.current && (
      Math.abs(priceOffsetRef.current - panStartRef.current.priceOffset) > 0.01 ||
      Math.abs(timeOffsetRef.current - panStartRef.current.timeOffset) > 0.01
    );
    
    // Check if there are any drag-selected cells that might need deselection
    const hasDragGroups = Array.from(selectedCellsRef.current.values()).some(cell => cell.dragSessionId);
    
    // Reset 2D panning state
    isPanning2DRef.current = false;
    panStartRef.current = null;
    canvas.style.cursor = isInDragSelectionModeRef.current ? 'crosshair' : 'default';
    
    // If it was a click without movement OR there are drag groups, handle as click
    // This ensures deselection works even when not in panning mode (e.g., when M is pressed)
    if ((wasPanning && !hadMovement) || hasDragGroups) {
      handleClick(e);
    }
    
    const wasDragging = hasDraggedRef.current;
    
    // Reset drag state
    isDraggingRef.current = false;
    dragStartRef.current = null;
    mouseDownTimeRef.current = 0;
    
    if (wasDragging) {
      // Drag selection completed
      hasDraggedRef.current = false;
      
      // Notify about all selections
      if (onMultipleSelectionChange) {
        const allSelections = Array.from(selectedCellsRef.current.values());
        onMultipleSelectionChange(allSelections);
      }
    }
  };

  const handleClick = (e: React.MouseEvent) => {

      console.log('🎯 Grid clicked!', { isPlacingOrder, onCellSelect: !!onCellSelect });
    
    // Check if wallet is connected
    if (!address) {
      console.log('❌ Wallet not connected - cannot place order');
      setShowWalletWarning(true);
      setTimeout(() => setShowWalletWarning(false), 3000); // Hide after 3 seconds
      return;
    }
    
    // Don't handle clicks when placing an order
    // if (isPlacingOrder) {
    //   console.log('Order in progress, click ignored');
    //   return;
    // }
    
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const w = canvas.width;
    const centerX = w / 2 - CELL_SIZE / 2;
    const pxPerSec = CELL_SIZE / GRID_SEC;
    const nowLineX = centerX + (timeOffsetRef.current * pxPerSec);
    
    // Disable selection for cells to the left of the yellow NOW line
    if (x < nowLineX + CELL_SIZE) return;

    const cellInfo = getCellAtPosition(x, y);
    
    // Check if there are any drag groups
    const hasDragGroups = Array.from(selectedCellsRef.current.values()).some(cell => cell.dragSessionId);
    
    // If clicked outside any cell and there are drag groups, clear them
    if (!cellInfo) {
      if (hasDragGroups) {
        // Clear all drag-selected cells
        const cellsToDelete: string[] = [];
        selectedCellsRef.current.forEach((cell, key) => {
          if (cell.dragSessionId) {
            cellsToDelete.push(key);
          }
        });
        
        console.log('Clearing', cellsToDelete.length, 'drag-selected cells');
        cellsToDelete.forEach(key => selectedCellsRef.current.delete(key));
        
        // Notify about updated selections
        if (onMultipleSelectionChange) {
          const allSelections = Array.from(selectedCellsRef.current.values());
          onMultipleSelectionChange(allSelections);
        }
      }
      return;
    }

    const { cellKey, t: cellTime, priceLevel, timeOffsetSecNum } = cellInfo;
    const currentTime = Date.now();
    const isAlreadySelected = selectedCellsRef.current.has(cellKey);
    
    // If there are drag groups and clicked on unselected cell, just clear drag groups (don't select new cell)
    if (hasDragGroups && !isAlreadySelected) {
      // Clear all drag-selected cells
      const cellsToDelete: string[] = [];
      selectedCellsRef.current.forEach((cell, key) => {
        if (cell.dragSessionId) {
          cellsToDelete.push(key);
        }
      });
      
      console.log('Clearing', cellsToDelete.length, 'drag-selected cells');
      cellsToDelete.forEach(key => selectedCellsRef.current.delete(key));
      
      // Notify about updated selections
      if (onMultipleSelectionChange) {
        const allSelections = Array.from(selectedCellsRef.current.values());
        onMultipleSelectionChange(allSelections);
      }
      return;
    }
    
    // Check for double-click (within 300ms)
    const isDoubleClick = lastClickRef.current?.cellKey === cellKey && 
                          (currentTime - lastClickRef.current.time) < 300;
    
    if (isAlreadySelected) {
      // Handle double-click on selected cell
      if (isDoubleClick) {
        const selectedCell = selectedCellsRef.current.get(cellKey);
        const dragSessionId = selectedCell?.dragSessionId;
        
        console.log('Double-click detected on cell:', cellKey, 'dragSessionId:', dragSessionId);
        
        if (dragSessionId) {
          // This cell was part of a drag selection - show "Feature Coming Soon"
          setShowComingSoon(true);
          setTimeout(() => setShowComingSoon(false), 2000);
          lastClickRef.current = null; // Reset after showing popup
        } else {
          // Single cell - do nothing on double-click
          console.log('Single cell - no action on double-click');
          lastClickRef.current = { cellKey, time: currentTime };
        }
      } else {
        // First click on selected cell - store for double-click detection
        lastClickRef.current = { cellKey, time: currentTime };
      }
    } else {
      // Single click on empty cell - place single order immediately
      const priceRange = priceStep; // Use priceStep for range
      const priceMin = priceLevel - priceRange ;
      const priceMax = priceLevel ;
      
      // Calculate multiplier, payout, AND nextUserMultiplier at time of bet
      const betInfo = calculateCellBetInfo(cellTime, priceLevel);
      
      // ✅ CHECK IF OTHER USERS HAVE ALREADY BET ON THIS GRID
      // If yes, use the RED "next user multiplier" instead of default multiplier
      const timeperiodId = Math.floor(cellTime / GRID_SEC) * GRID_SEC;
      // ✅ Use 2 decimals to match useRealtimeBets grid ID format
      const gridId = `${timeperiodId}_${priceMin.toFixed(2)}_${priceMax.toFixed(2)}`;
      const otherUsersBets = allUsersBetsRef.current.get(gridId);
      
      let finalMultiplier = betInfo.multiplier;
      let finalPayout = betInfo.payout;
      
      if (otherUsersBets && otherUsersBets.length > 0) {
        // Other users have bet on this grid - calculate the RED "next user multiplier"
        const totalShares = otherUsersBets.reduce((sum, bet) => sum + bet.shares, 0);
        const existingSharesBigInt = toShareFormat(totalShares);
        const nextPricePerShare = calculatePricePerShare(existingSharesBigInt, timeperiodId);
        const redMultiplier = getMultiplierValue(nextPricePerShare);
        
        // Use the RED multiplier for this user
        finalMultiplier = redMultiplier;
        finalPayout = betInfo.betAmount * redMultiplier;
        
        console.log('🔴 Using RED next-user multiplier (other users already bet):', {
          gridId,
          otherUsersBets: otherUsersBets.length,
          totalShares: totalShares.toFixed(4),
          existingSharesBigInt: existingSharesBigInt.toString(),
          redMultiplier: redMultiplier.toFixed(2) + 'x',
          betAmount: betInfo.betAmount.toFixed(2),
          payout: finalPayout.toFixed(2),
          defaultMultiplier: betInfo.multiplier.toFixed(2) + 'x (not used)'
        });
      } else {
        // console.log('✅ No other users bet on this grid - using default multiplier:', {
        //   gridId,
        //   multiplier: finalMultiplier.toFixed(2) + 'x',
        //   betAmount: betInfo.betAmount.toFixed(2),
        //   payout: finalPayout.toFixed(2)
        // });
      }
      
      // console.log('==========================================');
      // console.log('CELL CLICK DEBUG - Final values:', {
      //   multiplier: finalMultiplier.toFixed(2) + 'x',
      //   payout: finalPayout.toFixed(2),
      //   betAmount: betInfo.betAmount.toFixed(2),
      //   nextUserMultiplier: betInfo.nextUserMultiplier
      // });
      // console.log('==========================================');
      
      // Single click to select unselected cell - set to pending state immediately
      selectedCellsRef.current.set(cellKey, { 
        t: cellTime, 
        priceLevel,
        status: 'pending',
        priceMin,
        priceMax,
        timestamp: Date.now(),
        multiplier: finalMultiplier,  // ✅ Use RED multiplier if other users have bet
        betAmount: betInfo.betAmount,
        payout: finalPayout,          // ✅ Recalculated with RED multiplier
        nextUserMultiplier: betInfo.nextUserMultiplier
      });
      lastClickRef.current = { cellKey, time: currentTime };
      soundsRef.current.playClick(); // Play click sound
      
      // Show "Placing Order" loader
      setIsWaitingForGrid(true);
      forceUpdate({}); // Force re-render to show pending state
      
      // Notify parent component if callback is provided
      if (onCellSelect) {
        // Calculate the actual time offset by subtracting current time from cellTime
        const now = Date.now() / 1000;
        const actualTimeOffset = cellTime - now;
        onCellSelect(actualTimeOffset, priceLevel, cellKey).then((result) => {
          // Update cell state based on server response
          const cell = selectedCellsRef.current.get(cellKey);
          if (cell) {
            if (result.success) {
              // Order confirmed - update to yellow state
              cell.status = 'confirmed';
              cell.orderId = result.orderId;
              cell.timestamp = Date.now();
              
              // console.log('✅ BET CONFIRMED - Fetching REAL next user multiplier...');
              
              // Calculate REAL next user multiplier after confirmation (Option C)
              // Wait 1 second for database to update, then fetch real data
              setTimeout(async () => {
                const timeperiodId = Math.floor(cellTime / 5) * 5;
                
                // Use the priceMin/priceMax from the cell itself (already in correct format)
                // OR convert from priceLevel if not available
                // console.log("CELL_____",cell);
                
                const priceMinStr = Math.floor((cell.priceMin) * 1e8).toString();
const priceMaxStr = Math.floor((cell.priceMax) * 1e8).toString();

// console.log(`🔍 Query params: timeperiod=${timeperiodId}, price_min=${priceMinStr}, price_max=${priceMaxStr}`);

const realNextMultiplier = await calculateRealNextUserMultiplier(
  timeperiodId,
  Number(priceLevel.toFixed(10)),
  Number(priceMinStr),
  Number(priceMaxStr)
);
                
              
                
                // Update cell with REAL next user multiplier
                const cellToUpdate = selectedCellsRef.current.get(cellKey);

                console.log("REAL NEXT MULTIPLIER_____",realNextMultiplier);
                // console.log("CELL TO UPDATE_____",cellToUpdate);
                
                if (cellToUpdate && realNextMultiplier !== undefined) {
                  cellToUpdate.nextUserMultiplier = realNextMultiplier;
                  console.log(`🔴 Updated cell with REAL nextUserMultiplier: ${realNextMultiplier.toFixed(2)}x`);
                  forceUpdate({}); // Trigger re-render to show RED multiplier
                }
              }, 1500); // Wait 1.5s for database to update
              
              // Hide loader and show success popup
              setIsWaitingForGrid(false);
              setGridIdInfo({
                gridId: result.orderId || '',
                timeperiodId: Math.floor(cellTime / 5) * 5 + '',
                priceMin: priceMin.toFixed(priceDecimals),
                priceMax: priceMax.toFixed(priceDecimals),
                hasBet: true
              });
              setShowGridIdPopup(true);
              
              // Auto-hide success popup after 2 seconds
              setTimeout(() => setShowGridIdPopup(false), 2000);
            } else {
              // Order failed - check error type
              if (result.error) {
                // Check for "Transaction failed" error
                if (result.error.toLowerCase().includes('transaction failed')) {
                  console.log('❌ Transaction failed detected - clearing nonce storage');
                  clearNonceStorage();
                }
                
                // Check for "invalid signature" error
                if (result.error.toLowerCase().includes('invalid signature')) {
                  console.log('❌ Invalid signature detected - clearing session');
                  clearSessionStorage();
                  
                  // Show popup
                  setShowInvalidSignaturePopup(true);
                  setTimeout(() => setShowInvalidSignaturePopup(false), 3000);
                }
              }
              
              selectedCellsRef.current.delete(cellKey);
              setIsWaitingForGrid(false);
            }
            forceUpdate({}); // Force re-render
          }
        }).catch((error) => {
          // Error placing order
          console.error('Error placing order:', error);
          
          // Check error message
          const errorMessage = error?.message || error?.toString() || '';
          
          if (errorMessage.toLowerCase().includes('transaction failed')) {
            console.log('❌ Transaction failed detected - clearing nonce storage');
            clearNonceStorage();
          }
          
          if (errorMessage.toLowerCase().includes('invalid signature')) {
            console.log('❌ Invalid signature detected - clearing session');
            clearSessionStorage();
            
            // Show popup
            setShowInvalidSignaturePopup(true);
            setTimeout(() => setShowInvalidSignaturePopup(false), 3000);
          }
          
          selectedCellsRef.current.delete(cellKey);
          setIsWaitingForGrid(false);
          forceUpdate({});
        });
      } else {
        // No callback provided, hide loader after a short delay
        setTimeout(() => setIsWaitingForGrid(false), 500);
      }
      
      // Notify about all selections
      if (onMultipleSelectionChange) {
        const allSelections = Array.from(selectedCellsRef.current.values());
        onMultipleSelectionChange(allSelections);
      }
    }
  };

  // Notify parent of scroll state changes
  useEffect(() => {
    if (onScrollStateChange) {
      const checkInterval = setInterval(() => {
        const isScrolled = Math.abs(priceOffsetRef.current) > 0.001;
        onScrollStateChange(isScrolled);
      }, 100); // Check every 100ms
      
      return () => clearInterval(checkInterval);
    }
  }, [onScrollStateChange]);

  // Handle recenter trigger from parent
  useEffect(() => {
    if (recenterTrigger > 0 && (Math.abs(priceOffsetRef.current) > 0.001 || Math.abs(timeOffsetRef.current) > 0.001)) {
      isRecenteringRef.current = true;
      recenterStartPriceOffsetRef.current = priceOffsetRef.current;
      recenterStartTimeOffsetRef.current = timeOffsetRef.current;
      recenterStartTimeRef.current = Date.now();
    }
  }, [recenterTrigger]);

    return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          background: "#141414",
          cursor: 'default',
        }}
      />
      
      {/* Waiting for Grid Loader - Only show if NOT showing success popup */}
      {isWaitingForGrid && !showGridIdPopup && (
       

<div className={styles.orderPill}>
  <div className={styles.orderSpinner} />
  <span className={styles.orderText}>Placing order 1/1</span>
</div>

      )}
      
      {/* Grid ID Info Popup - Top of Screen */}
      {/* Grid Found Popup */}
      {showGridIdPopup && gridIdInfo && gridIdInfo.hasBet && (
       <div
  style={{
    position: 'absolute',
    top: '5%',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1001,
    animation: 'slideDown 0.3s ease-out',
  }}
>
  <div
    style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',                
      padding: '12px 12px',    
      borderRadius: '24px',        
      background: '#000',      
      overflow: 'hidden',
      boxShadow:
        '0 4px 7.1px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(0,255,36,0.30)', // inner 1px border
    }}
  >
    {/* Top thin green sheen (from Figma gradient) */}
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        pointerEvents: 'none',
        background:
          'linear-gradient(180deg,rgba(0,0,0,0) 55%,  rgba(0,255,36,0.20) 22%,rgba(0,255,36,0.55) 0%, )',
      }}
    />

    {/* Soft center highlight band (subtle, matches Figma's inner glow vibe) */}
    <div
      style={{
        position: 'absolute',
        left: 6,
        right: 6,
        top: '42%',
        height: '36%',
        borderRadius: 999,
        pointerEvents: 'none',
        background:
          'radial-gradient(100% 220% at 50% 50%, rgba(0,255,36,0.28) 0%, rgba(0,255,36,0.18) 35%, rgba(0,255,36,0) 70%)',
        filter: 'blur(4px)',
        opacity: 0.9,
      }}
    />

    {/* Check icon (SVG instead of emoji) */}
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_55_10048)">
<path d="M6.82867 10.876L4 8.04668L4.94267 7.10402L6.82867 8.98935L10.5993 5.21802L11.5427 6.16135L6.82867 10.876Z" fill="#00FF24"/>
<path fill-rule="evenodd" clip-rule="evenodd" d="M0.666992 8.00008C0.666992 3.95008 3.95033 0.666748 8.00033 0.666748C12.0503 0.666748 15.3337 3.95008 15.3337 8.00008C15.3337 12.0501 12.0503 15.3334 8.00033 15.3334C3.95033 15.3334 0.666992 12.0501 0.666992 8.00008ZM8.00033 14.0001C7.21239 14.0001 6.43218 13.8449 5.70423 13.5434C4.97627 13.2418 4.31484 12.7999 3.75768 12.2427C3.20053 11.6856 2.75858 11.0241 2.45705 10.2962C2.15552 9.56823 2.00033 8.78801 2.00033 8.00008C2.00033 7.21215 2.15552 6.43193 2.45705 5.70398C2.75858 4.97603 3.20053 4.31459 3.75768 3.75744C4.31484 3.20029 4.97627 2.75833 5.70423 2.4568C6.43218 2.15528 7.21239 2.00008 8.00033 2.00008C9.59162 2.00008 11.1177 2.63222 12.243 3.75744C13.3682 4.88266 14.0003 6.40878 14.0003 8.00008C14.0003 9.59138 13.3682 11.1175 12.243 12.2427C11.1177 13.3679 9.59162 14.0001 8.00033 14.0001Z" fill="#00FF24"/>
</g>
<defs>
<clipPath id="clip0_55_10048">
<rect width="16" height="16" fill="white"/>
</clipPath>
</defs>
</svg>


    <span
      style={{
        position: 'relative',
        zIndex: 1,
        color: '#fff',
        fontSize: 14,
        fontWeight: 300,
        fontFamily: 'Geist Mono',
        lineHeight: 1,
        textTransform: 'lowercase',
        transform: 'translateY(-0.5px)', // tiny vertical nudge like the mock
      }}
    >
      Order Placed
    </span>
  </div>
</div>

      )}
      
      {/* Wallet Warning Popup */}
      {showWalletWarning && (
       <div
  style={{
    position: 'absolute',
    top: '5%',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 1001,
    animation: 'slideDown 0.3s ease-out',
  }}
>
  <div
    style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',                
      padding: '12px 12px',    
      borderRadius: '24px',        
      background: '#000',      
      overflow: 'hidden',
      boxShadow:
        '0 4px 7.1px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,218,0,0.30)',
    }}
  >
    {/* Top thin yellow sheen */}
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: 'inherit',
        pointerEvents: 'none',
        background:
          'linear-gradient(180deg,rgba(0,0,0,0) 55%,  rgba(255,218,0,0.20) 22%,rgba(255,218,0,0.55) 0%, )',
      }}
    />

    {/* Soft center highlight band with yellow */}
    <div
      style={{
        position: 'absolute',
        left: 6,
        right: 6,
        top: '42%',
        height: '36%',
        borderRadius: 999,
        pointerEvents: 'none',
        background:
          'radial-gradient(100% 220% at 50% 50%, rgba(255,218,0,0.28) 0%, rgba(255,218,0,0.18) 35%, rgba(255,218,0,0) 70%)',
        filter: 'blur(4px)',
        opacity: 0.9,
      }}
    />

    {/* Warning icon */}
    <svg width="15" height="13" viewBox="0 0 15 13" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7.5 0.5L0.5 12.5H14.5L7.5 0.5Z" stroke="#FFDA00" strokeLinejoin="round"/>
      <path d="M7.5 10.1668V10.5002M7.5 4.8335L7.50267 8.16683" stroke="#FFDA00" strokeLinecap="round"/>
    </svg>

    <span
      style={{
        position: 'relative',
        zIndex: 1,
        color: '#fff',
        fontSize: 14,
        fontWeight: 300,
        fontFamily: 'Geist Mono',
        lineHeight: 1,
        textTransform: 'lowercase',
        transform: 'translateY(-0.5px)',
      }}
    >
      Connect Wallet
    </span>
  </div>
</div>

      )}
      
      {/* Invalid Signature Popup */}
      {showInvalidSignaturePopup && (
        <div
          style={{
            position: 'absolute',
            top: '5%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            animation: 'slideDown 0.3s ease-out',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',                
              padding: '12px 16px',    
              borderRadius: '24px',        
              background: '#000',      
              overflow: 'hidden',
              boxShadow:
                '0 4px 7.1px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,218,0,0.30)',
            }}
          >
            {/* Top thin yellow sheen */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                pointerEvents: 'none',
                background:
                  'linear-gradient(180deg,rgba(0,0,0,0) 55%, rgba(255,218,0,0.20) 22%,rgba(255,218,0,0.55) 0%)',
              }}
            />

            {/* Soft center highlight band */}
            <div
              style={{
                position: 'absolute',
                left: 6,
                right: 6,
                top: '42%',
                height: '36%',
                borderRadius: 999,
                pointerEvents: 'none',
                background:
                  'radial-gradient(100% 220% at 50% 50%, rgba(255,218,0,0.28) 0%, rgba(255,218,0,0.18) 35%, rgba(255,218,0,0) 70%)',
                filter: 'blur(4px)',
                opacity: 0.9,
              }}
            />

            <span
              style={{
                position: 'relative',
                zIndex: 1,
                color: '#fff',
                fontSize: 14,
                fontWeight: 300,
                fontFamily: 'Geist Mono',
                lineHeight: 1,
                textTransform: 'lowercase',
                transform: 'translateY(-0.5px)',
              }}
            >
              Enable trading again
            </span>
          </div>
        </div>
      )}
      
      {/* Feature Coming Soon Popup */}
      {showComingSoon && (
        <div
          style={{
            position: 'absolute',
            top: '5%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            animation: 'slideDown 0.3s ease-out',
          }}
        >
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',                
              padding: '12px 16px',    
              borderRadius: '24px',        
              background: '#000',      
              overflow: 'hidden',
              boxShadow:
                '0 4px 7.1px rgba(0,0,0,0.25), inset 0 0 0 1px rgba(255,218,0,0.30)',
            }}
          >
            {/* Top thin yellow sheen */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                borderRadius: 'inherit',
                pointerEvents: 'none',
                background:
                  'linear-gradient(180deg,rgba(0,0,0,0) 55%,  rgba(255,218,0,0.20) 22%,rgba(255,218,0,0.55) 0%, )',
              }}
            />

            {/* Soft center highlight band */}
            <div
              style={{
                position: 'absolute',
                left: 6,
                right: 6,
                top: '42%',
                height: '36%',
                borderRadius: 999,
                pointerEvents: 'none',
                background:
                  'radial-gradient(100% 220% at 50% 50%, rgba(255,218,0,0.28) 0%, rgba(255,218,0,0.18) 35%, rgba(255,218,0,0) 70%)',
                filter: 'blur(4px)',
                opacity: 0.9,
              }}
            />

            <span
              style={{
                position: 'relative',
                zIndex: 1,
                color: '#fff',
                fontSize: 14,
                fontWeight: 300,
                fontFamily: 'Geist Mono',
                lineHeight: 1,
                textTransform: 'lowercase',
                transform: 'translateY(-0.5px)',
              }}
            >
              Feature Coming Soon
            </span>
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes popupFadeIn {
          from {
            opacity: 0;
            transform: translate(-50%, -50%) scale(0.8);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
        
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
        
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
    );
}