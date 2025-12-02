/**
 * Deposit and Withdraw SDK
 * Handles deposits and withdrawals using the wrapper contract
 * 
 * Contract Addresses:
 * - Library: 0xd237C5D13b086bD4Ed5fe0F22b66fE608e5c6e02
 * - Chrono Grid: 0x19202F8F082c56888e4A7505B75896CA5cae3D6D
 * - Wrapper: 0x9F8954eB66236bccDfD4e8E24A5e1E3E392F7575
 */

import { ethers } from 'ethers';

export interface DepositWithdrawConfig {
  wrapperContractAddress: string;
  libraryContractAddress: string;
  chronoGridAddress: string;
  chainId: number;
  rpcUrl?: string;
}

export interface DepositParams {
  amount: string; // Amount in wei
  tokenAddress?: string; // Optional, defaults to native token
}

export interface WithdrawParams {
  amount: string; // Amount in wei
  tokenAddress?: string; // Optional, defaults to native token
}

export interface BalanceInfo {
  balance: string;
  balanceFormatted: string;
  tokenAddress?: string;
  tokenSymbol?: string;
}

export class DepositWithdrawSDK {
  private config: DepositWithdrawConfig;
  private provider: ethers.providers.Provider | null = null;
  private signer: ethers.Signer | null = null;
  private userAddress: string | null = null;
  private wrapperContract: ethers.Contract | null = null;

  // ABI for the wrapper contract (simplified for deposit/withdraw)
  private wrapperABI = [
    // Deposit function - takes amount in USDTO (6 decimals)
    "function deposit(uint256 _amount) external nonReentrant",
    
    // Withdraw function - takes amount in USDTO (6 decimals)
    "function withdraw(uint256 _amount) external nonReentrant",
    
    // Balance functions
    "function getBalance(address user) external view returns (uint256)",
    
    // Events
    "event Deposit(address indexed user, uint256 amount)",
    "event Withdraw(address indexed user, uint256 amount)"
  ];

  // ABI for ERC20 token (USDTO)
  private erc20ABI = [
    // Standard ERC20 functions
    "function balanceOf(address owner) external view returns (uint256)",
    "function transfer(address to, uint256 amount) external returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    
    // Token info
    "function name() external view returns (string)",
    "function symbol() external view returns (string)",
    "function decimals() external view returns (uint8)",
    
    // Events
    "event Transfer(address indexed from, address indexed to, uint256 value)",
    "event Approval(address indexed owner, address indexed spender, uint256 value)"
  ];

  // USDTO Token Configuration
  private USDTO_TOKEN = {
    address: '0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb',
    symbol: 'USDTO',
    decimals: 6
  };

  constructor(config: DepositWithdrawConfig) {
    this.config = {
      wrapperContractAddress: config.wrapperContractAddress,
      libraryContractAddress: config.libraryContractAddress,
      chronoGridAddress: config.chronoGridAddress,
      chainId: config.chainId,
      rpcUrl: config.rpcUrl
    };
  }

  /**
   * Connect to MetaMask and initialize the SDK
   */
  async connect(): Promise<{ address: string; chainId: number }> {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('MetaMask not installed');
    }

    // Use 'any' network to allow switching between chains without errors
    this.provider = new ethers.providers.Web3Provider(window.ethereum, 'any');
    
    // Request accounts
    const accounts = await (this.provider as any).send('eth_requestAccounts', []);
    
    if (!accounts || accounts.length === 0) {
      throw new Error('Please connect your wallet in MetaMask to continue.');
    }
    
    this.signer = (this.provider as any).getSigner(0);
    this.userAddress = await this.signer!.getAddress();

    // Get actual chain ID from wallet
    const network = await this.provider.getNetwork();
    const chainIdNum = network.chainId;
    
    console.log('✅ Connected to wallet:', {
      address: this.userAddress,
      actualChainId: chainIdNum,
      expectedChainId: this.config.chainId,
      chainName: network.name
    });

