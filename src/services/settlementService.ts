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
 * Check if a bet wins against settlement price range
 * @param bet - Bet data from database
 * @param settlementPriceMin - Minimum settlement price in decimal format
 * @param settlementPriceMax - Maximum settlement price in decimal format
 * @param calculatedMultiplier - Multiplier calculated at bet time
 * @returns Win status and final multiplier
 */
export const checkBetAgainstSettlement = (
  bet: BetData,
  settlementPriceMin: number,
  settlementPriceMax: number,
  calculatedMultiplier: number
): { isWin: boolean; finalMultiplier: number; newStatus: 'won' | 'lost' } => {
  const priceMin = parseFloat(bet.price_min.toString()) / 1e8;
  const priceMax = parseFloat(bet.price_max.toString()) / 1e8;
  
  // Check if settlement price range OVERLAPS with bet's price range
  // A bet wins if there's any overlap between [settlementPriceMin, settlementPriceMax] and [priceMin, priceMax]
  // Overlap exists if: settlementPriceMin < priceMax && settlementPriceMax > priceMin
  const isWin = settlementPriceMin < priceMax && settlementPriceMax > priceMin;
  const newStatus = isWin ? 'won' : 'lost';
  
  // Determine multiplier: keep calculated multiplier if win, set to 0 if loss
  const finalMultiplier = isWin ? calculatedMultiplier : 0;
  
  return { isWin, finalMultiplier, newStatus };
};

/**
 * Update bet settlement in database
 * @param eventId - Bet event ID
 * @param status - 'won' or 'lost'
 * @param settlementPriceMin - Minimum settlement price in decimal format
 * @param settlementPriceMax - Maximum settlement price in decimal format
 * @param multiplier - Final multiplier (0 if loss, original if win)
 */
export const updateBetSettlement = async (
  eventId: string,
  status: 'won' | 'lost',
  settlementPriceMin: number,
  settlementPriceMax: number,
  multiplier: number
): Promise<void> => {
  // Store the middle price of the settlement range as the settlement_price for backward compatibility
  const settlementPriceMiddle = (settlementPriceMin + settlementPriceMax) / 2;
  
  const { error } = await supabase
    .from('bet_placed_with_session')
    .update({ 
      status, 
      settled_at: new Date().toISOString(),
      settlement_price: Math.floor(settlementPriceMiddle * 1e8),
      multiplier,
      adjusted_multiplier: multiplier
    })
    .eq('event_id', eventId);
    
  if (error) {
    console.error('❌ Error updating bet status:', error);
    throw error;
  }
};

/**
 * Process settlement for all bets in a timeperiod
 * Determines win/loss status for each bet based on settlement price range
 * @param timeperiodId - Timeperiod ID
 * @param settlementPriceMin - Minimum settlement price in decimal format
 * @param settlementPriceMax - Maximum settlement price in decimal format
 * @returns Array of settlement results with grid_id and status
 */
export const processAllBetsSettlement = async (
  timeperiodId: number,
  settlementPriceMin: number,
  settlementPriceMax: number
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
      
      // Check if settlement price range OVERLAPS with bet's price range
      // A bet wins if there's any overlap between [settlementPriceMin, settlementPriceMax] and [priceMin, priceMax]
      // Overlap exists if: settlementPriceMin < priceMax && settlementPriceMax > priceMin
      const status: 'win' | 'loss' = settlementPriceMin < priceMax && settlementPriceMax > priceMin ? 'win' : 'loss';
      
      results.push({ gridId, status });
    });

    return results;
  } catch (error) {
    console.error('❌ Exception checking all bets for settlement:', error);
    return [];
  }
};