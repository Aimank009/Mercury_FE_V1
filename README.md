# Mercury Trade

**Mercury Trade** is a decentralized grid-based price prediction platform built on **HyperEVM** (Hyperliquid's EVM chain). Users predict future price ranges over short time intervals using an interactive canvas-based chart — a system called **ChronoGrid**.

---

## What Is ChronoGrid?

ChronoGrid overlays a real-time price chart with a grid of cells. Each cell represents a **price range × time window** pair. Users click or drag on grid cells to place bets predicting the price will land within that range when the time window expires.

- **Win** — price settles inside the selected cell → payout at a dynamic multiplier.
- **Lose** — price settles outside → wagered amount is lost.

The primary trading pair is **HYPE/USD** (Hyperliquid native token).

---

## Key Features

| Feature | Description |
|---|---|
| **Grid Prediction** | 50 cells, 11 visible at a time, $0.01 price steps, 5-second grid intervals |
| **One-Click Trading** | 24-hour session keys with EIP-712 delegation — no wallet popup per trade |
| **Real-Time Price Feed** | WebSocket connection to the Hyperliquid oracle (sandbox mode available for dev) |
| **Live Positions** | Active and resolved bets with status badges (Waiting / Win / Loss) |
| **Dynamic Multipliers** | Payout multiplier adjusts in real-time based on shares/liquidity in each cell |
| **Cross-Chain Deposits** | Bridge from Ethereum, Arbitrum, Polygon, BSC, Base, Optimism & opBNB via LiFi |
| **Withdrawals** | Withdraw from the wrapper contract back to wallet |
| **Portfolio** | Balance overview, PnL charts (1D–1Y), bet history, deposit/withdrawal history |
| **Leaderboard** | Ranked by PnL with referral count and XP |
| **Referral System** | Unique referral codes; earn points when referred users join and trade |
| **Points / XP** | Earn XP for referrals, trading volume milestones, and weekly activity |
| **Access Code Gating** | Invite-only access during onboarding |
| **Sound Effects** | Audio cues for wins, losses, and interactions |

---

## How Trading Works

1. **Connect wallet** via RainbowKit → auto-switch to HyperEVM (chain 999).
2. **Onboard** — enter access code → accept terms → create profile → generate 24h session key.
3. **Deposit** — bridge tokens from any supported chain to the Wrapper contract using LiFi, or deposit USDTO directly.
4. **Set bet amount** via the trading info bar.
5. **Select grid cells** on the interactive canvas chart.
6. **Place bet** — the session key signs an EIP-712 message and sends it to the relayer, which submits it on-chain.
7. **Settlement** — when a time period expires the backend settles against the Hyperliquid oracle price and pushes results via WebSocket. Wins pay out at the dynamic multiplier; the UI plays sounds and updates positions automatically.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 15 (Pages Router) + React 19 |
| **Blockchain** | HyperEVM Mainnet (Chain 999) via wagmi + viem + ethers v5 |
| **Wallet** | RainbowKit |
| **Database / Realtime** | Supabase (PostgreSQL + realtime subscriptions) |
| **Bridging** | LiFi SDK & Widget |
| **Charts** | Custom canvas renderer (TradingChart) + ECharts (PnL) |
| **Styling** | Tailwind CSS |
| **Animations** | Framer Motion |
| **3D** | Three.js |
| **Data Fetching** | TanStack React Query |
| **Deployment** | Vercel |

---

## Smart Contracts (HyperEVM)

| Contract | Address |
|---|---|
| **Wrapper** | `0x43e3A4d6f27...` — deposits, bet placement, session delegation, payouts |
| **Library** | `0x2969906A13...` — utility functions |
| **ChronoGrid** | `0x35b5585aE3...` — core grid logic, time periods, settlement |
| **USDTO** | `0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb` (6 decimals) |

---

## Requirements

- Node.js 18+
- npm

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a local environment file and add your Supabase / RPC / relayer keys:
   ```bash
   cp .env .env.local
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

Open **http://localhost:3000** in your browser.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Build for production |
| `npm run start` | Run the production build |

---

## Project Structure

```
src/
├── components/     # UI components (TradingChart, TradingPanel, Positions, Navbar, …)
├── config/         # App configuration (networks, contracts, trading params, feature flags)
├── contexts/       # React context providers (PriceFeed, SessionTrading, DepositWithdraw, Modal)
├── hooks/          # Custom hooks (order placement, positions, leaderboard, referrals, …)
├── lib/            # Shared library code
├── pages/          # Next.js pages (/, /portfolio, …)
├── services/       # API and service layers
├── styles/         # Global styles
└── utils/          # Shared utilities
public/
├── assets/         # Static images & icons
├── sfx/            # Sound effect audio files
└── priceWorker.js  # Web Worker for price feed processing
```

---

## Configuration Files

- `supabase-*.sql` — Database schema, migrations, and helper scripts
- `vercel.json` — Vercel deployment configuration
- `tailwind.config.js` — Tailwind CSS theme & plugins
- `deploy.sh` — Deployment script

---

## License

Private — not for redistribution.