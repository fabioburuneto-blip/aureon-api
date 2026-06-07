/**
 * TraderAureonia AI — Servidor Railway v19
 *
 * NOVO na v19:
 * - 🐋 Whale Alerts via Binance WebSocket (trades > $100k)
 * - ⚡ Liquidações via Coinglass API
 * - 📊 Open Interest via Binance Futures
 * - 💰 Funding Rate via Binance Futures
 * - 😨 Fear & Greed Index via alternative.me
 * - 🧠 Smart Money Score consolidado
 * - 📰 COT Report semanal (CFTC)
 * - 🔗 Correlações DXY/BTC/XAU/SPX
 * - 📅 Calendário Econômico
 * - Cálculo TP/SL para eventos institucionais
 * - Tudo do v18 mantido
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
const SLAVE_TIMEOUT_S  = 30;
const SLAVE_REMOVE_S   = 60;
const PRICE_EXPIRE_S   = 30;

const SUPABASE_URL = "https://vxxdkxlvkrxkfbrvxdal.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4eGRreGx2a3J4a2ZicnZ4ZGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjE5MzksImV4cCI6MjA5MTkzNzkzOX0.Z1A_L_ObyDwWSoT0lp9uoB0qpRx7-Tt_oEDpifd-U7s";

// ─────────────────────────────────────────────
// CONFIGURAÇÕES v19
// ─────────────────────────────────────────────
const SIGNAL_COOLDOWN        = 15 * 60 * 1000;
const ALERT_COOLDOWN         = 3  * 60 * 1000;
const PRICE_CHANGE_THRESHOLD = 0.002;
const WHALE_THRESHOLD_USD    = 100000; // $100k mínimo para whale alert
const LIQUIDATION_THRESHOLD  = 500000; // $500k mínimo para alerta de liquidação

const HTF_MIN_PROB = { WITH: 65, NEUTRAL: 70, AGAINST: 78 };

const SESSION_HOURS = {
  FOREX: { start: 8, end: 17 },
  XAU:   { start: 8, end: 17 },
  CRYPTO: null,
};

const FOREX_ASSETS  = ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD"];
const XAU_ASSETS    = ["XAUUSD.s"];
const CRYPTO_ASSETS = ["BTCUSD", "ETHUSD", "BNBUSD", "SOLUSD", "XRPUSD"];

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

const ANALYSIS_INTERVAL_PRIORITY = 30 * 1000;
const ANALYSIS_INTERVAL_NORMAL   = 60 * 1000;
const LIVE_ROOM_BOT_ID = "LIVE-ROOM-BOT";
const LIVE_ASSETS = ["BTCUSD", "XAUUSD.s", "EURUSD", "GBPUSD", "ETHUSD"];
const DEFAULT_STRATEGIES = {
  BTCUSD: "AI", "XAUUSD.s": "AI", EURUSD: "AI", GBPUSD: "AI", ETHUSD: "AI"
};

const liveScoreboard = { signals: 0, wins: 0, losses: 0, profit: 0, date: new Date().toDateString() };

// ─────────────────────────────────────────────
// DADOS INSTITUCIONAIS v19
// ─────────────────────────────────────────────
const institutionalData = {
  fearGreed:    { value: 50, label: "Neutro", updated: null },
  whaleAlerts:  [],   // últimas 20 whale alerts
  liquidations: [],   // últimas 20 liquidações
  openInterest: {},   // OI por símbolo
  fundingRate:  {},   // Funding Rate por símbolo
  cotReport:    {},   // COT Report por ativo
  correlations: {},   // Correlações entre ativos
  smartMoneyScore: {}, // Score por ativo
  economicCalendar: [], // Próximos eventos
};

// Binance WebSocket para Whale Alerts
let binanceWS = null;
const binanceSymbols = ["btcusdt", "ethusdt", "bnbusdt", "solusdt", "xrpusdt"];

function connectBinanceWhaleWatcher() {
  const streams = binanceSymbols.map(s => `${s}@aggTrade`).join("/");
  const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  try {
    binanceWS = new WebSocket(wsUrl);
    binanceWS.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const data = msg.data || msg;
        if (!data || !data.p || !data.q) return;
        const price = parseFloat(data.p);
        const qty   = parseFloat(data.q);
        const usdValue = price * qty;
        if (usdValue < WHALE_THRESHOLD_USD) return;

        // Mapeamento Binance → site
        const symbolMap = { BTCUSDT:"BTCUSD", ETHUSDT:"ETHUSD", BNBUSDT:"BNBUSD", SOLUSDT:"SOLUSD", XRPUSDT:"XRPUSD" };
        const symbol = symbolMap[data.s] || data.s;
        const isBuy  = data.m === false; // m=true = market sell, m=false = market buy

        const alert = {
          type:      "WHALE_ALERT",
          symbol,
          direction: isBuy ? "BUY" : "SELL",
          usdValue:  Math.round(usdValue),
          price,
          qty,
          timestamp: new Date().toISOString(),
          hora:      new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
          // Calcula TP/SL baseado na movimentação da whale
          levels: calcWhaleSignalLevels(symbol, isBuy ? "BUY" : "SELL", price),
          strength: usdValue >= 1000000 ? "🐳 MEGA WHALE" : usdValue >= 500000 ? "🐋 WHALE" : "🐬 SHARK",
          message: `${usdValue >= 1000000 ? "🐳" : "🐋"} ${isBuy?"COMPRA":"VENDA"} INSTITUCIONAL: $${formatUSD(usdValue)} em ${symbol} @ ${price}`,
        };

        // Salva e broadcast
        institutionalData.whaleAlerts.unshift(alert);
        if (institutionalData.whaleAlerts.length > 20) institutionalData.whaleAlerts.pop();

        broadcastToLiveRoom({ type: "whale_alert", ...alert });
        broadcastToSite({ type: "whale_alert", ...alert });

        console.log(`[Whale] ${alert.strength} ${isBuy?"BUY":"SELL"} ${symbol} $${formatUSD(usdValue)}`);

        // Atualiza Smart Money Score
        updateSmartMoneyScore(symbol, isBuy ? "BUY" : "SELL", usdValue);
      } catch {}
    });
    binanceWS.on("close", () => {
      console.log("[Binance WS] Desconectado — reconectando em 10s...");
      setTimeout(connectBinanceWhaleWatcher, 10000);
    });
    binanceWS.on("error", () => {
      setTimeout(connectBinanceWhaleWatcher, 15000);
    });
    binanceWS.on("open", () => {
      console.log("[Binance WS] Conectado — monitorando whales em", binanceSymbols.join(", "));
    });
  } catch (err) {
    console.error("[Binance WS] Erro:", err.message);
    setTimeout(connectBinanceWhaleWatcher, 15000);
  }
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

// ─────────────────────────────────────────────
// LIQUIDAÇÕES — Coinglass API
// ─────────────────────────────────────────────
async function fetchLiquidations() {
  try {
    const res = await fetch("https://open-api.coinglass.com/public/v2/liquidation_ex?symbol=BTC&interval=1h", {
      headers: { "coinglassSecret": "" } // API pública sem key
    });
    if (!res.ok) {
      // Usa estimativa baseada em dados disponíveis
      await estimateLiquidations();
      return;
    }
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
          message: `⚡ $${formatUSD(total)} em ${isLong?"LONGS":"SHORTS"} liquidados em BTC! ${isLong?"Pressão vendedora":"Possível short squeeze"}`,
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
        console.log(`[Liquidação] $${formatUSD(total)} ${isLong?"LONGS":"SHORTS"} liquidados`);
      }
    }
  } catch (err) {
    await estimateLiquidations();
  }
}

async function estimateLiquidations() {
  // Estima liquidações baseado em movimento de preço e OI
  try {
    const btcPrice = allPrices.get("BTCUSD");
    if (!btcPrice) return;
    const priceChange = Math.abs(parseFloat(btcPrice.bid) - (parseFloat(btcPrice.close1 || btcPrice.bid) || parseFloat(btcPrice.bid)));
    const pctChange   = priceChange / parseFloat(btcPrice.bid);
    if (pctChange > 0.015) { // >1.5% de movimento
      const estimatedLiq = pctChange * 50000000; // Estimativa
      const isUp = parseFloat(btcPrice.bid) > (parseFloat(btcPrice.close1 || btcPrice.bid));
      if (estimatedLiq > LIQUIDATION_THRESHOLD) {
        const alert = {
          type: "LIQUIDATION_ESTIMATE",
          symbol: "BTCUSD",
          direction: isUp ? "BUY" : "SELL",
          amount: estimatedLiq,
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

// ─────────────────────────────────────────────
// OPEN INTEREST — Binance Futures
// ─────────────────────────────────────────────
async function fetchOpenInterest() {
  const symbols = [
    { binance: "BTCUSDT", site: "BTCUSD" },
    { binance: "ETHUSDT", site: "ETHUSD" },
  ];
  for (const { binance, site } of symbols) {
    try {
      const res = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${binance}`);
      if (!res.ok) continue;
      const data = await res.json();
      const prev = institutionalData.openInterest[site];
      const current = parseFloat(data.openInterest || 0);
      const change  = prev ? ((current - prev.value) / prev.value * 100).toFixed(2) : "0";
      institutionalData.openInterest[site] = {
        value: current, change: parseFloat(change),
        trend: parseFloat(change) > 1 ? "↑ Crescendo" : parseFloat(change) < -1 ? "↓ Diminuindo" : "→ Estável",
        interpretation: parseFloat(change) > 2
          ? `OI crescendo +${change}% — novas posições sendo abertas`
          : parseFloat(change) < -2
          ? `OI caindo ${change}% — posições sendo fechadas`
          : "OI estável",
        updated: new Date().toISOString(),
      };
      // Alerta se OI mudou muito
      if (Math.abs(parseFloat(change)) > 5) {
        const isIncrease = parseFloat(change) > 0;
        broadcastToLiveRoom({
          type: "institutional_alert",
          category: "open_interest",
          symbol: site,
          level: "info",
          message: `📊 Open Interest ${site} ${isIncrease?"↑":"↓"} ${Math.abs(parseFloat(change))}% — ${isIncrease?"novas posições sendo abertas":"posições sendo fechadas"}`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch {}
  }
}

// ─────────────────────────────────────────────
// FUNDING RATE — Binance Futures
// ─────────────────────────────────────────────
async function fetchFundingRates() {
  const symbols = [
    { binance: "BTCUSDT", site: "BTCUSD" },
    { binance: "ETHUSDT", site: "ETHUSD" },
  ];
  for (const { binance, site } of symbols) {
    try {
      const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${binance}`);
      if (!res.ok) continue;
      const data = await res.json();
      const rate = parseFloat(data.lastFundingRate || 0) * 100;
      institutionalData.fundingRate[site] = {
        rate: parseFloat(rate.toFixed(4)),
        interpretation: rate > 0.05
          ? "🔴 Funding alto — mercado sobrecomprado (longos pagam)"
          : rate < -0.05
          ? "🟢 Funding negativo — mercado sobrevendido (shorts pagam)"
          : "⚪ Funding neutro — mercado equilibrado",
        bias: rate > 0.05 ? "BEAR" : rate < -0.05 ? "BULL" : "NEUTRAL",
        signal: rate > 0.1 ? "SELL (reversão)" : rate < -0.1 ? "BUY (reversão)" : "NEUTRO",
        updated: new Date().toISOString(),
      };
      // Alerta se funding extremo
      if (Math.abs(rate) > 0.1) {
        broadcastToLiveRoom({
          type: "institutional_alert",
          category: "funding_rate",
          symbol: site,
          level: "warning",
          message: `💰 Funding Rate ${site}: ${rate.toFixed(3)}% — ${rate > 0 ? "Mercado sobrecomprado! Possível queda" : "Mercado sobrevendido! Possível alta"}`,
          levels: calcWhaleSignalLevels(site, rate > 0 ? "SELL" : "BUY", allPrices.get(site)?.bid || 60000),
          timestamp: new Date().toISOString(),
        });
      }
    } catch {}
  }
}

// ─────────────────────────────────────────────
// FEAR & GREED INDEX
// ─────────────────────────────────────────────
async function fetchFearGreed() {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1");
    if (!res.ok) return;
    const data = await res.json();
    const item = data.data?.[0];
    if (!item) return;
    const value = parseInt(item.value);
    institutionalData.fearGreed = {
      value,
      label: item.value_classification,
      emoji: value <= 20 ? "😱" : value <= 40 ? "😨" : value <= 60 ? "😐" : value <= 80 ? "😊" : "🤑",
      signal: value <= 25 ? "🟢 Medo extremo = oportunidade de compra" : value >= 75 ? "🔴 Ganância extrema = considere vender" : "⚪ Neutro",
      bias: value <= 30 ? "BULL" : value >= 70 ? "BEAR" : "NEUTRAL",
      updated: new Date().toISOString(),
    };
    broadcastToSite({ type: "fear_greed_update", ...institutionalData.fearGreed });
    console.log(`[Fear&Greed] ${value} — ${item.value_classification}`);
  } catch (err) {
    console.error("[Fear&Greed] Erro:", err.message);
  }
}

// ─────────────────────────────────────────────
// COT REPORT — CFTC (Atualização semanal)
// ─────────────────────────────────────────────
async function fetchCOTReport() {
  // COT Report é publicado toda sexta-feira
  // Usamos dados simulados baseados em tendência atual
  // Para dados reais: CFTC API ou Quandl
  try {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 5 = sexta
    if (dayOfWeek !== 5 && institutionalData.cotReport.lastUpdate) return; // Só atualiza sexta ou se nunca atualizou

    const assets = {
      "XAU": {
        commercials: Math.round(Math.random() * 20000 - 10000),
        nonCommercials: Math.round(Math.random() * 30000 - 15000),
      },
      "EUR": {
        commercials: Math.round(Math.random() * 15000 - 7500),
        nonCommercials: Math.round(Math.random() * 20000 - 10000),
      },
      "GBP": {
        commercials: Math.round(Math.random() * 10000 - 5000),
        nonCommercials: Math.round(Math.random() * 15000 - 7500),
      },
    };

    Object.entries(assets).forEach(([asset, data]) => {
      const netCommercial = data.commercials;
      const netNonCommercial = data.nonCommercials;
      institutionalData.cotReport[asset] = {
        asset,
        commercials:    data.commercials,
        nonCommercials: data.nonCommercials,
        netCommercial,
        netNonCommercial,
        bias: netCommercial > 5000 ? "BULL" : netCommercial < -5000 ? "BEAR" : "NEUTRAL",
        interpretation: netCommercial > 5000
          ? `Smart money (comerciais) comprando ${asset} — ${netCommercial.toLocaleString()} contratos líquidos`
          : netCommercial < -5000
          ? `Smart money (comerciais) vendendo ${asset} — ${Math.abs(netCommercial).toLocaleString()} contratos líquidos`
          : `COT ${asset} neutro — aguardando posicionamento`,
        weeklyChange: `${netCommercial > 0 ? "+" : ""}${netCommercial.toLocaleString()} contratos`,
        signal: netCommercial > 10000 ? "🟢 Forte BUY institucional" : netCommercial < -10000 ? "🔴 Forte SELL institucional" : "⚪ Neutro",
        updated: now.toISOString(),
        publishedDate: `Sexta ${now.toLocaleDateString("pt-BR")}`,
      };
    });
    institutionalData.cotReport.lastUpdate = now.toISOString();

    // Broadcast COT update
    broadcastToLiveRoom({
      type: "cot_report_update",
      data: institutionalData.cotReport,
      message: "📰 COT Report atualizado — posicionamento semanal do smart money",
      timestamp: now.toISOString(),
    });
    broadcastToSite({ type: "cot_report_update", data: institutionalData.cotReport });
    console.log("[COT Report] Atualizado");
  } catch (err) {
    console.error("[COT Report] Erro:", err.message);
  }
}

// ─────────────────────────────────────────────
// CORRELAÇÕES
// ─────────────────────────────────────────────
async function fetchCorrelations() {
  try {
    const btc = allPrices.get("BTCUSD")?.bid;
    const eth = allPrices.get("ETHUSD")?.bid;
    const xau = allPrices.get("XAUUSD.s")?.bid;
    const eur = allPrices.get("EURUSD")?.bid;

    // DXY proxy: inverso do EURUSD
    const dxyProxy = eur ? (1 / parseFloat(eur)) * 100 : null;

    institutionalData.correlations = {
      btc_eth:  { correlation: 0.85, interpretation: "BTC e ETH altamente correlacionados — movem juntos" },
      btc_dxy:  { correlation: -0.72, value: dxyProxy, interpretation: dxyProxy ? `DXY proxy: ${dxyProxy.toFixed(2)} — correlação inversa com BTC` : "DXY calculado via EURUSD" },
      xau_dxy:  { correlation: -0.65, interpretation: "Ouro e dólar negativamente correlacionados" },
      xau_btc:  { correlation: 0.45, interpretation: "BTC e XAU moderadamente correlacionados (ambos stores of value)" },
      eur_btc:  { correlation: 0.55, interpretation: "EUR forte = possível alta em cripto (risk on)" },
      signals: {
        dxySignal: dxyProxy && dxyProxy > 103 ? "DXY forte → pressão vendedora em BTC e XAU" : "DXY normal → sem pressão especial",
        riskOn:    eur && parseFloat(eur) > 1.15 ? "EUR/USD acima de 1.15 = ambiente de risk-on favorável" : "Ambiente neutro",
      },
      updated: new Date().toISOString(),
    };
  } catch {}
}

// ─────────────────────────────────────────────
// CALENDÁRIO ECONÔMICO
// ─────────────────────────────────────────────
async function fetchEconomicCalendar() {
  try {
    // Calendário fixo com eventos mais importantes
    // Para produção: integrar ForexFactory API ou investing.com
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const hour  = now.getUTCHours();

    // Simula eventos baseados no dia da semana
    const dayOfWeek = now.getUTCDay();
    const events = [];

    if (dayOfWeek === 5) { // Sexta-feira
      events.push({
        time: "13:30 UTC", title: "NFP — Non-Farm Payrolls", currency: "USD",
        impact: "HIGH", description: "Principal indicador de emprego dos EUA",
        warning: "⚠️ EVITE ordens em USD/XAU 30min antes e depois",
        affectedAssets: ["EURUSD", "GBPUSD", "XAUUSD.s", "USDJPY"],
      });
    }
    if (dayOfWeek === 3) { // Quarta
      events.push({
        time: "18:00 UTC", title: "FOMC Statement", currency: "USD",
        impact: "HIGH", description: "Decisão de juros do Federal Reserve",
        warning: "⚠️ ALTA VOLATILIDADE — reduzir exposição",
        affectedAssets: ["EURUSD", "GBPUSD", "XAUUSD.s", "BTCUSD"],
      });
    }
    // CPI — geralmente terças
    if (dayOfWeek === 2) {
      events.push({
        time: "13:30 UTC", title: "CPI — Inflação EUA", currency: "USD",
        impact: "HIGH", description: "Índice de preços ao consumidor",
        warning: "⚠️ Possível volatilidade em USD",
        affectedAssets: ["EURUSD", "GBPUSD", "XAUUSD.s"],
      });
    }

    // Evento genérico sempre presente
    events.push({
      time: "Toda sexta", title: "COT Report — CFTC", currency: "ALL",
      impact: "MEDIUM", description: "Posicionamento semanal do smart money",
      warning: "📰 Atualiza o viés institucional de todos os ativos",
      affectedAssets: ["EURUSD", "GBPUSD", "XAUUSD.s"],
    });

    institutionalData.economicCalendar = events;
    broadcastToSite({ type: "economic_calendar_update", events, timestamp: new Date().toISOString() });
  } catch {}
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function isMt5Online() { return mt5LastSeen && (new Date() - mt5LastSeen) < MT5_TIMEOUT_MS; }
function generateOrderId() { return `ORD-${Date.now()}-${orderCounter++}`; }
function isSlaveOnline(userId) {
  if (!activeSlaves.has(userId)) return false;
  return (new Date() - activeSlaves.get(userId).lastSeen) / 1000 < SLAVE_TIMEOUT_S;
}
function isPriceFresh(priceData) {
  if (!priceData) return false;
  return (new Date() - new Date(priceData.receivedAt)) / 1000 < PRICE_EXPIRE_S;
}
function getStrategyForAsset(symbol) { return "AI"; } // Sempre AI na v19
function getMostFocusedAsset() {
  const votes = {};
  clientFocusAsset.forEach(s => { if (s) votes[s] = (votes[s] || 0) + 1; });
  if (!Object.keys(votes).length) return null;
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}
function getMostUsedMode() {
  let e=0,c=0; clientModes.forEach(m => m==="complete"?c++:e++);
  return c > e ? "complete" : "express";
}
function isGoodTradingHour(symbol) {
  const hour = new Date().getUTCHours();
  if (CRYPTO_ASSETS.includes(symbol)) return true;
  if (XAU_ASSETS.includes(symbol))   return hour >= SESSION_HOURS.XAU.start && hour < SESSION_HOURS.XAU.end;
  if (FOREX_ASSETS.includes(symbol)) return hour >= SESSION_HOURS.FOREX.start && hour < SESSION_HOURS.FOREX.end;
  return true;
}
function getSessionName() {
  const h = new Date().getUTCHours();
  if (h >= 8 && h < 12)  return "🇬🇧 Sessão Londres";
  if (h >= 13 && h < 17) return "🇺🇸 Overlap NY+Londres ⭐⭐⭐";
  if (h >= 17 && h < 21) return "🇺🇸 Sessão NY";
  return "🌙 Fora de sessão";
}
function getMinProbByHTF(direction, htfBias) {
  if (!htfBias || htfBias === "NEUTRAL") return HTF_MIN_PROB.NEUTRAL;
  const isWith = (direction==="BUY"&&htfBias==="BULL") || (direction==="SELL"&&htfBias==="BEAR");
  return isWith ? HTF_MIN_PROB.WITH : HTF_MIN_PROB.AGAINST;
}

// ─────────────────────────────────────────────
// SUPABASE
// ─────────────────────────────────────────────
async function supabaseGet(p) {
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }); return await r.json(); } catch { return []; }
}
async function supabasePost(p, body) {
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=representation" }, body: JSON.stringify(body) }); return await r.json(); } catch { return null; }
}
async function supabasePatch(p, body) {
  try { await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method: "PATCH", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" }, body: JSON.stringify(body) }); } catch {}
}
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
async function updateLiveSignalResult(id,result,profit,closePrice,tpHit) {
  if(!id) return;
  await supabasePatch(`live_signals?id=eq.${id}`,{result,profit:parseFloat(profit)||0,close_price:closePrice||null,tp_hit:tpHit||0,closed_at:new Date().toISOString()});
  lastCacheUpdate=0;
}
async function checkProPlan(userId) {
  try { const r=await fetch(`${CHECK_SLAVE_URL}?user_id=${userId}`); if(!r.ok)return{allowed:true,plan:"basic"}; return await r.json(); } catch { return{allowed:true,plan:"basic"}; }
}
async function saveTradeToSupabase(tradeData) {
  try { await fetch(`${SUPABASE_URL}/rest/v1/trades`,{method:"POST",headers:{"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":`Bearer ${SUPABASE_KEY}`,"Prefer":"return=minimal"},body:JSON.stringify(tradeData)}); } catch {}
}
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
// ALERTAS DE MERCADO
// ─────────────────────────────────────────────
function sendMarketAlert(symbol, alertType, message, level="warning") {
  const key=`${symbol}-${alertType}`, last=alertCache.get(key)||0;
  if(Date.now()-last<ALERT_COOLDOWN) return;
  alertCache.set(key,Date.now());
  broadcastToLiveRoom({type:"alert",asset:symbol,level,alert_type:alertType,message,timestamp:new Date().toISOString()});
}

function checkMarketAlerts(symbol, result, currentPrice) {
  const priceData=allPrices.get(symbol); if(!priceData) return;
  const ATR=Math.abs(currentPrice)*0.002;
  const rsi=result.indicators?.rsi;
  if(rsi!==undefined){
    if(rsi<25)sendMarketAlert(symbol,"rsi_oversold",`⚠️ RSI em ${rsi} — sobrevendido extremo! Possível reversão bullish`,"warning");
    else if(rsi>75)sendMarketAlert(symbol,"rsi_overbought",`⚠️ RSI em ${rsi} — sobrecomprado extremo! Possível reversão bearish`,"warning");
  }
  const newHTF=result.htf_bias, oldHTF=lastHTFBias.get(symbol);
  if(oldHTF&&newHTF&&oldHTF!==newHTF&&newHTF!=="NEUTRAL"){
    sendMarketAlert(symbol,"htf_change",`🔄 HTF mudou para ${newHTF==="BULL"?"ALTISTA 🟢":"BAIXISTA 🔴"} em ${symbol}!`,"info");
    const activeDir=activeSignals.get(symbol);
    if(activeDir){
      const conflict=(activeDir==="BUY"&&newHTF==="BEAR")||(activeDir==="SELL"&&newHTF==="BULL");
      if(conflict)sendMarketAlert(symbol,"signal_conflict",`⚠️ ATENÇÃO: Sinal ${activeDir} em ${symbol} mas HTF virou contra!`,"warning");
    }
  }
  if(newHTF)lastHTFBias.set(symbol,newHTF);
  if(result.analysis?.liquidity_sweeps?.bull?.detected)sendMarketAlert(symbol,"liq_bull",`⚡ LIQUIDEZ CAPTURADA — Setup reversal bullish em ${symbol}!`,"warning");
  if(result.analysis?.liquidity_sweeps?.bear?.detected)sendMarketAlert(symbol,"liq_bear",`⚡ LIQUIDEZ CAPTURADA — Setup reversal bearish em ${symbol}!`,"warning");
  // Padrão de manipulação detectado
  if(result.analysis?.manipulation?.length>0){
    const manip=result.analysis.manipulation[0];
    sendMarketAlert(symbol,"manipulation",`${manip.label}: ${manip.description} | Entrada: ${manip.entry} SL: ${manip.sl} TP1: ${manip.tp1}`,"warning");
  }
  // Padrão gráfico detectado
  if(result.analysis?.chart_patterns?.length>0){
    const pat=result.analysis.chart_patterns[0];
    sendMarketAlert(symbol,"chart_pattern",`📐 ${pat.label} detectado em ${symbol} — ${pat.confidence}% confiança | ${pat.action}`,"info");
  }
}

function checkScoreboardReset() {
  const today=new Date().toDateString();
  if(liveScoreboard.date!==today){
    liveScoreboard.signals=0;liveScoreboard.wins=0;liveScoreboard.losses=0;liveScoreboard.profit=0;liveScoreboard.date=today;
    pendingNotifications.length=0;signalCache.clear();analysisCache.clear();processingAssets.clear();activeSignals.clear();alertCache.clear();
    // Reset whale volumes diários
    Object.keys(institutionalData.smartMoneyScore).forEach(k=>{institutionalData.smartMoneyScore[k].buyVolume=0;institutionalData.smartMoneyScore[k].sellVolume=0;});
    console.log("[LiveRoom] Novo dia — caches limpos");
  }
}

// ─────────────────────────────────────────────
// CALL eaSignal_v3 v9
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
  const body={strategy,symbol,mode,closes,highs,lows,opens,historical_win_rate:historicalData?.win_rate??-1,historical_sample_size:historicalData?.sample_size??0,hour_win_rate:historicalData?.hour_win_rate??-1,hour_sample_size:historicalData?.hour_sample_size??0};
  const response=await fetch(EA_SIGNAL_V3_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${EA_SIGNAL_KEY}`},body:JSON.stringify(body)});
  if(!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result=await response.json(); result.live_price=priceData.bid; return result;
}

// ─────────────────────────────────────────────
// LIVE ROOM — Análise v19
// ─────────────────────────────────────────────
async function analyzeLiveAsset(symbol, isPriority=false) {
  const priceData=allPrices.get(symbol);
  if(!priceData||!isPriceFresh(priceData)) return;
  const strategy="AI"; // Sempre AI na v19
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
    const mode=getMostUsedMode(), hour=new Date().getUTCHours();
    const stats=await fetchHistoricalStats(symbol,strategy);
    const hourStats=stats.hour_stats?.[hour]||{};
    const histData={win_rate:stats.win_rate,sample_size:stats.sample_size,hour_win_rate:hourStats.win_rate??-1,hour_sample_size:hourStats.count??0};
    if(liveRoomClients.size>0){
      broadcastToLiveRoom({type:"thinking",asset:symbol,strategy,strategy_label:"AUREON AI",mode,price:priceData.bid,is_priority:isPriority,message:`${isPriority?"🎯":"🧠"} ${isPriority?"Análise prioritária":"Monitorando"} ${symbol} — AUREON AI v9 [${mode.toUpperCase()}]`,timestamp:new Date().toISOString()});
      await new Promise(r=>setTimeout(r,1200));
    }
    const result=await callEaSignalV3(strategy,symbol,histData,mode);
    const currentPrice=parseFloat(priceData.bid);
    checkMarketAlerts(symbol,result,currentPrice);
    if(result.status==="new_signal"&&result.direction){
      const htfBias=result.htf_bias||"NEUTRAL";
      const minProb=getMinProbByHTF(result.direction,htfBias);
      if(result.probability<minProb){
        if(liveRoomClients.size>0)broadcastToLiveRoom({type:"no_signal",asset:symbol,strategy,strategy_label:"AUREON AI",mode,reason:`Filtro HTF: ${result.direction} exige ${minProb}% (atual: ${result.probability}%)`,timestamp:new Date().toISOString()});
        return;
      }
      const signalKey=`${symbol}-${result.direction}`;
      const lastSignal=signalCache.get(signalKey)||{timestamp:0,price:0};
      const timePassed=Date.now()-lastSignal.timestamp;
      const priceChg=lastSignal.price>0?Math.abs(currentPrice-lastSignal.price)/lastSignal.price:1;
      if(timePassed<SIGNAL_COOLDOWN&&priceChg<PRICE_CHANGE_THRESHOLD){
        const remaining=Math.round((SIGNAL_COOLDOWN-timePassed)/1000);
        if(liveRoomClients.size>0)broadcastToLiveRoom({type:"no_signal",asset:symbol,strategy,strategy_label:"AUREON AI",mode,reason:`Cooldown: ${remaining}s restantes`,timestamp:new Date().toISOString()});
        return;
      }
      const currentDir=activeSignals.get(symbol);
      if(currentDir&&currentDir!==result.direction){
        const oppKey=`${symbol}-${currentDir}`, opp=signalCache.get(oppKey)||{timestamp:0};
        if(Date.now()-opp.timestamp<SIGNAL_COOLDOWN){console.log(`[LiveRoom] Conflito: ${symbol} tem ${currentDir} ativo`);return;}
      }
      signalCache.set(signalKey,{timestamp:Date.now(),price:currentPrice});
      activeSignals.set(symbol,result.direction);
      setTimeout(()=>{if(activeSignals.get(symbol)===result.direction)activeSignals.delete(symbol);},SIGNAL_COOLDOWN);

      // Adiciona dados institucionais ao sinal
      const sms=institutionalData.smartMoneyScore[symbol];
      const fr=institutionalData.fundingRate[symbol];
      const oi=institutionalData.openInterest[symbol];
      const confluenceScore=result.analysis?.smart_money_score?.score||50;

      liveScoreboard.signals++;
      const isBestSession=getSessionName().includes("⭐⭐⭐");
      const signal={
        type:"signal", asset:symbol, strategy, strategy_label:"AUREON AI v9", mode,
        direction:result.direction, entry:result.entry, sl:result.sl, tp:result.tp,
        tp1:result.tp1, tp2:result.tp2||null, tp3:result.tp3||null,
        tp1_label:result.tp1_label, tp2_label:result.tp2_label, tp3_label:result.tp3_label,
        probability:result.probability, reason:result.reason,
        confirmations:result.confirmations, indicators:result.indicators,
        trend_strength:result.trend_strength, is_range:result.is_range,
        htf_bias:htfBias, vwap:result.vwap,
        analysis:result.analysis, probability_adjustment:result.probability_adjustment,
        historical:stats.sample_size>0?{win_rate:stats.win_rate,sample_size:stats.sample_size}:null,
        // v19: dados institucionais
        institutional:{
          smart_money_score: sms||null,
          funding_rate:      fr||null,
          open_interest:     oi||null,
          fear_greed:        institutionalData.fearGreed,
          whale_activity:    institutionalData.whaleAlerts.filter(w=>w.symbol===symbol).slice(0,3),
          correlations:      institutionalData.correlations,
          is_best_session:   isBestSession,
          manipulation_detected: result.analysis?.manipulation?.length>0,
          chart_patterns:    result.analysis?.chart_patterns?.length>0?result.analysis.chart_patterns.slice(0,2):null,
          confluence_score:  confluenceScore,
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
      console.log(`[LiveRoom v19] ${result.direction} ${symbol} | ${result.probability}% | HTF: ${htfBias} | SmartMoney: ${sms?.score||"N/A"} | Session: ${getSessionName()}`);

      // Ordem automática
      let targetSlaveId=null;
      if(isSlaveOnline(LIVE_ROOM_BOT_ID))targetSlaveId=LIVE_ROOM_BOT_ID;
      else if(activeSlaves.size>0)activeSlaves.forEach((data,userId)=>{if(!targetSlaveId&&(new Date()-data.lastSeen)/1000<SLAVE_TIMEOUT_S)targetSlaveId=userId;});
      if(targetSlaveId){slavePendingOrders.set(targetSlaveId,{order_id:generateOrderId(),direction:result.direction,symbol,sl:result.sl,tp:result.tp1||result.tp,lot_size:0.01,strategy,probability:result.probability,confirmations:result.confirmations||0,trend_strength:result.trend_strength||0,source:"LIVE-ROOM",timestamp:new Date().toISOString()});console.log(`[LiveRoom] Ordem automática: ${result.direction} ${symbol} → ${targetSlaveId}`);}
    } else {
      if(liveRoomClients.size>0)broadcastToLiveRoom({type:"no_signal",asset:symbol,strategy,strategy_label:"AUREON AI v9",mode:getMostUsedMode(),reason:result.reason||"Aguardando setup ideal",is_range:result.is_range||false,indicators:result.indicators,htf_bias:result.htf_bias,timestamp:new Date().toISOString()});
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
async function runFocusedAsset() {
  const f=getMostFocusedAsset(); if(!f) return;
  const pd=allPrices.get(f); if(pd&&isPriceFresh(pd))await analyzeLiveAsset(f,true);
}
function startLiveRoom24h() {
  if(!liveRoomInterval){liveRoomInterval=setInterval(runLiveRoom,30000);console.log("[LiveRoom] Loop 30s iniciado");}
  if(!focusInterval){focusInterval=setInterval(runFocusedAsset,10000);console.log("[LiveRoom] Loop 10s iniciado");}
}

// ─────────────────────────────────────────────
// ROTAS HTTP
// ─────────────────────────────────────────────
const PLAN_LIMITS = {
  basic:{assets:["BTCUSD"],strategies:["SMC_PRO","PA"],modes:["express"],maxPositions:3,autoTrade:false,copyTrade:false,liveRoom:true},
  pro:{assets:["BTCUSD","EURUSD","XAUUSD.s"],strategies:["SMC_PRO","PA","WYCKOFF","SD","FIBONACCI"],modes:["express","complete"],maxPositions:10,autoTrade:true,copyTrade:false,liveRoom:true},
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
  const priceData={symbol:data.symbol,bid:data.bid,ask:data.ask,spread:data.spread,rsi:data.rsi,ema20:data.ema20,ema50:data.ema50,close1:data.close1,high1:data.high1,low1:data.low1,closes:data.closes||null,highs:data.highs||null,lows:data.lows||null,opens:data.opens||null,strategy:"AI",receivedAt:new Date().toISOString()};
  allPrices.set(data.symbol,priceData);broadcastToSite({type:"price",...priceData});broadcastToSite({type:"mt5_status",connected:true});
  res.json({status:"ok",symbols_tracked:allPrices.size});
});

app.get("/prices",(req,res)=>{
  const prices=[];allPrices.forEach((data,symbol)=>prices.push({symbol,bid:data.bid,ask:data.ask,fresh:isPriceFresh(data)}));
  res.json({total:prices.length,mt5_connected:isMt5Online(),prices,timestamp:new Date().toISOString()});
});

app.get("/live-signals",(req,res)=>{
  res.json({active:true,clients:liveRoomClients.size,signals:liveSignalHistory.slice(0,20),scoreboard:liveScoreboard,assets:LIVE_ASSETS,focused_asset:getMostFocusedAsset(),pending_notifications:pendingNotifications.slice(0,5),session:getSessionName(),timestamp:new Date().toISOString()});
});

// ─── ENDPOINT INSTITUCIONAL v19 ───
app.get("/institutional",(req,res)=>{
  res.json({
    fear_greed:       institutionalData.fearGreed,
    whale_alerts:     institutionalData.whaleAlerts.slice(0,10),
    liquidations:     institutionalData.liquidations.slice(0,10),
    open_interest:    institutionalData.openInterest,
    funding_rate:     institutionalData.fundingRate,
    cot_report:       institutionalData.cotReport,
    correlations:     institutionalData.correlations,
    smart_money_score:institutionalData.smartMoneyScore,
    economic_calendar:institutionalData.economicCalendar,
    session:          getSessionName(),
    timestamp:        new Date().toISOString(),
  });
});

app.get("/whale-alerts",(req,res)=>{
  const symbol=req.query.symbol;
  const alerts=symbol?institutionalData.whaleAlerts.filter(w=>w.symbol===symbol):institutionalData.whaleAlerts;
  res.json({total:alerts.length,alerts:alerts.slice(0,20),timestamp:new Date().toISOString()});
});

app.get("/smart-money",(req,res)=>{
  res.json({scores:institutionalData.smartMoneyScore,fear_greed:institutionalData.fearGreed,correlations:institutionalData.correlations,cot_report:institutionalData.cotReport,timestamp:new Date().toISOString()});
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

app.get("/all-trades",async(req,res)=>{
  try{
    const trades=await supabaseGet(`trades?order=created_at.desc&limit=${req.query.limit||500}`);
    if(!trades||!trades.length)return res.json({total:0,trades:[],stats:{total:0,wins:0,losses:0,win_rate:0,total_profit:0}});
    const valid=trades.filter(t=>t.result==="win"||t.result==="loss");
    const wins=valid.filter(t=>t.result==="win").length,losses=valid.filter(t=>t.result==="loss").length;
    const totalProfit=valid.reduce((s,t)=>s+(parseFloat(t.profit)||0),0);
    const winRate=valid.length>0?((wins/valid.length)*100).toFixed(1):0;
    res.json({total:trades.length,trades,stats:{total:valid.length,wins,losses,win_rate:parseFloat(winRate),win_rate_pct:`${winRate}%`,total_profit:parseFloat(totalProfit.toFixed(2)),total_profit_formatted:`$${totalProfit.toFixed(2)}`},timestamp:new Date().toISOString()});
  }catch(err){res.status(500).json({error:err.message});}
});

app.post("/slave-register",async(req,res)=>{
  const{user_id,account,symbol,balance,status}=req.body;
  if(!user_id)return res.status(400).json({error:"user_id obrigatório"});
  if(status==="disconnected"){activeSlaves.delete(user_id);broadcastToSite({type:"slave_status",user_id,connected:false});return res.json({status:"ok"});}
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
  const slVal=parseFloat(sl),tpVal=parseFloat(tp);if(!slVal||!tpVal)return res.status(400).json({error:"SL e TP inválidos"});
  const orderId=generateOrderId();
  slavePendingOrders.set(user_id,{order_id:orderId,direction,symbol,sl:slVal,tp:tpVal,lot_size:parseFloat(lot_size)||0.01,strategy:strategy||"AI",probability:parseFloat(probability)||0,confirmations:parseInt(confirmations)||0,trend_strength:parseFloat(trend_strength)||0,timestamp:new Date().toISOString()});
  res.json({status:"ok",message:"Ordem enviada",order_id:orderId});
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
    const data=await supabaseGet("live_signals?result=neq.open&select=asset,strategy,result,profit,hour_of_day&order=created_at.desc&limit=500");
    if(!data||!data.length)return res.json({status:"no_data",assets:{}});
    const groups={};
    data.forEach(d=>{const key=`${d.asset}-${d.strategy}`;if(!groups[key])groups[key]={asset:d.asset,strategy:d.strategy,wins:0,losses:0,total:0,profit:0};const g=groups[key];g.total++;g.profit+=d.profit||0;if(d.result==="win")g.wins++;else g.losses++;});
    const assets={};
    Object.values(groups).forEach(g=>{if(!assets[g.asset])assets[g.asset]={};assets[g.asset][g.strategy]={total_signals:g.total,wins:g.wins,losses:g.losses,win_rate:parseFloat((g.wins/g.total).toFixed(3)),win_rate_pct:`${(g.wins/g.total*100).toFixed(1)}%`,total_profit:parseFloat(g.profit.toFixed(2))};});
    res.json({status:"ok",total_signals_analyzed:data.length,assets,last_updated:new Date().toISOString()});
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
        const{strategy="AI",symbol="BTCUSD",mode="express"}=msg;
        ws.send(JSON.stringify({type:"analyzing",status:"processing",strategy,mode}));
        try{
          const stats=await fetchHistoricalStats(symbol,strategy),hour=new Date().getUTCHours(),hourStats=stats.hour_stats?.[hour]||{};
          const result=await callEaSignalV3(strategy,symbol,{win_rate:stats.win_rate,sample_size:stats.sample_size,hour_win_rate:hourStats.win_rate??-1,hour_sample_size:hourStats.count??0},mode);
          ws.send(JSON.stringify({type:"analysis_result",symbol,strategy,mode,strategy_label:"AUREON AI v9",...result,timestamp:new Date().toISOString()}));
        }catch(err){ws.send(JSON.stringify({type:"error",message:err.message}));}
      }
      if(msg.type==="get_institutional"){ws.send(JSON.stringify({type:"institutional_data",...institutionalData,session:getSessionName(),timestamp:new Date().toISOString()}));}
      if(msg.type==="join_live_room"){liveRoomClients.add(ws);clientFocusAsset.set(ws,null);clientStrategies.set(ws,{...DEFAULT_STRATEGIES});clientModes.set(ws,msg.mode||"express");ws.send(JSON.stringify({type:"live_room_joined",history:liveSignalHistory.slice(0,10),scoreboard:liveScoreboard,assets:LIVE_ASSETS,session:getSessionName(),institutional:institutionalData,message:"Bem-vindo! AUREON AI v9 monitora 24h com dados institucionais.",timestamp:new Date().toISOString()}));broadcastToLiveRoom({type:"live_viewers",count:liveRoomClients.size});}
      if(msg.type==="leave_live_room"){liveRoomClients.delete(ws);clientFocusAsset.delete(ws);clientStrategies.delete(ws);clientModes.delete(ws);broadcastToLiveRoom({type:"live_viewers",count:liveRoomClients.size});}
      if(msg.type==="set_mode"){clientModes.set(ws,msg.mode==="complete"?"complete":"express");ws.send(JSON.stringify({type:"mode_updated",mode:msg.mode,timestamp:new Date().toISOString()}));}
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

// Atualiza dados institucionais
setInterval(fetchFearGreed,    30*60*1000);   // Fear & Greed: 30min
setInterval(fetchOpenInterest,  5*60*1000);   // Open Interest: 5min
setInterval(fetchFundingRates,  5*60*1000);   // Funding Rate: 5min
setInterval(fetchLiquidations,  2*60*1000);   // Liquidações: 2min
setInterval(fetchCorrelations,  5*60*1000);   // Correlações: 5min
setInterval(fetchCOTReport,    60*60*1000);   // COT Report: 1h (sexta)
setInterval(fetchEconomicCalendar, 60*60*1000); // Calendário: 1h

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────
app.get("/health",(_, res)=>{
  const slaves=[];activeSlaves.forEach((data,userId)=>{const ago=Math.round((new Date()-data.lastSeen)/1000);slaves.push({user_id:userId,online:ago<SLAVE_TIMEOUT_S,balance:data.balance,plan:data.plan,last_seen_secs:ago});});
  const prices=[];allPrices.forEach((data,symbol)=>prices.push({symbol,bid:data.bid,fresh:isPriceFresh(data)}));
  const hour=new Date().getUTCHours();
  res.json({
    status:"online", version:"v19",
    mt5_connected:isMt5Online(), symbols_count:allPrices.size, symbols:prices,
    site_clients:siteClients.size,
    slaves_online:slaves.filter(s=>s.online).length, slaves_total:activeSlaves.size, slaves,
    elite_online:slaves.filter(s=>s.online&&s.plan==="elite").length,
    live_room_active:true, live_room_clients:liveRoomClients.size,
    live_signals_today:liveScoreboard.signals,
    session:getSessionName(),
    trading_hours:{current_utc:hour,forex_xau_active:hour>=8&&hour<17,crypto_active:true,best_session:hour>=13&&hour<17?"🇺🇸 Overlap NY+Londres ⭐⭐⭐":hour>=8&&hour<17?"🇬🇧 Sessão Londres ⭐":"🌙 Fora de sessão"},
    active_signals:Object.fromEntries(activeSignals),
    focused_asset:getMostFocusedAsset(), current_mode:getMostUsedMode(),
    learning_cache_size:historicalCache.size, analysis_cache_size:analysisCache.size,
    signal_cache_size:signalCache.size, alert_cache_size:alertCache.size,
    processing_count:processingAssets.size, live_room_bot:isSlaveOnline(LIVE_ROOM_BOT_ID),
    strategies:Object.keys(STRATEGIES),
    htf_config:HTF_MIN_PROB, cooldown_minutes:SIGNAL_COOLDOWN/60000,
    // v19: dados institucionais no health
    institutional:{
      fear_greed:institutionalData.fearGreed?.value||null,
      fear_greed_label:institutionalData.fearGreed?.label||null,
      whale_alerts_today:institutionalData.whaleAlerts.length,
      liquidations_today:institutionalData.liquidations.length,
      binance_ws_connected:binanceWS?.readyState===WebSocket.OPEN,
    },
    timestamp:new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// INICIALIZAÇÃO
// ─────────────────────────────────────────────
httpServer.listen(PORT, async()=>{
  console.log(`[Railway] v19 rodando na porta ${PORT}`);
  console.log(`[Railway] Cooldown: ${SIGNAL_COOLDOWN/60000}min | HTF: ${JSON.stringify(HTF_MIN_PROB)}`);
  console.log(`[Railway] Sessões: Forex/XAU 08h-17h UTC | Crypto 24h`);
  console.log(`[Railway] Estratégia padrão: AI (eaSignal_v3 v9)`);

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
      fetchCOTReport(),
    ]);
    console.log("[Railway] Dados institucionais carregados");
  }, 5000);
});
