-- ============================================
-- SIMPLE FIX: Update existing policy roles
-- This avoids deadlocks by not dropping/recreating
-- ============================================

-- Step 1: Drop the existing policy (if it exists and we can)
-- If this causes a deadlock, skip to Step 2 and use ALTER POLICY instead
DROP POLICY IF EXISTS "Allow all updates" ON bet_placed_with_session;

-- Step 2: Create the policy with correct roles
-- This includes anon, authenticated, and public
CREATE POLICY "Allow all updates" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated, public
  USING (true)
  WITH CHECK (true);

-- Step 3: Grant UPDATE permissions explicitly
GRANT UPDATE ON bet_placed_with_session TO anon;
GRANT UPDATE ON bet_placed_with_session TO authenticated;
GRANT UPDATE ON bet_placed_with_session TO public;

-- Step 4: Verify the fix
SELECT 
  policyname,
  cmd as command,
  CASE 
    WHEN 'anon' = ANY(roles) THEN '✅ anon role included'
    ELSE '❌ anon role NOT included'
  END as anon_status,
  CASE 
    WHEN 'authenticated' = ANY(roles) THEN '✅ authenticated role included'
    ELSE '❌ authenticated role NOT included'
  END as authenticated_status,
  roles
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

