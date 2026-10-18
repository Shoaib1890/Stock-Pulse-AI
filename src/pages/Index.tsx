import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus,
  TrendingUp,
  Newspaper,
  BarChart3,
  BriefcaseBusiness,
  AlertCircle,
  RefreshCw,
  WifiOff,
  Brain,
  IndianRupee,
  ChevronDown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import NewsCard from "@/components/NewsCard";
import PortfolioStock from "@/components/PortfolioStock";
import SentimentIndicator from "@/components/SentimentIndicator";
import SentimentBreakdown from "@/components/SentimentBreakdown";

interface NewsItem {
  id: string;
  title: string;
  source: string;
  time: string;
  summary: string;
  url?: string;
  stocks?: string[];
  sentiment?: "positive" | "negative" | "neutral";
  confidence?: number;
}

interface NewsPage {
  items: NewsItem[];
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

interface Stock {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

interface SentimentSummaryItem {
  headline: string;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;
  reason: string;
}

interface SentimentAnalysis {
  overall: "positive" | "negative" | "neutral";
  confidence: number;
  summary: SentimentSummaryItem[];
}

const BASE_URL = import.meta.env.VITE_API_URL;

const NewsSkeleton = () => (
  <div className="bg-white rounded-xl border border-slate-200 border-l-4 border-l-slate-200 p-5 space-y-3">
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-4/5" />
    <Skeleton className="h-3 w-2/3" />
    <div className="flex justify-between">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  </div>
);

const EmptyState = ({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
}) => (
  <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
    <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
      <Icon className="h-7 w-7 text-slate-400" />
    </div>
    <p className="font-semibold text-slate-700 mb-1">{title}</p>
    <p className="text-sm text-slate-400 max-w-xs">{description}</p>
  </div>
);

const Index = () => {
  // --- news pagination state ---
  const [news, setNews] = useState<NewsItem[]>([]);
  const [newsPage, setNewsPage] = useState(1);
  const [newsTotal, setNewsTotal] = useState(0);
  const [hasMoreNews, setHasMoreNews] = useState(false);
  const [loadingNews, setLoadingNews] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // --- portfolio state ---
  const [portfolio, setPortfolio] = useState<Stock[]>([]);
  const [portfolioNews, setPortfolioNews] = useState<NewsItem[]>([]);
  const [loadingPortfolioNews, setLoadingPortfolioNews] = useState(false);

  // --- sentiment ---
  const [sentiment, setSentiment] = useState<SentimentAnalysis | null>(null);
  const sentimentReqId = useRef(0);

  // --- misc ---
  const [newStock, setNewStock] = useState("");
  const [addingStock, setAddingStock] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const { toast } = useToast();

  // ── fetch a page of news ───────────────────────────────────────────────────

  const fetchNewsPage = useCallback(async (page: number, append = false) => {
    try {
      const res = await fetch(`${BASE_URL}/news?page=${page}`);
      if (!res.ok) throw new Error("API error");
      const data: NewsPage = await res.json();
      setNews((prev) => append ? [...prev, ...data.items] : data.items);
      setNewsPage(data.page);
      setNewsTotal(data.total);
      setHasMoreNews(data.hasMore);
      setApiOnline(true);
      return data;
    } catch {
      setApiOnline(false);
      throw new Error("Failed to fetch news");
    }
  }, []);

  // ── fetch portfolio news from the dedicated endpoint ───────────────────────
  // This searches ALL cached news on the backend, not just what's on screen

  const fetchPortfolioNews = useCallback(async (portfolioData: Stock[]) => {
    if (portfolioData.length === 0) {
      setPortfolioNews([]);
      return;
    }
    setLoadingPortfolioNews(true);
    try {
      const results = await Promise.all(
        portfolioData.map((s) =>
          fetch(`${BASE_URL}/news/for-stock/${s.symbol}`)
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [] as NewsItem[])
        )
      );
      // Merge and deduplicate by id
      const merged = results.flat() as NewsItem[];
      const seen = new Set<string>();
      const deduped = merged.filter((n) => {
        if (seen.has(n.id)) return false;
        seen.add(n.id);
        return true;
      });
      // Sort by most recent first (use id/title as stable sort if no date)
      setPortfolioNews(deduped);
    } catch {
      setPortfolioNews([]);
    } finally {
      setLoadingPortfolioNews(false);
    }
  }, []);

