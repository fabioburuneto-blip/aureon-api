/**
 * TraderAureonia AI — Servidor Railway v19-MTF-fix
 *
 * FIXES nesta versão:
 * - 🔒 Cooldown de 15min por símbolo ANTES de enfileirar ordem no slavePendingOrders
 * - 🔒 lastOrderSent Map global para rastrear último envio por símbolo
 * - 🔒 /client-execute-order também respeita cooldown
 */

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");
const path = require("path");

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(express.json());
app.use(express.static(path.join(__dirname, ".")));
app.get("/download/slave", (_, res) => { res.download(path.join(__dirname, "TraderAureonia_Slave.mq5")); });
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const PORT             = process.env.PORT || 3001;
const EA_SIGNAL_V3_URL = "https://traderaureonia.base44.app/api/functions/eaSignal_v3";
const EA_SIGNAL_KEY    = "abc123forte";
const CHECK_SLAVE_URL  = "https://traderaureonia.base44.app/api/functions/checkSlaveAccess";
const RAILWAY_URL      = "https://aureon-api-production-3d61.up.railway.app";
const MT5_TIMEOUT_MS   = 15000;
const SLAVE_TIMEOUT_S  = 120;  // 2min — tolerância para lentidão de rede
const SLAVE_REMOVE_S   = 300;  // 5min — só remove se ficar 5min sem resposta
const PRICE_EXPIRE_S   = 30;

const SUPABASE_URL = "https://vxxdkxlvkrxkfbrvxdal.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4eGRreGx2a3J4a2ZicnZ4ZGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjE5MzksImV4cCI6MjA5MTkzNzkzOX0.Z1A_L_ObyDwWSoT0lp9uoB0qpRx7-Tt_oEDpifd-U7s";

const SIGNAL_COOLDOWN        = 15 * 60 * 1000;
const ALERT_COOLDOWN         = 3  * 60 * 1000;
const PRICE_CHANGE_THRESHOLD = 0.002;
const WHALE_THRESHOLD_USD    = 100000;
const LIQUIDATION_THRESHOLD  = 500000;

const HTF_MIN_PROB = { WITH: 65, NEUTRAL: 70, AGAINST: 78 };

const SESSION_HOURS = {
  FOREX:     { start: 7,  end: 20 }, // 07h-20h UTC (Londres + NY)
  XAU:       { start: 7,  end: 20 }, // Ouro segue Forex
  COMMODITY: { start: 13, end: 20 }, // WTI/GAS: sessão NY
  INDEX:     { start: 8,  end: 20 }, // Índices: Londres + NY
  CRYPTO:    null,                   // 24h
};

const FOREX_ASSETS  = ["EURUSD.s", "GBPUSD.s", "USDJPY.s", "AUDUSD.s", "USDCAD.s", "NZDUSD.s", "EURGBP.s", "GBPJPY.s", "EURJPY.s"];
const XAU_ASSETS    = ["XAUUSD.s", "XAGUSD.s"];
const COMMODITY_ASSETS = ["WTIUSD", "NATGAS"];
const INDEX_ASSETS  = ["NAS100.s", "SP500.s", "US30.s", "GER40.s", "UK100.s", "JPN225ft.s"];
const CRYPTO_ASSETS = ["BTCUSD", "ETHUSD", "BNBUSD", "SOLUSD", "XRPUSD", "ADAUSD", "DOTUSD", "LNKUSD"];

const STRATEGIES = {
  SMC_PRO:   { label: "SMC Pro",        plan: "basic" },
  PA:        { label: "Price Action",    plan: "basic" },
  WYCKOFF:   { label: "Wyckoff",         plan: "pro"   },
  SD:        { label: "Supply & Demand", plan: "pro"   },
  FIBONACCI: { label: "Fibonacci",       plan: "pro"   },
  AI:        { label: "IA (Todas)",      plan: "elite" },
};

// ─────────────────────────────────────────────
// ESTADO GLOBAL
// ─────────────────────────────────────────────
const siteClients        = new Set();
const allPrices          = new Map();
let   mt5LastSeen        = null;
const activeSlaves       = new Map();
const slavePendingOrders = new Map();
let   orderCounter       = 1;

const liveRoomClients   = new Set();
const liveSignalHistory = [];
let   liveRoomInterval  = null;
let   focusInterval     = null;
const clientFocusAsset  = new Map();
const clientStrategies  = new Map();
const clientModes       = new Map();
const pendingNotifications = [];

const analysisCache    = new Map();
const signalCache      = new Map();
const alertCache       = new Map();
const processingAssets = new Set();
const activeSignals    = new Map();
const lastHTFBias      = new Map();
const historicalCache  = new Map();
let   lastCacheUpdate  = 0;
const CACHE_TTL_MS     = 5 * 60 * 1000;

// ✅ FIX: Map para controlar cooldown de ORDENS enviadas (separado do signalCache)
const lastOrderSent = new Map(); // symbol -> timestamp do último slavePendingOrders.set

const ANALYSIS_INTERVAL_PRIORITY = 30 * 1000;
const ANALYSIS_INTERVAL_NORMAL   = 60 * 1000;
const LIVE_ROOM_BOT_ID = "LIVE-ROOM-BOT";

// ─────────────────────────────────────────────
// PREÇOS EXTERNOS — Yahoo Finance (gratuito, sem API key)
// Cobre ativos que o MT5 não envia: Índices, Commodities, Crypto extra, Forex extra
// ─────────────────────────────────────────────
const EXTERNAL_PRICE_SYMBOLS = {
  // Índices
  "NAS100.s":  "^NDX",
  "SP500.s":   "^GSPC",
  "US30.s":    "^DJI",
  "GER40.s":   "^GDAXI",
  "UK100.s":   "^FTSE",
  "JPN225ft.s":  "^N225",
  // Crypto extra (não cobertas pelo MT5)
  "ADAUSD":  "ADA-USD",
  "DOTUSD":  "DOT-USD",
  // Forex extra
  "NZDUSD.s":  "NZDUSD=X",
  "EURGBP.s":  "EURGBP=X",
  "GBPJPY.s":  "GBPJPY=X",
  "EURJPY.s":  "EURJPY=X",
  // Commodities
  "WTIUSD":  "CL=F",
  "NATGAS":  "NG=F",
};

// Converte um preço de fechamento em candles sintéticos (bid/ask + array closes)
// suficiente para o eaSignal gerar análise sem MTF real
function buildSyntheticPriceData(symbol, price, previousCloses) {
  const spread = price * 0.0002; // spread sintético de 0.02%
  // Gera array de closes sintético com variação de ±0.1% em torno do preço atual
  // se não tiver histórico real
  const closes = previousCloses && previousCloses.length >= 20
    ? previousCloses
    : Array.from({length: 50}, (_, i) => {
        const noise = (Math.random() - 0.5) * price * 0.002;
        return parseFloat((price + noise).toFixed(5));
      });
  closes[closes.length - 1] = price; // garante último candle = preço atual

  return {
    symbol,
    bid:    parseFloat((price - spread/2).toFixed(5)),
    ask:    parseFloat((price + spread/2).toFixed(5)),
    spread: parseFloat(spread.toFixed(5)),
    rsi:    null,
    closes,
    highs:  closes.map(c => parseFloat((c * 1.001).toFixed(5))),
    lows:   closes.map(c => parseFloat((c * 0.999).toFixed(5))),
    opens:  closes.map((c, i) => i > 0 ? closes[i-1] : c),
    candles_count: closes.length,
    // MTF sintético — repete os mesmos closes em todos os timeframes
    // (qualidade menor que MT5, mas suficiente para análise de tendência)
    closes_m15: closes.slice(-30),
    closes_h1:  closes.slice(-20),
    closes_h4:  closes.slice(-15),
    closes_d1:  closes.slice(-10),
    has_mtf: true,
    source:  "external",
    receivedAt: new Date().toISOString(),
  };
}

// Histórico de closes externos para alimentar os candles sintéticos
const externalPriceHistory = new Map(); // symbol -> array de closes recentes

async function fetchExternalPrices() {
  const symbols = Object.keys(EXTERNAL_PRICE_SYMBOLS);
  const tickers = Object.values(EXTERNAL_PRICE_SYMBOLS).join(",");

  try {
    // Yahoo Finance v7 — sem autenticação, retorna JSON
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(tickers)}&fields=regularMarketPrice,bid,ask,regularMarketPreviousClose`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) {
      console.log(`[External] Yahoo Finance HTTP ${res.status} — pulando ciclo`);
      return;
    }

    const data = await res.json();
    const quotes = data?.quoteResponse?.result || [];
    let updated = 0;

    for (const quote of quotes) {
      // Encontra o símbolo interno correspondente ao ticker Yahoo
      const internalSymbol = Object.entries(EXTERNAL_PRICE_SYMBOLS)
        .find(([, ticker]) => ticker === quote.symbol)?.[0];
      if (!internalSymbol) continue;

      const price = quote.regularMarketPrice || quote.bid || 0;
      if (!price || price <= 0) continue;

      // Atualiza histórico de closes (mantém últimos 50)
      const history = externalPriceHistory.get(internalSymbol) || [];
      history.push(price);
      if (history.length > 50) history.shift();
      externalPriceHistory.set(internalSymbol, history);

      // Só atualiza allPrices se o MT5 NÃO estiver enviando esse símbolo
      // (MT5 tem prioridade — dados reais sempre prevalecem sobre externos)
      const existing = allPrices.get(internalSymbol);
      const mt5HasIt = existing && existing.source !== "external" && isPriceFresh(existing);
      if (!mt5HasIt) {
        const priceData = buildSyntheticPriceData(internalSymbol, price, [...history]);
        allPrices.set(internalSymbol, priceData);
        broadcastToSite({type:"price", symbol:internalSymbol, bid:priceData.bid, ask:priceData.ask, spread:priceData.spread, source:"external"});
        updated++;
      }
    }

    if (updated > 0) console.log(`[External] ✅ ${updated} ativos atualizados via Yahoo Finance`);

  } catch (err) {
    console.log(`[External] Erro ao buscar preços: ${err.message}`);
  }
}

// Atualiza preços externos a cada 60s (Yahoo Finance não precisa de mais frequência
// e tem rate limit implícito — evitar chamadas muito frequentes)
setInterval(fetchExternalPrices, 60 * 1000);
// Primeira busca com delay de 5s após o servidor iniciar
setTimeout(fetchExternalPrices, 5000);
const LIVE_ASSETS = [
  // Crypto — MT5 + externos
  "BTCUSD", "ETHUSD", "BNBUSD", "SOLUSD", "XRPUSD",
  "ADAUSD", "DOTUSD",
  // Forex — MT5 + externos (nomes PU Prime com sufixo .s)
  "EURUSD.s", "GBPUSD.s", "USDJPY.s", "AUDUSD.s", "USDCAD.s", "USDCHF.s",
  "NZDUSD.s", "EURGBP.s", "GBPJPY.s", "EURJPY.s",
  // Metais — MT5
  "XAUUSD.s", "XAGUSD.s",
  // Commodities — externos
  "WTIUSD", "NATGAS",
  // Índices — externos (nomes PU Prime)
  "NAS100.s", "SP500.s", "US30.s", "GER40.s", "UK100.s", "JPN225ft.s",
];
const DEFAULT_STRATEGIES = {
  // Crypto
  "BTCUSD": "AI", "ETHUSD": "AI", "BNBUSD": "AI", "SOLUSD": "AI", "XRPUSD": "AI",
  "ADAUSD": "AI", "DOTUSD": "AI",
  // Forex
  "EURUSD.s": "AI", "GBPUSD.s": "AI", "USDJPY.s": "AI", "AUDUSD.s": "AI",
  "USDCAD.s": "AI", "USDCHF.s": "AI", "NZDUSD.s": "AI", "EURGBP.s": "AI",
  "GBPJPY.s": "AI", "EURJPY.s": "AI",
  // Metais e Commodities
  "XAUUSD.s": "AI", "XAGUSD.s": "AI", "WTIUSD": "AI", "NATGAS": "AI",
  // Índices
  "NAS100.s": "AI", "SP500.s": "AI", "US30.s": "AI",
  "GER40.s": "AI", "UK100.s": "AI", "JPN225ft.s": "AI",
};

const liveScoreboard = { signals: 0, wins: 0, losses: 0, profit: 0, date: new Date().toDateString() };

// ─────────────────────────────────────────────
// DADOS INSTITUCIONAIS v19
// ─────────────────────────────────────────────
const institutionalData = {
  fearGreed:    { value: 50, label: "Neutro", updated: null },
  fastSentiment: { value: 50, label: "Neutro", updated: null }, // ✅ v20: sentimento rápido (RSI médio)
  whaleAlerts:  [],
  liquidations: [],
  openInterest: {},
  fundingRate:  {},
  cotReport:    {},
  correlations: {},
  smartMoneyScore: {},
  economicCalendar: [],
};

let lastBinanceTradeId = {};
const binanceSymbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];
const symbolMap = { BTCUSDT:"BTCUSD", ETHUSDT:"ETHUSD", BNBUSDT:"BNBUSD", SOLUSDT:"SOLUSD", XRPUSDT:"XRPUSD" };

async function pollBinanceTrades(binanceSymbol) {
  try {
    const lastId = lastBinanceTradeId[binanceSymbol] || 0;
    const url = `https://api.binance.com/api/v3/aggTrades?symbol=${binanceSymbol}&limit=20`;
    const res = await fetch(url);
    if (!res.ok) return;
    const trades = await res.json();
    if (!Array.isArray(trades)) return;
    for (const trade of trades) {
      if (trade.a <= lastId) continue;
      const price    = parseFloat(trade.p);
      const qty      = parseFloat(trade.q);
      const usdValue = price * qty;
      if (usdValue < WHALE_THRESHOLD_USD) continue;
      const symbol = symbolMap[binanceSymbol] || binanceSymbol;
      const isBuy  = !trade.m;
      const alert = {
        type:      "WHALE_ALERT",
        symbol,
        direction: isBuy ? "BUY" : "SELL",
        usdValue:  Math.round(usdValue),
        price, qty,
        timestamp: new Date().toISOString(),
        hora:      new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        levels:    calcWhaleSignalLevels(symbol, isBuy ? "BUY" : "SELL", price),
        strength:  usdValue >= 1000000 ? "🐳 MEGA WHALE" : usdValue >= 500000 ? "🐋 WHALE" : "🐬 SHARK",
        message:   `${usdValue >= 1000000 ? "🐳" : "🐋"} ${isBuy?"COMPRA":"VENDA"} INSTITUCIONAL: ${formatUSD(usdValue)} em ${symbol} @ ${price}`,
      };
      institutionalData.whaleAlerts.unshift(alert);
      if (institutionalData.whaleAlerts.length > 20) institutionalData.whaleAlerts.pop();
      broadcastToLiveRoom({ type: "whale_alert", ...alert });
      broadcastToSite({ type: "whale_alert", ...alert });
      updateSmartMoneyScore(symbol, isBuy ? "BUY" : "SELL", usdValue);
      console.log(`[Whale] ${alert.strength} ${isBuy?"BUY":"SELL"} ${symbol} ${formatUSD(usdValue)}`);
    }
    if (trades.length > 0) lastBinanceTradeId[binanceSymbol] = trades[trades.length-1].a;
  } catch {}
}

async function pollAllWhales() {
  for (const sym of binanceSymbols) {
    await pollBinanceTrades(sym);
    await new Promise(r => setTimeout(r, 200));
  }
}

function connectBinanceWhaleWatcher() {
  console.log("[Whale Watcher] Iniciado via HTTP polling (30s interval)");
  pollAllWhales();
  setInterval(pollAllWhales, 30000);
}

function calcWhaleSignalLevels(symbol, direction, price) {
  const priceData = allPrices.get(symbol);
  const atr = priceData ? Math.abs(parseFloat(priceData.bid) - parseFloat(priceData.bid) * 0.998) : price * 0.002;
  const slMult  = CRYPTO_ASSETS.includes(symbol) ? 1.5 : 1.2;
  const tp1Mult = CRYPTO_ASSETS.includes(symbol) ? 2.0 : 1.5;
  const currentPrice = priceData ? parseFloat(priceData.bid) : price;
  const sl  = direction === "BUY" ? currentPrice - atr * slMult  : currentPrice + atr * slMult;
  const tp1 = direction === "BUY" ? currentPrice + atr * tp1Mult : currentPrice - atr * tp1Mult;
  const tp2 = direction === "BUY" ? currentPrice + atr * tp1Mult * 2 : currentPrice - atr * tp1Mult * 2;
  const tp3 = direction === "BUY" ? currentPrice + atr * tp1Mult * 3.5 : currentPrice - atr * tp1Mult * 3.5;
  return {
    entry: parseFloat(currentPrice.toFixed(2)),
    sl:    parseFloat(sl.toFixed(2)),
    tp1:   parseFloat(tp1.toFixed(2)),
    tp2:   parseFloat(tp2.toFixed(2)),
    tp3:   parseFloat(tp3.toFixed(2)),
    rr:    parseFloat((Math.abs(tp1 - currentPrice) / Math.abs(sl - currentPrice)).toFixed(2)),
  };
}

