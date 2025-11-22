import { createClient } from '@supabase/supabase-js';
import { SUPABASE_CONFIG, REALTIME_CONFIG } from '../config';

if (!SUPABASE_CONFIG.URL || !SUPABASE_CONFIG.ANON_KEY) {
  console.error('❌ Supabase credentials not found in environment variables');
  console.error('URL:', SUPABASE_CONFIG.URL ? 'Set' : 'Missing');
  console.error('ANON_KEY:', SUPABASE_CONFIG.ANON_KEY ? 'Set' : 'Missing');
  console.error('Please check your .env file and restart the development server');
} else {
  console.log('✅ Supabase configured:', SUPABASE_CONFIG.URL);
}

// Create Supabase client with proper configuration
export const supabase = createClient(
  SUPABASE_CONFIG.URL || 'https://placeholder.supabase.co', 
  SUPABASE_CONFIG.ANON_KEY || 'placeholder-key', 
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: {
        eventsPerSecond: REALTIME_CONFIG.EVENTS_PER_SECOND,
      },
    },
    global: {
      headers: {
        'x-client-info': 'mercury-trading-app',
      },
    },
  }
);

export interface BetPlacedWithSession {
  id: number;
  event_id: string;
  user_address: string;
  session_key: string;
  timeperiod_id: string;
  grid_id: string;
  amount: string;
  shares_received: string;
  price_min: string;
  price_max: string;
  start_time: string;
  end_time: string;
  block_number: number | null;
  timestamp: string | null;
  created_at: string;
  // Win/Loss tracking columns
  status?: 'pending' | 'confirmed' | 'won' | 'lost';
  settled_at?: string | null;
  settlement_price?: string | null;
  multiplier?: number | string | null;
}
