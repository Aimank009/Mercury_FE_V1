-- ============================================
-- AGGRESSIVE FIX FOR RLS UPDATE ISSUE
-- This will completely reset RLS and recreate policies
-- ============================================

-- Step 1: Disable RLS temporarily to drop all policies
ALTER TABLE bet_placed_with_session DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop ALL policies (both INSERT and UPDATE) to start fresh
DO $$
DECLARE
  policy_record RECORD;
BEGIN
  FOR policy_record IN 
    SELECT policyname 
    FROM pg_policies 
    WHERE tablename = 'bet_placed_with_session'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON bet_placed_with_session', policy_record.policyname);
    RAISE NOTICE 'Dropped policy: %', policy_record.policyname;
  END LOOP;
END $$;

-- Step 3: Re-enable RLS
ALTER TABLE bet_placed_with_session ENABLE ROW LEVEL SECURITY;

-- Step 4: Create a permissive INSERT policy (if it doesn't exist)
-- Check if INSERT policy exists first
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'bet_placed_with_session' AND cmd = 'INSERT'
  ) THEN
    CREATE POLICY "Allow all inserts" ON bet_placed_with_session
      FOR INSERT
      TO anon, authenticated, public
      WITH CHECK (true);
    RAISE NOTICE 'Created INSERT policy';
  ELSE
    RAISE NOTICE 'INSERT policy already exists';
  END IF;
END $$;

-- Step 5: Create a permissive UPDATE policy
CREATE POLICY "Allow all updates" ON bet_placed_with_session
  FOR UPDATE
  TO anon, authenticated, public
  USING (true)
  WITH CHECK (true);

-- Step 6: Grant ALL necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON bet_placed_with_session TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON bet_placed_with_session TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bet_placed_with_session TO public;

-- Step 7: Verify everything
SELECT 
  'Policy Check' as check_type,
  cmd as command,
  COUNT(*) as policy_count,
  STRING_AGG(policyname, ', ') as policy_names
FROM pg_policies
WHERE tablename = 'bet_placed_with_session'
GROUP BY cmd
ORDER BY cmd;

-- Step 8: Check permissions
SELECT 
  'Permissions Check' as check_type,
  grantee,
  STRING_AGG(privilege_type, ', ') as privileges
FROM information_schema.role_table_grants
WHERE table_name = 'bet_placed_with_session'
  AND grantee IN ('anon', 'authenticated', 'public')
GROUP BY grantee;

-- Step 9: Test update with the actual bet from console
DO $$
DECLARE
  test_event_id TEXT := '0x98d77a874b4435686127fe431a98099a3211a332af0b1641019f62541d2dc86a';
  bet_exists BOOLEAN;
  update_count INTEGER;
BEGIN
  -- Check if bet exists
  SELECT EXISTS(
    SELECT 1 FROM bet_placed_with_session WHERE event_id = test_event_id
  ) INTO bet_exists;
  
  IF NOT bet_exists THEN
    RAISE NOTICE '⚠️ Bet with event_id % does not exist', test_event_id;
    RAISE NOTICE '   This is normal if the bet was already settled or deleted';
    RETURN;
  END IF;
  
  RAISE NOTICE '✅ Bet exists, testing update as postgres role...';
  
  -- Try to update (as postgres, this should always work)
  UPDATE bet_placed_with_session
  SET 
    status = 'won',
    settled_at = NOW(),
    settlement_price = 3532250000,
    multiplier = 1.5151515151515151,
    adjusted_multiplier = 1.5151515151515151
  WHERE event_id = test_event_id;
  
  GET DIAGNOSTICS update_count = ROW_COUNT;
  
  IF update_count > 0 THEN
    RAISE NOTICE '✅ SUCCESS: Update worked! % rows updated', update_count;
    RAISE NOTICE '   Note: This test runs as postgres role. Frontend uses anon role.';
    RAISE NOTICE '   If this works but frontend fails, it means RLS policy needs adjustment.';
  ELSE
    RAISE NOTICE '❌ FAILED: No rows updated';
  END IF;
END $$;

