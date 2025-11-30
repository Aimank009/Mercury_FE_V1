import { supabase } from './supabaseClient';
import { TABLES } from '../config';
import { formatNumber } from '../utils';

/**
 * Interface for a user's bet data
 */
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
}

/**
 * Fetch all users' bets within a timeframe and price range
 * @param currentTime - Current timestamp in seconds
 * @param priceMin - Minimum price level
 * @param priceMax - Maximum price level
 * @param timeWindowSeconds - Time window in seconds (default: 300 = 5 minutes)
 * @returns Array of user bets
 */
export async function fetchAllUsersBets(
  currentTime: number,
  priceMin: number,
  priceMax: number,
  timeWindowSeconds: number = 300
): Promise<UserBet[]> {
  try {
    // Calculate timeperiod_id range (5-second intervals)
    // Look 2.5 minutes (150s) BEFORE and 2.5 minutes (150s) AFTER current time = total 5 minutes window
    const halfWindow = timeWindowSeconds / 2; // 150 seconds
    const startTimeperiodId = Math.floor((currentTime - halfWindow) / 5) * 5;
    const endTimeperiodId = Math.floor((currentTime + halfWindow) / 5) * 5;

    // console.log('🔍 Fetching all users bets:', {
    //   currentTime,
    //   startTimeperiodId,
    //   endTimeperiodId,
    //   priceMin,
    //   priceMax,
    //   halfWindow,
    //   lookingBack: `${halfWindow}s (${halfWindow / 60}min)`,
    //   lookingForward: `${halfWindow}s (${halfWindow / 60}min)`,
    //   totalWindow: `${timeWindowSeconds}s (${timeWindowSeconds / 60}min)`
    // });

    // Query bet_placed_with_session table which has price_min and price_max
    const { data, error } = await supabase
      .from(TABLES.BET_PLACED_WITH_SESSION)
      .select('*')
      .gte('timeperiod_id', startTimeperiodId.toString())
      .lte('timeperiod_id', endTimeperiodId.toString())
      .order('created_at', { ascending: false});

    if (error) {
      console.error('❌ Error fetching all users bets:', error);
      return [];
    }

    console.log('📊 Raw bet data:', data?.length || 0, 'bets found', data);

    if (!data || data.length === 0) {
      console.log('✅ No bets found in timeframe');
      return [];
    }

    console.log('📊 Raw bet data:', data.length, 'bets found');

    // Transform all bets without aggressive price filtering
    // We'll let the visual rendering decide what to show
    const bets: UserBet[] = data.map(bet => {
      const priceMinDollars = parseFloat(bet.price_min) / 1e8;
      const priceMaxDollars = parseFloat(bet.price_max) / 1e8;
      const priceLevel = (priceMinDollars + priceMaxDollars) / 2; // Use midpoint
      
      // Create grid_id from timeperiod and price (matching backend format)
      const gridId = `${bet.timeperiod_id}_${formatNumber(priceMinDollars, 2)}_${formatNumber(priceMaxDollars, 2)}`;
      
      const amount = parseFloat(bet.amount) / 1e6; // Convert from USDC precision (1e6)
      const shares = parseFloat(bet.shares_received) / 1e6;
      const multiplier = shares > 0 ? (amount / shares) : 0;

      return {
        grid_id: gridId,
        user_address: bet.user_address,
        timeperiod_id: parseInt(bet.timeperiod_id),
        price_level: priceLevel,
        amount: amount,
        shares: shares,
        multiplier: multiplier,
        created_at: bet.created_at,
        session_id: bet.session_key
      };
    });

    console.log('✅ Fetched', bets.length, 'bets from all users (no price filter applied)');
    return bets;
  } catch (error) {
    console.error('❌ Exception fetching all users bets:', error);
    return [];
  }
}

/**
 * Subscribe to real-time updates for new bets
 * @param callback - Function to call when a new bet is placed
 * @param priceMin - Minimum price level filter
 * @param priceMax - Maximum price level filter
 * @returns Unsubscribe function
 */
