-- Step 1: Ensure user_referral column exists
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS user_referral TEXT UNIQUE;

-- Step 2: Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_user_referral ON users(user_referral);

-- Step 3: Generate referral codes for ALL existing users
DO $$
DECLARE
  user_record RECORD;
  clean_username TEXT;
  user_part TEXT;
  user_number TEXT;
  new_code TEXT;
  code_exists BOOLEAN;
  attempt INT;
BEGIN
  FOR user_record IN 
    SELECT wallet_address, username 
    FROM users 
    WHERE user_referral IS NULL OR user_referral = ''
    ORDER BY created_at ASC
  LOOP
    -- Clean username and extract letters
    clean_username := regexp_replace(user_record.username, '[^a-zA-Z]', '', 'g');
    
    -- Handle short usernames
    IF LENGTH(clean_username) < 2 THEN
      clean_username := RPAD(clean_username, 4, 'X');
    ELSIF LENGTH(clean_username) < 4 THEN
      clean_username := clean_username || clean_username;
    END IF;
    
    user_part := UPPER(
      SUBSTRING(clean_username FROM 1 FOR 2) || 
      SUBSTRING(clean_username FROM GREATEST(LENGTH(clean_username)-1, 3) FOR 2)
    );
    
    -- Try to find unique code
    attempt := 1;
    LOOP
      EXIT WHEN attempt > 99;
      
      user_number := LPAD(attempt::TEXT, 2, '0');
      new_code := 'MERCURY_' || user_part || user_number;
      
      -- Check if code exists
      SELECT EXISTS(SELECT 1 FROM users WHERE user_referral = new_code) INTO code_exists;
      
      IF NOT code_exists THEN
        -- Update user with new code
        UPDATE users 
        SET user_referral = new_code 
        WHERE wallet_address = user_record.wallet_address;
        
        RAISE NOTICE 'Assigned % to % (wallet: %)', new_code, user_record.username, user_record.wallet_address;
        EXIT;
      END IF;
      
      attempt := attempt + 1;
    END LOOP;
    
    IF attempt > 99 THEN
      RAISE WARNING 'Could not generate unique code for % after 99 attempts', user_record.username;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Finished generating referral codes for all users';
END $$;

-- Step 4: Verify results
SELECT COUNT(*) as total_users, 
       COUNT(user_referral) as users_with_codes,
       COUNT(*) - COUNT(user_referral) as users_without_codes
FROM users;

-- Step 5: Show some examples
SELECT username, user_referral 
FROM users 
WHERE user_referral IS NOT NULL 
LIMIT 10;
