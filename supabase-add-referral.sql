-- Add num_referral column to track the number of referrals
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS num_referral INTEGER DEFAULT 0;

-- Add xp column to track user experience points
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS xp INTEGER DEFAULT 0;

-- Update the create_user_profile function to include num_referral and xp
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
  INSERT INTO users (wallet_address, username, avatar_url, used_referral, num_referral, xp)
  VALUES (p_wallet_address, p_username, p_avatar_url, p_used_referral, 0, 0);
END;
$$;
