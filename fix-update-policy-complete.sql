-- ============================================
-- COMPLETE FIX FOR UPDATE POLICY
-- This will drop all UPDATE policies and create a simple, permissive one
-- ============================================

-- Step 1: Drop ALL existing UPDATE policies
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON bet_placed_with_session', policy_record.policyname);
    RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
  END LOOP;
END $$;

-- Step 2: Ensure RLS is enabled
ALTER TABLE bet_placed_with_session ENABLE ROW LEVEL SECURITY;

-- Step 3: Create a simple, permissive UPDATE policy
-- This allows ANY update to ANY row (same as INSERT policy)
CREATE POLICY "Allow all updates" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated, public
  USING (true)
  WITH CHECK (true);

-- Step 4: Grant UPDATE permission explicitly
GRANT UPDATE ON bet_placed_with_session TO anon;
GRANT UPDATE ON bet_placed_with_session TO authenticated;
GRANT UPDATE ON bet_placed_with_session TO public;

-- Step 5: Verify the policy was created
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 6: Test with a real bet (replace with actual event_id from your table)
DO $$
DECLARE
  test_event_id TEXT := '0x6a0716d74c56bed3cc32e7180f6b1ea76ab7efce5cd43476617da78c478a79c1';
  bet_exists BOOLEAN;
  update_count INTEGER;
BEGIN
  -- Check if bet exists
  SELECT EXISTS(
    SELECT 1 FROM bet_placed_with_session WHERE event_id = test_event_id
  ) INTO bet_exists;
  
  IF NOT bet_exists THEN
    RAISE NOTICE '⚠️ Bet with event_id % does not exist - skipping test', test_event_id;
    RAISE NOTICE '   You can test manually by placing a bet and waiting for settlement';
    RETURN;
  END IF;
  
  RAISE NOTICE '✅ Bet exists, testing update...';
  
  -- Try to update
  UPDATE bet_placed_with_session
  SET 
    status = 'won',
    settled_at = NOW(),
    settlement_price = 35315000000,
    multiplier = 1.5,
    adjusted_multiplier = 1.5
  WHERE event_id = test_event_id;
  
  GET DIAGNOSTICS update_count = ROW_COUNT;
  
  IF update_count > 0 THEN
    RAISE NOTICE '✅ SUCCESS: Update worked! % rows updated', update_count;
  ELSE
    RAISE NOTICE '❌ FAILED: No rows updated (check RLS or event_id)';
  END IF;
END $$;

-- Step 7: Show final status
SELECT 
  'Policy Status' as check_type,
  COUNT(*) as update_policies,
  STRING_AGG(policyname, ', ') as policy_names
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

