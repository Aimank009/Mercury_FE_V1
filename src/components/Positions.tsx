'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUserBets } from '../hooks/useUserBets';
import { usePositionsWebSocket } from '../hooks/usePositionsWebSocket';
import { supabase } from '../lib/supabaseClient';
import clsx from 'clsx';

// Memoized components for performance
const StatusBadge = memo(({ status, price }: { status: string; price: string | null }) => (
  <div className="inline-block">
    <span
      className={clsx(
        'inline-flex items-center justify-center text-[12px] font-400 px-1 py-1.5 w-[59px] mr-5 rounded-full',
        status === 'waiting' && 'bg-[#FFDA00] text-[#000000]',
        status === 'win' && 'bg-[#00FF24] text-[#000000]',
        status === 'Loss' && 'bg-[#FF5E5E] text-[#000000]'
      )}
    >
      {status}
    </span>
    {/* {price && <span className="text-[#999] inline-block text-[12px]">{price}</span>} */}
  </div>
));
StatusBadge.displayName = 'StatusBadge';

const ActionButtons = memo(({ 
  positionId, 
  isResolved, 
  onShare, 
  onHelp 
}: { 
  positionId: string; 
  isResolved: boolean; 
  onShare: (id: string) => void; 
  onHelp: (id: string) => void; 
}) => (
  <div className="flex items-center gap-2 md:gap-4">
    {isResolved && (
      <button
        className="flex items-center gap-1 text-[9px] md:text-[11px] border rounded-[24px] bg-white/5 text-[#828892] px-2 md:px-3 py-1 md:py-2 transition hover:text-[#00ff24]"
        onClick={() => onShare(positionId)}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8.25 0.916748C9.01083 0.916748 9.625 1.53091 9.625 2.29175C9.625 3.05258 9.01083 3.66675 8.25 3.66675C7.88807 3.66675 7.55832 3.52465 7.31543 3.29565L4.08398 5.17944C4.10685 5.28468 4.12496 5.38996 4.125 5.49976C4.125 5.60976 4.1069 5.71563 4.08398 5.82104L7.31934 7.70483C7.56225 7.47567 7.88792 7.33374 8.25 7.33374C9.01083 7.33374 9.625 7.94791 9.625 8.70874C9.62482 9.46942 9.01072 10.0837 8.25 10.0837C7.48928 10.0837 6.87518 9.46942 6.875 8.70874C6.875 8.59882 6.89312 8.4931 6.91602 8.39233L3.68457 6.50366C3.43709 6.73275 3.11201 6.87476 2.75 6.87476C1.98917 6.87476 1.375 6.26059 1.375 5.49976C1.37518 4.73907 1.98928 4.12476 2.75 4.12476C3.11185 4.12476 3.43713 4.26694 3.68457 4.49585L6.91602 2.61304C6.8931 2.5122 6.875 2.40175 6.875 2.29175C6.875 1.53091 7.48917 0.916748 8.25 0.916748ZM8.25 8.24976C7.99792 8.24976 7.79199 8.45666 7.79199 8.70874C7.79217 8.96068 7.99803 9.16675 8.25 9.16675C8.50197 9.16675 8.70783 8.96068 8.70801 8.70874C8.70801 8.45666 8.50208 8.24976 8.25 8.24976ZM2.75 5.04175C2.49803 5.04175 2.29217 5.24782 2.29199 5.49976C2.29199 5.75184 2.49792 5.95874 2.75 5.95874C3.00208 5.95874 3.20801 5.75184 3.20801 5.49976C3.20783 5.24782 3.00197 5.04175 2.75 5.04175ZM8.25 1.83374C7.99792 1.83374 7.79199 2.03966 7.79199 2.29175C7.79199 2.54383 7.99792 2.74976 8.25 2.74976C8.50208 2.74976 8.70801 2.54383 8.70801 2.29175C8.70801 2.03966 8.50208 1.83374 8.25 1.83374Z" fill="currentColor"/>
        </svg>
        Share
      </button>
    )}
    <button
      className="flex items-center gap-1 text-[9px] md:text-[11px] border rounded-[24px] bg-white/5 text-[#828892] px-2 md:px-3 py-1 md:py-2 transition hover:text-[#00ff24]"
      onClick={() => onHelp(positionId)}
    >
      <svg width="12" height="12" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clipPath="url(#clip0_600_35176)">
          <path fill="currentColor" d="M7.26177 4.67163V2.79663C7.26177 1.87454 5.77344 1.81746 5.77344 2.79663" stroke="#767676" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
          <path fill="currentColor" d="M5.77363 4.16671V1.96337C5.77363 1.04129 4.2853 0.984207 4.2853 1.96337V2.71337M4.28488 4.48421V2.79671C4.28488 1.87462 2.72363 1.81754 2.72363 2.79671V5.41671" stroke="#767676" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
          <path fill="currentColor" d="M7.26165 3.88012C7.26165 2.90095 8.74998 2.95804 8.74998 3.88012V5.71345C8.74998 8.5647 4.66707 9.70429 2.80082 7.83595L1.46123 6.48595C0.840817 5.79345 1.68498 4.37512 2.72373 5.41679L3.1404 5.83345" stroke="#767676" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <defs>
          <clipPath id="clip0_600_35176">
            <rect width="10" height="10" fill="currentColor"/>
          </clipPath>
        </defs>
      </svg>
      Help
    </button>
  </div>
));
ActionButtons.displayName = 'ActionButtons';

