-- ============================================
-- FIX BET SETTLEMENT UPDATES - STEP BY STEP
-- Run each section separately to avoid deadlocks
-- ============================================

-- ============================================
-- STEP 1: Check current status (run this first)
-- ============================================
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'bet_placed_with_session';

SELECT 
  policyname,
  cmd as command,
  roles
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- ============================================
-- STEP 2: Drop existing policies (run this second)
-- Wait for step 1 to complete, then run this
-- ============================================
DROP POLICY IF EXISTS "Allow settlement updates" ON bet_placed_with_session;
DROP POLICY IF EXISTS "Allow updates" ON bet_placed_with_session;
DROP POLICY IF EXISTS "Enable update access" ON bet_placed_with_session;

-- ============================================
-- STEP 3: Create new policy (run this third)
-- Wait for step 2 to complete, then run this
-- ============================================
CREATE POLICY "Allow settlement updates" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated, public
  USING (true)
  WITH CHECK (true);

-- ============================================
-- STEP 4: Grant permissions (run this fourth)
-- Wait for step 3 to complete, then run this
-- ============================================
GRANT UPDATE ON bet_placed_with_session TO anon;
GRANT UPDATE ON bet_placed_with_session TO authenticated;
GRANT UPDATE ON bet_placed_with_session TO public;

-- ============================================
-- STEP 5: Verify (run this last)
-- Wait for step 4 to complete, then run this
-- ============================================
SELECT 
  policyname,
  cmd as command,
  roles,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

