import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAccount } from 'wagmi';
import { InfiniteData, useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase, BetPlacedWithSession } from '../lib/supabaseClient';
import { TABLES, CACHE_EXPIRY } from '../config';
import { storage, formatUSD } from '../utils';
import { getMercuryWebSocketClient, BetEvent } from '../lib/mercuryWebSocket';

export interface Position {
  id: string;
  userAddress: string;
  date: string;
  priceRange: string;
  expiryTime: string;
  amount: string;
  payout: string;
  settlement: { status: 'waiting' | 'win' | 'Loss'; price: string | null };
  status: 'in progress' | 'Resolved';
  timeperiodId: string;
  blockNumber: number | null;
}

const BATCH_SIZE = 50; // Load 50 bets per batch

// Create optimistic bet from order placed event
function createOptimisticBet(
  detail: { timeperiodId: number; priceMinUSD: number; priceMaxUSD: number; amountUSD: number },
  userAddress: string
): BetPlacedWithSession {
  const now = new Date();
  return {
    id: 0,
    event_id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    user_address: userAddress.toLowerCase(),
    session_key: '',
    timeperiod_id: detail.timeperiodId.toString(),
    grid_id: '',
    amount: (detail.amountUSD * 1e6).toString(),
    shares_received: '0',
    price_min: (detail.priceMinUSD * 1e8).toString(),
    price_max: (detail.priceMaxUSD * 1e8).toString(),
    start_time: detail.timeperiodId.toString(),
    end_time: ((detail.timeperiodId + 5) * 1000).toString(),
    block_number: null,
    timestamp: now.toISOString(),
    created_at: now.toISOString(),
    status: 'pending',
  };
}

function formatOptimisticPosition(bet: BetPlacedWithSession): Position {
  const amountUSD = formatUSD(parseFloat(bet.amount || '0') / 1e6);
  const priceMin = formatUSD(parseFloat(bet.price_min || '0') / 1e8);
  const priceMax = formatUSD(parseFloat(bet.price_max || '0') / 1e8);
  const betDate = bet.timestamp
    ? new Date(bet.timestamp).toLocaleString()
    : bet.created_at
    ? new Date(bet.created_at).toLocaleString()
    : new Date().toLocaleString();

  const expiryTime = bet.end_time
    ? new Date(parseInt(bet.end_time.toString()) * 1000).toLocaleTimeString()
    : 'N/A';

  const dbMultiplier = bet.multiplier ? parseFloat(bet.multiplier.toString()) : 0;
  const waitingMultiplier = dbMultiplier > 0 ? dbMultiplier : 3;
  const potentialPayout = formatUSD(parseFloat(amountUSD) * waitingMultiplier);
  const multiplierLabel = waitingMultiplier > 0 ? ` ${waitingMultiplier.toFixed(1)}X` : '';

  return {
    id: bet.event_id,
    userAddress: bet.user_address,
    date: betDate,
    priceRange: `${priceMin} - ${priceMax}`,
    expiryTime,
    amount: `$${amountUSD}`,
    payout: `$${potentialPayout}${multiplierLabel}`,
    settlement: {
      status: 'waiting',
      price: null,
    },
    status: 'in progress',
    timeperiodId: bet.timeperiod_id,
    blockNumber: bet.block_number,
  };
}

