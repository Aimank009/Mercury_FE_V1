'use client';

import { createContext, useContext, useState, ReactNode } from 'react';

interface ModalContextType {
  showDepositModal: boolean;
  setShowDepositModal: (show: boolean) => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const useModal = () => {
  const context = useContext(ModalContext);
  if (context === undefined) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};

interface ModalProviderProps {
  children: ReactNode;
}

export const ModalProvider = ({ children }: ModalProviderProps) => {
  const [showDepositModal, setShowDepositModal] = useState(false);

  return (
    <ModalContext.Provider value={{ showDepositModal, setShowDepositModal }}>
      {children}
    </ModalContext.Provider>
  );
};

