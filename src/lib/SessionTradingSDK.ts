/**
 * Session Trading SDK
 * Handles session key creation and one-click trading
 * 
 * Usage:
 * import { SessionTradingSDK } from './SessionTradingSDK';
 * 
 * const sdk = new SessionTradingSDK({
 *   relayerUrl: 'http://localhost:8080',
 *   wrapperContractAddress: '0x...',
 *   chainId: 1
 * });
 * 
 * await sdk.connect();
 * await sdk.createSession();
 * await sdk.placeBet({ timeperiodId: 1, priceMin: 1000, priceMax: 2000, amount: 100 });
 */

import { ethers } from 'ethers';
import { log } from 'node:console';
import { STORAGE_KEYS } from '../config';

// Contract ABI for getNonce function
const WRAPPER_ABI = [
    {
        "inputs": [
            {
                "internalType": "address",
                "name": "_user",
                "type": "address"
            }
        ],
        "name": "getNonce",
        "outputs": [
            {
                "internalType": "uint256",
                "name": "",
                "type": "uint256"
            }
        ],
        "stateMutability": "view",
        "type": "function"
    }
];

export interface SessionTradingConfig {
    relayerUrl?: string;
    wrapperContractAddress: string;
    chainId?: number;
    sessionDuration?: number;
}

export interface SessionInfo {
    user: string;
    sessionKey: string;
    sessionPrivateKey: string;
    expiry: number;
    delegationNonce: number;
    delegationSignature: string;
}

export interface BetParams {
    timeperiodId: number;
    priceMin: number; // Price in USD (e.g., 25.5)
    priceMax: number; // Price in USD (e.g., 26.5)
    amount: number; // Amount in USD (e.g., 100)
    // orderNonce?: number; // Optional nonce for the order
}

export class SessionTradingSDK {
    private config: Required<Omit<SessionTradingConfig, 'relayerUrl' | 'wrapperContractAddress' | 'chainId' | 'sessionDuration'>> & SessionTradingConfig;
    private provider: ethers.providers.Web3Provider | null = null;
    private signer: ethers.providers.JsonRpcSigner | null = null;
    private userAddress: string | null = null;
    private sessionWallet: ethers.Wallet | null = null;
    private contract: ethers.Contract | null = null;
    private sessionInfo: SessionInfo | null = null;
    private domain: any;
    private DELEGATION_TYPES: any;
    private ORDER_TYPES: any;
    
    // Method to get session expiry (24 hours from now)
    private static getSessionExpiry(): number {
        return Math.floor(Date.now() / 1000) + (24 * 60 * 60); // 24 hours from now
    }

    /**
     * Convert price in USD to 8 decimals (as used by Hyperliquid oracle)
     * Example: 39.0 USD -> 3900000000 (39 * 10^8)
     * Example: 24.5 USD -> 2450000000 (24.5 * 10^8)
     */
    private priceToRaw(priceUSD: number): string {
        return BigInt(Math.floor(priceUSD * 1e8)).toString();
    }

    /**
     * Convert raw price (8 decimals) back to USD
     * Example: 3900000000 -> 39.0 USD
     */
    private rawToPrice(raw: string): number {
        return Number(raw) / 1e8;
    }

    /**
     * Convert amount in USD to 6 decimals (USDC/USDTO format)
     * Example: 100 USD -> 100000000 (100 * 10^6)
     * Example: 50.5 USD -> 50500000 (50.5 * 10^6)
     */
    private amountToRaw(amountUSD: number): string {
        return BigInt(Math.floor(amountUSD * 1e6)).toString();
    }

    /**
     * Convert raw amount (6 decimals) back to USD
     * Example: 100000000 -> 100 USD
     */
    private rawToAmount(raw: string): number {
        return Number(raw) / 1e6;
    }

    /**
     * Convert datetime to Unix timestamp (for timeperiodId)
     * Example: "2025-01-21T16:10:00" -> 1737475800
     */
    private datetimeToTimestamp(datetimeString: string): number {
        return Math.floor(new Date(datetimeString).getTime() / 1000);
    }

