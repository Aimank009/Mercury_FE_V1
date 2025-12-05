import type { NextPage } from 'next';
import Head from 'next/head';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { useModal } from '../contexts/ModalContext';
import { useUserBets } from '../hooks/useUserBets';
import { useWrapperBalance } from '../hooks/useWrapperBalance';
import { useUserProfile } from '../hooks/useUserProfile';
import { useUserTransactions } from '../hooks/useUserTransactions';
import { useUserStats } from '../hooks/useUserStats';
import { useReferrals } from '../hooks/useReferrals';
import { usePnL } from '../hooks/useTotalProfit';
import { usePnLHistory } from '../hooks/usePnLHistory';
import { useDepositsWithdrawals } from '../hooks/useDepositsWithdrawals';

interface PortfolioStats {
  totalBets: number;
  totalWagered: number;
  totalWon: number;
  totalLost: number;
  winRate: number;
  netProfit: number;
  rewardsEarned: number;
  referrals: number;
  volume: number;
}

const Portfolio: NextPage = () => {
  const { address, isConnected } = useAccount();
  const { positions, isLoading, isFetching, fetchNextPage, hasMore } = useUserBets();
  const { balanceUSD } = useWrapperBalance(address);
  const { profile } = useUserProfile();
  const { data: transactions, isLoading: isLoadingTransactions } = useUserTransactions(address);
  const { data: userStats } = useUserStats();
  const { stats: referralStats } = useReferrals();
  const { pnl } = usePnL();
  const { transactions: depositWithdrawals, isLoading: isLoadingDeposits } = useDepositsWithdrawals();
  const { showDepositModal } = useModal();
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'in progress' | 'Resolved'>('all');
  const [selectedTab, setSelectedTab] = useState<'300' | '200' | '100'>('300');
  const [selectedTimePeriod, setSelectedTimePeriod] = useState<'1D' | '3D' | '7D' | '14D' | '30D' | '3M' | '6M' | '1Y'>('30D');
  const { data: pnlHistory, isLoading: isLoadingPnL } = usePnLHistory(selectedTimePeriod);
  const [showTimeDropdown, setShowTimeDropdown] = useState(false);
  const [activeSection, setActiveSection] = useState<'history' | 'achievements' | 'transactions'>('history');
  const [currentPage, setCurrentPage] = useState(1);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const ITEMS_PER_PAGE = 15;
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTimeDropdown(false);
      }
    };

    if (showTimeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTimeDropdown]);

  const handlePageChange = (newPage: number) => {
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentPage(newPage);
      setTimeout(() => setIsTransitioning(false), 50);
    }, 150);
  };

  // Calculate portfolio statistics
  const stats: PortfolioStats = useMemo(() => {
    // Get trading_volume from user profile (from users table)
    const tradingVolume = profile?.trading_volume ? parseFloat(profile.trading_volume.toString()) : 0;
    
    if (userStats) {
      return {
        totalBets: userStats.totalBets,
        totalWagered: userStats.totalWagered,
        totalWon: userStats.totalWon,
        totalLost: userStats.totalWagered - userStats.netProfit - userStats.totalWon, // Approximate
        winRate: userStats.winRate,
        netProfit: userStats.netProfit,
        rewardsEarned: userStats.totalWon, // Using Total Won as requested
        referrals: referralStats?.totalReferrals || 0,
        volume: tradingVolume || userStats.totalWagered, // Use trading_volume from users table, fallback to calculated
      };
    }

    // Fallback to client-side calculation if stats not loaded yet
    const totalBets = positions.length;
    const totalWagered = positions.reduce((sum, p) => sum + parseFloat(p.amount.replace('$', '')), 0);
    
    const resolvedPositions = positions.filter(p => p.status === 'Resolved');
    const wonPositions = resolvedPositions.filter(p => p.settlement.status === 'win');
    const lostPositions = resolvedPositions.filter(p => p.settlement.status === 'Loss');
    
    const totalWon = wonPositions.reduce((sum, p) => {
      const payout = parseFloat(p.payout.replace(/[$X]/g, '').split(' ')[0]);
      return sum + payout;
    }, 0);
    
    const totalLost = lostPositions.reduce((sum, p) => sum + parseFloat(p.amount.replace('$', '')), 0);
    
    const winRate = resolvedPositions.length > 0 ? (wonPositions.length / resolvedPositions.length) * 100 : 0;
    const netProfit = totalWon - totalWagered;

    return {
      totalBets,
      totalWagered,
      totalWon,
      totalLost,
      winRate,
      netProfit,
      rewardsEarned: totalWon - totalWagered,
      referrals: referralStats?.totalReferrals || 0,
      volume: tradingVolume || totalWagered, // Use trading_volume from users table, fallback to calculated
    };
  }, [positions, userStats, referralStats, profile]);

  // Filter positions based on selected filter
  const filteredPositions = useMemo(() => {
    if (selectedFilter === 'all') return positions;
    return positions.filter(p => p.status === selectedFilter);
  }, [positions, selectedFilter]);

  // Pagination logic
  const totalPages = useMemo(() => {
    if (activeSection === 'transactions') {
      return Math.ceil((depositWithdrawals?.length || 0) / ITEMS_PER_PAGE);
    }
    return Math.ceil(filteredPositions.length / ITEMS_PER_PAGE);
  }, [activeSection, filteredPositions.length, depositWithdrawals?.length]);

  const paginatedPositions = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredPositions.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [filteredPositions, currentPage]);

  const paginatedTransactions = useMemo(() => {
    if (!depositWithdrawals) return [];
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return depositWithdrawals.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [depositWithdrawals, currentPage]);

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

  // Process PnL history data for chart - plot every individual PnL value with timestamps
  const chartData = useMemo(() => {
    console.log('📊 Raw pnlHistory:', {
      exists: !!pnlHistory,
      length: pnlHistory?.length || 0,
      sample: pnlHistory?.slice(0, 3)
    });
    
    if (!pnlHistory || pnlHistory.length === 0) {
      console.log('⚠️ No PnL history data available');
      return { values: [], timestamps: [] };
    }

    // Extract individual PnL values with their timestamps (no cumulative, no averaging)
    // Sort by timestamp to ensure chronological order (oldest first = left side of chart)
    const sortedData = [...pnlHistory].sort((a, b) => a.timestamp - b.timestamp);
    const pnlValues = sortedData.map(point => point.pnl); // Use individual PnL value directly
    const timestamps = sortedData.map(point => point.timestamp); // Keep timestamps for X-axis spacing
    
    console.log('📊 Chart data processing:', {
      totalPoints: pnlValues.length,
      firstValue: pnlValues[0],
      lastValue: pnlValues[pnlValues.length - 1],
      minValue: Math.min(...pnlValues),
      maxValue: Math.max(...pnlValues),
      sampleValues: pnlValues.slice(0, 10),
      timeRange: timestamps.length > 0 ? {
        start: new Date(timestamps[0]).toISOString(),
        end: new Date(timestamps[timestamps.length - 1]).toISOString()
      } : null
    });
    
    // Return both values and timestamps for proper X-axis spacing
    return { values: pnlValues, timestamps };
  }, [pnlHistory]);

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-black flex flex-col">
        <Head>
          <title>Portfolio - Mercury Trade</title>
        </Head>
        
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white text-lg">Connect your wallet to view portfolio</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col font-geist relative">
      {/* Background Gradient */}
      <div 
        className="absolute top-0 left-0 w-full h-[600px] pointer-events-none z-0"
        style={{
          background: 'linear-gradient(180deg, rgba(1, 29, 6, 1) 0%, rgba(0, 0, 0, 0) 100%)'
        }}
      />
      <Head>
        <title>Portfolio - Mercury Trade</title>
      </Head>

       <style dangerouslySetInnerHTML={{
        __html: `
          .leaderboard-row:hover {
            background-color: #1a221d !important;
          }
          .leaderboard-row:hover > div {
            background-color: #1a221d !important;
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
          
        `
      }} />

      {/* Main Content */}
      <div className="flex-1 p-4 w-full flex flex-col gap-4 z-10 relative">
        <div className="flex gap-4 flex-col lg:flex-row">
          {/* Left Column - User Profile */}
          <div className="w-full lg:w-[389px] flex-shrink-0">
            <div 
              className="rounded-xl flex flex-col h-[372px] pb-4"
              style={{
                background: 'linear-gradient(180deg, #011D06 0%, #000C02 100%)',
                borderRadius: '12px',
                boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0px 0px 20px rgba(255, 255, 255, 0.05)'
              }}
            >
              {/* Avatar */}
              <div className="flex justify-center pt-[37px] mb-2">
                {profile?.avatar_url ? (
                  <img 
                    src={profile.avatar_url} 
                    alt="Avatar" 
                    className="w-[124px] h-[124px] rounded-full object-cover"
                  />
                ) : (
                  <div className="w-[124px] h-[124px] rounded-full bg-gradient-to-br from-[#FFD700] to-[#FFA500]" />
                )}
              </div>
              
              {/* Username */}
              <div className="text-center mb-4">
                <h1 className="text-white text-[24px] font-medium m-0 font-geist">
                  {profile?.username || 'BuzzLightyear'}
                </h1>
              </div>
              
              {/* Stats List */}
              <div className="flex flex-col w-full mt-2">
                <div className="flex items-center h-[28px]  justify-between px-[18px] py-[10px] border-b border-[rgba(255,255,255,0.1)]">
                  <p className="text-white/60 text-[15px] m-0 font-geist">
                    Date Joined
                  </p>
                  <p className="text-[rgba(255,255,255,0.6)] text-[15px] m-0 font-geist">
                    {profile?.created_at 
                      ? new Date(profile.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '24 Jul 2024'}
                  </p>
                </div>
                <div className="flex items-center h-[28px] justify-between px-[18px] py-[10px] bg-[#1b271a] border-b border-[rgba(255,255,255,0.1)]">
                  <p className="text-white/60 text-[15px] m-0 font-geist">
                    Rewards Earned
                  </p>
                  <p className="text-[rgba(255,255,255,0.6)] text-[15px] m-0 font-geist">
                    {(profile?.xp || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="flex items-center h-[28px]   justify-between px-[18px] py-[10px] border-b border-[rgba(255,255,255,0.1)]">
                  <p className="text-white/60 text-[15px] m-0 font-geist">
                    Refferals
                  </p>
                  <p className="text-[rgba(255,255,255,0.6)] text-[15px] m-0 font-geist">
                    {stats.referrals}
                  </p>
                </div>
                <div className="flex items-center h-[28px] justify-between px-[18px] py-[10px] bg-[#1b271a]">
                  <p className="text-white/60 text-[15px] m-0 font-geist">
                    Volume
                  </p>
                  <p className="text-[rgba(255,255,255,0.6)] text-[15px] m-0 font-geist">
                    ${stats.volume.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-2 w-full">
            {/* Account Value Chart */}
            <div 
              className="rounded-xl p-6 h-[372px]"
              style={{
                background: 'linear-gradient(180deg, #011D06 0%, #000C02 100%)',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                 boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0px 0px 20px rgba(255, 255, 255, 0.05)'
              }}
            >
          {/* Account Value Heading */}
        

          <div className="flex items-center  justify-between mb-6">
            <div>
             
                <p 
                  className={`${pnl<0 ? 'gradient-text-stroke-red' : 'gradient-text-stroke-green'} text-[50px] font-black italic leading-none tracking-[-0.05em] m-0 pr-5  font-geist`}
                  data-text={pnl<0 ? `$${pnl.toFixed(2)}` : `+$${pnl.toFixed(2)}`}
                >
                  {pnl<0 ? `$${pnl.toFixed(2)}` : `+$${pnl.toFixed(2)}`}
                </p>
            </div>
            <div className="flex items-center gap-5">
            <div className="">
            <h3 className="text-white/40 text-[16px] font-[400] font-geist m-0">Account Value</h3>
          </div>
            <div className="flex gap-2 items-center">
              {/* PnL Button */}
              <button
                className="px-4 py-2 rounded-[20px] text-sm font-medium transition-all bg-[#00ff24] text-black border-none"
              >
                PnL
              </button>
              {/* Time Period Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowTimeDropdown(!showTimeDropdown)}
                  className="px-4 py-2 rounded-[20px] text-sm font-medium transition-all bg-transparent text-[#999] border border-[#333] flex items-center gap-1"
                >
                  {selectedTimePeriod}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                {showTimeDropdown && (
                  <div className="absolute right-0 mt-2 bg-[#1a1a1a] border border-[#333] rounded-lg shadow-lg z-10 min-w-[80px] overflow-hidden">
                    {(['1D', '3D', '7D', '14D', '30D', '3M', '6M', '1Y'] as const).map((period) => (
                      <button
                        key={period}
                        onClick={() => {
                          setSelectedTimePeriod(period);
                          setShowTimeDropdown(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm transition-all first:rounded-t-lg last:rounded-b-lg ${
                          selectedTimePeriod === period
                            ? 'bg-[#00ff24] text-black'
                            : 'text-[#999] hover:bg-[#2a2a2a]'
                        }`}
                      >
                        {period}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
              </div>
            
          </div>

          {/* Chart Visualization */}
          <div className="relative h-[372px]">
            {(() => {
              // Get values and timestamps from chartData
              const pnlValues = chartData?.values || [];
              const timestamps = chartData?.timestamps || [];
              
              // Calculate dynamic Y-axis range based on PnL data
              let yAxisMin = -10;
              let yAxisMax = 10;
              let yAxisLabels: number[] = [10, 6, 2, -2, -6, -10];
              
              if (pnlValues.length > 0) {
                const minValue = Math.min(...pnlValues);
                const maxValue = Math.max(...pnlValues);
                // Y-axis range: min PnL - 10 to max PnL + 10
                yAxisMin = minValue - 10;
                yAxisMax = maxValue + 10;
                
                console.log('📊 Y-axis calculation:', {
                  dataPoints: pnlValues.length,
                  minValue,
                  maxValue,
                  yAxisMin,
                  yAxisMax,
                  sampleValues: pnlValues.slice(0, 10)
                });
                
                // Create 6 evenly spaced labels from max (top) to min (bottom)
                const range = yAxisMax - yAxisMin;
                yAxisLabels = [0, 1, 2, 3, 4, 5].map(i => {
                  return Math.round((yAxisMax - (range * i / 5)) * 10) / 10;
                });
              } else {
                console.log('⚠️ No PnL values for Y-axis calculation');
              }
              
              // Constants for chart calculations - must match Y-axis label positions
              const labelHeight = 16; // Approximate text height (text-xs)
              const topPadding = 8; // py-2 = 0.5rem = 8px
              const gapSize = 28; // gap-7 = 1.75rem = 28px (matches the flex gap-7)
              
              // Calculate Y positions for each grid line to match label centers
              const getGridLineY = (index: number) => {
                return topPadding + (labelHeight / 2) + (index * (labelHeight + gapSize));
              };
              
              // Chart area: from top (max) to bottom (min)
              const topY = getGridLineY(0); // Top label
              const bottomY = getGridLineY(5); // Bottom label
              const chartAreaHeight = bottomY - topY;
              
              return (
                <>
                  {/* Y-axis Labels */}
                  <div className="absolute left-0 top-0 h-full flex flex-col gap-7 py-2 pr-4">
                    {yAxisLabels.map((value) => (
                      <span key={value} className="text-[#999] text-xs">
                        {value.toFixed(1)}
                      </span>
                    ))}
                  </div>
                  
                  {/* Chart Area */}
                  <div className="ml-12 h-full relative">
                
                    <svg width="102%" height="100%" viewBox="0 0 800 372" preserveAspectRatio="none">
                      {/* Grid lines - aligned with Y-axis labels (matching gap-7 spacing) */}
                      {yAxisLabels.map((yValue, i) => {
                        // Use the same calculation as getGridLineY to match label centers exactly
                        const yPosition = getGridLineY(i);
                        return (
                          <line
                            key={yValue}
                            x1="0"
                            y1={yPosition}
                            x2="800"
                            y2={yPosition}
                            stroke="#1a1a1a"
                            strokeWidth="1"
                          />
                        );
                      })}
                      
                      {/* Chart line - dynamically scaled to fit Y-axis range with proper X-axis spacing */}
                      {(() => {
                        if (pnlValues.length === 0) {
                          console.log('⚠️ No data to plot');
                          return null;
                        }
                        
                        const dataRange = yAxisMax - yAxisMin;
                        
                        console.log('📊 Chart plotting:', {
                          dataPoints: pnlValues.length,
                          firstValue: pnlValues[0],
                          lastValue: pnlValues[pnlValues.length - 1],
                          yAxisMin,
                          yAxisMax,
                          dataRange,
                          topY,
                          bottomY,
                          chartAreaHeight
                        });
                        
                        // Build chart points
                        const chartPoints: { x: number; y: number }[] = [];
                        
                        for (let i = 0; i < pnlValues.length; i++) {
                          const value = pnlValues[i];
                          
                          // Calculate X position based on index (evenly spaced)
                          // Left = oldest (first), Right = newest (last)
                          const xPosition = pnlValues.length > 1 
                            ? (i / (pnlValues.length - 1)) * 800 
                            : 400;
                          
                          // Calculate Y position based on value
                          // Higher values = smaller Y (top of chart)
                          // Lower values = larger Y (bottom of chart)
                          const normalizedValue = dataRange > 0 
                            ? ((value - yAxisMin) / dataRange)
                            : 0.5;
                          const clampedValue = Math.max(0, Math.min(1, normalizedValue));
                          const yPosition = topY + ((1 - clampedValue) * chartAreaHeight);
                          
                          chartPoints.push({ x: xPosition, y: yPosition });
                          
                          // Debug first and last few points
                          if (i < 3 || i >= pnlValues.length - 3) {
                            console.log(`📊 Point ${i}:`, {
                              value: value.toFixed(2),
                              normalizedValue: normalizedValue.toFixed(3),
                              xPosition: Math.round(xPosition),
                              yPosition: Math.round(yPosition)
                            });
                          }
                        }
                        
                        // Create polyline points string
                        const points = chartPoints.map(p => `${p.x},${p.y}`).join(' ');
                        
                        // Create polygon for fill (from bottom-left, through points, to bottom-right)
                        const firstX = chartPoints[0]?.x || 0;
                        const lastX = chartPoints[chartPoints.length - 1]?.x || 800;
                        const polygonPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;
                        
                        return (
                          <>
                            <polyline
                              points={points}
                              fill="none"
                              stroke="#00ff24"
                              strokeWidth="2"
                            />
                            <polygon
                              points={polygonPoints}
                              fill="url(#gradient)"
                              opacity="0.3"
                            />
                          </>
                        );
                      })()}
                      
                      <defs>
                        <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#00ff24" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#00ff24" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </div>
                </>
              );
            })()}
          </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trade History - Full Width */}
      <div className="w-full px-4 pb-4">
            <div className="bg-[#000000] border border-[rgba(214,213,212,0.1)] rounded-xl overflow-hidden flex flex-col">
              <div className="px-3 md:px-4 py-2 md:py-3 border-b border-[rgba(214,213,212,0.1)] flex items-center gap-8 shrink-0">
                <button
                  onClick={() => {
                    setActiveSection('history');
                    setCurrentPage(1);
                  }}
                  className={`text-[15px] font-medium transition-all font-geist px-3 py-1 rounded-[24px] ${
                    activeSection === 'history' ? 'text-white' : 'text-[#999] hover:text-white'
                  }`}
                  style={activeSection === 'history' ? {
                    background: '#00570C',
                    boxShadow: 'inset 0 0 0 1px #00FF24, 0px 2px 8.1px rgba(0, 255, 36, 0.12)',
                  } : {}}
                >
                  Trade History
                </button>
                <button 
                  className="text-[15px] font-medium transition-all font-geist px-3 py-1 rounded-[24px] text-[#999] cursor-default"
                >
                  Achievements
                </button>
                <button 
                  onClick={() => {
                    setActiveSection('transactions');
                    setCurrentPage(1);
                  }}
                  className={`text-[15px] font-medium transition-all font-geist px-3 py-1 rounded-[24px] ${
                    activeSection === 'transactions' ? 'text-white' : 'text-[#999] hover:text-white'
                  }`}
                  style={activeSection === 'transactions' ? {
                    background: '#00570C',
                    boxShadow: 'inset 0 0 0 1px #00FF24, 0px 2px 8.1px rgba(0, 255, 36, 0.12)',
                  } : {}}
                >
                  Deposit and Withdrawal
                </button>
              </div>

              {/* Table Content */}
              <div 
                className="w-full overflow-x-auto overflow-y-hidden flex-1 min-h-0 relative scrollbar-thin"
                style={{ scrollbarGutter: 'stable' }}
              >
                {activeSection === 'history' && (
                  <table className="w-full border-collapse text-sm min-w-[600px] md:min-w-0">
                    <thead className="bg-[#141414] sticky top-0 z-10">
                      <tr>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000] hidden md:table-cell">Date & Time</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]">Price Range</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000] hidden md:table-cell">Expiry Time</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]">Amount</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]">Payout</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]">Settlement</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000] hidden md:table-cell">Status</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]"></th>
                      </tr>
                    </thead>
                    <tbody className={`transition-all duration-300 ease-in-out ${isTransitioning ? 'opacity-0 translate-y-2' : ''}`}>
                      {isLoading ? (
                        <tr>
                          <td colSpan={8} className="px-12 py-12 text-center text-[#999]">
                            <div className="flex items-center justify-center gap-3">
                              <div className="w-5 h-5 border-2 border-[#00ff24] border-t-transparent rounded-full animate-spin" />
                              Loading positions...
                            </div>
                          </td>
                        </tr>
                      ) : filteredPositions.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-12 py-12 text-center text-[#999]">
                            No trades found
                          </td>
                        </tr>
                      ) : (
                        paginatedPositions.map((position) => (
                          <tr 
                            key={position.id}
                            className="border-b border-[rgba(214,213,212,0.15)] transition hover:bg-white/5 text-[#e0e0e0]"
                          >
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs hidden md:table-cell">
                              {position.date}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
                              {position.priceRange}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs hidden md:table-cell">
                              {position.expiryTime}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
                              {position.amount}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
                              {position.payout}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
                              <div className="inline-block">
                                <span className={`inline-flex items-center justify-center text-[12px] font-400 px-1 py-1.5 w-[59px] mr-5 rounded-full ${
                                  position.settlement.status === 'win' 
                                    ? 'bg-[#00FF24] text-[#000000]' 
                                    : position.settlement.status === 'Loss' 
                                    ? 'bg-[#FF5E5E] text-[#000000]' 
                                    : 'bg-[#FFDA00] text-[#000000]'
                                }`}>
                                  {position.settlement.status}
                                </span>
                                {position.settlement.price && (
                                  <span className="text-[#999] inline-block text-[12px] ml-1">
                                    {position.settlement.price}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs hidden md:table-cell">
                              {position.status}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs overflow-x-hidden">
                              <div className="flex items-center -mr-20 gap-2 md:gap-4 ">
                                {position.status === 'Resolved' && (
                                  <button className="flex items-center gap-1 text-[9px] md:text-[11px] border-2 border-[#333] rounded-[24px] bg-[#1A1A1A] text-[#767676] px-2 md:px-3 py-1 md:py-2 transition hover:text-[#00ff24] hover:border-[#00ff24]">
                                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M8.25 0.916748C9.01083 0.916748 9.625 1.53091 9.625 2.29175C9.625 3.05258 9.01083 3.66675 8.25 3.66675C7.88807 3.66675 7.55832 3.52465 7.31543 3.29565L4.08398 5.17944C4.10685 5.28468 4.12496 5.38996 4.125 5.49976C4.125 5.60976 4.1069 5.71563 4.08398 5.82104L7.31934 7.70483C7.56225 7.47567 7.88792 7.33374 8.25 7.33374C9.01083 7.33374 9.625 7.94791 9.625 8.70874C9.62482 9.46942 9.01072 10.0837 8.25 10.0837C7.48928 10.0837 6.87518 9.46942 6.875 8.70874C6.875 8.59882 6.89312 8.4931 6.91602 8.39233L3.68457 6.50366C3.43709 6.73275 3.11201 6.87476 2.75 6.87476C1.98917 6.87476 1.375 6.26059 1.375 5.49976C1.37518 4.73907 1.98928 4.12476 2.75 4.12476C3.11185 4.12476 3.43713 4.26694 3.68457 4.49585L6.91602 2.61304C6.8931 2.5122 6.875 2.40175 6.875 2.29175C6.875 1.53091 7.48917 0.916748 8.25 0.916748ZM8.25 8.24976C7.99792 8.24976 7.79199 8.45666 7.79199 8.70874C7.79217 8.96068 7.99803 9.16675 8.25 9.16675C8.50197 9.16675 8.70783 8.96068 8.70801 8.70874C8.70801 8.45666 8.50208 8.24976 8.25 8.24976ZM2.75 5.04175C2.49803 5.04175 2.29217 5.24782 2.29199 5.49976C2.29199 5.75184 2.49792 5.95874 2.75 5.95874C3.00208 5.95874 3.20801 5.75184 3.20801 5.49976C3.20783 5.24782 3.00197 5.04175 2.75 5.04175ZM8.25 1.83374C7.99792 1.83374 7.79199 2.03966 7.79199 2.29175C7.79199 2.54383 7.99792 2.74976 8.25 2.74976C8.50208 2.74976 8.70801 2.54383 8.70801 2.29175C8.70801 2.03966 8.50208 1.83374 8.25 1.83374Z" fill="currentColor"/>
                                    </svg>
                                    Share
                                  </button>
                                )}
                                <button className="flex items-center gap-1 text-[9px] md:text-[11px] border-2 border-[#333] rounded-[24px] bg-[#1A1A1A] text-[#767676] px-2 md:px-3 py-1 md:py-2 transition hover:text-[#00ff24] hover:border-[#00ff24]">
                                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M7.26177 4.67163V2.79663C7.26177 1.87454 5.77344 1.81746 5.77344 2.79663" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M5.77363 4.16671V1.96337C5.77363 1.04129 4.2853 0.984207 4.2853 1.96337V2.71337M4.28488 4.48421V2.79671C4.28488 1.87462 2.72363 1.81754 2.72363 2.79671V5.41671" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M7.26165 3.88012C7.26165 2.90095 8.74998 2.95804 8.74998 3.88012V5.71345C8.74998 8.5647 4.66707 9.70429 2.80082 7.83595L1.46123 6.48595C0.840817 5.79345 1.68498 4.37512 2.72373 5.41679L3.1404 5.83345" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                  Help
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {activeSection === 'transactions' && (
                  <table className="w-full border-collapse text-sm min-w-[600px] md:min-w-0">
                    <thead className="bg-[#141414] sticky top-0 z-10">
                      <tr>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]">Date & Time</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]">Amount</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]">Final Balance</th>
                        <th className="px-2 md:px-3 py-2 text-right text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]">Status</th>
                        <th className="px-2 md:px-3 py-2 text-left text-[10px] md:text-xs text-[#999] font-normal border-b border-[rgba(214,213,212,0.1)] bg-[#000000]"></th>
                      </tr>
                    </thead>
                    <tbody className={`transition-all duration-300 ease-in-out ${isTransitioning ? 'opacity-0 translate-y-2' : ''}`}>
                      {isLoadingDeposits ? (
                        <tr>
                          <td colSpan={5} className="px-12 py-12 text-center text-[#999]">
                            <div className="flex items-center justify-center gap-3">
                              <div className="w-5 h-5 border-2 border-[#00ff24] border-t-transparent rounded-full animate-spin" />
                              Loading deposits & withdrawals...
                            </div>
                          </td>
                        </tr>
                      ) : !depositWithdrawals || depositWithdrawals.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-12 py-12 text-center text-[#999]">
                            No deposits or withdrawals found
                          </td>
                        </tr>
                      ) : (
                        paginatedTransactions.map((tx) => (
                          <tr 
                            key={tx.id}
                            className="border-b border-[rgba(214,213,212,0.15)] transition hover:bg-white/5 text-[#e0e0e0]"
                          >
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
                              {new Date(tx.timestamp).toLocaleString('en-US', {
                                year: 'numeric',
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: false
                              })}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
                              {tx.amount.toFixed(2)}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs">
                              {tx.newBalance.toFixed(2)}
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs text-right">
                              <span className={`inline-flex items-center justify-center text-[12px] font-400 px-3 py-1 rounded-full ${
                                tx.type === 'deposit'
                                  ? 'bg-[#00FF24] text-[#000000]'
                                  : 'bg-[#FF5E5E] text-[#000000]'
                              }`}>
                                {tx.type === 'deposit' ? 'Deposited' : 'Withdrawn'}
                              </span>
                            </td>
                            <td className="px-2 md:px-3 py-2 text-[10px] md:text-xs text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button className="flex items-center gap-1 text-[9px] md:text-[11px] border-2 border-[#333] rounded-[24px] bg-[#1A1A1A] text-[#767676] px-2 md:px-3 py-1 md:py-2 transition hover:text-[#00ff24] hover:border-[#00ff24]">
                                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M8.25 0.916748C9.01083 0.916748 9.625 1.53091 9.625 2.29175C9.625 3.05258 9.01083 3.66675 8.25 3.66675C7.88807 3.66675 7.55832 3.52465 7.31543 3.29565L4.08398 5.17944C4.10685 5.28468 4.12496 5.38996 4.125 5.49976C4.125 5.60976 4.1069 5.71563 4.08398 5.82104L7.31934 7.70483C7.56225 7.47567 7.88792 7.33374 8.25 7.33374C9.01083 7.33374 9.625 7.94791 9.625 8.70874C9.62482 9.46942 9.01072 10.0837 8.25 10.0837C7.48928 10.0837 6.87518 9.46942 6.875 8.70874C6.875 8.59882 6.89312 8.4931 6.91602 8.39233L3.68457 6.50366C3.43709 6.73275 3.11201 6.87476 2.75 6.87476C1.98917 6.87476 1.375 6.26059 1.375 5.49976C1.37518 4.73907 1.98928 4.12476 2.75 4.12476C3.11185 4.12476 3.43713 4.26694 3.68457 4.49585L6.91602 2.61304C6.8931 2.5122 6.875 2.40175 6.875 2.29175C6.875 1.53091 7.48917 0.916748 8.25 0.916748ZM8.25 8.24976C7.99792 8.24976 7.79199 8.45666 7.79199 8.70874C7.79217 8.96068 7.99803 9.16675 8.25 9.16675C8.50197 9.16675 8.70783 8.96068 8.70801 8.70874C8.70801 8.45666 8.50208 8.24976 8.25 8.24976ZM2.75 5.04175C2.49803 5.04175 2.29217 5.24782 2.29199 5.49976C2.29199 5.75184 2.49792 5.95874 2.75 5.95874C3.00208 5.95874 3.20801 5.75184 3.20801 5.49976C3.20783 5.24782 3.00197 5.04175 2.75 5.04175ZM8.25 1.83374C7.99792 1.83374 7.79199 2.03966 7.79199 2.29175C7.79199 2.54383 7.99792 2.74976 8.25 2.74976C8.50208 2.74976 8.70801 2.54383 8.70801 2.29175C8.70801 2.03966 8.50208 1.83374 8.25 1.83374Z" fill="currentColor"/>
                                  </svg>
                                  Share
                                </button>
                                <button className="flex items-center gap-1 text-[9px] md:text-[11px] border-2 border-[#333] rounded-[24px] bg-[#1A1A1A] text-[#767676] px-2 md:px-3 py-1 md:py-2 transition hover:text-[#00ff24] hover:border-[#00ff24]">
                                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M7.26177 4.67163V2.79663C7.26177 1.87454 5.77344 1.81746 5.77344 2.79663" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M5.77363 4.16671V1.96337C5.77363 1.04129 4.2853 0.984207 4.2853 1.96337V2.71337M4.28488 4.48421V2.79671C4.28488 1.87462 2.72363 1.81754 2.72363 2.79671V5.41671" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M7.26165 3.88012C7.26165 2.90095 8.74998 2.95804 8.74998 3.88012V5.71345C8.74998 8.5647 4.66707 9.70429 2.80082 7.83595L1.46123 6.48595C0.840817 5.79345 1.68498 4.37512 2.72373 5.41679L3.1404 5.83345" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round"/>
                                  </svg>
                                  Help
                                </button>
                              </div>
                            </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                )}
              </div>

              {/* Pagination */}
              {((totalPages > 1) || (activeSection === 'history' && hasMore)) && (
                <div className="flex items-center justify-center gap-2 px-4 py-5 bg-[#000000] shrink-0">
                  <button
                    className="px-3 py-1.5 text-white text-[16px] flex items-center gap-1 transition hover:text-[#00FF24] disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => {
                      if (currentPage > 1) {
                        handlePageChange(currentPage - 1);
                      }
                    }}
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
                          onClick={() => handlePageChange(page as number)}
                          className={`px-3 py-1.5 rounded text-[13px] transition-[background-color,color] duration-[400ms] ease-[cubic-bezier(0.4,0,0.2,1)] ${
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

                  <button
                    className="px-3 py-1.5 text-white text-[16px] flex items-center gap-1 transition hover:text-[#00FF24] disabled:opacity-30 disabled:cursor-not-allowed"
                    onClick={() => {
                      if (currentPage < totalPages) {
                        handlePageChange(currentPage + 1);
                      } else if (activeSection === 'history' && hasMore) {
                        fetchNextPage();
                      }
                    }}
                    disabled={(currentPage === totalPages && (activeSection !== 'history' || !hasMore)) || isFetching}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>
        </div>
    </div>
  );
};

export default Portfolio;
