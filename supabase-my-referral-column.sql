-- Add my_referral column to users table to store array of referred wallet addresses
ALTER TABLE users
ADD COLUMN IF NOT EXISTS my_referral TEXT[] DEFAULT '{}';

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_users_my_referral ON users USING GIN (my_referral);

-- Optional: Create a trigger to automatically update my_referral when someone uses a referral code
CREATE OR REPLACE FUNCTION update_referrer_my_referral()
RETURNS TRIGGER AS $$
BEGIN
  -- If a user just set their used_referral, add their wallet to the referrer's my_referral array
  IF NEW.used_referral IS NOT NULL AND (OLD.used_referral IS NULL OR OLD.used_referral != NEW.used_referral) THEN
    UPDATE users
    SET my_referral = array_append(COALESCE(my_referral, '{}'), NEW.wallet_address)
    WHERE user_referral = NEW.used_referral
      AND NOT (NEW.wallet_address = ANY(COALESCE(my_referral, '{}')));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS trigger_update_referrer_my_referral ON users;

-- Create the trigger
CREATE TRIGGER trigger_update_referrer_my_referral
AFTER INSERT OR UPDATE OF used_referral ON users
FOR EACH ROW
EXECUTE FUNCTION update_referrer_my_referral();

-- Populate existing data: for each user, find who used their referral code
UPDATE users u
SET my_referral = (
  SELECT COALESCE(array_agg(wallet_address), '{}')
  FROM users
  WHERE used_referral = u.user_referral
)
WHERE user_referral IS NOT NULL;
