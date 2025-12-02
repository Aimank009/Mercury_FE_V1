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
  const processedFeedSettlementsRef = useRef<Set<string>>(new Set());
  const [renderTrigger, setRenderTrigger] = useState(0);
  const forceUpdate = () => setRenderTrigger(prev => prev + 1);
  
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
      
      const settlementTimeperiodIdNum = parseInt(settlementTimeperiodId);
      
      // Extract price range from settlement message (new format: price_min and price_max)
      const settlementPriceMin = parseFloat(settlementsMessage.price_min || settlementsMessage.price) / 1e8;
      const settlementPriceMax = parseFloat(settlementsMessage.price_max || settlementsMessage.price) / 1e8;
      
      console.log(`\n🏆 Settlement received: timeperiod ${settlementTimeperiodIdNum}, price range $${settlementPriceMin.toFixed(priceDecimals)} - $${settlementPriceMax.toFixed(priceDecimals)}`);
      
      // FIRST: Check local selectedCellsRef for matching bets (INSTANT - no DB query needed)
      let foundLocalBets = false;
      const localUpdates: Array<{cellKey: string; status: string; bet: any}> = [];
      
      selectedCellsRef.current.forEach((cell, cellKey) => {
        // Calculate timeperiod for this cell
        const cellTimeperiodId = Math.floor((cell.t + 0.0001) / GRID_SEC) * GRID_SEC;
        
        if (cellTimeperiodId === settlementTimeperiodIdNum && (cell.status === 'confirmed' || cell.status === 'pending')) {
          foundLocalBets = true;
          
          const priceMin = cell.priceMin;
          const priceMax = cell.priceMax;
          
          // Check if settlement price range OVERLAPS with bet's price range
          const isWin = settlementPriceMin < priceMax && settlementPriceMax > priceMin;
          const newStatus = isWin ? 'won' : 'lost';
          
          console.log(`  📊 Local bet found: ${cellKey} - ${newStatus.toUpperCase()}`);
          console.log(`     Bet range: $${priceMin?.toFixed(3)} - $${priceMax?.toFixed(3)}`);
          console.log(`     Settlement range: $${settlementPriceMin.toFixed(3)} - $${settlementPriceMax.toFixed(3)}`);
          
          // Update cell status IMMEDIATELY
          cell.status = newStatus;
          cell.timestamp = Date.now();
          
          // Update multiplier: keep if win, set to 0 if loss
          if (!isWin) {
            cell.multiplier = 0;
            cell.payout = 0;
          }
          
          // Play sound
          if (isWin) {
            soundsRef.current.playWin();
          } else {
            soundsRef.current.playLoss();
          }
          
          localUpdates.push({ cellKey, status: newStatus, bet: cell });
        }
      });
      
      // Force re-render IMMEDIATELY if we found local bets
      if (foundLocalBets) {
        console.log(`  ✅ Updated ${localUpdates.length} local bets instantly`);
        forceUpdate();
        
        // Update database in BACKGROUND (don't wait)
        localUpdates.forEach(({ cellKey, status, bet }) => {
          if (bet.orderId) {
            const settlementPriceMiddle = (settlementPriceMin + settlementPriceMax) / 1e8;
            const finalMultiplier = status === 'won' ? (bet.multiplier || 0) : 0;
            
            supabase
              .from('bet_placed_with_session')
              .update({ 
                status: status, 
                settled_at: new Date().toISOString(),
                settlement_price: Math.floor((settlementPriceMin + settlementPriceMax) / 2 * 1e8),
                multiplier: finalMultiplier
              })
              .eq('event_id', bet.orderId)
              .then(({ error }) => {
                if (error) {
                  console.error(`❌ Error updating bet ${bet.orderId}:`, error);
                } else {
                  console.log(`✅ Database updated for bet ${bet.orderId}`);
                }
              });
          }
        });
        
        // Trigger positions table refresh
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('positionsUpdated', {
            detail: { timeperiodId: settlementTimeperiodIdNum }
          }));
        }
        
        return; // Don't need to query database since we handled local bets
      }
      
      // FALLBACK: Query database if no local bets found (for restored bets from page reload)
      try {
        const { data: userBets, error } = await supabase
          .from('bet_placed_with_session')
          .select('*')
          .ilike('user_address', address)
          .eq('timeperiod_id', settlementTimeperiodId)
          .in('status', ['pending', 'confirmed']);
        
        if (error) {
          console.error('❌ Error querying user bets:', error);
          return;
        }
        
        if (!userBets || userBets.length === 0) {
          console.log(`  ⏭️  No unsettled bets found for this timeperiod`);
          return;
        }
        
        console.log(`  📊 Found ${userBets.length} bets in database (fallback path)`);
        
        // Process each bet from database
        const updatePromises = userBets.map(async (bet) => {
          const priceMin = parseFloat(bet.price_min) / 1e8;
          const priceMax = parseFloat(bet.price_max) / 1e8;
          
          const isWin = settlementPriceMin < priceMax && settlementPriceMax > priceMin;
          const newStatus = isWin ? 'won' : 'lost';
          
          const cellTime = settlementTimeperiodIdNum + 2.5;
          const cellPriceLevel = priceMax;
          const cellKey = `${Math.round(cellTime * 10)}_${cellPriceLevel.toFixed(priceDecimals)}`;
          
          const calculatedMultiplier = bet.multiplier || 0;
          const finalMultiplier = isWin ? calculatedMultiplier : 0;
          
          console.log(`  📊 Bet ${bet.event_id.substring(0, 10)}... - ${newStatus.toUpperCase()}`);
          
          // Update database
          const settlementPriceMiddle = (settlementPriceMin + settlementPriceMax) / 2;
          const { error: updateError } = await supabase
            .from('bet_placed_with_session')
            .update({ 
              status: newStatus, 
              settled_at: new Date().toISOString(),
              settlement_price: Math.floor(settlementPriceMiddle * 1e8),
              multiplier: finalMultiplier
            })
            .eq('event_id', bet.event_id);
          
          if (updateError) {
            console.error('❌ Error updating bet status:', updateError);
            return null;
          }
          
          // Add to UI
          const betInfo = calculateCellBetInfo(cellTime, cellPriceLevel);
          selectedCellsRef.current.set(cellKey, {
            t: cellTime,
            priceLevel: cellPriceLevel,
            status: newStatus,
            orderId: bet.event_id || bet.grid_id,
            priceMin: priceMin,
            priceMax: priceMax,
            timestamp: Date.now(),
            multiplier: isWin ? betInfo.multiplier : 0,
            betAmount: betInfo.betAmount,
            payout: isWin ? betInfo.payout : 0
          });
          
          if (isWin) {
            soundsRef.current.playWin();
          } else {
            soundsRef.current.playLoss();
          }
          
          return { cellKey, status: newStatus };
        });
        
        await Promise.all(updatePromises);
        
        // Trigger positions table refresh
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('positionsUpdated', {
            detail: { timeperiodId: settlementTimeperiodIdNum }
          }));
        }
        
        forceUpdate();
        
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
    
    // Extract price range from settlement message (new format: price_min and price_max)
    const settlementPriceMinRaw = settlementsMessage.price_min || settlementsMessage.price;
    const settlementPriceMaxRaw = settlementsMessage.price_max || settlementsMessage.price;

    if (Number.isNaN(settlementTimeperiodId) || !settlementPriceMinRaw || !settlementPriceMaxRaw) {
      return;
    }

    const settlementPriceMin = parseFloat(settlementPriceMinRaw) / 1e8;
    const settlementPriceMax = parseFloat(settlementPriceMaxRaw) / 1e8;
    
    if (Number.isNaN(settlementPriceMin) || Number.isNaN(settlementPriceMax)) {
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

          // Check if settlement price range OVERLAPS with bet's price range
          // A bet wins if there's any overlap between [settlementPriceMin, settlementPriceMax] and [priceMin, priceMax]
          // Overlap exists if: settlementPriceMin < priceMax && settlementPriceMax > priceMin
          const status: 'win' | 'loss' = settlementPriceMin < priceMax && settlementPriceMax > priceMin ? 'win' : 'loss';
          otherUsersSettlementsRef.current.set(gridId, { status, timestamp: nowTs });
          updated = true;
        });

        if (updated) {
          forceUpdate();
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
        forceUpdate();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [forceUpdate]);
  
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const priceRef = useRef<number>(wsPrice > 0 ? wsPrice : (initialBasePrice || 38.12));
  const targetPriceRef = useRef<number>(wsPrice > 0 ? wsPrice : (initialBasePrice || 38.12));
  const historyRef = useRef<DataPoint[]>([]);
  // Custom cursor SVG converted to data URL
  const customCursorSVG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg width="27" height="27" viewBox="0 0 27 27" fill="none" xmlns="http://www.w3.org/2000/svg">
