# StockPulse India

**AI-assisted Indian equity dashboard** that aggregates live market news, tracks a personal NSE-style watchlist, and scores headline sentiment with a large language model.

[![Live Demo](https://img.shields.io/badge/Live%20Demo-stockpulsefinal.vercel.app-000000?logo=vercel&logoColor=white)](https://stockpulsefinal.vercel.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![Groq](https://img.shields.io/badge/Groq-LLaMA%203.1-F55036)](https://groq.com/)

> This project is a **portfolio / demonstration application**. It is **not** investment advice, a brokerage product, or a substitute for licensed financial research.

**Live demo:** [https://stockpulsefinal.vercel.app/](https://stockpulsefinal.vercel.app/)  
**Repository:** [Shoaib1890/Stock-Pulse-AI](https://github.com/Shoaib1890/Stock-Pulse-AI)

---

## Problem

Retail investors in Indian markets consume news from many outlets (Economic Times, Moneycontrol, NDTV Profit, and others). Headlines are noisy, often duplicated, and rarely tied back to a specific holding list. StockPulse India addresses that gap by:

1. **Collecting** market RSS feeds into a single, de-duplicated timeline.
2. **Linking** articles to tickers via keyword matching (e.g. `RELIANCE`, `TCS`, `HDFCBANK`).
3. **Filtering** the corpus to a user’s portfolio.
4. **Classifying** related headlines as positive, negative, or neutral using Groq-hosted **LLaMA 3.1 8B Instant**, with a confidence score and a short rationale.

---

## Features

| Area | What it does |
| --- | --- |
| **Market news** | Pulls multiple Indian market RSS feeds in parallel, de-duplicates by title, sorts newest-first, and paginates (20 items per page). |
| **Infinite scroll** | Intersection Observer plus a manual “Load more” control. |
| **Ticker tagging** | Maps 40+ NSE-style symbols to aliases (`ril` → `RELIANCE`, `hul` → `HINDUNILVR`) with longest-keyword-first matching. |
| **Watchlist** | Add / remove holdings; overview of count, gainers vs losers, and a simple value sum. |
| **Portfolio news** | Queries the **full cached corpus** per symbol (`GET /api/news/for-stock/:symbol`), not only the currently loaded page. |
| **AI sentiment** | Analyzes up to 10 portfolio-related headlines; UI shows overall tilt, per-headline cards, and average confidence. |
| **Resilience** | Per-feed failure isolation (`Promise.allSettled`), 5-minute in-memory news cache, CORS scoped by `FRONTEND_URL`, live/offline indicator on the client. |
| **UX** | Skeleton loaders, empty states, toasts, sticky navbar, and a tabbed dashboard (Market News, Portfolio News, My Portfolio, AI Sentiment). |

---

## Architecture

```
┌─────────────────────────────────────────┐
│  React + TypeScript (Vite)              │
│  Tailwind CSS · shadcn/ui · React Query │
│  VITE_API_URL → /api/*                  │
└─────────────────┬───────────────────────┘
                  │ HTTP JSON
┌─────────────────▼───────────────────────┐
│  Express 5 API (Node.js)                │
│  /api/news  /api/stock                  │
│  /api/portfolio  /api/sentiment         │
└─────┬──────────────┬──────────────┬─────┘
      │              │              │
      ▼              ▼              ▼
  RSS feeds     In-memory      Groq Chat
  (ET, MC,      watchlist      Completions
   NDTV …)                     (LLaMA 3.1)
```

**Frontend** is a single-page app (`/`). Data fetching is explicit `fetch` against the Express API; React Query is wired at the app root for future cache-centric work.

**Backend** is a REST service. News aggregation is cached in process for five minutes to avoid hammering publishers. Sentiment calls Groq’s OpenAI-compatible endpoint with a strict JSON system prompt; malformed model output falls back to a neutral result so the UI never hard-fails on a single headline.

---

## Tech stack

### Client

- **React 18** + **TypeScript**
- **Vite 5** (SWC React plugin)
- **Tailwind CSS** + **shadcn/ui** (Radix primitives)
- **React Router 6**
- **TanStack Query**, **Zod**, **Lucide** icons

### Server

- **Express 5**, **CORS**, **dotenv**
- **rss-parser** for feed ingestion
- **axios** for Groq HTTP
- Groq **`llama-3.1-8b-instant`** for structured sentiment JSON

### Integrations (read-only news)

- Economic Times (markets, stocks, industry, commodities, economy)
- Moneycontrol (top news, market reports)
- NDTV Profit

---

## Project structure

```
├── src/
│   ├── pages/Index.tsx          # Dashboard: news, portfolio, sentiment
│   ├── components/              # NewsCard, PortfolioStock, sentiment UI
│   ├── components/ui/           # shadcn primitives
│   └── App.tsx                  # Router, QueryClient, toasts
├── backend/
│   ├── index.js                 # Express app, CORS, route mount
│   └── routes/
│       ├── news.js              # RSS, cache, pagination, ticker match
│       ├── sentiment.js         # Groq LLaMA classification
│       ├── portfolio.js         # In-memory watchlist CRUD
│       └── stock.js             # Symbol lookup (demo quotes)
├── .env                         # VITE_API_URL (local)
└── .env.production              # Production API base URL
```

---

## API

Base path is `/api`. Default local origin: `http://localhost:5000`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/news?page=1` | Paginated, de-duplicated news. Response: `{ items, page, pageSize, total, hasMore }`. |
| `GET` | `/news/for-stock/:symbol` | Articles tagged to a ticker (keyword + detected `stocks[]`). |
| `POST` | `/sentiment` | Body `{ headlines: string[] }`. Returns `{ sentiment: [{ headline, sentiment, confidence, reason }] }`. |
| `GET` | `/portfolio` | Current watchlist. |
| `POST` | `/portfolio` | Add a stock object. `409` if the symbol already exists. |
| `DELETE` | `/portfolio/:symbol` | Remove a holding. |
| `POST` | `/stock` | Resolve a symbol into a quote object used when adding to the watchlist. |

Example sentiment request:

```http
POST /api/sentiment
Content-Type: application/json

{ "headlines": ["TCS wins multi-year deal from a US bank"] }
```

Example response item:

```json
{
  "headline": "TCS wins multi-year deal from a US bank",
  "sentiment": "positive",
  "confidence": 88,
  "reason": "Large contract win is typically constructive for the stock."
}
```

---

## Getting started

### Prerequisites

- **Node.js 18+** and npm
- A [Groq](https://console.groq.com/) API key for sentiment analysis

### 1. Clone

```bash
git clone https://github.com/Shoaib1890/Stock-Pulse-AI.git
cd Stock-Pulse-AI
```

### 2. Backend

```bash
cd backend
npm install
```

Create `backend/.env`:

```env
PORT=5000
GROQ_API_KEY=your_groq_api_key
FRONTEND_URL=http://localhost:8080
```

```bash
npm start
```

The API listens on `http://localhost:5000` by default.

### 3. Frontend

From the repository root:

```bash
npm install
```

Root `.env` (already typical for local work):

```env
VITE_API_URL=http://localhost:5000/api
```

Vite’s default port in this project is **8080**. Start the client:

```bash
npm run dev
```

Open `http://localhost:8080`. Confirm the navbar shows **Live**. Add tickers such as `RELIANCE`, `TCS`, `INFY`, `HDFCBANK`, or `SBIN`, then open **Portfolio News** and **AI Sentiment**.

### Scripts

| Command | Where | Purpose |
| --- | --- | --- |
| `npm run dev` | root | Vite development server |
| `npm run build` | root | Production frontend bundle |
| `npm run preview` | root | Preview the production build |
| `npm run lint` | root | ESLint |
| `npm start` | `backend/` | Start Express |

### Deployment

The production UI is hosted on **Vercel**: [stockpulsefinal.vercel.app](https://stockpulsefinal.vercel.app/).  
The API is configured via `VITE_API_URL` in `.env.production` (hosted on Render). Set `FRONTEND_URL` on the backend to `https://stockpulsefinal.vercel.app` so CORS matches the live origin.

---

## Design notes (engineering)

- **Feed isolation.** One publisher timing out does not empty the dashboard; failed feeds log a warning and contribute an empty array.
- **Cache vs freshness.** A 5-minute TTL balances load on RSS hosts with reasonably current headlines.
- **Matching quality.** Keywords are sorted longest-first so `"hdfc bank"` wins over a shorter token where both could apply.
- **LLM contract.** The system prompt requires a single JSON object (`sentiment`, `confidence`, `reason`). The server extracts the first JSON object from the completion, then normalizes labels to lowercase.
- **Client aggregation.** Overall portfolio mood is the sign of a simple score (`+1` / `0` / `-1` per headline), with confidence averaged across analyzed items.
- **CORS.** Production should set `FRONTEND_URL` to the deployed origin rather than relying on `*`.

---

## Current limitations

These are intentional or known gaps, documented so the README stays honest for recruiters and collaborators:

- **Quote data is simulated** in `backend/routes/stock.js` (randomized price / change). News and sentiment are the production-quality path; live NSE/BSE quotes would plug in behind the same `POST /api/stock` contract.
- **Watchlist is in-memory.** Restarting the backend clears holdings. Persistence would be a small store (SQLite, Redis, or a hosted DB).
- **Sentiment is headline-level**, not a forecast of returns. Confidence is model-reported, not a calibrated probability.
- **Keyword tagging** can miss unnamed companies or produce false positives on very common tokens; the map is curated for major Indian names.
- An unused Next-style handler exists under `src/pages/api/`; the live sentiment path is **Express + Groq**.

---

## Roadmap

- Replace mock quotes with a market-data provider (NSE/BSE or a delayed API).
- Persist portfolios per user (auth + database).
- Persist or overlay per-article sentiment on news cards after analysis.
- Optional scheduled refresh of RSS instead of on-demand cache fill.
- Tests for ticker matching, de-duplication, and sentiment JSON parsing.

---

## Disclaimer

StockPulse India is an **educational and portfolio project**. News is sourced from third-party RSS feeds and may be delayed, incomplete, or incorrectly tagged. AI sentiment is an automated classification of text, not a recommendation to buy or sell any security.

---

## License

ISC (see `backend/package.json`). Frontend scaffolding follows the original project license unless otherwise noted.

---

## Author

**Shoaib** — [github.com/Shoaib1890](https://github.com/Shoaib1890)
