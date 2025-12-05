-- ============================================
-- POINTS SYSTEM BACKFILL
-- Run this to award points for existing data
-- ============================================

-- STEP 1: Award referral points for existing users
-- This awards 10 points to each referrer for every user who has used their referral code
-- Using a subquery approach (PostgreSQL doesn't allow GROUP BY in UPDATE directly)
UPDATE users AS referrer
SET xp = COALESCE(xp, 0) + (
  SELECT COUNT(*) * 10
  FROM users AS referred
  WHERE referred.used_referral = referrer.user_referral
)
WHERE referrer.user_referral IS NOT NULL 
  AND referrer.user_referral != ''
  AND EXISTS (
    SELECT 1 
    FROM users AS referred
    WHERE referred.used_referral = referrer.user_referral
  );

-- Alternative approach using DO block (use this if the above doesn't work):
-- Award 10 points per referral
DO $$
DECLARE
  referrer_record RECORD;
  referral_count INTEGER;
BEGIN
  FOR referrer_record IN 
    SELECT wallet_address, user_referral
    FROM users
    WHERE user_referral IS NOT NULL AND user_referral != ''
  LOOP
    -- Count how many users have used this referral code
    SELECT COUNT(*) INTO referral_count
    FROM users
    WHERE used_referral = referrer_record.user_referral;
    
    -- Award 10 points per referral
    IF referral_count > 0 THEN
      UPDATE users
      SET xp = COALESCE(xp, 0) + (referral_count * 10)
      WHERE wallet_address = referrer_record.wallet_address;
      
      RAISE NOTICE 'Awarded % points to user % for % referrals', 
                   (referral_count * 10), 
                   referrer_record.wallet_address, 
                   referral_count;
    END IF;
  END LOOP;
END $$;

-- STEP 2: Award 100 points bonus for users with trading_volume >= 100
-- This awards the one-time 100+ volume bonus to users who already have >= 100 volume
-- Note: Adjust column name if your table uses 'volume_100_bonus_award' instead of 'volume_100_bonus_awarded'

-- First, check which column name exists (run this to see):
-- SELECT column_name FROM information_schema.columns 
-- WHERE table_name = 'users' AND column_name LIKE 'volume_100_bonus%';

-- If column is 'volume_100_bonus_awarded':
UPDATE users
SET xp = COALESCE(xp, 0) + 100,
    volume_100_bonus_awarded = TRUE
WHERE trading_volume >= 100
  AND (volume_100_bonus_awarded IS NULL OR volume_100_bonus_awarded = FALSE);

-- If column is 'volume_100_bonus_award' (uncomment and use this instead):
-- UPDATE users
-- SET xp = COALESCE(xp, 0) + 100,
--     volume_100_bonus_award = TRUE
-- WHERE trading_volume >= 100
--   AND (volume_100_bonus_award IS NULL OR volume_100_bonus_award = FALSE);

-- ============================================
-- VERIFICATION QUERIES
-- Run these to check the results
-- ============================================

-- Check your points and referrals:
-- SELECT 
--   wallet_address,
--   user_referral,
--   xp,
--   trading_volume,
--   volume_100_bonus_awarded,
--   (SELECT COUNT(*) FROM users WHERE used_referral = users.user_referral) as referral_count
-- FROM users
-- WHERE user_referral = 'MERCURY_AIAN01'; -- Replace with your referral code

-- Check all users with their points breakdown:
-- SELECT 
--   wallet_address,
--   user_referral,
--   xp,
--   trading_volume,
--   volume_100_bonus_awarded,
--   (SELECT COUNT(*) FROM users WHERE used_referral = users.user_referral) as num_referrals_used
-- FROM users
-- ORDER BY xp DESC;

