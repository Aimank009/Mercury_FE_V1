-- ============================================
-- COMPREHENSIVE RLS UPDATE DIAGNOSIS
-- ============================================

-- Step 1: Check if the specific bet exists
SELECT 
  event_id,
  status,
  user_address,
  created_at,
  amount
FROM bet_placed_with_session
WHERE event_id = '0x6a0716d74c56bed3cc32e7180f6b1ea76ab7efce5cd43476617da78c478a79c1';

-- Step 2: Check ALL policies on this table
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session'
ORDER BY cmd, policyname;

-- Step 3: Check RLS status
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'bet_placed_with_session';

-- Step 4: Check table permissions
SELECT 
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_name = 'bet_placed_with_session'
ORDER BY grantee, privilege_type;

-- Step 5: Check if there are conflicting policies
-- Sometimes multiple policies can conflict
SELECT 
  COUNT(*) as update_policy_count
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 6: Test update directly (this will show the actual error)
DO $$
DECLARE
  test_event_id TEXT := '0x6a0716d74c56bed3cc32e7180f6b1ea76ab7efce5cd43476617da78c478a79c1';
  bet_exists BOOLEAN;
  update_result RECORD;
BEGIN
  -- Check if bet exists
  SELECT EXISTS(
    SELECT 1 FROM bet_placed_with_session WHERE event_id = test_event_id
  ) INTO bet_exists;
  
  IF NOT bet_exists THEN
    RAISE NOTICE '❌ Bet with event_id % does not exist', test_event_id;
    RETURN;
  END IF;
  
  RAISE NOTICE '✅ Bet exists, attempting update...';
  
  -- Try to update
  BEGIN
    UPDATE bet_placed_with_session
    SET 
      status = 'won',
      settled_at = NOW(),
      settlement_price = 35315000000,
      multiplier = 1.5,
      adjusted_multiplier = 1.5
    WHERE event_id = test_event_id
    RETURNING * INTO update_result;
    
    IF update_result IS NOT NULL THEN
      RAISE NOTICE '✅ SUCCESS: Update worked!';
      RAISE NOTICE '   Status: %, Settlement Price: %, Multiplier: %', 
        update_result.status, 
        update_result.settlement_price, 
        update_result.multiplier;
    ELSE
      RAISE NOTICE '❌ FAILED: No rows updated';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '❌ INSUFFICIENT PRIVILEGE: %', SQLERRM;
  WHEN OTHERS THEN
    RAISE NOTICE '❌ EXCEPTION: %', SQLERRM;
    RAISE NOTICE '   Error Code: %', SQLSTATE;
  END;
END $$;

-- Step 7: Check the result
SELECT 
  event_id,
  status,
  settled_at,
  settlement_price,
  multiplier,
  adjusted_multiplier
FROM bet_placed_with_session
WHERE event_id = '0x6a0716d74c56bed3cc32e7180f6b1ea76ab7efce5cd43476617da78c478a79c1';

