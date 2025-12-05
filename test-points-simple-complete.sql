-- ============================================
-- SIMPLE POINTS SYSTEM TEST
-- Replace wallet addresses and run
-- ============================================

-- CHANGE THESE WALLET ADDRESSES:
-- User 1 = You (the referrer)
-- User 2 = Someone who used your referral code

-- ============================================
-- STEP 1: Check initial state
-- ============================================
SELECT 
  'INITIAL STATE' as phase,
  wallet_address,
  username,
  user_referral,
  xp as points,
  trading_volume as volume
FROM users
WHERE wallet_address IN (
  '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f',  -- User 1 - CHANGE THIS
  '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'   -- User 2 - CHANGE THIS
)
ORDER BY wallet_address;

-- ============================================
-- STEP 2: Test +1 per $10 (User 2 goes to $25)
-- ============================================
DO $$
DECLARE
  user2 TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- CHANGE THIS
  old_vol NUMERIC;
  old_pts INTEGER;
  new_vol NUMERIC := 25;
  pts_to_add INTEGER;
BEGIN
  SELECT COALESCE(trading_volume, 0), COALESCE(xp, 0) INTO old_vol, old_pts
  FROM users WHERE wallet_address = user2;
  
  pts_to_add := FLOOR(new_vol / 10.0)::INTEGER - FLOOR(old_vol / 10.0)::INTEGER;
  
  UPDATE users
  SET trading_volume = new_vol, xp = COALESCE(xp, 0) + pts_to_add
  WHERE wallet_address = user2;
  
  RAISE NOTICE '✅ TEST 2: User 2 volume $% → $%, added % points', old_vol, new_vol, pts_to_add;
END $$;

-- ============================================
-- STEP 3: Test $100 milestone (User 2 reaches $105)
-- ============================================
DO $$
DECLARE
  user1 TEXT := '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f'; -- CHANGE THIS
  user2 TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- CHANGE THIS
  user1_old_pts INTEGER;
  user2_old_vol NUMERIC;
  new_vol NUMERIC := 105;
  old_milestone INTEGER;
  new_milestone INTEGER;
  milestones_crossed INTEGER;
  pts_to_add INTEGER;
BEGIN
  SELECT COALESCE(xp, 0) INTO user1_old_pts FROM users WHERE wallet_address = user1;
  SELECT COALESCE(trading_volume, 0) INTO user2_old_vol FROM users WHERE wallet_address = user2;
  
  -- Update User 2 volume and points
  pts_to_add := FLOOR(new_vol / 10.0)::INTEGER - FLOOR(user2_old_vol / 10.0)::INTEGER;
  UPDATE users SET trading_volume = new_vol, xp = COALESCE(xp, 0) + pts_to_add WHERE wallet_address = user2;
  
  -- Calculate milestones
  old_milestone := FLOOR(user2_old_vol / 100.0)::INTEGER;
  new_milestone := FLOOR(new_vol / 100.0)::INTEGER;
  milestones_crossed := new_milestone - old_milestone;
  
  -- Award milestone bonus to User 1
  IF milestones_crossed > 0 THEN
    UPDATE users SET xp = COALESCE(xp, 0) + (milestones_crossed * 100) WHERE wallet_address = user1;
    RAISE NOTICE '✅ TEST 3: User 2 crossed $100 milestone, User 1 got +% points', (milestones_crossed * 100);
  END IF;
END $$;

-- ============================================
-- STEP 4: Test $200 milestone (User 2 reaches $205)
-- ============================================
DO $$
DECLARE
  user1 TEXT := '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f'; -- CHANGE THIS
  user2 TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- CHANGE THIS
  user2_old_vol NUMERIC;
  new_vol NUMERIC := 205;
  old_milestone INTEGER;
  new_milestone INTEGER;
  milestones_crossed INTEGER;
  pts_to_add INTEGER;
BEGIN
  SELECT COALESCE(trading_volume, 0) INTO user2_old_vol FROM users WHERE wallet_address = user2;
  
  -- Update User 2
  pts_to_add := FLOOR(new_vol / 10.0)::INTEGER - FLOOR(user2_old_vol / 10.0)::INTEGER;
  UPDATE users SET trading_volume = new_vol, xp = COALESCE(xp, 0) + pts_to_add WHERE wallet_address = user2;
  
  -- Calculate milestones
  old_milestone := FLOOR(user2_old_vol / 100.0)::INTEGER;
  new_milestone := FLOOR(new_vol / 100.0)::INTEGER;
  milestones_crossed := new_milestone - old_milestone;
  
  -- Award to User 1
  IF milestones_crossed > 0 THEN
    UPDATE users SET xp = COALESCE(xp, 0) + (milestones_crossed * 100) WHERE wallet_address = user1;
    RAISE NOTICE '✅ TEST 4: User 2 crossed $200 milestone, User 1 got +% points', (milestones_crossed * 100);
  END IF;
END $$;

-- ============================================
-- FINAL RESULTS
-- ============================================
SELECT 
  'FINAL RESULTS' as phase,
  CASE 
    WHEN wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' THEN 'User 1 (Referrer)'
    ELSE 'User 2 (Referral)'
  END as role,
  wallet_address,
  username,
  xp as total_points,
  trading_volume as volume,
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as expected_volume_points
FROM users
WHERE wallet_address IN (
  '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f',  -- User 1 - CHANGE THIS
  '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'   -- User 2 - CHANGE THIS
)
ORDER BY wallet_address;

-- Expected Results:
-- User 2: ~20 points (from $205 volume = 20 × $10 increments)
-- User 1: +200 points (from User 2 crossing $100 and $200 milestones)

