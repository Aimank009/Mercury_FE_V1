-- ============================================
-- TEST REFERRAL $100 BONUS
-- This tests: When user 2 (who used user 1's referral) reaches $100 volume,
--            user 1 should get +100 points
-- ============================================

-- STEP 1: Check current state of both users
-- Replace these wallet addresses with actual test users
-- User 1 = Referrer (the one who should get the bonus)
-- User 2 = Referral (the one who used user 1's code)

SELECT 
  'USER 1 (Referrer)' as role,
  wallet_address,
  username,
  user_referral,
  xp as current_points,
  trading_volume as current_volume
FROM users
WHERE wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' -- User 1 (Referrer) - CHANGE THIS
UNION ALL
SELECT 
  'USER 2 (Referral)' as role,
  wallet_address,
  username,
  used_referral as referral_used,
  xp as current_points,
  trading_volume as current_volume
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- User 2 (Referral) - CHANGE THIS

-- STEP 2: Set User 2's volume to just below $100 (e.g., $95)
-- This simulates the state before they cross $100
UPDATE users
SET trading_volume = 95
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- User 2 - CHANGE THIS

-- STEP 3: Insert a bet that will push User 2 over $100
-- This will trigger the check_referral_100_bonus() function
-- The bet amount should be at least $5.01 to cross $100 (95 + 5.01 = 100.01)
INSERT INTO bet_placed_with_session (
  event_id,
  user_address,
  session_key,
  timeperiod_id,
  amount,  -- $10 in 6 decimals = 10000000
  shares_received,
  price_min,
  price_max,
  start_time,
  end_time
) VALUES (
  'test-referral-bonus-' || EXTRACT(EPOCH FROM NOW())::TEXT,
  '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39', -- User 2 (Referral) - CHANGE THIS
  'test-session-key',
  EXTRACT(EPOCH FROM NOW())::TEXT,
  '10000000',  -- $10.00 (10 * 1e6) - This will push from $95 to $105
  '1000000',
  '3725000000',  -- $37.25 in 8 decimals
  '3750000000',  -- $37.50 in 8 decimals
  EXTRACT(EPOCH FROM NOW())::TEXT,
  (EXTRACT(EPOCH FROM NOW()) + 300)::TEXT
);

-- STEP 4: Check results - User 1 should have +100 points, User 2 should have crossed $100
SELECT 
  'USER 1 (Referrer) - AFTER' as role,
  wallet_address,
  username,
  xp as points_after,
  trading_volume as volume_after,
  referral_100_bonus_tracked,
  CASE 
    WHEN xp >= (SELECT xp FROM users WHERE wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' LIMIT 1) + 100 THEN '✅ Got +100 bonus!'
    ELSE '❌ Bonus not awarded'
  END as bonus_status
FROM users
WHERE wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' -- User 1 - CHANGE THIS
UNION ALL
SELECT 
  'USER 2 (Referral) - AFTER' as role,
  wallet_address,
  username,
  xp as points_after,
  trading_volume as volume_after,
  NULL as referral_100_bonus_tracked,
  CASE 
    WHEN trading_volume >= 100 THEN '✅ Crossed $100!'
    ELSE '❌ Still below $100'
  END as volume_status
FROM users
WHERE wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39'; -- User 2 - CHANGE THIS

-- ============================================
-- VERIFICATION QUERY
-- ============================================
-- Check if User 1's referral_100_bonus_tracked array contains User 2's address
SELECT 
  u1.wallet_address as referrer_address,
  u1.username as referrer_name,
  u1.xp as referrer_points,
  u1.referral_100_bonus_tracked,
  u2.wallet_address as referral_address,
  u2.username as referral_name,
  u2.trading_volume as referral_volume,
  CASE 
    WHEN u2.wallet_address = ANY(u1.referral_100_bonus_tracked) THEN '✅ Bonus already tracked'
    ELSE '❌ Bonus not tracked'
  END as tracking_status
FROM users u1
CROSS JOIN users u2
WHERE u1.wallet_address = '0xAe8B50eF63203BE4a4605431B6E3871401D7eF1f' -- User 1 - CHANGE THIS
  AND u2.wallet_address = '0x20fD3b2dA44f9a3180106dC6D3eAb4dFFB3cDb39' -- User 2 - CHANGE THIS
  AND u2.used_referral LIKE '%' || u1.user_referral || '%';

