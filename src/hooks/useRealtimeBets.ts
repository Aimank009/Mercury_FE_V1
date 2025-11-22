import { useEffect, useState, useRef, useCallback } from 'react';
import { getMercuryWebSocketClient, BetEvent } from '../lib/mercuryWebSocket';
import { fetchAllUsersBets } from '../lib/allUsersBets';
import { supabase } from '../lib/supabaseClient';
import { formatNumber } from '../utils';

export interface UserBet {
  grid_id: string;
  user_address: string;
  timeperiod_id: number;
  price_level: number;
  amount: number;
  shares: number;
  multiplier: number;
  created_at: string;
  session_id?: string;
  // Optional authoritative total shares for the grid (if provided by the event)
  total_share?: number;
}

interface UseRealtimeBetsOptions {
  currentTime: number;
  priceMin: number;
  priceMax: number;
  timeWindowSeconds?: number;
  enabled?: boolean;
}

/**
 * React Hook for real-time bet updates via WebSocket
 * 
 * @example
 * ```tsx
 * const { bets, isConnected, addBet } = useRealtimeBets({
 *   currentTime: Math.floor(Date.now() / 1000),
 *   priceMin: 40.0,
 *   priceMax: 45.0,
 *   timeWindowSeconds: 300,
 *   enabled: true
 * });
 * ```
 */
