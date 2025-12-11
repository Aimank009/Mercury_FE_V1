import { useQuery } from '@tanstack/react-query';

export interface LifiToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  chainId: number;
  coinKey?: string;
  logoURI?: string;
  priceUSD?: string;
  marketCapUSD?: number;
  volumeUSD24H?: number;
}

export interface LifiChain {
  id: number;
  key: string;
  name: string;
  chainType: string;
  coin: string;
  mainnet: boolean;
  logoURI?: string;
  nativeToken: LifiToken;
}

const LIFI_API_URL = 'https://li.quest/v1';

// Fetch all supported chains
async function fetchChains(): Promise<LifiChain[]> {
  const response = await fetch(`${LIFI_API_URL}/chains`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch chains from LI.FI');
  }
  
  const data = await response.json();
  return data.chains || [];
}

// Fetch ALL tokens (returns tokens grouped by chainId)
async function fetchAllTokens(): Promise<Record<number, LifiToken[]>> {
  const response = await fetch(`${LIFI_API_URL}/tokens`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch tokens from LI.FI');
  }
  
  const data = await response.json();
  return data.tokens || {};
}

// Fetch tokens for specific chain(s)
async function fetchTokensByChain(chainIds: number[]): Promise<Record<number, LifiToken[]>> {
  const chainsParam = chainIds.join(',');
  const response = await fetch(`${LIFI_API_URL}/tokens?chains=${chainsParam}`);
  
  if (!response.ok) {
    throw new Error('Failed to fetch tokens from LI.FI');
  }
  
  const data = await response.json();
  return data.tokens || {};
}

// Hook to get all chains
export function useLifiChains(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  
  return useQuery<LifiChain[]>({
    queryKey: ['lifi-chains'],
    queryFn: fetchChains,
    enabled,
    staleTime: 30 * 60 * 1000, // 30 minutes (chains don't change often)
    gcTime: 60 * 60 * 1000, // 1 hour cache
  });
}

// Hook to get ALL tokens across all chains
export function useLifiAllTokens(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  
  return useQuery<Record<number, LifiToken[]>>({
    queryKey: ['lifi-all-tokens'],
    queryFn: fetchAllTokens,
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000,
  });
}

// Hook to get tokens for a specific chain
export function useLifiTokensByChain(chainId?: number, options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  
  return useQuery<LifiToken[]>({
    queryKey: ['lifi-tokens', chainId],
    queryFn: async () => {
      if (!chainId) return [];
      const tokensMap = await fetchTokensByChain([chainId]);
      return tokensMap[chainId] || [];
    },
    enabled: enabled && !!chainId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

// Hook to get chains with their tokens combined
export function useLifiChainsWithTokens(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  
  return useQuery<(LifiChain & { tokens: LifiToken[] })[]>({
    queryKey: ['lifi-chains-with-tokens'],
    queryFn: async () => {
      const [chains, allTokens] = await Promise.all([
        fetchChains(),
        fetchAllTokens(),
      ]);
      
      return chains.map((chain) => ({
        ...chain,
        tokens: allTokens[chain.id] || [],
      }));
    },
    enabled,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

// Utility: Filter popular/common tokens
export function filterPopularTokens(tokens: LifiToken[]): LifiToken[] {
  const popularSymbols = [
    'USDC', 'USDT', 'ETH', 'WETH', 'DAI', 'WBTC', 
    'BNB', 'WBNB', 'MATIC', 'WMATIC', 'AVAX', 'WAVAX',
    'ARB', 'OP', 'SOL', 'LINK', 'UNI', 'AAVE'
  ];
  return tokens.filter((token) =>
    popularSymbols.includes(token.symbol.toUpperCase())
  );
}

// Utility: Search tokens by name or symbol
export function searchTokens(tokens: LifiToken[], query: string): LifiToken[] {
  if (!query.trim()) return tokens;
  const lowerQuery = query.toLowerCase();
  return tokens.filter(
    (token) =>
      token.symbol.toLowerCase().includes(lowerQuery) ||
      token.name.toLowerCase().includes(lowerQuery) ||
      token.address.toLowerCase().includes(lowerQuery)
  );
}

// Utility: Sort tokens by USD value (if available)
export function sortTokensByValue(tokens: LifiToken[]): LifiToken[] {
  return [...tokens].sort((a, b) => {
    const aPrice = parseFloat(a.priceUSD || '0');
    const bPrice = parseFloat(b.priceUSD || '0');
    const aMarketCap = a.marketCapUSD || 0;
    const bMarketCap = b.marketCapUSD || 0;
    // Sort by market cap first, then by price
    if (aMarketCap !== bMarketCap) return bMarketCap - aMarketCap;
    return bPrice - aPrice;
  });
}

// Utility: Get native token for a chain
export function getNativeToken(chain: LifiChain): LifiToken {
  return chain.nativeToken;
}

// Utility: Find token by address
export function findTokenByAddress(tokens: LifiToken[], address: string): LifiToken | undefined {
  return tokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
}

// Utility: Find token by symbol
export function findTokenBySymbol(tokens: LifiToken[], symbol: string): LifiToken | undefined {
  return tokens.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase());
}
