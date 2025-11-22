'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount } from 'wagmi';
import { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUserBets } from '../hooks/useUserBets';
import clsx from 'clsx';

export default function Positions() {
  const { isConnected, address } = useAccount();
  const queryClient = useQueryClient();
  const { positions, isLoading, isFetchingNextPage, error, refetch, fetchNextPage, hasMore, batchSize } = useUserBets();
  const [currentPage, setCurrentPage] = useState(1);
  const [showMyPositions, setShowMyPositions] = useState(false);
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);
  const itemsPerPage = 10;

  const filteredPositions = useMemo(() => {
    if (showMyPositions && address) {
      return positions.filter((position) => position.userAddress.toLowerCase() === address.toLowerCase());
    }
    return positions;
  }, [positions, showMyPositions, address]);

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['userBets', 'all'] });
    await refetch();
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [showMyPositions]);

  const totalPages = Math.ceil(filteredPositions.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentPositions = filteredPositions.slice(startIndex, endIndex);

  const getBatchIndexForPage = (page: number) => {
    const startIndexForPage = (page - 1) * itemsPerPage;
    return Math.floor(startIndexForPage / batchSize);
  };

  useEffect(() => {
    if (showMyPositions && address) {
      const neededCount = currentPage * itemsPerPage;
      const hasEnough = filteredPositions.length >= neededCount;
      if (!hasEnough && hasMore && !isFetchingNextPage) {
        fetchNextPage();
        return;
      }
    }

    const requiredBatch = getBatchIndexForPage(currentPage);
    const lastLoadedBatch = getBatchIndexForPage(Math.ceil(filteredPositions.length / itemsPerPage));
    if (requiredBatch > lastLoadedBatch && hasMore && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [
    currentPage,
    filteredPositions.length,
    batchSize,
    hasMore,
    isFetchingNextPage,
    fetchNextPage,
    showMyPositions,
    address,
    itemsPerPage,
  ]);

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    } else if (hasMore) {
      if (showMyPositions && address) {
        const neededCount = (currentPage + 1) * itemsPerPage;
        const hasEnough = filteredPositions.length >= neededCount;
        if (!hasEnough) {
          fetchNextPage();
          return;
        }
      }
      fetchNextPage();
    }
  };

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleShare = (id: string) => console.log('Share position:', id);
  const handleHelp = (id: string) => console.log('Help for position:', id);

  return (
    <div className="bg-[#141414] border border-[rgba(214,213,212,0.1)] mx-auto p-0 max-h-[600px] overflow-hidden flex flex-col w-[99%] max-w-[1900px]">
      <div className="px-4 py-3 border-b border-[rgba(214,213,212,0.1)] flex items-center justify-between shrink-0">
        <h3 className="text-lg font-medium text-white m-0">Positions</h3>
        {positions.length > 0 && (
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 bg-white/10 border border-white/20 text-white text-[13px] transition hover:bg-white/15 hover:border-white/30"
          >
            Refresh
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-6 h-full w-[233px] mx-auto">
          <p className="text-white/40 text-lg text-center">Loading positions...</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-6 h-full w-[233px] mx-auto">
          <p className="text-[#ff6b6b] my-5">❌ {error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-[rgba(255,107,107,0.1)] border border-[rgba(255,107,107,0.3)] text-[#ff6b6b] rounded-md text-sm transition hover:bg-[rgba(255,107,107,0.15)] hover:border-[rgba(255,107,107,0.4)]"
          >
            Retry
          </button>
        </div>
      ) : filteredPositions.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-6 h-full w-[233px] mx-auto">
          <p className="text-white/50 text-lg text-center">
            {showMyPositions ? 'No positions found for your address' : 'No bets have been placed yet'}
          </p>
        </div>
      ) : (
        <div className="w-full overflow-x-auto overflow-y-auto flex-1 max-h-[calc(600px-50px)] relative scrollbar-thin">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-[#141414] sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#141414]">
                  <div className="flex items-center gap-3 relative">
                    <span>User</span>
                    {isConnected && address && (
                      <div className="flex gap-1 bg-white/5 border border-white/10 p-0.5 rounded relative">
                        {['all', 'mine'].map((key) => {
                          const isActive = (key === 'all' && !showMyPositions) || (key === 'mine' && showMyPositions);
                          return (
                            <button
                              key={key}
                              className={clsx(
                                'px-2 py-1 text-[11px] text-white/50 transition rounded relative',
                                isActive && 'bg-white/15 text-white'
                              )}
                              onClick={() => setShowMyPositions(key === 'mine')}
                              onMouseEnter={() => setHoveredButton(key)}
                              onMouseLeave={() => setHoveredButton(null)}
                            >
                              {key === 'all' ? 'All' : 'Mine'}
                              {hoveredButton === key && (
                                <span className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2 bg-black/90 text-white px-2.5 py-1 rounded text-[11px] font-[Geist Mono] whitespace-nowrap pointer-events-none border border-white/10 shadow-[0_2px_8px_rgba(0,0,0,0.3)]">
                                  {key === 'all' ? 'Show all positions' : 'Show only my positions'}
                                  <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-black/90" />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </th>
                {['Date & Time', 'Price Range', 'Expiry Time', 'Amount', 'Payout', 'Settlement & Price', 'Status', 'Action'].map(
                  (label) => (
                    <th
                      key={label}
                      className="px-3 py-2 text-left text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#141414]"
                    >
                      {label}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {currentPositions.map((position) => (
                <tr
                  key={position.id}
                  className="border-b border-[rgba(214,213,212,0.05)] transition hover:bg-white/5 text-[#e0e0e0]"
                >
                  <td className="px-3 py-2 text-xs align-middle">
                    <span title={position.userAddress}>
                      {position.userAddress.slice(0, 6)}...{position.userAddress.slice(-4)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs">{position.date}</td>
                  <td className="px-3 py-2 text-xs">{position.priceRange}</td>
                  <td className="px-3 py-2 text-xs">{position.expiryTime}</td>
                  <td className="px-3 py-2 text-xs">{position.amount}</td>
                  <td className="px-3 py-2 text-xs">{position.payout}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="inline-block">
                      <span
                        className={clsx(
                          'inline-flex items-center justify-center text-xs font-medium px-1.5 h-[20px] w-[59px] mr-5',
                          position.settlement.status === 'waiting' && 'bg-[rgba(255,193,7,0.15)] text-[#ffc107]',
                          position.settlement.status === 'win' && 'bg-[rgba(0,255,36,0.15)] text-[#00ff24]',
                          position.settlement.status === 'Loss' && 'bg-[rgba(255,68,68,0.15)] text-[#ff4444]'
                        )}
                      >
                        {position.settlement.status}
                      </span>
                      {position.settlement.price && <span className="text-[#999] inline-block text-xs">{position.settlement.price}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{position.status}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="flex items-center gap-2">
                      {position.status === 'Resolved' && (
                        <button
                          className="flex items-center gap-1 text-[11px] text-[#828892] px-2 py-1 transition hover:text-[#00ff24]"
                          onClick={() => handleShare(position.id)}
                        >
                          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                            <path
                              d="M8 4L10 2M10 2L8 0M10 2H6C4.89543 2 4 2.89543 4 4V5M4 7L2 9M2 9L4 11M2 9H6C7.10457 9 8 8.10457 8 7V6"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          Share
                        </button>
                      )}
                      <button
                        className="flex items-center gap-1 text-[11px] text-[#828892] px-2 py-1 transition hover:text-[#00ff24]"
                        onClick={() => handleHelp(position.id)}
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path
                            d="M1 1H9M9 1V9M9 1L1 9"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Help
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(totalPages > 1 ||
            hasMore ||
            (showMyPositions &&
              address &&
              filteredPositions.length < currentPage * itemsPerPage &&
              hasMore)) && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[rgba(214,213,212,0.1)] bg-[#141414] shrink-0">
              <button
                className="px-4 py-2 bg-white/5 border border-white/10 text-white text-[13px] flex items-center gap-1 transition hover:bg-white/10 hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={handlePrevPage}
                disabled={currentPage === 1}
              >
                ← Previous
              </button>

              <div className="flex flex-col items-center text-[13px] text-[#e0e0e0] gap-1">
                <span>
                  Page {currentPage} of {totalPages}
                </span>
                <span className="text-[11px] text-[#999]">
                  ({startIndex + 1}-{Math.min(endIndex, filteredPositions.length)} of {filteredPositions.length}
                  {hasMore &&
                    (!showMyPositions || filteredPositions.length < currentPage * itemsPerPage) &&
                    '+'}
                  )
                </span>
                {isFetchingNextPage && <span className="text-[12px] text-[#666]">Loading more...</span>}
              </div>

              <button
                className="px-4 py-2 bg-white/5 border border-white/10 text-white text-[13px] flex items-center gap-1 transition hover:bg-white/10 hover:border-white/20 disabled:opacity-30 disabled:cursor-not-allowed"
                onClick={handleNextPage}
                disabled={
                  (!hasMore && currentPage >= totalPages) ||
                  (showMyPositions &&
                    address &&
                    filteredPositions.length >= currentPage * itemsPerPage &&
                    currentPage >= totalPages &&
                    !hasMore)
                }
              >
                Next →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}