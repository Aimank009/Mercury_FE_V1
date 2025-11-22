// ========================================
// STORAGE CONFIGURATION
// ========================================

/**
 * Local storage key constants
 * Prevents typos and makes refactoring easier
 */
export const STORAGE_KEYS = {
  // User preferences
  USER_AMOUNT: 'userAmount',
  MODAL_COLLAPSED: 'modalCollapsed',
  GRAPH_START_TIME: 'graphStartTime',
  
  // Session management
  MERCURY_SESSION: 'mercurySession',
  TRADING_SESSION: (address: string) => `tradingSession_${address}`,
  
  // Wallet state
  WALLET_ADDRESS: 'mercury_wallet_address',
  LAST_CHAIN_ID: 'mercury_last_chain_id',
  
  // Grid state
  GRID_STATE: 'mercury_grid_state',
  SELECTED_GRIDS: 'mercury_selected_grids',
  
  // Nonce management
  NONCE: (address: string, chainId: number) => `nonce_${address}_${chainId}`,
  
  // Onboarding
  TERMS_ACCEPTED: (address: string) => `mercury_terms_accepted_${address}`,
  TUTORIAL_COMPLETED: (address: string) => `mercury_tutorial_completed_${address}`,
  
  // Cache
  POSITIONS_CACHE: (address: string) => `positions_cache_${address}`,
  POSITIONS_CACHE_TIME: (address: string) => `positions_cache_time_${address}`,
} as const;

/**
 * Session storage keys
 */
export const SESSION_KEYS = {
  TEMP_SESSION: 'mercury_temp_session',
  ACTIVE_BETS: 'mercury_active_bets',
} as const;

/**
 * Cookie names
 */
export const COOKIES = {
  AUTH_TOKEN: 'mercury_auth_token',
  PREFERENCES: 'mercury_preferences',
} as const;

/**
 * Cache expiration times (milliseconds)
 */
export const CACHE_EXPIRY = {
  POSITIONS: 60000, // 1 minute
  PRICE_DATA: 5000, // 5 seconds
  SESSION_DATA: 3600000, // 1 hour
} as const;