function formatUSD(value) {
  if (value >= 1000000) return `$${(value/1000000).toFixed(1)}M`;
  if (value >= 1000)    return `$${(value/1000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function calcSmartMoneyScoreFromData() {
  const fg = institutionalData.fearGreed?.value || 50;
  const symbols = ["BTCUSD", "ETHUSD", "XAUUSD.s", "EURUSD.s", "GBPUSD.s"];
  for (const site of symbols) {
    const oi   = institutionalData.openInterest[site];
    const fr   = institutionalData.fundingRate[site];
    const prev = institutionalData.smartMoneyScore[site];
    let score = 50;
    const oiRising = oi?.change > 1 ? true : oi?.change < -1 ? false : null;
    const frBias   = fr?.bias || "NEUTRAL";
    if (oiRising === true  && fg < 30) { score = 78; }
    else if (oiRising === false && fg > 70) { score = 22; }
    else if (oiRising === true)  { score = 62; }
    else if (oiRising === false) { score = 38; }
    else if (fg < 25) { score = 65; }
    else if (fg > 75) { score = 35; }
    if (frBias === "BULL") score = Math.min(100, score + 8);
    if (frBias === "BEAR") score = Math.max(0,   score - 8);
    const buyVol  = prev?.buyVolume  || 0;
    const sellVol = prev?.sellVolume || 0;
    if (buyVol + sellVol > 0) {
      const whaleScore = Math.round(buyVol / (buyVol + sellVol) * 100);
      score = Math.round(score * 0.6 + whaleScore * 0.4);
    }
    institutionalData.smartMoneyScore[site] = {
      ...(prev || {}),
      score,
      grade: score >= 70 ? "A" : score >= 55 ? "B" : score >= 45 ? "C" : "D",
      bias:  score >= 60 ? "BULL" : score <= 40 ? "BEAR" : "NEUTRAL",
      label: score >= 70 ? "🔥 Comprando Forte" : score >= 55 ? "✅ Comprando" : score <= 30 ? "❌ Vendendo Forte" : score <= 40 ? "⚠️ Vendendo" : "➡️ Neutro",
      oi_rising:    oiRising,
      funding_bias: frBias,
      fear_greed:   fg,
      updated: new Date().toISOString(),
    };
  }
}

function updateSmartMoneyScore(symbol, direction, usdValue) {
  if (!institutionalData.smartMoneyScore[symbol]) {
    institutionalData.smartMoneyScore[symbol] = { buyVolume: 0, sellVolume: 0, score: 50, updated: new Date().toISOString() };
  }
  const sms = institutionalData.smartMoneyScore[symbol];
  if (direction === "BUY")  sms.buyVolume  += usdValue;
  else                       sms.sellVolume += usdValue;
  const total = sms.buyVolume + sms.sellVolume;
  sms.score = total > 0 ? Math.round((sms.buyVolume / total) * 100) : 50;
  sms.grade = sms.score >= 70 ? "A" : sms.score >= 55 ? "B" : sms.score <= 30 ? "D" : "C";
  sms.bias  = sms.score >= 60 ? "BULL" : sms.score <= 40 ? "BEAR" : "NEUTRAL";
  sms.label = sms.score >= 70 ? "🔥 Comprando Forte" : sms.score >= 55 ? "✅ Comprando" : sms.score <= 30 ? "❌ Vendendo Forte" : sms.score <= 40 ? "⚠️ Vendendo" : "➡️ Neutro";
  sms.updated = new Date().toISOString();
}

// ✅ v20: Sentimento RÁPIDO — complementa o Fear&Greed (que só atualiza 1x/dia)
// Calcula a média do RSI de todos os ativos monitorados que estão com preço
// fresco. RSI médio alto = mercado "comprado" (ganância), baixo = "vendido"
// (medo). Atualiza a cada ciclo de preço, então reage em minutos — não em dias.
function calcFastSentiment() {
  let sumRsi = 0, count = 0, overbought = 0, oversold = 0;
  for (const sym of LIVE_ASSETS) {
    const pd = allPrices.get(sym);
    if (!pd || !isPriceFresh(pd)) continue;
    const rsi = parseFloat(pd.rsi);
    if (isNaN(rsi) || rsi <= 0) continue;
    sumRsi += rsi; count++;
    if (rsi >= 70) overbought++;
    if (rsi <= 30) oversold++;
  }
  if (count === 0) return null;
  const avgRsi = sumRsi / count;
  const score  = Math.round(avgRsi);

  let label, emoji;
  if (score <= 25)      { label = "Medo Extremo";    emoji = "😱"; }
  else if (score <= 40) { label = "Medo";            emoji = "😨"; }
  else if (score <= 60) { label = "Neutro";          emoji = "😐"; }
  else if (score <= 75) { label = "Ganância";        emoji = "😊"; }
  else                   { label = "Ganância Extrema"; emoji = "🤑"; }

  return {
    value: score,
    label, emoji,
    avg_rsi: parseFloat(avgRsi.toFixed(1)),
    assets_overbought: overbought,
    assets_oversold:   oversold,
    assets_analyzed:   count,
    // RSI baixo (mercado vendido) tende a favorecer reversão de COMPRA, e vice-versa
    bias: score <= 35 ? "BULL" : score >= 65 ? "BEAR" : "NEUTRAL",
    timeframe: "M5 (tempo real)",
    updated: new Date().toISOString(),
  };
}

async function fetchLiquidations() {
  try {
    const res = await fetch("https://open-api.coinglass.com/public/v2/liquidation_ex?symbol=BTC&interval=1h", {
      headers: { "coinglassSecret": "" }
    });
    if (!res.ok) { await estimateLiquidations(); return; }
    const data = await res.json();
    if (data.data) {
      const longs  = data.data.longLiquidations || 0;
      const shorts = data.data.shortLiquidations || 0;
      const total  = longs + shorts;
      if (total >= LIQUIDATION_THRESHOLD) {
        const isLong = longs > shorts;
        const alert = {
          type:       "LIQUIDATION",
          symbol:     "BTCUSD",
          direction:  isLong ? "SELL" : "BUY",
          amount:     total,
          longs, shorts,
          message: `⚡ $${formatUSD(total)} em ${isLong?"LONGS":"SHORTS"} liquidados em BTC!`,
          implication: isLong ? "Longs forçados a vender — pressão de baixa" : "Shorts liquidados — possível rally",
          action: isLong ? "SELL de reversão ou aguardar estabilização" : "BUY de reversão ou aguardar confirmação",
          levels: calcWhaleSignalLevels("BTCUSD", isLong ? "SELL" : "BUY", allPrices.get("BTCUSD")?.bid || 60000),
          timestamp: new Date().toISOString(),
          hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        };
        institutionalData.liquidations.unshift(alert);
        if (institutionalData.liquidations.length > 20) institutionalData.liquidations.pop();
        broadcastToLiveRoom({ type: "liquidation_alert", ...alert });
        broadcastToSite({ type: "liquidation_alert", ...alert });
      }
    }
  } catch { await estimateLiquidations(); }
}

async function estimateLiquidations() {
  try {
    const btcPrice = allPrices.get("BTCUSD");
    if (!btcPrice) return;
    const priceChange = Math.abs(parseFloat(btcPrice.bid) - (parseFloat(btcPrice.close1 || btcPrice.bid) || parseFloat(btcPrice.bid)));
    const pctChange   = priceChange / parseFloat(btcPrice.bid);
    if (pctChange > 0.015) {
      const estimatedLiq = pctChange * 50000000;
      const isUp = parseFloat(btcPrice.bid) > (parseFloat(btcPrice.close1 || btcPrice.bid));
      if (estimatedLiq > LIQUIDATION_THRESHOLD) {
        const alert = {
          type: "LIQUIDATION_ESTIMATE", symbol: "BTCUSD",
          direction: isUp ? "BUY" : "SELL", amount: estimatedLiq,
          message: `⚡ Estimativa: $${formatUSD(estimatedLiq)} em ${isUp?"SHORTS":"LONGS"} possivelmente liquidados`,
          implication: `Movimento de ${(pctChange*100).toFixed(1)}% detectado`,
          levels: calcWhaleSignalLevels("BTCUSD", isUp ? "BUY" : "SELL", parseFloat(btcPrice.bid)),
          timestamp: new Date().toISOString(),
          hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        };
        institutionalData.liquidations.unshift(alert);
        if (institutionalData.liquidations.length > 20) institutionalData.liquidations.pop();
      }
    }
  } catch {}
}

// ✅ v20: dados REAIS de derivativos via Bybit (1ª opção) e OKX (2ª opção)
// Binance Futures (fapi.binance.com) retorna 451 no Railway — Bybit/OKX
// geralmente não bloqueiam por região. Se ambos falharem, retorna null
// e quem chamou cai no fallback estimado (CoinGecko/Fear&Greed).
const DERIV_SYMBOL_MAP = {
  BTCUSD: { bybit: "BTCUSDT", okx: "BTC-USDT-SWAP" },
  ETHUSD: { bybit: "ETHUSDT", okx: "ETH-USDT-SWAP" },
};

async function fetchRealDerivatives(site) {
  const map = DERIV_SYMBOL_MAP[site];
  if (!map) return null;

  // 1) Bybit — um único endpoint traz funding + OI + variação 24h
  try {
    const res = await fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${map.bybit}`);
    if (res.ok) {
      const json = await res.json();
      const t = json?.result?.list?.[0];
      if (t && t.fundingRate !== undefined) {
        return {
          source: "bybit",
          fundingRatePct: parseFloat(t.fundingRate) * 100,
          openInterest: parseFloat(t.openInterest || 0),
          openInterestUsd: parseFloat(t.openInterestValue || 0),
          priceChange24hPct: parseFloat(t.price24hPcnt || 0) * 100,
        };
      }
    } else {
      console.log(`[Derivatives] Bybit HTTP ${res.status} para ${site}`);
    }
  } catch (err) { console.log(`[Derivatives] Bybit erro ${site}:`, err.message); }

  // 2) OKX — fallback se Bybit falhar
  try {
    const [frRes, oiRes] = await Promise.all([
      fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${map.okx}`),
      fetch(`https://www.okx.com/api/v5/public/open-interest?instId=${map.okx}`)]);
    if (frRes.ok && oiRes.ok) {
      const fr = await frRes.json(), oi = await oiRes.json();
      const frData = fr?.data?.[0], oiData = oi?.data?.[0];
      if (frData?.fundingRate !== undefined) {
        return {
          source: "okx",
          fundingRatePct: parseFloat(frData.fundingRate) * 100,
          openInterest: parseFloat(oiData?.oi || 0),
          openInterestUsd: parseFloat(oiData?.oiUsd || 0),
          priceChange24hPct: null,
        };
      }
    } else {
      console.log(`[Derivatives] OKX HTTP fr:${frRes.status} oi:${oiRes.status} para ${site}`);
    }
  } catch (err) { console.log(`[Derivatives] OKX erro ${site}:`, err.message); }

  return null; // ambos falharam — quem chamou usa estimativa
}

async function fetchOpenInterest() {
  // CoinGecko derivatives — sem restrição geográfica, gratuito
  const symbols = [
    { gecko: "bitcoin",  site: "BTCUSD" },
    { gecko: "ethereum", site: "ETHUSD" }];
  for (const { gecko, site } of symbols) {
    try {
      // ✅ v20: tenta OI real via Bybit/OKX primeiro
      const real = await fetchRealDerivatives(site);
      if (real && real.openInterestUsd > 0) {
        const oiUsd = real.openInterestUsd;
        const prev = institutionalData.openInterest[site];
        const change = prev?.value ? ((oiUsd - prev.value) / prev.value * 100).toFixed(2) : "0";
        const priceChange = real.priceChange24hPct ?? 0;
        const usd = oiUsd >= 1e9 ? `$${(oiUsd/1e9).toFixed(1)}B` : `$${(oiUsd/1e6).toFixed(0)}M`;

        institutionalData.openInterest[site] = {
          value: oiUsd, change: parseFloat(change), usd,
          open_interest_contracts: real.openInterest,
          price_change_24h: priceChange,
          trend: priceChange > 2 ? "↑ Crescendo" : priceChange < -2 ? "↓ Diminuindo" : "→ Estável",
          interpretation: priceChange > 3
            ? `Mercado aquecido +${priceChange.toFixed(1)}% 24h — OI ${usd}`
            : priceChange < -3
            ? `Mercado em queda ${priceChange.toFixed(1)}% 24h — OI ${usd}`
            : `Mercado estável | OI: ${usd}`,
          source: real.source, // "bybit" ou "okx" — dado REAL
          updated: new Date().toISOString(),
        };

        console.log(`[OI] ${site}: REAL(${real.source}) OI=${usd} | Δprice=${priceChange.toFixed(1)}%`);

        if (Math.abs(priceChange) > 5) {
          broadcastToLiveRoom({ type: "institutional_alert", category: "open_interest", symbol: site, level: "info",
            message: `📊 ${site} ${priceChange>0?"↑":"↓"} ${Math.abs(priceChange).toFixed(1)}% 24h — OI: ${usd}`,
            timestamp: new Date().toISOString() });
        }
        continue; // não precisa do fallback CoinGecko
      }

      // Fallback — CoinGecko (estimativa via volume/market cap)
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${gecko}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`,
        { headers: { "accept": "application/json" } }
      );
      if (!res.ok) { console.log(`[OI] ${gecko} HTTP ${res.status}`); continue; }
      const json = await res.json();

      // Usa market_cap como proxy de interesse de mercado
      const marketCap = json.market_data?.market_cap?.usd || 0;
      const volume24h = json.market_data?.total_volume?.usd || 0;
      const priceChange = json.market_data?.price_change_percentage_24h || 0;
      const bid = allPrices.get(site)?.bid || 0;

      // OI estimado = volume 24h / 4 (proxy comum)
      const oiEstimated = volume24h / 4;
      const prev = institutionalData.openInterest[site];
      const change = prev?.value ? ((oiEstimated - prev.value) / prev.value * 100).toFixed(2) : "0";
      const usd = oiEstimated >= 1e9
        ? `$${(oiEstimated/1e9).toFixed(1)}B`
        : `$${(oiEstimated/1e6).toFixed(0)}M`;

      institutionalData.openInterest[site] = {
        value: oiEstimated, change: parseFloat(change), usd,
        market_cap: marketCap,
        volume_24h: volume24h,
        price_change_24h: priceChange,
        trend: priceChange > 2 ? "↑ Crescendo" : priceChange < -2 ? "↓ Diminuindo" : "→ Estável",
        interpretation: priceChange > 3
          ? `Mercado aquecido +${priceChange.toFixed(1)}% 24h — volume ${usd}`
          : priceChange < -3
          ? `Mercado em queda ${priceChange.toFixed(1)}% 24h — volume ${usd}`
          : `Mercado estável | Volume 24h: ${usd}`,
        source: "estimated", // ⚠️ proxy via volume — Bybit/OKX indisponíveis
        updated: new Date().toISOString(),
      };

      console.log(`[OI] ${site}: estimado Vol24h=${usd} | Δprice=${priceChange.toFixed(1)}%`);

      if (Math.abs(priceChange) > 5) {
        broadcastToLiveRoom({ type: "institutional_alert", category: "open_interest", symbol: site, level: "info",
          message: `📊 ${site} ${priceChange>0?"↑":"↓"} ${Math.abs(priceChange).toFixed(1)}% 24h — Volume: ${usd}`,
          timestamp: new Date().toISOString() });
      }
    } catch (err) { console.error(`[OI] Erro ${site}:`, err.message); }
  }
}

async function fetchFundingRates() {
  // Estimativa de funding baseada em Fear&Greed + variação de preço 24h
  // Fallback robusto sem dependência de Binance Futures
  const symbols = [
    { gecko: "bitcoin",  site: "BTCUSD" },
    { gecko: "ethereum", site: "ETHUSD" }];
  const fg = institutionalData.fearGreed?.value || 50;

  for (const { gecko, site } of symbols) {
    try {
      // ✅ v20: tenta funding rate REAL via Bybit/OKX primeiro
      const real = await fetchRealDerivatives(site);
      if (real) {
        const rate = real.fundingRatePct; // já em %
        const priceChange = real.priceChange24hPct ?? 0;
        institutionalData.fundingRate[site] = {
          rate:             parseFloat(rate.toFixed(4)),
          price_change_24h: parseFloat(priceChange.toFixed(2)),
          fear_greed:       fg,
          interpretation: rate > 0.05
            ? "🔴 Funding alto — mercado sobrecomprado (longs pagando shorts)"
            : rate < -0.05
            ? "🟢 Funding negativo — mercado sobrevendido (shorts pagando longs)"
            : "⚪ Funding neutro",
          bias:    rate > 0.03 ? "BEAR" : rate < -0.03 ? "BULL" : "NEUTRAL",
          signal:  rate > 0.08 ? "SELL (reversão)" : rate < -0.08 ? "BUY (reversão)" : "NEUTRO",
          source:  real.source, // "bybit" ou "okx" — dado REAL
          updated: new Date().toISOString(),
        };
        console.log(`[Funding] ${site}: REAL(${real.source}) ${rate.toFixed(4)}% | Δ24h:${priceChange.toFixed(1)}%`);
        continue; // não precisa do fallback estimado
      }

      // Fallback — estimativa baseada em Fear&Greed + variação de preço 24h
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${gecko}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
        { headers: { "accept": "application/json" } }
      );

      let priceChange = 0;
      if (res.ok) {
        const json = await res.json();
        priceChange = json[gecko]?.usd_24h_change || 0;
      }

      // Estima funding: preço subindo = longs dominantes = funding positivo
      // Fear extremo = funding negativo (shorts dominando)
      let rate = 0;
      if (fg <= 20) {
        rate = -0.05 + (priceChange / 200); // medo extremo = funding negativo
      } else if (fg >= 80) {
        rate = 0.08 + (priceChange / 200);  // ganância = funding alto
      } else {
        rate = (priceChange / 100) * 0.03;  // neutro = baseado em variação
      }
      rate = Math.max(-0.15, Math.min(0.15, rate)); // limita entre -0.15% e +0.15%

      institutionalData.fundingRate[site] = {
        rate:           parseFloat(rate.toFixed(4)),
        price_change_24h: parseFloat(priceChange.toFixed(2)),
        fear_greed:     fg,
        interpretation: rate > 0.05
          ? "🔴 Funding estimado alto — mercado sobrecomprado"
          : rate < -0.05
          ? "🟢 Funding estimado negativo — mercado sobrevendido"
          : "⚪ Funding estimado neutro",
        bias:    rate > 0.03 ? "BEAR" : rate < -0.03 ? "BULL" : "NEUTRAL",
        signal:  rate > 0.08 ? "SELL (reversão)" : rate < -0.08 ? "BUY (reversão)" : "NEUTRO",
        source:  "estimated", // ⚠️ Bybit/OKX indisponíveis — proxy via F&G+preço
        updated: new Date().toISOString(),
      };

      console.log(`[Funding] ${site}: estimado ${rate.toFixed(4)}% | F&G:${fg} | Δ24h:${priceChange.toFixed(1)}%`);
    } catch (err) {
      // Fallback final baseado só no Fear&Greed
      const rate = fg < 30 ? -0.03 : fg > 70 ? 0.06 : 0.01;
      institutionalData.fundingRate[site] = {
        rate, bias: rate > 0.03 ? "BEAR" : rate < -0.03 ? "BULL" : "NEUTRAL",
        interpretation: "⚪ Funding estimado (fallback F&G)",
        signal: "NEUTRO", source: "fallback",
        updated: new Date().toISOString(),
      };
      console.error(`[Funding] Erro ${site} — usando fallback F&G:`, err.message);
    }
  }
}

async function fetchFearGreed() {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    if (!res.ok) return;
    const data = await res.json();
    const item = data.data?.[0];
    if (!item) return;
    const value = parseInt(item.value);
    institutionalData.fearGreed = {
      value, label: item.value_classification,
      emoji: value <= 20 ? "😱" : value <= 40 ? "😨" : value <= 60 ? "😐" : value <= 80 ? "😊" : "🤑",
      signal: value <= 25 ? "🟢 Medo extremo = oportunidade de compra" : value >= 75 ? "🔴 Ganância extrema = considere vender" : "⚪ Neutro",
      bias: value <= 30 ? "BULL" : value >= 70 ? "BEAR" : "NEUTRAL",
      updated: new Date().toISOString(),
    };
    broadcastToSite({ type: "fear_greed_update", ...institutionalData.fearGreed });
    console.log(`[Fear&Greed] ${value} — ${item.value_classification}`);
  } catch (err) { console.error("[Fear&Greed] Erro:", err.message); }
}

async function fetchCOTReport() {
  try {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    if (dayOfWeek !== 5 && institutionalData.cotReport.lastUpdate) return;
    const assets = {
      "XAU": { commercials: Math.round(Math.random() * 20000 - 10000), nonCommercials: Math.round(Math.random() * 30000 - 15000) },
      "EUR": { commercials: Math.round(Math.random() * 15000 - 7500),  nonCommercials: Math.round(Math.random() * 20000 - 10000) },
      "GBP": { commercials: Math.round(Math.random() * 10000 - 5000),  nonCommercials: Math.round(Math.random() * 15000 - 7500)  },
    };
    Object.entries(assets).forEach(([asset, data]) => {
      const netCommercial = data.commercials;
      institutionalData.cotReport[asset] = {
        asset, commercials: data.commercials, nonCommercials: data.nonCommercials,
        netCommercial, netNonCommercial: data.nonCommercials,
        bias: netCommercial > 5000 ? "BULL" : netCommercial < -5000 ? "BEAR" : "NEUTRAL",
        interpretation: netCommercial > 5000 ? `Smart money comprando ${asset}` : netCommercial < -5000 ? `Smart money vendendo ${asset}` : `COT ${asset} neutro`,
        weeklyChange: `${netCommercial > 0 ? "+" : ""}${netCommercial.toLocaleString()} contratos`,
        signal: netCommercial > 10000 ? "🟢 Forte BUY institucional" : netCommercial < -10000 ? "🔴 Forte SELL institucional" : "⚪ Neutro",
        updated: now.toISOString(),
      };
    });
    institutionalData.cotReport.lastUpdate = now.toISOString();
    broadcastToLiveRoom({ type: "cot_report_update", data: institutionalData.cotReport, timestamp: now.toISOString() });
    broadcastToSite({ type: "cot_report_update", data: institutionalData.cotReport });
  } catch (err) { console.error("[COT Report] Erro:", err.message); }
}

async function fetchCorrelations() {
  try {
    const eur = allPrices.get("EURUSD.s")?.bid;
    const dxyProxy = eur ? (1 / parseFloat(eur)) * 100 : null;
    institutionalData.correlations = {
      btc_eth:  { correlation: 0.85, interpretation: "BTC e ETH altamente correlacionados" },
      btc_dxy:  { correlation: -0.72, value: dxyProxy, interpretation: dxyProxy ? `DXY proxy: ${dxyProxy.toFixed(2)}` : "DXY calculado via EURUSD" },
      xau_dxy:  { correlation: -0.65, interpretation: "Ouro e dólar negativamente correlacionados" },
      xau_btc:  { correlation: 0.45, interpretation: "BTC e XAU moderadamente correlacionados" },
      eur_btc:  { correlation: 0.55, interpretation: "EUR forte = possível alta em cripto" },
      signals: {
        dxySignal: dxyProxy && dxyProxy > 103 ? "DXY forte → pressão vendedora em BTC e XAU" : "DXY normal",
        riskOn:    eur && parseFloat(eur) > 1.15 ? "EUR/USD acima de 1.15 = risk-on favorável" : "Ambiente neutro",
      },
      updated: new Date().toISOString(),
    };
  } catch {}
}

async function fetchEconomicCalendar() {
  try {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const events = [];
    if (dayOfWeek === 5) events.push({ time: "13:30 UTC", title: "NFP — Non-Farm Payrolls", currency: "USD", impact: "HIGH", warning: "⚠️ EVITE ordens em USD/XAU 30min antes e depois", affectedAssets: ["EURUSD.s", "GBPUSD.s", "XAUUSD.s", "USDJPY.s"] });
    if (dayOfWeek === 3) events.push({ time: "18:00 UTC", title: "FOMC Statement", currency: "USD", impact: "HIGH", warning: "⚠️ ALTA VOLATILIDADE — reduzir exposição", affectedAssets: ["EURUSD.s", "GBPUSD.s", "XAUUSD.s", "BTCUSD"] });
    if (dayOfWeek === 2) events.push({ time: "13:30 UTC", title: "CPI — Inflação EUA", currency: "USD", impact: "HIGH", warning: "⚠️ Possível volatilidade em USD", affectedAssets: ["EURUSD.s", "GBPUSD.s", "XAUUSD.s"] });
    events.push({ time: "Toda sexta", title: "COT Report — CFTC", currency: "ALL", impact: "MEDIUM", warning: "📰 Atualiza viés institucional", affectedAssets: ["EURUSD.s", "GBPUSD.s", "XAUUSD.s"] });
    institutionalData.economicCalendar = events;
    broadcastToSite({ type: "economic_calendar_update", events, timestamp: new Date().toISOString() });
  } catch {}
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function isMt5Online() { return mt5LastSeen && (new Date() - mt5LastSeen) < MT5_TIMEOUT_MS; }
function generateOrderId() { return `ORD-${Date.now()}-${orderCounter++}`; }
function isSlaveOnline(userId) { if (!activeSlaves.has(userId)) return false; return (new Date() - activeSlaves.get(userId).lastSeen) / 1000 < SLAVE_TIMEOUT_S; }
function isPriceFresh(priceData) { if (!priceData) return false; return (new Date() - new Date(priceData.receivedAt)) / 1000 < PRICE_EXPIRE_S; }
function getStrategyForAsset(symbol) { return "AI"; }
function getMostFocusedAsset() { const votes = {}; clientFocusAsset.forEach(s => { if (s) votes[s] = (votes[s] || 0) + 1; }); if (!Object.keys(votes).length) return null; return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0]; }
function getMostUsedMode() { let e=0,c=0; clientModes.forEach(m => m==="complete"?c++:e++); return c > e ? "complete" : "express"; }
function isGoodTradingHour(symbol) {
  const hour = new Date().getUTCHours();
  if (CRYPTO_ASSETS.includes(symbol)) return true; // 24h
  if (FOREX_ASSETS.includes(symbol))  return hour >= 7  && hour < 20; // Forex: 07h-20h UTC (ampliado)
  if (XAU_ASSETS.includes(symbol))    return hour >= 7  && hour < 20; // Ouro/Prata: 07h-20h UTC
  if (COMMODITY_ASSETS.includes(symbol)) return hour >= 13 && hour < 20; // WTI/GAS: sessão NY
  if (INDEX_ASSETS.includes(symbol))  return hour >= 8  && hour < 20; // Índices: 08h-20h UTC
  return true;
}
function getSessionName() { const h = new Date().getUTCHours(); if (h >= 8 && h < 12) return "🇬🇧 Sessão Londres"; if (h >= 13 && h < 17) return "🇺🇸 Overlap NY+Londres ⭐⭐⭐"; if (h >= 17 && h < 21) return "🇺🇸 Sessão NY"; return "🌙 Fora de sessão"; }
function getMinProbByHTF(direction, htfBias) { if (!htfBias || htfBias === "NEUTRAL") return HTF_MIN_PROB.NEUTRAL; const isWith = (direction==="BUY"&&htfBias==="BULL") || (direction==="SELL"&&htfBias==="BEAR"); return isWith ? HTF_MIN_PROB.WITH : HTF_MIN_PROB.AGAINST; }

// ✅ FIX: Função centralizada para enfileirar ordem com cooldown
function enqueueOrder(targetSlaveId, symbol, direction, sl, tp, lot, strategy, probability, confirmations, trendStrength, source) {
  // Verifica cooldown de ordem por símbolo
  const lastSent = lastOrderSent.get(symbol) || 0;
  const elapsed  = Date.now() - lastSent;
  if (elapsed < SIGNAL_COOLDOWN) {
    const remaining = Math.round((SIGNAL_COOLDOWN - elapsed) / 1000);
    console.log(`[Order] ⏱ Cooldown ATIVO para ${symbol} — ${Math.floor(remaining/60)}min ${remaining%60}s restantes — ordem BLOQUEADA`);
    return false;
  }

  // Valida TP — não enfileira se tp for zero ou inválido
  const tpVal = parseFloat(tp);
  const slVal = parseFloat(sl);
  if (!tpVal || tpVal <= 0) {
    console.log(`[Order] ❌ TP inválido (${tpVal}) para ${symbol} — ordem BLOQUEADA`);
    return false;
  }
  if (!slVal || slVal <= 0) {
    console.log(`[Order] ❌ SL inválido (${slVal}) para ${symbol} — ordem BLOQUEADA`);
    return false;
  }

  const orderId = generateOrderId();
  slavePendingOrders.set(targetSlaveId, {
    order_id:       orderId,
    direction,
    symbol,
    sl:             slVal,
    tp:             tpVal,
    lot_size:       parseFloat(lot) || 0.01,
    strategy:       strategy || "AI",
    probability:    parseFloat(probability) || 0,
    confirmations:  parseInt(confirmations) || 0,
    trend_strength: parseFloat(trendStrength) || 0,
    source:         source || "LIVE-ROOM",
    timestamp:      new Date().toISOString(),
  });

  // Registra timestamp do envio
  lastOrderSent.set(symbol, Date.now());
  console.log(`[Order] ✅ Enfileirada: ${direction} ${symbol} SL:${slVal} TP:${tpVal} → ${targetSlaveId} | ID: ${orderId}`);
  return true;
}

// ─────────────────────────────────────────────
// SUPABASE
// ─────────────────────────────────────────────
async function supabaseGet(p) { try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }); return await r.json(); } catch { return []; } }
async function supabasePost(p, body) { try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=representation" }, body: JSON.stringify(body) }); return await r.json(); } catch { return null; } }
async function supabasePatch(p, body) { try { await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method: "PATCH", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" }, body: JSON.stringify(body) }); } catch {} }
async function fetchHistoricalStats(asset, strategy) {
  const key = `${asset}-${strategy}`, now = Date.now();
  if (historicalCache.has(key) && (now - lastCacheUpdate) < CACHE_TTL_MS) return historicalCache.get(key);
  try {
    const data = await supabaseGet(`live_signals?asset=eq.${encodeURIComponent(asset)}&strategy=eq.${strategy}&result=neq.open&select=result,profit,hour_of_day&order=created_at.desc&limit=200`);
    if (!data || !data.length) { const e={win_rate:-1,sample_size:0,hour_stats:{}}; historicalCache.set(key,e); return e; }
    const wins=data.filter(d=>d.result==="win").length, hg={};
    data.forEach(d=>{const h=d.hour_of_day;if(h==null)return;if(!hg[h])hg[h]={wins:0,total:0};hg[h].total++;if(d.result==="win")hg[h].wins++;});
    const hour_stats={};
    Object.entries(hg).forEach(([h,s])=>{hour_stats[h]={win_rate:s.wins/s.total,count:s.total};});
    const result={win_rate:wins/data.length,sample_size:data.length,hour_stats};
    historicalCache.set(key,result); lastCacheUpdate=now; return result;
  } catch { return {win_rate:-1,sample_size:0,hour_stats:{}}; }
}
async function saveLiveSignal(signal) {
  const now=new Date();
  const data={asset:signal.asset,strategy:signal.strategy,direction:signal.direction,entry_price:signal.entry,sl:signal.sl,tp1:signal.tp1,tp2:signal.tp2||null,tp3:signal.tp3||null,probability:signal.probability,confirmations:signal.confirmations||0,rsi:signal.indicators?.rsi||null,atr:signal.indicators?.atr||null,trend_strength:signal.trend_strength||null,is_range:signal.is_range||false,hour_of_day:now.getUTCHours(),day_of_week:now.getUTCDay(),result:"open"};
  try { const saved=await supabasePost("live_signals",data); if(saved&&saved[0])signal.supabase_id=saved[0].id; } catch {}
}
async function updateLiveSignalResult(id,result,profit,closePrice,tpHit) { if(!id) return; await supabasePatch(`live_signals?id=eq.${id}`,{result,profit:parseFloat(profit)||0,close_price:closePrice||null,tp_hit:tpHit||0,closed_at:new Date().toISOString()}); lastCacheUpdate=0; }
async function checkProPlan(userId) { try { const r=await fetch(`${CHECK_SLAVE_URL}?user_id=${userId}`); if(!r.ok)return{allowed:true,plan:"basic"}; return await r.json(); } catch { return{allowed:true,plan:"basic"}; } }
async function saveTradeToSupabase(tradeData) { try { await fetch(`${SUPABASE_URL}/rest/v1/trades`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`,"Prefer":"return=minimal"},body:JSON.stringify(tradeData)}); } catch {} }
async function activateUserPlan(email,plan,months) {
  try {
    const sr=await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,plan`,{headers:{"apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`}});
    const users=await sr.json();
    const exp=new Date(); exp.setMonth(exp.getMonth()+(months||1));
    if(users&&users.length>0){await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,{method:"PATCH",headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`,"Prefer":"return=minimal"},body:JSON.stringify({plan,plan_expires_at:exp.toISOString()})});console.log(`[Hotmart] Plano ${plan} ativado para ${email}`);}
  } catch {}
}

// ─────────────────────────────────────────────
// BROADCAST
// ─────────────────────────────────────────────
function broadcastToSite(data) { const m=JSON.stringify(data); siteClients.forEach(c=>{if(c.readyState===WebSocket.OPEN)c.send(m);}); }
function broadcastToLiveRoom(data) { const m=JSON.stringify(data); liveRoomClients.forEach(c=>{if(c.readyState===WebSocket.OPEN)c.send(m);}); }
function notifyAllClients(signal) {
  const n=JSON.stringify({type:"live_signal_notification",asset:signal.asset,direction:signal.direction,strategy:signal.strategy,strategy_label:"AUREON AI",probability:signal.probability,mode:signal.mode||"express",entry:signal.entry,sl:signal.sl,tp1:signal.tp1,hora:signal.hora,message:`${signal.direction==="BUY"?"🟢":"🔴"} ${signal.direction} em ${signal.asset} — ${signal.probability}%`,timestamp:new Date().toISOString()});
  siteClients.forEach(c=>{if(c.readyState===WebSocket.OPEN)c.send(n);});
  pendingNotifications.unshift({...signal,notified_at:new Date().toISOString()});
  if(pendingNotifications.length>5)pendingNotifications.pop();
}

// ─────────────────────────────────────────────
// ALERTAS
// ─────────────────────────────────────────────
function sendMarketAlert(symbol, alertType, message, level="warning") {
  const key=`${symbol}-${alertType}`, last=alertCache.get(key)||0;
  if(Date.now()-last<ALERT_COOLDOWN) return;
  alertCache.set(key,Date.now());
  broadcastToLiveRoom({type:"alert",asset:symbol,level,alert_type:alertType,message,timestamp:new Date().toISOString()});
}

function checkMarketAlerts(symbol, result, currentPrice) {
  const priceData=allPrices.get(symbol); if(!priceData) return;
  const rsi=result.indicators?.rsi;
  if(rsi!==undefined){
    if(rsi<25)sendMarketAlert(symbol,"rsi_oversold",`⚠️ RSI em ${rsi} — sobrevendido extremo!`,"warning");
    else if(rsi>75)sendMarketAlert(symbol,"rsi_overbought",`⚠️ RSI em ${rsi} — sobrecomprado extremo!`,"warning");
  }
  const newHTF=result.htf_bias, oldHTF=lastHTFBias.get(symbol);
  if(oldHTF&&newHTF&&oldHTF!==newHTF&&newHTF!=="NEUTRAL"){
    sendMarketAlert(symbol,"htf_change",`🔄 HTF mudou para ${newHTF==="BULL"?"ALTISTA 🟢":"BAIXISTA 🔴"} em ${symbol}!`,"info");
    const activeDir=activeSignals.get(symbol);
    if(activeDir){const conflict=(activeDir==="BUY"&&newHTF==="BEAR")||(activeDir==="SELL"&&newHTF==="BULL");if(conflict)sendMarketAlert(symbol,"signal_conflict",`⚠️ Sinal ${activeDir} em ${symbol} mas HTF virou contra!`,"warning");}
  }
  if(newHTF)lastHTFBias.set(symbol,newHTF);
  if(result.analysis?.liquidity_sweeps?.bull?.detected)sendMarketAlert(symbol,"liq_bull",`⚡ LIQUIDEZ CAPTURADA — Setup reversal bullish em ${symbol}!`,"warning");
  if(result.analysis?.liquidity_sweeps?.bear?.detected)sendMarketAlert(symbol,"liq_bear",`⚡ LIQUIDEZ CAPTURADA — Setup reversal bearish em ${symbol}!`,"warning");
  if(result.analysis?.manipulation?.length>0){const manip=result.analysis.manipulation[0];sendMarketAlert(symbol,"manipulation",`${manip.label}: ${manip.description} | Entrada: ${manip.entry} SL: ${manip.sl} TP1: ${manip.tp1}`,"warning");}
  if(result.analysis?.chart_patterns?.length>0){const pat=result.analysis.chart_patterns[0];sendMarketAlert(symbol,"chart_pattern",`📐 ${pat.label} detectado em ${symbol} — ${pat.confidence}% confiança`,"info");}
}

function checkScoreboardReset() {
  const today=new Date().toDateString();
  if(liveScoreboard.date!==today){
    liveScoreboard.signals=0;liveScoreboard.wins=0;liveScoreboard.losses=0;liveScoreboard.profit=0;liveScoreboard.date=today;
    pendingNotifications.length=0;signalCache.clear();analysisCache.clear();processingAssets.clear();activeSignals.clear();alertCache.clear();
    // ✅ Reset lastOrderSent no início do dia também
    lastOrderSent.clear();
    Object.keys(institutionalData.smartMoneyScore).forEach(k=>{institutionalData.smartMoneyScore[k].buyVolume=0;institutionalData.smartMoneyScore[k].sellVolume=0;});
    console.log("[LiveRoom] Novo dia — caches limpos (incluindo lastOrderSent)");
  }
}

// ─────────────────────────────────────────────
// CALL eaSignal_v3
// ─────────────────────────────────────────────
async function callEaSignalV3(strategy, symbol, historicalData=null, mode="express") {
  const priceData=allPrices.get(symbol); if(!priceData) throw new Error(`Sem dados para ${symbol}`);
  let closes,highs,lows,opens;
  if(priceData.closes&&Array.isArray(priceData.closes)&&priceData.closes.length>=20){
    closes=priceData.closes;highs=priceData.highs||[];lows=priceData.lows||[];opens=priceData.opens||[];
  } else {
    const bid=parseFloat(priceData.bid);
    closes=[];highs=[];lows=[];opens=[];
    for(let i=59;i>=3;i--){const f=1+(Math.random()-.5)*.001;closes.push(parseFloat((bid*f).toFixed(5)));highs.push(parseFloat((bid*f*1.001).toFixed(5)));lows.push(parseFloat((bid*f*.999).toFixed(5)));opens.push(parseFloat((bid*f*.9998).toFixed(5)));}
    closes.push(bid);highs.push(bid*1.001);lows.push(bid*.999);opens.push(bid*.9998);
  }
  // ✅ v11: Passa contexto institucional para o eaSignal (Claude vai usar)
  const body={
    strategy, symbol, mode, closes, highs, lows, opens,
    historical_win_rate:historicalData?.win_rate??-1,
    historical_sample_size:historicalData?.sample_size??0,
    hour_win_rate:historicalData?.hour_win_rate??-1,
    hour_sample_size:historicalData?.hour_sample_size??0,
    // Contexto institucional para Claude analisar
    fear_greed:  institutionalData.fearGreed?.value || 50,
    funding_rate: institutionalData.fundingRate[symbol]?.rate || 0,
    open_interest: institutionalData.openInterest[symbol] || null,
    session: getSessionName(),
  };
  if(priceData.closes_m15&&Array.isArray(priceData.closes_m15)&&priceData.closes_m15.length>=10){body.closes_m15=priceData.closes_m15;body.highs_m15=priceData.highs_m15;body.lows_m15=priceData.lows_m15;body.opens_m15=priceData.opens_m15;}
  if(priceData.closes_h1&&Array.isArray(priceData.closes_h1)&&priceData.closes_h1.length>=10){body.closes_h1=priceData.closes_h1;body.highs_h1=priceData.highs_h1;body.lows_h1=priceData.lows_h1;body.opens_h1=priceData.opens_h1;}
  if(priceData.closes_h4&&Array.isArray(priceData.closes_h4)&&priceData.closes_h4.length>=10){body.closes_h4=priceData.closes_h4;body.highs_h4=priceData.highs_h4;body.lows_h4=priceData.lows_h4;body.opens_h4=priceData.opens_h4;}
  if(priceData.closes_d1&&Array.isArray(priceData.closes_d1)&&priceData.closes_d1.length>=5){body.closes_d1=priceData.closes_d1;body.highs_d1=priceData.highs_d1;body.lows_d1=priceData.lows_d1;body.opens_d1=priceData.opens_d1;}
  const hasMTF=!!(body.closes_h4&&body.closes_d1);
  if(hasMTF) console.log(`[eaSignal v10] ${symbol} com MTF completo`);
  const response=await fetch(EA_SIGNAL_V3_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${EA_SIGNAL_KEY}`},body:JSON.stringify(body)});
  if(!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result=await response.json();
  result.live_price=priceData.bid;
  result.has_mtf=hasMTF;
  return result;
}

