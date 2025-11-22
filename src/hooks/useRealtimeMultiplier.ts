// ========================================
// REAL-TIME MULTIPLIER HOOK
// Updates multiplier every second based on contract logic
// ========================================

import { useState, useEffect } from 'react';
import { 
  calculatePricePerShare, 
  getMultiplierValue,
  formatMultiplier,
  getCalculationDetails
} from '../lib/contractMultiplier';

interface MultiplierData {
  multiplier: number;
  formattedMultiplier: string;
  pricePerShare: number;
  timeUntilStart: number;
  isExpired: boolean;
}

/**
 * Hook to get real-time multiplier for a grid
 * Updates every second as time approaches grid start
 * 
 * @param existingShares - Total shares in the grid (as string from DB)
 * @param timeperiodId - Grid start time (Unix timestamp)
 * @param refreshInterval - How often to update (default: 1000ms)
 * @returns MultiplierData object with current multiplier
 */
export function useRealtimeMultiplier(
  existingShares: string | null | undefined,
  timeperiodId: number | null | undefined,
  refreshInterval: number = 1000
): MultiplierData {
  const [data, setData] = useState<MultiplierData>({
    multiplier: 0,
    formattedMultiplier: '0.00x',
    pricePerShare: 0,
    timeUntilStart: 0,
    isExpired: true
  });

  useEffect(() => {
    if (!timeperiodId || !existingShares) {
      setData({
        multiplier: 0,
        formattedMultiplier: '0.00x',
        pricePerShare: 0,
        timeUntilStart: 0,
        isExpired: true
      });
      return;
    }

    const updateMultiplier = () => {
      try {
        const shares = BigInt(existingShares || '0');
        const currentTime = Math.floor(Date.now() / 1000);
        const timeUntilStart = timeperiodId - currentTime;

        // Check if grid has expired
        if (timeUntilStart <= 0) {
          setData({
            multiplier: 0,
            formattedMultiplier: '0.00x',
            pricePerShare: 0,
            timeUntilStart: 0,
            isExpired: true
          });
          return;
        }

        // Calculate current multiplier
        const pricePerShare = calculatePricePerShare(shares, timeperiodId);
        const multiplier = getMultiplierValue(pricePerShare);
        const formattedMultiplier = formatMultiplier(pricePerShare);
        const pricePerShareNumber = Number(pricePerShare) / 1e18;

        setData({
          multiplier,
          formattedMultiplier,
          pricePerShare: pricePerShareNumber,
          timeUntilStart,
          isExpired: false
        });
      } catch (error) {
        console.error('Error calculating multiplier:', error);
        setData({
          multiplier: 0,
          formattedMultiplier: 'Error',
          pricePerShare: 0,
          timeUntilStart: 0,
          isExpired: true
        });
      }
    };

    // Update immediately
    updateMultiplier();

    // Set up interval for real-time updates
    const interval = setInterval(updateMultiplier, refreshInterval);

    return () => clearInterval(interval);
  }, [existingShares, timeperiodId, refreshInterval]);

  return data;
}

/**
 * Hook to get multiplier with detailed debug information
 * Useful for development and troubleshooting
 * 
 * @param existingShares - Total shares in the grid
 * @param timeperiodId - Grid start time
 * @returns Detailed calculation information
 */
export function useMultiplierDebug(
  existingShares: string | null | undefined,
  timeperiodId: number | null | undefined
) {
  const [details, setDetails] = useState<any>(null);

  useEffect(() => {
    if (!timeperiodId || !existingShares) {
      setDetails(null);
      return;
    }

    const updateDetails = () => {
      try {
        const shares = BigInt(existingShares || '0');
        const calculationDetails = getCalculationDetails(shares, timeperiodId);
        setDetails(calculationDetails);
      } catch (error) {
        console.error('Error getting calculation details:', error);
        setDetails(null);
      }
    };

    updateDetails();
    const interval = setInterval(updateDetails, 1000);

    return () => clearInterval(interval);
  }, [existingShares, timeperiodId]);

  return details;
}

/**
 * Hook to get multipliers for multiple grids
 * Efficiently calculates multipliers for all grids at once
 * 
 * @param grids - Array of grid objects with existingShares and timeperiodId
 * @returns Map of gridId to MultiplierData
 */
export function useMultipleGridMultipliers(
  grids: Array<{ id: string; existingShares: string; timeperiodId: number }>
): Map<string, MultiplierData> {
  const [multipliers, setMultipliers] = useState<Map<string, MultiplierData>>(new Map());

  useEffect(() => {
    const updateAllMultipliers = () => {
      const newMultipliers = new Map<string, MultiplierData>();

      grids.forEach(grid => {
        try {
          const shares = BigInt(grid.existingShares || '0');
          const currentTime = Math.floor(Date.now() / 1000);
          const timeUntilStart = grid.timeperiodId - currentTime;

          if (timeUntilStart <= 0) {
            newMultipliers.set(grid.id, {
              multiplier: 0,
              formattedMultiplier: '0.00x',
              pricePerShare: 0,
              timeUntilStart: 0,
              isExpired: true
            });
            return;
          }

          const pricePerShare = calculatePricePerShare(shares, grid.timeperiodId);
          const multiplier = getMultiplierValue(pricePerShare);

          newMultipliers.set(grid.id, {
            multiplier,
            formattedMultiplier: formatMultiplier(pricePerShare),
            pricePerShare: Number(pricePerShare) / 1e18,
            timeUntilStart,
            isExpired: false
          });
        } catch (error) {
          console.error(`Error calculating multiplier for grid ${grid.id}:`, error);
        }
      });

      setMultipliers(newMultipliers);
    };

    updateAllMultipliers();
    const interval = setInterval(updateAllMultipliers, 1000);

    return () => clearInterval(interval);
  }, [grids]);

  return multipliers;
}

