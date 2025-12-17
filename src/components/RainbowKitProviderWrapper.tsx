'use client';

import { useEffect, useState } from 'react';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';

interface RainbowKitProviderWrapperProps {
  children: React.ReactNode;
}

export function RainbowKitProviderWrapper({ children }: RainbowKitProviderWrapperProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Don't render RainbowKitProvider during SSR
  if (!isMounted) {
    return <>{children}</>;
  }

  return <RainbowKitProvider>{children}</RainbowKitProvider>;
}

