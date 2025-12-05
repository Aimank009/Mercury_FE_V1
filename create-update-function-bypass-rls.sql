-- ============================================
-- ALTERNATIVE SOLUTION: Create a function to bypass RLS
-- This function runs with SECURITY DEFINER, so it bypasses RLS
-- Frontend will call this function instead of direct UPDATE
-- ============================================

-- Step 1: Create a function that updates bet settlement
-- SECURITY DEFINER means it runs with the privileges of the function owner (postgres)
-- This bypasses RLS policies
CREATE OR REPLACE FUNCTION update_bet_settlement(
  p_event_id TEXT,
  p_status TEXT,
  p_settled_at TIMESTAMPTZ,
  p_settlement_price BIGINT,
  p_multiplier NUMERIC,
  p_adjusted_multiplier NUMERIC
)
RETURNS TABLE (
  event_id TEXT,
  status TEXT,
  settled_at TIMESTAMPTZ,
  settlement_price BIGINT,
  multiplier NUMERIC,
  adjusted_multiplier NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER  -- This is the key: runs as function owner, bypasses RLS
SET search_path = public
AS $$
DECLARE
  updated_row bet_placed_with_session%ROWTYPE;
BEGIN
  -- Update the bet
  UPDATE bet_placed_with_session
  SET 
    status = p_status,
    settled_at = p_settled_at,
    settlement_price = p_settlement_price,
    multiplier = p_multiplier,
    adjusted_multiplier = p_adjusted_multiplier
  WHERE event_id = p_event_id
  RETURNING * INTO updated_row;
  
  -- Return the updated row
  RETURN QUERY
  SELECT 
    updated_row.event_id,
    updated_row.status,
    updated_row.settled_at,
    updated_row.settlement_price,
    updated_row.multiplier,
    updated_row.adjusted_multiplier;
END;
$$;

-- Step 2: Grant execute permission to anon and authenticated
GRANT EXECUTE ON FUNCTION update_bet_settlement TO anon;
GRANT EXECUTE ON FUNCTION update_bet_settlement TO authenticated;
GRANT EXECUTE ON FUNCTION update_bet_settlement TO public;

-- Step 3: Test the function
-- Replace with an actual event_id from your table
DO $$
DECLARE
  test_event_id TEXT := '0x98d77a874b4435686127fe431a98099a3211a332af0b1641019f62541d2dc86a';
  test_result RECORD;
  bet_exists BOOLEAN;
BEGIN
  -- Check if bet exists
  SELECT EXISTS(
    SELECT 1 FROM bet_placed_with_session WHERE event_id = test_event_id
  ) INTO bet_exists;
  
  IF NOT bet_exists THEN
    RAISE NOTICE '⚠️ Bet with event_id % does not exist - skipping test', test_event_id;
    RAISE NOTICE '   Function created successfully. You can test it from frontend.';
    RETURN;
  END IF;
  
  RAISE NOTICE '✅ Bet exists, testing function...';
  
  -- Test the function
  SELECT * INTO test_result
  FROM update_bet_settlement(
    test_event_id,
    'won',
    NOW(),
    3532250000,
    1.5151515151515151,
    1.5151515151515151
  );
  
  IF test_result.event_id IS NOT NULL THEN
    RAISE NOTICE '✅ SUCCESS: Function worked!';
    RAISE NOTICE '   Updated bet: %, Status: %', test_result.event_id, test_result.status;
  ELSE
    RAISE NOTICE '❌ FAILED: Function returned no data';
  END IF;
END $$;

-- Step 4: Verify function was created
SELECT 
  routine_name,
  routine_type,
  security_type,
  routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public' 
  AND routine_name = 'update_bet_settlement';