    // Only warn if not on HyperEVM, don't force switch
    if (chainIdNum !== this.config.chainId) {
      console.log(`ℹ️ Currently on chain ${chainIdNum}. HyperEVM deposits require chain ${this.config.chainId}.`);
    }

    // Initialize wrapper contract (will only work on HyperEVM)
    this.wrapperContract = new ethers.Contract(
      this.config.wrapperContractAddress,
      this.wrapperABI,
      this.signer!
    );

    // Return actual chain ID, not expected
    return { 
      address: this.userAddress, 
      chainId: chainIdNum
    };
  }

  /**
   * Check if connected to the correct network
   * Uses window.ethereum directly for most reliable check
   */
  async isOnCorrectNetwork(): Promise<boolean> {
    // Use window.ethereum directly for the most reliable chain check
    if (typeof window !== 'undefined' && window.ethereum) {
      try {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        const chainIdNum = parseInt(chainIdHex, 16);
        return chainIdNum === this.config.chainId;
      } catch (error) {
        console.error('Error checking network via window.ethereum:', error);
        return false;
      }
    }
    
    // Fallback to provider if window.ethereum not available
    if (!this.provider) return false;
    try {
      const currentChainId = await (this.provider as any).send('eth_chainId', []);
      const chainIdNum = parseInt(currentChainId, 16);
      return chainIdNum === this.config.chainId;
    } catch (error) {
      console.error('Error checking network:', error);
      return false;
    }
  }

  /**
   * Switch to the correct network
   */
  async switchToCorrectNetwork(): Promise<void> {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('MetaMask not installed');
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${this.config.chainId.toString(16)}` }],
      });
    } catch (error: any) {
      if (error.code === 4902) {
        // Chain doesn't exist, add HyperEVM to MetaMask
        console.log('Adding HyperEVM network to MetaMask...');
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: `0x${this.config.chainId.toString(16)}`, // 0x3e7 = 999
              chainName: 'HyperEVM',
              nativeCurrency: {
                name: 'HYPE',
                symbol: 'HYPE',
                decimals: 18,
              },
              rpcUrls: [this.config.rpcUrl || 'https://rpc.hyperliquid.xyz/evm'],
              blockExplorerUrls: ['https://explorer.hyperliquid.xyz/'],
            }],
          });
          console.log('HyperEVM network added successfully');
        } catch (addError: any) {
          console.error('Failed to add HyperEVM network:', addError);
          throw new Error(`Failed to add HyperEVM network. Please add it manually: Chain ID ${this.config.chainId}, RPC: ${this.config.rpcUrl}`);
        }
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if USDTO token is approved for the wrapper contract
   */
  async checkUSDTOApproval(): Promise<{ isApproved: boolean; allowance: string; allowanceFormatted: string }> {
    if (!this.signer || !this.userAddress) {
      console.log('Not connected, returning no approval');
      return {
        isApproved: false,
        allowance: '0',
        allowanceFormatted: '0'
      };
    }

    // Only check approval on HyperEVM network
    if (!(await this.isOnCorrectNetwork())) {
      console.log('Not on HyperEVM, skipping approval check');
      return {
        isApproved: false,
        allowance: '0',
        allowanceFormatted: '0'
      };
    }

    try {
      const tokenContract = new ethers.Contract(
        this.USDTO_TOKEN.address,
        this.erc20ABI,
        this.signer
      );

      const allowance = await tokenContract.allowance(this.userAddress, this.config.wrapperContractAddress);
      const allowanceFormatted = ethers.utils.formatUnits(allowance, this.USDTO_TOKEN.decimals);
      
      return {
        isApproved: allowance.gt(0),
        allowance: allowance.toString(),
        allowanceFormatted
      };
    } catch (error: any) {
      console.error('Failed to check USDTO approval:', error);
      // Return no approval instead of throwing - likely wrong network
      return {
        isApproved: false,
        allowance: '0',
        allowanceFormatted: '0'
      };
    }
  }

  /**
   * Approve USDTO token for the wrapper contract
   */
  async approveUSDTO(amount?: string): Promise<{ txHash: string; amount: string }> {
    if (!this.signer || !this.userAddress) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Approval requires HyperEVM network
    if (!(await this.isOnCorrectNetwork())) {
      throw new Error('Please switch to HyperEVM network to approve tokens.');
    }

    try {
      console.log('Approving USDTO token:', {
        tokenAddress: this.USDTO_TOKEN.address,
        wrapperAddress: this.config.wrapperContractAddress,
        userAddress: this.userAddress,
        decimals: this.USDTO_TOKEN.decimals
      });

      const tokenContract = new ethers.Contract(
        this.USDTO_TOKEN.address,
        this.erc20ABI,
        this.signer
      );

      // Use max approval if no amount specified
      const approvalAmount = amount ? 
        ethers.utils.parseUnits(amount, this.USDTO_TOKEN.decimals) : 
        ethers.constants.MaxUint256;

      console.log('Approval amount:', {
        raw: approvalAmount.toString(),
        formatted: amount ? amount : 'MaxUint256 (unlimited)'
      });

      const tx = await tokenContract.approve(this.config.wrapperContractAddress, approvalAmount);
      console.log('Approval transaction submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('Approval transaction confirmed:', receipt.transactionHash);

      return {
        txHash: receipt.transactionHash,
        amount: approvalAmount.toString()
      };
    } catch (error: any) {
      console.error('USDTO approval failed:', error);
      throw new Error(`Approval failed: ${error.message}`);
    }
  }

  /**
   * Deposit USDTO token with retry logic for rate limiting
   * Note: For cross-chain deposits, use the LiFi bridge instead of this method
   */
  async depositUSDTO(amount: string): Promise<{ txHash: string; amount: string }> {
    if (!this.signer || !this.wrapperContract) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Direct deposits require HyperEVM network
    // Cross-chain deposits should use the LiFi bridge (handled in DepositWithdrawModal)
    if (!(await this.isOnCorrectNetwork())) {
      throw new Error('Please switch to HyperEVM network for direct deposits, or use a supported chain for bridge deposits.');
    }

    const maxRetries = 3;
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const weiAmount = ethers.utils.parseUnits(amount, this.USDTO_TOKEN.decimals);
        
        console.log(`Deposit attempt ${attempt + 1}/${maxRetries}:`, {
          amount: amount,
          weiAmount: weiAmount.toString(),
          wrapperAddress: this.config.wrapperContractAddress,
          userAddress: this.userAddress,
          decimals: this.USDTO_TOKEN.decimals
        });

        // Check user's USDTO balance
        const tokenContract = new ethers.Contract(
          this.USDTO_TOKEN.address,
          this.erc20ABI,
          this.signer
        );
        
        const userBalance = await tokenContract.balanceOf(this.userAddress);
        console.log('User USDTO balance:', ethers.utils.formatUnits(userBalance, this.USDTO_TOKEN.decimals));
        
        if (userBalance.lt(weiAmount)) {
          throw new Error(`Insufficient USDTO balance`);
        }

        // Check if we have enough allowance
        const allowance = await tokenContract.allowance(this.userAddress, this.config.wrapperContractAddress);
        console.log('Current USDTO allowance:', ethers.utils.formatUnits(allowance, this.USDTO_TOKEN.decimals));
        
        if (allowance.lt(weiAmount)) {
          throw new Error(`Insufficient USDTO approval. Please approve USDTO first. Current allowance: ${ethers.utils.formatUnits(allowance, this.USDTO_TOKEN.decimals)} USDTO, required: ${amount} USDTO.`);
        }

        // Call deposit on the wrapper contract (it will pull the tokens via transferFrom)
        console.log('Calling deposit on wrapper contract (will use transferFrom)...');
        const gasEstimate = await this.wrapperContract.estimateGas.deposit(weiAmount).catch((gasError: any) => {
          console.error('Gas estimation failed:', gasError);
          console.error('Full error:', gasError);
          throw gasError;
        });

        console.log('Gas estimate for deposit:', gasEstimate.toString());

        const depositTx = await this.wrapperContract.deposit(weiAmount, {
          gasLimit: gasEstimate.mul(120).div(100) // Add 20% buffer
        });

        console.log('USDTO deposit transaction submitted:', depositTx.hash);
        const depositReceipt = await depositTx.wait();
        console.log('USDTO deposit transaction confirmed:', depositReceipt.transactionHash);

        return {
          txHash: depositReceipt.transactionHash,
          amount: weiAmount.toString()
        };
      } catch (error: any) {
        lastError = error;
        
        // Check if it's a rate limit error
        const isRateLimit = error.message?.toLowerCase().includes('rate limit') || 
                           error.message?.toLowerCase().includes('too many requests') ||
                           error.code === 429;
        
        if (isRateLimit && attempt < maxRetries - 1) {
          const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff: 1s, 2s, 4s
          console.log(`⏳ Rate limited. Retrying in ${waitTime/1000}s... (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        // If not rate limit or last attempt, throw the error
        break;
      }
    }

    // If we get here, all retries failed
    console.error('USDTO deposit failed after all retries:', lastError);
    
    // Provide more specific error messages
    if (lastError.message.includes('Insufficient USDTO approval')) {
      throw lastError; // Re-throw our custom error
    } else if (lastError.message?.toLowerCase().includes('rate limit')) {
      throw new Error('RPC rate limited. The public Hyperliquid RPC is busy. Please wait a moment and try again.');
    } else if (lastError.message.includes('execution reverted')) {
      throw new Error('Transaction reverted. Please check: 1) You have approved USDTO tokens (click "Debug Contract" to check approval), 2) Sufficient USDTO balance, 3) Contract is operational.');
    } else if (lastError.message.includes('UNPREDICTABLE_GAS_LIMIT')) {
      throw new Error('Cannot estimate gas. The transaction will likely fail. Please: 1) Approve USDTO tokens first (click "Debug Contract" button), 2) Verify sufficient balance, 3) Check contract compatibility.');
    } else if (lastError.code === 'CALL_EXCEPTION') {
      throw new Error('Contract call failed. Most likely cause: USDTO tokens not approved. Please click "Debug Contract" button to check approval status, then approve USDTO if needed.');
    } else {
      throw new Error(`${lastError.message}`);
    }
  }

  /**
   * Deposit native token (ETH/HYPE) - DEPRECATED, use depositUSDTO instead
   */
  async deposit(params: DepositParams): Promise<{ txHash: string; amount: string }> {
    // Force USDTO token usage
    return this.depositUSDTO(ethers.utils.formatEther(params.amount));
  }

  /**
   * Withdraw USDTO token
   */
  async withdrawUSDTO(amount: string): Promise<{ txHash: string; amount: string }> {
    if (!this.signer || !this.wrapperContract) {
      throw new Error('Not connected. Call connect() first.');
    }

    // Withdrawals require HyperEVM network
    if (!(await this.isOnCorrectNetwork())) {
      throw new Error('Please switch to HyperEVM network to withdraw.');
    }

    try {
      const weiAmount = ethers.utils.parseUnits(amount, this.USDTO_TOKEN.decimals);
      
      console.log('Withdraw attempt:', {
        amount: amount,
        weiAmount: weiAmount.toString(),
        wrapperAddress: this.config.wrapperContractAddress,
        userAddress: this.userAddress,
        decimals: this.USDTO_TOKEN.decimals
      });

      // Check wrapper balance
      const wrapperBalance = await this.wrapperContract.getBalance(this.userAddress);
      console.log('Wrapper balance:', ethers.utils.formatUnits(wrapperBalance, this.USDTO_TOKEN.decimals));
      
      if (wrapperBalance.lt(weiAmount)) {
        throw new Error(`Insufficient wrapper balance. You have ${ethers.utils.formatUnits(wrapperBalance, this.USDTO_TOKEN.decimals)} USDTO in wrapper, trying to withdraw ${amount} USDTO.`);
      }

      // Call withdraw on the wrapper contract
      const gasEstimate = await this.wrapperContract.estimateGas.withdraw(weiAmount).catch((gasError: any) => {
        console.error('Gas estimation failed:', gasError);
        return ethers.BigNumber.from(100000);
      });

      console.log('Gas estimate for withdraw:', gasEstimate.toString());

      const tx = await this.wrapperContract.withdraw(weiAmount, {
        gasLimit: gasEstimate.mul(120).div(100) // Add 20% buffer
      });

      console.log('USDTO withdraw transaction submitted:', tx.hash);
      const receipt = await tx.wait();
      console.log('USDTO withdraw transaction confirmed:', receipt.transactionHash);

      return {
        txHash: receipt.transactionHash,
        amount: weiAmount.toString()
      };
    } catch (error: any) {
      console.error('USDTO withdraw failed:', error);
      throw new Error(`USDTO withdraw failed: ${error.message}`);
    }
  }

  /**
   * Withdraw native token (ETH/HYPE) - DEPRECATED, use withdrawUSDTO instead
   */
  async withdraw(params: WithdrawParams): Promise<{ txHash: string; amount: string }> {
    // Force USDTO token usage
    return this.withdrawUSDTO(ethers.utils.formatEther(params.amount));
  }

  /**
   * Get user's USDTO balance in the wrapper contract
   */
  async getUSDTOBalance(): Promise<BalanceInfo> {
    if (!this.wrapperContract || !this.userAddress) {
      console.log('Not connected, returning zero balance');
      return {
        balance: '0',
        balanceFormatted: '0.00',
        tokenSymbol: 'USDTO'
      };
    }

    // Only check balance on HyperEVM network
    if (!(await this.isOnCorrectNetwork())) {
      console.log('Not on HyperEVM, returning zero balance');
      return {
        balance: '0',
        balanceFormatted: '0.00',
        tokenSymbol: 'USDTO'
      };
    }

    try {
      const balance = await this.wrapperContract.getBalance(this.userAddress);
      const balanceFormatted = ethers.utils.formatUnits(balance, this.USDTO_TOKEN.decimals);

      return {
        balance: balance.toString(),
        balanceFormatted,
        tokenAddress: this.USDTO_TOKEN.address,
        tokenSymbol: this.USDTO_TOKEN.symbol
      };
    } catch (error: any) {
      console.error('Failed to get USDTO balance:', error);
      // Return zero instead of throwing - likely wrong network
      return {
        balance: '0',
        balanceFormatted: '0.00',
        tokenSymbol: 'USDTO'
      };
    }
  }

  /**
   * Get user's balance in the wrapper contract
   */
  async getBalance(tokenAddress?: string): Promise<BalanceInfo> {
    // Force USDTO token usage
    return this.getUSDTOBalance();
  }

  /**
   * Get user's USDTO balance in wallet
   */
  async getUSDTOWalletBalance(): Promise<BalanceInfo> {
    if (!this.signer || !this.userAddress || !this.provider) {
      console.log('Not connected, returning zero wallet balance');
      return {
        balance: '0',
        balanceFormatted: '0.00',
        tokenSymbol: 'USDTO'
      };
    }

    // Only check wallet balance on HyperEVM network
    if (!(await this.isOnCorrectNetwork())) {
      console.log('Not on HyperEVM, returning zero wallet balance');
      return {
        balance: '0',
        balanceFormatted: '0.00',
        tokenSymbol: 'USDTO'
      };
    }

    try {
      const tokenContract = new ethers.Contract(
        this.USDTO_TOKEN.address,
        this.erc20ABI,
        this.provider!
      );

      const balance = await tokenContract.balanceOf(this.userAddress);
      const balanceFormatted = ethers.utils.formatUnits(balance, this.USDTO_TOKEN.decimals);

      return {
        balance: balance.toString(),
        balanceFormatted,
        tokenAddress: this.USDTO_TOKEN.address,
        tokenSymbol: this.USDTO_TOKEN.symbol
      };
    } catch (error: any) {
      console.error('Failed to get USDTO wallet balance:', error);
      // Return zero instead of throwing - likely wrong network
      return {
        balance: '0',
        balanceFormatted: '0.00',
        tokenSymbol: 'USDTO'
      };
    }
  }

  /**
   * Get user's native wallet balance
   */
  async getWalletBalance(): Promise<BalanceInfo> {
    // Force USDTO token usage
    return this.getUSDTOWalletBalance();
  }

  /**
   * Format amount to wei
   */
  static formatToWei(amount: string): string {
    return ethers.utils.parseEther(amount).toString();
  }

  /**
   * Format amount from wei
   */
  static formatFromWei(amount: string): string {
    return ethers.utils.formatEther(amount);
  }

  /**
   * Test contract interaction and get contract info
   */
  async testContractInteraction(): Promise<{
    wrapperContractExists: boolean;
    tokenContractExists: boolean;
    wrapperSupportsDepositToken: boolean;
    tokenSymbol: string;
    tokenDecimals: number;
    userTokenBalance: string;
    userApproval: string;
    tokenAddress: string;
    wrapperAddress: string;
    rpcUrl: string;
  }> {
    if (!this.signer || !this.userAddress) {
      throw new Error('Not connected. Call connect() first.');
    }

    try {
      // Test wrapper contract
      const wrapperCode = await this.provider!.getCode(this.config.wrapperContractAddress);
      const wrapperContractExists = wrapperCode !== '0x';

      // Test token contract
      const tokenContract = new ethers.Contract(
        this.USDTO_TOKEN.address,
        this.erc20ABI,
        this.provider!
      );

      const tokenCode = await this.provider!.getCode(this.USDTO_TOKEN.address);
      const tokenContractExists = tokenCode !== '0x';

      // Get token info
      const [tokenSymbol, tokenDecimals, userTokenBalance] = await Promise.all([
        tokenContract.symbol().catch(() => 'Unknown'),
        tokenContract.decimals().catch(() => 18),
        tokenContract.balanceOf(this.userAddress).catch(() => ethers.BigNumber.from(0))
      ]);

      // Test if wrapper supports deposit
      let wrapperSupportsDepositToken = false;
      try {
        await this.wrapperContract!.estimateGas.deposit(
          ethers.BigNumber.from(1)
        );
        wrapperSupportsDepositToken = true;
      } catch (e) {
        console.log('Wrapper does not support deposit method');
      }

      // Get approval amount
      const approval = await this.checkUSDTOApproval().catch(() => ({ allowanceFormatted: '0' }));

      return {
        wrapperContractExists,
        tokenContractExists,
        wrapperSupportsDepositToken,
        tokenSymbol,
        tokenDecimals,
        userTokenBalance: ethers.utils.formatUnits(userTokenBalance, tokenDecimals),
        userApproval: approval.allowanceFormatted,
        tokenAddress: this.USDTO_TOKEN.address,
        wrapperAddress: this.config.wrapperContractAddress,
        rpcUrl: this.config.rpcUrl || 'https://rpc.hyperliquid.xyz/evm'
      };
    } catch (error: any) {
      console.error('Contract interaction test failed:', error);
      throw new Error(`Contract test failed: ${error.message}`);
    }
  }

  /**
   * Get contract addresses
   */
  getContractAddresses() {
    return {
      wrapper: this.config.wrapperContractAddress,
      library: this.config.libraryContractAddress,
      chronoGrid: this.config.chronoGridAddress
    };
  }
}
