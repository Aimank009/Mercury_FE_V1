/**
 * High-Performance WebSocket Client for Mercury Frontend
 * Provides ultra-fast real-time data with automatic reconnection
 */

export interface WebSocketConfig {
  url: string;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
}

export interface SubscriptionFilters {
  tables?: string[];
  events?: string[];
  timeperiodRange?: { start: number; end: number };
  priceRange?: { min: number; max: number };
}

export interface BetEvent {
  type: 'bet_placed';
  eventType: string;
  table: string;
  new: any;
  old?: any;
  timestamp: number;
}

export interface BatchMessage {
  type: 'batch';
  events: BetEvent[];
  count: number;
  timestamp: number;
}

type MessageHandler = (data: any) => void;
type EventHandler = (event: BetEvent) => void;
type BatchHandler = (events: BetEvent[]) => void;
type ErrorHandler = (error: Error) => void;

export class MercuryWebSocketClient {
  private ws: WebSocket | null = null;
  private config: Required<WebSocketConfig>;
  private reconnectAttempts: number = 0;
  private reconnectTimer?: number;
  private heartbeatTimer?: number;
  private messageHandlers: Map<string, MessageHandler[]>;
  private eventHandlers: EventHandler[];
  private batchHandlers: BatchHandler[];
  private errorHandlers: ErrorHandler[];
  private isConnected: boolean = false;
  private isConnecting: boolean = false;

  constructor(config: WebSocketConfig) {
    this.config = {
      url: config.url,
      reconnect: config.reconnect ?? true,
      reconnectInterval: config.reconnectInterval ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 10,
      heartbeatInterval: config.heartbeatInterval ?? 30000,
    };

    this.messageHandlers = new Map();
    this.eventHandlers = [];
    this.batchHandlers = [];
    this.errorHandlers = [];
  }

  /**
   * Connect to WebSocket server
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.isConnecting || this.isConnected) {
        resolve();
        return;
      }

      this.isConnecting = true;
      console.log(`🔌 Connecting to ${this.config.url}...`);
      
      let isResolved = false; // Flag to prevent double resolve/reject

      try {
        // Check if WebSocket is available in browser
        if (typeof WebSocket === 'undefined') {
          throw new Error('WebSocket is not supported in this environment');
        }

        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          console.log('✅ Connected to WebSocket server');
          this.isConnected = true;
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onerror = (error: Event) => {
          console.error('❌ WebSocket error event:', error);
          
          // Don't reject here! Let onclose handle the failure.
          // onerror fires BEFORE onclose, so we just log and let onclose decide
          if (this.isConnected) {
            // Already connected, this is a runtime error
            console.warn('⚠️ WebSocket error during active connection');
            this.errorHandlers.forEach((handler) => {
              try {
                handler(new Error('WebSocket runtime error'));
              } catch (e) {
                console.error('Error in error handler:', e);
              }
            });
          }
          // Don't call reject() here!
        };

        this.ws.onclose = (event) => {
          console.log('🔌 Disconnected from WebSocket server', event.code, event.reason);
          
          const wasConnecting = this.isConnecting;
          const wasConnected = this.isConnected;
          
          this.isConnected = false;
          this.isConnecting = false;
          this.stopHeartbeat();

          // Only reject if we were trying to connect and NEVER succeeded
          if (wasConnecting && !wasConnected && !isResolved) {
            const errorMsg = event.reason || 'WebSocket connection failed';
            console.error('❌ Connection failed during setup:', errorMsg);
            isResolved = true;
            reject(new Error(errorMsg));
            return; // Don't auto-reconnect if initial connection failed
          }

          // Auto-reconnect if was previously connected
          if (wasConnected && this.config.reconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };
      } catch (error) {
        console.error('❌ Error creating WebSocket:', error);
        this.isConnecting = false;
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
      }
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  public disconnect(): void {
    console.log('🔌 Disconnecting...');
    this.config.reconnect = false; // Disable auto-reconnect
    this.stopHeartbeat();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1),
      60000 // Max 1 minute
    );

    console.log(
      `🔄 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})...`
    );

    this.reconnectTimer = window.setTimeout(() => {
      this.connect().catch((error) => {
        console.error('❌ Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = window.setInterval(() => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping' });
      }
    }, this.config.heartbeatInterval);
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // Handle batch messages
      if (message.type === 'batch') {
        this.handleBatch(message as BatchMessage);
        return;
      }

      // Call type-specific handlers
      const handlers = this.messageHandlers.get(message.type);
      if (handlers) {
        handlers.forEach((handler) => handler(message));
      }

      // Call event handlers for bet events
      if (message.type === 'bet_placed') {
        this.eventHandlers.forEach((handler) => handler(message as BetEvent));
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
      this.errorHandlers.forEach((handler) =>
        handler(error instanceof Error ? error : new Error('Unknown error'))
      );
    }
  }

  /**
   * Handle batch messages
   */
  private handleBatch(batch: BatchMessage): void {
    console.log(`📦 Received batch: ${batch.count} events`);

    // Call batch handlers
    this.batchHandlers.forEach((handler) => handler(batch.events));

    // Also call individual event handlers for each event
    batch.events.forEach((event) => {
      this.eventHandlers.forEach((handler) => handler(event));
    });
  }