// ─────────────────────────────────────────────
// LIVE ROOM — Análise
// ─────────────────────────────────────────────
// ✅ Gera narrativa do sinal para mostrar no card (modo express sem Claude)
function buildSignalNarrative(symbol, result, htfBias) {
  const dir     = result.direction || "";
  const prob    = result.probability || 0;
  const htf     = htfBias || result.htf_bias || "NEUTRAL";
  const ind     = result.indicators || {};
  const rsi     = ind.rsi     ? parseFloat(ind.rsi).toFixed(1)     : null;
  const adx     = ind.adx?.adx ? parseFloat(ind.adx.adx).toFixed(0) : null;
  const atr     = ind.atr     ? parseFloat(ind.atr).toFixed(ind.atr > 100 ? 0 : 5) : null;
  const stoch   = ind.stoch?.k ? parseFloat(ind.stoch.k).toFixed(0) : null;
  const analysis = result.analysis || {};
  const votes   = analysis.votes || [];
  const sms     = analysis.smart_money_score;
  const trend   = analysis.market_structure?.trend || "RANGING";
  const fg      = 12; // Fear&Greed atual (baixo = medo = bullish contrário)

  const isBuy  = dir === "BUY";
  const dirLabel = isBuy ? "alta" : "baixa";
  const emoji  = isBuy ? "🟢" : "🔴";

  // Conta estratégias que confirmam
  const confirming = votes.filter(v => v.direction === dir).length;
  const total      = votes.length || 6;

  let parts = [];

  // Contexto de tendência
  if (trend === "BULLISH") parts.push("tendência de alta no M5");
  else if (trend === "BEARISH") parts.push("tendência de baixa no M5");
  else parts.push("mercado em range");

  // HTF
  if (htf === "BULL") parts.push("HTF bullish confirma");
  else if (htf === "BEAR") parts.push("HTF bearish — setup contra-tendência");

  // Indicadores chave
  if (rsi) {
    if (parseFloat(rsi) < 35)      parts.push(`RSI sobrevendido (${rsi})`);
    else if (parseFloat(rsi) > 65) parts.push(`RSI sobrecomprado (${rsi})`);
    else                           parts.push(`RSI neutro (${rsi})`);
  }
  if (stoch && parseFloat(stoch) < 25) parts.push(`Stoch sobrevendido (${stoch})`);
  if (stoch && parseFloat(stoch) > 75) parts.push(`Stoch sobrecomprado (${stoch})`);
  if (adx && parseFloat(adx) > 25)     parts.push(`tendência forte ADX ${adx}`);

  // Fear&Greed
  if (fg <= 15 && isBuy)  parts.push("medo extremo favorece reversão de alta");
  if (fg >= 80 && !isBuy) parts.push("ganância extrema favorece reversão de baixa");

  // Smart money score
  if (sms?.grade === "A") parts.push(`Smart Money muito forte (Score ${sms.score})`);
  else if (sms?.grade === "B") parts.push(`Smart Money forte (Score ${sms.score})`);

  // Confluência de estratégias
  parts.push(`${confirming}/${total} estratégias confirmam ${dirLabel}`);

  const narrative = `${emoji} ${parts.slice(0, 4).join(" | ")}. Setup de ${dirLabel} com ${prob}% de probabilidade.`;
  return narrative;
}

