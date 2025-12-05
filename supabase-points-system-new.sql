-- ============================================
-- NEW POINTS SYSTEM AUTOMATION
-- Run these steps ONE AT A TIME to avoid deadlocks
-- ============================================
-- 
-- Points Rules:
-- 1. +10 points to me when someone uses my referral code
-- 2. +100 points to me when a referral's trading volume reaches $100 (one-time per referral)
-- 3. +10 points to me if I do $100 trading volume in a week (weekly bonus)
-- 4. +1 point per $10 of my own trading volume (continuous)
--
-- ============================================

-- STEP 1: Add/Update columns to track points bonuses (run this first)
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS last_weekly_bonus_date DATE,
ADD COLUMN IF NOT EXISTS referral_100_bonus_tracked TEXT[] DEFAULT ARRAY[]::TEXT[]; -- Track which referrals have reached $100

-- STEP 2: Remove old triggers and functions (cleanup)
DO $$
BEGIN
  -- Drop old triggers
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_user_created_award_referral_points') THEN
    DROP TRIGGER on_user_created_award_referral_points ON users;
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_trading_volume_update_award_bonus') THEN
    DROP TRIGGER on_trading_volume_update_award_bonus ON users;
  END IF;
END $$;

-- STEP 3: Create function to award referral points (+10 when someone uses my code)
CREATE OR REPLACE FUNCTION award_referral_points()
RETURNS TRIGGER AS $$
DECLARE
  referrer_wallet TEXT;
BEGIN
  -- When a new user is created with a used_referral code,
  -- find the user who owns that referral code and award them 10 points
  IF NEW.used_referral IS NOT NULL AND NEW.used_referral != '' THEN
    DECLARE
      referral_code TEXT;
    BEGIN
      -- Extract referral code (handle format like "14 00: MERCURY_AIAN01" or just "MERCURY_AIAN01")
      -- Try to find MERCURY_ code in the string
      IF NEW.used_referral LIKE '%MERCURY_%' THEN
        -- Extract the MERCURY_XXXXX part using regex
        SELECT (regexp_match(NEW.used_referral, 'MERCURY_[A-Z0-9]+'))[1] INTO referral_code;
      ELSE
        -- If no MERCURY_ prefix, use the whole string (trimmed)
        referral_code := TRIM(NEW.used_referral);
      END IF;
      
      -- Find the user whose user_referral matches
      IF referral_code IS NOT NULL AND referral_code != '' THEN
        SELECT wallet_address INTO referrer_wallet
        FROM users
        WHERE user_referral = referral_code
        LIMIT 1;
        
        -- If we found the referrer, award them 10 points
        IF referrer_wallet IS NOT NULL THEN
          UPDATE users
          SET xp = COALESCE(xp, 0) + 10
          WHERE wallet_address = referrer_wallet;
          
          RAISE NOTICE 'Awarded 10 points to referrer % for referral code %', referrer_wallet, referral_code;
        END IF;
      END IF;
    END;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 4: Create trigger for referral points (run after STEP 3)
CREATE TRIGGER on_user_created_award_referral_points
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION award_referral_points();

-- STEP 5: Update the trading volume function to award points for own trading
-- +1 point per $10 of trading volume
CREATE OR REPLACE FUNCTION update_user_trading_volume()
RETURNS TRIGGER AS $$
DECLARE
  new_volume NUMERIC;
  old_volume NUMERIC;
  volume_increase NUMERIC;
  points_to_award INTEGER;
  current_xp INTEGER;
BEGIN
  -- Get current volume before update
  SELECT COALESCE(trading_volume, 0), COALESCE(xp, 0) INTO old_volume, current_xp
  FROM users
  WHERE wallet_address = NEW.user_address;
  
  -- Calculate new volume
  volume_increase := NEW.amount::numeric / 1000000.0;
  new_volume := old_volume + volume_increase;
  
  -- Update the user's trading volume
  UPDATE users
  SET trading_volume = new_volume
  WHERE wallet_address = NEW.user_address;
  
  -- Award points: +1 point per $10 of trading volume
  -- Calculate how many $10 increments we've crossed
  points_to_award := FLOOR(new_volume / 10.0)::INTEGER - FLOOR(old_volume / 10.0)::INTEGER;
  
  IF points_to_award > 0 THEN
    UPDATE users
    SET xp = COALESCE(xp, 0) + points_to_award
    WHERE wallet_address = NEW.user_address;
    
    RAISE NOTICE 'Awarded % points to user % for trading volume increase (new volume: %)', 
                 points_to_award, NEW.user_address, new_volume;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 5b: Create trigger for trading volume update (run after STEP 5)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_bet_placed_update_volume') THEN
    DROP TRIGGER on_bet_placed_update_volume ON bet_placed_with_session;
  END IF;
END $$;

CREATE TRIGGER on_bet_placed_update_volume
AFTER INSERT ON bet_placed_with_session
FOR EACH ROW
EXECUTE FUNCTION update_user_trading_volume();

