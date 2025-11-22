// ========================================
// DATABASE CONFIGURATION
// ========================================

/**
 * Supabase credentials
 */
export const SUPABASE_CONFIG = {
  URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
} as const;

/**
 * Supabase table names
 * Centralized to avoid typos and make refactoring easier
 */
export const TABLES = {
  BETS: 'bets',
  ALL_USERS_BETS: 'all_users_bets',
  GRID_POSITIONS: 'grid_positions',
  TRADING_SESSIONS: 'trading_sessions',
  USER_PROFILES: 'user_profiles',
  BET_PLACED: 'bet_placed',
  BET_PLACED_WITH_SESSION: 'bet_placed_with_session',
  TIMEPERIOD_SETTLED: 'timeperiod_settled',
  WINNINGS_CLAIMED_EQUAL: 'winnings_claimed_equal',
  GRID_CREATED: 'grid_created',
} as const;

/**
 * Database query limits
 */
export const QUERY_LIMITS = {
  DEFAULT: 100,
  BETS_HISTORY: 50,
  RECENT_BETS: 20,
  LEADERBOARD: 10,
  MAX_FETCH: 1000,
} as const;

/**
 * Realtime channel names
 */
export const REALTIME_CHANNELS = {
  BETS: 'bets-channel',
  POSITIONS: 'positions-channel',
  PRICE: 'price-channel',
  ALL_USERS_BETS: 'all-users-bets-channel',
  REALTIME_BETS: 'realtime-bets',
} as const;

/**
 * Database field names
 * Prevents typos in field references
 */
export const DB_FIELDS = {
  WALLET_ADDRESS: 'wallet_address',
  USER_ADDRESS: 'user_address',
  GRID_INDEX: 'grid_index',
  GRID_ID: 'grid_id',
  BET_AMOUNT: 'bet_amount',
  AMOUNT: 'amount',
  SESSION_ID: 'session_id',
  SESSION_KEY: 'session_key',
  CREATED_AT: 'created_at',
  BET_PLACED_AT: 'bet_placed_at',
  CHAIN_ID: 'chain_id',
  IS_ACTIVE: 'is_active',
  TIMEPERIOD_ID: 'timeperiod_id',
  PRICE_MIN: 'price_min',
  PRICE_MAX: 'price_max',
  START_TIME: 'start_time',
  END_TIME: 'end_time',
} as const;

/**
 * Realtime subscription configuration
 */
export const REALTIME_CONFIG = {
  EVENTS_PER_SECOND: 10,
  MAX_CHANNELS: 100,
} as const;
