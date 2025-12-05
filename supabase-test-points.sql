-- ============================================
-- TEST POINTS SYSTEM
-- Use this to test if points are being awarded correctly
-- ============================================

-- STEP 1: Check current state of a test user
-- Replace 'YOUR_WALLET_ADDRESS' with an actual wallet address
SELECT 
  wallet_address,
  username,
  user_referral,
  xp as current_points,
  trading_volume as current_volume,
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as expected_points_from_volume
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- Replace with your test address

-- STEP 2: Manually update trading volume AND award points
-- Note: Direct volume update won't trigger points automatically
-- So we need to manually calculate and add points
DO $$
DECLARE
  test_wallet TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- Replace with your test address
  old_volume NUMERIC;
  new_volume NUMERIC := 50; -- Set to $50
  old_points INTEGER;
  new_points INTEGER;
  points_to_add INTEGER;
BEGIN
  -- Get current state
  SELECT COALESCE(trading_volume, 0), COALESCE(xp, 0) INTO old_volume, old_points
  FROM users
  WHERE wallet_address = test_wallet;
  
  -- Calculate points based on new volume
  new_points := FLOOR(new_volume / 10.0)::INTEGER;
  points_to_add := new_points - FLOOR(old_volume / 10.0)::INTEGER;
  
  -- Update volume and points
  UPDATE users
  SET trading_volume = new_volume,
      xp = COALESCE(xp, 0) + points_to_add
  WHERE wallet_address = test_wallet;
  
  RAISE NOTICE 'Updated volume from % to %, added % points (total points: %)', 
               old_volume, new_volume, points_to_add, old_points + points_to_add;
END $$;

-- Check points after update
SELECT 
  wallet_address,
  username,
  xp as points_after_update,
  trading_volume as volume_after_update,
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as expected_points
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39';

-- STEP 3: Test incremental increase (simulate a new bet)
-- Increase volume from $50 to $75 (should add 2 more points)
DO $$
DECLARE
  test_wallet TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39';
  old_volume NUMERIC;
  new_volume NUMERIC := 75; -- Increase to $75
  points_to_add INTEGER;
BEGIN
  SELECT COALESCE(trading_volume, 0) INTO old_volume
  FROM users
  WHERE wallet_address = test_wallet;
  
  points_to_add := FLOOR(new_volume / 10.0)::INTEGER - FLOOR(old_volume / 10.0)::INTEGER;
  
  UPDATE users
  SET trading_volume = new_volume,
      xp = COALESCE(xp, 0) + points_to_add
  WHERE wallet_address = test_wallet;
  
  RAISE NOTICE 'Increased volume from % to %, added % points', old_volume, new_volume, points_to_add;
END $$;

-- Check points again
SELECT 
  wallet_address,
  username,
  xp as points_after_increase,
  trading_volume as volume_after_increase,
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as expected_points
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39';

-- ============================================
-- ALTERNATIVE: Test by inserting a real bet
-- ============================================
-- This will trigger the actual triggers and award points automatically
-- Replace values with actual test data

/*
INSERT INTO bet_placed_with_session (
  event_id,
  user_address,
  session_key,
  timeperiod_id,
  amount,  -- Amount in 6 decimals (e.g., 1000000 = $1.00)
  shares_received,
  price_min,
  price_max,
  start_time,
  end_time
) VALUES (
  'test-event-' || EXTRACT(EPOCH FROM NOW())::TEXT,
  '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39', -- Your test wallet
  'test-session-key',
  EXTRACT(EPOCH FROM NOW())::TEXT,
  '10000000',  -- $10.00 (10 * 1e6)
  '1000000',
  '3725000000',  -- $37.25 in 8 decimals
  '3750000000',  -- $37.50 in 8 decimals
  EXTRACT(EPOCH FROM NOW())::TEXT,
  (EXTRACT(EPOCH FROM NOW()) + 300)::TEXT
);

-- Check points after bet insertion
SELECT 
  wallet_address,
  username,
  xp as points_after_bet,
  trading_volume as volume_after_bet
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39';
*/

-- ============================================
-- CHECK ALL TRIGGERS ARE ACTIVE
-- ============================================
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as enabled
FROM pg_trigger
WHERE tgname IN (
  'on_user_created_award_referral_points',
  'on_bet_placed_update_volume',
  'on_bet_placed_check_referral_bonus'
)
ORDER BY tgname;

-- ============================================
-- RESET TEST (if needed)
-- ============================================
-- Uncomment to reset a test user's points and volume
/*
UPDATE users
SET xp = 0,
    trading_volume = 0
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39';
*/