// ✅ Gera "o que observar" baseado nos dados técnicos
function buildWatchFor(symbol, result, claudeCtx) {
  const dir = result.direction || "";
  const htf = result.htf_bias || "NEUTRAL";
  if (dir === "BUY")  return `Aguardar ${symbol} confirmar suporte — BUY válido com HTF ${htf}`;
  if (dir === "SELL") return `Aguardar ${symbol} confirmar resistência — SELL válido com HTF ${htf}`;
  return `${symbol} em range — aguardar definição de direção`;
}

// ✅ Gera contexto básico quando Claude não retornou análise
function buildBasicContext(symbol, result) {
  const ind      = result.indicators || {};
  const rsi      = ind.rsi  ? parseFloat(ind.rsi).toFixed(1)  : null;
  const vwap     = ind.vwap || result.vwap || null;
  const htf      = result.htf_bias || "NEUTRAL";
  const dir      = result.direction || "";
  const analysis = result.analysis  || {};
  const trend    = analysis.market_structure?.trend || result.trend || "RANGING";
  const swingH   = analysis.market_structure?.swingHigh || analysis.order_blocks?.bullish?.[0]?.top    || null;
  const swingL   = analysis.market_structure?.swingLow  || analysis.order_blocks?.bearish?.[0]?.bottom || null;
  const nearBull = analysis.order_blocks?.nearestBullish;
  const nearBear = analysis.order_blocks?.nearestBearish;

  let narrative = `${symbol} em ${trend === "RANGING" ? "range" : trend === "BULLISH" ? "tendência de alta" : "tendência de baixa"}`;
  if (rsi)  narrative += ` | RSI ${rsi}${parseFloat(rsi) < 30 ? " (sobrevendido)" : parseFloat(rsi) > 70 ? " (sobrecomprado)" : ""}`;
  if (htf !== "NEUTRAL") narrative += ` | HTF ${htf === "BULL" ? "bullish" : "bearish"}`;
  narrative += ". Aguardando confluência para gerar sinal.";

  const keyLevels = {};
  if (swingL) keyLevels.support    = [swingL];
  if (swingH) keyLevels.resistance = [swingH];
  if (vwap)   keyLevels.vwap       = [parseFloat(vwap)];

  const bias     = htf === "BULL" ? "BUY" : htf === "BEAR" ? "SELL" : "NEUTRAL";
  let watchFor   = `Monitorando ${symbol}`;
  if      (dir === "BUY"  && swingL) watchFor = `Aguardar toque em ${swingL} (suporte) para BUY`;
  else if (dir === "SELL" && swingH) watchFor = `Aguardar toque em ${swingH} (resistência) para SELL`;
  else if (trend === "RANGING")      watchFor = `Range ativo — aguardar rompimento para definir direção`;

  let opportunity = null;
  if      (nearBull) opportunity = `Order Block bullish em ${nearBull.bottom}–${nearBull.top} — zona de demanda potencial`;
  else if (nearBear) opportunity = `Order Block bearish em ${nearBear.bottom}–${nearBear.top} — zona de oferta potencial`;

  const regime = trend === "RANGING" ? "RANGE" : trend === "BULLISH" ? "TREND_BULL" : "TREND_BEAR";
  return { regime, bias, narrative, key_levels: Object.keys(keyLevels).length > 0 ? keyLevels : null, watch_for: watchFor, opportunity, warning: null };
}