const PositionRow = memo(({ 
  position, 
  onShare, 
  onHelp 
}: { 
  position: any; 
  onShare: (id: string) => void; 
  onHelp: (id: string) => void; 
}) => (
  <tr className="border-b border-[rgba(214,213,212,0.15)] transition hover:bg-white/5 text-[#e0e0e0]">
    <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs hidden md:table-cell">{position.date}</td>
    <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">{position.priceRange}</td>
    <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs hidden md:table-cell">{position.expiryTime}</td>
    <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">{position.amount}</td>
    <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">{position.payout}</td>
    <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
      <StatusBadge status={position.settlement.status} price={position.settlement.price} />
    </td>
    <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs hidden md:table-cell">{position.status}</td>
    <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
      <ActionButtons 
        positionId={position.id} 
        isResolved={position.status === 'Resolved'} 
        onShare={onShare} 
        onHelp={onHelp} 
      />
    </td>
  </tr>
));
PositionRow.displayName = 'PositionRow';

export default function Positions() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { positions, isLoading, isFetchingNextPage, error, refetch, fetchNextPage, hasMore, batchSize } = useUserBets();
  
  // WebSocket connection
  const { isConnected: wsConnected, reconnect: wsReconnect, lastError: wsError, reconnectAttempts } = usePositionsWebSocket();
  
  const [currentPage, setCurrentPage] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState(10); // Show 10 positions per page
  const [mounted, setMounted] = useState(false);

  // Enhanced debug logging with WebSocket status
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      console.log('📊 Positions state:', {
        positionsCount: positions.length,
        isLoading,
        error,
        address,
        currentPage,
        wsConnected,
        wsError,
        reconnectAttempts,
      });
    }
  }, [positions.length, isLoading, error, address, currentPage, wsConnected, wsError, reconnectAttempts]);
  
  // Refs for measuring actual heights
  const headerRef = useRef<HTMLDivElement>(null);
  const tableHeaderRef = useRef<HTMLTableSectionElement>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const paginationRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Memoized callbacks
  const handleShare = useCallback((id: string) => {
    console.log('Share position:', id);
    // Implement share logic
  }, []);

  const handleHelp = useCallback((id: string) => {
    console.log('Help for position:', id);
    // Implement help logic
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || !address) return;
    
    try {
      setIsRefreshing(true);
      console.log('🔄 Manual refresh initiated...');
      
      setCurrentPage(1);
      queryClient.removeQueries({ queryKey: ['userBets', address.toLowerCase()] });
      await refetch();
      
      console.log('✅ Refresh completed');
    } catch (error) {
      console.error('❌ Error refreshing:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, address, queryClient, refetch]);

  const getBatchIndexForPage = useCallback((page: number) => {
    const startIndexForPage = (page - 1) * itemsPerPage;
    return Math.floor(startIndexForPage / batchSize);
  }, [itemsPerPage, batchSize]);

  // Set mounted state
  useEffect(() => {
    setMounted(true);
  }, []);

  // Real-time subscription for new bets using Supabase
  useEffect(() => {
    if (!address) return;

    console.log('🔔 Setting up Supabase real-time subscription for Positions...');

    const channel = supabase
      .channel('positions-new-bets')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bet_placed_with_session',
        },
        (payload) => {
          // Check if this bet is from the current user
          const newBet = payload.new as Record<string, unknown>;
          if ((newBet.user_address as string)?.toLowerCase() === address.toLowerCase()) {
            console.log('📥 New bet detected for current user:', newBet);
            // Refetch to get the latest data with proper formatting
            refetch();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bet_placed_with_session',
        },
        (payload) => {
          // Check if this bet is from the current user
          const updatedBet = payload.new as Record<string, unknown>;
          if ((updatedBet.user_address as string)?.toLowerCase() === address.toLowerCase()) {
            console.log('📝 Bet updated for current user:', updatedBet);
            // Refetch to get the latest data
            refetch();
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 Positions Supabase subscription status:', status);
      });

    return () => {
      console.log('🔕 Cleaning up Positions Supabase subscription...');
      supabase.removeChannel(channel);
    };
  }, [address, refetch]);

  // Listen for newBetPlaced event from TradingChart as backup
  useEffect(() => {
    const handleNewBetPlaced = () => {
      console.log('📢 newBetPlaced event received, refetching positions...');
      // Small delay to allow database to update
      setTimeout(() => {
        refetch();
      }, 500);
    };

    window.addEventListener('newBetPlaced', handleNewBetPlaced);
    return () => window.removeEventListener('newBetPlaced', handleNewBetPlaced);
  }, [refetch]);

  // Calculate items per page based on available viewport height
  useEffect(() => {
    const calculateItemsPerPage = () => {
      // Wait for DOM to be ready
      if (!headerRef.current || !tableHeaderRef.current || !paginationRef.current || !containerRef.current) {
        return;
      }

      const containerHeight = containerRef.current.offsetHeight;
      const headerHeight = headerRef.current.offsetHeight;
      const tableHeaderHeight = tableHeaderRef.current.offsetHeight;
      const paginationHeight = paginationRef.current.offsetHeight;
      
      // Calculate available height for table body
      const availableHeight = containerHeight - headerHeight - tableHeaderHeight - paginationHeight;
      
      // Measure actual row height from first row if available
      let rowHeight = 40; // Default fallback
      if (tableBodyRef.current && tableBodyRef.current.firstElementChild) {
        const firstRow = tableBodyRef.current.firstElementChild as HTMLElement;
        rowHeight = firstRow.offsetHeight;
      }
      
      // Calculate how many rows can fit exactly (no scrolling)
      const calculatedItems = Math.max(1, Math.floor(availableHeight / rowHeight));
      
      setItemsPerPage(calculatedItems);
    };

    // Calculate after a short delay to ensure DOM is rendered
    const timeoutId = setTimeout(calculateItemsPerPage, 100);
    
    // Recalculate on window resize
    window.addEventListener('resize', calculateItemsPerPage);
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', calculateItemsPerPage);
    };
  }, [positions.length]); // Recalculate when data changes

  // Memoized calculations
  const totalPages = useMemo(() => {
    return Math.ceil(positions.length / itemsPerPage) || 1;
  }, [positions.length, itemsPerPage]);

  const { startIndex, endIndex, currentPositions } = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    const end = start + itemsPerPage;
    return {
      startIndex: start,
      endIndex: end,
      currentPositions: positions.slice(start, end)
    };
  }, [currentPage, itemsPerPage, positions]);

  // Prefetch next page
  useEffect(() => {
    const nextPage = currentPage + 1;
    const nextPageStartIndex = (nextPage - 1) * itemsPerPage;
    const nextPageBatchIndex = Math.floor(nextPageStartIndex / batchSize);
    const currentBatchIndex = getBatchIndexForPage(currentPage);
    
    if (nextPageBatchIndex > currentBatchIndex && hasMore && !isFetchingNextPage) {
      fetchNextPage();
    }
    
    const currentPageBatchIndex = getBatchIndexForPage(currentPage);
    const lastLoadedBatchIndex = getBatchIndexForPage(Math.ceil(positions.length / itemsPerPage));
    if (currentPageBatchIndex > lastLoadedBatchIndex && hasMore && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [currentPage, positions.length, batchSize, hasMore, isFetchingNextPage, fetchNextPage, itemsPerPage, getBatchIndexForPage]);

  const handleNextPage = useCallback(async () => {
    if (currentPage < totalPages) {
      const nextPage = currentPage + 1;
      const nextPageStartIndex = (nextPage - 1) * itemsPerPage;
      const nextPageBatchIndex = Math.floor(nextPageStartIndex / batchSize);
      const currentBatchIndex = getBatchIndexForPage(currentPage);
      
      // Prefetch if needed before changing page
      if (nextPageBatchIndex > currentBatchIndex && hasMore && !isFetchingNextPage) {
        await fetchNextPage();
      }
      
      // Smooth transition
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentPage(nextPage);
        setTimeout(() => setIsTransitioning(false), 50);
      }, 150);
    } else if (hasMore) {
      await fetchNextPage();
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentPage(currentPage + 1);
        setTimeout(() => setIsTransitioning(false), 50);
      }, 150);
    }
  }, [currentPage, totalPages, itemsPerPage, batchSize, hasMore, isFetchingNextPage, fetchNextPage, getBatchIndexForPage]);

  const handlePrevPage = useCallback(() => {
    if (currentPage > 1) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentPage(currentPage - 1);
        setTimeout(() => setIsTransitioning(false), 50);
      }, 150);
    }
  }, [currentPage]);

  const handlePageClick = useCallback((page: number) => {
    if (page !== currentPage) {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentPage(page);
        setTimeout(() => setIsTransitioning(false), 50);
      }, 150);
    }
  }, [currentPage]);

  // Pagination component
  const paginationNumbers = useMemo(() => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      
      if (currentPage <= 3) {
        for (let i = 2; i <= 3; i++) {
          pages.push(i);
        }
        pages.push('...');
        pages.push(totalPages - 1);
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push('...');
        for (let i = totalPages - 2; i <= totalPages; i++) {
          pages.push(i);
        }
      } else {
        pages.push('...');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    
    return pages;
  }, [totalPages, currentPage]);

  return (
    <div 
      ref={containerRef}
      className="bg-[#000000] border border-[rgba(214,213,212,0.1)] p-0 h-full overflow-hidden flex flex-col w-full"
    >
      <div 
        ref={headerRef}
        className="px-3 md:px-4 py-2 md:py-3 border-b border-[rgba(214,213,212,0.1)] flex items-center justify-between shrink-0"
      >
        <div className="flex items-center gap-2 md:gap-3">
          <h3 className="text-[16px] md:text-[18px] font-400 text-white m-0">Positions</h3>
          
          {/* WebSocket Status Indicator */}
          <div className="flex items-center gap-1.5 md:gap-2">
            <div className={clsx(
              'w-2 h-2 rounded-full transition-all duration-300',
              wsConnected 
                ? 'bg-[#00FF24] shadow-[0_0_8px_#00FF24] animate-pulse' 
                : 'bg-[#FF5E5E] shadow-[0_0_8px_#FF5E5E]'
            )} />
            <span className="text-[10px] md:text-xs text-white/60 font-mono hidden sm:inline">
              {wsConnected ? 'Live' : reconnectAttempts > 0 ? `Reconnecting (${reconnectAttempts}/10)` : 'Connecting...'}
            </span>
            {wsError && (
              <span className="text-[10px] md:text-xs text-[#FF5E5E]" title={wsError}>
                ⚠️
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2">
          {/* Manual Reconnect if WebSocket failed */}
          {!wsConnected && reconnectAttempts >= 10 && (
            <button
              onClick={wsReconnect}
              className="px-2 md:px-3 py-1 md:py-1.5 bg-[#FF5E5E] border border-[#000000] text-[#000000] text-[11px] md:text-[14px] rounded-[24px] transition hover:bg-[#000000] hover:border-[#ffffff] hover:text-[#ffffff]"
            >
              <span className="hidden sm:inline">Reconnect Live</span>
              <span className="sm:hidden">Reconnect</span>
            </button>
          )}
          
          {/* Refresh Button */}
          {positions.length > 0 && (
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="px-2 md:px-3 py-1 md:py-1.5 bg-[#00FF24] border border-[#000000] text-[#000000] text-[11px] md:text-[14px] rounded-[24px] transition hover:bg-[#000000] hover:border-[#ffffff] hover:text-[#ffffff] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 md:gap-2"
            >
              {isRefreshing && (
                <svg
                  className="h-4 w-4 text-[#000000]"
                  style={{ animation: 'spin 1s linear infinite' }}
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              )}
              {isRefreshing ? 'Refreshing' : 'Refresh'}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-6 flex-1 w-[233px] mx-auto">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00FF24]"></div>
          <p className="text-white/40 text-lg text-center">Loading positions...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-6 flex-1 w-[233px] mx-auto">
          <p className="text-[#ff6b6b] my-5">❌ {error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-[rgba(255,107,107,0.1)] border border-[rgba(255,107,107,0.3)] rounded-full text-[#ffffff] rounded-md text-sm transition hover:bg-[rgba(255,107,107,0.15)] hover:border-[rgba(255,107,107,0.4)]"
          >
            Retry
          </button>
        </div>
      ) : positions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-6 flex-1 w-[233px] mx-auto">
          <p className="text-white/50 text-lg text-center">
            {address ? 'No positions found' : 'Connect wallet to view positions'}
          </p>
        </div>
      ) : (
        <>
          <div className="w-full overflow-x-auto flex-1 min-h-0 relative scrollbar-thin -mx-3 md:mx-0">
            <table className="w-full border-collapse text-sm min-w-[600px] md:min-w-0">
              <thead ref={tableHeaderRef} className="bg-[#141414] sticky top-0 z-10">
                <tr>
                  {['Date & Time', 'Price Range', 'Expiry Time', 'Amount', 'Payout', 'Settlement', 'Status'].map(
                    (label) => (
                      <th
                        key={label}
                        className={clsx(
                          "px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]",
                          // Hide less important columns on mobile
                          (label === 'Date & Time' || label === 'Expiry Time' || label === 'Status') && 'hidden md:table-cell'
                        )}
                      >
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody 
                ref={tableBodyRef}
                key={currentPage}
                className={clsx(
                  'transition-all duration-300 ease-in-out',
                  isTransitioning && 'opacity-0 translate-y-2'
                )}
              >
                {currentPositions.map((position) => (
                  <PositionRow
                    key={position.id}
                    position={position}
                    onShare={handleShare}
                    onHelp={handleHelp}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {(totalPages > 1 || hasMore) && (
            <div 
              ref={paginationRef}
              className="flex items-center justify-center gap-2 px-4 py-5 bg-[#000000] shrink-0"
            >
              <button
                className="px-3 py-1.5 text-white text-[16px] flex items-center gap-1 transition hover:text-[#00FF24] disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={handlePrevPage}
                disabled={currentPage === 1}
              >
                ← Previous
              </button>

              <div className="flex items-center gap-1">
                {paginationNumbers.map((page, index) => {
                  if (page === '...') {
                    return (
                      <span key={`ellipsis-${index}`} className="px-2 text-white/60 text-[13px]">
                        ...
                      </span>
                    );
                  }
                  
                  const isActive = page === currentPage;
                  return (
                    <button
                      key={page}
                      onClick={() => handlePageClick(page as number)}
                      className={clsx(
                        'px-3 py-1.5 rounded text-[13px] transition-[background-color,color] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)]',
                        isActive
                          ? 'bg-white/15 text-white'
                          : 'text-white hover:text-[#00FF24] bg-[#000000]'
                      )}
                    >
                      {page}
                    </button>
                  );
                })}
              </div>

              <button
                className="px-3 py-1.5 text-white text-[16px] flex items-center gap-1 transition hover:text-[#00FF24] disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={handleNextPage}
                disabled={!hasMore && currentPage >= totalPages}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}