-- STEP 6: Create function to check if referral reached $100 and award +100 points to referrer
CREATE OR REPLACE FUNCTION check_referral_100_bonus()
RETURNS TRIGGER AS $$
DECLARE
  referrer_wallet TEXT;
  referral_code TEXT;
  new_volume NUMERIC;
  old_volume NUMERIC;
  tracked_referrals TEXT[];
  bet_amount NUMERIC;
  old_milestone INTEGER;
  new_milestone INTEGER;
  milestones_crossed INTEGER;
BEGIN
  -- Calculate bet amount in USD
  bet_amount := NEW.amount::numeric / 1000000.0;
  
  -- Get the user's current volume (already updated by update_user_trading_volume trigger)
  SELECT COALESCE(trading_volume, 0) INTO new_volume
  FROM users
  WHERE wallet_address = NEW.user_address;
  
  -- Calculate old volume (before this bet)
  old_volume := new_volume - bet_amount;
  
  -- Check if this user crossed any $100 milestone ($100, $200, $300, etc.)
  -- Award +100 points to referrer for every $100 milestone
  IF new_volume >= 100 AND NEW.user_address IS NOT NULL THEN
    -- Find who referred this user
    SELECT used_referral INTO referral_code
    FROM users
    WHERE wallet_address = NEW.user_address;
    
    -- Extract referral code if it has timestamp prefix (format: "14 00: MERCURY_AIAN01")
    IF referral_code IS NOT NULL AND referral_code != '' THEN
      IF referral_code LIKE '%MERCURY_%' THEN
        -- Extract the MERCURY_XXXXX part using regex
        SELECT (regexp_match(referral_code, 'MERCURY_[A-Z0-9]+'))[1] INTO referral_code;
      ELSE
        referral_code := TRIM(referral_code);
      END IF;
    END IF;
    
    -- Find the referrer
    IF referral_code IS NOT NULL AND referral_code != '' THEN
      SELECT wallet_address INTO referrer_wallet
      FROM users
      WHERE user_referral = referral_code
      LIMIT 1;
      
      -- Calculate how many $100 milestones were crossed
      -- Old milestone: FLOOR(old_volume / 100.0)
      -- New milestone: FLOOR(new_volume / 100.0)
      -- Award points for each new milestone crossed
      IF referrer_wallet IS NOT NULL THEN
        old_milestone := FLOOR(old_volume / 100.0)::INTEGER;
        new_milestone := FLOOR(new_volume / 100.0)::INTEGER;
        milestones_crossed := new_milestone - old_milestone;
        
        -- Award 100 points for each $100 milestone crossed
        IF milestones_crossed > 0 THEN
          UPDATE users
          SET xp = COALESCE(xp, 0) + (milestones_crossed * 100)
          WHERE wallet_address = referrer_wallet;
          
          RAISE NOTICE 'Awarded % points (100 per milestone) to referrer % because referral % crossed % milestone(s) (volume: $% → $%)', 
                       (milestones_crossed * 100), referrer_wallet, NEW.user_address, milestones_crossed, old_volume, new_volume;
        END IF;
      END IF;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- STEP 7: Create trigger to check referral $100 bonus (run after STEP 6)
-- Drop old trigger if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_bet_placed_check_referral_bonus') THEN
    DROP TRIGGER on_bet_placed_check_referral_bonus ON bet_placed_with_session;
    RAISE NOTICE 'Dropped old referral bonus trigger';
  END IF;
END $$;

CREATE TRIGGER on_bet_placed_check_referral_bonus
AFTER INSERT ON bet_placed_with_session
FOR EACH ROW
EXECUTE FUNCTION check_referral_100_bonus();

-- STEP 8: Create function to award weekly $100 bonus (+10 points)
CREATE OR REPLACE FUNCTION award_weekly_100_bonus()
RETURNS void AS $$
DECLARE
  user_record RECORD;
  week_start DATE;
  week_end DATE;
  weekly_volume NUMERIC;
BEGIN
  -- Calculate current week (Monday to Sunday)
  week_start := DATE_TRUNC('week', CURRENT_DATE)::DATE;
  week_end := week_start + INTERVAL '6 days';
  
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

-- STEP 9: Set up pg_cron to run weekly bonus automatically (optional)
-- First, check if pg_cron is available:
-- SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- If pg_cron is available, uncomment and run this:
/*
SELECT cron.schedule(
  'weekly-100-bonus',
  '0 0 * * 5', -- Every Friday at midnight UTC
  $$SELECT award_weekly_100_bonus();$$
);
*/

-- ============================================
-- MANUAL EXECUTION (Alternative if pg_cron not available)
-- ============================================
-- Run this manually every Friday:
-- SELECT award_weekly_100_bonus();

-- ============================================
-- TESTING QUERIES
-- ============================================
-- Check points distribution:
-- SELECT wallet_address, user_referral, xp, trading_volume, referral_100_bonus_tracked 
-- FROM users 
-- ORDER BY xp DESC;

