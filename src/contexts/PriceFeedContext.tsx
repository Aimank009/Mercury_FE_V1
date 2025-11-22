import React, { createContext, useContext, ReactNode } from 'react';
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

export function PriceFeedProvider({ children }: { children: ReactNode }) {
  const priceFeed = useHypePriceFeed();

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


