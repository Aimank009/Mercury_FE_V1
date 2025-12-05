-- ============================================
-- TEST IF UPDATES ARE ACTUALLY WORKING
-- ============================================

-- Test 1: Check if we can update as anon role
DO $$
DECLARE
  test_event_id TEXT := '0x17fcc9f59f1f395aef06b1d5baca744d9a7f494567f63acd848d23fe1d852420'; -- From console log
  update_count INTEGER;
BEGIN
  -- Try to update as anon (what the frontend uses)
  SET ROLE anon;
  
  UPDATE bet_placed_with_session
  SET status = 'won',
      settled_at = NOW(),
      settlement_price = 3557000000,
      multiplier = 1.5,
      adjusted_multiplier = 1.5
  WHERE event_id = test_event_id;
  
  GET DIAGNOSTICS update_count = ROW_COUNT;
  
  RESET ROLE;
  
  IF update_count > 0 THEN
    RAISE NOTICE '✅ Update successful as anon role - % rows updated', update_count;
  ELSE
    RAISE NOTICE '❌ Update failed - no rows updated (check event_id or RLS)';
  END IF;
END $$;

-- Test 2: Check the actual data
SELECT 
  event_id,
  status,
  settled_at,
  settlement_price,
  multiplier,
  adjusted_multiplier,
  created_at
FROM bet_placed_with_session
WHERE event_id = '0x17fcc9f59f1f395aef06b1d5baca744d9a7f494567f63acd848d23fe1d852420'
ORDER BY created_at DESC
LIMIT 1;

-- Test 3: Check all UPDATE policies
SELECT 
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

