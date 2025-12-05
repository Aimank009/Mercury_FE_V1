-- ============================================
-- TEST IF FRONTEND CAN UPDATE TRADING VOLUME
-- Check RLS policies and permissions
-- ============================================

-- Check RLS policies on users table
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'users';

-- Check if anon/authenticated roles can update
SELECT 
  has_table_privilege('anon', 'users', 'UPDATE') as anon_can_update,
  has_table_privilege('authenticated', 'users', 'UPDATE') as auth_can_update,
  has_table_privilege('postgres', 'users', 'UPDATE') as postgres_can_update;

-- Test update with a specific address (replace with your address)
DO $$
DECLARE
  test_address TEXT := '0xae8b50ef63203be4a4605431b6e3871401d7ef1f'; -- Your address in lowercase
  current_vol NUMERIC;
  new_vol NUMERIC;
BEGIN
  -- Get current volume
  SELECT COALESCE(trading_volume, 0) INTO current_vol
  FROM users
  WHERE LOWER(wallet_address) = test_address;
  
  RAISE NOTICE 'Current volume for %: $%', test_address, current_vol;
  
  -- Try to update
  UPDATE users
  SET trading_volume = COALESCE(trading_volume, 0) + 0.2,
      updated_at = NOW()
  WHERE LOWER(wallet_address) = test_address;
  
  GET DIAGNOSTICS new_vol = ROW_COUNT;
  
  IF new_vol > 0 THEN
    RAISE NOTICE '✅ Update successful';
  ELSE
    RAISE NOTICE '❌ No rows updated - user might not exist';
    
    -- Try to insert
    INSERT INTO users (wallet_address, trading_volume, xp, referral)
    VALUES (test_address, 0.2, 0, 0)
    ON CONFLICT (wallet_address) 
    DO UPDATE SET 
      trading_volume = users.trading_volume + 0.2,
      updated_at = NOW();
    
    RAISE NOTICE '✅ Insert/upsert attempted';
  END IF;
END $$;

-- Check the result
SELECT 
  wallet_address,
  trading_volume,
  updated_at
FROM users
WHERE LOWER(wallet_address) = '0xae8b50ef63203be4a4605431b6e3871401d7ef1f';

