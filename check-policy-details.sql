-- ============================================
-- CHECK POLICY DETAILS AND PERMISSIONS
-- ============================================

-- Step 1: Check the exact policy configuration
SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd as command,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE';

-- Step 2: Check RLS status
SELECT 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'bet_placed_with_session';

-- Step 3: Check table-level permissions
SELECT 
  grantee,
  privilege_type,
  is_grantable
FROM information_schema.role_table_grants
WHERE table_name = 'bet_placed_with_session' 
  AND privilege_type = 'UPDATE'
ORDER BY grantee;

-- Step 4: Check if there are any restrictive policies that might conflict
SELECT 
  policyname,
  cmd,
  roles,
  qual as using_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session'
ORDER BY cmd, policyname;

-- Step 5: Test if the policy works by checking what roles it applies to
-- The frontend uses 'anon' role, so we need to verify anon has access
SELECT 
  policyname,
  cmd,
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

