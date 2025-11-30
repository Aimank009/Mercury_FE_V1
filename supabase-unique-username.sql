-- Add unique constraint to username
ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username);

-- Update the create_user_profile function to handle potential race conditions if needed, 
-- but the constraint will ensure uniqueness.
