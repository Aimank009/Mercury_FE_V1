import '../styles/globals.css';
import '@rainbow-me/rainbowkit/styles.css';
import type { AppProps } from 'next/app';
import { GeistMono } from 'geist/font/mono';
import { useEffect } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import { PriceFeedProvider } from '../contexts/PriceFeedContext';
import { SessionTradingProvider } from '../contexts/SessionTradingContext';
import { DepositWithdrawProvider } from '../contexts/DepositWithdrawContext';
// import { SupabaseDiagnostics } from '../components/SupabaseDiagnostics';

import { config } from '../wagmi';

const client = new QueryClient({
  defaultOptions: {
    queries: {
      // Reduce refetch frequency to avoid rate limits
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: 30_000, // Consider data fresh for 30 seconds
      gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes (formerly cacheTime)
    },
  },
});

function MyApp({ Component, pageProps }: AppProps) {
  // Suppress WalletConnect and Reown warnings
  useEffect(() => {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;

    console.error = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      // Filter out WalletConnect/Reown noise
      if (
        message.includes('WalletConnect Core is already initialized') ||
        message.includes('Failed to fetch remote project configuration') ||
        message.includes('Reown Config')
      ) {
        return;
      }
      originalConsoleError(...args);
    };

    console.warn = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      if (
        message.includes('WalletConnect') ||
        message.includes('Reown')
      ) {
        return;
      }
      originalConsoleWarn(...args);
    };

    console.log = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      if (
        message.includes('WalletConnect Core is already initialized') ||
        message.includes('Reown Config')
      ) {
        return;
      }
      originalConsoleLog(...args);
    };

    return () => {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.log = originalConsoleLog;
    };
  }, []);
  return (
    <div style={{ fontFamily: GeistMono.style.fontFamily }}>
      <style jsx global>{`
        :root {
          --font-geist-mono: ${GeistMono.style.fontFamily};
        }
      `}</style>
      <WagmiProvider config={config}>
        <QueryClientProvider client={client}>
          <RainbowKitProvider>
            <PriceFeedProvider>
              <SessionTradingProvider>
                <DepositWithdrawProvider>
                  <Component {...pageProps} />
                  {/* <SupabaseDiagnostics /> - Disabled, Supabase is working */}
                </DepositWithdrawProvider>
              </SessionTradingProvider>
            </PriceFeedProvider>
          </RainbowKitProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </div>
  );
}

export default MyApp;
