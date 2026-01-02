import React, { createContext, useContext, ReactNode, useEffect, useRef } from 'react';
import { useHypePriceFeed } from '../hooks/useHypePriceFeed';

interface PriceUpdate {
  raw: number;
  usd: number;
  block: number;
  latency: number;
}

interface PriceFeedContextType {
  currentPrice: number;
  isConnected: boolean;
  lastUpdate: PriceUpdate | null;
}

const PriceFeedContext = createContext<PriceFeedContextType | undefined>(undefined);

// Reference to the shared price worker (will be set by TradingChart)
let sharedPriceWorkerRef: Worker | null = null;

// Export function for TradingChart to register the shared worker
export function registerSharedPriceWorker(worker: Worker | null) {
  sharedPriceWorkerRef = worker;
  console.log('[PriceFeedContext] Shared worker registered:', worker ? 'yes' : 'no');
}

export function PriceFeedProvider({ children }: { children: ReactNode }) {
  const priceFeed = useHypePriceFeed();
  const lastSentPriceRef = useRef<number>(0);
  
  // Send price updates to the shared worker even when TradingChart is unmounted
  // This ensures continuous real price data collection during page navigation
  useEffect(() => {
    if (priceFeed.currentPrice > 0 && sharedPriceWorkerRef) {
      // Only send if price actually changed (avoid spam)
      if (priceFeed.currentPrice !== lastSentPriceRef.current) {
        sharedPriceWorkerRef.postMessage({
          type: 'PRICE_UPDATE',
          data: { price: priceFeed.currentPrice }
        });
        lastSentPriceRef.current = priceFeed.currentPrice;
      }
    }
  }, [priceFeed.currentPrice]);

  return (
    <PriceFeedContext.Provider value={priceFeed}>
      {children}
    </PriceFeedContext.Provider>
  );
}

export function usePriceFeed() {
  const context = useContext(PriceFeedContext);
  if (context === undefined) {
    throw new Error('usePriceFeed must be used within a PriceFeedProvider');
  }
  return context;
}


