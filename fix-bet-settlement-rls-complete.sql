-- ============================================
-- COMPLETE FIX FOR BET SETTLEMENT UPDATES
-- Ensure RLS policy allows updates
-- ============================================

-- Step 1: Check current RLS status
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'bet_placed_with_session';

-- Step 2: Check all existing UPDATE policies
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 3: Drop ALL existing UPDATE policies to avoid conflicts
DROP POLICY IF EXISTS "Allow settlement updates" ON bet_placed_with_session;
DROP POLICY IF EXISTS "Allow updates" ON bet_placed_with_session;
DROP POLICY IF EXISTS "Enable update access" ON bet_placed_with_session;

-- Step 4: Create a new, explicit UPDATE policy
-- Make sure it applies to anon, authenticated, and public roles
CREATE POLICY "Allow settlement updates" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated, public
  USING (true)
  WITH CHECK (true);

-- Step 5: Ensure RLS is enabled (it should be, but let's make sure)
ALTER TABLE bet_placed_with_session ENABLE ROW LEVEL SECURITY;

-- Step 6: Grant explicit UPDATE permissions
GRANT UPDATE ON bet_placed_with_session TO anon;
GRANT UPDATE ON bet_placed_with_session TO authenticated;
GRANT UPDATE ON bet_placed_with_session TO public;

-- Step 7: Verify the policy was created
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 8: Test the update as anon role
DO $$
DECLARE
  test_event_id TEXT := '0xade14909dc4a85fa6bd9263de19a827514ec50bba2351d2ad5c86a2a4b5f8979';
  update_count INTEGER;
BEGIN
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
    RAISE NOTICE '✅ Test update successful - % rows updated', update_count;
  ELSE
    RAISE NOTICE '❌ Test update failed - check if event_id exists or RLS is still blocking';
    
    -- Check if the bet exists
    DECLARE
      bet_exists BOOLEAN;
    BEGIN
      SELECT EXISTS(SELECT 1 FROM bet_placed_with_session WHERE event_id = test_event_id) INTO bet_exists;
      IF NOT bet_exists THEN
        RAISE NOTICE '   - Bet with event_id % does not exist', test_event_id;
      ELSE
        RAISE NOTICE '   - Bet exists but update was blocked (RLS issue)';
      END IF;
    END;
  END IF;
END $$;

