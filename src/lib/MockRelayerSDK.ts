// /**
//  * Mock Session Trading SDK
//  * Simulates relayer responses for testing without a backend
//  * 
//  * This is for DEMO purposes only - DO NOT use in production!
//  */

// import { ethers } from 'ethers';

// export interface SessionTradingConfig {
//     relayerUrl?: string;
//     wrapperContractAddress: string;
//     chainId?: number;
//     sessionDuration?: number;
// }

// export interface SessionInfo {
//     user: string;
//     sessionKey: string;
//     sessionPrivateKey: string;
//     expiry: number;
//     delegationNonce: number;
//     delegationSignature: string;
// }

// export interface BetParams {
//     timeperiodId: number;
//     priceMin: number;
//     priceMax: number;
//     amount: number;
// }

// export class SessionTradingSDK {
//     private config: Required<Omit<SessionTradingConfig, 'relayerUrl' | 'wrapperContractAddress' | 'chainId' | 'sessionDuration'>> & SessionTradingConfig;
//     private provider: ethers.providers.Web3Provider | null = null;
//     private signer: ethers.providers.JsonRpcSigner | null = null;
//     private userAddress: string | null = null;
//     private sessionWallet: ethers.Wallet | null = null;
//     private sessionInfo: SessionInfo | null = null;
//     private domain: any;
//     private DELEGATION_TYPES: any;
//     private ORDER_TYPES: any;

//     constructor(config: SessionTradingConfig) {
//         this.config = {
//             relayerUrl: config.relayerUrl || 'http://localhost:8080',
//             wrapperContractAddress: config.wrapperContractAddress,
//             chainId: config.chainId || 1,
//             sessionDuration: config.sessionDuration || 24 * 60 * 60 * 1000,
//         };

//         // EIP-712 Domain - MUST match backend
//         this.domain = {
//             name: 'MercuryTrade',
//             version: '1',
//             chainId: this.config.chainId,
//             verifyingContract: this.config.wrapperContractAddress
//         };

//         // EIP-712 Types
//         this.DELEGATION_TYPES = {
//             SessionDelegation: [
//                 { name: 'user', type: 'address' },
//                 { name: 'sessionKey', type: 'address' },
//                 { name: 'expiry', type: 'uint256' },
//                 { name: 'nonce', type: 'uint256' }
//             ]
//         };

//         this.ORDER_TYPES = {
//             BetOrder: [
//                 { name: 'user', type: 'address' },
//                 { name: 'timeperiodId', type: 'uint256' },
//                 { name: 'priceMin', type: 'uint256' },
//                 { name: 'priceMax', type: 'uint256' },
//                 { name: 'amount', type: 'uint256' },
//                 { name: 'nonce', type: 'uint256' },
//                 { name: 'deadline', type: 'uint256' }
//             ]
//         };
//     }

//     async connect() {
//         if (typeof window === 'undefined' || typeof window.ethereum === 'undefined') {
//             throw new Error('MetaMask not installed');
//         }

//         this.provider = new ethers.providers.Web3Provider(window.ethereum as any);
//         await this.provider.send('eth_requestAccounts', []);
//         this.signer = this.provider.getSigner();
//         this.userAddress = await this.signer.getAddress();

//         const network = await this.provider.getNetwork();
        
//         if (network.chainId !== this.config.chainId) {
//             console.warn(`Chain ID mismatch: expected ${this.config.chainId}, got ${network.chainId}`);
//         }

//         // Try to load existing session
//         this.loadSession();

//         return {
//             address: this.userAddress,
//             chainId: network.chainId
//         };
//     }

//     async createSession() {
//         if (!this.signer) {
//             throw new Error('Not connected. Call connect() first.');
//         }

//         // Generate new session key
//         this.sessionWallet = ethers.Wallet.createRandom();
//         const sessionKey = this.sessionWallet.address;
//         const expiry = Date.now() + this.config.sessionDuration;
//         const nonce = this._generateNonce();

//         // Create delegation message
//         const delegation = {
//             user: this.userAddress,
//             sessionKey: sessionKey,
//             expiry: Math.floor(expiry / 1000),
//             nonce: nonce
//         };

//         console.log('📝 Signing delegation:', delegation);

//         // Sign with MetaMask
//         const delegationSignature = await this.signer._signTypedData(
//             this.domain,
//             this.DELEGATION_TYPES,
//             delegation
//         );

//         console.log('✅ Signature obtained:', delegationSignature);

//         // MOCK: Simulate relayer response
//         console.log('🎭 [MOCK] Simulating relayer call to /create-session');
//         await this._mockDelay(500); // Simulate network delay
        
//         // In real implementation, this would call the backend:
//         // const response = await fetch(`${this.config.relayerUrl}/create-session`, {...});
        
//         console.log('✅ [MOCK] Session created successfully');

//         // Save session
//         this.sessionInfo = {
//             user: this.userAddress!,
//             sessionKey: sessionKey,
//             sessionPrivateKey: this.sessionWallet.privateKey,
//             expiry: expiry,
//             delegationNonce: nonce,
//             delegationSignature: delegationSignature
//         };

