import { supabase } from '../lib/supabaseClient';

export interface UserBet {
  event_id: string;
  grid_id?: string;
  price_min: string | number;
  price_max: string | number;
  multiplier?: number;
  timeperiod_id: string | number;
  status?: string;
  [key: string]: any;
}

/**
 * Fetch user's unsettled bets for a specific timeperiod
 * @param address - User's wallet address
 * @param timeperiodId - Timeperiod ID to query
 * @returns Array of user bets
 */
export const fetchUserBets = async (
  address: string,
  timeperiodId: string
): Promise<UserBet[]> => {
  const { data, error } = await supabase
    .from('bet_placed_with_session')
    .select('*')
    .ilike('user_address', address)
    .eq('timeperiod_id', timeperiodId)
    .in('status', ['pending', 'confirmed']); // Only check unsettled bets
    
  if (error) {
    console.error('❌ Error querying user bets:', error);
    throw error;
  }
  
  return data || [];
};

/**
 * Fetch all bets for a timeperiod (for settlement tracking)
 * @param timeperiodId - Timeperiod ID
 * @returns Array of bets with price_min, price_max, timeperiod_id
 */
export const fetchAllBetsForTimeperiod = async (
  timeperiodId: number
): Promise<Array<{ price_min: string | number; price_max: string | number; timeperiod_id: string | number }>> => {
  const { data, error } = await supabase
    .from('bet_placed_with_session')
    .select('price_min, price_max, timeperiod_id')
    .eq('timeperiod_id', timeperiodId.toString());

  if (error) {
    console.error('❌ Error fetching bets for settlement:', error);
    throw error;
  }

  return data || [];
};

/**
 * Fetch total_share from bet_placed table for multiplier calculation
 * @param timeperiodId - Timeperiod ID
 * @param priceMin - Minimum price (in 1e8 format)
 * @param priceMax - Maximum price (in 1e8 format)
 * @returns Total share value or null if not found
 */
export const fetchTotalShare = async (
  timeperiodId: number,
  priceMin: number,
  priceMax: number
): Promise<string | null> => {
  const { data, error } = await supabase
    .from('bet_placed')
    .select('total_share')
    .eq('timeperiod_id', timeperiodId.toString())
    .eq('price_min', priceMin)
    .eq('price_max', priceMax)
    .maybeSingle();

  if (error) {
    console.error('❌ Error fetching total_share:', error);
    return null;
  }

  return data?.total_share || null;
};