<g filter="url(#filter0_d_602_38673)">
<path d="M13.3501 1.6001C19.2873 1.6001 24.1001 6.41288 24.1001 12.3501C24.1001 18.2873 19.2873 23.1001 13.3501 23.1001C7.41288 23.1001 2.6001 18.2873 2.6001 12.3501C2.6001 6.41288 7.41288 1.6001 13.3501 1.6001ZM12.6001 14.3501V13.1001H11.3501C10.9359 13.1001 10.6001 12.7643 10.6001 12.3501C10.6001 11.9359 10.9359 11.6001 11.3501 11.6001H12.6001V10.3501C12.6001 9.93588 12.9359 9.6001 13.3501 9.6001C13.7643 9.6001 14.1001 9.93588 14.1001 10.3501V11.6001H15.3501C15.7643 11.6001 16.1001 11.9359 16.1001 12.3501C16.1001 12.7643 15.7643 13.1001 15.3501 13.1001H14.1001V14.3501C14.1001 14.7643 13.7643 15.1001 13.3501 15.1001C12.9359 15.1001 12.6001 14.7643 12.6001 14.3501ZM12.6001 5.3501V3.13232C8.08964 3.49429 4.49531 7.08965 4.1333 11.6001H6.3501C6.76431 11.6001 7.1001 11.9359 7.1001 12.3501C7.1001 12.7643 6.76431 13.1001 6.3501 13.1001H4.1333C4.4953 17.6105 8.08967 21.2049 12.6001 21.5669V19.3501C12.6001 18.9359 12.9359 18.6001 13.3501 18.6001C13.7643 18.6001 14.1001 18.9359 14.1001 19.3501V21.5669C18.6105 21.2049 22.2049 17.6105 22.5669 13.1001H20.3501C19.9359 13.1001 19.6001 12.7643 19.6001 12.3501C19.6001 11.9359 19.9359 11.6001 20.3501 11.6001H22.5669C22.2049 7.08965 18.6106 3.49429 14.1001 3.13232V5.3501C14.1001 5.76431 13.7643 6.1001 13.3501 6.1001C12.9359 6.1001 12.6001 5.76431 12.6001 5.3501Z" fill="#E9E9DD"/>
<path d="M13.3501 1.30029C19.453 1.30029 24.3999 6.2472 24.3999 12.3501C24.3999 18.453 19.453 23.3999 13.3501 23.3999C7.2472 23.3999 2.30029 18.453 2.30029 12.3501C2.30029 6.2472 7.2472 1.30029 13.3501 1.30029ZM14.3999 5.3501C14.3999 5.93 13.93 6.3999 13.3501 6.3999C12.7702 6.3999 12.3003 5.93 12.3003 5.3501V3.46436C8.19688 3.9437 4.94467 7.19677 4.46533 11.3003H6.3501C6.93 11.3003 7.3999 11.7702 7.3999 12.3501C7.3999 12.93 6.93 13.3999 6.3501 13.3999H4.46533C4.94466 17.5033 8.19693 20.7545 12.3003 21.2339V19.3501C12.3003 18.7702 12.7702 18.3003 13.3501 18.3003C13.93 18.3003 14.3999 18.7702 14.3999 19.3501V21.2339C18.5033 20.7545 21.7555 17.5033 22.2349 13.3999H20.3501C19.7702 13.3999 19.3003 12.93 19.3003 12.3501C19.3003 11.7702 19.7702 11.3003 20.3501 11.3003H22.2349C21.7555 7.19677 18.5033 3.9437 14.3999 3.46436V5.3501ZM13.3501 9.30029C13.93 9.30029 14.3999 9.7702 14.3999 10.3501V11.3003H15.3501C15.93 11.3003 16.3999 11.7702 16.3999 12.3501C16.3999 12.93 15.93 13.3999 15.3501 13.3999H14.3999V14.3501C14.3999 14.93 13.93 15.3999 13.3501 15.3999C12.7702 15.3999 12.3003 14.93 12.3003 14.3501V13.3999H11.3501C10.7702 13.3999 10.3003 12.93 10.3003 12.3501C10.3003 11.7702 10.7702 11.3003 11.3501 11.3003H12.3003V10.3501C12.3003 9.7702 12.7702 9.30029 13.3501 9.30029Z" stroke="black" stroke-width="0.6" stroke-linecap="round" stroke-linejoin="round"/>
</g>
<defs>
<filter id="filter0_d_602_38673" x="0" y="0" width="26.7002" height="26.7002" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="1"/>
<feGaussianBlur stdDeviation="1"/>
<feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0"/>
<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_602_38673"/>
<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_602_38673" result="shape"/>
</filter>
</defs>
</svg>`)}`;

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
  const [isScrolled, setIsScrolled] = useState<boolean>(false); // Track if chart is scrolled for recenter button visibility
  
  // Real-time activity feed state
  const [activityFeed, setActivityFeed] = useState<Array<{
    id: string;
    type: 'won' | 'pool_added';
    username?: string;
    amount: number;
    multiplier?: number;
    isYou: boolean;
    timestamp: number;
    isNew?: boolean; // Track if item is newly added
  }>>([]);
  const activityFeedRef = useRef<HTMLDivElement>(null);

  // Load activity feed from localStorage after mount (to avoid hydration mismatch)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('mercury_activity_feed');
        if (stored) {
          const parsed = JSON.parse(stored);
          // Filter out old items (older than 1 hour)
          const oneHourAgo = Date.now() - (60 * 60 * 1000);
          const filtered = parsed.filter((item: any) => item.timestamp > oneHourAgo);
          if (filtered.length > 0) {
            setActivityFeed(filtered);
          }
        }
      } catch (err) {
        console.error('Error loading activity feed from localStorage:', err);
      }
    }
  }, []);

  // Save activity feed to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && activityFeed.length > 0) {
      try {
        localStorage.setItem('mercury_activity_feed', JSON.stringify(activityFeed));
      } catch (err) {
        console.error('Error saving activity feed to localStorage:', err);
      }
    }
  }, [activityFeed]);

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

  // Update price range when price changes significantly to ensure we fetch relevant bets
  useEffect(() => {
    if (wsPrice > 0) {
      setPriceRange(prev => {
        // Only update if price has moved significantly (e.g. more than 20 steps) to avoid too many re-fetches
        const buffer = 50 * priceStep;
        if (wsPrice < prev.min + buffer || wsPrice > prev.max - buffer) {
          return {
            min: wsPrice - (100 * priceStep),
            max: wsPrice + (100 * priceStep)
          };
        }
        return prev;
      });
    }
  }, [wsPrice, priceStep]);
  
  // Update sound functions ref when they change
  useEffect(() => {
    soundsRef.current = { playClick, playWin, playLoss };
  }, [playClick, playWin, playLoss]);
  
  // Stable time for query to prevent constant refetching/cache invalidation
  const [queryTime, setQueryTime] = useState(Math.floor(Date.now() / 1000));
  
  // Update query time every minute to keep window moving
  useEffect(() => {
    const interval = setInterval(() => {
      setQueryTime(Math.floor(Date.now() / 1000));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const { 
    bets: realtimeBets, 
    isLoading: betsLoading,
    error: wsError 
  } = useAllUsersBetsQuery({
    currentTime: queryTime,
    priceMin: priceRange.min,
    priceMax: priceRange.max,
    timeWindowSeconds: 300,
    enabled: true // Enabled for real-time updates
  });

  // Real-time activity feed: Track settlements (wins)
  useEffect(() => {
    if (!settlementsMessage || !address) return;
    
    const settlementTimeperiodId = settlementsMessage.timeperiod_id;
    
    // Extract price range from settlement message (new format: price_min and price_max)
    const settlementPriceMin = parseFloat(settlementsMessage.price_min || settlementsMessage.price) / 1e8;
    const settlementPriceMax = parseFloat(settlementsMessage.price_max || settlementsMessage.price) / 1e8;
    
    // Query all bets for this timeperiod to show wins in activity feed
    const updateActivityFeedFromSettlement = async () => {
      // Skip if already processed for feed
      if (processedFeedSettlementsRef.current.has(settlementTimeperiodId)) return;

      const settlementTimeperiodIdNum = parseInt(settlementTimeperiodId);
      
      console.log(`🔍 Checking feed for settlement ${settlementTimeperiodIdNum}. Realtime bets count: ${realtimeBets?.length || 0}`);

      // 1. Try local realtimeBets first (INSTANT)
      let sourceBets: any[] = realtimeBets.filter(bet => {
        const betTimeperiodId = typeof bet.timeperiod_id === 'string' ? parseInt(bet.timeperiod_id) : bet.timeperiod_id;
        return betTimeperiodId === settlementTimeperiodIdNum;
      });
      
      let usedFallback = false;

      // 2. If no local bets found, fallback to Supabase query (RELIABLE)
      if (!sourceBets || sourceBets.length === 0) {
        console.log(`⚠️ No local bets found for settlement ${settlementTimeperiodIdNum}, fetching from DB...`);
        try {
          const { data: dbBets } = await supabase
            .from('bet_placed_with_session')
            .select('user_address, amount, multiplier, price_min, price_max, timeperiod_id')
            .eq('timeperiod_id', settlementTimeperiodId);
            
          if (dbBets && dbBets.length > 0) {
            console.log(`✅ Fetched ${dbBets.length} bets from DB`);
            sourceBets = dbBets;
            usedFallback = true;
          } else {
             console.log(`❌ No bets found in DB either for ${settlementTimeperiodIdNum}`);
             // Don't return here, just let it fall through to empty check
          }
        } catch (err) {
          console.error("Error fetching bets fallback:", err);
        }
      }

      if (!sourceBets || sourceBets.length === 0) {
        return;
      }

      console.log(`✅ Processing ${sourceBets.length} bets for feed (Fallback: ${usedFallback})`);

      // Mark as processed
      processedFeedSettlementsRef.current.add(settlementTimeperiodId);
      
      // Process ALL bets (not just current user's)
      const allBets = sourceBets;
      
      if (allBets.length === 0) {
        console.log(`ℹ️ No bets found in this settlement`);
        return;
      }
      
      console.log(`👥 Found ${allBets.length} bets from ALL users in this settlement`);
        
      const newActivities: typeof activityFeed = [];
      
      // Fetch usernames for all bet addresses
      const userAddresses = Array.from(new Set(allBets.map(bet => bet.user_address)));
      const usernameMap = new Map<string, string>();
      
      try {
        const { data: profiles } = await supabase
          .from('users')
          .select('wallet_address, username');
        
        console.log('📋 All users from DB:', profiles);
        console.log('🔍 Looking for addresses:', userAddresses);
        
        if (profiles) {
          profiles.forEach(profile => {
            // Store by lowercase address for matching
            usernameMap.set(profile.wallet_address.toLowerCase(), profile.username);
          });
        }
        
        console.log('✅ Username map:', Array.from(usernameMap.entries()));
      } catch (err) {
        console.error('Error fetching usernames:', err);
      }
      
      allBets.forEach(bet => {
        let betPriceMin: number;
        let betPriceMax: number;
        let amount: number;
        let dbMultiplier: number;

        if (usedFallback) {
          // Handle DB format (strings, scaled by 1e8 for price, 1e6 for amount)
          betPriceMin = parseFloat(bet.price_min) / 1e8;
          betPriceMax = parseFloat(bet.price_max) / 1e8;
          amount = parseFloat(bet.amount) / 1e6; // Convert from USDC precision to dollars
          dbMultiplier = bet.multiplier ? parseFloat(bet.multiplier.toString()) : 0;
        } else {
          // Handle UserBet format from realtimeBets (already in dollars for amount)
          // Calculate price range from price_level
          betPriceMin = bet.price_level - priceStep / 2;
          betPriceMax = bet.price_level + priceStep / 2;
          // UserBet.amount is already in dollars (converted in useAllUsersBetsQuery)
          amount = typeof bet.amount === 'string' ? parseFloat(bet.amount) : bet.amount;
          dbMultiplier = bet.multiplier ? parseFloat(bet.multiplier.toString()) : 0;
        }
        
        // Check for overlap - if price ranges overlap, it's a WIN
        const isWin = settlementPriceMin < betPriceMax && settlementPriceMax > betPriceMin;
        const isYou = address && bet.user_address.toLowerCase() === address.toLowerCase();
        const username = usernameMap.get(bet.user_address.toLowerCase()) || bet.user_address.slice(0, 6);

        // Store these for positions table lookup
        bet.isWin = isWin;
        bet.isYou = isYou;
        bet.username = username;
        bet.betPriceMin = betPriceMin;
        bet.betPriceMax = betPriceMax;
        bet.amount = amount;
        bet.dbMultiplier = dbMultiplier;
      });

      // NOW fetch positions table data for ALL users to get accurate multipliers and payouts
      const positionsMap = new Map<string, { multiplier: number; payout: number }>();
      try {
        const { data: positions } = await supabase
          .from('user_positions')
          .select('user_address, timeperiod_id, multiplier, payout_amount, price_min, price_max')
          .eq('timeperiod_id', settlementTimeperiodId);
        
        if (positions) {
          console.log(`📊 Fetched ${positions.length} positions from DB for settlement ${settlementTimeperiodId}`);
          positions.forEach(pos => {
            // Create a key that matches the bet (user + timeperiod + price range)
            const priceMin = parseFloat(pos.price_min) / 1e8;
            const priceMax = parseFloat(pos.price_max) / 1e8;
            const key = `${pos.user_address.toLowerCase()}_${pos.timeperiod_id}_${priceMin.toFixed(2)}_${priceMax.toFixed(2)}`;
            positionsMap.set(key, {
              multiplier: parseFloat(pos.multiplier),
              payout: parseFloat(pos.payout_amount) / 1e6 // Convert from USDC precision
            });
          });
          console.log(`✅ Loaded ${positionsMap.size} positions into map`);
        }
      } catch (err) {
        console.error('Error fetching positions:', err);
      }

      // Process each bet and create activities
      allBets.forEach(bet => {
        const { isWin, isYou, username, betPriceMin, betPriceMax, amount, dbMultiplier } = bet;
        
        // Try to get actual data from positions table
        const posKey = `${bet.user_address.toLowerCase()}_${settlementTimeperiodId}_${betPriceMin.toFixed(2)}_${betPriceMax.toFixed(2)}`;
        const positionData = positionsMap.get(posKey);
        
        let multiplier = dbMultiplier;
        let payout = amount;
        
        if (isWin && positionData) {
          // Use data from positions table (most accurate)
          multiplier = positionData.multiplier;
          payout = positionData.payout;
          console.log(`✅ Using positions table data for ${isYou ? 'YOU' : '@' + username}: multiplier=${multiplier.toFixed(2)}X, payout=$${payout.toFixed(2)}`);
        } else if (isWin && isYou) {
          // Fallback for current user: try selectedCellsRef
          for (const [cellKey, cell] of Array.from(selectedCellsRef.current.entries())) {
            const cellTimeperiodId = Math.floor((cell.t + 0.0001) / GRID_SEC) * GRID_SEC;
            if (cellTimeperiodId === settlementTimeperiodIdNum && cell.multiplier) {
              multiplier = cell.multiplier;
              payout = amount * multiplier;
              console.log(`✅ Using selectedCellsRef for YOU: multiplier=${multiplier.toFixed(2)}X, payout=$${payout.toFixed(2)}`);
              break;
            }
          }
        } else if (isWin) {
          // Last resort: calculate from dbMultiplier
          multiplier = dbMultiplier > 0 ? dbMultiplier : 1.5;
          payout = amount * multiplier;
          console.log(`⚠️ Using DB multiplier for ${isYou ? 'YOU' : '@' + username}: multiplier=${multiplier.toFixed(2)}X, payout=$${payout.toFixed(2)}`);
        }
        
        console.log(`📊 Checking bet: price range [${betPriceMin.toFixed(3)}-${betPriceMax.toFixed(3)}] vs settlement [${settlementPriceMin.toFixed(3)}-${settlementPriceMax.toFixed(3)}], amount: $${amount.toFixed(2)}, multiplier: ${multiplier.toFixed(2)}X`);

        if (isWin) {
          // User WON - payout already calculated above from positions table
          console.log(`🎉 Winner: ${isYou ? 'YOU' : '@' + username} won $${payout.toFixed(2)} (bet: $${amount.toFixed(2)} × ${multiplier.toFixed(1)}X)`);

          newActivities.push({
            id: `won_${bet.user_address}_${settlementTimeperiodId}_${Date.now()}_${Math.random()}`,
            type: 'won',
            username: isYou ? undefined : username,
            amount: payout, // Show the PAYOUT from positions table
            multiplier,
            isYou: !!isYou,
            timestamp: Date.now(),
          });
        } else {
          // User LOST - show "Added to pool $amount"
          console.log(`💸 Lost bet added to pool: $${amount.toFixed(2)} from ${isYou ? 'YOU' : '@' + username}`);

          newActivities.push({
            id: `pool_${bet.user_address}_${settlementTimeperiodId}_${Date.now()}_${Math.random()}`,
            type: 'pool_added',
            username: isYou ? undefined : username,
            amount: amount, // Show the bet amount that was lost
            isYou: !!isYou,
            timestamp: Date.now(),
          });
        }
      });
      
      // Add new activities to the top of the feed
      if (newActivities.length > 0) {
        console.log(`📢 Adding ${newActivities.length} activities to feed:`, newActivities.map(a => `${a.type}: ${a.isYou ? 'YOU' : a.username} $${a.amount.toFixed(2)}`));
        
        // Mark new items as highlighted
        const highlightedActivities = newActivities.map(activity => ({
          ...activity,
          isNew: true
        }));
        
        setActivityFeed((prev) => {
          const combined = [...highlightedActivities, ...prev];
          console.log(`📋 Activity feed now has ${combined.length} items`);
          return combined.slice(0, 20); // Keep last 20 items
        });
        
        // Auto-scroll to top to show new items
        setTimeout(() => {
          if (activityFeedRef.current) {
            activityFeedRef.current.scrollTop = 0;
          }
        }, 10);
        
        // Remove highlight after 3 seconds
        setTimeout(() => {
          setActivityFeed((prev) => 
            prev.map(item => 
              highlightedActivities.some(na => na.id === item.id) 
                ? { ...item, isNew: false }
                : item
            )
          );
        }, 3000);
      }
    };
    
    updateActivityFeedFromSettlement();
  }, [settlementsMessage, address, realtimeBets, priceStep]);

  // Real-time bet placement tracking: DISABLED - Only show settlements (wins/losses)
  // We don't show "added to pool" for bet placements anymore, only for losses after settlement
  const processedBetIdsRef = useRef<Set<string>>(new Set());
  
  // Commented out bet placement tracking - we only show settlement results
  /*
  useEffect(() => {
    if (!realtimeBets || realtimeBets.length === 0) return;
    
    // Check for new bets
    realtimeBets.forEach(async (bet) => {
      const betId = `${bet.grid_id}_${bet.user_address}_${bet.created_at}`;
      
      // Skip if already processed
      if (processedBetIdsRef.current.has(betId)) return;
      
      processedBetIdsRef.current.add(betId);
      
      const isYou = address && bet.user_address.toLowerCase() === address.toLowerCase();
      
      // Fetch username for the user
      let username = bet.user_address.slice(0, 6);
      try {
        const { data: profile } = await supabase
          .from('users')
          .select('username')
          .eq('wallet_address', bet.user_address.toLowerCase())
          .maybeSingle();
        
        if (profile?.username) {
          username = profile.username;
        }
      } catch (err) {
        console.error('Error fetching username:', err);
      }
      
      // Add bet placement to activity feed
      const newActivity = {
        id: `bet_${betId}_${Date.now()}_${Math.random()}`,
        type: 'pool_added' as const,
        username: isYou ? undefined : username,
        amount: bet.amount,
        isYou: !!isYou,
        timestamp: Date.now(),
        isNew: true
      };
      
      console.log(`💰 New bet placed: ${isYou ? 'YOU' : '@' + username} added $${bet.amount.toFixed(2)} to pool`);
      
      setActivityFeed((prev) => {
        // Check if this bet is already in feed (avoid duplicates)
        const exists = prev.some(item => item.id.includes(betId));
        if (exists) return prev;
        
        const combined = [newActivity, ...prev];
        return combined.slice(0, 20); // Keep last 20 items
      });
      
      // Auto-scroll to top
      setTimeout(() => {
        if (activityFeedRef.current) {
          activityFeedRef.current.scrollTop = 0;
        }
      }, 10);
      
      // Remove highlight after 3 seconds
      setTimeout(() => {
        setActivityFeed((prev) => 
          prev.map(item => 
            item.id === newActivity.id 
              ? { ...item, isNew: false }
              : item
          )
        );
      }, 3000);
    });
  }, [realtimeBets, address]);
  */

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

  // REAL-TIME BET NOTIFICATIONS - Show "Added to pool" immediately when bets are placed
  const instantBetNotificationsRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    if (!realtimeBets || realtimeBets.length === 0) return;
    
    // Find NEW bets that we haven't processed yet
    const newBets = realtimeBets.filter(bet => {
      const betId = `${bet.user_address}_${bet.timeperiod_id}_${bet.price_level}_${bet.created_at}`;
      return !instantBetNotificationsRef.current.has(betId);
    });
    
    if (newBets.length === 0) return;
    
    // Fetch usernames for the new bets
    const fetchAndShowBets = async () => {
      const userAddresses = Array.from(new Set(newBets.map(bet => bet.user_address)));
      const usernameMap = new Map<string, string>();
      
      try {
        const { data: profiles } = await supabase
          .from('users')
          .select('wallet_address, username');
        
        if (profiles) {
          profiles.forEach(profile => {
            usernameMap.set(profile.wallet_address.toLowerCase(), profile.username);
          });
        }
      } catch (err) {
        console.error('Error fetching usernames for real-time bets:', err);
      }
      
      const newActivities: typeof activityFeed = [];
      
      newBets.forEach(bet => {
        const betId = `${bet.user_address}_${bet.timeperiod_id}_${bet.price_level}_${bet.created_at}`;
        instantBetNotificationsRef.current.add(betId);
        
        const isYou = address && bet.user_address.toLowerCase() === address.toLowerCase();
        const username = usernameMap.get(bet.user_address.toLowerCase()) || bet.user_address.slice(0, 6);
        const amount = typeof bet.amount === 'string' ? parseFloat(bet.amount) : bet.amount;
        
        console.log(`💰 INSTANT bet notification: ${isYou ? 'YOU' : '@' + username} added $${amount.toFixed(2)} to pool`);
        
        newActivities.push({
          id: `instant_${betId}_${Date.now()}`,
          type: 'pool_added',
          username: isYou ? undefined : username,
          amount: amount,
          isYou: !!isYou,
          timestamp: Date.now(),
          isNew: true
        });
      });
      
      if (newActivities.length > 0) {
        setActivityFeed((prev) => {
          const combined = [...newActivities, ...prev];
          return combined.slice(0, 20);
        });
        
        // Auto-scroll to top
        setTimeout(() => {
          if (activityFeedRef.current) {
            activityFeedRef.current.scrollTop = 0;
          }
        }, 10);
        
        // Remove highlight after 3 seconds
        setTimeout(() => {
          setActivityFeed((prev) => 
            prev.map(item => ({ ...item, isNew: false }))
          );
        }, 3000);
      }
    };
    
    fetchAndShowBets();
  }, [realtimeBets, address]);

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

  // Track realtime bets count for other purposes (not for activity feed)
  const previousBetsCountRef = useRef<number>(0);
  useEffect(() => {
    if (!realtimeBets || realtimeBets.length === 0) return;
    // Just update the count - activity feed is handled by settlement events
    previousBetsCountRef.current = realtimeBets.length;
  }, [realtimeBets]);

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
          forceUpdate();
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
        forceUpdate();

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
              else if (timeUntilStart < 40) effectiveBasePrice = 0.35;
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
            
            // console.log('⚡ OPTIMISTIC multiplier (instant):', {
            //   cacheKey,
            //   previousShares: previousExistingShares,
            //   newBetShares: bet.shares,
            //   estimatedTotal: estimatedExistingShares,
            //   basePrice: effectiveBasePrice,
            //   dynamicB: bNumber.toFixed(2),
            //   price: currentPrice.toFixed(4),
            //   multiplier: optimisticMultiplier.toFixed(2) + 'x',
            //   latency: '<1ms'
            // });

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
      // Use parent container dimensions instead of window for proper responsive sizing
      const parent = canvas.parentElement;
      if (parent) {
        const rect = parent.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
      } else {
        // Fallback to window dimensions if no parent
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }
    };
    resize();
    window.addEventListener("resize", resize);
    
    // Also observe parent size changes
    const resizeObserver = new ResizeObserver(() => {
      resize();
    });
    if (canvas.parentElement) {
      resizeObserver.observe(canvas.parentElement);
    }

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

    let frame: number | undefined;
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

      // Clear canvas with transparent background to allow gradient to show through
      ctx.clearRect(0, 0, w, h);

      const baseOffsetX = (now % GRID_SEC) * pxPerSec;
      const offsetX = baseOffsetX - (timeOffsetRef.current % GRID_SEC) * pxPerSec - (GRID_SEC / 2) * pxPerSec;
      const visible = historyRef.current.filter((d) => now - d.t < DURATION);
      const prices = visible.map((d) => d.v);
      const minPrice = Math.min(...prices, price - 0.3);
      const maxPrice = Math.max(...prices, price + 0.3);
      const range = maxPrice - minPrice;

      // Draw grid - make lines more vibrant and clear
      ctx.strokeStyle = CHART_COLORS.GRID_LINE;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 1; // Ensure full opacity for grid lines
      const gridW = CELL_SIZE;
      const gridH = CELL_SIZE;
      
      // Width of area reserved for price labels - grid lines should not overlap this area
      // Price labels are drawn at x=60, so we start grid lines just after them with a small gap
      const priceLabelAreaWidth = 68;

      // Vertical grid lines (time)
      // Skip the left area where price labels are displayed (avoid overlap with price labels)
      for (let i = -Math.ceil(w / gridW) - 1; i < Math.ceil(w / gridW) + 2; i++) {
        const x = centerX + i * gridW - offsetX;
        // Only draw vertical lines that are to the right of the price label area
        if (x >= priceLabelAreaWidth) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
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
      // Skip the left area where price labels are displayed (start after price label area to avoid overlap)
      for (let i = 0; i < numPriceLevels; i++) {
        const priceLevel = startPrice + i * priceStep;
        const y = h / 2 - (priceLevel - price - priceOffset) * pxPerPrice;
        ctx.beginPath();
        ctx.moveTo(priceLabelAreaWidth, y); // Start after price label area
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Price labels on left - draw for all visible levels
      ctx.fillStyle = CHART_COLORS.TEXT;
      ctx.font = "300 13px 'Geist',sans-serif";
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

      // Price line drawing moved to end of draw function to ensure correct layering

      // Calculate NOW line position once (moves with time offset)
      const nowLineX = centerX + (timeOffsetRef.current * pxPerSec) +(GRID_SEC / 2) * pxPerSec - GRID_SEC * pxPerSec;

      // Green NOW line - moves with time offset (dashed with colored gaps)
      // First draw solid line in gap color
      ctx.strokeStyle = "#162A19";
      ctx.lineWidth = 1;
      ctx.setLineDash([]); // Solid line
      ctx.beginPath();
      ctx.moveTo(nowLineX, 0);
      ctx.lineTo(nowLineX, h);
      ctx.stroke();

      // Then draw dashed line on top (gaps will show the gap color underneath)
      // #00ff24 at 20% opacity = rgba(0, 255, 36, 0.2)
      ctx.strokeStyle = "rgba(0, 255, 36, 0.4)";
      ctx.lineWidth = 1;
      ctx.setLineDash([15, 15]); // Dashed pattern: 15px dash, 15px gap
      ctx.beginPath();
      ctx.moveTo(nowLineX, 0);
      ctx.lineTo(nowLineX, h);
      ctx.stroke();
      ctx.setLineDash([]); // Reset to solid line

      // Draw upward-pointing triangle arrow at the very top
      const arrowSize = 7; // Size of the triangle
      const arrowY = 0; // Position at the top
      const triangleBottomY = arrowY + arrowSize; // Bottom of top triangle
      
      // Draw drop shadow for arrow
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowBlur = 1.45;
      ctx.shadowColor = "rgba(0, 255, 36, 0.15)";
      
      // Draw the triangle (upward pointing)
      ctx.beginPath();
      ctx.moveTo(nowLineX, triangleBottomY); // Bottom point
      ctx.lineTo(nowLineX - arrowSize, arrowY); // Top left
      ctx.lineTo(nowLineX + arrowSize, arrowY); // Top right
      ctx.closePath();
      ctx.fillStyle = "#00FF24";
      ctx.fill();
      
      // Reset shadow
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      // Draw NOW text background and border exactly as per CSS
      // Position NOW text below the triangle with spacing
      const textY = triangleBottomY + 10; // Position below triangle
      
      ctx.font = "500 9px 'Geist',sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      
      // Measure text to calculate background size
      const textMetrics = ctx.measureText("now");
      const textWidth = textMetrics.width;
      const textHeight = 9; // Font size
      
      // CSS specs: Padding Top: 7px, Right: 8px, Bottom: 7px, Left: 8px
      const paddingTop = 7;
      const paddingRight = 8;
      const paddingBottom = 7;
      const paddingLeft = 8;
      
      // Calculate background dimensions
      const bgWidth = textWidth + paddingLeft + paddingRight;
      const bgHeight = textHeight + paddingTop + paddingBottom;
      const bgX = nowLineX - bgWidth / 2;
      const bgY = textY - bgHeight / 2; // Center vertically at textY
      
      // CSS: Radius: 24px
      const borderRadius = 24;
      
      // Draw background with rounded rectangle
      // CSS: Colors background: rgba(0, 25, 4, 1)
      ctx.fillStyle = "#001904";
      ctx.beginPath();
      ctx.roundRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
      ctx.fill();
      
      // Draw border: 0.5px with rgba(0, 255, 36, 0.2)
      ctx.strokeStyle = "#00FF241A";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.roundRect(bgX, bgY, bgWidth, bgHeight, borderRadius);
      ctx.stroke();
      
      // Fill NOW text in white
      ctx.fillStyle = "#00FF24";
      ctx.fillText("now", nowLineX, textY);
      
      // Draw connecting line from top triangle to NOW box
      // ctx.strokeStyle = "#00FF24";
      // ctx.lineWidth = 1;
      // ctx.beginPath();
      // ctx.moveTo(nowLineX, triangleBottomY);
      // ctx.lineTo(nowLineX, bgY);
      // ctx.stroke();
      
      // Draw connecting line from NOW box to bottom triangle
      const boxBottomY = bgY + bgHeight;
      const arrowYBottom = boxBottomY+1; // Position below the NOW text box with spacing
      
      ctx.beginPath();
      ctx.moveTo(nowLineX, boxBottomY);
      ctx.lineTo(nowLineX, arrowYBottom);
      ctx.stroke();
      
      // Draw downward-pointing triangle arrow below NOW text
      
      // Draw drop shadow for arrow
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowBlur = 1.45;
      ctx.shadowColor = "rgba(0, 255, 36, 0.15)";
      
      // Draw the triangle (downward pointing)
      ctx.beginPath();
      ctx.moveTo(nowLineX, arrowYBottom); // Top point
      ctx.lineTo(nowLineX - arrowSize, arrowYBottom + arrowSize); // Bottom left
      ctx.lineTo(nowLineX + arrowSize, arrowYBottom + arrowSize); // Bottom right
      ctx.closePath();
      ctx.fillStyle = "#00FF24";
      ctx.fill();
      
      // Reset shadow
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      // Current price dot and badge moved to end of draw function


      // Connection status indicator
      ctx.fillStyle = isConnected ? "#00ff24" : "#ff3333";
      ctx.font = "12px 'Geist',sans-serif";
      ctx.textAlign = "left";
      // Order placement status
      if (isPlacingOrder) {
        ctx.fillStyle = "#ffa500";
        ctx.font = "12px 'Geist',sans-serif";
        ctx.textAlign = "left";
        ctx.fillText("🔄 Placing Order...", 20, 50);
      }

      // Time labels on top
      ctx.fillStyle = "rgba(238, 237, 236, 1)";
      ctx.font = "300 13px 'Geist',sans-serif";
      ctx.textAlign = "center";
      for (let i = -Math.ceil(w / gridW) - 1; i < Math.ceil(w / gridW) + 2; i++) {
        const x = centerX + i * gridW - offsetX - GRID_SEC * pxPerSec;
        const distanceFromNowLine = Math.abs(x - nowLineX);
        const hideThreshold = 10; // Hide labels within 10px of NOW line
        
        // Skip labels that are too close to the left edge (where price labels are)
        if (x < priceLabelAreaWidth) {
          continue; // Skip drawing this label
        }
        
        if (distanceFromNowLine < hideThreshold) {
          continue; // Skip drawing this label
        }
        const timeOffset = i * GRID_SEC;  // ADD GRID_SEC to shift labels 5 seconds left
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
        // Add small epsilon to handle floating point precision issues at boundaries
        const cellTime = now + (i * GRID_SEC) - timeOffsetRef.current + 0.0001;
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
          // if ((touchesNowLine || isPastCell) && !settlementState && !hasOtherUsersBetsQuick) {
          //   continue;
          // }
          
          // Skip drawing multiplier if this is the EXACT hovered cell
          // We need to check if this cell's visual position matches the hover position
          let isHoveredCell = false;
          if (currentHover) {
            // Calculate the hovered cell's position
            const hoverCenterX = centerX + (currentHover.t - now) * pxPerSec - (GRID_SEC / 2) * pxPerSec;
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
          
          // Check if this cell is selected using robust comparison
          // Instead of relying on string key matching which can be fragile,
          // check if any selected cell matches the current cell's timeperiod and price level
          let isSelectedCell = false;
          
          // Iterate through selected cells to find a match
          // This is more robust than key matching because we can use tolerance
          for (const selected of Array.from(selectedCellsRef.current.values())) {
            // Calculate timeperiod for the selected cell
            // Add small epsilon to match the cellTime calculation above
            const selectedTimeperiodId = Math.floor((selected.t + 0.0001) / GRID_SEC) * GRID_SEC;
            
            // Check if timeperiod matches
            if (selectedTimeperiodId === timeperiodId) {
              // Check if price level matches (with small tolerance for float precision)
              if (Math.abs(selected.priceLevel - priceLevel) < 0.001) {
                isSelectedCell = true;
                break;
              }
            }
          }
          
          // if (!isSelectedCell) {
            // Check if other users have bets on this grid - if so, show RED nextUserMultiplier
            // Try multiple gridId formats to match realtimeBets (which uses 2 decimals)
            
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
            // const settlementState = otherUsersSettlementsRef.current.get(gridId1) 
            //   || otherUsersSettlementsRef.current.get(gridId2);
            // const touchesNowLine = cellX <= nowLineX && cellX + gridW >= nowLineX;
            // const isPastCell = cellX + gridW < nowLineX;
            // const hasOtherUsersBets = !!(otherUsersBets && otherUsersBets.length > 0);
            
            // Hide multipliers for past cells AND cells touching the NOW line
            // The user requested: "it should disapperar after touching now line"
            if (isPastCell || touchesNowLine) {
              continue;
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
            
            // Draw multiplier - Figma specs: Inter 900 italic 14px, centered, light gray
            // Use light gray for normal multipliers, yellow for when other users have bet
            const multiplierTextColor = multiplierColor === "#FFDA00" ? "#FFDA00" : "#B0B0B0";
            
            // Hide multiplier when too close to NOW line OR when in top row near time labels (unless panning)
            // Calculate the x position where the time label would be drawn (same as time labels loop)
            const timeLabelX = centerX + i * gridW - offsetX;
            const distanceFromNowLine = Math.abs(timeLabelX - nowLineX);
            const hideThreshold = 10; // Same threshold as time labels
            
            // Center the multiplier in the cell
            const cellCenterX = cellX + gridW / 2;
            const cellCenterY = cellY + gridH / 2;
            
            // Check if cell is too close to NOW line (near 0 seconds)
            const isTooCloseToNowLine = Math.abs(cellCenterX - nowLineX) < hideThreshold;
            
            // Determine whether the time label is currently visible (not hidden near NOW)
            const timeLabelIsVisible = distanceFromNowLine >= hideThreshold;
            
            // Cells whose center is near the time-label area (top ~30px where time labels are drawn)
            const isNearTimeLabelBand = cellCenterY < 30;
            
            // Hide multiplier when:
            // 1. Too close to NOW line (near 0 seconds), OR
            // 2. Time label is visible AND cell is near top row
            // But show all when panning
            if ((isTooCloseToNowLine || (timeLabelIsVisible && isNearTimeLabelBand)) && !isPanning2DRef.current) {
              // Skip drawing multiplier when too close to NOW line or time labels
            } else {
              // Draw multiplier when time label is NOT visible in the band OR when panning
            ctx.fillStyle = multiplierTextColor;
            
            // Figma typography: Geist, 900 weight, italic, 14px, -5% letter spacing
            // Canvas doesn't support letter-spacing directly, so we approximate with font styling
            ctx.font = "900 italic 14px Geist, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            
            // Add pulsing glow effect for yellow multiplier (#FFDA00)
            if (multiplierColor === "#FFDA00") {
              const pulseIntensity = (Math.sin(Date.now() / 500) + 1) / 2; // 0 to 1, ~1 second cycle
              const glowIntensity = 0.7 + (pulseIntensity * 0.3); // Pulse between 0.7 and 1.0 (very bright)
              // Draw multiple layers for stronger glow effect
              ctx.shadowBlur = 50 * glowIntensity;
              ctx.shadowColor = "#FFDA00";
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellCenterX, cellCenterY);
              ctx.shadowBlur = 30 * glowIntensity;
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellCenterX, cellCenterY);
              ctx.shadowBlur = 15 * glowIntensity;
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellCenterX, cellCenterY);

              // Final draw without shadow for crisp text
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellCenterX, cellCenterY);
            } else {
              // Regular multiplier - no glow, just centered light gray text
              ctx.fillText(`${displayMultiplier.toFixed(1)}X`, cellCenterX, cellCenterY);
            }
            
            // Reset shadow and text alignment after drawing
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            }
          // }
          
          // Draw bet count if > 1 (with user icon)
          // REMOVED: We don't want to show other users' bet counts
        }
      }
    

      // Draw all selected cells with state-based colors
      selectedCellsRef.current.forEach((selected, cellKey) => {
        const selCenterX = centerX + (selected.t - now) * pxPerSec + (timeOffsetRef.current * pxPerSec) - (GRID_SEC / 2) * pxPerSec;
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
            
            // Stay at full opacity for visible duration, then fade
            const alpha = elapsed < visibleDuration ? 1 : 1 - ((elapsed - visibleDuration) / fadeDuration);
            
            // Red lost state - continuous bright glow effect, no background color
            // Mask background to hide underlying multiplier
            ctx.fillStyle = "#000000";
            ctx.fillRect(selLeft, selTop, gridW, gridH);

            // Continuous glow at maximum intensity (fades out over time)
            // Add intense red glow effect (multiple layers for gaming look) at maximum intensity
            // Layer 1: Outer glow (softest, largest) - continuous bright
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            ctx.shadowBlur = 30;
            ctx.shadowColor = `rgba(255, 94, 94, ${0.6 * alpha})`;
            ctx.strokeStyle = `rgba(255, 94, 94, ${0.2 * alpha})`;
            ctx.lineWidth = 3;
            ctx.strokeRect(selLeft, selTop, gridW, gridH);
            
            // Layer 2: Mid glow (medium intensity) - continuous bright
            ctx.shadowBlur = 20;
            ctx.shadowColor = `rgba(255, 94, 94, ${0.8 * alpha})`;
            ctx.strokeStyle = `rgba(255, 94, 94, ${0.3 * alpha})`;
            ctx.lineWidth = 2;
            ctx.strokeRect(selLeft, selTop, gridW, gridH);
            
            // Layer 3: Inner glow (brightest, tightest) - continuous bright
            ctx.shadowBlur = 15;
            ctx.shadowColor = `rgba(255, 94, 94, ${1.0 * alpha})`;
            ctx.strokeStyle = `rgba(255, 94, 94, ${0.5 * alpha})`;
            ctx.lineWidth = 1.5;
            ctx.strokeRect(selLeft, selTop, gridW, gridH);
            
            // Draw main border (no fill, transparent background)
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            ctx.strokeStyle = `rgba(255, 94, 94, ${0.6 * alpha})`;
            ctx.lineWidth = 1;
            ctx.strokeRect(selLeft, selTop, gridW, gridH);
            
            // Draw thick corner indicators (L-shaped) at all 4 corners with continuous glow
            const cornerSize = 8; // Thicker corners
            const cornerThickness = 2; // Thicker lines for corners
            ctx.strokeStyle = `rgba(255, 94, 94, ${alpha})`;
            ctx.lineWidth = cornerThickness;
            ctx.lineCap = "square";
            
            // Add continuous glow to corners
            ctx.shadowBlur = 8;
            ctx.shadowColor = `rgba(255, 94, 94, ${0.8 * alpha})`;
            
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
            
            // Reset shadow
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            
            // Draw only bet amount with negative sign in center - shows how much was lost
            ctx.fillStyle = `rgba(255, 94, 94, ${alpha})`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            
            // Center the amount in the cell
            const cellCenterX = selLeft + gridW / 2;
            const cellCenterY = selTop + gridH / 2;
            
            // Show negative bet amount (how much user lost)
            const betAmount = selected.betAmount || 0.20; // Default to $0.20 if not set
            ctx.font = "900 italic 16px Geist, sans-serif";
            ctx.fillText(`-$${betAmount.toFixed(2)}`, cellCenterX, cellCenterY);
            
            ctx.textAlign = "left";
            ctx.textBaseline = "alphabetic";
            
            return;
          }
          
          // State-based rendering
          switch (selected.status) {
            case 'pending':
              // Hover state styling with spinner
              // Mask background to hide underlying multiplier
              ctx.fillStyle = "#000000";
              ctx.fillRect(selLeft, selTop, gridW, gridH);
              
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
                // const multiplierY = Math.round(selTop + gridH / 2 - 12);
                // const amountY = Math.round(selTop + gridH / 2 + 6);
                
                // Draw current user multiplier (white, larger, bold)
                // ctx.font = "200 11px 'Geist Mono',monospace";
                // ctx.fillText(`${selected.multiplier.toFixed(2)}X`, selLeft + gridW / 2, multiplierY);
                
                // Draw payout amount
                ctx.font = "300 15px 'Geist',sans-serif";
                ctx.fillText(`$${selected.payout.toFixed(2)}`, selLeft + gridW / 2, selTop + gridH / 2);
                
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
              // Yellow confirmed orders - continuous bright glow effect, no background color
              // Mask background to hide underlying multiplier
              ctx.fillStyle = "#000000";
              ctx.fillRect(selLeft, selTop, gridW, gridH);

              // Add intense yellow glow effect (multiple layers for gaming look) at maximum intensity
              // Layer 1: Outer glow (softest, largest) - continuous bright
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 0;
              ctx.shadowBlur = 30;
              ctx.shadowColor = "rgba(255, 218, 0, 0.6)";
              ctx.strokeStyle = "rgba(255, 218, 0, 0.2)";
              ctx.lineWidth = 3;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Layer 2: Mid glow (medium intensity) - continuous bright
              ctx.shadowBlur = 20;
              ctx.shadowColor = "rgba(255, 218, 0, 0.8)";
              ctx.strokeStyle = "rgba(255, 218, 0, 0.3)";
              ctx.lineWidth = 2;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Layer 3: Inner glow (brightest, tightest) - continuous bright
              ctx.shadowBlur = 15;
              ctx.shadowColor = "rgba(255, 218, 0, 1.0)";
              ctx.strokeStyle = "rgba(255, 218, 0, 0.5)";
              ctx.lineWidth = 1.5;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Draw main border (no fill, transparent background)
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              ctx.strokeStyle = "rgba(255, 218, 0, 0.6)";
              ctx.lineWidth = 1;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Draw thick corner indicators (L-shaped) at all 4 corners with continuous glow
              const cornerSize = 8; // Thicker corners
              const cornerThickness = 2; // Thicker lines for corners
              ctx.strokeStyle = "#FFDA00";
              ctx.lineWidth = cornerThickness;
              ctx.lineCap = "square";
              
              // Add continuous glow to corners
              ctx.shadowBlur = 8;
              ctx.shadowColor = "rgba(255, 218, 0, 0.8)";
              
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
              
              // Reset shadow
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              
              // Draw only payout amount in center - Figma specs: Inter 900 italic 18px, yellow color
              ctx.fillStyle = "#FFDA00";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              
              // Center the payout in the cell
              const cellCenterX = selLeft + gridW / 2;
              const cellCenterY = selTop + gridH / 2;
              
              // Show only payout if available
              if (selected.payout) {
                // Figma typography: Geist, 900 weight, italic, 18px
                ctx.font = "900 italic 16px Geist, sans-serif";
                ctx.fillText(`$${selected.payout.toFixed(2)}`, cellCenterX, cellCenterY);
              } else {
                // Fallback to price
                ctx.font = "900 italic 16px Geist, sans-serif";
                ctx.fillText(`$${selected.priceLevel.toFixed(priceDecimals)}`, cellCenterX, cellCenterY);
              }
              ctx.textAlign = "left";
              ctx.textBaseline = "alphabetic";
              break;
            }
              
            case 'won': {
              const elapsedWin = now * 1000 - selected.timestamp;
              
              // Green won state - continuous bright glow effect, no background color
              // Mask background to hide underlying multiplier
              ctx.fillStyle = "#000000";
              ctx.fillRect(selLeft, selTop, gridW, gridH);

              // Add intense green glow effect (multiple layers for gaming look) at maximum intensity
              // Layer 1: Outer glow (softest, largest) - continuous bright
              ctx.shadowOffsetX = 0;
              ctx.shadowOffsetY = 0;
              ctx.shadowBlur = 30;
              ctx.shadowColor = "rgba(0, 255, 36, 0.6)";
              ctx.strokeStyle = "rgba(0, 255, 36, 0.2)";
              ctx.lineWidth = 3;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Layer 2: Mid glow (medium intensity) - continuous bright
              ctx.shadowBlur = 20;
              ctx.shadowColor = "rgba(0, 255, 36, 0.8)";
              ctx.strokeStyle = "rgba(0, 255, 36, 0.3)";
                  ctx.lineWidth = 2;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Layer 3: Inner glow (brightest, tightest) - continuous bright
              ctx.shadowBlur = 15;
              ctx.shadowColor = "rgba(0, 255, 36, 1.0)";
              ctx.strokeStyle = "rgba(0, 255, 36, 0.5)";
              ctx.lineWidth = 1.5;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Draw main border (no fill, transparent background)
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              ctx.strokeStyle = "rgba(0, 255, 36, 0.6)";
              ctx.lineWidth = 1;
              ctx.strokeRect(selLeft, selTop, gridW, gridH);
              
              // Draw thick corner indicators (L-shaped) at all 4 corners with continuous glow
              const cornerSizeWon = 8; // Thicker corners
              const cornerThickness = 2; // Thicker lines for corners
              ctx.strokeStyle = "#00ff24";
              ctx.lineWidth = cornerThickness;
              ctx.lineCap = "square";
              
              // Add continuous glow to corners
              ctx.shadowBlur = 8;
              ctx.shadowColor = "rgba(0, 255, 36, 0.8)";
              
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
              
              // Reset shadow
              ctx.shadowBlur = 0;
              ctx.shadowColor = "transparent";
              
              // Draw only payout amount in center - Figma specs: Geist 900 italic 18px, green color
              ctx.fillStyle = "#00ff24";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              
              // Center the payout in the cell
              const cellCenterX = selLeft + gridW / 2;
              const cellCenterY = selTop + gridH / 2;
              
              // Show only payout if available
              if (selected.payout) {
                // Figma typography: Geist, 900 weight, italic, 18px
                ctx.font = "900 italic 16px Geist, sans-serif";
                ctx.fillText(`$${selected.payout.toFixed(2)}`, cellCenterX, cellCenterY);
              } else {
                // Fallback to price
                ctx.font = "900 italic 16px Geist, sans-serif";
                ctx.fillText(`$${selected.priceLevel.toFixed(priceDecimals)}`, cellCenterX, cellCenterY);
              }
              
              ctx.textAlign = "left";
              ctx.textBaseline = "alphabetic";
              
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
                
                ctx.font = "italic 800 24px 'Geist',sans-serif";
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
          const selCenterX = centerX + (cellTime - now) * pxPerSec + (timeOffsetRef.current * pxPerSec) - (GRID_SEC / 2) * pxPerSec;
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
            ctx.font = "bold 14px 'Geist',sans-serif";
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
        const hoverCenterX = centerX + (hover.t - now) * pxPerSec - (GRID_SEC / 2) * pxPerSec;
        const hoverLeft = Math.round(hoverCenterX - gridW / 2);
        const basePriceHover = Math.floor(price / priceStep) * priceStep;
        const hoverTop = Math.round(h / 2 - (basePriceHover - price - priceOffset) * pxPerPrice + hover.gyIndex * gridH);
        const priceLevel = basePriceHover - hover.gyIndex * priceStep;  // Changed: subtract instead of add
        const cellKey = `${Math.round(hover.t * 10)}_${priceLevel.toFixed(priceDecimals)}`;
        const isSelected = selectedCellsRef.current.has(cellKey);

        if (hoverLeft + gridW >= 0 && hoverLeft <= w && hoverTop + gridH >= 0 && hoverTop <= h && !isSelected) {
          // Draw circular glow effect on grid lines around hovered cell
          const cellCenterX = hoverLeft + gridW / 2;
          const cellCenterY = hoverTop + gridH / 2;
          
          // Reduced radius - about 1.0 cells (shorter lines)
          const glowRadius = 1.0 * Math.max(gridW, gridH);
          const fadeLength = 0.3 * Math.max(gridW, gridH); // Length of fade at line ends
          
          ctx.save();
          
          // Draw circular glow on horizontal grid lines (price lines) around hovered cell
          // Include the hovered cell's own borders (no skip for i === 0)
          for (let i = -2; i <= 2; i++) {
            const glowPriceLevel = priceLevel + (i * priceStep);
            const glowY = h / 2 - (glowPriceLevel - price - priceOffset) * pxPerPrice;
            
            // Calculate distance from cell center (circular distance)
            const dy = Math.abs(glowY - cellCenterY);
            const distanceFromCenter = Math.sqrt(dy * dy);
            
            // Only glow if within the circular radius
            if (distanceFromCenter <= glowRadius && glowY >= 0 && glowY <= h) {
              // Calculate glow intensity based on distance (circular falloff)
              const glowIntensity = Math.max(0, (1 - (distanceFromCenter / glowRadius)) * 0.3); // Max 30% opacity (subtle)
              
              if (glowIntensity > 0.05) {
                // Only draw the portion of the line within the circular radius
                // Calculate intersection points with the circular radius
                const dx = Math.sqrt(Math.max(0, glowRadius * glowRadius - dy * dy));
                let glowStartX = Math.max(priceLabelAreaWidth, cellCenterX - dx);
                let glowEndX = Math.min(w, cellCenterX + dx);
                
                // Add fade at the ends (reduce line length slightly)
                const lineLength = glowEndX - glowStartX;
                if (lineLength > fadeLength * 2) {
                  glowStartX += fadeLength;
                  glowEndX -= fadeLength;
                }
                
                // Create gradient for fade effect at line ends
                const gradient = ctx.createLinearGradient(glowStartX, glowY, glowEndX, glowY);
                const baseOpacity = 0.15 + glowIntensity * 0.15; // 15-30% opacity
                gradient.addColorStop(0, `rgba(255, 255, 255, 0)`); // Fade at start
                gradient.addColorStop(0.2, `rgba(255, 255, 255, ${baseOpacity * 0.5})`); // Fade in
                gradient.addColorStop(0.5, `rgba(255, 255, 255, ${baseOpacity})`); // Full in middle
                gradient.addColorStop(0.8, `rgba(255, 255, 255, ${baseOpacity * 0.5})`); // Fade out
                gradient.addColorStop(1, `rgba(255, 255, 255, 0)`); // Fade at end
                
                // Apply subtle circular glow effect
                ctx.shadowBlur = 6 * glowIntensity; // Reduced shadow
                ctx.shadowColor = "rgba(255, 255, 255, 0.2)"; // Subtle shadow
                ctx.strokeStyle = gradient;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(glowStartX, glowY);
              ctx.lineTo(glowEndX, glowY);
              ctx.stroke();
              }
            }
          }
          
          // Draw circular glow on vertical grid lines (time lines) around hovered cell
          // Include the hovered cell's own borders (no skip for i === 0)
          // Use the same calculation as the actual grid lines for perfect alignment
          const baseOffsetX = (now % GRID_SEC) * pxPerSec;
          const offsetX = baseOffsetX - (timeOffsetRef.current % GRID_SEC) * pxPerSec - (GRID_SEC / 2) * pxPerSec;
          
          // Calculate the grid index for the hovered cell's center
          // Grid lines use: x = centerX + i * gridW - offsetX
          // So: i = (x - centerX + offsetX) / gridW
          const hoverGridIndex = Math.round((cellCenterX - centerX + offsetX) / gridW);
          
          for (let i = -2; i <= 2; i++) {
            // Use the same formula as the grid lines: centerX + i * gridW - offsetX
            const gridIndex = hoverGridIndex + i;
            const glowX = centerX + gridIndex * gridW - offsetX;
            
            // Only draw if within the price label area boundary
            if (glowX >= priceLabelAreaWidth && glowX <= w) {
              // Calculate distance from cell center (circular distance)
              const dx = Math.abs(glowX - cellCenterX);
              const distanceFromCenter = Math.sqrt(dx * dx);
              
              // Only glow if within the circular radius
              if (distanceFromCenter <= glowRadius) {
                // Calculate glow intensity based on distance (circular falloff)
                const glowIntensity = Math.max(0, (1 - (distanceFromCenter / glowRadius)) * 0.3); // Max 30% opacity (subtle)
                
                if (glowIntensity > 0.05) {
                  // Only draw the portion of the line within the circular radius
                  // Calculate intersection points with the circular radius
                  const dy = Math.sqrt(Math.max(0, glowRadius * glowRadius - dx * dx));
                  let glowStartY = Math.max(0, cellCenterY - dy);
                  let glowEndY = Math.min(h, cellCenterY + dy);
                  
                  // Add fade at the ends (reduce line length slightly)
                  const lineLength = glowEndY - glowStartY;
                  if (lineLength > fadeLength * 2) {
                    glowStartY += fadeLength;
                    glowEndY -= fadeLength;
                  }
                  
                  // Create gradient for fade effect at line ends
                  const gradient = ctx.createLinearGradient(glowX, glowStartY, glowX, glowEndY);
                  const baseOpacity = 0.15 + glowIntensity * 0.15; // 15-30% opacity
                  gradient.addColorStop(0, `rgba(255, 255, 255, 0)`); // Fade at start
                  gradient.addColorStop(0.2, `rgba(255, 255, 255, ${baseOpacity * 0.5})`); // Fade in
                  gradient.addColorStop(0.5, `rgba(255, 255, 255, ${baseOpacity})`); // Full in middle
                  gradient.addColorStop(0.8, `rgba(255, 255, 255, ${baseOpacity * 0.5})`); // Fade out
                  gradient.addColorStop(1, `rgba(255, 255, 255, 0)`); // Fade at end
                  
                  // Apply subtle circular glow effect
                  ctx.shadowBlur = 6 * glowIntensity; // Reduced shadow
                  ctx.shadowColor = "rgba(255, 255, 255, 0.2)"; // Subtle shadow
                  ctx.strokeStyle = gradient;
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(glowX, glowStartY);
              ctx.lineTo(glowX, glowEndY);
              ctx.stroke();
                }
              }
            }
          }
          
          // Reset shadow
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          ctx.restore();
          
          // Gaming-style hover state: transparent background with white border, drop shadow, and intense white glow
          // Border: 1px solid rgba(217, 217, 217, 0.3) - from Figma
          // Drop shadow: 0px 0px 14.4px rgba(224, 224, 224, 1) - from Figma
          // Intense white glow for gaming look
          
          // Draw intense white glow effect (multiple layers for stronger gaming glow)
          // Layer 1: Outer glow (softest, largest)
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.shadowBlur = 30;
          ctx.shadowColor = "rgba(255, 255, 255, 0.6)";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
          ctx.lineWidth = 3;
          ctx.strokeRect(hoverLeft, hoverTop, gridW, gridH);
          
          // Layer 2: Mid glow (medium intensity)
          ctx.shadowBlur = 20;
          ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
          ctx.lineWidth = 2;
          ctx.strokeRect(hoverLeft, hoverTop, gridW, gridH);
          
          // Layer 3: Inner glow (brightest, tightest)
          ctx.shadowBlur = 15;
          ctx.shadowColor = "rgba(255, 255, 255, 1.0)";
          ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(hoverLeft, hoverTop, gridW, gridH);
          
          // Draw drop shadow
          ctx.shadowBlur = 14.4;
          ctx.shadowColor = "rgba(224, 224, 224, 1)";
          
          // Draw main border
          ctx.strokeStyle = "rgba(217, 217, 217, 0.3)";
          ctx.lineWidth = 1;
          ctx.strokeRect(hoverLeft, hoverTop, gridW, gridH);
          
          // Reset shadow
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          
          // Draw thick corner indicators (L-shaped) at all 4 corners with glow
          const cornerSize = 8; // Thicker corners
          const cornerThickness = 2; // Thicker lines for corners
          ctx.strokeStyle = "rgba(255, 255, 255, 0.9)"; // Bright white for corners
          ctx.lineWidth = cornerThickness;
          ctx.lineCap = "square";
          
          // Add glow to corners
          ctx.shadowBlur = 8;
          ctx.shadowColor = "rgba(255, 255, 255, 0.8)";
          
          // Top-left corner (L shape pointing down-right)
          ctx.beginPath();
          ctx.moveTo(hoverLeft, hoverTop + cornerSize);
          ctx.lineTo(hoverLeft, hoverTop);
          ctx.lineTo(hoverLeft + cornerSize, hoverTop);
          ctx.stroke();
          
          // Top-right corner (L shape pointing down-left)
          ctx.beginPath();
          ctx.moveTo(hoverLeft + gridW - cornerSize, hoverTop);
          ctx.lineTo(hoverLeft + gridW, hoverTop);
          ctx.lineTo(hoverLeft + gridW, hoverTop + cornerSize);
          ctx.stroke();
          
          // Bottom-left corner (L shape pointing up-right)
          ctx.beginPath();
          ctx.moveTo(hoverLeft, hoverTop + gridH - cornerSize);
          ctx.lineTo(hoverLeft, hoverTop + gridH);
          ctx.lineTo(hoverLeft + cornerSize, hoverTop + gridH);
          ctx.stroke();
          
          // Bottom-right corner (L shape pointing up-left)
          ctx.beginPath();
          ctx.moveTo(hoverLeft + gridW - cornerSize, hoverTop + gridH);
          ctx.lineTo(hoverLeft + gridW, hoverTop + gridH);
          ctx.lineTo(hoverLeft + gridW, hoverTop + gridH - cornerSize);
          ctx.stroke();
          
          // Reset shadow after drawing corners
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          
          // Get user's bet amount from localStorage
          const savedAmount = typeof window !== 'undefined' ? localStorage.getItem('userAmount') : null;
          const userBetAmount = savedAmount ? parseFloat(savedAmount) : 0.2; // Default to $0.2
          
          // Calculate timeperiod for this hovered cell
          const hoverCellTime = hover.t - timeOffsetRef.current;
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
          
          // Draw total payout (multiplier × selected amount) - Figma specs: Inter 900 italic 18px, centered, bright white
          // Use bright white for normal payouts, yellow for when other users have bet
          const hoverPayoutTextColor = multiplierColor === "#FFDA00" ? "#FFDA00" : "#FFFFFF";
          ctx.fillStyle = hoverPayoutTextColor;
          
          // Figma typography: Geist, 900 weight, italic, 18px, -5% letter spacing
          ctx.font = "900 italic 16px Geist, sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          
          // Center the payout amount in the hover cell
          const hoverCellCenterX = hoverLeft + gridW / 2;
          const hoverCellCenterY = hoverTop + gridH / 2;
          
          // Format payout text
          const payoutText = `$${hoverPayout.toFixed(2)}`;
          
          // Add pulsing glow effect for yellow payout (#FFDA00)
          if (multiplierColor === "#FFDA00") {
            const pulseIntensity = (Math.sin(Date.now() / 500) + 1) / 2; // 0 to 1, ~1 second cycle
            const glowIntensity = 0.7 + (pulseIntensity * 0.3); // Pulse between 0.7 and 1.0 (very bright)
            // Draw multiple layers for stronger glow effect
            ctx.shadowBlur = 60 * glowIntensity;
            ctx.shadowColor = "#FFDA00";
            ctx.fillText(payoutText, hoverCellCenterX, hoverCellCenterY);
            ctx.shadowBlur = 40 * glowIntensity;
            ctx.fillText(payoutText, hoverCellCenterX, hoverCellCenterY);
            ctx.shadowBlur = 20 * glowIntensity;
            ctx.fillText(payoutText, hoverCellCenterX, hoverCellCenterY);
            // Final draw without shadow for crisp text
            ctx.shadowBlur = 0;
            ctx.shadowColor = "transparent";
            ctx.fillText(payoutText, hoverCellCenterX, hoverCellCenterY);
          } else {
            // Regular payout - no glow, just centered light gray text
            ctx.fillText(payoutText, hoverCellCenterX, hoverCellCenterY);
          }
          
          // Reset shadow and text alignment after drawing
          ctx.shadowBlur = 0;
          ctx.shadowColor = "transparent";
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
        }
      }

      // Ensure price line and dot are drawn absolutely last, on top of everything
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      // Draw price line - following Figma design exactly
      if (visible.length > 1) {
        const oldestX = centerX - (now - visible[0].t) * pxPerSec + (timeOffsetRef.current * pxPerSec) + (GRID_SEC / 2) * pxPerSec - GRID_SEC * pxPerSec;
        const nowX = centerX + (timeOffsetRef.current * pxPerSec) - GRID_SEC * pxPerSec;
        
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
          const x = centerX - (now - d.t) * pxPerSec + (timeOffsetRef.current * pxPerSec) + (GRID_SEC / 2) * pxPerSec - GRID_SEC * pxPerSec;
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
      ctx.font = "bold 13px 'Geist',sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(`$${price.toFixed(priceDecimals)}`, badgeX + 8, currentPriceDotY + 4);

      frame = requestAnimationFrame(draw);
    };
    
    draw();

    return () => {
      // Mark as unmounted to prevent new requests
      isMountedRef.current = false;
      
      // Cancel animation frames
      if (frame !== undefined) cancelAnimationFrame(frame);
      cancelAnimationFrame(gen);
      window.removeEventListener("resize", resize);
      resizeObserver.disconnect();
      
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
    // Add small epsilon to handle floating point precision issues at boundaries
    const snappedCellTime = Math.floor((cellTime + 0.0001) / GRID_SEC) * GRID_SEC + GRID_SEC / 2;

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
      // Set default cursor when outside valid area
      if (!isPanning2DRef.current && !isDraggingRef.current && !isInDragSelectionModeRef.current) {
        canvas.style.cursor = 'default';
      }
      return;
    }

    if (x < gx || x > gx + gridW || y < gy || y > gy + gridH) {
      hoverRef.current = null;
      // Set default cursor when outside valid area
      if (!isPanning2DRef.current && !isDraggingRef.current && !isInDragSelectionModeRef.current) {
        canvas.style.cursor = 'default';
      }
      return;
    }

    const timeOffsetSecNum = ((gx + gridW / 2 - centerX) / pxPerSec);
    hoverRef.current = { t: now + timeOffsetSecNum, gyIndex };
    
    // Set custom cursor when hovering over valid cells (not panning/dragging)
    if (!isPanning2DRef.current && !isDraggingRef.current && !isInDragSelectionModeRef.current) {
      canvas.style.cursor = `url("${customCursorSVG}") 13.5 13.5, auto`;
    }
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
    
    // Reset cursor - maintain crosshair if in multi-select mode, otherwise default
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
      // Add small epsilon to handle floating point precision issues at boundaries
      const timeperiodId = Math.floor((cellTime + 0.0001) / GRID_SEC) * GRID_SEC;
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
      forceUpdate(); // Force re-render to show pending state
      
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
                  forceUpdate(); // Trigger re-render to show RED multiplier
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
              
              // Dispatch event to notify Positions table about new bet
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('newBetPlaced', {
                  detail: { orderId: result.orderId, priceLevel, timeperiodId: Math.floor(cellTime / 5) * 5 }
                }));
                console.log('📢 Dispatched newBetPlaced event');
              }
              
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
            forceUpdate(); // Force re-render
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
          forceUpdate();
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

  // Track scroll state for recenter button visibility
  useEffect(() => {
    // Initial check
    const initialScrolled = Math.abs(priceOffsetRef.current) > 0.001 || Math.abs(timeOffsetRef.current) > 0.001;
    setIsScrolled(initialScrolled);
    
    const checkInterval = setInterval(() => {
      const scrolled = Math.abs(priceOffsetRef.current) > 0.001 || Math.abs(timeOffsetRef.current) > 0.001;
      setIsScrolled(scrolled);
    }, 100); // Check every 100ms
    
    return () => clearInterval(checkInterval);
  }, []);

  // Handler to trigger recenter from button
  const handleRecenter = () => {
    if (isScrolled && !isRecenteringRef.current) {
      isRecenteringRef.current = true;
      recenterStartPriceOffsetRef.current = priceOffsetRef.current;
      recenterStartTimeOffsetRef.current = timeOffsetRef.current;
      recenterStartTimeRef.current = Date.now();
    }
  };

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
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
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
          background: "transparent",
          cursor: 'default',
        }}
      />
      
      {/* Recenter Button */}
      <button
        onClick={handleRecenter}
        disabled={!isScrolled || isRecenteringRef.current}
        style={{
          position: 'absolute',
          top: 'clamp(1rem, 3%, 2rem)',
          left: 'clamp(3rem, 5%, 5rem)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: 'clamp(6px, 1%, 8px)',
          background: (!isScrolled || isRecenteringRef.current) ? 'transparent' : '#091c0d',
          border: (!isScrolled || isRecenteringRef.current) ? '1px solid #00FF241F' : '1px solid #00FF241F',
          fontFamily: "'Geist', sans-serif",
          fontSize: 'clamp(10px, 1vw, 12px)',
          fontWeight: 300,
          color: (!isScrolled || isRecenteringRef.current) ? '#4a4a4a' : '#ffffff',
          cursor: (!isScrolled || isRecenteringRef.current) ? 'not-allowed' : 'pointer',
          zIndex: 10000,
          transition: 'all 0.2s ease',
          opacity: isScrolled ? 1 : 0.5,
          borderRadius: '8px',
        }}
          onMouseEnter={(e) => {
            if (isScrolled && !isRecenteringRef.current) {
              e.currentTarget.style.background = 'white';
              e.currentTarget.style.color = '#141414';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }
          }}
          onMouseLeave={(e) => {
            if (isScrolled && !isRecenteringRef.current) {
              e.currentTarget.style.background = '#141414';
              e.currentTarget.style.color = '#ffffff';
              e.currentTarget.style.transform = 'translateY(0)';
            }
          }}
          onMouseDown={(e) => {
            if (isScrolled && !isRecenteringRef.current) {
              e.currentTarget.style.transform = 'translateY(0)';
            }
          }}
          title={isRecenteringRef.current ? "Recentering..." : isScrolled ? "Click to recenter chart" : "Chart is centered"}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5.25009 9.43241L2.81759 6.99991L1.98926 7.82241L5.25009 11.0832L12.2501 4.08324L11.4276 3.26074L5.25009 9.43241Z" fill="#00FF24"/>