export function subscribeToAllUsersBets(
  callback: (bet: UserBet) => void,
  priceMin?: number,
  priceMax?: number
): () => void {
  console.log('🔔 Setting up real-time subscription for all users bets');

  // Subscribe to INSERT events on bet_placed_with_session table
  const channel = supabase
    .channel('all-users-bets')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'bet_placed_with_session'
      },
      async (payload) => {
        const newBet = payload.new as any;
        
        const priceMinDollars = parseFloat(newBet.price_min) / 1e8;
        const priceMaxDollars = parseFloat(newBet.price_max) / 1e8;
        const priceLevel = (priceMinDollars + priceMaxDollars) / 2;
        
        // Apply price filter if provided
        if (priceMin !== undefined && priceMax !== undefined) {
          if (priceMaxDollars < priceMin || priceMinDollars > priceMax) {
            return;
          }
        }
        
        // Create grid_id from timeperiod and price
        const gridId = `${newBet.timeperiod_id}_${formatNumber(priceMinDollars, 2)}_${formatNumber(priceMaxDollars, 2)}`;
        
        const amount = parseFloat(newBet.amount) / 1e6;
        const shares = parseFloat(newBet.shares_received) / 1e6;
        const multiplier = shares > 0 ? (amount / shares) : 0;
        
        const bet: UserBet = {
          grid_id: gridId,
          user_address: newBet.user_address,
          timeperiod_id: parseInt(newBet.timeperiod_id),
          price_level: priceLevel,
          amount: amount,
          shares: shares,
          multiplier: multiplier,
          created_at: newBet.created_at,
          session_id: newBet.session_key
        };
        
        console.log('🆕 New bet from user:', bet.user_address, bet);
        callback(bet);
      }
    )
    .subscribe();

  // Return unsubscribe function
  return () => {
    console.log('🔇 Unsubscribing from all users bets');
    supabase.removeChannel(channel);
  };
}

/**
 * Fetch bets for a specific grid
 * @param gridId - The grid ID to fetch bets for
 * @returns Array of user bets for the grid
 */
export async function fetchBetsForGrid(gridId: string): Promise<UserBet[]> {
  try {
    // Parse grid_id format: "timeperiod_priceMin_priceMax"
    const parts = gridId.split('_');
    if (parts.length < 3) {
      console.warn('Invalid grid_id format:', gridId);
      return [];
    }
    
    const timeperiodId = parts[0];
    const priceMin = parts[1];
    const priceMax = parts[2];
    
    const { data, error } = await supabase
      .from(TABLES.BET_PLACED_WITH_SESSION)
      .select('*')
      .eq('timeperiod_id', timeperiodId)
      .eq('price_min', (parseFloat(priceMin) * 1e8).toString())
      .eq('price_max', (parseFloat(priceMax) * 1e8).toString());

    if (error) {
      console.error('❌ Error fetching bets for grid:', gridId, error);
      return [];
    }

    if (!data || data.length === 0) return [];

    const priceMinDollars = parseFloat(priceMin);
    const priceMaxDollars = parseFloat(priceMax);
    const priceLevel = (priceMinDollars + priceMaxDollars) / 2;

    return data.map(bet => {
      const amount = parseFloat(bet.amount) / 1e6;
      const shares = parseFloat(bet.shares_received) / 1e6;
      const multiplier = shares > 0 ? (amount / shares) : 0;

      return {
        grid_id: gridId,
        user_address: bet.user_address,
        timeperiod_id: parseInt(bet.timeperiod_id),
        price_level: priceLevel,
        amount: amount,
        shares: shares,
        multiplier: multiplier,
        created_at: bet.created_at,
        session_id: bet.session_key
      };
    });
  } catch (error) {
    console.error('❌ Exception fetching bets for grid:', gridId, error);
    return [];
  }
}

/**
 * Get aggregated bet statistics for a specific grid
 * @param timeperiodId - The timeperiod ID
 * @param priceLevel - The price level
 * @returns Total amount, total shares, and number of bettors
 */
export async function getGridBetStats(
  timeperiodId: number,
  priceLevel: number
): Promise<{ totalAmount: number; totalShares: number; bettorCount: number } | null> {
  try {
    // Fetch all bets for this timeperiod
    const { data, error } = await supabase
      .from(TABLES.BET_PLACED_WITH_SESSION)
      .select('*')
      .eq('timeperiod_id', timeperiodId.toString());

    if (error) {
      console.error('❌ Error fetching grid stats:', error);
      return null;
    }

    if (!data || data.length === 0) {
      return { totalAmount: 0, totalShares: 0, bettorCount: 0 };
    }

    // Filter bets that match the price level
    const matchingBets = data.filter(bet => {
      const priceMinDollars = parseFloat(bet.price_min) / 1e8;
      const priceMaxDollars = parseFloat(bet.price_max) / 1e8;
      return priceLevel >= priceMinDollars && priceLevel <= priceMaxDollars;
    });

    if (matchingBets.length === 0) {
      return { totalAmount: 0, totalShares: 0, bettorCount: 0 };
    }

    const totalAmount = matchingBets.reduce((sum, bet) => sum + (parseFloat(bet.amount) / 1e6), 0);
    const totalShares = matchingBets.reduce((sum, bet) => sum + (parseFloat(bet.shares_received) / 1e6), 0);
    const uniqueBettors = new Set(matchingBets.map(bet => bet.user_address)).size;

    return {
      totalAmount,
      totalShares,
      bettorCount: uniqueBettors
    };
  } catch (error) {
    console.error('❌ Exception fetching grid stats:', error);
    return null;
  }
}
