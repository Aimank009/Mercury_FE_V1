-- ============================================
-- TEST: Try updating a bet directly
-- This will help verify if updates work from SQL
-- ============================================

-- Step 1: Find a pending bet to test with
SELECT 
  event_id,
  status,
  settled_at,
  settlement_price,
  multiplier,
  adjusted_multiplier
FROM bet_placed_with_session
WHERE status = 'pending'
LIMIT 1;

-- Step 2: Try to update it (replace the event_id with one from Step 1)
-- Example: UPDATE bet_placed_with_session
-- SET 
--   status = 'won',
--   settled_at = NOW(),
--   settlement_price = 3530000000,
--   multiplier = 1.5,
--   adjusted_multiplier = 1.5
-- WHERE event_id = 'YOUR_EVENT_ID_HERE';

-- Step 3: Verify the update worked
-- SELECT * FROM bet_placed_with_session WHERE event_id = 'YOUR_EVENT_ID_HERE';