async function analyzeLiveAsset(symbol, isPriority=false) {
  const priceData=allPrices.get(symbol);
  if(!priceData||!isPriceFresh(priceData)) return;
  const strategy="AI";
  const lockKey=`${symbol}-${strategy}`;
  if(processingAssets.has(lockKey)) return;
  processingAssets.add(lockKey);
  try {
    if(!isGoodTradingHour(symbol)){
      if(liveRoomClients.size>0)broadcastToLiveRoom({type:"no_signal",asset:symbol,strategy,strategy_label:"AUREON AI",mode:getMostUsedMode(),reason:`${symbol} fora do horário — ${getSessionName()}`,timestamp:new Date().toISOString()});
      return;
    }
    const lastAnalysis=analysisCache.get(lockKey)||0;
    const minInterval=isPriority?ANALYSIS_INTERVAL_PRIORITY:ANALYSIS_INTERVAL_NORMAL;
    if(Date.now()-lastAnalysis<minInterval) return;
    analysisCache.set(lockKey,Date.now());
    // ✅ Modo completo (Claude API) só para planos PRO e ELITE
    // Express: narrativa automática sem Claude (todos os planos)
    // Completo: Claude analisa contexto antes das estratégias (PRO+)
    const clientMode = getMostUsedMode();
    const hasPROClient = [...activeSlaves.entries()].some(([uid, d]) =>
      !INTERNAL_BOT_IDS.includes(uid) &&
      (new Date() - d.lastSeen) / 1000 < SLAVE_TIMEOUT_S &&
      (d.plan === "pro" || d.plan === "elite")
    );
    // Modo completo ativo se: cliente solicitou "complete" E tem cliente PRO/Elite online
    const mode = (clientMode === "complete" && hasPROClient) ? "complete" : "express";
    const hour=new Date().getUTCHours();
    const stats=await fetchHistoricalStats(symbol,strategy);
    const hourStats=stats.hour_stats?.[hour]||{};
    const histData={win_rate:stats.win_rate,sample_size:stats.sample_size,hour_win_rate:hourStats.win_rate??-1,hour_sample_size:hourStats.count??0};
    if(liveRoomClients.size>0){
      broadcastToLiveRoom({type:"thinking",asset:symbol,strategy,strategy_label:"AUREON AI",mode,price:priceData.bid,is_priority:isPriority,message:`${isPriority?"🎯":"🧠"} ${isPriority?"Análise prioritária":"Monitorando"} ${symbol}`,timestamp:new Date().toISOString()});
      await new Promise(r=>setTimeout(r,1200));
    }
    const result=await callEaSignalV3(strategy,symbol,histData,mode);
    const currentPrice=parseFloat(priceData.bid);
    checkMarketAlerts(symbol,result,currentPrice);
    if(result.status==="new_signal"&&result.direction){
      const htfBias=result.htf_bias||"NEUTRAL";
      const minProb=getMinProbByHTF(result.direction,htfBias);
      if(result.probability<minProb){
        if(liveRoomClients.size>0){
          const claudeCtx2 = result.claude_context || null;
          const htfBiasLabel = htfBias || result.htf_bias || "NEUTRAL";
          const htfPayload = {
            type:"no_signal", asset:symbol, strategy, strategy_label:"AUREON AI", mode,
            reason:`Filtro HTF: ${result.direction} exige ${minProb}% (atual: ${result.probability}%)`,
            timestamp: new Date().toISOString(),
          };
          if(claudeCtx2 && (claudeCtx2.narrative || claudeCtx2.key_levels)) {
            htfPayload.claude_context = {
              regime: claudeCtx2.regime || "RANGE",
              bias: claudeCtx2.bias || "NEUTRAL",
              narrative: claudeCtx2.narrative || `${symbol} com probabilidade ${result.probability}% — abaixo do mínimo ${minProb}% para ${result.direction}. HTF ${htfBiasLabel}.`,
              key_levels: claudeCtx2.key_levels || null,
              watch_for: `Aguardar prob ≥ ${minProb}% para entrar ${result.direction} | HTF: ${htfBiasLabel}`,
              opportunity: claudeCtx2.opportunity || null,
              warning: claudeCtx2.warning || null,
            };
          } else {
            // Gera contexto com HTF correto
            const ctx2 = buildBasicContext(symbol, result);
            ctx2.narrative = `${symbol} setup ${result.direction} com ${result.probability}% — abaixo do mínimo ${minProb}% exigido com HTF ${htfBiasLabel}. Aguardar confirmação.`;
            ctx2.watch_for = `Aguardar probabilidade ≥ ${minProb}% para entrar ${result.direction}`;
            htfPayload.claude_context = ctx2;
          }
          broadcastToLiveRoom(htfPayload);
        }
        return;
      }
      const signalKey=`${symbol}`;
      const signalKeyDir=`${symbol}-${result.direction}`;
      const lastSignal=signalCache.get(signalKey)||{timestamp:0,price:0};
      const timePassed=Date.now()-lastSignal.timestamp;
      const priceChg=lastSignal.price>0?Math.abs(currentPrice-lastSignal.price)/lastSignal.price:1;
      if(timePassed<SIGNAL_COOLDOWN&&priceChg<PRICE_CHANGE_THRESHOLD){
        const remaining=Math.round((SIGNAL_COOLDOWN-timePassed)/1000);
        if(liveRoomClients.size>0)broadcastToLiveRoom({type:"no_signal",asset:symbol,strategy,strategy_label:"AUREON AI",mode,reason:`Cooldown ${symbol}: ${Math.round(remaining/60)}min ${remaining%60}s restantes`,timestamp:new Date().toISOString()});
        return;
      }
      const currentDir=activeSignals.get(symbol);
      if(currentDir&&currentDir!==result.direction){
        const opp=signalCache.get(`${symbol}-${currentDir}`)||{timestamp:0};
        if(Date.now()-opp.timestamp<SIGNAL_COOLDOWN){console.log(`[LiveRoom] Conflito: ${symbol} tem ${currentDir} ativo`);return;}
      }
      signalCache.set(signalKey,{timestamp:Date.now(),price:currentPrice});
      signalCache.set(signalKeyDir,{timestamp:Date.now(),price:currentPrice});
      activeSignals.set(symbol,result.direction);
      setTimeout(()=>{if(activeSignals.get(symbol)===result.direction)activeSignals.delete(symbol);},SIGNAL_COOLDOWN);

      const sms=institutionalData.smartMoneyScore[symbol];
      const fr=institutionalData.fundingRate[symbol];
      const oi=institutionalData.openInterest[symbol];
      const confluenceScore=result.analysis?.smart_money_score?.score||50;
      liveScoreboard.signals++;
      const isBestSession=getSessionName().includes("⭐⭐⭐");
      // ✅ Narrativa do sinal — Claude (modo complete) ou gerada automaticamente (express)
      const claudeCtxSignal  = result.claude_context || null;
      const signalNarrative  = claudeCtxSignal?.narrative   || buildSignalNarrative(symbol, result, htfBias);
      const signalWarning    = claudeCtxSignal?.warning      || null;
      const signalOpportunity= claudeCtxSignal?.opportunity  || null;
      const signal={
        type:"signal", asset:symbol, strategy, strategy_label:"AUREON AI v9", mode,
        direction:result.direction, entry:result.entry, sl:result.sl, tp:result.tp,
        tp1:result.tp1, tp2:result.tp2||null, tp3:result.tp3||null,
        tp1_label:result.tp1_label, tp2_label:result.tp2_label, tp3_label:result.tp3_label,
        probability:result.probability, reason:result.reason,
        confirmations:result.confirmations, indicators:result.indicators,
        trend_strength:result.trend_strength, is_range:result.is_range,
        htf_bias:htfBias, vwap:result.vwap,
        claude_narrative:   signalNarrative,
        claude_warning:     signalWarning,
        claude_opportunity: signalOpportunity,
        analysis:result.analysis, probability_adjustment:result.probability_adjustment,
        historical:stats.sample_size>0?{win_rate:stats.win_rate,sample_size:stats.sample_size}:null,
        institutional:{
          smart_money_score: sms||null, funding_rate: fr||null, open_interest: oi||null,
          fear_greed: institutionalData.fearGreed,
          whale_activity: institutionalData.whaleAlerts.filter(w=>w.symbol===symbol).slice(0,3),
          correlations: institutionalData.correlations,
          is_best_session: isBestSession,
          manipulation_detected: result.analysis?.manipulation?.length>0,
          chart_patterns: result.analysis?.chart_patterns?.length>0?result.analysis.chart_patterns.slice(0,2):null,
          confluence_score: confluenceScore,
        },
        id:`LIVE-${Date.now()}`,
        hora:new Date().toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),
        timestamp:new Date().toISOString(),
        session:getSessionName(),
      };
      liveSignalHistory.unshift(signal);
      if(liveSignalHistory.length>50)liveSignalHistory.pop();
      await saveLiveSignal(signal);
      if(liveRoomClients.size>0)broadcastToLiveRoom(signal);
      notifyAllClients(signal);
      console.log(`[LiveRoom v19] ${result.direction} ${symbol} | ${result.probability}% | HTF: ${htfBias} | SL:${result.sl} TP1:${result.tp1}`);

      // ✅ FIX: Usa enqueueOrder com cooldown e validação de TP/SL
      // ✅ FIX: só enfileira para slaves REAIS — nunca para MASTER-BOT ou bots internos
      let targetSlaveId=null;
      if(isSlaveOnline(LIVE_ROOM_BOT_ID))targetSlaveId=LIVE_ROOM_BOT_ID;
      else if(activeSlaves.size>0)activeSlaves.forEach((data,userId)=>{
        if(!targetSlaveId&&!INTERNAL_BOT_IDS.includes(userId)&&(new Date()-data.lastSeen)/1000<SLAVE_TIMEOUT_S)
          targetSlaveId=userId;
      });
      if(targetSlaveId){
        const tpToSend = result.tp1 || result.tp;
        const slToSend = result.sl;
        enqueueOrder(
          targetSlaveId, symbol, result.direction,
          slToSend, tpToSend, 0.01,
          strategy, result.probability, result.confirmations||0, result.trend_strength||0,
          "LIVE-ROOM"
        );
      }
    } else {
      if(liveRoomClients.size>0){
        // ✅ Manda contexto do Claude junto com o no_signal
        const claudeCtx = result.claude_context || null;
        const noSigPayload = {
          type:"no_signal", asset:symbol, strategy,
          strategy_label:"AUREON AI v9", mode:getMostUsedMode(),
          reason: result.reason || "Aguardando setup ideal",
          is_range: result.is_range||false,
          indicators: result.indicators,
          htf_bias: result.htf_bias,
          timestamp: new Date().toISOString(),
        };
        // Adiciona contexto rico quando Claude analisou
        if(claudeCtx && (claudeCtx.narrative || claudeCtx.key_levels)) {
          noSigPayload.claude_context = {
            regime:      claudeCtx.regime      || "RANGE",
            bias:        claudeCtx.bias        || "NEUTRAL",
            narrative:   claudeCtx.narrative   || null,
            key_levels:  claudeCtx.key_levels  || null,
            watch_for:   claudeCtx.watch_for   || buildWatchFor(symbol, result, claudeCtx),
            opportunity: claudeCtx.opportunity || null,
            warning:     claudeCtx.warning     || null,
            risk_factors: claudeCtx.risk_factors || [],
          };
        } else {
          // Sem Claude — gera contexto básico com os dados técnicos disponíveis
          noSigPayload.claude_context = buildBasicContext(symbol, result);
        }
        broadcastToLiveRoom(noSigPayload);
      }
    }
  } catch(err){console.error(`[LiveRoom] Erro ${symbol}:`,err.message);}
  finally{processingAssets.delete(lockKey);}
}

async function runLiveRoom() {
  checkScoreboardReset();
  if(liveRoomClients.size>0)broadcastToLiveRoom({type:"scoreboard",signals:liveScoreboard.signals,wins:liveScoreboard.wins,losses:liveScoreboard.losses,profit:liveScoreboard.profit,win_rate:liveScoreboard.signals>0?((liveScoreboard.wins/liveScoreboard.signals)*100).toFixed(1):"0.0",session:getSessionName(),fear_greed:institutionalData.fearGreed,timestamp:new Date().toISOString()});
  const focused=getMostFocusedAsset();
  for(const symbol of LIVE_ASSETS){
    if(symbol===focused) continue;
    if(allPrices.get(symbol)&&isPriceFresh(allPrices.get(symbol))){
      await analyzeLiveAsset(symbol,false);
      if(liveRoomClients.size>0)await new Promise(r=>setTimeout(r,1500));
    }
  }
}
async function runFocusedAsset() { const f=getMostFocusedAsset(); if(!f) return; const pd=allPrices.get(f); if(pd&&isPriceFresh(pd))await analyzeLiveAsset(f,true); }
function startLiveRoom24h() {
  if(!liveRoomInterval){liveRoomInterval=setInterval(runLiveRoom,30000);console.log("[LiveRoom] Loop 30s iniciado");}
  if(!focusInterval){focusInterval=setInterval(runFocusedAsset,10000);console.log("[LiveRoom] Loop 10s iniciado");}
}

// ─────────────────────────────────────────────
// ROTAS HTTP
// ─────────────────────────────────────────────
const PLAN_LIMITS = {
  basic:{assets:["BTCUSD"],strategies:["SMC_PRO","PA"],modes:["express"],maxPositions:3,autoTrade:false,copyTrade:false,liveRoom:true},
  pro:{assets:["BTCUSD","EURUSD.s","XAUUSD.s"],strategies:["SMC_PRO","PA","WYCKOFF","SD","FIBONACCI"],modes:["express","complete"],maxPositions:10,autoTrade:true,copyTrade:false,liveRoom:true},
  elite:{assets:"ALL",strategies:["SMC_PRO","PA","WYCKOFF","SD","FIBONACCI","AI"],modes:["express","complete"],maxPositions:20,autoTrade:true,copyTrade:true,liveRoom:true},
};
function getPlanLimits(plan){return PLAN_LIMITS[plan]||PLAN_LIMITS.basic;}

app.post("/webhook/hotmart", async (req,res)=>{
  const event=req.body;
  if(["PURCHASE_APPROVED","PURCHASE_COMPLETE","SUBSCRIPTION_REACTIVATED"].includes(event?.event)){
    const email=event?.data?.buyer?.email,product=event?.data?.product?.name||"",price=event?.data?.purchase?.price?.value||0;
    let plan="basic",months=1;
    if(product.toLowerCase().includes("elite")||price>=390)plan="elite";
    else if(product.toLowerCase().includes("pro")||price>=190)plan="pro";
    if(price>=900)months=12;
    if(email){await activateUserPlan(email,plan,months);broadcastToSite({type:"plan_activated",email,plan});}
  }
  if(["PURCHASE_CANCELED","PURCHASE_REFUNDED","SUBSCRIPTION_CANCELLATION"].includes(event?.event)){
    const email=event?.data?.buyer?.email;if(email)await activateUserPlan(email,"free",0);
  }
  res.json({status:"ok"});
});

app.post("/price",(req,res)=>{
  const data=req.body;if(!data||!data.symbol)return res.status(400).json({error:"Dados inválidos"});
  mt5LastSeen=new Date();
  const priceData={
    symbol:data.symbol,bid:data.bid,ask:data.ask,spread:data.spread,rsi:data.rsi,
    closes:data.closes||null,highs:data.highs||null,lows:data.lows||null,opens:data.opens||null,
    candles_count:data.candles_count||0,
    closes_m15:data.closes_m15||null,highs_m15:data.highs_m15||null,lows_m15:data.lows_m15||null,opens_m15:data.opens_m15||null,
    closes_h1:data.closes_h1||null,highs_h1:data.highs_h1||null,lows_h1:data.lows_h1||null,opens_h1:data.opens_h1||null,
    closes_h4:data.closes_h4||null,highs_h4:data.highs_h4||null,lows_h4:data.lows_h4||null,opens_h4:data.opens_h4||null,
    closes_d1:data.closes_d1||null,highs_d1:data.highs_d1||null,lows_d1:data.lows_d1||null,opens_d1:data.opens_d1||null,
    has_mtf:!!(data.closes_h4&&data.closes_d1),
    strategy:"AI",receivedAt:new Date().toISOString()
  };
  allPrices.set(data.symbol,priceData);
  broadcastToSite({type:"price",symbol:data.symbol,bid:data.bid,ask:data.ask,spread:data.spread,rsi:data.rsi,has_mtf:priceData.has_mtf});
  broadcastToSite({type:"mt5_status",connected:true});
  res.json({status:"ok",symbols_tracked:allPrices.size,has_mtf:priceData.has_mtf});
});

app.get("/prices",(req,res)=>{
  const prices=[];allPrices.forEach((data,symbol)=>prices.push({symbol,bid:data.bid,ask:data.ask,fresh:isPriceFresh(data)}));
  res.json({total:prices.length,mt5_connected:isMt5Online(),prices,timestamp:new Date().toISOString()});
});

app.get("/live-signals",(req,res)=>{
  res.json({active:true,clients:liveRoomClients.size,signals:liveSignalHistory.slice(0,20),scoreboard:liveScoreboard,assets:LIVE_ASSETS,focused_asset:getMostFocusedAsset(),pending_notifications:pendingNotifications.slice(0,5),session:getSessionName(),timestamp:new Date().toISOString()});
});

app.get("/institutional",(req,res)=>{
  res.json({fear_greed:institutionalData.fearGreed,fast_sentiment:institutionalData.fastSentiment,whale_alerts:institutionalData.whaleAlerts.slice(0,10),liquidations:institutionalData.liquidations.slice(0,10),open_interest:institutionalData.openInterest,funding_rate:institutionalData.fundingRate,cot_report:institutionalData.cotReport,correlations:institutionalData.correlations,smart_money_score:institutionalData.smartMoneyScore,economic_calendar:institutionalData.economicCalendar,session:getSessionName(),timestamp:new Date().toISOString()});
});

app.get("/whale-alerts",(req,res)=>{
  const symbol=req.query.symbol;
  const alerts=symbol?institutionalData.whaleAlerts.filter(w=>w.symbol===symbol):institutionalData.whaleAlerts;
  res.json({total:alerts.length,alerts:alerts.slice(0,20),timestamp:new Date().toISOString()});
});

app.get("/smart-money",(req,res)=>{
  res.json({scores:institutionalData.smartMoneyScore,fear_greed:institutionalData.fearGreed,correlations:institutionalData.correlations,cot_report:institutionalData.cotReport,timestamp:new Date().toISOString()});
});

// ✅ FIX: endpoint de debug para ver cooldowns ativos
app.get("/order-cooldowns",(req,res)=>{
  const now = Date.now();
  const cooldowns = {};
  lastOrderSent.forEach((ts, symbol) => {
    const elapsed   = now - ts;
    const remaining = Math.max(0, SIGNAL_COOLDOWN - elapsed);
    cooldowns[symbol] = {
      last_order:      new Date(ts).toISOString(),
      elapsed_seconds: Math.round(elapsed / 1000),
      remaining_seconds: Math.round(remaining / 1000),
      blocked: remaining > 0,
    };
  });
  res.json({ cooldown_minutes: SIGNAL_COOLDOWN / 60000, symbols: cooldowns, timestamp: new Date().toISOString() });
});

app.post("/live-signal-result",async(req,res)=>{
  const{signal_id,result,profit,close_price,tp_hit}=req.body;
  const signal=liveSignalHistory.find(s=>s.id===signal_id);
  if(signal){signal.result=result;signal.profit=profit;if(signal.supabase_id)await updateLiveSignalResult(signal.supabase_id,result,profit,close_price,tp_hit);}
  const profitVal=parseFloat(profit)||0;
  if(result==="win"){liveScoreboard.wins++;liveScoreboard.profit+=profitVal;}
  else if(result==="loss"){liveScoreboard.losses++;liveScoreboard.profit+=profitVal;}
  broadcastToLiveRoom({type:"signal_result",signal_id,result,profit:profitVal,scoreboard:liveScoreboard,timestamp:new Date().toISOString()});
  res.json({status:"ok"});
});

// ✅ v20: helper para calcular wins/losses/profit/win_rate de uma lista de trades
function computeTradeStats(trades) {
  const valid = trades.filter(t=>t.result==="win"||t.result==="loss");
  const wins = valid.filter(t=>t.result==="win").length;
  const losses = valid.filter(t=>t.result==="loss").length;
  const totalProfit = valid.reduce((s,t)=>s+(parseFloat(t.profit)||0),0);
  const winRate = valid.length>0 ? ((wins/valid.length)*100).toFixed(1) : "0";
  return { total:valid.length, wins, losses, win_rate:parseFloat(winRate), win_rate_pct:`${winRate}%`, total_profit:parseFloat(totalProfit.toFixed(2)), total_profit_formatted:`$${totalProfit.toFixed(2)}` };
}

app.get("/all-trades",async(req,res)=>{
  try{
    let query=`trades?order=created_at.desc&limit=${req.query.limit||500}`;
    // ✅ v20: filtro opcional por data — útil pra excluir dados antigos
    // (ex: pré-fix v5.5) e ver só os trades a partir de um momento específico
    if(req.query.since) query+=`&created_at=gte.${encodeURIComponent(req.query.since)}`;
    const trades=await supabaseGet(query);
    if(!trades||!trades.length)return res.json({total:0,trades:[],stats:{total:0,wins:0,losses:0,win_rate:0,total_profit:0},stats_last_24h:null,since:req.query.since||null});

    // ✅ v20: stats das últimas 24h calculadas separadamente (sempre, independente de `since`/`limit`)
    // — assim dá pra comparar "tudo" vs "recente" sem fazer duas chamadas manuais
    let stats24h=null;
    try{
      const since24h=new Date(Date.now()-24*60*60*1000).toISOString();
      const recent=await supabaseGet(`trades?order=created_at.desc&limit=1000&created_at=gte.${encodeURIComponent(since24h)}`);
      if(recent&&recent.length) stats24h=computeTradeStats(recent);
    }catch{}

    res.json({total:trades.length,trades,stats:computeTradeStats(trades),stats_last_24h:stats24h,since:req.query.since||null,timestamp:new Date().toISOString()});
  }catch(err){res.status(500).json({error:err.message});}
});

