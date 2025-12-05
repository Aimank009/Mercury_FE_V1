-- ============================================
-- UPDATE POLICY TO INCLUDE ANON AND AUTHENTICATED ROLES
-- Run this to ensure anon role can update
-- ============================================

-- Step 1: Drop the existing policy
DROP POLICY IF EXISTS "Allow settlement updates" ON bet_placed_with_session;

-- Step 2: Recreate with explicit roles (anon, authenticated, public)
-- Note: In Supabase, we need to explicitly list roles
CREATE POLICY "Allow settlement updates" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated, public
  USING (true)
  WITH CHECK (true);

-- Step 3: Verify the policy now includes all roles
SELECT 
  policyname,
  cmd as command,
  roles,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Expected: roles should show {anon,authenticated,public} or {anon,authenticated} or similar
-- If it still shows only {public}, the policy might need to be created differently

