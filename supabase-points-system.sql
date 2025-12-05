-- ============================================
-- POINTS SYSTEM AUTOMATION
-- Run these steps ONE AT A TIME to avoid deadlocks
-- ============================================

-- STEP 1: Add columns to track points bonuses (run this first)
-- This helps prevent duplicate bonuses
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS volume_100_bonus_awarded BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_weekly_bonus_date DATE;

-- STEP 2: Create function to award referral points (10 points)
-- Run this after STEP 1 completes
CREATE OR REPLACE FUNCTION award_referral_points()
RETURNS TRIGGER AS $$
DECLARE
  referrer_wallet TEXT;
BEGIN
  -- When a new user is created with a used_referral code,
  -- find the user who owns that referral code and award them 10 points
  IF NEW.used_referral IS NOT NULL AND NEW.used_referral != '' THEN
    -- Find the user whose user_referral matches the new user's used_referral
    SELECT wallet_address INTO referrer_wallet
    FROM users
    WHERE user_referral = NEW.used_referral
    LIMIT 1;
    
    -- If we found the referrer, award them 10 points
    IF referrer_wallet IS NOT NULL THEN
      UPDATE users
      SET xp = COALESCE(xp, 0) + 10
      WHERE wallet_address = referrer_wallet;
      
      RAISE NOTICE 'Awarded 10 points to referrer % for referral code %', referrer_wallet, NEW.used_referral;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 3: Create trigger for referral points (run after STEP 2)
-- Run this separately
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'on_user_created_award_referral_points'
  ) THEN
    DROP TRIGGER on_user_created_award_referral_points ON users;
  END IF;
END $$;

CREATE TRIGGER on_user_created_award_referral_points
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION award_referral_points();

-- STEP 4: Note - The 100 points bonus for trading_volume >= 100 is handled
-- automatically in the update_user_trading_volume() function (see trading-volume-trigger.sql)
-- No separate trigger needed!

-- STEP 5: Create function to award weekly Friday bonus (10 points)
-- Run this after STEP 4 completes
CREATE OR REPLACE FUNCTION award_weekly_friday_bonus()
RETURNS void AS $$
DECLARE
  user_record RECORD;
  week_start DATE;
  week_end DATE;
  weekly_volume NUMERIC;
BEGIN
  -- Calculate current week (Monday to Sunday)
  -- Get the most recent Monday
  week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
  -- If today is Friday, use this week; otherwise use last week
  IF EXTRACT(DOW FROM CURRENT_DATE) = 5 THEN -- Friday = 5
    week_end := week_start + INTERVAL '6 days';
  ELSE
    -- If not Friday, we're probably running this manually or on a different day
    -- Find the most recent Friday
    week_start := CURRENT_DATE - (EXTRACT(DOW FROM CURRENT_DATE)::INTEGER + 2) % 7;
    week_end := week_start + INTERVAL '6 days';
  END IF;
  
  RAISE NOTICE 'Checking weekly volume for week % to %', week_start, week_end;
  
  -- Loop through all users
  FOR user_record IN 
    SELECT wallet_address, last_weekly_bonus_date
    FROM users
  LOOP
    -- Check if we already awarded bonus for this week
    IF user_record.last_weekly_bonus_date IS NULL 
       OR user_record.last_weekly_bonus_date < week_start THEN
      
      -- Calculate weekly trading volume for this user
      SELECT COALESCE(SUM(amount::numeric / 1000000.0), 0) INTO weekly_volume
      FROM bet_placed_with_session
      WHERE user_address = user_record.wallet_address
        AND created_at >= week_start
        AND created_at < week_end + INTERVAL '1 day';
      
      -- If weekly volume >= 100, award 10 points
      IF weekly_volume >= 100 THEN
        UPDATE users
        SET xp = COALESCE(xp, 0) + 10,
            last_weekly_bonus_date = CURRENT_DATE
        WHERE wallet_address = user_record.wallet_address;
        
        RAISE NOTICE 'Awarded 10 points to user % for weekly volume of %', 
                     user_record.wallet_address, weekly_volume;
      END IF;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- STEP 6: Set up pg_cron to run weekly Friday bonus automatically
-- This requires pg_cron extension to be enabled in Supabase
-- Run this after STEP 5 completes
-- Note: Supabase may need to enable pg_cron extension first

-- First, check if pg_cron is available (run this to check):
-- SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- If pg_cron is available, uncomment and run this:
/*
-- Schedule to run every Friday at 00:00 UTC (adjust timezone as needed)
SELECT cron.schedule(
  'weekly-friday-bonus',
  '0 0 * * 5', -- Every Friday at midnight UTC
  $$SELECT award_weekly_friday_bonus();$$
);
*/

-- ============================================
-- MANUAL EXECUTION (Alternative if pg_cron not available)
-- ============================================
-- If pg_cron is not available, you can manually run this function every Friday:
-- SELECT award_weekly_friday_bonus();

-- ============================================
-- TESTING QUERIES
-- ============================================
-- Test referral points (simulate a new user using a referral):
-- INSERT INTO users (wallet_address, username, used_referral, user_referral, xp)
-- VALUES ('0xTEST123', 'TestUser', 'MERCURY_AIAN01', 'MERCURY_TEST01', 0);

-- Check if points were awarded:
-- SELECT wallet_address, username, xp, num_referral FROM users WHERE user_referral = 'MERCURY_AIAN01';

-- Test volume bonus (manually set trading_volume to 100):
-- UPDATE users SET trading_volume = 100 WHERE wallet_address = '0xTEST123';
-- SELECT wallet_address, xp, volume_100_bonus_awarded FROM users WHERE wallet_address = '0xTEST123';

-- Test weekly bonus manually:
-- SELECT award_weekly_friday_bonus();

