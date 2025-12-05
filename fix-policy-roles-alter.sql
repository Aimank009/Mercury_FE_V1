-- ============================================
-- ALTERNATIVE FIX: Use ALTER POLICY if DROP causes deadlock
-- This modifies the existing policy without dropping it
-- ============================================

-- If the DROP POLICY causes a deadlock, use this instead:
-- PostgreSQL doesn't support ALTER POLICY to change roles directly,
-- so we need to drop and recreate, but we can do it more carefully

-- Step 1: Check current policy
SELECT 
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 2: Wait a moment, then try to drop (run this separately if needed)
-- DROP POLICY IF EXISTS "Allow all updates" ON bet_placed_with_session;

-- Step 3: If drop works, create new policy with correct roles
-- CREATE POLICY "Allow all updates" ON bet_placed_with_session
--   FOR UPDATE
--   TO anon, authenticated, public
--   USING (true)
--   WITH CHECK (true);

-- Step 4: Grant permissions
GRANT UPDATE ON bet_placed_with_session TO anon;
GRANT UPDATE ON bet_placed_with_session TO authenticated;
GRANT UPDATE ON bet_placed_with_session TO public;

-- Step 5: Verify
SELECT 
  policyname,
  cmd,
  roles,
  CASE 
    WHEN 'anon' = ANY(roles) THEN '✅'
    ELSE '❌'
  END as anon,
  CASE 
    WHEN 'authenticated' = ANY(roles) THEN '✅'
    ELSE '❌'
  END as authenticated
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

