// Web Worker for continuous price data collection
// This runs in a separate thread and is NOT throttled when tab is inactive
// Following ChatGPT's best-practice pattern for OffscreenCanvas-style background processing

let isRunning = false;
let intervalId = null;
let priceHistory = [];
let currentPrice = 0;
let targetPrice = 0;
let hasStartedPlotting = false;
let isPageHidden = false;
let lastSentTime = 0;

// Configuration
const DURATION = 54; // seconds of history to keep
const UPDATE_MS = 16; // ~60fps update rate for data collection
const SEND_INTERVAL_VISIBLE = 16; // Send every frame when visible
const SEND_INTERVAL_HIDDEN = 100; // Send less frequently when hidden (still collect at 60fps)
const LERP_FACTOR = 0.2;

self.onmessage = function(e) {
  const { type, data } = e.data;
  
  switch (type) {
    case 'START':
      if (!isRunning) {
        isRunning = true;
        currentPrice = data.initialPrice || 40;
        targetPrice = currentPrice;
        hasStartedPlotting = false;
        priceHistory = [];
        startDataCollection();
        console.log('[PriceWorker] Started with initial price:', currentPrice);
      }
      break;
      
    case 'STOP':
      isRunning = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      console.log('[PriceWorker] Stopped');
      break;
      
    case 'PRICE_UPDATE':
      // Receive price updates from the main thread (WebSocket)
      if (data.price && data.price > 0) {
        targetPrice = data.price;
      }
      break;
      
    case 'VISIBILITY_CHANGE':
      // Track page visibility for throttling
      isPageHidden = data.hidden;
      console.log('[PriceWorker] Visibility changed:', isPageHidden ? 'hidden' : 'visible');
      break;
      
    case 'GET_HISTORY':
      // Send current history back to main thread
      self.postMessage({ 
        type: 'HISTORY', 
        data: { 
          history: [...priceHistory], 
          currentPrice, 
          targetPrice,
          hasStartedPlotting 
        } 
      });
      break;
      
    case 'SYNC':
      // Sync current state - send everything back for catch-up rendering
      console.log('[PriceWorker] Syncing state, history length:', priceHistory.length);
      self.postMessage({ 
        type: 'STATE', 
        data: { 
          currentPrice, 
          targetPrice,
          history: [...priceHistory], // Send a copy
          hasStartedPlotting,
          timestamp: Date.now()
        } 
      });
      break;
      
    case 'RESET':
      // Reset state (e.g., when component remounts)
      priceHistory = [];
      hasStartedPlotting = false;
      if (data && data.initialPrice) {
        currentPrice = data.initialPrice;
        targetPrice = data.initialPrice;
      }
      console.log('[PriceWorker] Reset');
      break;
  }
};

function startDataCollection() {
  if (intervalId) {
    clearInterval(intervalId);
  }
  
  // Use setInterval which continues running in background (unlike requestAnimationFrame)
  intervalId = setInterval(() => {
    if (!isRunning) return;
    
    // Check if we should start plotting (UTC seconds is multiple of 5)
    if (!hasStartedPlotting) {
      const now = new Date();
      const utcSeconds = now.getUTCSeconds();
      
      if (utcSeconds % 5 === 0) {
        hasStartedPlotting = true;
        self.postMessage({ type: 'STARTED_PLOTTING', data: { timestamp: Date.now() } });
        console.log('[PriceWorker] Started plotting at UTC seconds:', utcSeconds);
      } else {
        return; // Wait until we hit a multiple of 5
      }
    }

    const t = Date.now() / 1000;
    const now = Date.now();
    
    // Smooth interpolation towards target price
    currentPrice = currentPrice + (targetPrice - currentPrice) * LERP_FACTOR;
    
    // ALWAYS add to history (this is what keeps data continuous!)
    priceHistory.push({ t, v: currentPrice });
    
    // Clean old data (keep last DURATION * 2 seconds)
    const cutoff = t - DURATION * 2;
    priceHistory = priceHistory.filter(d => d.t > cutoff);
    
    // Throttle sending messages based on visibility
    // When hidden, we still collect data but send less frequently to reduce overhead
    const sendInterval = isPageHidden ? SEND_INTERVAL_HIDDEN : SEND_INTERVAL_VISIBLE;
    
    if (now - lastSentTime >= sendInterval) {
      // Send update to main thread
      self.postMessage({ 
        type: 'DATA_POINT', 
        data: { 
          t, 
          v: currentPrice, 
          historyLength: priceHistory.length,
          isHidden: isPageHidden
        } 
      });
      lastSentTime = now;
    }
    
  }, UPDATE_MS);
}
