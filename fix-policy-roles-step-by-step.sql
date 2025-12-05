-- ============================================
-- STEP-BY-STEP FIX (to avoid deadlocks)
-- Run each step separately, waiting a few seconds between steps
-- ============================================

-- STEP 1: First, just grant the permissions (this is safe and doesn't require dropping)
-- Run this first and wait for it to complete
GRANT UPDATE ON bet_placed_with_session TO anon;
GRANT UPDATE ON bet_placed_with_session TO authenticated;

-- STEP 2: Check if we can see the current policy
-- Run this to see the current state
SELECT 
  policyname,
  roles,
  cmd
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- STEP 3: Try to drop the policy (wait 5-10 seconds after Step 1)
-- If this causes a deadlock, wait 30 seconds and try again
-- Or skip to Step 4
DROP POLICY IF EXISTS "Allow all updates" ON bet_placed_with_session;

-- STEP 4: Create new policy with correct roles
-- Only run this after Step 3 succeeds
CREATE POLICY "Allow all updates" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated, public
  USING (true)
  WITH CHECK (true);

-- STEP 5: Verify the fix worked
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

