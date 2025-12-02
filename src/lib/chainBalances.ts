import { ethers } from 'ethers';

const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)"
];

// RPC URLs for different chains
const CHAIN_RPC_URLS: Record<number, string> = {
  1: 'https://eth.llamarpc.com', // Ethereum
  42161: 'https://arb1.arbitrum.io/rpc', // Arbitrum
  999: 'https://rpc.hyperliquid.xyz/evm', // HyperEVM
};

/**
 * Get token balance on any chain
 * @param chainId - Chain ID (1 = Ethereum, 42161 = Arbitrum, 999 = HyperEVM)
 * @param userAddress - User's wallet address
 * @param tokenAddress - Token contract address (0x0... for native token)
 * @returns Formatted balance string
 */
export async function getChainBalance(
  chainId: number,
  userAddress: string,
  tokenAddress: string = '0x0000000000000000000000000000000000000000'
): Promise<string> {
  try {
    const rpcUrl = CHAIN_RPC_URLS[chainId];
    if (!rpcUrl) {
      console.error(`No RPC URL configured for chain ${chainId}`);
      return '0.00';
    }

    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);

    // Check if it's native token (ETH, ARB, HYPE)
    if (tokenAddress === '0x0000000000000000000000000000000000000000') {
      const balance = await provider.getBalance(userAddress);
      // Return full precision for display
      return ethers.utils.formatEther(balance);
    }

    // ERC20 token
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    
    const [balance, decimals] = await Promise.all([
      tokenContract.balanceOf(userAddress),
      tokenContract.decimals()
    ]);

    const formatted = ethers.utils.formatUnits(balance, decimals);
    // Return full precision for display
    return formatted;
  } catch (error) {
    console.error(`Failed to fetch balance on chain ${chainId}:`, error);
    return '0.00';
  }
}

/**
 * Get multiple token balances on a chain
 * @param chainId - Chain ID
 * @param userAddress - User's wallet address  
 * @param tokenAddresses - Array of token contract addresses
 * @returns Map of token address to balance
 */
export async function getMultipleBalances(
  chainId: number,
  userAddress: string,
  tokenAddresses: string[]
): Promise<Record<string, string>> {
  const balances: Record<string, string> = {};
  
  await Promise.all(
    tokenAddresses.map(async (tokenAddress) => {
      const balance = await getChainBalance(chainId, userAddress, tokenAddress);
      balances[tokenAddress] = balance;
    })
  );

  return balances;
}
