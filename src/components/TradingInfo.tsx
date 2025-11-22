import styles from './TradingInfo.module.css';
import { usePriceFeed } from '../contexts/PriceFeedContext';
import { useGlobalLiquidity } from '../hooks/useGlobalLiquidity';

interface TradingInfoProps {
  isScrolled?: boolean;
  onRecenter?: () => void;
}

export default function TradingInfo({ isScrolled = false, onRecenter }: TradingInfoProps) {
  const { currentPrice, isConnected } = usePriceFeed();
  const { liquidityPool, isLoading } = useGlobalLiquidity();

  // Format the liquidity value with proper decimals and commas
  const formatLiquidity = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return '0.000';
    return num.toLocaleString('en-US', { 
      minimumFractionDigits: 3, 
      maximumFractionDigits: 3 
    });
  };

  return (
    <div className={styles.tradingInfo}>
      <div className={styles.infoLeft}>
        <div className={styles.tokenSelect}>
          <div >
            <img src="/image.png" alt="" style={{width:'32px',height:'32px', paddingTop:'2px'}} />
          </div>
          <span className={styles.tokenName}>HYPE / USDT</span>
          <span className={styles.dropdown}>▼</span>
        </div>
        <div className={styles.infoItem}>
          <div className={styles.infoLabel}>Price</div>
          <div className={styles.infoValue}>
            ${currentPrice > 0 ? (currentPrice).toFixed(3) : '38.120'}
          </div>
        </div>
        <div className={styles.infoItem}>
          <div className={styles.infoLabel}>24 hr Volume</div>
          <div className={`${styles.infoValue} ${styles.positive}`}>+2.45%</div>
        </div>
      </div>
      <div className={styles.infoRight}>
        <button 
          className={`${styles.recenterButton} ${isScrolled ? styles.active : styles.disabled}`}
          onClick={onRecenter}
          disabled={!isScrolled}
          title={isScrolled ? "Click to recenter chart" : "Chart is centered"}
        >
          Recenter
        </button>
        <div className={styles.infoItem}>
          <div className={styles.infoLabel}>Market Liquidity</div>
          <div className={styles.infoValue}>
            ${isLoading ? '...' : formatLiquidity(liquidityPool)}
          </div>
        </div>
      </div>
    </div>
  );
}