export function useRealtimeBets({
  currentTime,
  priceMin,
  priceMax,
  timeWindowSeconds = 300,
  enabled = true,
}: UseRealtimeBetsOptions) {
  const [bets, setBets] = useState<UserBet[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  // Create WebSocket client ref ONCE and never recreate it
  // This prevents reconnection issues when price/time params change
  const wsClientRef = useRef<ReturnType<typeof getMercuryWebSocketClient> | null>(null);
  if (!wsClientRef.current) {
    wsClientRef.current = getMercuryWebSocketClient(
      process.env.NEXT_PUBLIC_REALTIME_WS_URL || 'ws://localhost:8080'
    );
  }
  
  const isInitializedRef = useRef(false);
  const handlersAttachedRef = useRef(false); // Track if handlers are attached

  // Transform Supabase event to UserBet
  const transformEventToBet = useCallback((event: BetEvent): UserBet | null => {
    try {
      const newBet = event.new;
      
      if (!newBet) return null;

      const priceMinDollars = parseFloat(newBet.price_min) / 1e8;
      const priceMaxDollars = parseFloat(newBet.price_max) / 1e8;
      const priceLevel = (priceMinDollars + priceMaxDollars) / 2;
      
      // ✅ Use 2 decimals to match TradingChart's grid_id format (was 8, causing mismatch)
      const gridId = `${newBet.timeperiod_id}_${priceMinDollars.toFixed(2)}_${priceMaxDollars.toFixed(2)}`;
      
  const amount = parseFloat(newBet.amount) / 1e6;
  const shares = parseFloat(newBet.shares_received) / 1e6;
  const multiplier = shares > 0 ? (amount / shares) : 0;
  const totalShare = newBet.total_share ? parseFloat(newBet.total_share) : undefined;

      return {
        grid_id: gridId,
        user_address: newBet.user_address,
        timeperiod_id: parseInt(newBet.timeperiod_id),
        price_level: priceLevel,
        amount: amount,
        shares: shares,
        multiplier: multiplier,
        created_at: newBet.created_at,
        session_id: newBet.session_key,
        total_share: totalShare,
      };
    } catch (error) {
      console.error('❌ Error transforming bet:', error);
      return null;
    }
  }, []);

  // Initial connection and subscription
  useEffect(() => {
    if (!enabled) return;
    
    const client = wsClientRef.current;
    if (!client) return;
    
    // Only initialize once
    if (isInitializedRef.current) {
      console.log('⏭️  Already initialized, skipping...');
      return;
    }
    
    isInitializedRef.current = true;

    console.log('🔌 Connecting to WebSocket...');

    // Connect to WebSocket
    client.connect()
      .then(() => {
        console.log('✅ WebSocket connected');
        setIsConnected(true);
        setError(null);

        // Wait a tiny bit to ensure WebSocket is fully ready before subscribing
        setTimeout(() => {
          // Subscribe with filters
          const halfWindow = timeWindowSeconds / 2;
          const startTimeperiodId = Math.floor((currentTime - halfWindow) / 5) * 5;
          const endTimeperiodId = Math.floor((currentTime + halfWindow) / 5) * 5;

          console.log('📡 Subscribing to real-time bets...', {
            timeperiodRange: { start: startTimeperiodId, end: endTimeperiodId },
            priceRange: { min: priceMin, max: priceMax },
          });

          client.subscribe({
            tables: ['bet_placed_with_session'],
            events: ['INSERT'],
            timeperiodRange: {
              start: startTimeperiodId,
              end: endTimeperiodId,
            },
            priceRange: {
              min: priceMin,
              max: priceMax,
            },
          });
          
          // **IMPORTANT: Load existing bets initially**
          console.log('📥 Loading existing bets from database...');
          
          const loadExistingBets = async () => {
            try {
              const existingBets = await fetchAllUsersBets(currentTime, priceMin, priceMax, timeWindowSeconds);
              console.log(`✅ Loaded ${existingBets.length} existing bets`, existingBets);
              
              if (existingBets.length > 0) {
                setBets(existingBets);
              } else {
                console.log('⚠️ No existing bets found - this might be expected if no bets were placed yet');
              }
            } catch (error) {
              console.error('❌ Failed to load existing bets:', error);
            }
          };
          
          // Load immediately
          loadExistingBets();
          
          // Also retry after 2 seconds to catch bets that might have just been placed
          setTimeout(() => {
            console.log('🔄 Retry loading existing bets...');
            loadExistingBets();
          }, 2000);
        }, 100);
      })
      .catch((error: any) => {
        console.error('❌ WebSocket connection failed:', error);
        setIsConnected(false);
        setError(error);
        isInitializedRef.current = false;
      });
    
    // NO CLEANUP - keep connection and handlers alive!
  }, [enabled]); // Only depend on enabled, not on filter params!

  // Attach event handlers ONCE (separate from connection)
  useEffect(() => {
    const client = wsClientRef.current;
    if (!client || handlersAttachedRef.current) return;
    
    handlersAttachedRef.current = true;
    console.log('📎 Attaching event handlers...');

    // Handle individual events
    const unsubscribeEvent = client.onEvent((event: BetEvent) => {
      const bet = transformEventToBet(event);
      if (bet) {
        console.log('📨 New bet received via WebSocket:', {
          user: bet.user_address,
          gridId: bet.grid_id,
          amount: bet.amount,
          shares: bet.shares,
          timestamp: bet.created_at
        });
        setBets((prev) => {
          // Check if bet already exists to avoid duplicates
          // NOTE: Same user can't bet on same grid twice, so grid_id + user_address is unique
          const exists = prev.some(b => b.grid_id === bet.grid_id && b.user_address === bet.user_address);
          if (exists) {
            console.log('⚠️ Bet already exists (same grid+user), skipping duplicate');
            return prev;
          }
          console.log('✅ Adding new bet to state!', {
            totalBetsAfter: prev.length + 1,
            newBet: { user: bet.user_address, grid: bet.grid_id }
          });
          return [...prev, bet];
        });
      }
    });

    // Handle batch events
    const unsubscribeBatch = client.onBatch((events: BetEvent[]) => {
      console.log(`📦 Received batch via WebSocket: ${events.length} bets`);
      const newBets = events.map(transformEventToBet).filter(Boolean) as UserBet[];
      if (newBets.length > 0) {
        console.log('✅ Adding batch bets to state:', newBets.length);
        setBets((prev) => {
          // Filter out duplicates
          const newUniqueBets = newBets.filter(newBet => 
            !prev.some(existingBet => 
              existingBet.grid_id === newBet.grid_id && 
              existingBet.user_address === newBet.user_address
            )
          );
          console.log('✅ Adding', newUniqueBets.length, 'unique bets from batch');
          return [...prev, ...newUniqueBets];
        });
      }
    });

    // Handle errors
    const unsubscribeError = client.onError((error: any) => {
      console.error('❌ WebSocket error:', error);
      setIsConnected(false);
      setError(error);
    });

    // Handle connection status
    const unsubscribeConnected = client.onMessage('connected', () => {
      console.log('✅ Received connection confirmation');
      setIsConnected(true);
      setError(null);
    });

    const unsubscribeSubscribed = client.onMessage('subscribed', (data: any) => {
      console.log('✅ Subscription confirmed:', data.filters);
    });

    // NO CLEANUP for WebSocket - handlers stay attached for the session
  }, [transformEventToBet]);

  // FALLBACK: Direct Supabase Realtime subscription (SEPARATE EFFECT)
  // This ensures real-time updates work even if WebSocket server has issues
  useEffect(() => {
    if (!enabled) return;

    console.log('🔄 Setting up direct Supabase Realtime fallback...');
    console.log('   This will receive ALL users\' bets from bet_placed_with_session table');
    
    const channelName = 'bet-placed-realtime-' + Math.random().toString(36).substring(7);
    console.log('📡 Creating Supabase channel:', channelName);
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes' as any,
        {
          event: '*', // Catch all events (INSERT, UPDATE, DELETE) like positions table
          schema: 'public',
          table: 'bet_placed_with_session',
        },
        async (payload: any) => {
          console.log('📨 NEW BET via Supabase Realtime fallback!', {
            event: payload.eventType,
            user: payload.new?.user_address || payload.old?.user_address,
            timeperiod: payload.new?.timeperiod_id || payload.old?.timeperiod_id,
            priceMin: payload.new?.price_min || payload.old?.price_min,
            priceMax: payload.new?.price_max || payload.old?.price_max,
            amount: payload.new?.amount || payload.old?.amount,
            browser: navigator.userAgent.includes('Chrome') ? 'CHROME' : navigator.userAgent.includes('Brave') ? 'BRAVE' : 'OTHER'
          });
          
          // Only query total_share for INSERT events (new bets)
          if (payload.eventType === 'INSERT' && payload.new) {
            // ⚡ OPTIMISTIC UI: Add bet immediately, fetch total_share in background
            const bet = transformEventToBet({
              type: 'bet_placed',
              eventType: 'INSERT',
              table: 'bet_placed_with_session',
              new: payload.new,
              timestamp: Date.now(),
            });
            
            if (bet) {
              console.log('✅ Transformed bet from Supabase fallback (optimistic):', {
                gridId: bet.grid_id,
                userAddress: bet.user_address,
                amount: bet.amount,
                timeperiodId: bet.timeperiod_id,
                priceLevel: bet.price_level,
                browser: navigator.userAgent.includes('Chrome') ? 'CHROME' : navigator.userAgent.includes('Brave') ? 'BRAVE' : 'OTHER',
                receivingOtherUserBet: true
              });
              
              // ✅ ADD BET TO STATE IMMEDIATELY (no delay!)
              setBets((prev) => {
                // Check if bet already exists to avoid duplicates
                const exists = prev.some(b => 
                  b.grid_id === bet.grid_id && 
                  b.user_address === bet.user_address &&
                  Math.abs(new Date(b.created_at).getTime() - new Date(bet.created_at).getTime()) < 1000
                );
                
                if (exists) {
                  console.log('⚠️ Bet already exists (from WebSocket?), skipping duplicate');
                  return prev;
                }
                
                console.log('✅✅✅ ADDING NEW BET TO STATE IMMEDIATELY!', {
                  gridId: bet.grid_id,
                  userAddress: bet.user_address,
                  totalBetsInState: prev.length + 1,
                  browser: navigator.userAgent.includes('Chrome') ? 'CHROME' : navigator.userAgent.includes('Brave') ? 'BRAVE' : 'OTHER'
                });
                return [...prev, bet];
              });
              
              // 🔄 FETCH total_share IN BACKGROUND (non-blocking)
              // This will update the multiplier calculation but won't delay bet appearance
              (async () => {
                try {
                  const { data: betPlacedData, error: betPlacedError } = await supabase
                    .from('bet_placed')
                    .select('total_share')
                    .eq('timeperiod_id', payload.new.timeperiod_id)
                    .eq('price_min', payload.new.price_min)
                    .eq('price_max', payload.new.price_max)
                    .order('created_at', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  
                  if (betPlacedError) {
                    console.error('❌ Error querying bet_placed for total_share:', betPlacedError);
                  } else if (betPlacedData && betPlacedData.total_share) {
                    const totalSharesRaw = betPlacedData.total_share;
                    const totalSharesDecimal = parseFloat(totalSharesRaw as string) / 1e6;
                    
                    // Update the bet in state with total_share
                    setBets((prev) => {
                      return prev.map(b => {
                        if (b.grid_id === bet.grid_id && b.user_address === bet.user_address) {
                          return { ...b, total_share: totalSharesDecimal };
                        }
                        return b;
                      });
                    });
                    
                    console.log('✅ Updated bet with total_share:', {
                      gridId: bet.grid_id,
                      total_share: totalSharesDecimal,
                      note: 'Multiplier will be recalculated with real data'
                    });
                  } else {
                    console.log('⚠️ No total_share found in bet_placed for this grid yet (first bet?)');
                  }
                } catch (error) {
                  console.error('❌ Exception while querying total_share:', error);
                }
              })();
            } else {
              console.error('❌ Failed to transform bet from Supabase');
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('🔔 Supabase fallback subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('✅✅✅ SUPABASE REALTIME FALLBACK IS ACTIVE AND READY!');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Supabase fallback channel error!');
        } else if (status === 'TIMED_OUT') {
          console.error('⏱️ Supabase fallback subscription timed out!');
        }
      });

    // Cleanup function - properly remove channel on unmount
    return () => {
      console.log('🧹 Cleaning up Supabase fallback subscription:', channelName);
      supabase.removeChannel(channel);
    };
  }, [enabled, transformEventToBet]); // Keep transformEventToBet in deps like positions table

  // DON'T disconnect on unmount - keep WebSocket alive for the session!
  // The WebSocket is a singleton and should persist across component remounts
  // It will be cleaned up when the page is closed/refreshed

  // Update filters when time or price range changes
  useEffect(() => {
    if (!enabled || !isConnected || !wsClientRef.current) return;

    const halfWindow = timeWindowSeconds / 2;
    const startTimeperiodId = Math.floor((currentTime - halfWindow) / 5) * 5;
    const endTimeperiodId = Math.floor((currentTime + halfWindow) / 5) * 5;

    // console.log('🔄 Updating filters...', {
    //   timeperiodRange: { start: startTimeperiodId, end: endTimeperiodId },
    //   priceRange: { min: priceMin, max: priceMax },
    // });

    wsClientRef.current.updateFilters({
      timeperiodRange: {
        start: startTimeperiodId,
        end: endTimeperiodId,
      },
      priceRange: {
        min: priceMin,
        max: priceMax,
      },
    });
  }, [currentTime, priceMin, priceMax, timeWindowSeconds, enabled, isConnected]);

  // Method to manually add a bet (useful for initial data load)
  const addBet = useCallback((bet: UserBet) => {
    setBets((prev) => [...prev, bet]);
  }, []);

  // Method to clear all bets
  const clearBets = useCallback(() => {
    setBets([]);
  }, []);

  // Method to manually reconnect
  const reconnect = useCallback(() => {
    console.log('🔄 Manual reconnect triggered');
    const client = wsClientRef.current;
    if (!client) return;
    
    client.disconnect();
    isInitializedRef.current = false;
    setIsConnected(false);
    
    // Trigger re-initialization
    setTimeout(() => {
      client.connect()
        .then(() => {
          console.log('✅ Reconnected');
          setIsConnected(true);
        })
        .catch((error: any) => {
          console.error('❌ Reconnection failed:', error);
          setError(error);
        });
    }, 100);
  }, []);

  return {
    bets,
    isConnected,
    error,
    addBet,
    clearBets,
    reconnect,
    setBets,
  };
}
