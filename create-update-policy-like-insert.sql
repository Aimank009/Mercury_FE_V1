-- ============================================
-- CREATE UPDATE POLICY TO MATCH INSERT POLICY
-- Since INSERT works, let's make UPDATE work the same way
-- ============================================

-- Step 1: Check how INSERT policies are set up (these work)
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'INSERT';

-- Step 2: Drop existing UPDATE policy
DROP POLICY IF EXISTS "Allow settlement updates" ON bet_placed_with_session;

-- Step 3: Create UPDATE policy matching the INSERT policy structure
-- Based on INSERT: "Allow insert for all" with roles {anon,authenticated}
CREATE POLICY "Allow update for all" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Step 4: Verify
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 5: Grant UPDATE permission (same as INSERT has)
GRANT UPDATE ON bet_placed_with_session TO anon, authenticated;

