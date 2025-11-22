// ========================================
// MULTIPLIER DISPLAY COMPONENT
// Shows real-time multiplier for a grid
// ========================================

import React from 'react';
import { useRealtimeMultiplier } from '../hooks/useRealtimeMultiplier';

interface MultiplierDisplayProps {
  existingShares: string;
  timeperiodId: number;
  className?: string;
  showDetails?: boolean;
}

/**
 * Display real-time multiplier with auto-updates
 * 
 * Usage:
 * <MultiplierDisplay 
 *   existingShares="1000000"
 *   timeperiodId={1762965570}
 *   showDetails={true}
 * />
 */
export function MultiplierDisplay({
  existingShares,
  timeperiodId,
  className = '',
  showDetails = false
}: MultiplierDisplayProps) {
  const { 
    multiplier, 
    formattedMultiplier, 
    timeUntilStart, 
    isExpired 
  } = useRealtimeMultiplier(existingShares, timeperiodId);

  if (isExpired) {
    return (
      <div className={`multiplier-display expired ${className}`}>
        <span className="multiplier-value">Expired</span>
      </div>
    );
  }

  const minutesUntilStart = Math.floor(timeUntilStart / 60);
  const secondsUntilStart = timeUntilStart % 60;

  return (
    <div className={`multiplier-display ${className}`}>
      <div className="multiplier-value">
        {formattedMultiplier}
      </div>
      
      {showDetails && (
        <div className="multiplier-details">
          <div className="detail-row">
            <span className="label">Exact:</span>
            <span className="value">{multiplier.toFixed(4)}x</span>
          </div>
          <div className="detail-row">
            <span className="label">Time:</span>
            <span className="value">
              {minutesUntilStart}m {secondsUntilStart}s
            </span>
          </div>
          <div className="detail-row">
            <span className="label">Shares:</span>
            <span className="value">{Number(existingShares).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Compact multiplier badge for grid cells
 */
export function MultiplierBadge({
  existingShares,
  timeperiodId,
  size = 'md'
}: MultiplierDisplayProps & { size?: 'sm' | 'md' | 'lg' }) {
  const { formattedMultiplier, isExpired } = useRealtimeMultiplier(existingShares, timeperiodId);

  if (isExpired) {
    return null;
  }

  const sizeClasses = {
    sm: 'text-xs px-1 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5'
  };

  // Color based on multiplier value
  const multiplierValue = parseFloat(formattedMultiplier);
  const colorClass = multiplierValue >= 4 
    ? 'bg-green-500' 
    : multiplierValue >= 2.5 
    ? 'bg-yellow-500' 
    : 'bg-orange-500';

  return (
    <span className={`multiplier-badge ${sizeClasses[size]} ${colorClass} text-white rounded font-bold`}>
      {formattedMultiplier}
    </span>
  );
}

/**
 * Animated multiplier ticker (shows when multiplier changes)
 */
export function MultiplierTicker({
  existingShares,
  timeperiodId
}: MultiplierDisplayProps) {
  const { multiplier, formattedMultiplier, timeUntilStart } = useRealtimeMultiplier(existingShares, timeperiodId);
  const [prevMultiplier, setPrevMultiplier] = React.useState(multiplier);
  const [isChanging, setIsChanging] = React.useState(false);

  React.useEffect(() => {
    if (multiplier !== prevMultiplier) {
      setIsChanging(true);
      setTimeout(() => setIsChanging(false), 500);
      setPrevMultiplier(multiplier);
    }
  }, [multiplier, prevMultiplier]);

  // Highlight when close to tier change (40s, 25s, 15s)
  const isNearTierChange = timeUntilStart === 40 || 
                          timeUntilStart === 25 || 
                          timeUntilStart === 15 ||
                          (timeUntilStart > 15 && timeUntilStart <= 17) ||
                          (timeUntilStart > 25 && timeUntilStart <= 27) ||
                          (timeUntilStart > 40 && timeUntilStart <= 42);

  return (
    <div className={`multiplier-ticker ${isChanging ? 'changing' : ''} ${isNearTierChange ? 'near-change' : ''}`}>
      <span className="ticker-value">{formattedMultiplier}</span>
      {isNearTierChange && <span className="ticker-warning">⚡</span>}
    </div>
  );
}

