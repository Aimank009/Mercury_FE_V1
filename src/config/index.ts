// ========================================
// CENTRAL CONFIGURATION EXPORT
// ========================================

/**
 * Import all configurations from here for better organization
 * This provides a single source of truth for all application constants
 * 
 * Usage:
 * import { PRICE_STEP, GRID_CONFIG, API_URLS } from '@/config';
 */

// Trading configuration
export * from './trading';

// Contract addresses
export * from './contracts';

// Network configuration
export * from './networks';

// API configuration
export * from './api';

// Database configuration
export * from './database';

// Storage keys
export * from './storage';

// UI constants
export * from './ui';

// Validation rules
export * from './validation';

// Error codes and messages
export * from './errors';

// Feature flags
export * from './features';

/**
 * Environment variables with fallbacks
 * Centralized access to environment variables
 */
export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  IS_DEVELOPMENT: process.env.NODE_ENV === 'development',
  
  // Backend URLs
  BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001',
  RELAYER_URL: process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:8080',
  WS_URL: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080',
  REALTIME_WS_URL: process.env.NEXT_PUBLIC_REALTIME_WS_URL || 'ws://localhost:8080',
  
  // Database
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  
  // Contracts
  WRAPPER_CONTRACT: process.env.NEXT_PUBLIC_WRAPPER_CONTRACT || '0xe890F67f7ea28aa821C06eE8d4ea46e6Ab147850',
  LIBRARY_CONTRACT: process.env.NEXT_PUBLIC_LIBRARY_CONTRACT || '0xd237C5D13b086bD4Ed5fe0F22b66fE608e5c6e02',
  CHRONO_GRID_CONTRACT: process.env.NEXT_PUBLIC_CHRONO_GRID_CONTRACT || '',
  
  // Network
  CHAIN_ID: parseInt(process.env.NEXT_PUBLIC_CHAIN_ID || '999'),
  RPC_URL: process.env.NEXT_PUBLIC_RPC_URL || '',
  
  // Wallet
  WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'c1f527b9e2a8e5c3f3d9b8a7c6e5f4d3',
  ENABLE_TESTNETS: process.env.NEXT_PUBLIC_ENABLE_TESTNETS === 'true',
  
  // Features
  MOCK_MODE: process.env.NEXT_PUBLIC_MOCK_MODE === 'true',
} as const;

/**
 * Helper function to check if all required env variables are set
 */
export function validateEnvironment(): { isValid: boolean; missing: string[] } {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_WRAPPER_CONTRACT',
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  return {
    isValid: missing.length === 0,
    missing,
  };
}
