import { supabase } from '../lib/supabaseClient';

export async function generateReferralCode(username: string): Promise<string> {
  // Extract first 2 and last 2 letters of username
  const cleanUsername = username.replace(/[^a-zA-Z]/g, ''); // Remove non-letters
  const first2 = cleanUsername.substring(0, 2).toUpperCase();
  const last2 = cleanUsername.substring(Math.max(0, cleanUsername.length - 2)).toUpperCase();
  const userPart = first2 + last2;

  // Get the count of existing users to determine the next number
  const { count, error } = await supabase
    .from('users')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error getting user count:', error);
    throw error;
  }

  // Increment count by 1 for new user, pad with leading zeros
  const userNumber = String((count || 0) + 1).padStart(2, '0');

  // Format: MERCURY_JOOE01
  return `MERCURY_${userPart}${userNumber}`;
}

export async function assignReferralCode(walletAddress: string, username: string): Promise<string> {
  // Check if user already has a referral code
  const { data: existingUser, error: fetchError } = await supabase
    .from('users')
    .select('user_referral')
    .ilike('wallet_address', walletAddress)
    .single();

  if (fetchError && fetchError.code !== 'PGRST116') {
    console.error('Error fetching user:', fetchError);
    throw fetchError;
  }

  // If user already has a code, return it
  if (existingUser?.user_referral) {
    return existingUser.user_referral;
  }

  // Generate new code
  const referralCode = await generateReferralCode(username);

  // Update user with new referral code
  const { error: updateError } = await supabase
    .from('users')
    .update({ user_referral: referralCode })
    .ilike('wallet_address', walletAddress);

  if (updateError) {
    console.error('Error updating referral code:', updateError);
    throw updateError;
  }

  return referralCode;
}
