-- ============================================
-- VERIFY POLICY AND TEST UPDATE
-- ============================================

-- Step 1: Check if the bet exists
SELECT 
  event_id,
  status,
  user_address,
  created_at
FROM bet_placed_with_session
WHERE event_id = '0xc2d57d79ef014469435d42135819c188b725c21b59184e7a18da6732062a5c6d';

-- Step 2: Check current UPDATE policy
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 3: Check RLS status
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'bet_placed_with_session';

-- Step 4: Test update as anon role (what frontend uses)
DO $$
DECLARE
  test_event_id TEXT := '0xc2d57d79ef014469435d42135819c188b725c21b59184e7a18da6732062a5c6d';
  bet_exists BOOLEAN;
  update_count INTEGER;
BEGIN
  -- Check if bet exists
  SELECT EXISTS(
    SELECT 1 FROM bet_placed_with_session WHERE event_id = test_event_id
  ) INTO bet_exists;
  
  IF NOT bet_exists THEN
    RAISE NOTICE '❌ Bet with event_id % does not exist', test_event_id;
    RETURN;
  END IF;
  
  RAISE NOTICE '✅ Bet exists, testing update as anon role...';
  
  -- Try to update as anon
  SET ROLE anon;
  
  BEGIN
    UPDATE bet_placed_with_session
    SET status = 'won',
        settled_at = NOW(),
        settlement_price = 3550000000,
        multiplier = 1.5,
        adjusted_multiplier = 1.5
    WHERE event_id = test_event_id;
    
    GET DIAGNOSTICS update_count = ROW_COUNT;
    
    IF update_count > 0 THEN
      RAISE NOTICE '✅ SUCCESS: Update worked! % rows updated', update_count;
    ELSE
      RAISE NOTICE '❌ FAILED: No rows updated (RLS blocking or event_id mismatch)';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '❌ EXCEPTION: %', SQLERRM;
  END;
  
  RESET ROLE;
END $$;

-- Step 5: Check the result
SELECT 
  event_id,
  status,
  settled_at,
  settlement_price,
  multiplier,
  adjusted_multiplier
FROM bet_placed_with_session
WHERE event_id = '0xc2d57d79ef014469435d42135819c188b725c21b59184e7a18da6732062a5c6d';

