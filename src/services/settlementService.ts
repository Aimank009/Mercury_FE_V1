import { supabase } from '../lib/supabaseClient';

export interface BetData {
  event_id: string;
  grid_id?: string;
  price_min: string | number;
  price_max: string | number;
  multiplier?: number;
  timeperiod_id: string | number;
  status?: string;
}

export interface SettlementResult {
  cellKey: string;
  status: 'won' | 'lost';
}

/**
 * Check if a bet wins against settlement price
 * @param bet - Bet data from database
 * @param settlementPrice - Settlement price in decimal format
 * @param calculatedMultiplier - Multiplier calculated at bet time
 * @returns Win status and final multiplier
 */
export const checkBetAgainstSettlement = (
  bet: BetData,
  settlementPrice: number,
  calculatedMultiplier: number
): { isWin: boolean; finalMultiplier: number; newStatus: 'won' | 'lost' } => {
  const priceMin = parseFloat(bet.price_min.toString()) / 1e8;
  const priceMax = parseFloat(bet.price_max.toString()) / 1e8;
  
  // Check if settlement price is within bet's price range
  const isWin = settlementPrice >= priceMin && settlementPrice <= priceMax;
  const newStatus = isWin ? 'won' : 'lost';
  
  // Determine multiplier: keep calculated multiplier if win, set to 0 if loss
  const finalMultiplier = isWin ? calculatedMultiplier : 0;
  
  return { isWin, finalMultiplier, newStatus };
};

/**
 * Update bet settlement in database
 * @param eventId - Bet event ID
 * @param status - 'won' or 'lost'
 * @param settlementPrice - Settlement price in decimal format
 * @param multiplier - Final multiplier (0 if loss, original if win)
 */
export const updateBetSettlement = async (
  eventId: string,
  status: 'won' | 'lost',
  settlementPrice: number,
  multiplier: number
): Promise<void> => {
  const { error } = await supabase
    .from('bet_placed_with_session')
    .update({ 
      status, 
      settled_at: new Date().toISOString(),
      settlement_price: Math.floor(settlementPrice * 1e8), // Store in cents
      multiplier // Keep multiplier if win, 0 if loss
    })
    .eq('event_id', eventId);
    
  if (error) {
    console.error('❌ Error updating bet status:', error);
    throw error;
  }
};

/**
 * Process settlement for all bets in a timeperiod
 * Determines win/loss status for each bet based on settlement price
 * @param timeperiodId - Timeperiod ID
 * @param settlementPrice - Settlement price in decimal format
 * @returns Array of settlement results with grid_id and status
 */
export const processAllBetsSettlement = async (
  timeperiodId: number,
  settlementPrice: number
): Promise<Array<{ gridId: string; status: 'win' | 'loss' }>> => {
  try {
    const { data: allBets, error } = await supabase
      .from('bet_placed_with_session')
      .select('price_min, price_max, timeperiod_id')
      .eq('timeperiod_id', timeperiodId.toString());

    if (error) {
      console.error('❌ Error fetching bets for settlement:', error);
      return [];
    }

    if (!allBets || allBets.length === 0) {
      return [];
    }

    // Process each bet to determine win/loss and create grid_id
    const results: Array<{ gridId: string; status: 'win' | 'loss' }> = [];
    
    allBets.forEach(bet => {
      const priceMin = parseFloat(bet.price_min.toString()) / 1e8;
      const priceMax = parseFloat(bet.price_max.toString()) / 1e8;
      
      if (Number.isNaN(priceMin) || Number.isNaN(priceMax)) return;

      // Create grid_id matching the format used in allUsersBetsRef
      const gridId = `${timeperiodId}_${priceMin.toFixed(2)}_${priceMax.toFixed(2)}`;
      const status: 'win' | 'loss' = settlementPrice >= priceMin && settlementPrice <= priceMax ? 'win' : 'loss';
      
      results.push({ gridId, status });
    });

    return results;
  } catch (error) {
    console.error('❌ Exception checking all bets for settlement:', error);
    return [];
  }
};