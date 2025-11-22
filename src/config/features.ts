// ========================================
// FEATURE FLAGS CONFIGURATION
// ========================================

/**
 * Feature flags for enabling/disabling features
 * Change these values to enable/disable features across the application
 */
export const FEATURES = {
  // Trading features
  MULTI_SELECT: true,
  ONE_CLICK_TRADING: true,
  REAL_TIME_UPDATES: true,
  GRID_PERSISTENCE: true,
  
  // Development features
  MOCK_MODE: process.env.NEXT_PUBLIC_MOCK_MODE === 'true',
  DEBUG_MODE: process.env.NODE_ENV === 'development',
  VERBOSE_LOGGING: process.env.NODE_ENV === 'development',
  
  // Communication features
  WEBSOCKET_ENABLED: true,
  ERROR_REPORTING: true,
  ANALYTICS: false,
  
  // UI features
  TUTORIAL_ENABLED: true,
  TERMS_MODAL_ENABLED: true,
  ONBOARDING_ENABLED: true,
} as const;

/**
 * Check if feature is enabled
 */
export function isFeatureEnabled(feature: keyof typeof FEATURES): boolean {
  return FEATURES[feature] === true;
}

/**
 * Development mode checks
 */
export const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';
export const IS_PRODUCTION = process.env.NODE_ENV === 'production';
export const IS_TEST = process.env.NODE_ENV === 'test';
