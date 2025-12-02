// ========================================
// CONTRACT ADDRESSES CONFIGURATION
// ========================================

/**
 * Smart contract addresses
 * Centralized to avoid repetition across the codebase
 */
export const CONTRACTS = {
  WRAPPER: process.env.NEXT_PUBLIC_WRAPPER_CONTRACT || '0x43e3A4d6f27DB8b06Ff88AbC59C07DCc5c42C1Dd',
  LIBRARY: process.env.NEXT_PUBLIC_LIBRARY_CONTRACT || '0x2969906A13085fc1342dC45036A21E1dd6FfA5C4',
  CHRONO_GRID: process.env.NEXT_PUBLIC_CHRONO_GRID_CONTRACT || '0x35b5585aE3eA66015e3A6499a4f72Bf66927bdBa',
} as const;

/**
 * Contract-related constants
 */
export const CONTRACT_CONFIG = {
  DEFAULT_GAS_LIMIT: 500000,
  MAX_APPROVAL_AMOUNT: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
} as const;
