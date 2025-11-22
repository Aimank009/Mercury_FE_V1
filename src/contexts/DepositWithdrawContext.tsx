'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { DepositWithdrawSDK, DepositWithdrawConfig, BalanceInfo } from '../lib/DepositWithdrawSDK';
import { CONTRACTS, DEFAULT_CHAIN_ID, ENV } from '../config';

interface DepositWithdrawContextType {
  sdk: DepositWithdrawSDK | null;
  isConnected: boolean;
  userAddress: string | null;
  balance: BalanceInfo | null;
  walletBalance: BalanceInfo | null;
  isLoading: boolean;
  error: string | null;
  isApproved: boolean;
  approvalAmount: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  deposit: (amount: string) => Promise<{ txHash: string; amount: string }>;
  withdraw: (amount: string) => Promise<{ txHash: string; amount: string }>;
  approve: (amount?: string) => Promise<{ txHash: string; amount: string }>;
  checkApproval: () => Promise<void>;
  refreshBalance: () => Promise<void>;
  clearError: () => void;
}

const DepositWithdrawContext = createContext<DepositWithdrawContextType | undefined>(undefined);

export const useDepositWithdraw = () => {
  const context = useContext(DepositWithdrawContext);
  if (context === undefined) {
    throw new Error('useDepositWithdraw must be used within a DepositWithdrawProvider');
  }
  return context;
};

interface DepositWithdrawProviderProps {
  children: React.ReactNode;
}

export const DepositWithdrawProvider: React.FC<DepositWithdrawProviderProps> = ({ children }) => {
  const [sdk, setSdk] = useState<DepositWithdrawSDK | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<BalanceInfo | null>(null);
  const [walletBalance, setWalletBalance] = useState<BalanceInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [approvalAmount, setApprovalAmount] = useState('0');

  // Initialize SDK
  useEffect(() => {
    const config: DepositWithdrawConfig = {
      wrapperContractAddress: CONTRACTS.WRAPPER,
      libraryContractAddress: CONTRACTS.LIBRARY,
      chronoGridAddress: CONTRACTS.CHRONO_GRID,
      chainId: DEFAULT_CHAIN_ID,
      rpcUrl: ENV.RPC_URL,
    };

    const newSdk = new DepositWithdrawSDK(config);
    setSdk(newSdk);
  }, []);

  const connect = async () => {
    if (!sdk) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await sdk.connect();
      setUserAddress(result.address);
      setIsConnected(true);
      
      // Refresh balances and check approval after connecting
      await refreshBalance();
      await checkApproval();
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
      console.error('Connection error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const disconnect = () => {
    setUserAddress(null);
    setIsConnected(false);
    setBalance(null);
    setWalletBalance(null);
    setError(null);
  };

  const checkApproval = async () => {
    if (!sdk || !isConnected) return;

    try {
      const approval = await sdk.checkUSDTOApproval();
      setIsApproved(approval.isApproved);
      setApprovalAmount(approval.allowanceFormatted);
    } catch (err: any) {
      console.error('Failed to check approval:', err);
    }
  };

  const approve = async (amount?: string) => {
    if (!sdk || !isConnected) {
      throw new Error('Not connected');
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await sdk.approveUSDTO(amount);
      
      // Refresh approval status after approval
      await checkApproval();
      
      return result;
    } catch (err: any) {
      const errorMsg = err.message || 'Approval failed';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const deposit = async (amount: string) => {
    if (!sdk || !isConnected) {
      throw new Error('Not connected');
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await sdk.depositUSDTO(amount);
      
      // Refresh balance after deposit
      await refreshBalance();
      
      return result;
    } catch (err: any) {
      const errorMsg = err.message || 'Deposit failed';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const withdraw = async (amount: string) => {
    if (!sdk || !isConnected) {
      throw new Error('Not connected');
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await sdk.withdrawUSDTO(amount);
      
      // Refresh balance after withdraw
      await refreshBalance();
      
      return result;
    } catch (err: any) {
      const errorMsg = err.message || 'Withdraw failed';
      setError(errorMsg);
      throw new Error(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshBalance = async () => {
    if (!sdk || !isConnected) return;

    try {
      const [contractBalance, walletBal] = await Promise.all([
        sdk.getUSDTOBalance(),
        sdk.getUSDTOWalletBalance()
      ]);
      
      setBalance(contractBalance);
      setWalletBalance(walletBal);
      
      // Also check approval status
      await checkApproval();
    } catch (err: any) {
      console.error('Failed to refresh balance:', err);
    }
  };

  const clearError = () => {
    setError(null);
  };

  // Auto-refresh balance every 60 seconds (reduced to avoid rate limits)
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      refreshBalance();
    }, 60000); // Changed from 30000 (30s) to 60000 (60s)

    return () => clearInterval(interval);
  }, [isConnected]);

  const value: DepositWithdrawContextType = {
    sdk,
    isConnected,
    userAddress,
    balance,
    walletBalance,
    isLoading,
    error,
    isApproved,
    approvalAmount,
    connect,
    disconnect,
    deposit,
    withdraw,
    approve,
    checkApproval,
    refreshBalance,
    clearError,
  };

  return (
    <DepositWithdrawContext.Provider value={value}>
      {children}
    </DepositWithdrawContext.Provider>
  );
};