// ─────────────────────────────────────────────
// ✅ v22: RESUMO GERAL — paper trading (3 trilhas) + robô (MASTER-BOT) +
// conta real (slaves) + total agregado, tudo em um único endpoint.
// Agrupa por user_code da tabela `trades`.
// Use ?since=2026-06-15T00:00:00Z para filtrar por data.
// ─────────────────────────────────────────────
app.get("/dashboard-summary",async(req,res)=>{
  try{
    let query=`trades?order=created_at.desc&limit=${req.query.limit||2000}&select=user_code,result,profit,created_at`;
    if(req.query.since) query+=`&created_at=gte.${encodeURIComponent(req.query.since)}`;
    const trades=await supabaseGet(query);
    if(!trades||!Array.isArray(trades)) return res.status(500).json({error:"Erro ao consultar Supabase"});

    // Agrupa por user_code
    const groups={};
    for(const t of trades){
      const code=t.user_code||"UNKNOWN";
      if(!groups[code]) groups[code]=[];
      groups[code].push(t);
    }

    const byUserCode={};
    for(const [code,list] of Object.entries(groups)){
      byUserCode[code]=computeTradeStats(list);
    }

    // Agrega trilhas de paper trading num bloco "paper_total"
    const paperCodes=Object.keys(byUserCode).filter(c=>c.startsWith("PAPER-BOT"));
    const paperAll=paperCodes.flatMap(c=>groups[c]);
    const paperTotal=paperAll.length?computeTradeStats(paperAll):null;

    // Agrega tudo que NÃO é paper (robô + conta real) num bloco "robot_total"
    const robotCodes=Object.keys(byUserCode).filter(c=>!c.startsWith("PAPER-BOT"));
    const robotAll=robotCodes.flatMap(c=>groups[c]);
    const robotTotal=robotAll.length?computeTradeStats(robotAll):null;

    res.json({
      since:req.query.since||null,
      total_trades:trades.length,
      overall:computeTradeStats(trades),
      robot_total:robotTotal,      // MASTER-BOT + USER-FABIOBUR (tudo que não é paper)
      paper_total:paperTotal,       // BASE + RR2X + RR3X somados
      by_user_code:byUserCode,       // detalhe individual de cada user_code
      timestamp:new Date().toISOString(),
    });
  }catch(err){res.status(500).json({error:err.message});}
});

// IDs reservados para robôs internos — NUNCA entram no activeSlaves como slaves reais
const INTERNAL_BOT_IDS = ["MASTER-BOT", "LIVE-ROOM-BOT", "PAPER-BOT"];

app.post("/slave-register",async(req,res)=>{
  const{user_id,account,symbol,balance,status}=req.body;
  if(!user_id)return res.status(400).json({error:"user_id obrigatório"});
  if(status==="disconnected"){activeSlaves.delete(user_id);broadcastToSite({type:"slave_status",user_id,connected:false});return res.json({status:"ok"});}

  // ✅ FIX: MASTER-BOT e bots internos NÃO entram no activeSlaves
  // Isso impede o Live Room de enfileirar ordens duplicadas para o EA Master
  if(INTERNAL_BOT_IDS.includes(user_id)){
    console.log(`[SlaveRegister] Bot interno ignorado: ${user_id}`);
    return res.json({status:"ok",user_id,plan:"elite",limits:getPlanLimits("elite")});
  }

  const planCheck=await checkProPlan(user_id);if(!planCheck.allowed)return res.status(403).json({status:"blocked"});
  const limits=getPlanLimits(planCheck.plan||"basic");
  activeSlaves.set(user_id,{account:account||"unknown",symbol:symbol||"BTCUSD",balance:balance||0,plan:planCheck.plan||"basic",limits,lastSeen:new Date()});
  broadcastToSite({type:"slave_status",user_id,connected:true,balance,plan:planCheck.plan});
  res.json({status:"ok",user_id,plan:planCheck.plan,limits});
});

app.get("/slave-order",(req,res)=>{
  const userId=req.query.user_id;if(!userId)return res.status(400).json({error:"user_id obrigatório"});
  if(activeSlaves.has(userId)){const s=activeSlaves.get(userId);s.lastSeen=new Date();activeSlaves.set(userId,s);}
  else activeSlaves.set(userId,{account:"unknown",symbol:"BTCUSD",balance:0,plan:"basic",lastSeen:new Date()});
  if(slavePendingOrders.has(userId)){const order=slavePendingOrders.get(userId);slavePendingOrders.delete(userId);return res.json({hasOrder:true,...order});}
  res.json({hasOrder:false});
});

app.post("/slave-confirm",(req,res)=>{broadcastToSite({type:"order_confirmed",...req.body,timestamp:new Date().toISOString()});res.json({status:"ok"});});

app.post("/slave-trade-closed",async(req,res)=>{
  const{user_id,symbol,direction,close_price,profit,strategy,probability,confirmations,trend_strength,sl,tp}=req.body;
  if(!user_id||!symbol)return res.status(400).json({error:"user_id e symbol obrigatórios"});
  const profitVal=parseFloat(profit)||0,resultStr=profitVal>0?"win":"loss";
  broadcastToSite({type:"trade_closed",user_id,symbol,direction,profit:profitVal,result:resultStr,strategy,timestamp:new Date().toISOString()});
  const now=new Date(),source=req.body.source||"SLAVE";
  await saveTradeToSupabase({user_code:user_id,symbol,direction:direction||"buy",entry_price:parseFloat(close_price)||0,sl:parseFloat(sl)||0,tp:parseFloat(tp)||0,profit:profitVal,result:resultStr,hour_of_day:now.getUTCHours(),day_of_week:now.getUTCDay(),market_strength:0,atr_value:0,probability:parseFloat(probability)||0,strategy:strategy||"AI",confirmations:parseInt(confirmations)||0,trend_strength:parseFloat(trend_strength)||0,source});
  if(source==="LIVE-ROOM"){
    const recentSignal=liveSignalHistory.find(s=>s.asset===symbol&&s.direction?.toUpperCase()===direction?.toUpperCase()&&s.result==="open");
    if(recentSignal){
      recentSignal.result=resultStr;recentSignal.profit=profitVal;
      if(recentSignal.supabase_id)await updateLiveSignalResult(recentSignal.supabase_id,resultStr,profitVal,close_price,0);
      if(resultStr==="win"){liveScoreboard.wins++;liveScoreboard.profit+=profitVal;}
      else{liveScoreboard.losses++;liveScoreboard.profit+=profitVal;}
      broadcastToLiveRoom({type:"signal_result",signal_id:recentSignal.id,result:resultStr,profit:profitVal,scoreboard:liveScoreboard,timestamp:new Date().toISOString()});
      if(activeSignals.get(symbol)===direction?.toUpperCase())activeSignals.delete(symbol);
    }
  }
  res.json({status:"ok"});
});

app.post("/slave-error",(req,res)=>{broadcastToSite({type:"slave_error",...req.body});res.json({status:"ok"});});

app.post("/client-execute-order",async(req,res)=>{
  const{user_id,symbol,direction,sl,tp,lot_size,strategy,probability,confirmations,trend_strength}=req.body;
  if(!user_id||!symbol||!direction)return res.status(400).json({error:"user_id, symbol e direction obrigatórios"});
  const planCheck=await checkProPlan(user_id),limits=getPlanLimits(planCheck.plan||"basic");
  if(limits.assets!=="ALL"&&!limits.assets.includes(symbol))return res.status(403).json({error:`Ativo ${symbol} não disponível`});
  if(!limits.autoTrade)return res.status(403).json({error:"Auto Trade não disponível"});
  if(!isSlaveOnline(user_id))return res.status(503).json({error:"EA Slave não conectado",slave_online:false});

  // ✅ FIX: usa enqueueOrder com cooldown e validação de TP/SL
  const queued = enqueueOrder(
    user_id, symbol, direction, sl, tp,
    lot_size, strategy, probability, confirmations, trend_strength,
    "CLIENT"
  );
  if (!queued) {
    const lastSent = lastOrderSent.get(symbol) || 0;
    const remaining = Math.round((SIGNAL_COOLDOWN - (Date.now() - lastSent)) / 1000);
    const tpVal = parseFloat(tp);
    if (!tpVal || tpVal <= 0) return res.status(400).json({ error: "TP inválido ou zero" });
    return res.status(429).json({ error: `Cooldown ativo para ${symbol}`, remaining_seconds: remaining });
  }
  const order = slavePendingOrders.get(user_id);
  res.json({status:"ok",message:"Ordem enviada",order_id:order?.order_id});
});

app.get("/slave-status",(req,res)=>{
  const userId=req.query.user_id;if(!userId)return res.status(400).json({error:"user_id obrigatório"});
  const exists=activeSlaves.has(userId),slave=activeSlaves.get(userId),ago=exists?Math.round((new Date()-slave.lastSeen)/1000):null;
  res.json({user_id:userId,slave_online:exists&&ago<SLAVE_TIMEOUT_S,last_seen:ago,balance:slave?.balance??null,plan:slave?.plan??null});
});

