-- ============================================
-- TEST IF ANON ROLE CAN ACTUALLY UPDATE
-- ============================================

-- Test 1: Check if a recent bet exists that we can test with
SELECT 
  event_id,
  status,
  user_address,
  created_at
FROM bet_placed_with_session
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 5;

-- Test 2: Try to update as anon role (simulates what frontend does)
DO $$
DECLARE
  test_event_id TEXT;
  update_count INTEGER;
BEGIN
  -- Get a recent pending bet
  SELECT event_id INTO test_event_id
  FROM bet_placed_with_session
  WHERE status = 'pending'
  ORDER BY created_at DESC
  LIMIT 1;
  
  IF test_event_id IS NULL THEN
    RAISE NOTICE 'No pending bets found to test with';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Testing update with event_id: %', test_event_id;
  
  -- Try to update as anon (what the frontend uses)
  SET ROLE anon;
  
  UPDATE bet_placed_with_session
  SET status = 'won',
      settled_at = NOW(),
      settlement_price = 3550000000,
      multiplier = 1.5,
      adjusted_multiplier = 1.5
  WHERE event_id = test_event_id;
  
  GET DIAGNOSTICS update_count = ROW_COUNT;
  
  RESET ROLE;
  
  IF update_count > 0 THEN
    RAISE NOTICE '✅ SUCCESS: anon role CAN update - % rows updated', update_count;
    
    -- Restore it back to pending for testing
    UPDATE bet_placed_with_session
    SET status = 'pending',
        settled_at = NULL,
        settlement_price = NULL,
        multiplier = 0,
        adjusted_multiplier = 0
    WHERE event_id = test_event_id;
    
    RAISE NOTICE '   - Restored bet back to pending for future testing';
  ELSE
    RAISE NOTICE '❌ FAILED: anon role CANNOT update - RLS is blocking';
    RAISE NOTICE '   - Check if event_id exists: %', test_event_id;
  END IF;
END $$;

-- Test 3: Check current policy details more thoroughly
SELECT 
  p.policyname,
  p.cmd,
  p.roles,
  p.permissive,
  p.qual,
  p.with_check,
  -- Check if anon is in the roles
  CASE 
    WHEN 'anon' = ANY(p.roles::text[]) THEN '✅ anon included'
    ELSE '❌ anon NOT included'
  END as anon_check,
  CASE 
    WHEN 'authenticated' = ANY(p.roles::text[]) THEN '✅ authenticated included'
    ELSE '❌ authenticated NOT included'
  END as authenticated_check
FROM pg_policies p
WHERE p.tablename = 'bet_placed_with_session' AND p.cmd = 'UPDATE';