  /**
   * Send message to server
   */
  private send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn('⚠️  Cannot send message: WebSocket not connected, state:', this.ws?.readyState);
      // Queue message to send when connected
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        console.log('⏳ Queueing message until connection opens...');
        const checkInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            clearInterval(checkInterval);
            this.ws.send(JSON.stringify(data));
            console.log('✅ Queued message sent');
          } else if (this.ws?.readyState === WebSocket.CLOSED || this.ws?.readyState === WebSocket.CLOSING) {
            clearInterval(checkInterval);
            console.error('❌ WebSocket closed before message could be sent');
          }
        }, 10);
      }
    }
  }

  /**
   * Subscribe to events with filters
   */
  public subscribe(filters: SubscriptionFilters): void {
    console.log('📡 Subscribing with filters:', filters);
    this.send({
      type: 'subscribe',
      ...filters,
    });
  }

  /**
   * Unsubscribe from events
   */
  public unsubscribe(): void {
    console.log('🔇 Unsubscribing...');
    this.send({ type: 'unsubscribe' });
  }

  /**
   * Update subscription filters
   */
  public updateFilters(filters: Partial<SubscriptionFilters>): void {
    // console.log('🔄 Updating filters:', filters);
    // this.send({
    //   type: 'update_filters',
    //   ...filters,
    // });
  }

  /**
   * Add message handler for specific message type
   */
  public onMessage(type: string, handler: MessageHandler): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, []);
    }
    this.messageHandlers.get(type)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  /**
   * Add event handler for bet events
   */
  public onEvent(handler: EventHandler): () => void {
    this.eventHandlers.push(handler);

    // Return unsubscribe function
    return () => {
      const index = this.eventHandlers.indexOf(handler);
      if (index > -1) {
        this.eventHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Add batch handler for batch events
   */
  public onBatch(handler: BatchHandler): () => void {
    this.batchHandlers.push(handler);

    // Return unsubscribe function
    return () => {
      const index = this.batchHandlers.indexOf(handler);
      if (index > -1) {
        this.batchHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Add error handler
   */
  public onError(handler: ErrorHandler): () => void {
    this.errorHandlers.push(handler);

    // Return unsubscribe function
    return () => {
      const index = this.errorHandlers.indexOf(handler);
      if (index > -1) {
        this.errorHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Get connection status
   */
  public getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get reconnection attempts
   */
  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }
}

// Singleton instance
let wsClient: MercuryWebSocketClient | null = null;

/**
 * Get or create singleton WebSocket client
 */
export function getMercuryWebSocketClient(url?: string): MercuryWebSocketClient {
  const wsUrl = url || (typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_REALTIME_WS_URL : undefined) || 'ws://localhost:8080';
  
  // Always create new instance if URL is different or no client exists
  if (!wsClient || (url && wsClient['config'].url !== wsUrl)) {
    wsClient = new MercuryWebSocketClient({ url: wsUrl });
  }
  return wsClient;
}

/**
 * Reset singleton (useful for testing or reconnection)
 */
export function resetWebSocketClient() {
  if (wsClient) {
    wsClient.disconnect();
    wsClient = null;
  }
}

/**
 * React Hook for using WebSocket client
 */
export function useMercuryWebSocket() {
  const client = getMercuryWebSocketClient();
  return client;
}
