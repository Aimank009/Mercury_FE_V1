import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

export interface Transaction {
  id: string;
  type: 'deposit' | 'withdraw';
  amount: number;
  newBalance: number;
  timestamp: string;
  txHash: string;
}

async function fetchUserTransactions(userAddress: string): Promise<Transaction[]> {
  if (!userAddress) return [];

  const normalizedAddress = userAddress.toLowerCase();

  // Fetch deposits
  const { data: deposits, error: depositError } = await supabase
    .from('deposited')
    .select('*')
    .ilike('user_address', normalizedAddress)
    .order('timestamp', { ascending: false })
    .limit(50);

  if (depositError) {
    console.error('Error fetching deposits:', depositError);
  }

  // Fetch withdrawals
  const { data: withdrawals, error: withdrawError } = await supabase
    .from('withdrawn')
    .select('*')
    .ilike('user_address', normalizedAddress)
    .order('timestamp', { ascending: false })
    .limit(50);

  if (withdrawError) {
    console.error('Error fetching withdrawals:', withdrawError);
  }

  const formattedDeposits: Transaction[] = (deposits || []).map(d => ({
    id: `dep-${d.id}`,
    type: 'deposit',
    amount: Number(d.amount) / 1e6,
    newBalance: Number(d.new_balance) / 1e6,
    timestamp: d.timestamp,
    txHash: d.event_id // Using event_id as a proxy for ID/Hash for now
  }));

  const formattedWithdrawals: Transaction[] = (withdrawals || []).map(w => ({
    id: `with-${w.id}`,
    type: 'withdraw',
    amount: Number(w.amount) / 1e6,
    newBalance: Number(w.new_balance) / 1e6,
    timestamp: w.timestamp,
    txHash: w.event_id
  }));

  // Combine and sort by timestamp descending
  const allTransactions = [...formattedDeposits, ...formattedWithdrawals].sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return allTransactions;
}

export function useUserTransactions(userAddress: string | undefined) {
  return useQuery({
    queryKey: ['userTransactions', userAddress],
    queryFn: () => fetchUserTransactions(userAddress!),
    enabled: !!userAddress,
    staleTime: 60_000, // 1 minute - transactions don't change often
    gcTime: 10 * 60 * 1000, // 10 minutes
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}
