// ========================================
// API CONFIGURATION
// ========================================

/**
 * API base URLs
 */
export const API_URLS = {
  BACKEND: process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3000',
  RELAYER: process.env.NEXT_PUBLIC_RELAYER_URL || 'http://localhost:8080',
  WEBSOCKET: process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080',
  REALTIME_WS: process.env.NEXT_PUBLIC_REALTIME_WS_URL || 'ws://localhost:8080',
  SUPABASE: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
} as const;

/**
 * API endpoints structure
 */
export const API_ENDPOINTS = {
  // Price endpoints
  PRICE: {
    CURRENT: '/api/price',
    HISTORY: '/api/price/history',
    WS: '/ws/prices',
  },
  
  // Session endpoints
  SESSION: {
    CREATE: '/api/session',
    GET: (id: string) => `/api/session/${id}`,
    VALIDATE: '/api/session/validate',
  },
  
  // Bet endpoints
  BET: {
    PLACE: '/api/bet',
    HISTORY: '/api/bet/history',
    USER_BETS: (address: string) => `/api/bet/user/${address}`,
  },
  
  // Grid endpoints
  GRID: {
    POSITIONS: '/api/grid/positions',
    SAVE: '/api/grid/save',
    PREDICTIONS: '/api/grid/predictions',
  },
  
  // Health check
  HEALTH: '/health',
} as const;

/**
 * Request configuration
 */
export const REQUEST_CONFIG = {
  TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 1000,
  BACKOFF_MULTIPLIER: 2,
} as const;

/**
 * WebSocket configuration
 */
export const WS_CONFIG = {
  RECONNECT_INTERVAL_MS: 5000,
  MAX_RECONNECT_ATTEMPTS: 5,
  PING_INTERVAL_MS: 30000,
  PONG_TIMEOUT_MS: 5000,
} as const;
