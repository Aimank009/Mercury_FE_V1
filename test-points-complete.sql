-- ============================================
-- COMPLETE POINTS TEST QUERY
-- Copy and paste this entire block into Supabase SQL Editor
-- Replace the wallet address with the one you want to test
-- ============================================

DO $$
DECLARE
  test_wallet TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- CHANGE THIS to your test wallet
  old_volume NUMERIC;
  old_points INTEGER;
  new_volume NUMERIC := 50; -- Set to $50 for testing
  points_to_add INTEGER;
  new_points INTEGER;
BEGIN
  -- Get current state
  SELECT COALESCE(trading_volume, 0), COALESCE(xp, 0) INTO old_volume, old_points
  FROM users
  WHERE wallet_address = test_wallet;
  
  RAISE NOTICE '=== BEFORE UPDATE ===';
  RAISE NOTICE 'Wallet: %', test_wallet;
  RAISE NOTICE 'Current Volume: $%', old_volume;
  RAISE NOTICE 'Current Points: %', old_points;
  RAISE NOTICE 'Expected Points from Volume: %', FLOOR(old_volume / 10.0)::INTEGER;
  
  -- Calculate how many points should be added
  -- Formula: +1 point per $10 of trading volume
  new_points := FLOOR(new_volume / 10.0)::INTEGER;
  points_to_add := new_points - FLOOR(old_volume / 10.0)::INTEGER;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== UPDATING ===';
  RAISE NOTICE 'New Volume: $%', new_volume;
  RAISE NOTICE 'Points to Add: %', points_to_add;
  
  -- Update volume and points
  UPDATE users
  SET trading_volume = new_volume,
      xp = COALESCE(xp, 0) + points_to_add
  WHERE wallet_address = test_wallet;
  
  -- Get new state
  SELECT COALESCE(trading_volume, 0), COALESCE(xp, 0) INTO old_volume, old_points
  FROM users
  WHERE wallet_address = test_wallet;
  
  RAISE NOTICE '';
  RAISE NOTICE '=== AFTER UPDATE ===';
  RAISE NOTICE 'New Volume: $%', old_volume;
  RAISE NOTICE 'New Total Points: %', old_points;
  RAISE NOTICE 'Points from Volume (1 per $10): %', FLOOR(old_volume / 10.0)::INTEGER;
  RAISE NOTICE '';
  RAISE NOTICE 'NOTE: Total points (xp) includes:';
  RAISE NOTICE '  - Volume points: 1 per $10';
  RAISE NOTICE '  - Referral points: +10 per referral';
  RAISE NOTICE '  - Referral $100 bonus: +100 per referral reaching $100';
  RAISE NOTICE '  - Weekly $100 bonus: +10 per week';
END $$;

-- Show the result with complete breakdown
SELECT 
  wallet_address,
  username,
  user_referral,
  xp as total_points,
  trading_volume as volume,
  -- Calculate points from different sources
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as points_from_volume,
  (SELECT COUNT(*) * 10 FROM users WHERE used_referral LIKE '%' || u.user_referral || '%' OR used_referral = u.user_referral) as points_from_referrals,
  COALESCE(array_length(referral_100_bonus_tracked, 1), 0) * 100 as points_from_referral_100_bonus,
  -- Calculate total expected points
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER + 
  COALESCE((SELECT COUNT(*) * 10 FROM users WHERE used_referral LIKE '%' || u.user_referral || '%' OR used_referral = u.user_referral), 0) +
  COALESCE(array_length(referral_100_bonus_tracked, 1), 0) * 100 as total_expected_points,
  -- Status
  CASE 
    WHEN xp >= FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER THEN '✅ Volume points OK'
    ELSE '❌ Volume points missing'
  END as volume_status,
  CASE 
    WHEN xp >= (FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER + 
                COALESCE((SELECT COUNT(*) * 10 FROM users WHERE used_referral LIKE '%' || u.user_referral || '%' OR used_referral = u.user_referral), 0)) THEN '✅ Referral points OK'
    ELSE '❌ Referral points missing'
  END as referral_status,
  CASE 
    WHEN COALESCE(array_length(referral_100_bonus_tracked, 1), 0) > 0 THEN 
      '✅ ' || COALESCE(array_length(referral_100_bonus_tracked, 1), 0)::TEXT || ' referral(s) reached $100'
    ELSE 'No referrals at $100 yet'
  END as referral_100_status
FROM users u
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- CHANGE THIS to match above

