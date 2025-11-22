import { useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { InfiniteData, useInfiniteQuery, useQueryClient,keepPreviousData } from '@tanstack/react-query';
import { supabase, BetPlacedWithSession } from '../lib/supabaseClient';
import { TABLES, QUERY_LIMITS, CACHE_EXPIRY } from '../config';
import { storage, formatNumber, formatUSD, formatMultiplier } from '../utils';

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
    
    if (betStatus === 'won') {
      settlementStatus = 'win';
      settlementPrice = bet.settlement_price 
        ? formatUSD(parseFloat(bet.settlement_price) / 1e8)
        : null;
      const payoutAmount = parseFloat(amountUSD) * dbMultiplier;
      potentialPayout = formatUSD(payoutAmount);
      multiplier = dbMultiplier > 0 ? ` ${dbMultiplier.toFixed(1)}X` : '';
    } else if (betStatus === 'lost') {
      settlementStatus = 'Loss';
      settlementPrice = bet.settlement_price 
        ? formatUSD(parseFloat(bet.settlement_price) / 1e8)
        : null;
      potentialPayout = formatUSD(0);
      multiplier = '';
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
async function fetchBetsBatch({ pageParam = 0 }): Promise<{ data: Position[]; nextCursor: number | null }> {
  // Check if Supabase is configured
  if (!supabase) {
    throw new Error('Supabase client is not initialized. Please check your environment variables.');
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl || supabaseUrl === '') {
    console.warn('⚠️ Supabase not configured - using demo mode');
    return { data: [], nextCursor: null };
  }

  const offset = pageParam * BATCH_SIZE;
  console.log(`🔍 Fetching batch (offset: ${offset}, limit: ${BATCH_SIZE})...`);

  const { data, error } = await supabase
    .from(TABLES.BET_PLACED_WITH_SESSION)
    .select('*')
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

  if (!data || data.length === 0) {
    return { data: [], nextCursor: null };
  }

  const formattedPositions = await formatPositions(data);
  
  // Check if there are more batches
  const hasMore = data.length === BATCH_SIZE;
  const nextCursor = hasMore ? pageParam + 1 : null;

  console.log(`✅ Fetched batch: ${formattedPositions.length} positions, hasMore: ${hasMore}`);

  return { data: formattedPositions, nextCursor };
}

export function useUserBets() {
  const { address, isConnected } = useAccount();
  const queryClient = useQueryClient();

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
    queryKey: ['userBets', 'all'],
    queryFn: fetchBetsBatch,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 30_000, // Consider data fresh for 30 seconds
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    placeholderData: keepPreviousData,
  });

  // Flatten all pages into a single array
  const positions = data?.pages.flatMap(page => page.data) ?? [];

  const upsertPositionInCache = useCallback((updatedPosition: Position) => {
    queryClient.setQueryData<InfiniteData<{ data: Position[]; nextCursor: number | null }>>(
      ['userBets', 'all'],
      (oldData) => {
        if (!oldData) return oldData;

        const newPages = oldData.pages.map((page, pageIndex) => {
          const filtered = page.data.filter(position => position.id !== updatedPosition.id);
          if (pageIndex === 0) {
            const nextData = [updatedPosition, ...filtered].slice(0, BATCH_SIZE);
            return { ...page, data: nextData };
          }
          return { ...page, data: filtered };
        });

        return { ...oldData, pages: newPages };
      }
    );
  }, [queryClient]);

  const removePositionFromCache = useCallback((positionId?: string) => {
    if (!positionId) return;
    queryClient.setQueryData<InfiniteData<{ data: Position[]; nextCursor: number | null }>>(
      ['userBets', 'all'],
      (oldData) => {
        if (!oldData) return oldData;
        const newPages = oldData.pages.map(page => ({
          ...page,
          data: page.data.filter(position => position.id !== positionId),
        }));
        return { ...oldData, pages: newPages };
      }
    );
  }, [queryClient]);

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
    if (data?.pages[0]?.data && data.pages[0].data.length > 0) {
      try {
        const cacheKey = 'mercury_cached_positions_all';
        const cacheTimeKey = 'mercury_positions_cache_time_all';
        storage.set(cacheKey, JSON.stringify(data.pages[0].data));
        storage.set(cacheTimeKey, Date.now().toString());
      } catch (error) {
        console.error('Error caching positions:', error);
      }
    }
  }, [data?.pages]);

  // Restore from cache on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    try {
      const cacheKey = 'mercury_cached_positions_all';
      const cacheTimeKey = 'mercury_positions_cache_time_all';
      
      const cachedPositions = storage.get<string>(cacheKey);
      const cacheTimestamp = storage.get<string>(cacheTimeKey);
      
      if (cachedPositions && cacheTimestamp) {
        const cacheAge = Date.now() - parseInt(cacheTimestamp);
        if (cacheAge < CACHE_EXPIRY.POSITIONS) {
          const parsed = typeof cachedPositions === 'string' ? JSON.parse(cachedPositions) : cachedPositions;
          console.log('⚡ Restored', parsed.length, 'cached positions - INSTANT LOAD!');
        }
      }
    } catch (error) {
      console.error('Error loading cached positions:', error);
    }
  }, []);

  // Set up realtime subscriptions
  useEffect(() => {
    if (!supabase) return;

    const betsChannel = supabase
      .channel('bet_placed_changes')
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'bet_placed_with_session',
      }, async (payload) => {
        console.log('🔔 Real-time update received:', payload);
        try {
          if (payload.eventType === 'DELETE') {
            removePositionFromCache(payload.old?.event_id);
            return;
          }
          await hydrateRealtimeBet(payload.new as BetPlacedWithSession);
        } catch (error) {
          console.error('Error applying realtime bet update:', error);
          refetch();
        }
      })
      .subscribe();

    const settledChannel = supabase
      .channel('timeperiod_settled_changes')
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table: 'timeperiod_settled',
      }, () => refetch())
      .subscribe();

    const winningsChannel = supabase
      .channel('winnings_claimed_changes')
      .on('postgres_changes' as any, {
        event: 'INSERT',
        schema: 'public',
        table: 'winnings_claimed_equal',
      }, () => refetch())
      .subscribe();

    // Listen for orderPlaced events
    const handleOrderPlaced = () => {
      console.log('📢 orderPlaced event received - refetching bets');
      refetch();
    };
    
    if (typeof window !== 'undefined') {
      window.addEventListener('orderPlaced', handleOrderPlaced);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('orderPlaced', handleOrderPlaced);
      }
      supabase.removeChannel(betsChannel);
      supabase.removeChannel(settledChannel);
      supabase.removeChannel(winningsChannel);
    };
  }, [refetch, hydrateRealtimeBet, removePositionFromCache]);

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
