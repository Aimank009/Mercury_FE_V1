-- ============================================
-- COMPLETE POINTS SYSTEM TEST
-- This tests all 4 point rules
-- ============================================

-- SETUP: Replace these with your actual test wallet addresses
-- User 1 = Referrer (you)
-- User 2 = Referral (someone who used your code)

\set user1_wallet '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f'  -- CHANGE THIS - Your wallet
\set user2_wallet '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'  -- CHANGE THIS - Referral wallet

-- ============================================
-- TEST 1: Check initial state
-- ============================================
SELECT 
  '=== INITIAL STATE ===' as test_phase,
  wallet_address,
  username,
  user_referral,
  xp as current_points,
  trading_volume as current_volume
FROM users
WHERE wallet_address IN (:user1_wallet, :user2_wallet)
ORDER BY wallet_address;

-- ============================================
-- TEST 2: Test +1 point per $10 trading volume (User 2)
-- ============================================
DO $$
DECLARE
  test_wallet TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- User 2
  old_vol NUMERIC;
  old_pts INTEGER;
  new_vol NUMERIC := 25; -- Set to $25 (should give 2 points: $10=$1, $20=$2)
  pts_to_add INTEGER;
BEGIN
  SELECT COALESCE(trading_volume, 0), COALESCE(xp, 0) INTO old_vol, old_pts
  FROM users WHERE wallet_address = test_wallet;
  
  pts_to_add := FLOOR(new_vol / 10.0)::INTEGER - FLOOR(old_vol / 10.0)::INTEGER;
  
  UPDATE users
  SET trading_volume = new_vol,
      xp = COALESCE(xp, 0) + pts_to_add
  WHERE wallet_address = test_wallet;
  
  RAISE NOTICE 'TEST 2: Volume $% → $%, Added % points (expected: 2 points for $25)', old_vol, new_vol, pts_to_add;
END $$;

-- Check result
SELECT 
  '=== AFTER TEST 2: Volume Points ===' as test_phase,
  wallet_address,
  username,
  xp as points,
  trading_volume as volume,
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as expected_volume_points,
  CASE WHEN xp >= FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER THEN '✅' ELSE '❌' END as status
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39';

-- ============================================
-- TEST 3: Test referral $100 milestone bonus (User 2 reaches $100)
-- ============================================
DO $$
DECLARE
  user2_wallet TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39';
  user1_wallet TEXT := '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f';
  user1_old_pts INTEGER;
  user2_old_vol NUMERIC;
  new_vol NUMERIC := 105; -- Push over $100
  pts_to_add INTEGER;
BEGIN
  -- Get User 1's current points
  SELECT COALESCE(xp, 0) INTO user1_old_pts
  FROM users WHERE wallet_address = user1_wallet;
  
  -- Get User 2's current volume
  SELECT COALESCE(trading_volume, 0) INTO user2_old_vol
  FROM users WHERE wallet_address = user2_wallet;
  
  -- Calculate points User 2 should get from volume
  pts_to_add := FLOOR(new_vol / 10.0)::INTEGER - FLOOR(user2_old_vol / 10.0)::INTEGER;
  
  -- Update User 2's volume
  UPDATE users
  SET trading_volume = new_vol,
      xp = COALESCE(xp, 0) + pts_to_add
  WHERE wallet_address = user2_wallet;
  
  -- Calculate milestones crossed
  DECLARE
    old_milestone INTEGER;
    new_milestone INTEGER;
    milestones_crossed INTEGER;
  BEGIN
    old_milestone := FLOOR(user2_old_vol / 100.0)::INTEGER;
    new_milestone := FLOOR(new_vol / 100.0)::INTEGER;
    milestones_crossed := new_milestone - old_milestone;
    
    -- Award milestone bonus to User 1
    IF milestones_crossed > 0 THEN
      UPDATE users
      SET xp = COALESCE(xp, 0) + (milestones_crossed * 100)
      WHERE wallet_address = user1_wallet;
      
      RAISE NOTICE 'TEST 3: User 2 volume $% → $%, User 1 should get +% points (crossed % milestone(s))', 
                   user2_old_vol, new_vol, (milestones_crossed * 100), milestones_crossed;
    END IF;
  END;
END $$;

-- Check results
SELECT 
  '=== AFTER TEST 3: Referral $100 Milestone ===' as test_phase,
  CASE WHEN wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' THEN 'User 1 (Referrer)' ELSE 'User 2 (Referral)' END as role,
  wallet_address,
  username,
  xp as points,
  trading_volume as volume
FROM users
WHERE wallet_address IN ('0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f', '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39')
ORDER BY wallet_address;

-- ============================================
-- TEST 4: Test another $100 milestone (User 2 reaches $200)
-- ============================================
DO $$
DECLARE
  user2_wallet TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39';
  user1_wallet TEXT := '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f';
  user1_old_pts INTEGER;
  user2_old_vol NUMERIC;
  new_vol NUMERIC := 205; -- Push over $200
  pts_to_add INTEGER;
BEGIN
  SELECT COALESCE(xp, 0) INTO user1_old_pts FROM users WHERE wallet_address = user1_wallet;
  SELECT COALESCE(trading_volume, 0) INTO user2_old_vol FROM users WHERE wallet_address = user2_wallet;
  
  pts_to_add := FLOOR(new_vol / 10.0)::INTEGER - FLOOR(user2_old_vol / 10.0)::INTEGER;
  
  UPDATE users
  SET trading_volume = new_vol,
      xp = COALESCE(xp, 0) + pts_to_add
  WHERE wallet_address = user2_wallet;
  
  DECLARE
    old_milestone INTEGER;
    new_milestone INTEGER;
    milestones_crossed INTEGER;
  BEGIN
    old_milestone := FLOOR(user2_old_vol / 100.0)::INTEGER;
    new_milestone := FLOOR(new_vol / 100.0)::INTEGER;
    milestones_crossed := new_milestone - old_milestone;
    
    IF milestones_crossed > 0 THEN
      UPDATE users
      SET xp = COALESCE(xp, 0) + (milestones_crossed * 100)
      WHERE wallet_address = user1_wallet;
      
      RAISE NOTICE 'TEST 4: User 2 volume $% → $%, User 1 should get +% points (crossed % milestone(s))', 
                   user2_old_vol, new_vol, (milestones_crossed * 100), milestones_crossed;
    END IF;
  END;
END $$;

-- Final results
SELECT 
  '=== FINAL RESULTS ===' as test_phase,
  CASE WHEN wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' THEN 'User 1 (Referrer)' ELSE 'User 2 (Referral)' END as role,
  wallet_address,
  username,
  xp as total_points,
  trading_volume as volume,
  -- Breakdown
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as points_from_volume,
  (SELECT COUNT(*) * 10 FROM users WHERE used_referral LIKE '%' || u.user_referral || '%' OR used_referral = u.user_referral) as points_from_referrals
FROM users u
WHERE wallet_address IN ('0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f', '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39')
ORDER BY wallet_address;

-- ============================================
-- SUMMARY
-- ============================================
SELECT 
  '=== TEST SUMMARY ===' as summary,
  'Expected Results:' as info,
  'User 2: ~20 points from $205 volume (20 × $10 increments)' as user2_expected,
  'User 1: +200 points from User 2 milestones ($100 + $200)' as user1_expected;