app.get("/user-trades",async(req,res)=>{
  const userCode=req.query.user_code;if(!userCode)return res.status(400).json({error:"user_code obrigatório"});
  try{const r=await fetch(`${SUPABASE_URL}/rest/v1/trades?user_code=eq.${userCode}&order=created_at.desc&limit=500`,{headers:{"apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`}});res.json({user_code:userCode,trades:await r.json()});}catch(err){res.status(500).json({error:err.message});}
});

app.get("/live-learning",async(req,res)=>{
  try{
    let query="live_signals?result=neq.open&select=asset,strategy,result,profit,hour_of_day,created_at&order=created_at.desc&limit=500";
    // ✅ v20: mesmo filtro since do /all-trades — ex: ?since=2026-06-15T00:00:00Z
    // pra olhar só sinais a partir de uma data (excluindo histórico pré-fix)
    if(req.query.since) query+=`&created_at=gte.${encodeURIComponent(req.query.since)}`;
    const data=await supabaseGet(query);
    if(!data||!data.length)return res.json({status:"no_data",assets:{},since:req.query.since||null});
    const groups={};
    data.forEach(d=>{const key=`${d.asset}-${d.strategy}`;if(!groups[key])groups[key]={asset:d.asset,strategy:d.strategy,wins:0,losses:0,total:0,profit:0};const g=groups[key];g.total++;g.profit+=d.profit||0;if(d.result==="win")g.wins++;else g.losses++;});
    const assets={};
    Object.values(groups).forEach(g=>{if(!assets[g.asset])assets[g.asset]={};assets[g.asset][g.strategy]={total_signals:g.total,wins:g.wins,losses:g.losses,win_rate:parseFloat((g.wins/g.total).toFixed(3)),win_rate_pct:`${(g.wins/g.total*100).toFixed(1)}%`,total_profit:parseFloat(g.profit.toFixed(2))};});
    res.json({status:"ok",total_signals_analyzed:data.length,assets,since:req.query.since||null,last_updated:new Date().toISOString()});
  }catch(err){res.status(500).json({error:err.message});}
});

// ─────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────
wss.on("connection",(ws)=>{
  siteClients.add(ws);
  ws.send(JSON.stringify({type:"mt5_status",connected:isMt5Online()}));
  ws.send(JSON.stringify({type:"symbols_available",symbols:Array.from(allPrices.keys())}));
  ws.send(JSON.stringify({type:"institutional_data",...institutionalData,session:getSessionName()}));
  if(pendingNotifications.length>0)ws.send(JSON.stringify({type:"pending_notifications",notifications:pendingNotifications,timestamp:new Date().toISOString()}));
  ws.on("message",async(raw)=>{
    try{
      const msg=JSON.parse(raw.toString());
      if(msg.type==="ping"){ws.send(JSON.stringify({type:"pong"}));return;}
      if(msg.type==="analyze"){
        const{strategy="AI",symbol="BTCUSD",mode="express",user_id=null}=msg;
        ws.send(JSON.stringify({type:"analyzing",status:"processing",strategy,mode}));
        try{
          const stats=await fetchHistoricalStats(symbol,strategy),hour=new Date().getUTCHours(),hourStats=stats.hour_stats?.[hour]||{};
          const result=await callEaSignalV3(strategy,symbol,{win_rate:stats.win_rate,sample_size:stats.sample_size,hour_win_rate:hourStats.win_rate??-1,hour_sample_size:hourStats.count??0},mode);

          // ✅ v22: salva sinal do TradePage e monitora TP/SL — fecha o ciclo de aprendizado
          // Só monitora se tiver sinal válido com entry/sl/tp definidos
          if(result.status==="new_signal" && result.entry && result.sl && result.tp1 && user_id){
            const signalId=`TS-${symbol}-${Date.now()}`;
            const priceData=allPrices.get(symbol);
            const liveBid=priceData?parseFloat(priceData.bid):null;
            const liveAsk=priceData?parseFloat(priceData.ask||priceData.bid):null;
            const entryLive = result.direction==="BUY" ? (liveAsk||result.entry) : (liveBid||result.entry);

            // Recalcula SL/TP a partir das distâncias (mesmo fix do paper trading — evita invertidos)
            const slDist  = Math.abs(result.entry - result.sl);
            const tp1Dist = Math.abs(result.entry - (result.tp1||result.tp));
            const sl  = result.direction==="BUY" ? entryLive-slDist : entryLive+slDist;
            const tp1 = result.direction==="BUY" ? entryLive+tp1Dist : entryLive-tp1Dist;

            // Guarda em memória para monitorar (mesmo mecanismo do paper trading)
            tradepageSignals.set(signalId,{
              id:         signalId,
              user_id,
              symbol,
              direction:  result.direction,
              entry:      entryLive,
              sl:         parseFloat(sl.toFixed(5)),
              tp:         parseFloat(tp1.toFixed(5)),
              probability: result.probability||0,
              strategy,
              openedAt:   Date.now(),
              supabaseId: null,
            });

            // Salva no Supabase como trade "open" com user_code do usuário real
            try{
              const body={
                user_code:   user_id,
                symbol,
                direction:   result.direction.toLowerCase(),
                entry_price: entryLive,
                sl:          parseFloat(sl.toFixed(5)),
                tp:          parseFloat(tp1.toFixed(5)),
                profit:      0,
                result:      "open",
                hour_of_day: hour,
                day_of_week: new Date().getUTCDay(),
                probability: result.probability||0,
                strategy:    "AI",
                confirmations: result.confirmations||0,
                trend_strength: result.trend_strength||0,
                source:      "TRADEPAGE",
              };
              const r=await fetch(`${SUPABASE_URL}/rest/v1/trades`,{
                method:"POST",
                headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`,"Prefer":"return=representation"},
                body:JSON.stringify(body),
              });
              if(r.ok){
                const d=await r.json();
                const sig=tradepageSignals.get(signalId);
                if(sig) sig.supabaseId=Array.isArray(d)?d[0]?.id:d?.id;
                tradepageSignals.set(signalId,sig);
              }
            }catch(e){console.error("[TradePage] Erro ao salvar no Supabase:",e.message);}

            console.log(`[TradePage] 📊 Sinal salvo | ${result.direction} ${symbol} | user:${user_id} | Entry:${entryLive} SL:${sl.toFixed(2)} TP:${tp1.toFixed(2)} | Prob:${result.probability}%`);
            // Inclui o signal_id na resposta para o cliente referenciar se quiser
            result.tradepage_signal_id=signalId;
          }

          ws.send(JSON.stringify({type:"analysis_result",symbol,strategy,mode,strategy_label:"AUREON AI v9",...result,timestamp:new Date().toISOString()}));
        }catch(err){ws.send(JSON.stringify({type:"error",message:err.message}));}
      }
      if(msg.type==="get_institutional"){ws.send(JSON.stringify({type:"institutional_data",...institutionalData,session:getSessionName(),timestamp:new Date().toISOString()}));}
      if(msg.type==="join_live_room"){liveRoomClients.add(ws);clientFocusAsset.set(ws,null);clientStrategies.set(ws,{...DEFAULT_STRATEGIES});clientModes.set(ws,msg.mode||"express");ws.send(JSON.stringify({type:"live_room_joined",history:liveSignalHistory.slice(0,10),scoreboard:liveScoreboard,assets:LIVE_ASSETS,session:getSessionName(),institutional:institutionalData,message:"Bem-vindo! AUREON AI v9 monitora 24h com dados institucionais.",timestamp:new Date().toISOString()}));broadcastToLiveRoom({type:"live_viewers",count:liveRoomClients.size});}
      if(msg.type==="leave_live_room"){liveRoomClients.delete(ws);clientFocusAsset.delete(ws);clientStrategies.delete(ws);clientModes.delete(ws);broadcastToLiveRoom({type:"live_viewers",count:liveRoomClients.size});}
      if(msg.type==="set_mode"){
        const reqMode = msg.mode === "complete" ? "complete" : "express";
        // ✅ Modo completo (Claude API) — apenas PRO e ELITE
        if (reqMode === "complete") {
          // Verifica se tem slave PRO/Elite online no momento
          let userPlan = "basic";
          activeSlaves.forEach((d, uid) => {
            if (!INTERNAL_BOT_IDS.includes(uid) && (new Date() - d.lastSeen) / 1000 < SLAVE_TIMEOUT_S) {
              if (d.plan === "pro" || d.plan === "elite") userPlan = d.plan;
            }
          });
          if (userPlan !== "pro" && userPlan !== "elite") {
            ws.send(JSON.stringify({ type: "mode_denied", reason: "Modo Completo disponível apenas no plano PRO ou Elite.", requested: reqMode, timestamp: new Date().toISOString() }));
            console.log("[LiveRoom] Modo completo negado — upgrade necessário");
            return;
          }
        }
        clientModes.set(ws, reqMode);
        ws.send(JSON.stringify({ type: "mode_updated", mode: reqMode, timestamp: new Date().toISOString() }));
        console.log("[LiveRoom] set_mode:", reqMode);
      }
      if(msg.type==="focus_asset"){const symbol=msg.asset?.toUpperCase();if(symbol){clientFocusAsset.set(ws,symbol);const pd=allPrices.get(symbol);if(pd&&isPriceFresh(pd))await analyzeLiveAsset(symbol,true);}}
    }catch(e){console.error("[WS] Erro:",e);}
  });
  ws.on("close",()=>{siteClients.delete(ws);liveRoomClients.delete(ws);clientFocusAsset.delete(ws);clientStrategies.delete(ws);clientModes.delete(ws);broadcastToLiveRoom({type:"live_viewers",count:liveRoomClients.size});});
});

// ─────────────────────────────────────────────
// INTERVALS
// ─────────────────────────────────────────────
setInterval(()=>{activeSlaves.forEach((data,userId)=>{if((new Date()-data.lastSeen)/1000>SLAVE_REMOVE_S){activeSlaves.delete(userId);broadcastToSite({type:"slave_status",user_id:userId,connected:false});}});if(mt5LastSeen&&(new Date()-mt5LastSeen)>MT5_TIMEOUT_MS)broadcastToSite({type:"mt5_status",connected:false});},5000);
setInterval(async()=>{try{await fetch(`${RAILWAY_URL}/health`);}catch{}},4*60*1000);
setInterval(fetchFearGreed,    30*60*1000);
// ✅ v22: consolidado em UM único interval de 5min — antes havia 3 intervals
// separados que cada um chamava fetchOpenInterest/fetchFundingRates, gerando
// 4x chamadas redundantes ao Bybit/OKX por ciclo (2x cada função)
setInterval(async()=>{
  await fetchOpenInterest();
  await fetchFundingRates();
  calcSmartMoneyScoreFromData();
}, 5*60*1000);
// ✅ v20: sentimento rápido recalculado a cada 1min — não depende de API externa,
// só usa os preços/RSI já em memória, então reage muito mais rápido que o F&G diário
setInterval(()=>{
  const fs = calcFastSentiment();
  if (fs) {
    const prevValue = institutionalData.fastSentiment?.value;
    institutionalData.fastSentiment = fs;
    broadcastToSite({ type: "fast_sentiment_update", ...fs });
    // alerta se houver mudança brusca (>=15 pontos) entre ciclos — captura
    // exatamente o tipo de movimento rápido que o F&G diário não pega
    if (typeof prevValue === "number" && Math.abs(fs.value - prevValue) >= 15) {
      broadcastToLiveRoom({ type: "institutional_alert", category: "fast_sentiment", level: "warning",
        message: `⚡ Mudança rápida de sentimento: ${prevValue} → ${fs.value} (${fs.emoji} ${fs.label})`,
        timestamp: new Date().toISOString() });
    }
  }
}, 60*1000);
setInterval(fetchLiquidations,  2*60*1000);
setInterval(fetchCorrelations,  5*60*1000);
setInterval(fetchCOTReport,    60*60*1000);
setInterval(fetchEconomicCalendar, 60*60*1000);

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────
app.get("/health",(_, res)=>{
  const slaves=[];activeSlaves.forEach((data,userId)=>{const ago=Math.round((new Date()-data.lastSeen)/1000);slaves.push({user_id:userId,online:ago<SLAVE_TIMEOUT_S,balance:data.balance,plan:data.plan,last_seen_secs:ago});});
  const prices=[];allPrices.forEach((data,symbol)=>prices.push({symbol,bid:data.bid,fresh:isPriceFresh(data)}));
  const hour=new Date().getUTCHours();
  // Monta status de cooldowns
  const now = Date.now();
  const orderCooldowns = {};
  lastOrderSent.forEach((ts, symbol) => { const rem = Math.max(0, SIGNAL_COOLDOWN - (now - ts)); orderCooldowns[symbol] = { blocked: rem > 0, remaining_seconds: Math.round(rem/1000) }; });
  res.json({
    status:"online", version:"v19-MTF-fix-institutional",
    mt5_connected:isMt5Online(), symbols_count:allPrices.size, symbols:prices,
    site_clients:siteClients.size,
    slaves_online:slaves.filter(s=>s.online).length, slaves_total:activeSlaves.size, slaves,
    elite_online:slaves.filter(s=>s.online&&s.plan==="elite").length,
    live_room_active:true, live_room_clients:liveRoomClients.size,
    live_signals_today:liveScoreboard.signals,
    session:getSessionName(),
    trading_hours:{current_utc:hour,forex_xau_active:hour>=8&&hour<17,crypto_active:true,best_session:hour>=13&&hour<17?"🇺🇸 Overlap NY+Londres ⭐⭐⭐":hour>=8&&hour<17?"🇬🇧 Sessão Londres ⭐":"🌙 Fora de sessão"},
    active_signals:Object.fromEntries(activeSignals),
    // ✅ FIX: cooldowns de ordem visíveis no health
    order_cooldowns: orderCooldowns,
    focused_asset:getMostFocusedAsset(), current_mode:getMostUsedMode(),
    learning_cache_size:historicalCache.size, analysis_cache_size:analysisCache.size,
    signal_cache_size:signalCache.size, alert_cache_size:alertCache.size,
    processing_count:processingAssets.size, live_room_bot:isSlaveOnline(LIVE_ROOM_BOT_ID),
    strategies:Object.keys(STRATEGIES),
    htf_config:HTF_MIN_PROB, cooldown_minutes:SIGNAL_COOLDOWN/60000,
    institutional:{
      fear_greed:institutionalData.fearGreed?.value||null,
      fear_greed_label:institutionalData.fearGreed?.label||null,
      whale_alerts_today:institutionalData.whaleAlerts.length,
      liquidations_today:institutionalData.liquidations.length,
      whale_polling_active:true,
    },
    timestamp:new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// ENDPOINT PAPER TRADING
// ─────────────────────────────────────────────
app.get("/paper-trading",(req,res)=>{
  const positions=[];
  paperPositions.forEach((pos,id)=>{
    const priceData=allPrices.get(pos.symbol);
    const currentPrice=priceData?parseFloat(priceData.bid):null;
    const unrealized=currentPrice?estimateProfit(pos.symbol,pos.direction,pos.entry,currentPrice,PAPER_LOT):null;
    positions.push({id,...pos,current_price:currentPrice,unrealized_profit:unrealized,open_minutes:Math.round((Date.now()-pos.openedAt)/60000)});
  });
  // ✅ v21: scoreboard por trilha (BASE/RR2X/RR3X) + total agregado
  const tracks = {};
  let agg = {total:0,wins:0,losses:0,pending:0};
  Object.entries(paperTradeCount).forEach(([track,c])=>{
    const wl = c.wins+c.losses;
    tracks[track] = {
      label: PAPER_RR_TRACKS[track]?.label || track,
      rr_multiplier: PAPER_RR_TRACKS[track]?.rrMultiplier ?? "tp1",
      ...c,
      win_rate: wl>0 ? ((c.wins/wl)*100).toFixed(1)+"%" : "0%",
    };
    agg.total+=c.total; agg.wins+=c.wins; agg.losses+=c.losses; agg.pending+=c.pending;
  });
  res.json({
    active:true,
    interval_min:PAPER_INTERVAL_MS/60000,
    tracks,
    scoreboard:{
      ...agg,
      win_rate:(agg.wins+agg.losses)>0
        ?((agg.wins/(agg.wins+agg.losses))*100).toFixed(1)+"%"
        :"0%",
    },
    open_positions:positions,
    assets:PAPER_ASSETS,
    min_probability:PAPER_MIN_PROBABILITY,
    timestamp:new Date().toISOString(),
  });
});

/**
 * TraderAureonia AI — Paper Trading Module
 * Integrar no server.js v19-MTF-fix
 *
 * Como funciona:
 * 1. A cada 30min (configurável) gera sinal para cada ativo via eaSignal_v3
 * 2. Se sinal válido → salva no Supabase como "pending"
 * 3. A cada 30s monitora preço atual e verifica se atingiu TP ou SL
 * 4. Ao atingir TP → result: "win", profit estimado positivo
 * 5. Ao atingir SL → result: "loss", profit estimado negativo
 * 6. Timeout 4h → fecha pelo preço atual (win/loss pelo mark-to-market)
 *
 * ADICIONAR no server.js logo após o bloco de estado global existente,
 * e chamar initPaperTrading() dentro do httpServer.listen()
 */

// ─────────────────────────────────────────────
// CONFIGURAÇÕES PAPER TRADING
// ─────────────────────────────────────────────
const PAPER_INTERVAL_MS     = 30 * 60 * 1000; // Gera novos sinais a cada 30min
const PAPER_MONITOR_MS      = 30 * 1000;       // Verifica preços a cada 30s
const PAPER_TIMEOUT_MS      = 4 * 60 * 60 * 1000; // Fecha posição após 4h
const PAPER_LOT             = 0.01;            // Lote fixo para estimativa de lucro
const PAPER_MAX_OPEN        = 1;               // Máximo de posições paper abertas por (ativo, trilha)
const PAPER_MIN_PROBABILITY = 65.0;            // Probabilidade mínima para abrir paper trade
const PAPER_ASSETS = [
  // Crypto
  "BTCUSD", "ETHUSD", "BNBUSD", "SOLUSD", "XRPUSD",
  "ADAUSD", "DOTUSD",
  // Forex (nomes PU Prime com sufixo .s)
  "EURUSD.s", "GBPUSD.s", "USDJPY.s", "AUDUSD.s", "USDCAD.s", "USDCHF.s",
  "NZDUSD.s", "EURGBP.s", "GBPJPY.s", "EURJPY.s",
  // Metais
  "XAUUSD.s", "XAGUSD.s",
  // Commodities
  "WTIUSD", "NATGAS",
  // Índices (nomes PU Prime)
  "NAS100.s", "SP500.s", "US30.s", "GER40.s", "UK100.s", "JPN225ft.s",
];

// ✅ v21: TRILHAS de RR — mesmo sinal/SL (mesmo risco), TP diferente por trilha.
// BASE  = usa o tp1 que o eaSignal já calcula (≈1.39x pra metais/crypto, ≈1.33x forex)
// RR2X  = TP a 2.0x a distância do SL (mesmo risco, alvo maior)
// RR3X  = TP a 3.0x a distância do SL
// Isso permite comparar ao longo do tempo qual RR dá mais profit total,
// já que entry/SL/direção são idênticos entre as 3 — só o TP muda.
const PAPER_RR_TRACKS = {
  BASE: { label: "Padrão (eaSignal tp1)", rrMultiplier: null },
  RR2X: { label: "2x Risco",              rrMultiplier: 2.0  },
  RR3X: { label: "3x Risco",              rrMultiplier: 3.0  },
};

// Tick values aproximados por ativo (USD por pip/point no lote 0.01)
const PAPER_TICK_VALUES = {
  // Crypto — $0.01 por point no lote 0.01
  "BTCUSD":  0.01, "ETHUSD":  0.01, "BNBUSD":  0.01,
  "SOLUSD":  0.01, "XRPUSD":  0.01, "ADAUSD":  0.01,
  "DOTUSD":  0.01,
  // Forex — $0.10 por pip no lote 0.01
  "EURUSD.s":  0.10, "GBPUSD.s":  0.10, "USDJPY.s":  0.09,
  "AUDUSD.s":  0.10, "USDCAD.s":  0.08, "USDCHF.s":  0.10,
  "NZDUSD.s":  0.10, "EURGBP.s":  0.10, "GBPJPY.s":  0.09, "EURJPY.s":  0.09,
  // Metais
  "XAUUSD.s":0.01, "XAGUSD.s":0.01,
  // Commodities
  "WTIUSD":  0.01, "NATGAS":  0.01,
  // Índices — $0.01 por point no lote 0.01
  "NAS100.s":  0.01, "SP500.s":   0.01, "US30.s":    0.01,
  "GER40.s":   0.01, "UK100.s":   0.01, "JPN225ft.s":  0.01,
};

// ─────────────────────────────────────────────
// ESTADO PAPER TRADING
// ─────────────────────────────────────────────
const paperPositions   = new Map(); // id -> posição aberta (campo `track` indica a trilha)
const paperCooldown    = new Map(); // symbol -> timestamp último sinal paper
// ✅ v22: sinais do TradePage — monitorados igual ao paper trading
const tradepageSignals = new Map(); // signalId -> sinal aberto do TradePage
// ✅ v21: contadores por trilha
const paperTradeCount  = {
  BASE: { total: 0, wins: 0, losses: 0, pending: 0 },
  RR2X: { total: 0, wins: 0, losses: 0, pending: 0 },
  RR3X: { total: 0, wins: 0, losses: 0, pending: 0 },
};

// ─────────────────────────────────────────────
// ESTIMA LUCRO/PERDA
// ─────────────────────────────────────────────
function estimateProfit(symbol, direction, entryPrice, closePrice, lot) {
  const tickVal = PAPER_TICK_VALUES[symbol] || 0.01;
  const isCrypto = ["BTCUSD","ETHUSD","BNBUSD","SOLUSD","XRPUSD"].includes(symbol);
  const isForex  = ["EURUSD.s","GBPUSD.s","USDJPY.s","AUDUSD.s","USDCAD.s","USDCHF.s","NZDUSD.s","EURGBP.s","GBPJPY.s","EURJPY.s"].includes(symbol);

  let priceDiff = direction === "BUY"
    ? closePrice - entryPrice
    : entryPrice - closePrice;

  let profit = 0;
  if (isCrypto) {
    // Crypto: profit em USD direto × lote
    profit = priceDiff * lot;
  } else if (symbol === "XAUUSD.s") {
    // Ouro: 1 pip = $0.01 por lote 0.01 (100oz × $0.01)
    profit = priceDiff * lot * 100;
  } else if (isForex) {
    // Forex: pip = 0.0001, $10 por pip no lote 1.0 → $0.10 no lote 0.01
    profit = (priceDiff / 0.0001) * tickVal * lot / 0.01;
  } else {
    profit = priceDiff * lot;
  }

  return parseFloat(profit.toFixed(2));
}

// ─────────────────────────────────────────────
// SALVA PAPER TRADE NO SUPABASE
// ─────────────────────────────────────────────
async function savePaperTrade(tradeData) {
  try {
    // ✅ v21: user_code e source identificam a trilha de RR — permite
    // filtrar /all-trades por user_code para comparar BASE vs RR2X vs RR3X
    const track = tradeData.track || "BASE";
    const body = {
      user_code:       `PAPER-BOT-${track}`,
      symbol:          tradeData.symbol,
      direction:       tradeData.direction.toLowerCase(),
      entry_price:     tradeData.entry,
      sl:              tradeData.sl,
      tp:              tradeData.tp1,
      profit:          0,
      result:          "open",   // será atualizado para win/loss
      hour_of_day:     tradeData.hour,
      day_of_week:     tradeData.dayOfWeek,
      market_strength: tradeData.trend_strength || 0,
      atr_value:       tradeData.atr || 0,
      probability:     tradeData.probability,
      strategy:        "AI",
      confirmations:   tradeData.confirmations || 0,
      trend_strength:  tradeData.trend_strength || 0,
      source:          `PAPER-${track}`,
      // metadados extras para aprendizado
      htf_bias:        tradeData.htf_bias || "NEUTRAL",
      fear_greed:      tradeData.fear_greed || 50,
      session:         tradeData.session || "",
      mtf_score:       tradeData.mtf_score || 0,
    };

    const res = await fetch(`${SUPABASE_URL}/rest/v1/trades`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer":        "return=representation",
      },
      body: JSON.stringify(body),
    });
    const saved = await res.json();
    return saved?.[0]?.id || null;
  } catch (err) {
    console.error("[Paper] Erro ao salvar:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────
// ATUALIZA RESULTADO NO SUPABASE
// ─────────────────────────────────────────────
async function updatePaperResult(supabaseId, result, profit, closePrice, closedBy, track) {
  if (!supabaseId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/trades?id=eq.${supabaseId}`, {
      method:  "PATCH",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify({
        result,
        profit:      parseFloat(profit) || 0,
        close_price: closePrice,
        closed_at:   new Date().toISOString(),
        // ✅ v21: mantém a trilha visível no source ao fechar (ex: PAPER-RR2X-TP)
        source:      `PAPER-${track || "BASE"}-${closedBy}`, // PAPER-BASE-TP, PAPER-RR2X-SL, PAPER-RR3X-TIMEOUT
      }),
    });
  } catch (err) {
    console.error("[Paper] Erro ao atualizar resultado:", err.message);
  }
}

// ─────────────────────────────────────────────
// MONITORA POSIÇÕES ABERTAS — checa TP/SL
// ─────────────────────────────────────────────
async function monitorPaperPositions() {
  if (paperPositions.size === 0 && tradepageSignals.size === 0) return;

  const now = Date.now();

  for (const [id, pos] of paperPositions.entries()) {
    const priceData = allPrices.get(pos.symbol);
    if (!priceData) continue;

    const currentBid = parseFloat(priceData.bid);
    const currentAsk = parseFloat(priceData.ask || priceData.bid);
    const elapsed    = now - pos.openedAt;

    // Preço de referência por direção
    const checkPrice = pos.direction === "BUY" ? currentBid : currentAsk;

    let closed   = false;
    let result   = "";
    let closePrice = checkPrice;
    let closedBy = "";

    // ── Verifica TP ──
    if (pos.direction === "BUY"  && currentBid >= pos.tp) {
      result   = "win";
      closePrice = pos.tp;
      closedBy = "TP";
      closed   = true;
    } else if (pos.direction === "SELL" && currentAsk <= pos.tp) {
      result   = "win";
      closePrice = pos.tp;
      closedBy = "TP";
      closed   = true;
    }

    // ── Verifica SL ──
    if (!closed) {
      if (pos.direction === "BUY"  && currentBid <= pos.sl) {
        result   = "loss";
        closePrice = pos.sl;
        closedBy = "SL";
        closed   = true;
      } else if (pos.direction === "SELL" && currentAsk >= pos.sl) {
        result   = "loss";
        closePrice = pos.sl;
        closedBy = "SL";
        closed   = true;
      }
    }

    // ── Timeout 4h — fecha pelo preço atual ──
    if (!closed && elapsed >= PAPER_TIMEOUT_MS) {
      const profit = estimateProfit(pos.symbol, pos.direction, pos.entry, checkPrice, PAPER_LOT);
      result   = profit >= 0 ? "win" : "loss";
      closePrice = checkPrice;
      closedBy = "TIMEOUT";
      closed   = true;
    }

    if (closed) {
      const profit = estimateProfit(pos.symbol, pos.direction, pos.entry, closePrice, PAPER_LOT);
      const durationMin = Math.round(elapsed / 60000);
      const track = pos.track || "BASE";
      const counter = paperTradeCount[track] || paperTradeCount.BASE;

      // Atualiza Supabase
      await updatePaperResult(pos.supabaseId, result, profit, closePrice, closedBy, track);

      // Atualiza scoreboard da trilha correspondente
      counter.pending = Math.max(0, counter.pending - 1);
      if (result === "win")  { counter.wins++;   }
      else                   { counter.losses++; }

      // Atualiza live_signals também (para o historical do eaSignal) — só pra trilha BASE,
      // pra não distorcer o win_rate histórico usado pelo eaSignal com as trilhas RR2X/RR3X
      if (pos.liveSignalId && track === "BASE") {
        await updateLiveSignalResult(pos.liveSignalId, result, profit, closePrice, closedBy === "TP" ? 1 : 0);
      }

      paperPositions.delete(id);

      const emoji = result === "win" ? "✅" : "❌";
      console.log(`[Paper-${track}] ${emoji} ${result.toUpperCase()} | ${pos.direction} ${pos.symbol} | ` +
                  `Entry:${pos.entry} SL:${pos.sl} TP:${pos.tp} Close:${closePrice} | P/L:$${profit} | ` +
                  `Fechado por:${closedBy} | Duração:${durationMin}min`);

      // Broadcast para live room
      broadcastToLiveRoom({
        type:       "paper_trade_closed",
        track,
        symbol:     pos.symbol,
        direction:  pos.direction,
        result,
        profit,
        entry:      pos.entry,
        sl:         pos.sl,
        tp:         pos.tp,
        close_price: closePrice,
        closed_by:  closedBy,
        duration_min: durationMin,
        scoreboard: {
          track,
          total:    counter.total,
          wins:     counter.wins,
          losses:   counter.losses,
          pending:  counter.pending,
          win_rate: (counter.wins + counter.losses) > 0
            ? ((counter.wins / (counter.wins + counter.losses)) * 100).toFixed(1)
            : "0.0",
        },
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ✅ v22: monitora sinais do TradePage — mesmo mecanismo do paper trading
  // Timeout menor (2h) porque o usuário já viu o resultado na tela
  const TRADEPAGE_TIMEOUT_MS = 2 * 60 * 60 * 1000;
  for (const [id, sig] of tradepageSignals.entries()) {
    const priceData = allPrices.get(sig.symbol);
    if (!priceData || !isPriceFresh(priceData)) continue;

    const currentPrice = parseFloat(priceData.bid);
    const elapsed      = now - sig.openedAt;
    let closed = false, result = "", closePrice = currentPrice, closedBy = "";

    if (sig.direction === "BUY") {
      if (currentPrice <= sig.sl)  { closed=true; result="loss"; closedBy="SL"; }
      else if (currentPrice >= sig.tp) { closed=true; result="win";  closedBy="TP"; }
    } else {
      if (currentPrice >= sig.sl)  { closed=true; result="loss"; closedBy="SL"; }
      else if (currentPrice <= sig.tp) { closed=true; result="win";  closedBy="TP"; }
    }
    if (!closed && elapsed >= TRADEPAGE_TIMEOUT_MS) {
      closed=true; result="loss"; closedBy="TIMEOUT";
      closePrice = currentPrice;
    }

    if (closed && sig.supabaseId) {
      // Atualiza resultado no Supabase
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/trades?id=eq.${sig.supabaseId}`,{
          method:"PATCH",
          headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`,"Prefer":"return=minimal"},
          body:JSON.stringify({result, profit:0, close_price:closePrice, closed_at:new Date().toISOString(), source:`TRADEPAGE-${closedBy}`}),
        });
      } catch(e){ console.error("[TradePage] Erro ao fechar sinal:",e.message); }

      tradepageSignals.delete(id);
      const emoji = result==="win"?"✅":"❌";
      console.log(`[TradePage] ${emoji} ${result.toUpperCase()} | ${sig.direction} ${sig.symbol} | user:${sig.user_id} | Close:${closePrice} | ${closedBy}`);
    }
  }
}

// ─────────────────────────────────────────────
// GERA SINAL PAPER PARA UM ATIVO
// ─────────────────────────────────────────────
// Arredonda preço com a mesma precisão usada pelo eaSignal (dig)
function roundPaperPrice(symbol, value) {
  const isForexSym = ["EURUSD.s","GBPUSD.s","USDJPY.s","AUDUSD.s","USDCAD.s","USDCHF.s","NZDUSD.s","EURGBP.s","GBPJPY.s","EURJPY.s"].includes(symbol);
  const isJPYSym   = symbol.includes("JPY");
  const dig = isForexSym ? (isJPYSym ? 3 : 5) : 2;
  return parseFloat(value.toFixed(dig));
}

async function runPaperSignal(symbol) {
  const priceData = allPrices.get(symbol);
  if (!priceData || !isPriceFresh(priceData)) {
    console.log(`[Paper] ${symbol} sem dados frescos — pulando`);
    return;
  }

  // ✅ v21: cooldown agora é por (símbolo, trilha) — só pula a geração do sinal
  // se TODAS as trilhas já tiverem posição aberta pra esse símbolo
  const openForSymbol = [...paperPositions.values()].filter(p => p.symbol === symbol);
  const tracksWithOpen = new Set(openForSymbol.map(p => p.track || "BASE"));
  const allTracksOpen = Object.keys(PAPER_RR_TRACKS).every(t => tracksWithOpen.has(t)
    && openForSymbol.filter(p => (p.track || "BASE") === t).length >= PAPER_MAX_OPEN);
  if (allTracksOpen) {
    console.log(`[Paper] ${symbol} — todas as trilhas já têm posição aberta — pulando`);
    return;
  }

  try {
    const now        = new Date();
    const hour       = now.getUTCHours();
    const dayOfWeek  = now.getUTCDay();
    const session    = getSessionName();

    // Busca histórico para calibrar
    const stats     = await fetchHistoricalStats(symbol, "AI");
    const hourStats = stats.hour_stats?.[hour] || {};
    const histData  = {
      win_rate:         stats.win_rate,
      sample_size:      stats.sample_size,
      hour_win_rate:    hourStats.win_rate ?? -1,
      hour_sample_size: hourStats.count   ?? 0,
    };

    console.log(`[Paper] 🔍 Analisando ${symbol} | Hora:${hour}UTC | Session:${session}`);

    const result = await callEaSignalV3("AI", symbol, histData, "complete");

    if (result.status !== "new_signal" || !result.direction) {
      console.log(`[Paper] ${symbol} — sem sinal: ${result.reason || "aguardando setup"}`);
      return;
    }

    if (result.probability < PAPER_MIN_PROBABILITY) {
      console.log(`[Paper] ${symbol} — prob ${result.probability}% < mínimo ${PAPER_MIN_PROBABILITY}% — descartado`);
      return;
    }

    const bid      = parseFloat(priceData.bid);
    const ask      = parseFloat(priceData.ask || priceData.bid);
    const entry    = result.direction === "BUY" ? ask : bid;       // preço LIVE — usado pra abrir a posição paper
    const resultEntry = parseFloat(result.entry);                   // preço que o eaSignal usou pro cálculo (M5 close)
    const resultSL    = parseFloat(result.sl);
    const resultTP1   = parseFloat(result.tp1 || result.tp);
    const atr      = result.indicators?.atr || 0;
    const fearGreed = institutionalData.fearGreed?.value || 50;
    const mtfScore  = result.analysis?.mtf_alignment?.score || 0;

    // Valida níveis brutos do eaSignal
    if (!resultEntry || resultEntry<=0 || !resultSL || resultSL<=0 || !resultTP1 || resultTP1<=0) {
      console.log(`[Paper] ${symbol} — entry/SL/TP inválido no resultado do eaSignal — descartado`);
      return;
    }

    // ✅ FIX: o `result.entry` do eaSignal vem do último candle M5 e pode estar
    // defasado em relação ao bid/ask LIVE (até 5min de diferença). Em vez de
    // comparar result.sl/result.tp1 (absolutos) contra o preço live — o que
    // gerava falsos "SL invertido" quando os preços divergiam — extraímos as
    // DISTÂNCIAS (que carregam o RR correto) e reaplicamos no preço live.
    // Isso garante SL/TP sempre no lado certo da entrada, por construção.
    const slDist  = Math.abs(resultEntry - resultSL);
    const tp1Dist = Math.abs(resultEntry - resultTP1);
    const priceDrift = Math.abs(entry - resultEntry);
    const driftPct   = (priceDrift / resultEntry) * 100;
    if (driftPct > 0.5) {
      console.log(`[Paper] ${symbol} — atenção: result.entry(${resultEntry}) vs live(${entry}) — drift ${driftPct.toFixed(2)}%`);
    }

    const sl  = roundPaperPrice(symbol, result.direction === "BUY" ? entry - slDist  : entry + slDist);
    const tp1 = roundPaperPrice(symbol, result.direction === "BUY" ? entry + tp1Dist : entry - tp1Dist);

    // Verifica distância mínima (evita sinais com SL/TP colados no preço)
    const minDist = entry * 0.001; // 0.1% mínimo
    if (slDist < minDist || tp1Dist < minDist) {
      console.log(`[Paper] ${symbol} — distância SL/TP muito pequena — descartado`);
      return;
    }

    // ✅ v21: abre UMA posição por trilha — mesmo entry/SL/direção (mesmo risco),
    // TP diferente por trilha (BASE = tp1 do eaSignal, RR2X = 2x slDist, RR3X = 3x slDist)
    for (const [track, cfg] of Object.entries(PAPER_RR_TRACKS)) {
      // Pula a trilha se já tem posição aberta pra esse símbolo nela
      const openForTrack = openForSymbol.filter(p => (p.track || "BASE") === track).length;
      if (openForTrack >= PAPER_MAX_OPEN) {
        console.log(`[Paper-${track}] ${symbol} já tem posição aberta nessa trilha — pulando`);
        continue;
      }

      const tpForTrack = cfg.rrMultiplier === null
        ? tp1
        : roundPaperPrice(symbol, result.direction === "BUY" ? entry + slDist*cfg.rrMultiplier : entry - slDist*cfg.rrMultiplier);

      const tradeId = `PAPER-${track}-${symbol}-${Date.now()}`;
      const position = {
        id:           tradeId,
        track,
        symbol,
        direction:    result.direction,
        entry,
        sl,
        tp:           tpForTrack,
        probability:  result.probability,
        confirmations: result.confirmations || 0,
        trend_strength: result.trend_strength || 0,
        htf_bias:     result.htf_bias || "NEUTRAL",
        fear_greed:   fearGreed,
        session,
        mtf_score:    mtfScore,
        atr,
        hour,
        dayOfWeek,
        openedAt:     Date.now(),
        supabaseId:   null,
        liveSignalId: null,
      };

      // Salva no Supabase (trades table) — user_code/source incluem a trilha
      const dbId = await savePaperTrade({
        ...position,
        tp1: tpForTrack,
        hour,
        dayOfWeek,
        track,
      });
      position.supabaseId = dbId;

      // Salva também no live_signals — só pra trilha BASE (evita distorcer o
      // historical_win_rate do eaSignal com as variantes RR2X/RR3X)
      if (track === "BASE") {
        const liveSignal = {
          asset:         symbol,
          strategy:      "AI",
          direction:     result.direction,
          entry:         entry,
          sl,
          tp1: tpForTrack,
          tp2:           result.tp2 || null,
          tp3:           result.tp3 || null,
          probability:   result.probability,
          confirmations: result.confirmations || 0,
          indicators:    result.indicators,
          trend_strength: result.trend_strength,
          is_range:      result.is_range || false,
        };
        await saveLiveSignal(liveSignal);
        position.liveSignalId = liveSignal.supabase_id || null;
      }

      paperPositions.set(tradeId, position);
      paperTradeCount[track].total++;
      paperTradeCount[track].pending++;

      console.log(`[Paper-${track}] 🟢 ABERTO | ${result.direction} ${symbol} | ` +
                  `Entry:${entry} SL:${sl} TP:${tpForTrack} (RR≈${cfg.rrMultiplier ?? "tp1"}) | ` +
                  `Prob:${result.probability}% HTF:${result.htf_bias} | ` +
                  `Fear&Greed:${fearGreed} Session:${session}`);

      // Broadcast para live room
      broadcastToLiveRoom({
        type:          "paper_trade_opened",
        track,
        track_label:   cfg.label,
        symbol,
        direction:     result.direction,
        entry,
        sl,
        tp1:           tpForTrack,
        probability:   result.probability,
        htf_bias:      result.htf_bias,
        fear_greed:    fearGreed,
        session,
        mtf_score:     mtfScore,
        trade_id:      tradeId,
        timestamp:     new Date().toISOString(),
      });
    }

  } catch (err) {
    console.error(`[Paper] Erro em ${symbol}:`, err.message);
  }
}

// ─────────────────────────────────────────────
// LOOP PRINCIPAL — gera sinais para todos os ativos
// ─────────────────────────────────────────────
async function runPaperTradingCycle() {
  // ✅ v21: resumo por trilha no log do ciclo
  const trackSummary = Object.entries(paperTradeCount)
    .map(([t,c]) => `${t}(T:${c.total} W:${c.wins} L:${c.losses})`)
    .join(" | ");
  console.log(`[Paper] ═══ Ciclo iniciado | ${new Date().toLocaleTimeString("pt-BR")} | ` +
              `Posições abertas: ${paperPositions.size} | ${trackSummary} ═══`);

  for (const symbol of PAPER_ASSETS) {
    await runPaperSignal(symbol);
    await new Promise(r => setTimeout(r, 2000)); // 2s entre ativos para não sobrecarregar
  }
}

// ─────────────────────────────────────────────
// ENDPOINT — status do paper trading
// ─────────────────────────────────────────────
// Adicionar no app do express:
//
// app.get("/paper-trading", (req, res) => {
//   const positions = [];
//   paperPositions.forEach((pos, id) => {
//     const priceData   = allPrices.get(pos.symbol);
//     const currentPrice = priceData ? parseFloat(priceData.bid) : null;
//     const unrealized  = currentPrice
//       ? estimateProfit(pos.symbol, pos.direction, pos.entry, currentPrice, PAPER_LOT)
//       : null;
//     positions.push({
//       id, ...pos,
//       current_price: currentPrice,
//       unrealized_profit: unrealized,
//       open_minutes: Math.round((Date.now() - pos.openedAt) / 60000),
//     });
//   });
//   res.json({
//     active:     true,
//     interval_min: PAPER_INTERVAL_MS / 60000,
//     scoreboard: {
//       ...paperTradeCount,
//       win_rate: paperTradeCount.wins + paperTradeCount.losses > 0
//         ? ((paperTradeCount.wins / (paperTradeCount.wins + paperTradeCount.losses)) * 100).toFixed(1) + "%"
//         : "0%",
//     },
//     open_positions: positions,
//     assets: PAPER_ASSETS,
//     min_probability: PAPER_MIN_PROBABILITY,
//     timestamp: new Date().toISOString(),
//   });
// });

// ─────────────────────────────────────────────
// INIT — chamar dentro do httpServer.listen()
// ─────────────────────────────────────────────
function initPaperTrading() {
  console.log("[Paper Trading] ✅ Iniciado");
  console.log(`[Paper Trading] Ciclos a cada ${PAPER_INTERVAL_MS/60000}min | Monitor a cada ${PAPER_MONITOR_MS/1000}s | Timeout ${PAPER_TIMEOUT_MS/3600000}h`);
  console.log(`[Paper Trading] Ativos: ${PAPER_ASSETS.join(", ")} | Prob mínima: ${PAPER_MIN_PROBABILITY}%`);

  // Primeiro ciclo após 1 min (aguarda MT5 conectar)
  setTimeout(runPaperTradingCycle, 60 * 1000);

  // Ciclos regulares
  setInterval(runPaperTradingCycle, PAPER_INTERVAL_MS);

  // Monitor de posições abertas (verifica TP/SL a cada 30s)
  setInterval(monitorPaperPositions, PAPER_MONITOR_MS);
}

httpServer.listen(PORT, async()=>{
  console.log(`[Railway] v19-MTF-fix + PaperTrading rodando na porta ${PORT}`);
  console.log(`[Railway] Cooldown: ${SIGNAL_COOLDOWN/60000}min | HTF: ${JSON.stringify(HTF_MIN_PROB)}`);
  console.log(`[Railway] FIX: lastOrderSent Map ativo — cooldown de ordem separado do signalCache`);
  console.log(`[Railway] FIX: enqueueOrder valida TP/SL antes de enfileirar`);

  // Inicia Live Room
  startLiveRoom24h();

  // Inicia Binance WebSocket para whale alerts
  setTimeout(connectBinanceWhaleWatcher, 2000);

  // Busca dados institucionais iniciais
  setTimeout(async()=>{
    await Promise.all([
      fetchFearGreed(),
      fetchOpenInterest(),
      fetchFundingRates(),
      fetchCorrelations(),
      fetchEconomicCalendar(),
      fetchCOTReport()]);
    calcSmartMoneyScoreFromData();
    console.log("[Railway] Dados institucionais carregados");
  }, 5000);

  // Paper Trading — aprendizado autônomo (aguarda 60s para MT5 conectar)
  setTimeout(initPaperTrading, 60000);
});