//         this._saveSession();

//         return {
//             sessionKey: sessionKey,
//             expiry: new Date(expiry),
//             expiresIn: this.config.sessionDuration
//         };
//     }

//     async placeBet({ timeperiodId, priceMin, priceMax, amount }: BetParams) {
//         if (!this.sessionInfo || Date.now() >= this.sessionInfo.expiry) {
//             throw new Error('Session expired. Please create a new session.');
//         }

//         if (!this.sessionWallet) {
//             this.sessionWallet = new ethers.Wallet(this.sessionInfo.sessionPrivateKey);
//         }

//         // Validate inputs
//         if (priceMin >= priceMax) {
//             throw new Error('Price min must be less than price max');
//         }

//         const orderNonce = this._generateNonce();
//         const deadline = Math.floor((Date.now() + 5 * 60 * 1000) / 1000);

//         // Create order message
//         const order = {
//             user: this.userAddress,
//             timeperiodId: timeperiodId,
//             priceMin: priceMin,
//             priceMax: priceMax,
//             amount: amount,
//             nonce: orderNonce,
//             deadline: deadline
//         };

//         console.log('📝 Signing bet order:', order);

//         // Sign with session key (NO METAMASK POPUP!)
//         const orderSignature = await this.sessionWallet._signTypedData(
//             this.domain,
//             this.ORDER_TYPES,
//             order
//         );

//         console.log('✅ Order signature obtained (no MetaMask!):', orderSignature);

//         // MOCK: Simulate relayer response
//         console.log('🎭 [MOCK] Simulating relayer call to /place-bet');
//         await this._mockDelay(800);
        
//         // Generate mock transaction hash
//         const mockTxHash = '0x' + Array.from({ length: 64 }, () => 
//             Math.floor(Math.random() * 16).toString(16)
//         ).join('');
        
//         console.log('✅ [MOCK] Bet placed successfully, TX:', mockTxHash);

//         return {
//             txHash: mockTxHash,
//             timeperiodId,
//             priceMin,
//             priceMax,
//             amount
//         };
//     }

//     async revokeSession() {
//         if (!this.userAddress) {
//             throw new Error('Not connected');
//         }

//         // MOCK: Simulate relayer response
//         console.log('🎭 [MOCK] Simulating relayer call to /revoke-session');
//         await this._mockDelay(300);
//         console.log('✅ [MOCK] Session revoked');

//         this.sessionInfo = null;
//         this.sessionWallet = null;
//         this._clearSession();

//         return true;
//     }

//     getSessionInfo() {
//         if (!this.sessionInfo) {
//             return null;
//         }

//         return {
//             sessionKey: this.sessionInfo.sessionKey,
//             expiry: new Date(this.sessionInfo.expiry),
//             isExpired: Date.now() >= this.sessionInfo.expiry,
//             remainingTime: Math.max(0, this.sessionInfo.expiry - Date.now())
//         };
//     }

//     hasActiveSession() {
//         return this.sessionInfo !== null && Date.now() < this.sessionInfo.expiry;
//     }

//     async getServerSessionInfo() {
//         if (!this.userAddress) {
//             throw new Error('Not connected');
//         }

//         // MOCK: Simulate response
//         console.log('🎭 [MOCK] Simulating relayer call to /get-session');
//         await this._mockDelay(200);
        
//         return this.sessionInfo ? {
//             session_key: this.sessionInfo.sessionKey,
//             expiry: Math.floor(this.sessionInfo.expiry / 1000),
//             active: Date.now() < this.sessionInfo.expiry
//         } : null;
//     }

//     private _generateNonce() {
//         return Math.floor(Math.random() * 1000000000);
//     }

//     private _saveSession() {
//         if (this.sessionInfo && typeof window !== 'undefined') {
//             localStorage.setItem(`tradingSession_${this.userAddress}`, JSON.stringify(this.sessionInfo));
//         }
//     }

//     loadSession() {
//         if (!this.userAddress || typeof window === 'undefined') return false;

//         const stored = localStorage.getItem(`tradingSession_${this.userAddress}`);
//         if (stored) {
//             try {
//                 const session = JSON.parse(stored);
//                 if (Date.now() < session.expiry) {
//                     this.sessionInfo = session;
//                     this.sessionWallet = new ethers.Wallet(session.sessionPrivateKey);
//                     console.log('✅ Session loaded from localStorage');
//                     return true;
//                 } else {
//                     this._clearSession();
//                     console.log('⚠️ Stored session expired');
//                 }
//             } catch (e) {
//                 console.error('Failed to load session:', e);
//             }
//         }
//         return false;
//     }

//     private _clearSession() {
//         if (this.userAddress && typeof window !== 'undefined') {
//             localStorage.removeItem(`tradingSession_${this.userAddress}`);
//         }
//     }

//     private async _mockDelay(ms: number) {
//         return new Promise(resolve => setTimeout(resolve, ms));
//     }
// }


