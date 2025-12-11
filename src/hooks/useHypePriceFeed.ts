import { useEffect, useState, useRef } from 'react';

interface PriceUpdate {
  raw: number;
  usd: number;
  block: number;
  latency: number;
}

interface UsePriceFeedReturn {
  currentPrice: number;
  isConnected: boolean;
  lastUpdate: PriceUpdate | null;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws:8080/ws/prices';
const RECONNECT_DELAY = 3000; // 3 seconds
const USE_SANDBOX = (process.env.NEXT_PUBLIC_USE_SANDBOX || 'true').toLowerCase() === 'true';
const SANDBOX_INTERVAL_MS = Number(process.env.NEXT_PUBLIC_SANDBOX_INTERVAL_MS || 100);
const SANDBOX_STEP = Number(process.env.NEXT_PUBLIC_SANDBOX_STEP || 0.02);

export function useHypePriceFeed(): UsePriceFeedReturn {
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<PriceUpdate | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    if (!USE_SANDBOX) {
      return;
    }

    setIsConnected(true);

    setCurrentPrice((prev) => {
      const startPrice = prev > 0 ? prev : 40 + Math.random();
      setLastUpdate({
        raw: Math.round(startPrice * 1e8),
        usd: startPrice,
        block: 0,
        latency: 0,
      });
      return startPrice;
    });

    const interval = setInterval(() => {
      setCurrentPrice((prev) => {
        const base = prev > 0 ? prev : 40 + Math.random();
        const delta = (Math.random() - 0.5) * SANDBOX_STEP;
        const nextPrice = Math.max(0.01, base + delta);
        setLastUpdate({
          raw: Math.round(nextPrice * 1e8),
          usd: nextPrice,
          block: 0,
          latency: SANDBOX_INTERVAL_MS,
        });
        return nextPrice;
      });
    }, SANDBOX_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (USE_SANDBOX) {
      return;
    }

    mountedRef.current = true;

    const connect = () => {
      if (!mountedRef.current) return;

      try {
        // console.log('🔌 Connecting to HYPE price feed...');
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.onopen = () => {
          // console.log('✅ Connected to HYPE price feed');
          setIsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            // console.log('📨 Raw WebSocket message:', event.data);
            const data = JSON.parse(event.data);
            // console.log('📦 Parsed data:', data);
            
            // Handle price update message - use actual field names from server
            if (data.price_raw !== undefined) {
              // Calculate price from raw value: raw / 10^8
              const calculatedPrice = data.price_raw / 100000000;
              
              const priceUpdate: PriceUpdate = {
                raw: data.price_raw,
                usd: calculatedPrice, // Calculate from raw value
                block: data.block_number,
                latency: data.latency_ms,
              };

              setCurrentPrice(calculatedPrice);
              setLastUpdate(priceUpdate);
              
              // console.log(`💰 Price Updated: $${calculatedPrice.toFixed(4)} | Block: ${priceUpdate.block} | Raw: ${priceUpdate.raw}`);
            } else {
              console.warn('⚠️ Message missing "price_raw" field:', data);
            }
          } catch (error) {
            console.error('❌ Error parsing price data:', error);
            console.error('❌ Raw data was:', event.data);
          }
        };

        ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
        };

        ws.onclose = () => {
          console.log('🔌 Disconnected from HYPE price feed');
          setIsConnected(false);
          
          // Attempt to reconnect
          if (mountedRef.current) {
            console.log(`🔄 Reconnecting in ${RECONNECT_DELAY / 1000}s...`);
            reconnectTimeoutRef.current = setTimeout(() => {
              if (mountedRef.current) {
                connect();
              }
            }, RECONNECT_DELAY);
          }
        };
      } catch (error) {
        console.error('❌ Failed to create WebSocket:', error);
        
        // Retry connection
        if (mountedRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, RECONNECT_DELAY);
        }
      }
    };

    // Initial connection
    connect();

    // Cleanup on unmount
    return () => {
      mountedRef.current = false;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return {
    currentPrice,
    isConnected,
    lastUpdate,
  };
}

