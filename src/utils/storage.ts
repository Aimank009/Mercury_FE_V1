// ========================================
// STORAGE UTILITIES
// ========================================

import { STORAGE_KEYS, CACHE_EXPIRY } from '../config';
import { safeJsonParse } from './format';

/**
 * Local storage wrapper with error handling
 */
export const storage = {
  /**
   * Get item from local storage
   */
  get<T>(key: string, fallback?: T): T | null {
    if (typeof window === 'undefined') return fallback || null;
    
    try {
      const item = localStorage.getItem(key);
      if (!item) return fallback || null;
      
      try {
        return JSON.parse(item);
      } catch {
        return item as unknown as T;
      }
    } catch {
      return fallback || null;
    }
  },

  /**
   * Set item in local storage
   */
  set(key: string, value: any): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      localStorage.setItem(key, serialized);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Remove item from local storage
   */
  remove(key: string): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Clear all items
   */
  clear(): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      localStorage.clear();
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(key) !== null;
  },
};

/**
 * Session storage wrapper
 */
export const sessionStorage = {
  get<T>(key: string, fallback?: T): T | null {
    if (typeof window === 'undefined') return fallback || null;
    
    try {
      const item = window.sessionStorage.getItem(key);
      if (!item) return fallback || null;
      return safeJsonParse(item, fallback || null);
    } catch {
      return fallback || null;
    }
  },

  set(key: string, value: any): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      window.sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key: string): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      window.sessionStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  clear(): boolean {
    if (typeof window === 'undefined') return false;
    
    try {
      window.sessionStorage.clear();
      return true;
    } catch {
      return false;
    }
  },
};

/**
 * Cache utilities with expiration
 */
export const cache = {
  /**
   * Get cached item with expiration check
   */
  get<T>(key: string, expiryMs: number = CACHE_EXPIRY.POSITIONS): T | null {
    const cached = storage.get<{ data: T; timestamp: number }>(key);
    
    if (!cached) return null;
    
    const now = Date.now();
    const isExpired = now - cached.timestamp > expiryMs;
    
    if (isExpired) {
      storage.remove(key);
      return null;
    }
    
    return cached.data;
  },

  /**
   * Set cached item with timestamp
   */
  set<T>(key: string, data: T): boolean {
    return storage.set(key, {
      data,
      timestamp: Date.now(),
    });
  },

  /**
   * Clear expired cache entries
   */
  clearExpired(): void {
    if (typeof window === 'undefined') return;
    
    // This would need to be implemented based on your cache key patterns
    // For now, it's a placeholder
  },
};

/**
 * User amount helpers
 */
export const userAmount = {
  get(): string {
    return storage.get<string>(STORAGE_KEYS.USER_AMOUNT) || '0.1';
  },

  set(amount: string): boolean {
    return storage.set(STORAGE_KEYS.USER_AMOUNT, amount);
  },
};

/**
 * Session helpers
 */
export const sessionHelpers = {
  get(address: string): any {
    const key = typeof STORAGE_KEYS.TRADING_SESSION === 'function' 
      ? STORAGE_KEYS.TRADING_SESSION(address)
      : STORAGE_KEYS.MERCURY_SESSION;
    return storage.get(key);
  },

  set(address: string, data: any): boolean {
    const key = typeof STORAGE_KEYS.TRADING_SESSION === 'function'
      ? STORAGE_KEYS.TRADING_SESSION(address)
      : STORAGE_KEYS.MERCURY_SESSION;
    return storage.set(key, data);
  },

  remove(address: string): boolean {
    const key = typeof STORAGE_KEYS.TRADING_SESSION === 'function'
      ? STORAGE_KEYS.TRADING_SESSION(address)
      : STORAGE_KEYS.MERCURY_SESSION;
    return storage.remove(key);
  },
};

/**
 * Nonce helpers
 */
export const nonceHelpers = {
  get(address: string, chainId: number): number | null {
    const key = STORAGE_KEYS.NONCE(address, chainId);
    return storage.get<number>(key);
  },

  set(address: string, chainId: number, nonce: number): boolean {
    const key = STORAGE_KEYS.NONCE(address, chainId);
    return storage.set(key, nonce);
  },

  increment(address: string, chainId: number): number {
    const current = this.get(address, chainId) || 0;
    const next = current + 1;
    this.set(address, chainId, next);
    return next;
  },
};
