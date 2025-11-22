// ========================================
// VALIDATION CONFIGURATION
// ========================================

/**
 * Wallet address validation
 */
export const WALLET_VALIDATION = {
  ADDRESS_LENGTH: 42,
  ADDRESS_PREFIX: '0x',
  ADDRESS_REGEX: /^0x[a-fA-F0-9]{40}$/,
} as const;

/**
 * Amount validation
 */
export const AMOUNT_VALIDATION = {
  MIN_DECIMALS: 0,
  MAX_DECIMALS: 18,
  AMOUNT_REGEX: /^\d+(\.\d+)?$/,
} as const;

/**
 * Session validation
 */
export const SESSION_VALIDATION = {
  MIN_DURATION_MS: 60000, // 1 minute
  MAX_DURATION_MS: 86400000, // 24 hours
  EXPIRY_CHECK_INTERVAL_MS: 60000, // 1 minute
} as const;

/**
 * Validation error messages
 */
export const VALIDATION_MESSAGES = {
  INVALID_WALLET: 'Invalid wallet address format',
  INVALID_AMOUNT: 'Invalid bet amount',
  AMOUNT_TOO_LOW: 'Amount below minimum',
  AMOUNT_TOO_HIGH: 'Amount exceeds maximum',
  WALLET_NOT_CONNECTED: 'Please connect your wallet',
  WRONG_NETWORK: 'Please switch to the correct network',
  SESSION_EXPIRED: 'Your session has expired',
  INVALID_GRID_INDEX: 'Invalid grid index',
  INVALID_PRICE: 'Invalid price value',
} as const;

/**
 * Validation helper functions
 */
export function isValidAddress(address: string): boolean {
  return WALLET_VALIDATION.ADDRESS_REGEX.test(address);
}

export function isValidAmount(amount: string): boolean {
  return AMOUNT_VALIDATION.AMOUNT_REGEX.test(amount);
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}
