-- ============================================
-- COMPARE INSERT vs UPDATE POLICIES
-- See why INSERT works but UPDATE doesn't
-- ============================================

-- Check INSERT policies (these are working)
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'INSERT'
ORDER BY policyname;

-- Check UPDATE policies (these might not be working)
SELECT 
  policyname,
  cmd as command,
  roles,
  permissive,
  qual as using_expression,
  with_check as with_check_expression
FROM pg_policies
WHERE tablename = 'bet_placed_with_session' AND cmd = 'UPDATE'
ORDER BY policyname;

-- Check if RLS is enabled
SELECT 
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'bet_placed_with_session';

-- Check table-level permissions
SELECT 
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' 
  AND table_name = 'bet_placed_with_session'
  AND grantee IN ('anon', 'authenticated', 'public')
ORDER BY grantee, privilege_type;

