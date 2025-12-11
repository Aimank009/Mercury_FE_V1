import { useEffect, useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAccount } from 'wagmi';

interface PositionUpdate {
  event_id: string;
  status: 'pending' | 'confirmed' | 'won' | 'lost';
  settlement_price?: number;
  multiplier?: number;
  settled_at?: string;
  user_address?: string;
}

interface WebSocketMessage {
  type: 'position_update' | 'settlement' | 'new_position' | 'pong' | 'subscribed' | 'error';
  payload?: any;
  channel?: string;
  message?: string;
}

const WS_URL = process.env.NEXT_PUBLIC_REALTIME_WS_URL || 'ws://localhost:8080';
const RECONNECT_INTERVAL = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 5000; // 5 seconds

export function usePositionsWebSocket() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const heartbeatTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const [isConnected, setIsConnected] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = undefined;
    }
    if (heartbeatTimeoutRef.current) {
      clearTimeout(heartbeatTimeoutRef.current);
      heartbeatTimeoutRef.current = undefined;
    }
  }, []);

  const startHeartbeat = useCallback(() => {
    clearHeartbeat();

    heartbeatIntervalRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        // console.log('💓 Sending heartbeat...');
        wsRef.current.send(JSON.stringify({ type: 'ping' }));

        // Set timeout to detect missed pong
        heartbeatTimeoutRef.current = setTimeout(() => {
          // console.warn('⚠️ Heartbeat timeout - reconnecting...');
          wsRef.current?.close();
        }, HEARTBEAT_TIMEOUT);
      }
    }, HEARTBEAT_INTERVAL);
  }, [clearHeartbeat]);

  const handlePositionUpdate = useCallback((payload: PositionUpdate) => {
    if (!address) return;

    // console.log('🔄 Position update:', payload);

    // For status confirmations, just update the underlying bet data
    // The UI will pick up the changes automatically via React Query
    queryClient.setQueryData(
      ['userBets', address.toLowerCase()],
      (oldData: any) => {
        if (!oldData?.pages) return oldData;

        return {
          ...oldData,
          pages: oldData.pages.map((page: any) => ({
            ...page,
            data: page.data.map((position: any) => {
              if (position.id === payload.event_id || position.event_id === payload.event_id) {
                // Merge the update without changing display format
                return { ...position, ...payload };
              }
              return position;
            }),
          })),
        };
      }
    );

    // console.log('✅ Position status updated');
  }, [queryClient, address]);

  const handleSettlement = useCallback((payload: PositionUpdate) => {
    if (!address) return;

    // console.log('⚡ Settlement received:', payload);

    // Update the positions cache with formatted data for instant UI update
    queryClient.setQueryData(
      ['userBets', address.toLowerCase()],
      (oldData: any) => {
        if (!oldData?.pages) return oldData;

        let updated = false;

        const newPages = oldData.pages.map((page: any) => ({
          ...page,
          data: page.data.map((position: any) => {
            // Match by event_id or position id
            if (position.id === payload.event_id || position.event_id === payload.event_id) {
              updated = true;
              
              // Calculate formatted values based on settlement
              const isWin = payload.status === 'won';
              const isLoss = payload.status === 'lost';
              const settlementStatus = isWin ? 'win' : isLoss ? 'Loss' : 'waiting';
              
              // Format settlement price
              const settlementPrice = payload.settlement_price 
                ? `$${(payload.settlement_price / 1e8).toFixed(2)}`
                : null;
              
              // Calculate payout based on multiplier
              const amountNum = parseFloat(position.amount.replace('$', ''));
              const multiplier = payload.multiplier || 0;
              const payoutAmount = isWin ? amountNum * multiplier : 0;
              const payoutFormatted = `$${payoutAmount.toFixed(2)} ${multiplier.toFixed(1)}X`;
              
              // console.log('📝 Updating position:', {
              //   id: position.id,
              //   oldStatus: position.settlement?.status,
              //   newStatus: settlementStatus,
              //   oldPayout: position.payout,
              //   newPayout: payoutFormatted,
              // });

              return {
                ...position,
                payout: payoutFormatted,
                settlement: {
                  status: settlementStatus,
                  price: settlementPrice,
                },
                status: 'Resolved',
              };
            }
            return position;
          }),
        }));

        if (updated) {
          // console.log('✅ Position updated in cache - UI will refresh automatically');
        } else {
          // console.warn('⚠️ Position not found in cache:', payload.event_id);
        }

        return {
          ...oldData,
          pages: newPages,
        };
      }
    );
  }, [queryClient, address]);

  const handleNewPosition = useCallback((payload: PositionUpdate) => {
    if (!address) return;

    // console.log('🆕 New position:', payload);

    // Prepend to cache
    queryClient.setQueryData(
      ['userBets', address.toLowerCase()],
      (oldData: any) => {
        if (!oldData?.pages?.[0]) return oldData;

        return {
          ...oldData,
          pages: [
            {
              ...oldData.pages[0],
              data: [payload, ...oldData.pages[0].data],
            },
            ...oldData.pages.slice(1),
          ],
        };
      }
    );

    // Also invalidate
    queryClient.invalidateQueries({ 
      queryKey: ['userBets', address.toLowerCase()],
      refetchType: 'none',
    });
  }, [queryClient, address]);

  const disconnect = useCallback(() => {
    // console.log('🔌 Disconnecting WebSocket...');
    
    clearHeartbeat();
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }

    if (wsRef.current) {
      wsRef.current.onclose = null; // Prevent reconnection
      wsRef.current.close();
      wsRef.current = null;
    }
    
    setIsConnected(false);
  }, [clearHeartbeat]);

  const connect = useCallback(() => {
    if (!address) {
      // console.log('⏸️ No address - skipping WebSocket connection');
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // console.log('✅ Already connected');
      return;
    }

    // Disconnect existing connection
    if (wsRef.current) {
      disconnect();
    }

    try {
      // console.log('🔌 Connecting to WebSocket:', WS_URL);
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        // console.log('✅ WebSocket connected');
        setIsConnected(true);
        setLastError(null);
        reconnectAttemptsRef.current = 0;

        // Subscribe to channels
        const userAddressLower = address.toLowerCase();

        ws.send(JSON.stringify({
          type: 'subscribe',
          channel: 'positions',
          userAddress: userAddressLower,
        }));

        ws.send(JSON.stringify({
          type: 'subscribe',
          channel: 'settlements',
          userAddress: userAddressLower,
        }));

        ws.send(JSON.stringify({
          type: 'subscribe',
          channel: 'bets',
          userAddress: userAddressLower,
        }));

        // Start heartbeat
        startHeartbeat();
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);

          // Clear heartbeat timeout on any message
          if (heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
            heartbeatTimeoutRef.current = undefined;
          }

          switch (data.type) {
            case 'position_update':
              handlePositionUpdate(data.payload);
              break;
            case 'settlement':
              handleSettlement(data.payload);
              break;
            case 'new_position':
              handleNewPosition(data.payload);
              break;
            case 'pong':
              // console.log('💓 Heartbeat received');
              break;
            case 'subscribed':
              // console.log('✅ Subscribed to channel:', data.channel);
              break;
            case 'error':
              // console.error('❌ WebSocket error:', data.message);
              setLastError(data.message || 'Unknown error');
              break;
            default:
              // console.log('🔔 Unknown message type:', data.type);
          }
        } catch (error) {
          // console.error('❌ Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        // console.error('❌ WebSocket error:', error);
        setLastError('Connection error');
      };

      ws.onclose = (event) => {
        // console.log('🔌 WebSocket disconnected', {
        //   code: event.code,
        //   reason: event.reason,
        //   wasClean: event.wasClean,
        // });
        
        setIsConnected(false);
        wsRef.current = null;
        clearHeartbeat();

        // Attempt reconnection
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(RECONNECT_INTERVAL * reconnectAttemptsRef.current, 30000);
          
          // console.log(
          //   `🔄 Reconnecting... (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms`
          // );

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        } else {
          // console.error('❌ Max reconnection attempts reached');
          setLastError('Connection failed - please refresh');
        }
      };

      wsRef.current = ws;
    } catch (error) {
      // console.error('❌ Error connecting to WebSocket:', error);
      setLastError('Connection failed');
      setIsConnected(false);
    }
  }, [address, disconnect, startHeartbeat, clearHeartbeat, handlePositionUpdate, handleSettlement, handleNewPosition]);

  // Connect/disconnect based on address
  useEffect(() => {
    if (address) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [address, connect, disconnect]);

  // Reconnect on browser visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && address) {
        console.log('👁️ Tab visible - checking connection...');
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [address, connect]);

  // Reconnect on network change
  useEffect(() => {
    const handleOnline = () => {
      console.log('🌐 Network online - reconnecting...');
      if (address) connect();
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [address, connect]);

  return {
    isConnected,
    reconnect: connect,
    disconnect,
    lastError,
    reconnectAttempts: reconnectAttemptsRef.current,
  };
}