    constructor(config: SessionTradingConfig) {
        this.config = {
            relayerUrl: config.relayerUrl || 'http://localhost:8080',
            wrapperContractAddress: config.wrapperContractAddress,
            chainId: config.chainId || 1,
            sessionDuration: config.sessionDuration || 24 * 60 * 60 * 1000, // 24 hours
        };

        // EIP-712 Domain - MUST match contract constructor
        this.domain = {
            name: 'MercuryTrade', // Must match contract constructor
            version: '1',
            chainId: this.config.chainId,
            verifyingContract: this.config.wrapperContractAddress
        };

        // EIP-712 Types
        this.DELEGATION_TYPES = {
            SessionDelegation: [
                { name: 'user', type: 'address' },
                { name: 'sessionKey', type: 'address' },
                { name: 'expiry', type: 'uint256' },
            ]
        };

        this.ORDER_TYPES = {
            BetOrder: [
                { name: 'user', type: 'address' },
                { name: 'timeperiodId', type: 'uint256' },
                { name: 'priceMin', type: 'uint256' },
                { name: 'priceMax', type: 'uint256' },
                { name: 'amount', type: 'uint256' },
                { name: 'deadline', type: 'uint256' }
            ]
        };
    }

    /**
     * Connect to MetaMask
     */
    async connect() {
        if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') {
            throw new Error('MetaMask not installed');
        }

        this.provider = new ethers.providers.Web3Provider(window.ethereum as any);
        
        // Request accounts - this may return empty if user hasn't connected
        const accounts = await this.provider.send('eth_requestAccounts', []);
        
        // Check if user actually connected (not just rejected or no accounts)
        if (!accounts || accounts.length === 0) {
          throw new Error('Please connect your wallet in MetaMask to continue.');
        }
        
        this.signer = this.provider.getSigner(0);
        this.userAddress = await this.signer.getAddress();
        
        // Initialize contract for nonce fetching
        this.contract = new ethers.Contract(
            this.config.wrapperContractAddress,
            WRAPPER_ABI,
            this.provider
        );

        const network = await this.provider.getNetwork();
        
        // Update domain with actual connected chain ID for EIP-712 signatures
        this.domain.chainId = network.chainId;
        
        if (network.chainId !== this.config.chainId) {
            console.warn(`⚠️ Chain ID mismatch: expected ${this.config.chainId}, got ${network.chainId}`);
            console.warn(`⚠️ Please switch MetaMask to HyperEVM (Chain ID: ${this.config.chainId})`);
        }

        // Try to load existing session
        this.loadSession();