// Format bet data to Position
async function formatPositions(data: BetPlacedWithSession[]): Promise<Position[]> {
  if (!data || data.length === 0) return [];

  // Extract IDs needed for parallel queries
  const timeperiodIds = Array.from(new Set(data.map(bet => bet.timeperiod_id)));
  const gridIds = data.map(bet => bet.grid_id).filter(Boolean);

  // Run both queries in parallel
  const [
    { data: settlementsData, error: settlementsError },
    { data: winningsData, error: winningsError }
  ] = await Promise.all([
    supabase
      .from(TABLES.TIMEPERIOD_SETTLED)
      .select('timeperiod_id, twap_price, winning_grid_id')
      .in('timeperiod_id', timeperiodIds),
    supabase
      .from(TABLES.WINNINGS_CLAIMED_EQUAL)
      .select('grid_id, total_payout, redemption_value')
      .in('grid_id', gridIds)
  ]);

  if (settlementsError) {
    console.warn('⚠️ Settlements query warning:', settlementsError);
  }
  if (winningsError) {
    console.warn('⚠️ Winnings query warning:', winningsError);
  }

  const settlementsMap = new Map(
    (settlementsData || []).map(s => [s.timeperiod_id, s])
  );

  const winningsMap = new Map(
    (winningsData || []).map(w => [w.grid_id, w])
  );

  return data.map((bet: BetPlacedWithSession) => {
    const amountUSD = formatUSD(parseFloat(bet.amount) / 1e6);
    const priceMin = formatUSD(parseFloat(bet.price_min) / 1e8);
    const priceMax = formatUSD(parseFloat(bet.price_max) / 1e8);

    const betDate = bet.timestamp 
      ? new Date(bet.timestamp).toLocaleString()
      : new Date(bet.created_at).toLocaleString();
    
    const expiryTime = bet.end_time
      ? new Date(parseInt(bet.end_time) * 1000).toLocaleTimeString()
      : 'N/A';

    let potentialPayout = '0.00';
    let multiplier = '';
    let settlementStatus: 'waiting' | 'win' | 'Loss' = 'waiting';
    let settlementPrice: string | null = null;

    const betStatus = bet.status || 'pending';
    const dbMultiplier = bet.multiplier ? parseFloat(bet.multiplier.toString()) : 0;
    
    // PRIORITY 1: Check if bet status is already determined in DB
    if (betStatus === 'won') {
      settlementStatus = 'win';
      settlementPrice = bet.settlement_price 
        ? formatUSD(parseFloat(bet.settlement_price.toString()) / 1e8)
        : null;
      const payoutAmount = parseFloat(amountUSD) * (dbMultiplier > 0 ? dbMultiplier : 1);
      potentialPayout = formatUSD(payoutAmount);
      multiplier = dbMultiplier > 0 ? ` ${dbMultiplier.toFixed(1)}X` : ' 1.0X';
    } else if (betStatus === 'lost') {
      settlementStatus = 'Loss';
      settlementPrice = bet.settlement_price 
        ? formatUSD(parseFloat(bet.settlement_price.toString()) / 1e8)
        : null;
      potentialPayout = formatUSD(0);
      multiplier = ' 0.0X';
    } else {
      const settlement = settlementsMap.get(bet.timeperiod_id);
      if (!settlement) {
        settlementStatus = 'waiting';
        const waitingMultiplier = dbMultiplier > 0 ? dbMultiplier : 3;
        potentialPayout = formatUSD(parseFloat(amountUSD) * waitingMultiplier);
        multiplier = ` ${waitingMultiplier.toFixed(1)}X`;
      } else {
        const twapPrice = formatUSD(parseFloat(settlement.twap_price) / 1e8);
        settlementPrice = twapPrice;
        const winnings = winningsMap.get(bet.grid_id);
        if (winnings) {
          const totalPayoutUSD = formatUSD(parseFloat(winnings.redemption_value) / 1e6);
          potentialPayout = totalPayoutUSD;
          const actualMultiplier = parseFloat(totalPayoutUSD) / parseFloat(amountUSD);
          multiplier = ` ${actualMultiplier.toFixed(1)}X`;
          settlementStatus = 'win';
        } else {
          settlementStatus = 'Loss';
          potentialPayout = formatUSD(0);
          multiplier = '';
        }
      }
    }

    return {
      id: bet.event_id,
      userAddress: bet.user_address,
      date: betDate,
      priceRange: `${priceMin} - ${priceMax}`,
      expiryTime,
      amount: `$${amountUSD}`,
      payout: `$${potentialPayout}${multiplier}`,
      settlement: {
        status: settlementStatus,
        price: settlementPrice,
      },
      status: settlementStatus === 'waiting' ? 'in progress' : 'Resolved',
      timeperiodId: bet.timeperiod_id,
      blockNumber: bet.block_number,
    };
  });
}

