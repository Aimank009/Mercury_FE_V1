import type { NextPage } from 'next';
import Head from 'next/head';
import { useState, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { useUserProfile } from '../hooks/useUserProfile';
import { useReferrals } from '../hooks/useReferrals';

const ITEMS_PER_PAGE = 15;

const Referral: NextPage = () => {
  const { address, isConnected } = useAccount();
  const { profile } = useUserProfile();
  const { referrals, stats, isLoading } = useReferrals();
  const [copied, setCopied] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(stats.referralCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Pagination calculations
  const totalPages = Math.ceil(referrals.length / ITEMS_PER_PAGE);
  
  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return referrals.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [referrals, currentPage]);

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
          <title>Referral - Mercury Trade</title>
        </Head>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white text-lg font-geist">Connect your wallet to view referrals</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col bg-black">
        <Head>
          <title>Referral - Mercury Trade</title>
        </Head>
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white text-lg font-geist">Loading referral data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col font-geist relative bg-black">
      <Head>
        <title>Referral - Mercury Trade</title>
      </Head>

      <style dangerouslySetInnerHTML={{
        __html: `
          
          .referral-row:hover {
            background-color: #1a221d !important;
          }
          .referral-row:hover > div {
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
        {/* Top Section - Stats and Code */}
        <div 
          className="rounded-xl p-6 flex gap-6 flex-row justify-between relative overflow-hidden h-[168px]"
          style={{
            background: 'linear-gradient(180deg, #011D06 0%, #000C02 100%)',
            borderRadius: '12px',
            boxShadow: 'inset 0 0 0 1px rgba(255, 255, 255, 0.1), inset 0px 0px 20px rgba(255, 255, 255, 0.05)'
          }}
        >
          {/* Left Side - Stats */}
          {/* <div className="flex-1 flex flex-col gap-4 relative z-10"> */}
            <div className="flex  w-[40%]">
              {/* Your Referrals */}
              <div className="flex-1">
                <p className="text-white/80 font-[600]  text-[16px] mb-2 font-geist">Your Referrals</p>
                <p 
                  className="gradient-text-stroke  text-[64px] font-black italic leading-none tracking-[-0.05em] font-geist"
                  data-text={stats.totalReferrals}
                >
                  {stats.totalReferrals}
                </p>
              </div>

              {/* Your Referrals Volume */}
              <div className="flex-1">
                <p className="text-white/80 font-[600]  text-[16px] mb-2 font-geist">Your Referrals Volume</p>
                <p 
                  className="gradient-text-stroke text-[64px] font-black italic leading-none tracking-[-0.05em] font-geist"
                  data-text={`$${stats.totalVolume.toFixed(2)}`}
                >
                  ${stats.totalVolume.toFixed(2)}
                </p>
              </div>
            </div>
          {/* </div> */}

          {/* Right Side - Referral Code */}
          <div className="relative z-10 flex flex-col justify-center items-end ">
            <div>
              <p className="text-white/80 font-[600] text-[16px]  text-left  font-geist">Your Code</p>
              <div className="flex items-center gap-3">
                <div 
                  className="py-3 pr-5 font-geist italic"
                  style={{
                    fontSize: '32px',
                    fontWeight: 500,
                    lineHeight: '100%',
                    letterSpacing: '-5%',
                    verticalAlign: 'middle',
                    background: 'linear-gradient(to bottom, #FFFFFF, #A9A9A9)',
                    WebkitBackgroundClip: 'text',
                    backgroundClip: 'text',
                    color: 'transparent',
                    WebkitTextFillColor: 'transparent'
                  }}
                >
                  {stats.referralCode}
                </div>
                <button
                  onClick={handleCopyCode}
                  className="px-4 flex gap-2 items-center py-3 rounded-full font-[600] text-[16px] transition-all font-geist"
                  style={{
                    background: copied ? '#00FF24' : 'rgba(255, 255, 255, 0.1)',
                    color: copied ? '#000' : '#fff',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fillRule="evenodd" clipRule="evenodd" d="M10.625 0.885742H7.752C6.45008 0.885742 5.41875 0.885742 4.61196 0.994117C3.78179 1.10603 3.10958 1.3412 2.57904 1.87103C2.04921 2.40158 1.81404 3.07378 1.70213 3.90395C1.59375 4.71145 1.59375 5.74208 1.59375 7.04399V11.3337C1.59362 11.9665 1.81947 12.5787 2.23061 13.0598C2.64175 13.5409 3.21118 13.8595 3.83633 13.958C3.93337 14.4992 4.12108 14.961 4.4965 15.3372C4.92292 15.7636 5.45983 15.9463 6.09733 16.0327C6.71146 16.1149 7.49275 16.1149 8.46104 16.1149H10.664C11.6322 16.1149 12.4135 16.1149 13.0277 16.0327C13.6652 15.9463 14.2021 15.7636 14.6285 15.3372C15.0549 14.9107 15.2377 14.3738 15.3241 13.7363C15.4062 13.1222 15.4062 12.3409 15.4062 11.3726V7.75303C15.4062 6.78474 15.4062 6.00345 15.3241 5.38933C15.2377 4.75183 15.0549 4.21491 14.6285 3.78849C14.2524 3.41308 13.7905 3.22537 13.2494 3.12833C13.1508 2.50317 12.8323 1.93375 12.3511 1.5226C11.87 1.11146 11.2579 0.885615 10.625 0.885742ZM12.1337 3.02562C12.026 2.71112 11.8227 2.43817 11.5521 2.24498C11.2816 2.05179 10.9574 1.94804 10.625 1.94824H7.79167C6.44088 1.94824 5.48179 1.94966 4.75292 2.04741C4.04104 2.14303 3.63021 2.32295 3.33058 2.62258C3.03096 2.9222 2.85104 3.33303 2.75542 4.04491C2.65767 4.77378 2.65625 5.73287 2.65625 7.08366V11.3337C2.65605 11.6661 2.7598 11.9903 2.95299 12.2608C3.14618 12.5313 3.41912 12.7347 3.73362 12.8424C3.71875 12.4103 3.71875 11.9216 3.71875 11.3726V7.75303C3.71875 6.78474 3.71875 6.00345 3.80163 5.38933C3.88663 4.75183 4.07079 4.21491 4.4965 3.78849C4.92292 3.36208 5.45983 3.17933 6.09733 3.09362C6.71146 3.01074 7.49275 3.01074 8.46104 3.01074H10.664C11.2129 3.01074 11.7017 3.01074 12.1337 3.02562ZM5.24733 4.54074C5.44354 4.34453 5.71837 4.21703 6.239 4.14691C6.77308 4.07537 7.48283 4.07395 8.49929 4.07395H10.6243C11.6407 4.07395 12.3498 4.07537 12.8853 4.14691C13.4052 4.21703 13.68 4.34524 13.8762 4.54074C14.0725 4.73695 14.2 5.01178 14.2701 5.53241C14.3416 6.06649 14.343 6.77624 14.343 7.7927V11.3344C14.343 12.3508 14.3416 13.0599 14.2701 13.5954C14.2 14.1153 14.0717 14.3901 13.8762 14.5863C13.68 14.7825 13.4052 14.91 12.8846 14.9802C12.3498 15.0517 11.6407 15.0531 10.6243 15.0531H8.49929C7.48283 15.0531 6.77308 15.0517 6.23829 14.9802C5.71838 14.91 5.44354 14.7818 5.24733 14.5863C5.05112 14.3901 4.92362 14.1153 4.8535 13.5947C4.78196 13.0599 4.78054 12.3508 4.78054 11.3344V7.7927C4.78054 6.77624 4.78196 6.06649 4.8535 5.5317C4.92362 5.01178 5.05183 4.73695 5.24733 4.54074Z" fill="currentColor"/>
                  </svg>
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Referrals Table */}
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
          
            <div className="pl-10 pr-2 py-2.5 text-left text-[16px] text-[#999] font-geist flex-1">
              Username
            </div>
            <div className="pl-2 pr-2 py-2.5 text-left text-[16px] text-[#999] font-geist" style={{ width: '150px' }}>
              Joined Date
            </div>
            <div className="pl-2 pr-4 py-2.5 text-right text-[16px] text-[#999] font-geist" style={{ width: '150px' }}>
              Your Reward
            </div>
          </div>

          {/* Rows */}
          <div className="overflow-y-auto flex-1">
            {referrals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-[#999]">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" className="mb-4 opacity-40">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <p className="text-[18px] font-geist">No referrals yet</p>
                <p className="text-[14px] text-[#666] mt-1 font-geist">Share your code to start earning rewards</p>
              </div>
            ) : (
              paginatedData.map((referral, index) => {
                // Show XP points earned from this referral
                // +10 for joining + 100 per $100 milestone
                return (
                  <div 
                    key={referral.wallet_address}
                    className="referral-row flex transition-colors duration-200 text-[#fff] border-b border-[#282828] last:border-b-0"
                    style={{ background: '#021202' }}
                  >
                    <div className="pl-4 pr-2 py-2.5 text-[16px] bg-[#000] font-geist flex items-center" style={{ width: '80px' }}>
                      {referral.avatar_url ? (
                        <img 
                          src={referral.avatar_url} 
                          alt={referral.username} 
                          className="w-6 h-6 rounded-full flex-shrink-0 ml-4"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-[10px] font-medium font-geist">
                            {referral.username.substring(0, 2).toUpperCase()}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className=" py-2.5 text-[16px] bg-[#000] flex-1 font-geist">
                      {referral.username}
                    </div>
                    <div className="pl-2 pr-2 py-2.5 text-[16px] text-[#fff]/60 bg-[#000] font-geist" style={{ width: '150px' }}>
                      {new Date(referral.created_at).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })}
                    </div>
                    <div className=" pr-10 py-2.5 text-[16px] text-[#fff] bg-[#000] font-geist text-right" style={{ width: '150px' }}>
                      +{referral.xp_earned || 0}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Pagination Controls */}
          {referrals.length > 0 && (
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
          )}
        </div>
      </div>
    </div>
  );
};

export default Referral;
