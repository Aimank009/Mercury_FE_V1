import { ethers } from 'ethers';

const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

// RPC URLs for different chains - used as fallback only
// Using multiple fallbacks for better reliability
const CHAIN_RPC_URLS: Record<number, string[]> = {
  1: [ // Ethereum
    'https://cloudflare-eth.com',
    'https://rpc.ankr.com/eth',
    'https://eth.llamarpc.com'
  ],
  42161: [ // Arbitrum
    'https://arbitrum.llamarpc.com',
    'https://rpc.ankr.com/arbitrum',
    'https://arb1.arbitrum.io/rpc'
  ],
  999: [ // HyperEVM
    'https://rpc.hyperliquid.xyz/evm'
  ],
};

/**
 * Get token balance on any chain
 * @param chainId - Chain ID (1 = Ethereum, 42161 = Arbitrum, 999 = HyperEVM)
 * @param userAddress - User's wallet address
 * @param tokenAddress - Token contract address (0x0... for native token)
 * @param walletProvider - Optional wallet provider (preferred over public RPC)
 * @returns Formatted balance string
 */
async function tryWithProvider(
  provider: ethers.providers.Provider,
  userAddress: string,
  tokenAddress: string
): Promise<string> {
  // Check if it's native token (ETH, ARB, HYPE)
  if (tokenAddress === '0x0000000000000000000000000000000000000000') {
    const balance = await provider.getBalance(userAddress);
    return ethers.utils.formatEther(balance);
  }

  // ERC20 token
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  
  const [balance, decimals] = await Promise.all([
    tokenContract.balanceOf(userAddress),
    tokenContract.decimals()
  ]);

  return ethers.utils.formatUnits(balance, decimals);
}

export async function getChainBalance(
  chainId: number,
  userAddress: string,
  tokenAddress: string = '0x0000000000000000000000000000000000000000',
  walletProvider?: ethers.providers.Provider
): Promise<string> {
  const tokenType = tokenAddress === '0x0000000000000000000000000000000000000000' ? 'native' : 'ERC20';
  console.log(`[Balance] Fetching ${tokenType} balance on chain ${chainId} for ${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`);
  
  // Try with wallet provider first if available and on correct chain
  if (walletProvider) {
    try {
      console.log('[Balance] Using wallet provider...');
      const network = await walletProvider.getNetwork();
      if (network.chainId === chainId) {
        const balance = await tryWithProvider(walletProvider, userAddress, tokenAddress);
        console.log(`[Balance] ✅ Success with wallet provider: ${balance}`);
        return balance;
      } else {
        console.log(`[Balance] ⚠️ Wallet on chain ${network.chainId}, need chain ${chainId}, falling back to RPC`);
      }
    } catch (error) {
      console.warn('[Balance] Failed to use wallet provider, falling back to public RPC:', error);
    }
  } else {
    console.log('[Balance] No wallet provider, using public RPC');
  }

  // Fallback to public RPC endpoints
  const rpcUrls = CHAIN_RPC_URLS[chainId];
  if (!rpcUrls || rpcUrls.length === 0) {
    console.error(`[Balance] ❌ No RPC URL configured for chain ${chainId}`);
    return '0.00';
  }

  // Try each RPC URL until one succeeds
  const errors: any[] = [];
  for (let i = 0; i < rpcUrls.length; i++) {
    const rpcUrl = rpcUrls[i];
    try {
      console.log(`[Balance] Trying RPC ${i + 1}/${rpcUrls.length}: ${rpcUrl}`);
      const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
      const balance = await tryWithProvider(provider, userAddress, tokenAddress);
      console.log(`[Balance] ✅ Success with RPC: ${balance}`);
      return balance;
    } catch (error) {
      errors.push({ rpcUrl, error });
      console.warn(`[Balance] ❌ Failed with ${rpcUrl}:`, error);
    }
  }

  // All RPCs failed
  console.error(`[Balance] ❌ All ${rpcUrls.length} RPC endpoints failed for chain ${chainId}`);
  return '0.00';
}

/**
 * Get multiple token balances on a chain
 * @param chainId - Chain ID
 * @param userAddress - User's wallet address  
 * @param tokenAddresses - Array of token contract addresses
 * @param walletProvider - Optional wallet provider (preferred over public RPC)
 * @returns Map of token address to balance
 */
export async function getMultipleBalances(
  chainId: number,
  userAddress: string,
  tokenAddresses: string[],
  walletProvider?: ethers.providers.Provider
): Promise<Record<string, string>> {
  const balances: Record<string, string> = {};
  
  await Promise.all(
    tokenAddresses.map(async (tokenAddress) => {
      const balance = await getChainBalance(chainId, userAddress, tokenAddress, walletProvider);
      balances[tokenAddress] = balance;
    })
  );

  return balances;
}
