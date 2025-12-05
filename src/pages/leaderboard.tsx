import type { NextPage } from 'next';
import Head from 'next/head';
import { useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useUserProfile } from '../hooks/useUserProfile';
import { useLeaderboard } from '../hooks/useLeaderboard';

const ITEMS_PER_PAGE = 15;

const Leaderboard: NextPage = () => {
  const { address, isConnected } = useAccount();
  const { profile } = useUserProfile();
  const [currentPage, setCurrentPage] = useState(1);
  
  // Use TanStack Query + Supabase Realtime hook
  const { leaderboard: leaderboardData, isLoading } = useLeaderboard({
    limit: 100, // Fetch more for pagination
    enabled: isConnected,
  });

  // Find current user's position and PnL from leaderboard data
  const userEntry = address 
    ? leaderboardData.find(entry => entry.wallet_address.toLowerCase() === address.toLowerCase())
    : null;
  
  const userPosition = userEntry?.position || 0;
  const userPnL = userEntry?.pnl

  const isUserPnLNegative = userPnL?.startsWith('-') ?? false;

  // Get top 3 for podium display
  const topThree = leaderboardData.slice(0, 3);

  // Pagination calculations
  const totalPages = Math.ceil(leaderboardData.length / ITEMS_PER_PAGE);
  
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return leaderboardData.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [leaderboardData, currentPage]);

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  };

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        pages.push(1, 2, 3, 4, '...', totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
      } else {
        pages.push(1, '...', currentPage - 1, currentPage, currentPage + 1, '...', totalPages);
      }
    }
    
    return pages;
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex flex-col bg-black">
        <Head>
          <title>Leaderboard - Mercury Trade</title>
        </Head>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white text-lg font-geist">Connect your wallet to view leaderboard</p>
        </div>
      </div>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-black">
        <Head>
          <title>Leaderboard - Mercury Trade</title>
        </Head>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white text-lg font-geist">Loading leaderboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-geist relative bg-black">
      <Head>
        <title>Leaderboard - Mercury Trade</title>
      </Head>

      <style dangerouslySetInnerHTML={{
        __html: `
          .leaderboard-row:hover {
            background-color: #1a221d !important;
          }
          .leaderboard-row:hover > div {
            background-color: #1a221d !important;
          }
          .gradient-text-stroke {
            position: relative;
            background: linear-gradient(to bottom, #5D5D5D, #000000, #5D5D5D);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 14px transparent;
          }
          .gradient-text-stroke::after {
            content: attr(data-text);
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to bottom, #FFFFFF, #A9A9A9);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 0;
            z-index: 1;
          }
          .gradient-text-stroke-green {
            position: relative;
            background: linear-gradient(to bottom, #00FF4C, #000000, #00FF4C);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 14px transparent;
          }
          .gradient-text-stroke-green::after {
            content: attr(data-text);
            position: absolute;
            left:0;
            top: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to bottom, #FFFFFF, #5EFF75);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 0;
            z-index: 1;
          }
             .gradient-text-stroke-red {
            position: relative;
            background: linear-gradient(to bottom, #FF5E5E, #000000, #FF5E5E);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 14px transparent;
          }
          .gradient-text-stroke-red::after {
            content: attr(data-text);
            position: absolute;
            left:0;
            top: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(to bottom, #FFFFFF, #FF5E5E);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 0;
            z-index: 1;
          }
          .gradient-text-silver {
            position: relative;
            background: linear-gradient(180deg, #7C7C7C 0%, #22211F 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 3px transparent;
          }
          .gradient-text-silver::after {
            content: attr(data-text);
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(180deg, #F8F8F8 0%, #A2A2A2 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 0;
            z-index: 1;
          }
          .gradient-text-gold {
            position: relative;
            background: linear-gradient(180deg, #AD9400 0%, #302903 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 3px transparent;
          }
          .gradient-text-gold::after {
            content: attr(data-text);
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(180deg, #FFDA00 0%, #FFEC7E 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 0;
            z-index: 1;
          }
          .gradient-text-bronze {
            position: relative;
            background: linear-gradient(180deg, #9E6929 0%, rgba(157, 105, 40, 0.12) 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 3px transparent;
          }
          .gradient-text-bronze::after {
            content: attr(data-text);
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(180deg, #9D6827 0%, #FFB617 100%);
            -webkit-background-clip: text;
            background-clip: text;
            color: transparent;
            -webkit-text-stroke: 0;
            z-index: 1;
          }
          .perspective-grid {
            position: absolute;
            width: calc(100% + 200px);
            height: 100%;
            background-image: 
              linear-gradient(to right, rgba(0, 255, 36, 0.15) 2px, transparent 1px),
              linear-gradient(to bottom, rgba(0, 255, 36, 0.15) 2px, transparent 1px);
            background-size: 40px 40px;
            transform: perspective(1000px) rotateX(50deg) translateY(0%);
            transform-origin: center bottom;
            bottom: 0;
            left: -100px;
            mask-image: linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,1) 30%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0) 100%);
            -webkit-mask-image: linear-gradient(to top, rgba(0,0,0,0.6) 0%, rgba(0,0,0,1) 30%, rgba(0,0,0,0.6) 70%, rgba(0,0,0,0) 100%);
            pointer-events: none;
          }
        `
      }} />

      {/* Background Gradient */}
      <div 
        className="absolute top-0 left-0 w-full h-full pointer-events-none z-0"
        style={{
          background: 'linear-gradient(180deg, rgba(1, 29, 6, 0.8) 0%, rgba(1, 18, 2, 0.4) 50%, rgba(0, 0, 0, 0) 100%)'
        }}
      />

      {/* Main Content */}
      <div className="flex-1 p-4 w-full flex flex-col gap-4 z-10 relative">
        {/* Combined User Position, PnL and Top 3 Podium Section */}
        <div 
          className="rounded-xl p-6 flex gap-4 flex-col lg:flex-row relative overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #011D06 0%, #000C02 100%)',
            borderRadius: '12px',
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0px 0px 20px rgba(255, 255, 255, 0.05)'
          }}
        >
          {/* Grid Background inside the card */}
          <div className="absolute top-0 left-0 w-full h-full pointer-events-none z-0 overflow-hidden">
            <div className="perspective-grid" />
            {/* Gradient overlay from top to bottom */}
            <div 
              className="absolute top-0 left-0 w-full h-full"
              style={{
                background: 'linear-gradient(180deg, rgba(0, 0, 0, 0.6) 0%, rgba(1, 18, 2, 0.4) 60%, rgba(0, 2, 0, 0.2) 100%)'
              }}
            />
          </div>

          {/* Left Side - User Stats */}
          <div className="flex flex-col gap-4 w-full lg:w-auto h-[229px] relative z-10">
            <div className="flex flex-row gap-6">
              <div>
                <p className="text-white font-[600] text-[15px] m-4 italic font-geist">Your Position</p>
                <p 
                  className="gradient-text-stroke text-[64px] font-black italic leading-none tracking-[-0.05em] m-0 -mr-2 font-geist"
                  data-text={userPosition}
                >
                  {userPosition}
                </p>
              </div>
              <div>
                <p className="text-white font-[600] text-[15px] m-4  italic font-geist">Your PnL</p>
                <p 
                  className={`${isUserPnLNegative ? 'gradient-text-stroke-red' : 'gradient-text-stroke-green'} text-[64px] font-black italic leading-none tracking-[-0.05em] m-0 pr-5 font-geist`}
                  data-text={userPnL}
                >
                  {userPnL}
                </p>
              </div>
            </div>
          </div>

          {/* Right Side - Top 3 Podium */}
          <div className="flex-1 flex items-end justify-end gap-4 relative z-10">
            {/* 2nd Place */}
            <div className="flex flex-col items-center flex-1 max-w-[200px]">
              <div className="flex items-center gap-2 mb-2">
                {topThree[1]?.avatar ? (
                  <img src={topThree[1].avatar} alt={topThree[1].username} className="w-8 h-8 rounded-full flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center">
                    <span className="text-white text-xs font-medium">SV</span>
                  </div>
                )}
                <span className="text-white text-sm font-geist">{topThree[1]?.username || 'StarVoyager_X'}</span>
              </div>
              <div 
                className="flex items-center justify-center rounded-lg border border-white/10"
                style={{
                  width: '161px',
                  height: '180px',
                  background: 'linear-gradient(180deg, #010B02 0%, #1C1D1C 100%)',
                  marginBottom: '-4rem',
                }}
              >
                <p 
                  className="gradient-text-silver text-[42px] font-black italic m-0 pr-2 font-geist"
                  data-text="2nd"
                >
                  2nd
                </p>
              </div>
            </div>

            {/* 1st Place */}
            <div className="flex flex-col items-center flex-1 max-w-[200px]">
              <div className="flex items-center gap-2 mb-2">
                {topThree[0]?.avatar ? (
                  <img src={topThree[0].avatar} alt={topThree[0].username} className="w-8 h-8 rounded-full flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                    <span className="text-white text-xs font-medium">GR</span>
                  </div>
                )}
                <span className="text-white text-sm font-geist">{topThree[0]?.username || 'GalacticRanger_42'}</span>
              </div>
              <div 
                className="flex items-center justify-center rounded-lg border border-white/10"
                style={{
                  width: '161px',
                  height: '180px',
                  background: 'linear-gradient(180deg, #010B02 0%, #1C1D1C 100%)',
                  marginBottom: '-2rem',

                }}
              >
                <p 
                  className="gradient-text-gold text-[42px] font-black italic m-0 pr-2 font-geist"
                  data-text="1st"
                >
                  1st
                </p>
              </div>
            </div>

            {/* 3rd Place */}
            <div className="flex flex-col items-center flex-1 max-w-[200px]">
              <div className="flex items-center gap-2 mb-2">
                {topThree[2]?.avatar ? (
                  <img src={topThree[2].avatar} alt={topThree[2].username} className="w-8 h-8 rounded-full flex-shrink-0" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center">
                    <span className="text-white text-xs font-medium">CH</span>
                  </div>
                )}
                <span className="text-white text-sm font-geist">{topThree[2]?.username || 'CosmicHero_99'}</span>
              </div>
              <div 
                className="flex items-center justify-center rounded-lg border border-white/10"
                style={{
                  width: '161px',
                  height: '180px',
                  background: 'linear-gradient(180deg, #010B02 0%, #1C1D1C 100%)',
                  marginBottom: '-6rem',
                }}
              >
                <p 
                  className="gradient-text-bronze text-[42px] font-black italic  pr-2 mb-4 font-geist"
                  data-text="3rd"
                >
                  3rd
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Leaderboard Table */}
        <div 
          className="overflow-hidden rounded-xl flex-1 flex flex-col"
          style={{
            background: '#000',
          }}
        >
          {/* Header */}
          <div 
            className="sticky top-0 z-10 flex border-b border-[#282828] bg-[#1d271d]"
            style={{ background: '#1d271d' }}
          >
            <div className="pl-4 pr-2 py-2.5 text-left text-[16px] text-[#999] font-geist" style={{ width: '80px' }}>
              Position
            </div>
            <div className="pl-10 pr-2 py-2.5 text-left text-[16px] text-[#999] font-geist flex-1">
              Username
            </div>
            <div className="pl-2 pr-2 py-2.5 text-left text-[16px] text-[#999] font-geist" style={{ width: '120px' }}>
              PnL
            </div>
            <div className="pl-2 pr-2 py-2.5 text-left text-[16px] text-[#999] font-geist" style={{ width: '100px' }}>
              Refferals
            </div>
            <div className="pl-2 pr-4 py-2.5 text-left text-[16px] text-[#999] font-geist" style={{ width: '100px' }}>
              Points
            </div>
          </div>

          {/* Rows */}
          <div className="overflow-y-auto flex-1">
            {paginatedData.map((entry, index) => (
              <div 
                key={entry.position}
                className="leaderboard-row flex transition-colors duration-200 text-[#fff]"
                style={{ background: '#021202' }}
              >
                <div className="pl-4 pr-2 py-2.5 text-[16px] bg-[#000] font-geist" style={{ width: '80px' }}>
                  {String(entry.position).padStart(2, '0')}
                </div>
                <div className="pl-10 pr-2 py-2.5 text-[16px] bg-[#000] flex-1 font-geist">
                  <div className="flex items-center gap-2">
                    {entry.avatar ? (
                      <img src={entry.avatar} alt={entry.username} className="w-6 h-6 rounded-full flex-shrink-0" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-gray-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-[16px] font-medium font-geist">{entry.username.substring(0, 2).toUpperCase()}</span>
                      </div>
                    )}
                    <span>{entry.username}</span>
                  </div>
                </div>
                <div className="pl-2 pr-2 py-2.5 text-[16px] text-[#fff] bg-[#000] font-geist" style={{ width: '120px' }}>
                  {entry.pnl}
                </div>
                <div className="pl-2 pr-2 py-2.5 text-[16px] text-[#fff] bg-[#000] font-geist" style={{ width: '100px' }}>
                  {entry.referrals}
                </div>
                <div className="pl-2 pr-4 py-2.5 text-[16px] text-[#fff] bg-[#000] font-geist" style={{ width: '100px' }}>
                  {entry.points.toLocaleString()}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination Controls - Always show at bottom */}
          <div className="flex items-center justify-center gap-2 px-4 py-5 bg-[#000000] mt-auto">
            {/* Previous button */}
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1 || totalPages === 0}
              className="px-3 py-1.5 text-white text-[16px] flex items-center gap-1 transition hover:text-[#00FF24] disabled:opacity-30 disabled:cursor-not-allowed font-geist"
            >
              ← Previous
            </button>

            {/* Page numbers */}
            <div className="flex items-center gap-1">
              {(totalPages > 0 ? getPageNumbers() : [1]).map((page, index) => {
                if (page === '...') {
                  return (
                    <span key={`ellipsis-${index}`} className="px-2 text-white/60 text-[13px] font-geist">
                      ...
                    </span>
                  );
                }
                
                const isActive = page === currentPage || (totalPages === 0 && page === 1);
                return (
                  <button
                    key={page}
                    onClick={() => typeof page === 'number' && handlePageChange(page)}
                    disabled={totalPages === 0}
                    className={`px-3 py-1.5 rounded text-[13px] font-geist transition-[background-color,color] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'text-white hover:text-[#00FF24] bg-[#000000]'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>

            {/* Next button */}
            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={currentPage === totalPages || totalPages === 0}
              className="px-3 py-1.5 text-white text-[16px] flex items-center gap-1 transition hover:text-[#00FF24] disabled:opacity-30 disabled:cursor-not-allowed font-geist"
            >
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Leaderboard;

