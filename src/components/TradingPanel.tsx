import { useState, useEffect } from 'react';
import { STORAGE_KEYS } from '../config';
import styles from './TradingPanel.module.css';

interface TradingPanelProps {
  sdk: any;
  hasSession: boolean;
  currentPrice?: number;
}

interface BetHistory {
  id: string;
  timeperiodId: number;
  priceMin: number;
  priceMax: number;
  amount: number;
  txHash: string;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
}

export default function TradingPanel({ sdk, hasSession, currentPrice = 37.25 }: TradingPanelProps) {
  const [timeperiodId, setTimeperiodId] = useState<string>('1');
  const [priceMin, setPriceMin] = useState<string>('');
  const [priceMax, setPriceMax] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [isPlacing, setIsPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [betHistory, setBetHistory] = useState<BetHistory[]>([]);
  const [showAmountWarning, setShowAmountWarning] = useState(false);

  // Load amount from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedAmount = localStorage.getItem(STORAGE_KEYS.USER_AMOUNT);
    if (savedAmount) {
      const parsedAmount = parseFloat(savedAmount);
      if (parsedAmount >= 0.2) {
        setAmount(savedAmount);
      }
    }
  }, []);

  // Listen for storage changes (when amount is set in AmountModal)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleStorageChange = () => {
      const savedAmount = localStorage.getItem(STORAGE_KEYS.USER_AMOUNT);
      if (savedAmount) {
        const parsedAmount = parseFloat(savedAmount);
        if (parsedAmount >= 0.2) {
          setAmount(savedAmount);
          setShowAmountWarning(false);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Also listen for custom event from same page
    window.addEventListener('amountUpdated', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('amountUpdated', handleStorageChange);
    };
  }, []);

  const handleQuickFill = (range: 'below' | 'above' | 'narrow' | 'wide') => {
    const price = currentPrice;
    
    switch (range) {
      case 'below':
        setPriceMin((price - 0.5).toFixed(2));
        setPriceMax(price.toFixed(2));
        break;
      case 'above':
        setPriceMin(price.toFixed(2));
        setPriceMax((price + 0.5).toFixed(2));
        break;
      case 'narrow':
        setPriceMin((price - 0.1).toFixed(2));
        setPriceMax((price + 0.1).toFixed(2));
        break;
      case 'wide':
        setPriceMin((price - 1).toFixed(2));
        setPriceMax((price + 1).toFixed(2));
        break;
    }
  };

  const handlePlaceBet = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!hasSession) {
      setError('Please create a session first');
      return;
    }

    if (!sdk) {
      setError('SDK not initialized');
      return;
    }

    // Check if amount is set
    if (typeof window === 'undefined') {
      setError('localStorage is not available');
      return;
    }
    const savedAmount = localStorage.getItem(STORAGE_KEYS.USER_AMOUNT);
    if (!savedAmount || parseFloat(savedAmount) === 0) {
      setError('⚠️ Please set an amount first using the Amount Modal at the top right');
      setShowAmountWarning(true);
      return;
    }

    const amountValue = parseFloat(savedAmount);
    
    // Validate minimum amount
    if (amountValue < 0.2) {
      setError('⚠️ Amount must be at least $0.2. Please update your amount in the Amount Modal');
      setShowAmountWarning(true);
      return;
    }

    setIsPlacing(true);
    setError(null);
    setSuccess(null);
    setShowAmountWarning(false);

    try {
      // Parse inputs
      const params = {
        timeperiodId: parseInt(timeperiodId),
        priceMin: Math.floor(parseFloat(priceMin) * 100), // Convert to cents
        priceMax: Math.floor(parseFloat(priceMax) * 100), // Convert to cents
        amount: Math.floor(amountValue * 1e6), // Convert to 6 decimals (USDC)
      };

      // Validate
      if (params.priceMin >= params.priceMax) {
        throw new Error('Price min must be less than price max');
      }

      if (params.amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      console.log('🎯 Placing bet:', params);
      const result = await sdk.placeBet(params);
      console.log('✅ Bet placed:', result);

      // Add to history
      const newBet: BetHistory = {
        id: result.txHash,
        timeperiodId: params.timeperiodId,
        priceMin: params.priceMin,
        priceMax: params.priceMax,
        amount: params.amount,
        txHash: result.txHash,
        timestamp: Date.now(),
        status: 'pending',
      };

      setBetHistory([newBet, ...betHistory]);
      setSuccess(`Bet placed! TX: ${result.txHash.slice(0, 10)}...`);

      // Clear price form but keep amount
      setPriceMin('');
      setPriceMax('');
    } catch (err: any) {
      console.error('❌ Failed to place bet:', err);
      setError(err.message || 'Failed to place bet');
    } finally {
      setIsPlacing(false);
    }
  };

  return (
    <div className={styles.tradingPanel}>
      <div className={styles.panelHeader}>
        <h3>Place Bet</h3>
        {hasSession && (
          <span className={styles.sessionBadge}>✅ One-Click Enabled</span>
        )}
      </div>

      {!hasSession && (
        <div className={styles.warning}>
          ⚠️ Create a session above to enable one-click trading
        </div>
      )}

      <form onSubmit={handlePlaceBet} className={styles.form}>
        <div className={styles.formGroup}>
          <label>Time Period ID</label>
          <input
            type="number"
            value={timeperiodId}
            onChange={(e) => setTimeperiodId(e.target.value)}
            placeholder="1"
            required
            min="1"
          />
          <span className={styles.hint}>Current trading period ID</span>
        </div>

        <div className={styles.priceRange}>
          <div className={styles.formGroup}>
            <label>Price Min ($)</label>
            <input
              type="number"
              value={priceMin}
              onChange={(e) => setPriceMin(e.target.value)}
              placeholder="36.50"
              step="0.01"
              required
            />
          </div>

          <div className={styles.formGroup}>
            <label>Price Max ($)</label>
            <input
              type="number"
              value={priceMax}
              onChange={(e) => setPriceMax(e.target.value)}
              placeholder="37.50"
              step="0.01"
              required
            />
          </div>
        </div>

        <div className={styles.quickFill}>
          <span className={styles.quickLabel}>Quick Fill:</span>
          <button type="button" onClick={() => handleQuickFill('below')} className={styles.quickBtn}>
            Below Current
          </button>
          <button type="button" onClick={() => handleQuickFill('above')} className={styles.quickBtn}>
            Above Current
          </button>
          <button type="button" onClick={() => handleQuickFill('narrow')} className={styles.quickBtn}>
            Narrow (±0.1)
          </button>
          <button type="button" onClick={() => handleQuickFill('wide')} className={styles.quickBtn}>
            Wide (±1.0)
          </button>
        </div>

        <div className={styles.formGroup}>
          <label>Bet Amount (USDC)</label>
          <div className={styles.amountDisplay}>
            <span className={styles.amountValue}>
              {amount ? `$${parseFloat(amount).toFixed(2)}` : 'Not Set'}
            </span>
            <span className={styles.amountHint}>
              {amount 
                ? '✓ Set via Amount Modal' 
                : '⚠️ Please set amount using Amount Modal (top right)'}
            </span>
          </div>
          {showAmountWarning && (
            <div className={styles.amountWarning}>
              👆 Click the Amount Modal at the top right to set your bet amount (min: $0.2)
            </div>
          )}
        </div>

        {error && (
          <div className={styles.error}>
            ❌ {error}
          </div>
        )}

        {success && (
          <div className={styles.success}>
            ✅ {success}
          </div>
        )}

        <button
          type="submit"
          className={styles.submitButton}
          disabled={!hasSession || isPlacing}
        >
          {isPlacing ? '⏳ Placing Bet...' : '🎯 Place Bet (No MetaMask Popup!)'}
        </button>
      </form>

      {betHistory.length > 0 && (
        <div className={styles.history}>
          <h4>Recent Bets</h4>
          <div className={styles.historyList}>
            {betHistory.map((bet) => (
              <div key={bet.id} className={styles.historyItem}>
                <div className={styles.historyRow}>
                  <span className={styles.historyLabel}>Period:</span>
                  <span className={styles.historyValue}>{bet.timeperiodId}</span>
                </div>
                <div className={styles.historyRow}>
                  <span className={styles.historyLabel}>Range:</span>
                  <span className={styles.historyValue}>
                    ${(bet.priceMin / 100).toFixed(2)} - ${(bet.priceMax / 100).toFixed(2)}
                  </span>
                </div>
                <div className={styles.historyRow}>
                  <span className={styles.historyLabel}>Amount:</span>
                  <span className={styles.historyValue}>
                    ${(bet.amount / 1e6).toFixed(2)}
                  </span>
                </div>
                <div className={styles.historyRow}>
                  <span className={styles.historyLabel}>TX:</span>
                  <a
                    href={`https://etherscan.io/tx/${bet.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.txLink}
                  >
                    {bet.txHash.slice(0, 10)}...
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


