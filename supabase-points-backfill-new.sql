-- ============================================
-- NEW POINTS SYSTEM BACKFILL
-- Run this AFTER setting up the new points system
-- This awards points for existing data
-- ============================================

-- STEP 1: Award referral points for existing users (+10 per referral)
-- This awards 10 points to each referrer for every user who has used their referral code
DO $$
DECLARE
  referrer_record RECORD;
  referral_count INTEGER;
  referral_code TEXT;
BEGIN
  FOR referrer_record IN 
    SELECT wallet_address, user_referral
    FROM users
    WHERE user_referral IS NOT NULL AND user_referral != ''
  LOOP
    -- Count how many users have used this referral code
    -- Handle format like "14 00: MERCURY_AIAN01" or just "MERCURY_AIAN01"
    SELECT COUNT(*) INTO referral_count
    FROM users
    WHERE used_referral LIKE '%' || referrer_record.user_referral || '%'
       OR used_referral = referrer_record.user_referral;
    
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

-- STEP 2: Award points for own trading volume (+1 per $10)
-- Calculate and award points based on current trading_volume
UPDATE users
SET xp = COALESCE(xp, 0) + FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER
WHERE trading_volume > 0;

-- STEP 3: Award +100 points to referrers whose referrals have reached $100
DO $$
DECLARE
  referral_record RECORD;
  referrer_wallet TEXT;
  referral_code TEXT;
  tracked_referrals TEXT[];
BEGIN
  -- Find all users with trading_volume >= 100 who have a referrer
  FOR referral_record IN 
    SELECT wallet_address, used_referral, trading_volume
    FROM users
    WHERE trading_volume >= 100
      AND used_referral IS NOT NULL
      AND used_referral != ''
  LOOP
    -- Extract referral code
    referral_code := referral_record.used_referral;
    IF referral_code LIKE '%MERCURY_%' THEN
      SELECT (regexp_match(referral_code, 'MERCURY_[A-Z0-9]+'))[1] INTO referral_code;
    ELSE
      referral_code := TRIM(referral_code);
    END IF;
    
    -- Find the referrer
    IF referral_code IS NOT NULL AND referral_code != '' THEN
      SELECT wallet_address, referral_100_bonus_tracked INTO referrer_wallet, tracked_referrals
      FROM users
      WHERE user_referral = referral_code
      LIMIT 1;
      
      -- Check if we already awarded bonus for this referral
      IF referrer_wallet IS NOT NULL THEN
        IF tracked_referrals IS NULL OR NOT (referral_record.wallet_address = ANY(tracked_referrals)) THEN
          -- Award 100 points to referrer
          UPDATE users
          SET xp = COALESCE(xp, 0) + 100,
              referral_100_bonus_tracked = COALESCE(referral_100_bonus_tracked, ARRAY[]::TEXT[]) || referral_record.wallet_address
          WHERE wallet_address = referrer_wallet;
          
          RAISE NOTICE 'Awarded 100 points to referrer % because referral % has volume %', 
                       referrer_wallet, referral_record.wallet_address, referral_record.trading_volume;
        END IF;
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check points distribution:
-- SELECT 
--   wallet_address,
--   user_referral,
--   xp,
--   trading_volume,
--   (SELECT COUNT(*) FROM users WHERE used_referral LIKE '%' || users.user_referral || '%' OR used_referral = users.user_referral) as num_referrals,
--   referral_100_bonus_tracked
-- FROM users
-- ORDER BY xp DESC;