  // ── sentiment analysis ─────────────────────────────────────────────────────

  const runSentimentAnalysis = useCallback(async (
    portfolioNewsData: NewsItem[],
    portfolioData: Stock[]
  ) => {
    if (portfolioData.length === 0 || portfolioNewsData.length === 0) {
      setSentiment({ overall: "neutral", confidence: 70, summary: [] });
      return;
    }
    const headlines = portfolioNewsData.map((n) => n.title).slice(0, 20);
    const reqId = ++sentimentReqId.current;
    try {
      const res = await fetch(`${BASE_URL}/sentiment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headlines }),
      });
      if (reqId !== sentimentReqId.current) return;
      if (!res.ok) throw new Error("Sentiment API error");
      const data = await res.json();
      const items: SentimentSummaryItem[] = Array.isArray(data.sentiment)
        ? data.sentiment.map((i: SentimentSummaryItem) => ({
            ...i,
            sentiment: (i.sentiment as string).toLowerCase() as
              | "positive"
              | "negative"
              | "neutral",
          }))
        : [];
      const score = items.reduce(
        (acc, i) =>
          acc + (i.sentiment === "positive" ? 1 : i.sentiment === "negative" ? -1 : 0),
        0
      );
      const overall = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
      const avgConf = items.length
        ? Math.round(items.reduce((s, i) => s + (i.confidence || 70), 0) / items.length)
        : 70;
      if (reqId !== sentimentReqId.current) return;
      setSentiment({ overall, confidence: avgConf, summary: items });
    } catch {
      if (reqId !== sentimentReqId.current) return;
      setSentiment({ overall: "neutral", confidence: 70, summary: [] });
    }
  }, []);

  // ── initial load ───────────────────────────────────────────────────────────

  const loadInitialData = useCallback(
    async (showToast = false) => {
      setLoadingNews(true);
      try {
        const [, portfolioRes] = await Promise.all([
          fetchNewsPage(1, false),
          fetch(`${BASE_URL}/portfolio`),
        ]);
        if (!portfolioRes.ok) throw new Error("Portfolio API error");
        const portfolioData: Stock[] = await portfolioRes.json();
        setPortfolio(portfolioData);

        // Fetch portfolio news independently from full corpus
        const pNews = await (async () => {
          if (portfolioData.length === 0) return [];
          setLoadingPortfolioNews(true);
          try {
            const results = await Promise.all(
              portfolioData.map((s) =>
                fetch(`${BASE_URL}/news/for-stock/${s.symbol}`)
                  .then((r) => (r.ok ? r.json() : []))
                  .catch(() => [] as NewsItem[])
              )
            );
            const merged = (results.flat() as NewsItem[]);
            const seen = new Set<string>();
            return merged.filter((n) => {
              if (seen.has(n.id)) return false;
              seen.add(n.id);
              return true;
            });
          } finally {
            setLoadingPortfolioNews(false);
          }
        })();

        setPortfolioNews(pNews);
        await runSentimentAnalysis(pNews, portfolioData);

        if (showToast) toast({ title: "Refreshed", description: "Latest data loaded." });
      } catch {
        setApiOnline(false);
        toast({
          title: "Connection Error",
          description: "Could not reach the API. Is the backend running?",
          variant: "destructive",
        });
      } finally {
        setLoadingNews(false);
        setRefreshing(false);
      }
    },
    [fetchNewsPage, runSentimentAnalysis, toast]
  );

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // ── infinite scroll via IntersectionObserver ───────────────────────────────

  useEffect(() => {
    if (!hasMoreNews) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingMore && !loadingNews) {
          handleLoadMore();
        }
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMoreNews, loadingMore, loadingNews, newsPage]); // eslint-disable-line

  const handleLoadMore = async () => {
    if (loadingMore || !hasMoreNews) return;
    setLoadingMore(true);
    try {
      await fetchNewsPage(newsPage + 1, true);
    } finally {
      setLoadingMore(false);
    }
  };

  // ── add stock ──────────────────────────────────────────────────────────────

  const addStock = async () => {
    const symbol = newStock.trim().toUpperCase();
    if (!symbol) return;
    if (portfolio.find((s) => s.symbol === symbol)) {
      toast({ title: "Already in portfolio", description: `${symbol} is already added.`, variant: "destructive" });
      return;
    }
    setAddingStock(true);
    try {
      const res = await fetch(`${BASE_URL}/stock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      if (!res.ok) throw new Error("Failed to fetch stock");
      const stockData: Stock = await res.json();
      await fetch(`${BASE_URL}/portfolio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stockData),
      });
      const updated = [...portfolio, stockData];
      setPortfolio(updated);
      setNewStock("");

      // Fetch fresh portfolio news for the new stock too
      await fetchPortfolioNews(updated);
      toast({ title: "Stock Added", description: `${stockData.symbol} added to your portfolio.` });
    } catch {
      toast({ title: "Error", description: "Could not fetch stock data.", variant: "destructive" });
    } finally {
      setAddingStock(false);
    }
  };

  // ── remove stock ───────────────────────────────────────────────────────────

  const removeStock = async (symbol: string) => {
    const updated = portfolio.filter((s) => s.symbol !== symbol);
    setPortfolio(updated);
    try {
      await fetch(`${BASE_URL}/portfolio/${symbol}`, { method: "DELETE" });
    } catch { /* ignore */ }
    if (updated.length === 0) {
      setPortfolioNews([]);
      setSentiment({ overall: "neutral", confidence: 70, summary: [] });
    } else {
      await fetchPortfolioNews(updated);
    }
    toast({ title: "Removed", description: `${symbol} removed from portfolio.` });
  };

  // ── effect: re-run sentiment when portfolioNews changes ───────────────────

  useEffect(() => {
    if (portfolio.length > 0) {
      runSentimentAnalysis(portfolioNews, portfolio);
    }
  }, [portfolioNews]); // eslint-disable-line

  const totalValue = portfolio.reduce((sum, s) => sum + s.price, 0);
  const gainers = portfolio.filter((s) => s.change >= 0).length;
  const losers = portfolio.filter((s) => s.change < 0).length;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Navbar */}
      <nav className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center">
                <BarChart3 className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-slate-900 text-base tracking-tight">StockPulse</span>
              <Badge variant="outline" className="text-xs border-blue-200 text-blue-600 bg-blue-50 font-medium">
                India
              </Badge>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs">
                {apiOnline ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-slate-500 hidden sm:inline">Live</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3.5 w-3.5 text-red-500" />
                    <span className="text-red-500 text-xs hidden sm:inline">Offline</span>
                  </>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setRefreshing(true); loadInitialData(true); }}
                disabled={refreshing || loadingNews}
                className="h-8 w-8 p-0 text-slate-500 hover:text-blue-600"
                aria-label="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Top row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Portfolio Summary */}
          <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BriefcaseBusiness className="h-4 w-4 text-slate-500" />
                <span className="font-semibold text-slate-800 text-sm">Portfolio Overview</span>
              </div>
              {portfolio.length > 0 && (
                <Badge variant="outline" className="text-xs text-slate-500">
                  {portfolio.length} {portfolio.length === 1 ? "stock" : "stocks"}
                </Badge>
              )}
            </div>
            {portfolio.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
                  <BriefcaseBusiness className="h-6 w-6 text-slate-300" />
                </div>
                <p className="text-sm font-medium text-slate-500">No stocks yet</p>
                <p className="text-xs text-slate-400 mt-1">Add stocks to see your portfolio overview</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-1">Portfolio Value</p>
                    <div className="flex items-center gap-1">
                      <IndianRupee className="h-3.5 w-3.5 text-slate-700" />
                      <span className="font-bold text-slate-900 text-base">
                        {totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-1">Gainers</p>
                    <span className="font-bold text-emerald-700 text-base">{gainers}</span>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3">
                    <p className="text-xs text-slate-400 mb-1">Losers</p>
                    <span className="font-bold text-red-600 text-base">{losers}</span>
                  </div>
                </div>
                {sentiment && (
                  <SentimentIndicator
                    sentiment={sentiment.overall}
                    confidence={sentiment.confidence}
                  />
                )}
              </div>
            )}
          </div>

          {/* Add Stock */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Plus className="h-4 w-4 text-slate-500" />
              <span className="font-semibold text-slate-800 text-sm">Add to Portfolio</span>
            </div>
            <div className="space-y-3">
              <Input
                placeholder="RELIANCE, TCS, INFY…"
                value={newStock}
                onChange={(e) => setNewStock(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !addingStock && addStock()}
                className="uppercase placeholder:normal-case font-mono tracking-wide border-slate-300 focus:border-blue-500"
                disabled={addingStock}
              />
              <Button
                onClick={addStock}
                disabled={addingStock || !newStock.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium"
              >
                {addingStock ? (
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {addingStock ? "Fetching…" : "Add Stock"}
              </Button>
            </div>
            <div className="mt-4">
              <p className="text-xs text-slate-400 mb-2">Quick add</p>
              <div className="flex flex-wrap gap-1.5">
                {["RELIANCE", "TCS", "INFY", "HDFCBANK", "SBIN"].map((sym) => (
                  <button
                    key={sym}
                    onClick={() => setNewStock(sym)}
                    className="text-xs px-2 py-1 rounded-md bg-slate-100 hover:bg-blue-100 hover:text-blue-700 text-slate-600 font-mono transition-colors"
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="all-news">
          <TabsList className="bg-white border border-slate-200 rounded-xl p-1 h-auto gap-1 flex-wrap">
            <TabsTrigger
              value="all-news"
              className="rounded-lg text-sm data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              <Newspaper className="h-3.5 w-3.5 mr-1.5" />
              Market News
              {!loadingNews && newsTotal > 0 && (
                <span className="ml-1.5 text-xs opacity-80">({news.length}/{newsTotal})</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="portfolio-news"
              className="rounded-lg text-sm data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              <Newspaper className="h-3.5 w-3.5 mr-1.5" />
              Portfolio News
              {portfolioNews.length > 0 && (
                <span className="ml-1.5 text-xs opacity-80">({portfolioNews.length})</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="portfolio"
              className="rounded-lg text-sm data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              <BriefcaseBusiness className="h-3.5 w-3.5 mr-1.5" />
              My Portfolio
              {portfolio.length > 0 && (
                <span className="ml-1.5 text-xs opacity-80">({portfolio.length})</span>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="ai-sentiment"
              className="rounded-lg text-sm data-[state=active]:bg-blue-600 data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              <Brain className="h-3.5 w-3.5 mr-1.5" />
              AI Sentiment
              {sentiment && sentiment.summary.length > 0 && (
                <span className="ml-1.5 text-xs opacity-80">({sentiment.summary.length})</span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* All Market News */}
          <TabsContent value="all-news" className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-slate-900">Latest Market News</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {loadingNews ? "Loading…" : `${news.length} of ${newsTotal} articles · Multiple sources`}
                </p>
              </div>
              {!loadingNews && newsTotal > 0 && (
                <Badge variant="outline" className="text-xs text-slate-500">
                  {newsTotal} total
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {loadingNews
                ? Array.from({ length: 6 }).map((_, i) => <NewsSkeleton key={i} />)
                : news.length === 0
                ? (
                  <EmptyState
                    icon={AlertCircle}
                    title="No news available"
                    description="Could not load market news. Check your connection or try refreshing."
                  />
                )
                : news.map((item) => <NewsCard key={item.id} news={item} showStocks />)
              }
            </div>

            {/* Load more trigger (auto via IntersectionObserver + manual fallback button) */}
            {!loadingNews && (
              <div ref={loadMoreRef} className="mt-6 flex flex-col items-center gap-3">
                {loadingMore && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                    {Array.from({ length: 4 }).map((_, i) => <NewsSkeleton key={`more-${i}`} />)}
                  </div>
                )}
                {hasMoreNews && !loadingMore && (
                  <Button
                    variant="outline"
                    onClick={handleLoadMore}
                    className="border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600"
                  >
                    <ChevronDown className="h-4 w-4 mr-1.5" />
                    Load more ({newsTotal - news.length} remaining)
                  </Button>
                )}
                {!hasMoreNews && news.length > 0 && (
                  <p className="text-xs text-slate-400">All {newsTotal} articles loaded</p>
                )}
              </div>
            )}
          </TabsContent>

          {/* Portfolio News */}
          <TabsContent value="portfolio-news" className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-slate-900">Portfolio News</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {loadingPortfolioNews
                    ? "Searching all sources…"
                    : portfolioNews.length > 0
                    ? `${portfolioNews.length} articles across all feeds`
                    : "Articles related to your holdings"}
                </p>
              </div>
              {portfolioNews.length > 0 && !loadingPortfolioNews && (
                <Badge variant="outline" className="text-xs text-slate-500">
                  {portfolioNews.length} found
                </Badge>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {loadingPortfolioNews ? (
                Array.from({ length: 4 }).map((_, i) => <NewsSkeleton key={i} />)
              ) : portfolio.length === 0 ? (
                <EmptyState
                  icon={BriefcaseBusiness}
                  title="No portfolio stocks"
                  description="Add stocks to your portfolio to see relevant news here."
                />
              ) : portfolioNews.length === 0 ? (
                <EmptyState
                  icon={Newspaper}
                  title="No relevant articles"
                  description="No recent news across any feed matched your portfolio holdings."
                />
              ) : (
                portfolioNews.map((item) => (
                  <NewsCard key={item.id} news={item} showStocks />
                ))
              )}
            </div>
          </TabsContent>

          {/* My Portfolio */}
          <TabsContent value="portfolio" className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-slate-900">My Portfolio</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {portfolio.length > 0
                    ? `${portfolio.length} stock${portfolio.length > 1 ? "s" : ""} tracked`
                    : "No stocks added yet"}
                </p>
              </div>
              {portfolio.length > 0 && (
                <div className="flex items-center gap-1 text-sm font-semibold text-slate-700">
                  <IndianRupee className="h-3.5 w-3.5" />
                  {totalValue.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </div>
              )}
            </div>
            {portfolio.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                  <TrendingUp className="h-8 w-8 text-slate-300" />
                </div>
                <p className="font-semibold text-slate-600 mb-1">Your portfolio is empty</p>
                <p className="text-sm text-slate-400 max-w-xs">
                  Use the panel above to start tracking NSE stocks.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {portfolio.map((stock) => (
                  <PortfolioStock
                    key={stock.symbol}
                    stock={stock}
                    onRemove={() => removeStock(stock.symbol)}
                  />
                ))}
              </div>
            )}
          </TabsContent>
          {/* AI Sentiment */}
          <TabsContent value="ai-sentiment" className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-bold text-slate-900">AI Sentiment Analysis</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {loadingPortfolioNews
                    ? "Analyzing headlines…"
                    : sentiment && sentiment.summary.length > 0
                    ? `${sentiment.summary.length} headlines analyzed · powered by Groq`
                    : "Add portfolio stocks to get AI sentiment on related news"}
                </p>
              </div>
              {sentiment && sentiment.summary.length > 0 && (
                <SentimentIndicator
                  sentiment={sentiment.overall}
                  confidence={sentiment.confidence}
                />
              )}
            </div>

            <SentimentBreakdown
              items={sentiment?.summary ?? []}
              loading={loadingPortfolioNews}
            />

            {!loadingPortfolioNews && (!sentiment || sentiment.summary.length === 0) && (
              <EmptyState
                icon={Brain}
                title="No sentiment data yet"
                description="Add stocks to your portfolio — AI will analyze relevant news headlines and show sentiment here."
              />
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Footer */}
      <footer className="mt-10 border-t border-slate-200 bg-white py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <span>© 2024 StockPulse · AI-powered portfolio insights for Indian markets</span>
          <span>News: ET Markets, Moneycontrol, NDTV Profit · AI: Groq LLaMA 3</span>
        </div>
      </footer>
    </div>
  );
};

export default Index;