</svg>

          Follow Price
        </button>
      
      {/* Real-time Activity Feed - Bottom Left */}
      <div
        ref={activityFeedRef}
        style={{
          position: 'absolute',
          bottom: '0%',
          left: 'clamp(40px, 5%, 80px)',
          width: 'clamp(200px, 20%, 300px)',
          maxHeight: '25%',
          padding: '8px',
          zIndex: 9999,
          fontFamily: "'Geist', sans-serif",
          fontSize: 'clamp(11px, 1vw, 14px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          background: 'transparent',
          borderRadius: '8px',
          overflowY: 'hidden',
          overflowX: 'hidden',
          scrollBehavior: 'smooth',
          pointerEvents: 'none',
        }}
      >
        {/* Debug: always show count */}
        {/* <div style={{ color: '#00FF24', fontSize: '11px' }}>
          Activity Feed ({activityFeed.length})
        </div> */}
        {activityFeed.length === 0 ? (
          <div style={{ color: '#666', fontSize: '12px' }}>
            
          </div>
        ) : (
          activityFeed.map((activity, index) => (
            <div
              key={activity.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                pointerEvents: 'none',
              }}
            >
              <span style={{ fontSize: '14px', lineHeight: '1.4' }}>
                {activity.type === 'won' ? (
                  <>
                    {activity.isYou ? (
                      <>
                        <span style={{ 
                          color: '#FFD700',
                          fontSize: '14px',
                          fontWeight: 400,
                        }}>You</span>{' '}
                        <span style={{ 
                          color: '#ffffff',
                          fontSize: '14px',
                          fontWeight: 400,
                        }}>won</span>{' '}
                        <span style={{ 
                          color: '#00FF24',
                          fontSize: '14px',
                          fontWeight: 700,
                          fontStyle: 'italic',
                        }}>${activity.amount.toFixed(2)} ({activity.multiplier?.toFixed(1)}X)</span>
                      </>
                    ) : (
                      <>
                        <span style={{
                          color: '#ffffff',
                          fontSize: '14px',
                          fontWeight: 400,
                        }}>@{activity.username}</span>{' '}
                        <span style={{ 
                          color: '#ffffff',
                          fontSize: '14px',
                          fontWeight: 400,
                        }}>won</span>{' '}
                        <span style={{ 
                          color: '#00FF24',
                          fontSize: '14px',
                          fontWeight: 700,
                          fontStyle: 'italic',
                        }}>${activity.amount.toFixed(2)} ({activity.multiplier?.toFixed(1)}X)</span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {activity.isYou ? (
                      <>
                        <span style={{ 
                          color: '#4D504D',
                          fontSize: '14px',
                          fontWeight: 400,
                        }}>Added to pool</span>{' '}
                        <span style={{ 
                          color: '#01690F',
                          fontSize: '14px',
                          fontWeight: 700,
                          fontStyle: 'italic',
                        }}>+${activity.amount.toFixed(2)}</span>
                      </>
                    ) : (
                      <>
                        <span style={{ 
                          color: '#4D504D',
                          fontSize: '14px',
                          fontWeight: 400,
                        }}>Added to pool</span>{' '}
                        <span style={{ 
                          color: '#01690F',
                          fontSize: '14px',
                          fontWeight: 700,
                          fontStyle: 'italic',
                        }}>+${activity.amount.toFixed(2)}</span>
                      </>
                    )}
                  </>
                )}
              </span>
            </div>
          ))
        )}
      </div>
      
      {/* Waiting for Grid Loader - Only show if NOT showing success popup */}
      {isWaitingForGrid && !showGridIdPopup && (
        <div className="absolute top-[5%] left-1/2 -translate-x-1/2 bg-black border border-white/20 rounded-[50px] px-3 py-2 inline-flex items-center gap-3 z-[1000] whitespace-nowrap animate-slide-down">
          <div 
            className="w-[18px] h-[18px] inline-block rounded-full animate-order-spin"
            style={{
              background: 'repeating-conic-gradient(from 0deg, #00ff24 0deg 6deg, rgba(0,255,36,0.15) 6deg 45deg)',
              WebkitMask: 'radial-gradient(farthest-side, transparent calc(50% - 2.5px), #000 0)',
              mask: 'radial-gradient(farthest-side, transparent calc(50% - 2.5px), #000 0)',
            }}
          />
          <span className="text-white text-sm font-light font-geistMono">Placing order 1/1</span>
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
<g clipPath="url(#clip0_55_10048)">
<path d="M6.82867 10.876L4 8.04668L4.94267 7.10402L6.82867 8.98935L10.5993 5.21802L11.5427 6.16135L6.82867 10.876Z" fill="#00FF24"/>
<path fillRule="evenodd" clipRule="evenodd" d="M0.666992 8.00008C0.666992 3.95008 3.95033 0.666748 8.00033 0.666748C12.0503 0.666748 15.3337 3.95008 15.3337 8.00008C15.3337 12.0501 12.0503 15.3334 8.00033 15.3334C3.95033 15.3334 0.666992 12.0501 0.666992 8.00008ZM8.00033 14.0001C7.21239 14.0001 6.43218 13.8449 5.70423 13.5434C4.97627 13.2418 4.31484 12.7999 3.75768 12.2427C3.20053 11.6856 2.75858 11.0241 2.45705 10.2962C2.15552 9.56823 2.00033 8.78801 2.00033 8.00008C2.00033 7.21215 2.15552 6.43193 2.45705 5.70398C2.75858 4.97603 3.20053 4.31459 3.75768 3.75744C4.31484 3.20029 4.97627 2.75833 5.70423 2.4568C6.43218 2.15528 7.21239 2.00008 8.00033 2.00008C9.59162 2.00008 11.1177 2.63222 12.243 3.75744C13.3682 4.88266 14.0003 6.40878 14.0003 8.00008C14.0003 9.59138 13.3682 11.1175 12.243 12.2427C11.1177 13.3679 9.59162 14.0001 8.00033 14.0001Z" fill="#00FF24"/>
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
        fontFamily: 'Geist',
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
        fontFamily: 'Geist',
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
                fontFamily: 'Geist',
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
                fontFamily: 'Geist',
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
        
        @keyframes textGlow {
          0% {
            text-shadow: 0 0 12px rgba(0, 255, 36, 1), 0 0 18px rgba(0, 255, 36, 0.8), 0 0 24px rgba(0, 255, 36, 0.6);
          }
          50% {
            text-shadow: 0 0 10px rgba(0, 255, 36, 0.9), 0 0 16px rgba(0, 255, 36, 0.7), 0 0 20px rgba(0, 255, 36, 0.5);
          }
          100% {
            text-shadow: 0 0 8px rgba(0, 255, 36, 0.8), 0 0 12px rgba(0, 255, 36, 0.6), 0 0 16px rgba(0, 255, 36, 0.4);
          }
        }
        
        /* Activity Feed Scrollbar */
        div[style*="overflowY"]::-webkit-scrollbar {
          width: 4px;
        }
        div[style*="overflowY"]::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.2);
        }
        div[style*="overflowY"]::-webkit-scrollbar-thumb {
          background: rgba(0, 255, 36, 0.3);
          border-radius: 2px;
        }
      `}</style>
    </div>
    );
}