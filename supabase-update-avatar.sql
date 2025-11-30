-- Update the create_user_profile function to accept avatar_url
CREATE OR REPLACE FUNCTION create_user_profile(
  p_wallet_address TEXT,
  p_username TEXT,
  p_avatar_url TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO users (wallet_address, username, avatar_url)
  VALUES (p_wallet_address, p_username, p_avatar_url);
END;
$$;
