-- Update create_user_profile function to accept user_referral parameter
CREATE OR REPLACE FUNCTION create_user_profile(
  p_wallet_address TEXT,
  p_username TEXT,
  p_avatar_url TEXT DEFAULT NULL,
  p_used_referral TEXT DEFAULT NULL,
  p_user_referral TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only insert columns that exist in the users table
  INSERT INTO users (wallet_address, username, avatar_url, used_referral, user_referral, num_referral, xp)
  VALUES (p_wallet_address, p_username, p_avatar_url, p_used_referral, p_user_referral, 0, 0);
END;
$$;
