import { useEffect, useRef, useState } from 'react';

export const useSettlementsWebSocket = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_SETTLEMENTS_WS_URL;
    
    if (!wsUrl) {
      // console.error('❌ NEXT_PUBLIC_SETTLEMENTS_WS_URL is not defined');
      return;
    }

    // console.log('🔌 Connecting to settlements WebSocket:', wsUrl);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // console.log('✅ Settlements WebSocket connected');
      setIsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // console.log('📨 SETTLEMENTS WS RAW MESSAGE:', {
        //   data,
        //   timestamp: new Date().toISOString()
        // });
        setLastMessage(data);
      } catch (error) {
        // console.error('❌ Error parsing settlements message:', error);
        // console.log('📝 Raw message:', event.data);
      }
    };

    ws.onerror = (error) => {
      // console.warn('⚠️ Settlements WebSocket error (this is non-critical):', error);
      // console.log('💡 The app will continue to work without real-time settlement updates');
    };

    ws.onclose = (event) => {
      // console.log('🔌 Settlements WebSocket disconnected');
      // if (event.code !== 1000) {
      //   console.log('   Code:', event.code, 'Reason:', event.reason || 'No reason provided');
      //   console.log('💡 This is expected if the settlements WebSocket server is unavailable');
      // }
      setIsConnected(false);
    };

    return () => {
      if (wsRef.current) {
        // console.log('🛑 Cleaning up settlements WebSocket connection');
        wsRef.current.close();
      }
    };
  }, []);

  return { isConnected, lastMessage };
};
