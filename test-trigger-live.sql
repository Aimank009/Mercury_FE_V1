-- ============================================
-- TEST IF TRIGGER IS FIRING ON NEW BETS
-- ============================================

-- STEP 1: Check your current volume before placing a bet
SELECT 
  wallet_address,
  username,
  trading_volume as current_volume,
  xp as current_points
FROM users
WHERE wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f'; -- CHANGE THIS to your wallet

-- STEP 2: Check your most recent bet
SELECT 
  id,
  event_id,
  user_address,
  amount,
  (amount::numeric / 1000000.0) as amount_usd,
  created_at
FROM bet_placed_with_session
WHERE user_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' -- CHANGE THIS
ORDER BY created_at DESC
LIMIT 5;

-- STEP 3: Check if your volume matches your bets
SELECT 
  u.wallet_address,
  u.username,
  u.trading_volume as stored_volume,
  COALESCE(SUM(b.amount::numeric / 1000000.0), 0) as calculated_volume_from_bets,
  CASE 
    WHEN u.trading_volume = COALESCE(SUM(b.amount::numeric / 1000000.0), 0) THEN '✅ Match'
    ELSE '❌ Mismatch - Volume should be: $' || COALESCE(SUM(b.amount::numeric / 1000000.0), 0)::TEXT
  END as status
FROM users u
LEFT JOIN bet_placed_with_session b ON LOWER(b.user_address) = LOWER(u.wallet_address)
WHERE u.wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' -- CHANGE THIS
GROUP BY u.wallet_address, u.username, u.trading_volume;

-- STEP 4: Check trigger status and test manually
DO $$
DECLARE
  test_wallet TEXT := '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f'; -- CHANGE THIS
  old_volume NUMERIC;
  test_amount TEXT := '2000000'; -- $2.00 in 6 decimals
  new_volume NUMERIC;
BEGIN
  -- Get current volume
  SELECT COALESCE(trading_volume, 0) INTO old_volume
  FROM users
  WHERE LOWER(wallet_address) = LOWER(test_wallet);
  
  RAISE NOTICE 'Current volume: $%', old_volume;
  
  -- Try to manually call the trigger function by inserting a test bet
  BEGIN
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
      'manual-test-' || EXTRACT(EPOCH FROM NOW())::TEXT || '-' || RANDOM()::TEXT,
      test_wallet,
      'test-session',
      EXTRACT(EPOCH FROM NOW())::TEXT,
      test_amount,
      '1000000',
      '3610700000', -- $36.107 in 8 decimals
      '3620000000',
      EXTRACT(EPOCH FROM NOW())::TEXT,
      (EXTRACT(EPOCH FROM NOW()) + 300)::TEXT
    );
    
    -- Wait a moment for trigger to execute
    PERFORM pg_sleep(0.5);
    
    -- Check new volume
    SELECT COALESCE(trading_volume, 0) INTO new_volume
    FROM users
    WHERE LOWER(wallet_address) = LOWER(test_wallet);
    
    RAISE NOTICE 'Volume after test bet: $%', new_volume;
    RAISE NOTICE 'Expected: $%', old_volume + 2.0;
    
    IF new_volume = old_volume + 2.0 THEN
      RAISE NOTICE '✅ TRIGGER IS WORKING!';
    ELSE
      RAISE NOTICE '❌ TRIGGER NOT WORKING! Expected $% but got $%', old_volume + 2.0, new_volume;
    END IF;
    
    -- Clean up test bet
    DELETE FROM bet_placed_with_session 
    WHERE event_id LIKE 'manual-test-%';
    
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error: %', SQLERRM;
  END;
END $$;

-- STEP 5: Check for any errors in the function
SELECT 
  'Check PostgreSQL logs for errors' as note,
  'If trigger is not firing, check Supabase logs' as suggestion;

