// ========================================
// TRADING CONFIGURATION
// ========================================

/**
 * Global price step configuration for grid cells
 * This value determines the height/range of each grid cell
 * Change this value in ONE place to update across the entire application
 */
export const PRICE_STEP = 0.008;

/**
 * Price decimals for display
 */
export const PRICE_DECIMALS = 3;

/**
 * Grid configuration constants
 */
export const GRID_CONFIG = {
  TOTAL_CELLS: 50,
  VISIBLE_CELLS: 11,
  CENTER_INDEX: 5,
  MIN_INDEX: -50,
  MAX_INDEX: 50,
  CELL_SIZE: 46,
  GRID_SECONDS: 5,
} as const;

/**
 * Chart display configuration
 */
export const CHART_CONFIG = {
  DURATION_SECONDS: 120,
  UPDATE_INTERVAL_MS: 16, // ~60fps for smooth animation (1000ms / 60fps ≈ 16ms)
  PRICE_RANGE_MULTIPLIER: 100, // For expanded price range view
} as const;

/**
 * Betting limits and defaults
 */
export const BET_CONFIG = {
  MIN_AMOUNT: '0.0001',
  MAX_AMOUNT: '1000',
  DEFAULT_AMOUNT: '0.1',
  AMOUNT_DECIMALS: 6,
} as const;

/**
 * Session configuration
 */
export const SESSION_CONFIG = {
  DURATION_MS: 24 * 60 * 60 * 1000, // 24 hours
  EXPIRY_CHECK_INTERVAL_MS: 60000, // 1 minute
  AUTO_CREATE: true,
} as const;

/**
 * Multiplier calculation constants
 */
export const MULTIPLIER_CONFIG = {
  BASE_MULTIPLIER: 1.0,
  INCREMENT_PER_STEP: 0.1,
  DECIMAL_PLACES: 2,
} as const;

/**
 * Time window configuration for bets
 */
export const TIME_WINDOW_CONFIG = {
  REALTIME_WINDOW_SECONDS: 300, // 5 minutes total window
  PAST_WINDOW_SECONDS: 150,
  FUTURE_WINDOW_SECONDS: 150,
} as const;