// Fetch a single batch of bets
async function fetchBetsBatch({ 
  pageParam = 0, 
  userAddress 
}: { 
  pageParam?: number; 
  userAddress?: string | null 
}): Promise<{ data: Position[]; nextCursor: number | null }> {
  // Check if Supabase is configured
  if (!supabase || !userAddress) {
    return { data: [], nextCursor: null };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || supabaseUrl === '') {
    console.warn('⚠️ Supabase not configured - using demo mode');
    return { data: [], nextCursor: null };
  }

  const offset = pageParam * BATCH_SIZE;
  const normalizedAddress = userAddress.toLowerCase();
  console.log(`🔍 fetchBetsBatch: Fetching for address ${normalizedAddress} (offset: ${offset}, limit: ${BATCH_SIZE})`);

  try {
    const { data, error, count } = await supabase
      .from(TABLES.BET_PLACED_WITH_SESSION)
      .select('*', { count: 'exact' })
      .ilike('user_address', normalizedAddress) // Use ilike for case-insensitive matching
      .order('created_at', { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('❌ Supabase query error:', error);
      if (error.message?.includes('fetch') || error.message?.includes('Failed to fetch')) {
        console.warn('⚠️ Network error - running in demo mode without positions');
        return { data: [], nextCursor: null };
      }
      throw new Error(error.message);
    }

    console.log(`📦 fetchBetsBatch result:`, { 
      foundBets: data?.length || 0, 
      totalCount: count,
      userAddress: normalizedAddress,
    });

    if (!data || data.length === 0) {
      // Production: Just return empty, don't do expensive debug queries
      if (process.env.NODE_ENV === 'production') {
        return { data: [], nextCursor: null };
      }
      
      console.log('⚠️ No bets found with ilike for user:', normalizedAddress);
      
      // Only in development: Check if there are ANY bets in the table (debug)
      const { count: totalBets } = await supabase
        .from(TABLES.BET_PLACED_WITH_SESSION)
        .select('*', { count: 'exact', head: true });
      
      
      // Only in development: Check what addresses are actually in the database
      const { data: sampleAddresses } = await supabase
        .from(TABLES.BET_PLACED_WITH_SESSION)
        .select('user_address')
        .limit(10);
     
      
      // Only in development: Fallback fetch
      console.log('🔍 Trying client-side filtering fallback...');
      const { data: allRecentBets, error: allError } = await supabase
        .from(TABLES.BET_PLACED_WITH_SESSION)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100); // Reduced from 500 to 100
      
      if (allError) {
        console.error('❌ Error fetching all bets:', allError);
        return { data: [], nextCursor: null };
      }
      
      // Filter client-side for case-insensitive address match
      const matchingBets = allRecentBets?.filter(bet => 
        bet.user_address.toLowerCase() === normalizedAddress
      ) || [];
      
      console.log(`Client-side filter found ${matchingBets.length} matching bets`);
      
      if (matchingBets.length > 0) {
        console.log('First matching bet:', matchingBets[0]);
        const formattedPositions = await formatPositions(matchingBets);
        return { data: formattedPositions, nextCursor: null };
      }
      
      return { data: [], nextCursor: null };
    }

    console.log(`Fetched ${data.length} bets (total: ${count || 'unknown'})`);

    const formattedPositions = await formatPositions(data);
    
    // Check if there are more batches
    const hasMore = data.length === BATCH_SIZE;
    const nextCursor = hasMore ? pageParam + 1 : null;

    console.log(`Formatted ${formattedPositions.length} positions, hasMore: ${hasMore}`);
    
    // Log settlement statuses for debugging
    const statusBreakdown = formattedPositions.reduce((acc, p) => {
      acc[p.settlement.status] = (acc[p.settlement.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('Status breakdown:', statusBreakdown);

    return { data: formattedPositions, nextCursor };
  } catch (error: any) {
    console.error('Fatal error in fetchBetsBatch:', error);
    throw error;
  }
}

export function useUserBets() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const wsClient = useRef(getMercuryWebSocketClient()).current;
    const fallbackTimerRef = useRef<number | null>(null);


  const queryKey = useMemo(() => 
    ['userBets', address?.toLowerCase() || 'none'],
    [address]
  );

  // Debug: Log the address being used for query
  useEffect(() => {
    if (address) {
      console.log('🔍 useUserBets: Querying for address:', address);
    }
  }, [address]);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => {
      console.log('📊 useUserBets: Fetching positions for', address);
      return fetchBetsBatch({ pageParam, userAddress: address });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000, // 30s stale time - data won't refetch for 30s
    gcTime: 10 * 60 * 1000, // 10 min cache
    placeholderData: keepPreviousData, // Keep old data visible while fetching
    refetchOnWindowFocus: false, // Don't refetch on window focus
    refetchOnMount: false, // Don't refetch on component mount if data exists
    refetchOnReconnect: false, // Don't refetch on reconnect
    enabled: !!address, // Only fetch when user is connected
  });

  // Flatten all pages into a single array
  const positions = useMemo(() => 
    data?.pages.flatMap(page => page.data) ?? [], 
    [data]
  );

  // Debug logging
  useEffect(() => {
    if (address) {
      // console.log('useUserBets state:', {
      //   address,
      //   isLoading,
      //   isFetching,
      //   hasData: !!data,
      //   pagesCount: data?.pages?.length || 0,
      //   totalPositions: positions.length,
      //   error: error?.message,
      // });
    }
  }, [address, isLoading, isFetching, data, positions.length, error]);

  // Optimistic update
  const addOptimisticBet = useCallback((detail: any) => {
    if (!address) return;

    const optimisticBet = createOptimisticBet(detail, address);
    const optimisticPosition = formatOptimisticPosition(optimisticBet);

    queryClient.setQueryData<InfiniteData<{ data: Position[]; nextCursor: number | null }>>(
      queryKey,
      (oldData) => ({
        pages: oldData?.pages.map((page, i) => 
          i === 0 
            ? { 
                ...page, 
                data: [optimisticPosition, ...page.data.filter(p => !p.id.startsWith('opt_'))].slice(0, BATCH_SIZE) 
              }
            : page
        ) || [{ data: [optimisticPosition], nextCursor: null }],
        pageParams: oldData?.pageParams || [0],
      })
    );
  }, [address, queryClient, queryKey]);

  const upsertPositionInCache = useCallback((updatedPosition: Position) => {
    if (!address) return;

    queryClient.setQueryData<InfiniteData<{ data: Position[]; nextCursor: number | null }>>(
      queryKey,
      (oldData) => oldData ? ({
        ...oldData,
        pages: oldData.pages.map((page, i) => ({
          ...page,
          data: i === 0
            ? [updatedPosition, ...page.data.filter(p => 
                p.id !== updatedPosition.id && 
                !(p.id.startsWith('opt_') && p.timeperiodId === updatedPosition.timeperiodId)
              )].slice(0, BATCH_SIZE)
            : page.data.filter(p => p.id !== updatedPosition.id)
        }))
      }) : oldData
    );
  }, [queryClient, queryKey, address]);

  const removePositionFromCache = useCallback((positionId?: string) => {
    if (!positionId || !address) return;
    queryClient.setQueryData<InfiniteData<{ data: Position[]; nextCursor: number | null }>>(
      queryKey,
      (oldData) => {
        if (!oldData) return oldData;
        const newPages = oldData.pages.map(page => ({
          ...page,
          data: page.data.filter(position => position.id !== positionId),
        }));
        return { ...oldData, pages: newPages };
      }
    );
  }, [queryClient, queryKey, address]);

  const hydrateRealtimeBet = useCallback(async (bet: BetPlacedWithSession | null) => {
    if (!bet) return;

    const optimisticPosition = formatOptimisticPosition(bet);
    upsertPositionInCache(optimisticPosition);

    let hydratedBet = bet;
    const requiredFields: (keyof BetPlacedWithSession)[] = [
      'timeperiod_id',
      'grid_id',
      'price_min',
      'price_max',
      'amount',
      'user_address'
    ];

    const isIncomplete = requiredFields.some((field) => hydratedBet?.[field] == null);

    if (isIncomplete && bet.event_id) {
      const { data: fullBet, error: hydrateError } = await supabase
        .from(TABLES.BET_PLACED_WITH_SESSION)
        .select('*')
        .eq('event_id', bet.event_id)
        .maybeSingle();

      if (hydrateError) {
        console.error('Error hydrating full bet row:', hydrateError);
        return;
      }

      if (!fullBet) {
        console.warn('No bet found while hydrating payload');
        return;
      }

      hydratedBet = fullBet as BetPlacedWithSession;
    }

    const formatted = await formatPositions([hydratedBet]);
    if (!formatted?.length) return;
    upsertPositionInCache(formatted[0]);
  }, [upsertPositionInCache]);

  // Cache first batch for instant load on next visit
  useEffect(() => {
    if (data?.pages[0]?.data && data.pages[0].data.length > 0 && address) {
      try {
        const cacheKey = `mercury_cached_positions_${address.toLowerCase()}`;
        const cacheTimeKey = `mercury_positions_cache_time_${address.toLowerCase()}`;
        storage.set(cacheKey, JSON.stringify(data.pages[0].data));
        storage.set(cacheTimeKey, Date.now().toString());
      } catch (error) {
        console.error('Error caching positions:', error);
      }
    }
  }, [data?.pages, address]);

  // Restore from cache on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !address) return;
    
    try {
      const cacheKey = `mercury_cached_positions_${address.toLowerCase()}`;
      const cacheTimeKey = `mercury_positions_cache_time_${address.toLowerCase()}`;
      
      const cachedPositions = storage.get<string>(cacheKey);
      const cacheTimestamp = storage.get<string>(cacheTimeKey);
      
      if (cachedPositions && cacheTimestamp) {
        const cacheAge = Date.now() - parseInt(cacheTimestamp);
        if (cacheAge < CACHE_EXPIRY.POSITIONS) {
          const parsed = typeof cachedPositions === 'string' ? JSON.parse(cachedPositions) : cachedPositions;
          console.log('⚡ Restored', parsed.length, 'cached positions - INSTANT LOAD!');
          
          queryClient.setQueryData<InfiniteData<{ data: Position[]; nextCursor: number | null }>>(
            queryKey,
            {
              pages: [{ data: parsed, nextCursor: parsed.length === BATCH_SIZE ? 1 : null }],
              pageParams: [0],
            }
          );
        }
      }
    } catch (error) {
      console.error('Error loading cached positions:', error);
    }
  }, [address]);

  // WebSocket + Fallback Strategy
  useEffect(() => {
    if (!address) return;

    let wsConnected = false;
    let fallbackActive = false;
    let fallbackChannel: any = null;

    // Layer 1: Optimistic updates (instant)
    const handleOrderPlaced = (event: Event) => {
      const detail = (event as CustomEvent).detail;
       if (detail.error) {
        console.log('orderPlaced event with error - skipping optimistic update:', detail.error);
        return;
      }
      
      console.log('orderPlaced event - adding optimistic bet');
      addOptimisticBet(detail);
    };
    // Layer 2: Mercury WebSocket (primary, <100ms)
    const setupWebSocket = async () => {
      try {
        await wsClient.connect();
        wsConnected = true;
        
        // Subscribe to user's bets only
        wsClient.subscribe({
          tables: ['bet_placed_with_session'],
          events: ['INSERT', 'UPDATE'],
        });

        // Handle WebSocket events
        const unsubEvent = wsClient.onEvent(async (event: BetEvent) => {
          // Only process if it's for this user
          if (event.new?.user_address?.toLowerCase() !== address.toLowerCase()) {
            return;
          }

          console.log('📨 WebSocket bet update for user:', event.new.user_address);
          const formatted = await formatPositions([event.new]);
          if (formatted?.length) {
            upsertPositionInCache(formatted[0]);
          }
        });

        // Handle WebSocket errors - activate fallback
        const unsubError = wsClient.onError((error) => {
          console.warn('⚠️ WebSocket error, activating fallback:', error);
          wsConnected = false;
          if (!fallbackActive) {
            activateFallback();
          }
        });

        return () => {
          unsubEvent();
          unsubError();
        };
      } catch (error) {
        console.error('❌ WebSocket setup failed, using fallback:', error);
        wsConnected = false;
        if (!fallbackActive) {
          activateFallback();
        }
      }
    };

    // Layer 3: Supabase Fallback (when WebSocket fails)
    const activateFallback = () => {
      if (fallbackActive || !supabase) return;
      fallbackActive = true;

      console.log('🔄 Activating Supabase fallback for user:', address);

      // Use Supabase Realtime as backup
      fallbackChannel = supabase
        .channel(`fallback_bets_${address.toLowerCase()}`)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'bet_placed_with_session',
          filter: `user_address=eq.${address.toLowerCase()}`,
        }, async (payload: any) => {
          console.log('📨 Fallback bet update:', payload);
          if (payload.eventType === 'DELETE') {
            removePositionFromCache(payload.old?.event_id);
            return;
          }
          await hydrateRealtimeBet(payload.new as BetPlacedWithSession);
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('✅ Fallback active (Supabase direct)');
          }
        });
    };

    // Fallback timer: If WebSocket doesn't connect in 5s, use Supabase
    fallbackTimerRef.current = window.setTimeout(() => {
      if (!wsConnected) {
        console.log('⏱️ WebSocket timeout, activating fallback');
        activateFallback();
      }
    }, 5000);

    // Setup settlements subscription - INSTANT optimistic update
    const settledChannel = supabase
      ?.channel('timeperiod_settled_changes')
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'timeperiod_settled',
      }, (payload) => {
        const settlement = payload.new as { timeperiod_id: number; twap_price: string | null };
        if (!settlement) return;
        
        const timeperiodId = settlement.timeperiod_id;
        const twapPrice = settlement.twap_price;
        
        
        // INSTANT optimistic cache update - show settlement price immediately
        queryClient.setQueryData(
          queryKey,
          (oldData: any) => {
            if (!oldData?.pages) return oldData;
            
            const newPages = oldData.pages.map((page: any) => ({
              ...page,
              data: page.data.map((position: any) => {
                if (position.timeperiodId !== timeperiodId) return position;
                
                const settlementPrice = twapPrice ? `$${(parseFloat(twapPrice) / 1e8).toFixed(2)}` : null;
                
                console.log(`⚡ INSTANT: ${position.id.slice(0, 8)}... → Resolved`);
                
                return {
                  ...position,
                  settlement: {
                    ...position.settlement,
                    price: settlementPrice,
                  },
                  status: 'Resolved',
                };
              }),
            }));
            
            return { ...oldData, pages: newPages };
          }
        );
        
        // Background refetch for accurate win/loss/payout (non-blocking)
        setTimeout(() => {
          console.log('🔄 Background refetch for accurate data...');
          refetch();
        }, 50);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Subscribed to settlement updates');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Settlement channel error');
        }
      });

    // Winnings are handled by settlement subscription above - no separate subscription needed

    if (typeof window !== 'undefined') {
      window.addEventListener('orderPlaced', handleOrderPlaced);
    }

    const wsCleanup = setupWebSocket();

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('orderPlaced', handleOrderPlaced);
      }
      if (fallbackTimerRef.current) {
        window.clearTimeout(fallbackTimerRef.current);
      }
      if (fallbackChannel) {
        supabase?.removeChannel(fallbackChannel);
      }
      if (settledChannel) {
        supabase?.removeChannel(settledChannel);
      }
      wsCleanup?.then(cleanup => cleanup?.());
    };
  }, [address, addOptimisticBet, upsertPositionInCache, wsClient, queryKey, queryClient, refetch, hydrateRealtimeBet, removePositionFromCache]);

  return {
    positions,
    isLoading,
    isFetching,
    isFetchingNextPage,
    error: error ? (error as Error).message : null,
    refetch,
    fetchNextPage,
    hasMore: hasNextPage ?? false,
    batchSize: BATCH_SIZE,
  };
}
