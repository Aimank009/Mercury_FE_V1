# LiFi Gas Handling Implementation

## Overview
This document explains the gas handling implementation for bridging tokens to USDT0 when users don't have HYPE tokens for gas on HyperEVM.

## Problem
When bridging from another chain to HyperEVM, users need HYPE tokens to pay for gas to call `depositForUser()` on the wrapper contract. First-time users don't have HYPE, so they can't complete the deposit.

## Solution
The implementation uses LiFi's **refuel feature** to automatically include native HYPE gas tokens with the bridge transaction. The key insight is:

**LiFi's Refuel Feature:**
- **Main tokens (USDT0) → toAddress** (Wrapper Contract)
- **Refuel gas (HYPE) → fromAddress** (User's Wallet) - AUTOMATIC!

This means tokens ALWAYS go to the wrapper contract (no approval needed), while the user automatically receives HYPE gas in their wallet when refuel is enabled.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    User Starts Bridge                        │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
            ┌───────────────────────┐
            │ Check HYPE Balance    │
            │ on HyperEVM           │
            └───────────┬───────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
        ▼                               ▼
┌──────────────┐              ┌──────────────┐
│ Has HYPE Gas │              │ No HYPE Gas  │
└──────┬───────┘              └──────┬───────┘
       │                             │
       ▼                             ▼
┌──────────────────┐        ┌────────────────────┐
│ Bridge USDT0 to  │        │ Bridge USDT0 to    │
│ Wrapper Contract │        │ Wrapper Contract   │
│                  │        │ + Refuel HYPE gas  │
│                  │        │ to User's Wallet   │
└──────┬───────────┘        └──────┬─────────────┘
       │                           │
       │                           │
       │         Single Bridge Transaction
       │         (2 destinations automatically!)
       │                           │
       └───────────┬───────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Call depositForUser  │
        │ to credit account    │
        │ (uses refuel gas)    │
        └──────────────────────┘
```

## Implementation Details

### 1. Gas Check Function (`LiFiBridgeService.ts`)

```typescript
export async function checkHasEnoughGas(userAddress: string): Promise<{
  hasEnough: boolean;
  balance: string;
  required: string;
}> {
  const balanceHex = await getHypeBalance(userAddress);
  const balance = BigInt(balanceHex);
  const required = BigInt(Math.floor(parseFloat('0.002') * 1e18));
  
  return {
    hasEnough: balance >= required,
    balance: (Number(balance) / 1e18).toFixed(6),
    required: '0.002',
  };
}
```

**Purpose**: Checks if the user has at least 0.002 HYPE (enough for `depositForUser` transaction).

### 2. Bridge Quote with Refuel (`LiFiBridgeService.ts`)

```typescript
export async function getBridgeQuote(
  params: BridgeQuoteParams & { enableRefuel?: boolean }
): Promise<BridgeQuoteResult> {
  const routesRequest: RoutesRequest = {
    // ... other params
    toAddress: params.toAddress, // User address OR wrapper address
    options: {
      slippage: 0.03,
      order: 'RECOMMENDED',
      allowDestinationCall: true, // Enables refuel feature
    },
  };
  // ... execute route
}
```

**Key Point**: When `allowDestinationCall: true`, LiFi includes native gas tokens with the bridge.

### 3. Conditional Routing Logic (`CustomBridge.tsx`)

```typescript
const fetchQuote = async () => {
  // Check if user needs gas (only for cross-chain bridges, not swaps)
  let userNeedsGas = false;
  if (!isSwap) {
    const gasCheck = await checkHasEnoughGas(address);
    userNeedsGas = !gasCheck.hasEnough;
    setNeedsGas(userNeedsGas);
  }

  // IMPORTANT: Always send USDT0 to wrapper contract
  // When refuel is enabled, LiFi automatically sends HYPE gas to user's wallet (fromAddress)
  // This way: USDT0 → Wrapper, HYPE gas → User's wallet
  const quoteParams = {
    // ... other params
    toAddress: WRAPPER_CONTRACT,      // Tokens always go here!
    enableRefuel: userNeedsGas,       // Gas goes to fromAddress automatically
    refuelAmount: userNeedsGas ? '2000000000000000' : undefined, // 0.002 HYPE
  };
}
```

### 4. Execution - No Approval Needed! (`CustomBridge.tsx`)

```typescript
const executeBridge = async () => {
  // Execute bridge route
  const executedRoute = await executeBridgeRoute(quote.route, walletClient, callbacks);
  
  // IMPORTANT: Tokens already went to wrapper contract directly!
  // If user needed gas, they received HYPE via refuel automatically
  // Now we just need to call depositForUser to credit their account
  
  const wrapperContract = new ethers.Contract(WRAPPER_CONTRACT, WRAPPER_ABI, hyperSigner);
  const depositTx = await wrapperContract.depositForUser(bridgedAmount, address);
  await depositTx.wait();
}
```

**Key Point:** No approval step needed because tokens never go to the user's wallet - they go directly to the wrapper contract!

## User Experience

### Case 1: User Has HYPE
1. Bridge quote shows: "Tokens Destination: Wrapper Contract"
2. User confirms bridge (1 signature on source chain)
3. Tokens arrive directly in wrapper
4. User confirms depositForUser (1 signature on HyperEVM)
5. Account credited!
6. **Total: 2 signatures** ✅

### Case 2: User Needs HYPE (First Time)
1. Bridge quote shows: "Gas Refuel Included" notice
2. "Tokens Destination: Wrapper Contract"
3. "Gas Destination: Your Wallet"
4. "+ Gas included (refuel)" indicator
5. User confirms bridge (1 signature on source chain)
6. **LiFi automatically sends:**
   - USDT0 → Wrapper Contract
   - HYPE gas → User's Wallet
7. User confirms depositForUser using refuel gas (1 signature on HyperEVM)
8. Account credited!
9. **Total: 2 signatures** ✅

**No approval step needed!** Tokens go directly to wrapper contract.

## UI Indicators

### Gas Notice (when `needsGas === true`)
```tsx
<div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-3">
  <p className="text-blue-400 text-sm font-medium">First Time Setup</p>
  <p className="text-blue-400/70 text-xs">
    Tokens will be bridged to your wallet first. 
    Then you'll approve & deposit (uses refuel gas).
  </p>
</div>
```

### Step Indicators
- **Bridge (with gas refuel)** ← Shows when needsGas is true
- **Cross-chain transfer**
- **Approve & Deposit** ← Extra step when needsGas is true
- **Deposit to account** ← Direct step when needsGas is false

## Key Configuration

```typescript
// LiFiBridgeService.ts
const ESTIMATED_GAS_FOR_DEPOSIT = '0.002'; // 0.002 HYPE for depositForUser
const ETH_AMOUNT_FOR_GAS = '0.0003';      // ~$1 ETH for bridging gas
```

## Testing Scenarios

### Test 1: New User (No HYPE)
1. Connect wallet with no HYPE on HyperEVM
2. Bridge 10 USDC from Arbitrum
3. Should see "First Time Setup" notice
4. After bridge, HYPE balance should be > 0
5. Tokens should be deposited automatically

### Test 2: Existing User (Has HYPE)
1. Connect wallet with HYPE on HyperEVM
2. Bridge 10 USDC from Arbitrum
3. Should NOT see "First Time Setup" notice
4. Tokens should bridge directly to wrapper

### Test 3: Same-Chain Swap
1. Already on HyperEVM
2. Swap token to USDT0
3. Gas check should be skipped (isSwap = true)
4. Direct deposit to wrapper

## Benefits

1. **Seamless Onboarding**: New users don't need to manually acquire HYPE
2. **Automatic**: No manual steps for gas acquisition
3. **Cost-Effective**: Uses LiFi's built-in refuel (no additional service fees)
4. **Efficient**: Only 2 signatures needed (1 bridge + 1 deposit) - NO approval step!
5. **Direct to Wrapper**: Tokens go directly to wrapper contract, gas goes to user
6. **Safe**: Refuel amount is minimal (0.002 HYPE, ~$0.02 worth)

## Error Handling

- If gas check fails → Defaults to needing gas (safer)
- If refuel not available → Falls back to direct bridge
- Clear error messages for each step
- Retry option on failures

## Future Improvements

1. Cache gas check results (5 minutes)
2. Estimate exact gas needed based on network conditions
3. Add option to manually skip refuel if user will top up gas separately
4. Support multiple gas token options (not just native HYPE)

## Files Modified

1. `/src/lib/LiFiBridgeService.ts` - Added gas checking and refuel functions
2. `/src/components/CustomBridge.tsx` - Updated bridge flow with conditional logic

