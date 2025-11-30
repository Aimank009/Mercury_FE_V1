// ========================================
// UI CONFIGURATION
// ========================================

/**
 * Color scheme for bet types
 */
export const BET_COLORS = {
  LONG: {
    background: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500',
    hover: 'hover:bg-green-500/30',
    solid: 'bg-green-500',
  },
  SHORT: {
    background: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500',
    hover: 'hover:bg-red-500/30',
    solid: 'bg-red-500',
  },
  NEUTRAL: {
    background: 'bg-gray-500/20',
    text: 'text-gray-400',
    border: 'border-gray-500',
    hover: 'hover:bg-gray-500/30',
    solid: 'bg-gray-500',
  },
  WIN: {
    background: 'bg-green-500/20',
    text: 'text-green-400',
    border: 'border-green-500',
  },
  LOSS: {
    background: 'bg-red-500/20',
    text: 'text-red-400',
    border: 'border-red-500',
  },
} as const;

/**
 * Animation durations (milliseconds)
 */
export const ANIMATION_DURATION = {
  FAST: 150,
  NORMAL: 300,
  SLOW: 500,
  CHART_UPDATE: 500,
} as const;

/**
 * Toast notification durations (milliseconds)
 */
export const TOAST_DURATION = {
  SUCCESS: 3000,
  ERROR: 5000,
  WARNING: 4000,
  INFO: 3000,
} as const;

/**
 * Breakpoint values (pixels)
 */
export const BREAKPOINTS = {
  SM: 640,
  MD: 768,
  LG: 1024,
  XL: 1280,
  '2XL': 1536,
} as const;

/**
 * Z-index layers
 */
export const Z_INDEX = {
  MODAL: 1000,
  DROPDOWN: 900,
  OVERLAY: 800,
  HEADER: 700,
  TOAST: 1100,
  TOOLTIP: 600,
} as const;

/**
 * Common spacing values
 */
export const SPACING = {
  GRID_GAP: '0.25rem',
  CARD_PADDING: '1rem',
  SECTION_MARGIN: '2rem',
} as const;

/**
 * Chart colors
 */
export const CHART_COLORS = {
  BACKGROUND: '#000000',
  GRID_LINE: 'rgb(39, 102, 49, 0.4)', // Lighter, more visible grid lines
  PRICE_LINE: '#00ff00',
  SELECTED_CELL: 'rgba(255, 255, 0, 0.3)',
  HOVER_CELL: 'rgba(255, 255, 255, 0.1)',
  TEXT: '#ffffffff',
} as const;
