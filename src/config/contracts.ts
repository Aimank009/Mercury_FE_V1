// ========================================
// CONTRACT ADDRESSES CONFIGURATION
// ========================================

/**
 * Smart contract addresses
 * Centralized to avoid repetition across the codebase
 */
export const CONTRACTS = {
  WRAPPER: process.env.NEXT_PUBLIC_WRAPPER_CONTRACT || '0x2532aDC6B897e017c966D989B69481D4D2484A6A',
  LIBRARY: process.env.NEXT_PUBLIC_LIBRARY_CONTRACT || '0xd237C5D13b086bD4Ed5fe0F22b66fE608e5c6e02',
  CHRONO_GRID: process.env.NEXT_PUBLIC_CHRONO_GRID_CONTRACT || '',
} as const;

/**
 * Contract-related constants
 */
export const CONTRACT_CONFIG = {
  DEFAULT_GAS_LIMIT: 500000,
  MAX_APPROVAL_AMOUNT: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
} as const;
