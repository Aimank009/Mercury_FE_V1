// ========================================
// ERROR CONFIGURATION
// ========================================

/**
 * Application error codes
 */
export const ERROR_CODES = {
  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_WRONG_CHAIN: 'NETWORK_WRONG_CHAIN',
  
  // Wallet errors
  WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
  WALLET_CONNECTION_REJECTED: 'WALLET_CONNECTION_REJECTED',
  WALLET_INSUFFICIENT_FUNDS: 'WALLET_INSUFFICIENT_FUNDS',
  WALLET_SIGNATURE_REJECTED: 'WALLET_SIGNATURE_REJECTED',
  
  // API errors
  API_ERROR: 'API_ERROR',
  API_TIMEOUT: 'API_TIMEOUT',
  API_UNAUTHORIZED: 'API_UNAUTHORIZED',
  API_NOT_FOUND: 'API_NOT_FOUND',
  API_SERVER_ERROR: 'API_SERVER_ERROR',
  
  // Database errors
  DB_ERROR: 'DB_ERROR',
  DB_CONSTRAINT_VIOLATION: 'DB_CONSTRAINT_VIOLATION',
  DB_NOT_FOUND: 'DB_NOT_FOUND',
  DB_CONNECTION_ERROR: 'DB_CONNECTION_ERROR',
  
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Session errors
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  SESSION_INVALID: 'SESSION_INVALID',
  SESSION_CREATE_FAILED: 'SESSION_CREATE_FAILED',
  
  // Trading errors
  BET_PLACEMENT_FAILED: 'BET_PLACEMENT_FAILED',
  GRID_LOAD_FAILED: 'GRID_LOAD_FAILED',
  PRICE_FETCH_FAILED: 'PRICE_FETCH_FAILED',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  
  // Unknown errors
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

/**
 * Error messages mapped to codes
 */
export const ERROR_MESSAGES: Record<string, string> = {
  [ERROR_CODES.NETWORK_ERROR]: 'Network connection failed',
  [ERROR_CODES.NETWORK_TIMEOUT]: 'Network request timed out',
  [ERROR_CODES.NETWORK_WRONG_CHAIN]: 'Wrong network selected',
  [ERROR_CODES.WALLET_NOT_CONNECTED]: 'Please connect your wallet',
  [ERROR_CODES.WALLET_CONNECTION_REJECTED]: 'Wallet connection rejected',
  [ERROR_CODES.WALLET_INSUFFICIENT_FUNDS]: 'Insufficient funds',
  [ERROR_CODES.WALLET_SIGNATURE_REJECTED]: 'Transaction signature rejected',
  [ERROR_CODES.API_ERROR]: 'API request failed',
  [ERROR_CODES.API_TIMEOUT]: 'Request timed out. Please try again.',
  [ERROR_CODES.API_UNAUTHORIZED]: 'Unauthorized access',
  [ERROR_CODES.API_NOT_FOUND]: 'Resource not found',
  [ERROR_CODES.API_SERVER_ERROR]: 'Server error occurred',
  [ERROR_CODES.DB_ERROR]: 'Database error occurred',
  [ERROR_CODES.DB_CONNECTION_ERROR]: 'Database connection failed',
  [ERROR_CODES.SESSION_EXPIRED]: 'Your session has expired. Please reconnect.',
  [ERROR_CODES.SESSION_INVALID]: 'Invalid session',
  [ERROR_CODES.SESSION_CREATE_FAILED]: 'Failed to create session',
  [ERROR_CODES.BET_PLACEMENT_FAILED]: 'Failed to place bet. Please try again.',
  [ERROR_CODES.GRID_LOAD_FAILED]: 'Failed to load grid positions',
  [ERROR_CODES.PRICE_FETCH_FAILED]: 'Failed to fetch price data',
  [ERROR_CODES.INSUFFICIENT_BALANCE]: 'Insufficient balance for this transaction',
  [ERROR_CODES.UNKNOWN_ERROR]: 'An unexpected error occurred',
} as const;

/**
 * Get error message by code
 */
export function getErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES[ERROR_CODES.UNKNOWN_ERROR];
}