        return {
            address: this.userAddress,
            chainId: network.chainId
        };
    }

    /**
     * Create a new trading session
     * This requires ONE MetaMask signature
     */
    async createSession() {
        if (!this.signer || !this.provider) {
            throw new Error('Not connected. Call connect() first.');
        }
        console.log("hello creating session")

        // Get current network and update domain chainId
        const network = await this.provider.getNetwork();
        this.domain.chainId = network.chainId;
         console.log('Current chain ID:', network.chainId);
        console.log('Expected chain ID:', this.config.chainId);

        console.log(`📝 Creating session on chain ${network.chainId} for user ${this.userAddress}`);

        // Generate new session key
        this.sessionWallet = ethers.Wallet.createRandom();
        const sessionKey = this.sessionWallet.address;
        
        // Set expiry to 24 hours from now
        const expiry = SessionTradingSDK.getSessionExpiry(); // 24 hours from now
        
        // Fetch nonce from contract instead of generating random
        // console.log('📊 Fetching nonce from contract...');
        const nonce = await this._getContractNonce();

        // Create delegation message (NO nonce field!)
        const delegation = {
            user: this.userAddress!,
            sessionKey: sessionKey,
            expiry: expiry // Already in seconds (year 2100)
        };

        // Debug: Log the signature data
        console.log('🔍 EIP-712 Signature Data:');
        console.log('  Domain:', JSON.stringify(this.domain, null, 2));
        console.log('  Types:', JSON.stringify(this.DELEGATION_TYPES, null, 2));
        console.log('  Message:', JSON.stringify(delegation, null, 2));
        console.log('  User address:', this.userAddress);
        console.log('  Session key:', sessionKey);
        console.log('  Expiry (seconds):', expiry);
        console.log('  Expiry (date):', new Date(expiry * 1000).toISOString());
        console.log('  📊 DELEGATION DETAILS:');
        console.log('    - Delegation does NOT include nonce');
        console.log('    - Nonce will be fetched separately for orders');
        // console.log('    - Contract nonce fetched:', nonce);
        console.log('    - Expiry set to 24 hours from now');
        console.log('    - Expiry value:', expiry, '(seconds)');
        console.log('    - Expiry date:', new Date(expiry * 1000).toISOString());

        // Sign with MetaMask (chainId will match current network)
        const delegationSignature = await this.signer._signTypedData(
            this.domain,
            this.DELEGATION_TYPES,
            delegation
        );

        console.log('✅ Signature created:', delegationSignature);

        // Send to relayer
        console.log(`🔗 Sending request to: ${this.config.relayerUrl}/create-session`);
        
        let response;
        try {
            response = await fetch(`${this.config.relayerUrl}/create-session`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    user: this.userAddress,
                    session_key: sessionKey,
                    expiry: expiry, // Already in seconds
                    nonce: nonce.toString(),
                    delegation_signature: delegationSignature
                })
            });
        } catch (error: any) {
            console.error('❌ Network error:', error);
            console.error('📋 This is likely a CORS issue. The backend needs to:');
            console.error('   1. Add tower-http CORS middleware');
            console.error('   2. Allow OPTIONS method');
            console.error('   3. Allow origin:', window.location.origin);
            console.error('📖 See CORS_FIX.md for complete instructions');
            throw new Error(`Network error: ${error.message}. Check console for CORS fix instructions.`);
        }
        console.log("RESPONSE",response);
        
        if (!response.ok) {
            console.error(`❌ HTTP ${response.status}: ${response.statusText}`);
            let errorText;
            try {
                errorText = await response.text();
                console.error('Response:', errorText);
            } catch (e) {
                errorText = 'Unable to read response';
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        
        if (result.status !== 'ok') {
            throw new Error(result.error || 'Failed to create session');
        }

        // Save session
        this.sessionInfo = {
            user: this.userAddress!,
            sessionKey: sessionKey,
            sessionPrivateKey: this.sessionWallet.privateKey,
            expiry: expiry,
            delegationNonce: nonce,
            delegationSignature: delegationSignature
        };

        this._saveSession();

        return {
            sessionKey: sessionKey,
            expiry: new Date(expiry),
            expiresIn: this.config.sessionDuration
        };
    }

    /**
     * Place a bet using the session key
     * NO MetaMask popup required!
     * 
     * @param {BetParams} params
     */
    async placeBet({ timeperiodId, priceMin, priceMax, amount }: BetParams) {
        if (!this.sessionInfo || Date.now() >= (this.sessionInfo.expiry * 1000)) {
            throw new Error('Session expired. Please create a new session.');
        }

        if (!this.sessionWallet) {
            this.sessionWallet = new ethers.Wallet(this.sessionInfo.sessionPrivateKey);
        }

        if (!this.provider) {
            throw new Error('Not connected. Call connect() first.');
        }

        // Get user address from session info
        const userAddress = this.sessionInfo.user;

        // Ensure domain chainId is current
        const network = await this.provider.getNetwork();
        this.domain.chainId = network.chainId;

        // Validate inputs
        if (priceMin >= priceMax) {
            throw new Error('Price min must be less than price max');
        }

        const orderNonceValue = await  this._generateNonce();
        const deadline = Math.floor((Date.now() + 5 * 60 * 1000) / 1000); // 5 minutes

        // Convert prices from USD to 8 decimals (Hyperliquid oracle format)
        const priceMinRaw = this.priceToRaw(priceMin);
        const priceMaxRaw = this.priceToRaw(priceMax);
        
        // Convert amount from USD to 6 decimals (USDTO format)
        const amountRaw = this.amountToRaw(amount);

        console.log('🎲 Placing bet with converted values:');
        console.log(`   Price Range: ${priceMin} - ${priceMax} USD`);
        console.log(`   Price Min (raw): ${priceMinRaw}`);
        console.log(`   Price Max (raw): ${priceMaxRaw}`);
        console.log(`   Amount: ${amount} USD = ${amountRaw} (6 decimals)`);
        console.log(`   Timeperiod ID: ${timeperiodId}`);
        console.log(`   Order Nonce: ${orderNonceValue}`);
        console.log(`   Deadline: ${deadline} (${new Date(deadline * 1000).toISOString()})`);

        // Create order message with raw values
        const order = {
            user: userAddress,
            timeperiodId: timeperiodId,
            priceMin: priceMinRaw,
            priceMax: priceMaxRaw,
            amount: amountRaw,
            // nonce: orderNonceValue,
            deadline: deadline
        };

        console.log('📝 Order data:', JSON.stringify(order, null, 2));

        // Sign with session key (NO METAMASK POPUP!)
        const orderSignature = await this.sessionWallet._signTypedData(
            this.domain,
            this.ORDER_TYPES,
            order
        );

        console.log('✅ Order signed with session key');

        // Send to relayer
        const requestBody = {
            user: this.userAddress,
            timeperiod_id: timeperiodId.toString(),
            price_min: priceMinRaw,
            price_max: priceMaxRaw,
            amount: amountRaw,
            order_signature: orderSignature,
            nonce: orderNonceValue.toString(),
            deadline: deadline
        };

        console.log('📤 Sending to relayer:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(`${this.config.relayerUrl}/place-bet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();
        
        console.log('📥 Server response:', result);

        if (result.status !== 'ok') {
            throw new Error(result.error || 'Failed to place bet');
        }

        return {
            txHash: result.tx_hash,
            timeperiodId,
            priceMin,
            priceMax,
            amount
        };
    }

    /**
     * Revoke the current session
     */
    async revokeSession() {
        if (!this.userAddress) {
            throw new Error('Not connected');
        }

        const response = await fetch(`${this.config.relayerUrl}/revoke-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: this.userAddress
            })
        });

        const result = await response.json();
        
        if (result.status !== 'ok') {
            throw new Error(result.error || 'Failed to revoke session');
        }

        this.sessionInfo = null;
        this.sessionWallet = null;
        this._clearSession();

        return true;
    }

    /**
     * Get current session info
     */
    getSessionInfo() {
        if (!this.sessionInfo) {
            return null;
        }

        return {
            sessionKey: this.sessionInfo.sessionKey,
            expiry: new Date(this.sessionInfo.expiry * 1000), // Convert seconds to milliseconds
            isExpired: Date.now() >= (this.sessionInfo.expiry * 1000), // Convert seconds to milliseconds
            remainingTime: Math.max(0, (this.sessionInfo.expiry * 1000) - Date.now()) // Convert seconds to milliseconds
        };
    }

    /**
     * Check if session is active
     */
    hasActiveSession() {
        return this.sessionInfo !== null && Date.now() < (this.sessionInfo.expiry * 1000);
    }

    /**
     * Get session info from server
     */ 
    async getServerSessionInfo() {
        if (!this.userAddress) {
            throw new Error('Not connected');
        }

        const response = await fetch(`${this.config.relayerUrl}/get-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: this.userAddress
            })
        });

        const result = await response.json();
        
        if (result.status === 'ok') {
            return result.session;
        }

        return null;
    }

    /**
     * Get current chain ID from provider
     */
    async getCurrentChainId(): Promise<number> {
        if (!this.provider) {
            throw new Error('Not connected');
        }
        const network = await this.provider.getNetwork();
        return network.chainId;
    }

    /**
     * Check if user is on the correct network
     */
    async isOnCorrectNetwork(): Promise<boolean> {
        const currentChainId = await this.getCurrentChainId();
        return currentChainId === this.config.chainId;
    }

    /**
     * Request MetaMask to switch to the configured chain
     */
    async switchToCorrectNetwork(): Promise<boolean> {
        if (!this.provider || typeof window === 'undefined' || !window.ethereum) {
            return false;
        }

        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: `0x${(this.config.chainId || 999).toString(16)}` }],
            });
            
            // Update domain after switching
            const network = await this.provider!.getNetwork();
            this.domain.chainId = network.chainId;
            
            console.log(`✅ Switched to chain ${network.chainId}`);
            return true;
        } catch (error: any) {
            console.error('Network switch error:', error);
            
            // Chain not added to MetaMask (error code 4902)
            if (error.code === 4902 || error.code === -32603) {
                console.error(`❌ Chain ${this.config.chainId || 999} (0x${(this.config.chainId || 999).toString(16)}) not found in MetaMask.`);
                console.error(`Please add HyperEVM to MetaMask manually:`);
                console.error(`  - Network Name: HyperEVM`);
                console.error(`  - Chain ID: ${this.config.chainId || 999}`);
                console.error(`  - RPC URL: (ask your admin for HyperEVM RPC endpoint)`);
                console.error(`  - Currency Symbol: ETH`);
            } else if (error.code === 4001) {
                // User rejected the request
                console.log('User rejected network switch');
            }
            
            return false;
        }
    }

    /**
     * Fetch current nonce from contract
     */
    private async _getContractNonce(): Promise<number> {
        if (!this.contract || !this.userAddress) {
            throw new Error('Not connected to contract or user address not available');
        }
        console.log(`ContractAddress: ${this.contract.address}`);
        
        try {
            const nonce = await this.contract.getNonce(this.userAddress);
            console.log('📊 Fetched nonce from contract:', nonce.toString());
            return nonce.toNumber();
        } catch (error) {
            console.error('❌ Failed to fetch nonce from contract:', error);
            throw new Error(`Failed to fetch nonce: ${error}`);
        }
    }

    /**
     * Generate random nonce (fallback)
     */
    private _generateNonce() {
        return Math.floor(Math.random() * 1000000000);
    }

    /**
     * Create a simple session (matches the new approach)
     * This is a convenience method that follows the exact pattern from the provided code
     */
    async createSessionSimple() {
        console.log('🚀 Starting session creation...\n');

        // Connect to MetaMask
        console.log('📍 STEP 1: Connecting to MetaMask...');
        
        if (typeof window.ethereum === 'undefined') {
            throw new Error('Please install MetaMask!');
        }

        // Request accounts - this may return empty if user hasn't connected
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        
        // Check if user actually connected
        if (!accounts || accounts.length === 0) {
          throw new Error('Please connect your wallet in MetaMask to continue.');
        }
        
        const provider = new ethers.providers.Web3Provider(window.ethereum as any);
        const userSigner = provider.getSigner(0);
        const userAddress = await userSigner.getAddress();
        
        console.log('✅ Connected!');
        console.log('   User address:', userAddress);

        // Create Session Key (Random Wallet)
        console.log('📍 STEP 2: Creating session key...');
        
        const sessionKeyWallet = ethers.Wallet.createRandom();
        const sessionKeyAddress = sessionKeyWallet.address;
        const sessionKeyPrivateKey = sessionKeyWallet.privateKey;
        
        console.log('✅ Session key created!');
        console.log('   Address:', sessionKeyAddress);
        console.log('   Private key:', sessionKeyPrivateKey);
        console.log('   ⚠️  Save this private key - you need it for place_bet!');

        // Create Delegation Data
        console.log('📍 STEP 3: Creating delegation data...');
        
        // Set expiry to 24 hours from now
        const expiryTimestamp = SessionTradingSDK.getSessionExpiry(); // 24 hours from now
        
        // Fetch nonce from contract
        console.log('📊 Fetching nonce from contract...');
        const contract = new ethers.Contract(
            this.config.wrapperContractAddress,
            WRAPPER_ABI,
            provider
        );
        const nonce = await contract.getNonce(userAddress);
        console.log('✅ Fetched nonce from contract:', nonce.toString());
        console.log('📊 DELEGATION DETAILS:');
        console.log('  - Delegation does NOT include nonce');
        console.log('  - Nonce will be fetched separately for orders');
        console.log('  - Contract nonce fetched:', nonce.toString());
        console.log('  - Expiry set to 24 hours from now');
        console.log('  - Expiry date:', new Date(expiryTimestamp * 1000).toISOString());

        const delegationData = {
            user: userAddress,
            sessionKey: sessionKeyAddress,
            expiry: expiryTimestamp
        };

        console.log('✅ Delegation data created:');
        console.log('   user:', delegationData.user);
        console.log('   sessionKey:', delegationData.sessionKey);
        console.log('   expiry:', delegationData.expiry, `(${new Date(expiryTimestamp * 1000).toISOString()})`);
        console.log('   nonce: (not included in delegation)');

        // Sign Delegation with MetaMask
        console.log('📍 STEP 4: Signing delegation with MetaMask...');
        console.log('   (MetaMask popup will appear - please approve)');
        
        const signature = await userSigner._signTypedData(
            this.domain,
            this.DELEGATION_TYPES,
            delegationData
        );

        console.log('✅ Signature created!');
        console.log('   Signature:', signature);
        console.log('   Length:', signature.length, 'characters');

        // Send to Server
        console.log('📍 STEP 5: Sending to server...');
        
        const requestBody = {
            user: userAddress,
            session_key: sessionKeyAddress,
            expiry: expiryTimestamp,
            nonce: nonce.toString(),
            delegation_signature: signature
        };

        console.log('   Request body:', JSON.stringify(requestBody, null, 2));

        const response = await fetch(`${this.config.relayerUrl}/create-session`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();
        
        console.log('✅ Server response:', result);

        // Save Session Info
        if (result.status === 'ok') {
            console.log('📍 STEP 6: Saving session info...');
            
            const sessionInfo = {
                userAddress: userAddress,
                sessionKeyAddress: sessionKeyAddress,
                sessionKeyPrivateKey: sessionKeyPrivateKey,
                expiry: expiryTimestamp,
                nonce: nonce
            };

            if (typeof window !== 'undefined') {
                localStorage.setItem(STORAGE_KEYS.MERCURY_SESSION, JSON.stringify(sessionInfo));
                console.log('✅ Session saved to localStorage!');
            }
            console.log('');
            console.log('🎉 SESSION CREATION COMPLETE!');
            console.log('');
            console.log('📋 Summary:');
            console.log('   User:', userAddress);
            console.log('   Session Key:', sessionKeyAddress);
            console.log('   Expires:', new Date(expiryTimestamp * 1000).toLocaleString());
            console.log('');
            console.log('⚠️  IMPORTANT: Save this private key somewhere safe:');
            console.log('   ', sessionKeyPrivateKey);
            
            return { success: true, sessionInfo };
        } else {
            console.error('❌ Failed:', result.error);
            return { success: false, error: result.error };
        }
    }

    /**
     * Place bet using the simple approach (matches the new pattern)
     */
    async placeBetSimple(betParams: {
        timeperiod: string | Date | number;
        priceMin: number;
        priceMax: number;
        amount: number;
        // orderNonce?: number;
    }) {
        console.log('🎲 Starting place bet...\n');

        try {
            // Get session info
            console.log('📍 STEP 1: Loading session...');
            if (typeof window === 'undefined') {
                throw new Error('localStorage is not available. Please try again.');
            }
            const sessionData = localStorage.getItem(STORAGE_KEYS.MERCURY_SESSION);
            if (!sessionData) {
                throw new Error('No session found. Please create a session first.');
            }
            
            const session = JSON.parse(sessionData);
            
            // Check if expired
            const now = Math.floor(Date.now() / 1000);
            if (session.expiry < now) {
                localStorage.removeItem(STORAGE_KEYS.MERCURY_SESSION);
                throw new Error('Session expired. Please create a new session.');
            }
            
            console.log('✅ Session loaded:');
            console.log('   User:', session.userAddress);
            console.log('   Session Key:', session.sessionKeyAddress);

            // Prepare bet parameters
            console.log('📍 STEP 2: Preparing bet parameters...');

            // Convert timeperiod to Unix timestamp
            let timeperiodId;
            if (betParams.timeperiod instanceof Date) {
                timeperiodId = Math.floor(betParams.timeperiod.getTime() / 1000);
            } else if (typeof betParams.timeperiod === 'string') {
                timeperiodId = this.datetimeToTimestamp(betParams.timeperiod);
            } else {
                timeperiodId = betParams.timeperiod;
            }

            // Convert prices from USD to 8 decimals
            const priceMin = this.priceToRaw(betParams.priceMin);
            const priceMax = this.priceToRaw(betParams.priceMax);

            // Convert amount to 6 decimals (USDTO format)
            const amount = this.amountToRaw(betParams.amount);
            const orderNonce= await this._getContractNonce();
            // Set deadline to 5 minutes from now
            const deadline = Math.floor(Date.now() / 1000) + (5 * 60);

            console.log('✅ Bet parameters prepared:');
            console.log('   Timeperiod ID:', timeperiodId, `(${new Date(timeperiodId * 1000).toISOString()})`);
            console.log('   Price Range:', betParams.priceMin, '-', betParams.priceMax, 'USD');
            console.log('   Price Min (raw):', priceMin);
            console.log('   Price Max (raw):', priceMax);
            console.log('   Amount:', betParams.amount, 'USD =', amount, '(6 decimals)');
            // console.log('   Order Nonce:', betParams.orderNonce || 1);
            console.log('   Deadline:', deadline, `(${new Date(deadline * 1000).toISOString()})`);

            // Create order data
            console.log('📍 STEP 3: Creating order data...');

            const orderData = {
                user: session.userAddress,
                timeperiodId: timeperiodId,
                priceMin: priceMin,
                priceMax: priceMax,
                amount: amount,
                // nonce: betParams.orderNonce || 1,
                deadline: deadline
            };

            console.log('✅ Order data created');

            // Sign order with session key
            console.log('📍 STEP 4: Signing order with session key...');

            const sessionKeyWallet = new ethers.Wallet(session.sessionKeyPrivateKey);
            const orderSignature = await sessionKeyWallet._signTypedData(this.domain, this.ORDER_TYPES, orderData);

            console.log('✅ Order signed!');
            console.log('   Signature:', orderSignature);

            // Send to server
            console.log('📍 STEP 5: Sending bet to server...');

            const requestBody = {
                user: session.userAddress,
                timeperiod_id: timeperiodId.toString(),
                price_min: priceMin,
                price_max: priceMax,
                amount: amount,
                order_signature: orderSignature,
                nonce: orderNonce.toString(),
                deadline: deadline
            };

            console.log('   Request body:', JSON.stringify(requestBody, null, 2));

            const response = await fetch(`${this.config.relayerUrl}/place-bet`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            const result = await response.json();

            console.log('📥 Server response:', result);

            // Return result
            if (result.status === 'ok') {
                console.log('🎉 BET PLACED SUCCESSFULLY!');
                console.log('   Transaction Hash:', result.tx_hash);
                return { success: true, txHash: result.tx_hash };
            } else {
                console.error('❌ Bet failed:', result.error);
                return { success: false, error: result.error };
            }

        } catch (error: any) {
            console.error('❌ Error placing bet:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Save session to localStorage
     */
    private _saveSession() {
        if (this.sessionInfo && this.userAddress && typeof window !== 'undefined') {
            localStorage.setItem(STORAGE_KEYS.TRADING_SESSION(this.userAddress), JSON.stringify(this.sessionInfo));
        }
    }

    /**
     * Load session from localStorage
     */
    loadSession() {
        if (!this.userAddress || typeof window === 'undefined') return false;

        const stored = localStorage.getItem(STORAGE_KEYS.TRADING_SESSION(this.userAddress));
        if (stored) {
            try {
                const session = JSON.parse(stored);
                // Check if expired (convert seconds to milliseconds)
                if (Date.now() < (session.expiry * 1000)) {
                    this.sessionInfo = session;
                    this.sessionWallet = new ethers.Wallet(session.sessionPrivateKey);
                    return true;
                } else {
                    this._clearSession();
                }
            } catch (e) {
                console.error('Failed to load session:', e);
            }
        }
        return false;
    }

    /**
     * Clear session from localStorage
     */
    private _clearSession() {
        if (this.userAddress && typeof window !== 'undefined') {
            localStorage.removeItem(STORAGE_KEYS.TRADING_SESSION(this.userAddress));
        }
    }
}


