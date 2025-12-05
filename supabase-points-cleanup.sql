-- ============================================
-- CLEANUP OLD POINTS SYSTEM
-- Run this FIRST to remove old triggers and functions
-- ============================================

-- Drop old triggers
DO $$
BEGIN
  -- Drop old referral points trigger
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_user_created_award_referral_points') THEN
    DROP TRIGGER on_user_created_award_referral_points ON users;
    RAISE NOTICE 'Dropped old referral points trigger';
  END IF;
  
  -- Drop old volume bonus trigger
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_trading_volume_update_award_bonus') THEN
    DROP TRIGGER on_trading_volume_update_award_bonus ON users;
    RAISE NOTICE 'Dropped old volume bonus trigger';
  END IF;
  
  -- Drop old bet placed volume trigger (we'll recreate it)
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_bet_placed_update_volume') THEN
    DROP TRIGGER on_bet_placed_update_volume ON bet_placed_with_session;
    RAISE NOTICE 'Dropped old trading volume trigger';
  END IF;
  
  -- Drop old referral bonus trigger (if exists)
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'on_bet_placed_check_referral_bonus') THEN
    DROP TRIGGER on_bet_placed_check_referral_bonus ON bet_placed_with_session;
    RAISE NOTICE 'Dropped old referral bonus trigger';
  END IF;
  
  RAISE NOTICE 'Cleanup complete. Now run supabase-points-system-new.sql';
END $$;

-- Drop old functions (optional - they'll be replaced)
-- DROP FUNCTION IF EXISTS award_referral_points();
-- DROP FUNCTION IF EXISTS award_volume_100_bonus();
-- DROP FUNCTION IF EXISTS award_weekly_friday_bonus();
-- DROP FUNCTION IF EXISTS update_user_trading_volume();
-- DROP FUNCTION IF EXISTS check_referral_100_bonus();

