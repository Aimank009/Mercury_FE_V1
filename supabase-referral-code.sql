-- Add user_referral column to store unique referral codes
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS user_referral TEXT UNIQUE;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_user_referral ON users(user_referral);
CREATE INDEX IF NOT EXISTS idx_users_used_referral ON users(used_referral);

-- Update the create_user_profile function to NOT auto-assign referral code
-- The referral code will be generated on-demand when user accesses the referral page
CREATE OR REPLACE FUNCTION create_user_profile(
  p_wallet_address TEXT,
  p_username TEXT,
  p_avatar_url TEXT DEFAULT NULL,
  p_used_referral TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO users (wallet_address, username, avatar_url, used_referral, num_referral, xp, user_referral)
  VALUES (p_wallet_address, p_username, p_avatar_url, p_used_referral, 0, 0, NULL);
END;
$$;
