import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  arbitrum,
  base,
  mainnet,
  optimism,
  polygon,
  sepolia,
  bsc,
  opBNB,
} from 'wagmi/chains';
import { Chain } from 'wagmi/chains';
import { http } from 'wagmi';

// Define HypeEVM chain
const hypeEVM: Chain = {
  id: 999,
  name: 'HypeEVM',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.hyperliquid.xyz/evm'],
    },
    public: {
      http: ['https://rpc.hyperliquid.xyz/evm'],
    },
  },
  blockExplorers: {
    default: { 
      name: 'HypeEVM Explorer', 
      url: 'https://explorer.hyperliquid.xyz' 
    },
  },
  testnet: false,
};

export const config = getDefaultConfig({
  appName: 'Mercury Trade',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'c1f527b9e2a8e5c3f3d9b8a7c6e5f4d3', 
  chains: [
    hypeEVM, // HypeEVM as primary chain
    mainnet,
    polygon,
    optimism,
    arbitrum,
    base,
    bsc,
    opBNB,
    ...(process.env.NEXT_PUBLIC_ENABLE_TESTNETS === 'true' ? [sepolia] : []),
  ],
  ssr: false, // Disable SSR to prevent localStorage errors
  // Reduce polling frequency to avoid rate limits
  pollingInterval: 30_000, // Poll every 30 seconds instead of default 4 seconds
});
