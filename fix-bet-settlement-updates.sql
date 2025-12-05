-- ============================================
-- FIX BET SETTLEMENT UPDATES
-- Create UPDATE policy for bet_placed_with_session table
-- ============================================

-- Step 1: Check current UPDATE policies
SELECT 
  policyname,
  cmd as command,
  roles
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 2: Drop existing policy if it exists (to avoid conflicts)
DROP POLICY IF EXISTS "Allow settlement updates" ON bet_placed_with_session;

-- Step 3: Create UPDATE policy for settlement updates
-- This allows updates to status, settled_at, settlement_price, multiplier, adjusted_multiplier
CREATE POLICY "Allow settlement updates" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated, public
  USING (true)  -- Allow all users to update
  WITH CHECK (true);  -- Allow all updates

-- Step 4: Grant UPDATE permission to anon and authenticated roles
GRANT UPDATE ON bet_placed_with_session TO anon, authenticated;

-- Step 5: Verify the policy was created
SELECT 
  policyname,
  cmd as command,
  roles,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Expected result: Should show 1 row with "Allow settlement updates" policy

