import '../styles/globals.css';
import '@rainbow-me/rainbowkit/styles.css';
import type { AppProps } from 'next/app';
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

// Set up error handlers IMMEDIATELY (before any component renders)
if (typeof window !== 'undefined') {
  // Handle unhandled promise rejections (from Coinbase SDK analytics)
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const errorMessage = reason?.message || reason?.toString() || '';
    const errorString = String(reason || '');
    
    // Silently ignore Coinbase analytics errors
    if (
      errorMessage.includes('cca-lite.coinbase.com') ||
      errorMessage.includes('ERR_BLOCKED_BY_CLIENT') ||
      errorMessage.includes('net::ERR_BLOCKED_BY_CLIENT') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('Analytics SDK') ||
      errorMessage.includes('AnalyticsSDKApiError') ||
      errorString.includes('cca-lite.coinbase.com') ||
      errorString.includes('ERR_BLOCKED_BY_CLIENT') ||
      errorString.includes('Failed to fetch') ||
      errorString.includes('Analytics SDK')
    ) {
      event.preventDefault(); // Prevent the error from crashing the app
      return;
    }
  };

  // Handle global errors
  const handleError = (event: ErrorEvent) => {
    const message = event.message || '';
    const filename = event.filename || '';
    const error = event.error;
    const errorMessage = error?.message || '';
    const errorString = String(error || '');
    
    // Silently ignore Coinbase analytics errors
    if (
      message.includes('cca-lite.coinbase.com') ||
      message.includes('ERR_BLOCKED_BY_CLIENT') ||
      message.includes('net::ERR_BLOCKED_BY_CLIENT') ||
      message.includes('Failed to fetch') ||
      message.includes('Analytics SDK') ||
      message.includes('AnalyticsSDKApiError') ||
      filename.includes('cca-lite.coinbase.com') ||
      errorMessage.includes('cca-lite.coinbase.com') ||
      errorMessage.includes('ERR_BLOCKED_BY_CLIENT') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('Analytics SDK') ||
      errorString.includes('cca-lite.coinbase.com') ||
      errorString.includes('Failed to fetch')
    ) {
      event.preventDefault(); // Prevent the error from crashing the app
      return;
    }
  };

  // Add event listeners immediately
  window.addEventListener('unhandledrejection', handleUnhandledRejection);
  window.addEventListener('error', handleError);
}

function MyApp({ Component, pageProps }: AppProps) {
  // Suppress WalletConnect, Reown, and Coinbase analytics errors in console
  useEffect(() => {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleLog = console.log;

    console.error = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      // Filter out WalletConnect/Reown/Coinbase analytics noise
      if (
        message.includes('WalletConnect Core is already initialized') ||
        message.includes('Failed to fetch remote project configuration') ||
        message.includes('Reown Config') ||
        message.includes('cca-lite.coinbase.com') ||
        message.includes('ERR_BLOCKED_BY_CLIENT') ||
        message.includes('net::ERR_BLOCKED_BY_CLIENT') ||
        message.includes('Analytics SDK') ||
        message.includes('AnalyticsSDKApiError') ||
        message.includes('Failed to fetch')
      ) {
        return;
      }
      originalConsoleError(...args);
    };

    console.warn = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      if (
        message.includes('WalletConnect') ||
        message.includes('Reown') ||
        message.includes('cca-lite.coinbase.com') ||
        message.includes('ERR_BLOCKED_BY_CLIENT') ||
        message.includes('Analytics SDK')
      ) {
        return;
      }
      originalConsoleWarn(...args);
    };

    console.log = (...args: any[]) => {
      const message = args[0]?.toString() || '';
      if (
        message.includes('WalletConnect Core is already initialized') ||
        message.includes('Reown Config') ||
        message.includes('cca-lite.coinbase.com') ||
        message.includes('Analytics SDK')
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
    <div>
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