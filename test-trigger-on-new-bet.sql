-- ============================================
-- TEST TRIGGER ON A NEW BET
-- This will help us see if the trigger is firing
-- ============================================

-- STEP 1: Get your current state BEFORE placing a bet
SELECT 
  'BEFORE BET' as phase,
  wallet_address,
  username,
  trading_volume as volume,
  xp as points
FROM users
WHERE wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' -- CHANGE THIS to your wallet
LIMIT 1;

-- STEP 2: Check your most recent bet (the one you just placed)
SELECT 
  'YOUR RECENT BET' as phase,
  event_id,
  user_address,
  amount,
  (amount::numeric / 1000000.0) as amount_usd,
  created_at
FROM bet_placed_with_session
WHERE user_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' -- CHANGE THIS
ORDER BY created_at DESC
LIMIT 1;

-- STEP 3: Check if volume was updated
SELECT 
  'AFTER BET' as phase,
  wallet_address,
  username,
  trading_volume as current_volume,
  xp as current_points,
  -- Calculate what volume SHOULD be
  (SELECT COALESCE(SUM(amount::numeric / 1000000.0), 0) 
   FROM bet_placed_with_session 
   WHERE LOWER(user_address) = LOWER(users.wallet_address)) as expected_volume,
  CASE 
    WHEN trading_volume = (SELECT COALESCE(SUM(amount::numeric / 1000000.0), 0) 
                           FROM bet_placed_with_session 
                           WHERE LOWER(user_address) = LOWER(users.wallet_address)) 
    THEN '✅ Volume correct'
    ELSE '❌ Volume mismatch - trigger may not be working'
  END as status
FROM users
WHERE wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' -- CHANGE THIS
LIMIT 1;

-- STEP 4: Manually test the trigger by inserting a test bet
DO $$
DECLARE
  test_wallet TEXT := '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f'; -- CHANGE THIS
  volume_before NUMERIC;
  volume_after NUMERIC;
  test_event_id TEXT;
BEGIN
  -- Get volume before
  SELECT COALESCE(trading_volume, 0) INTO volume_before
  FROM users
  WHERE LOWER(wallet_address) = LOWER(test_wallet);
  
  RAISE NOTICE 'Volume before test: $%', volume_before;
  
  -- Create unique event ID
  test_event_id := 'trigger-test-' || EXTRACT(EPOCH FROM NOW())::TEXT || '-' || RANDOM()::TEXT;
  
  -- Insert test bet ($5.00)
  INSERT INTO bet_placed_with_session (
    event_id,
    user_address,
    session_key,
    timeperiod_id,
    amount,
    shares_received,
    price_min,
    price_max,
    start_time,
    end_time
  ) VALUES (
    test_event_id,
    test_wallet,
    'test-session',
    EXTRACT(EPOCH FROM NOW())::TEXT,
    '5000000', -- $5.00
    '1000000',
    '3610700000',
    '3620000000',
    EXTRACT(EPOCH FROM NOW())::TEXT,
    (EXTRACT(EPOCH FROM NOW()) + 300)::TEXT
  );
  
  -- Wait a moment for trigger
  PERFORM pg_sleep(1);
  
  -- Get volume after
  SELECT COALESCE(trading_volume, 0) INTO volume_after
  FROM users
  WHERE LOWER(wallet_address) = LOWER(test_wallet);
  
  RAISE NOTICE 'Volume after test bet: $%', volume_after;
  RAISE NOTICE 'Expected: $%', volume_before + 5.0;
  
  IF volume_after = volume_before + 5.0 THEN
    RAISE NOTICE '✅✅✅ TRIGGER IS WORKING! ✅✅✅';
  ELSE
    RAISE NOTICE '❌❌❌ TRIGGER NOT WORKING! Expected $% but got $%', volume_before + 5.0, volume_after;
    RAISE NOTICE 'This means the trigger is not firing or failing silently';
  END IF;
  
  -- Clean up test bet
  DELETE FROM bet_placed_with_session WHERE event_id = test_event_id;
  
  -- Restore volume
  UPDATE users
  SET trading_volume = volume_before
  WHERE LOWER(wallet_address) = LOWER(test_wallet);
  
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Error during test: %', SQLERRM;
END $$;

-- STEP 5: Check trigger definition
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  CASE tgenabled
    WHEN 'O' THEN '✅ Enabled'
    WHEN 'D' THEN '❌ Disabled'
    ELSE '❓ ' || tgenabled::TEXT
  END as status,
  pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger
WHERE tgname = 'on_bet_placed_update_volume';

