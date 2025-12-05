# New Points System Setup Guide

## Points Rules

1. **+10 points** to me when someone uses my referral code
2. **+100 points** to me when a referral's trading volume reaches $100 (one-time per referral)
3. **+10 points** to me if I do $100 trading volume in a week (weekly bonus)
4. **+1 point per $10** of my own trading volume (continuous)

## Setup Steps

### Step 1: Cleanup Old System
Run `supabase-points-cleanup.sql` to remove old triggers and functions.

### Step 2: Install New System
Run `supabase-points-system-new.sql` step by step (follow the STEP numbers in the file).

### Step 3: Verify
Check that triggers are created:
```sql
SELECT tgname, tgrelid::regclass 
FROM pg_trigger 
WHERE tgname IN (
  'on_user_created_award_referral_points',
  'on_bet_placed_update_volume',
  'on_bet_placed_check_referral_bonus'
);
```

## How It Works

### Referral Points (+10)
- Trigger: `on_user_created_award_referral_points`
- Fires: When a new user is created with a `used_referral` code
- Action: Awards 10 points to the referrer

### Own Trading Points (+1 per $10)
- Trigger: `on_bet_placed_update_volume`
- Fires: When a bet is placed
- Action: Updates trading_volume and awards 1 point per $10 increment crossed

### Referral $100 Bonus (+100)
- Trigger: `on_bet_placed_check_referral_bonus`
- Fires: After a bet is placed (checks if referral crossed $100)
- Action: Awards 100 points to referrer when their referral reaches $100

### Weekly $100 Bonus (+10)
- Function: `award_weekly_100_bonus()`
- Runs: Every Friday (via pg_cron or manually)
- Action: Awards 10 points to users who traded $100+ in the week

## Notes

- The `used_referral` field may contain timestamps (e.g., "14 00: MERCURY_AIAN01")
- The system extracts the referral code using regex
- Each referral's $100 bonus is tracked to prevent duplicate awards
- Weekly bonus is tracked per user to prevent duplicate weekly awards

