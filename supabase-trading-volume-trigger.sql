-- ============================================
-- TRADING VOLUME AUTOMATION SETUP
-- Run these steps ONE AT A TIME to avoid deadlocks
-- ============================================

-- STEP 1: Add trading_volume column and bonus tracking (run this first)
-- Run this separately and wait for it to complete
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS trading_volume NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS volume_100_bonus_awarded BOOLEAN DEFAULT FALSE;

-- STEP 2: Create function (run this after STEP 1 completes)
-- Run this separately
-- NOTE: Points logic is now handled in supabase-points-system-new.sql
-- This function only updates trading_volume
CREATE OR REPLACE FUNCTION update_user_trading_volume()
RETURNS TRIGGER AS $$
DECLARE
  new_volume NUMERIC;
  old_volume NUMERIC;
BEGIN
  -- Get current volume before update
  SELECT COALESCE(trading_volume, 0) INTO old_volume
  FROM users
  WHERE wallet_address = NEW.user_address;
  
  -- Calculate new volume
  new_volume := old_volume + (NEW.amount::numeric / 1000000.0);
  
  -- Update the user's trading volume
  -- Convert TEXT amount to NUMERIC and divide by 1,000,000 (since amount is stored in 6 decimals)
  -- We match user_address from bet table to wallet_address in users table
  UPDATE users
  SET trading_volume = new_volume
  WHERE wallet_address = NEW.user_address;
  
  -- Points are now handled by separate triggers in points-system-new.sql
  -- +1 point per $10 is handled in update_user_trading_volume() in points-system-new.sql
  -- Referral $100 bonus is handled by check_referral_100_bonus() trigger
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 3: Drop existing trigger if it exists (run this after STEP 2)
-- Run this separately - wait a few seconds if you get a deadlock, then retry
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'on_bet_placed_update_volume'
  ) THEN
    DROP TRIGGER on_bet_placed_update_volume ON bet_placed_with_session;
  END IF;
END $$;

-- STEP 4: Create the trigger (run this after STEP 3 completes)
-- Run this separately
CREATE TRIGGER on_bet_placed_update_volume
AFTER INSERT ON bet_placed_with_session
FOR EACH ROW
EXECUTE FUNCTION update_user_trading_volume();

-- ============================================
-- OPTIONAL: Backfill existing data
-- Run this AFTER all steps above are complete
-- This calculates trading_volume for all existing bets
-- ============================================
UPDATE users
SET trading_volume = COALESCE(
  (
    SELECT SUM(amount::numeric / 1000000.0)
    FROM bet_placed_with_session
    WHERE bet_placed_with_session.user_address = users.wallet_address
  ),
  0
);

