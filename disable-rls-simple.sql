-- ============================================
-- SIMPLEST SOLUTION: Disable RLS for this table
-- This allows direct updates from frontend without any policy issues
-- ============================================

-- Step 1: Disable RLS entirely for bet_placed_with_session
ALTER TABLE bet_placed_with_session DISABLE ROW LEVEL SECURITY;

-- Step 2: Grant UPDATE permission to everyone
GRANT UPDATE ON bet_placed_with_session TO anon;
GRANT UPDATE ON bet_placed_with_session TO authenticated;
GRANT UPDATE ON bet_placed_with_session TO public;

-- Step 3: Verify RLS is disabled
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'bet_placed_with_session';

-- That's it! Now your frontend can update the table directly.

