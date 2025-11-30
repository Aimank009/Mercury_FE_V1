-- Create users table
CREATE TABLE IF NOT EXISTS users (
  wallet_address TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  avatar_url TEXT, -- We can store the dataURL here or upload to storage later. For now, dataURL is fine if not too large, or just regenerate it on client.
  -- Actually, since the avatar is deterministic based on wallet address, we don't strictly need to store the image, just the wallet address is enough to regenerate it.
  -- But the user might want to customize it later. For now, let's store the username.
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policy to allow anyone to read users (needed to check if username exists)
CREATE POLICY "Public profiles are viewable by everyone" 
ON users FOR SELECT 
USING (true);

-- Create policy to allow users to insert their own profile
-- Since we don't have auth.uid() matching wallet address directly without custom auth, 
-- we might need to rely on the client for now or use a function.
-- For this demo, we'll allow insert if the wallet address matches the input (enforced by app logic, but ideally by RLS/Function).
-- A safer way is to use a Postgres function that verifies the signature, but for this step we'll keep it simple or use a function.

CREATE POLICY "Users can insert their own profile" 
ON users FOR INSERT 
WITH CHECK (true); -- In a real app, you'd verify the wallet signature.

-- Function to check if a user exists
CREATE OR REPLACE FUNCTION check_user_exists(check_wallet_address TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM users WHERE wallet_address = check_wallet_address);
END;
$$;

-- Function to create a user
CREATE OR REPLACE FUNCTION create_user_profile(
  p_wallet_address TEXT,
  p_username TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO users (wallet_address, username)
  VALUES (p_wallet_address, p_username);
END;
$$;
