-- Run this SQL in your Supabase SQL Editor
-- Comprehensive schema for all 17 events (12 ChronoGrid + 5 ChronoGridWrapper)

-- ==========================
-- ChronoGrid Events (12 tables)
-- ==========================

-- 1. AutoClaimFailed
CREATE TABLE auto_claim_failed (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  grid_id TEXT NOT NULL,
  timeperiod_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_auto_claim_failed_user ON auto_claim_failed(user_address);
CREATE INDEX idx_auto_claim_failed_grid ON auto_claim_failed(grid_id);
CREATE INDEX idx_auto_claim_failed_timestamp ON auto_claim_failed(timestamp DESC);

-- 2. AutoClaimSkipped
CREATE TABLE auto_claim_skipped (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  grid_id TEXT NOT NULL,
  timeperiod_id TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_auto_claim_skipped_user ON auto_claim_skipped(user_address);
CREATE INDEX idx_auto_claim_skipped_grid ON auto_claim_skipped(grid_id);
CREATE INDEX idx_auto_claim_skipped_timestamp ON auto_claim_skipped(timestamp DESC);

-- 3. BetPlaced (ChronoGrid)
CREATE TABLE bet_placed (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  grid_id TEXT NOT NULL,
  timeperiod_id TEXT NOT NULL,
  amount_paid TEXT NOT NULL,
  shares_received TEXT NOT NULL,
  price_per_share TEXT NOT NULL,
  b_at_entry TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bet_placed_user ON bet_placed(user_address);
CREATE INDEX idx_bet_placed_grid ON bet_placed(grid_id);
CREATE INDEX idx_bet_placed_timeperiod ON bet_placed(timeperiod_id);
CREATE INDEX idx_bet_placed_timestamp ON bet_placed(timestamp DESC);

-- 4. GlobalLiquidityAdded
CREATE TABLE global_liquidity_added (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  amount TEXT NOT NULL,
  new_total TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_global_liquidity_timestamp ON global_liquidity_added(timestamp DESC);

-- 5. GridCreated
CREATE TABLE grid_created (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  grid_id TEXT NOT NULL,
  timeperiod_id TEXT NOT NULL,
  price_min TEXT NOT NULL,
  price_max TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_grid_created_grid ON grid_created(grid_id);
CREATE INDEX idx_grid_created_timeperiod ON grid_created(timeperiod_id);
CREATE INDEX idx_grid_created_timestamp ON grid_created(timestamp DESC);

-- 6. MaxBetAmountUpdated
CREATE TABLE max_bet_amount_updated (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  old_amount TEXT NOT NULL,
  new_amount TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_max_bet_amount_timestamp ON max_bet_amount_updated(timestamp DESC);

-- 7. OwnershipTransferred
CREATE TABLE ownership_transferred (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  previous_owner TEXT NOT NULL,
  new_owner TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ownership_timestamp ON ownership_transferred(timestamp DESC);

-- 8. TimeperiodCreated
CREATE TABLE timeperiod_created (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  timeperiod_id TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  reference_price TEXT NOT NULL,
  allocated_liquidity TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_timeperiod_created_timeperiod ON timeperiod_created(timeperiod_id);
CREATE INDEX idx_timeperiod_created_timestamp ON timeperiod_created(timestamp DESC);

-- 9. TimeperiodFinalized
CREATE TABLE timeperiod_finalized (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  timeperiod_id TEXT NOT NULL,
  net_result TEXT NOT NULL,
  returned_to_global TEXT NOT NULL,
  new_global_pool TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_timeperiod_finalized_timeperiod ON timeperiod_finalized(timeperiod_id);
CREATE INDEX idx_timeperiod_finalized_timestamp ON timeperiod_finalized(timestamp DESC);

-- 10. TimeperiodSettled
CREATE TABLE timeperiod_settled (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  timeperiod_id TEXT NOT NULL,
  winning_grid_id TEXT NOT NULL,
  twap_price TEXT NOT NULL,
  total_loser_bets TEXT NOT NULL,
  pool_share TEXT NOT NULL,
  winner_share TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_timeperiod_settled_timeperiod ON timeperiod_settled(timeperiod_id);
CREATE INDEX idx_timeperiod_settled_grid ON timeperiod_settled(winning_grid_id);
CREATE INDEX idx_timeperiod_settled_timestamp ON timeperiod_settled(timestamp DESC);

-- 11. WinningsClaimedEqual
CREATE TABLE winnings_claimed_equal (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  grid_id TEXT NOT NULL,
  equal_share TEXT NOT NULL,
  redemption_value TEXT NOT NULL,
  total_payout TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_winnings_claimed_user ON winnings_claimed_equal(user_address);
CREATE INDEX idx_winnings_claimed_grid ON winnings_claimed_equal(grid_id);
CREATE INDEX idx_winnings_claimed_timestamp ON winnings_claimed_equal(timestamp DESC);

-- 12. WrapperSet
CREATE TABLE wrapper_set (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  old_wrapper TEXT NOT NULL,
  new_wrapper TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wrapper_set_timestamp ON wrapper_set(timestamp DESC);

-- ==========================
-- ChronoGridWrapper Events (5 tables)
-- ==========================

-- 13. BetPlacedWithSession
CREATE TABLE bet_placed_with_session (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  session_key TEXT NOT NULL,
  timeperiod_id TEXT NOT NULL,
  amount TEXT NOT NULL,
  shares_received TEXT NOT NULL,
  price_min TEXT NOT NULL,
  price_max TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_bet_session_user ON bet_placed_with_session(user_address);
CREATE INDEX idx_bet_session_timeperiod ON bet_placed_with_session(timeperiod_id);
CREATE INDEX idx_bet_session_timestamp ON bet_placed_with_session(timestamp DESC);

-- 14. Deposited
CREATE TABLE deposited (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  new_balance TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_deposited_user ON deposited(user_address);
CREATE INDEX idx_deposited_timestamp ON deposited(timestamp DESC);

-- 15. EIP712DomainChanged
CREATE TABLE eip712_domain_changed (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_eip712_timestamp ON eip712_domain_changed(timestamp DESC);

-- 16. RelayerUpdated
CREATE TABLE relayer_updated (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  old_relayer TEXT NOT NULL,
  new_relayer TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_relayer_timestamp ON relayer_updated(timestamp DESC);

-- 17. Withdrawn
CREATE TABLE withdrawn (
  id BIGSERIAL PRIMARY KEY,
  event_id TEXT UNIQUE NOT NULL,
  user_address TEXT NOT NULL,
  amount TEXT NOT NULL,
  new_balance TEXT NOT NULL,
  block_number BIGINT,
  timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_withdrawn_user ON withdrawn(user_address);
CREATE INDEX idx_withdrawn_timestamp ON withdrawn(timestamp DESC);

-- Disable Row Level Security for testing (enable in production!)
ALTER TABLE auto_claim_failed DISABLE ROW LEVEL SECURITY;
ALTER TABLE auto_claim_skipped DISABLE ROW LEVEL SECURITY;
ALTER TABLE bet_placed DISABLE ROW LEVEL SECURITY;
ALTER TABLE global_liquidity_added DISABLE ROW LEVEL SECURITY;
ALTER TABLE grid_created DISABLE ROW LEVEL SECURITY;
ALTER TABLE max_bet_amount_updated DISABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_transferred DISABLE ROW LEVEL SECURITY;
ALTER TABLE timeperiod_created DISABLE ROW LEVEL SECURITY;
ALTER TABLE timeperiod_finalized DISABLE ROW LEVEL SECURITY;
ALTER TABLE timeperiod_settled DISABLE ROW LEVEL SECURITY;
ALTER TABLE winnings_claimed_equal DISABLE ROW LEVEL SECURITY;
ALTER TABLE wrapper_set DISABLE ROW LEVEL SECURITY;
ALTER TABLE bet_placed_with_session DISABLE ROW LEVEL SECURITY;
ALTER TABLE deposited DISABLE ROW LEVEL SECURITY;
ALTER TABLE eip712_domain_changed DISABLE ROW LEVEL SECURITY;
ALTER TABLE relayer_updated DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawn DISABLE ROW LEVEL SECURITY;

-- Grant access to authenticated and anon users
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
