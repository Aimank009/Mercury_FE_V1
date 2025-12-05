-- ============================================
-- SIMPLE POINTS TEST - INCREMENTAL
-- This increases volume by $25 and checks if points are added correctly
-- ============================================

-- STEP 1: Check current state
SELECT 
  wallet_address,
  username,
  xp as current_points,
  trading_volume as current_volume,
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as expected_points
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- CHANGE THIS

-- STEP 2: Increase volume by $25 and add corresponding points
DO $$
DECLARE
  test_wallet TEXT := '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- CHANGE THIS
  current_vol NUMERIC;
  current_pts INTEGER;
  new_vol NUMERIC;
  new_pts INTEGER;
  pts_to_add INTEGER;
BEGIN
  -- Get current values
  SELECT COALESCE(trading_volume, 0), COALESCE(xp, 0) INTO current_vol, current_pts
  FROM users WHERE wallet_address = test_wallet;
  
  -- Increase volume by $25
  new_vol := current_vol + 25;
  
  -- Calculate points: +1 per $10
  new_pts := FLOOR(new_vol / 10.0)::INTEGER;
  pts_to_add := new_pts - FLOOR(current_vol / 10.0)::INTEGER;
  
  -- Update
  UPDATE users
  SET trading_volume = new_vol,
      xp = current_pts + pts_to_add
  WHERE wallet_address = test_wallet;
  
  RAISE NOTICE 'Volume: $% → $% (+$25)', current_vol, new_vol;
  RAISE NOTICE 'Points: % → % (+%)', current_pts, current_pts + pts_to_add, pts_to_add;
END $$;

-- STEP 3: Verify the result
SELECT 
  wallet_address,
  username,
  xp as points_after,
  trading_volume as volume_after,
  FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER as expected_points,
  CASE 
    WHEN xp = FLOOR(COALESCE(trading_volume, 0) / 10.0)::INTEGER THEN '✅ Points correct!'
    ELSE '❌ Points mismatch!'
  END as status
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- CHANGE THIS

