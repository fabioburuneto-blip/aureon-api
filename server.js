/**
 * TraderAureonia AI — Servidor Railway v18
 * - Filtro de horário por sessão (Londres + NY)
 * - Filtro HTF (a favor/neutro/contra tendência)
 * - Cooldown 15 minutos
 * - Alertas de mudança de mercado
 * - Ordens automáticas do Live Room
 * - Trava de processamento simultâneo
 */

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");
const path = require("path");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

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

const STRATEGIES = {
  SMC_PRO:   { label: "SMC Pro",        plan: "basic" },
  PA:        { label: "Price Action",    plan: "basic" },
  WYCKOFF:   { label: "Wyckoff",         plan: "pro"   },
  SD:        { label: "Supply & Demand", plan: "pro"   },
  FIBONACCI: { label: "Fibonacci",       plan: "pro"   },
  AI:        { label: "IA (Todas)",      plan: "elite" },
};

// ─── CONFIGURAÇÃO DE HORÁRIOS ───
const SESSION_HOURS = {
  // Forex e XAU: só opera nas sessões Londres e NY
  FOREX: { start: 8, end: 17 }, // 08h-17h UTC (05h-14h BR)
  XAU:   { start: 8, end: 17 }, // 08h-17h UTC (05h-14h BR)
  // Crypto: 24h sem restrição
  CRYPTO: null,
};

// Ativos por tipo
const FOREX_ASSETS  = ["EURUSD", "GBPUSD"];
const XAU_ASSETS    = ["XAUUSD.s"];
const CRYPTO_ASSETS = ["BTCUSD", "ETHUSD"];

// ─── CONFIGURAÇÃO HTF ───
const HTF_MIN_PROB = {
  WITH:    65, // A favor da tendência
  NEUTRAL: 70, // Tendência neutra
  AGAINST: 78, // Contra a tendência
};

// ─── CONFIGURAÇÃO DE COOLDOWN ───
const SIGNAL_COOLDOWN        = 15 * 60 * 1000; // 15 minutos
const ALERT_COOLDOWN         = 3  * 60 * 1000; // 3 minutos para alertas
const PRICE_CHANGE_THRESHOLD = 0.002;           // 0.2% mudança mínima
const PRICE_ALERT_THRESHOLD  = 0.005;           // 0.5% = movimento brusco

const siteClients        = new Set();
const allPrices          = new Map();
let   mt5LastSeen        = null;
const activeSlaves       = new Map();
const slavePendingOrders = new Map();
const slaveExecutions    = [];
let   orderCounter       = 1;

const liveRoomClients      = new Set();
const liveSignalHistory    = [];
let   liveRoomInterval     = null;
let   focusInterval        = null;
const clientFocusAsset     = new Map();
const clientStrategies     = new Map();
const clientModes          = new Map();
const pendingNotifications = [];

// ─── CACHES E TRAVAS ───
const analysisCache    = new Map();
const signalCache      = new Map();   // symbol-direction → { timestamp, price }
const alertCache       = new Map();   // symbol-alertType → timestamp
const processingAssets = new Set();
const activeSignals    = new Map();   // symbol → direção ativa
const lastHTFBias      = new Map();   // symbol → último htf_bias

const historicalCache = new Map();
let   lastCacheUpdate = 0;
const CACHE_TTL_MS    = 5 * 60 * 1000;

const ANALYSIS_INTERVAL_PRIORITY = 30 * 1000;
const ANALYSIS_INTERVAL_NORMAL   = 60 * 1000;

const LIVE_ROOM_BOT_ID = "LIVE-ROOM-BOT";

const LIVE_ASSETS = ["BTCUSD", "XAUUSD.s", "EURUSD", "GBPUSD", "ETHUSD"];
const DEFAULT_STRATEGIES = {
  BTCUSD: "SMC_PRO", "XAUUSD.s": "SMC_PRO",
  EURUSD: "PA", GBPUSD: "SD", ETHUSD: "FIBONACCI",
};

const liveScoreboard = { signals: 0, wins: 0, losses: 0, profit: 0, date: new Date().toDateString() };

const PLAN_LIMITS = {
  basic: { assets: ["BTCUSD"], strategies: ["SMC_PRO","PA"], modes: ["express"], maxPositions: 3, autoTrade: false, copyTrade: false, liveRoom: true },
  pro:   { assets: ["BTCUSD","EURUSD","XAUUSD.s"], strategies: ["SMC_PRO","PA","WYCKOFF","SD","FIBONACCI"], modes: ["express","complete"], maxPositions: 10, autoTrade: true, copyTrade: false, liveRoom: true },
  elite: { assets: "ALL", strategies: ["SMC_PRO","PA","WYCKOFF","SD","FIBONACCI","AI"], modes: ["express","complete"], maxPositions: 20, autoTrade: true, copyTrade: true, liveRoom: true },
};
function getPlanLimits(plan) { return PLAN_LIMITS[plan] || PLAN_LIMITS.basic; }

// ─────────────────────────────────────────────
// FILTRO DE HORÁRIO
// ─────────────────────────────────────────────
function isGoodTradingHour(symbol) {
  const hour = new Date().getUTCHours();

  // Crypto: sempre pode operar
  if (CRYPTO_ASSETS.includes(symbol)) return true;

  // XAU: sessões Londres e NY
  if (XAU_ASSETS.includes(symbol)) {
    const { start, end } = SESSION_HOURS.XAU;
    return hour >= start && hour < end;
  }

  // Forex: sessões Londres e NY
  if (FOREX_ASSETS.includes(symbol)) {
    const { start, end } = SESSION_HOURS.FOREX;
    return hour >= start && hour < end;
  }

  return true;
}

function getSessionName() {
  const hour = new Date().getUTCHours();
  if (hour >= 8 && hour < 12)  return "🇬🇧 Sessão Londres";
  if (hour >= 12 && hour < 13) return "🌍 Transição";
  if (hour >= 13 && hour < 17) return "🇺🇸 Overlap NY+Londres ⭐⭐⭐";
  if (hour >= 17 && hour < 21) return "🇺🇸 Sessão NY";
  return "🌙 Fora de sessão";
}

// ─────────────────────────────────────────────
// FILTRO HTF
// ─────────────────────────────────────────────
function getMinProbByHTF(direction, htfBias) {
  if (!htfBias || htfBias === "NEUTRAL") return HTF_MIN_PROB.NEUTRAL;
  const isWith = (direction === "BUY" && htfBias === "BULL") ||
                 (direction === "SELL" && htfBias === "BEAR");
  if (isWith) return HTF_MIN_PROB.WITH;
  return HTF_MIN_PROB.AGAINST;
}

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
function getStrategyForAsset(symbol) {
  const votes = {};
  clientStrategies.forEach((s) => { const st = s[symbol]; if (st) votes[st] = (votes[st] || 0) + 1; });
  if (Object.keys(votes).length === 0) return DEFAULT_STRATEGIES[symbol] || "SMC_PRO";
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}
function getMostFocusedAsset() {
  const votes = {};
  clientFocusAsset.forEach((symbol) => { if (symbol) votes[symbol] = (votes[symbol] || 0) + 1; });
  if (Object.keys(votes).length === 0) return null;
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}
function getMostUsedMode() {
  let express = 0, complete = 0;
  clientModes.forEach(m => m === "complete" ? complete++ : express++);
  return complete > express ? "complete" : "express";
}

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
  const key = `${asset}-${strategy}`; const now = Date.now();
  if (historicalCache.has(key) && (now - lastCacheUpdate) < CACHE_TTL_MS) return historicalCache.get(key);
  try {
    const data = await supabaseGet(`live_signals?asset=eq.${encodeURIComponent(asset)}&strategy=eq.${strategy}&result=neq.open&select=result,profit,hour_of_day&order=created_at.desc&limit=200`);
    if (!data || data.length === 0) { const e = { win_rate: -1, sample_size: 0, hour_stats: {} }; historicalCache.set(key, e); return e; }
    const wins = data.filter(d => d.result === "win").length;
    const hg = {};
    data.forEach(d => { const h = d.hour_of_day; if (h == null) return; if (!hg[h]) hg[h] = { wins: 0, total: 0 }; hg[h].total++; if (d.result === "win") hg[h].wins++; });
    const hour_stats = {};
    Object.entries(hg).forEach(([h, s]) => { hour_stats[h] = { win_rate: s.wins / s.total, count: s.total }; });
    const result = { win_rate: wins / data.length, sample_size: data.length, hour_stats };
    historicalCache.set(key, result); lastCacheUpdate = now; return result;
  } catch { return { win_rate: -1, sample_size: 0, hour_stats: {} }; }
}

async function saveLiveSignal(signal) {
  const now = new Date();
  const data = { asset: signal.asset, strategy: signal.strategy, direction: signal.direction, entry_price: signal.entry, sl: signal.sl, tp1: signal.tp1, tp2: signal.tp2 || null, tp3: signal.tp3 || null, probability: signal.probability, confirmations: signal.confirmations || 0, rsi: signal.indicators?.rsi || null, ema9: signal.indicators?.ema9 || null, ema21: signal.indicators?.ema21 || null, atr: signal.indicators?.atr || null, trend_strength: signal.trend_strength || null, is_range: signal.is_range || false, hour_of_day: now.getUTCHours(), day_of_week: now.getUTCDay(), result: "open" };
  try {
    const saved = await supabasePost("live_signals", data);
    if (saved && saved[0]) signal.supabase_id = saved[0].id;
  } catch(err) { console.error("[Supabase] ❌ Erro:", err.message); }
}

async function updateLiveSignalResult(id, result, profit, closePrice, tpHit) {
  if (!id) return;
  await supabasePatch(`live_signals?id=eq.${id}`, { result, profit: parseFloat(profit) || 0, close_price: closePrice || null, tp_hit: tpHit || 0, closed_at: new Date().toISOString() });
  lastCacheUpdate = 0;
}

async function checkProPlan(userId) {
  try { const r = await fetch(`${CHECK_SLAVE_URL}?user_id=${userId}`); if (!r.ok) return { allowed: true, plan: "basic" }; return await r.json(); } catch { return { allowed: true, plan: "basic" }; }
}

async function saveTradeToSupabase(tradeData) {
  try { await fetch(`${SUPABASE_URL}/rest/v1/trades`, { method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" }, body: JSON.stringify(tradeData) }); } catch {}
}

async function activateUserPlan(email, plan, months) {
  try {
    const sr = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,plan`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });
    const users = await sr.json();
    const exp = new Date(); exp.setMonth(exp.getMonth() + (months || 1));
    if (users && users.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" }, body: JSON.stringify({ plan, plan_expires_at: exp.toISOString() }) });
      console.log(`[Hotmart] Plano ${plan} ativado para ${email}`);
    }
  } catch {}
}

function broadcastToSite(data) { const msg = JSON.stringify(data); siteClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); }); }
function broadcastToLiveRoom(data) { const msg = JSON.stringify(data); liveRoomClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); }); }
function notifyAllClients(signal) {
  const n = JSON.stringify({ type: "live_signal_notification", asset: signal.asset, direction: signal.direction, strategy: signal.strategy, strategy_label: STRATEGIES[signal.strategy]?.label || signal.strategy, probability: signal.probability, mode: signal.mode || "express", entry: signal.entry, sl: signal.sl, tp1: signal.tp1, hora: signal.hora, message: `${signal.direction === "BUY" ? "🟢" : "🔴"} ${signal.direction} em ${signal.asset} — ${signal.probability}%`, timestamp: new Date().toISOString() });
  siteClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(n); });
  pendingNotifications.unshift({ ...signal, notified_at: new Date().toISOString() });
  if (pendingNotifications.length > 5) pendingNotifications.pop();
}

// ─────────────────────────────────────────────
// ALERTAS DE MERCADO (sem cooldown de sinal)
// ─────────────────────────────────────────────
function sendMarketAlert(symbol, alertType, message, level = "warning") {
  const alertKey = `${symbol}-${alertType}`;
  const lastAlert = alertCache.get(alertKey) || 0;
  if (Date.now() - lastAlert < ALERT_COOLDOWN) return; // 3 min entre alertas
  alertCache.set(alertKey, Date.now());

  broadcastToLiveRoom({
    type: "alert",
    asset: symbol,
    level,
    alert_type: alertType,
    message,
    timestamp: new Date().toISOString()
  });
  console.log(`[Alerta] ${symbol}: ${message}`);
}

function checkMarketAlerts(symbol, result, currentPrice) {
  const priceData = allPrices.get(symbol);
  if (!priceData) return;

  // 1. Movimento brusco de preço
  const lastPrice = parseFloat(priceData.bid);
  if (lastPrice > 0) {
    const priceMove = Math.abs(currentPrice - lastPrice) / lastPrice;
    if (priceMove >= PRICE_ALERT_THRESHOLD) {
      const direction = currentPrice > lastPrice ? "📈 subiu" : "📉 caiu";
      sendMarketAlert(symbol, "price_move",
        `⚡ ${symbol} ${direction} ${(priceMove * 100).toFixed(2)}% rapidamente! Fique atento.`,
        "warning"
      );
    }
  }

  // 2. RSI extremo
  const rsi = result.indicators?.rsi;
  if (rsi !== undefined) {
    if (rsi < 25) sendMarketAlert(symbol, "rsi_oversold", `⚠️ RSI em ${rsi} — sobrevendido extremo! Possível reversão de alta`, "warning");
    else if (rsi > 75) sendMarketAlert(symbol, "rsi_overbought", `⚠️ RSI em ${rsi} — sobrecomprado extremo! Possível reversão de baixa`, "warning");
  }

  // 3. Mudança de HTF Bias
  const newHTF = result.htf_bias;
  const oldHTF = lastHTFBias.get(symbol);
  if (oldHTF && newHTF && oldHTF !== newHTF && newHTF !== "NEUTRAL") {
    const emoji = newHTF === "BULL" ? "🟢" : "🔴";
    sendMarketAlert(symbol, "htf_change",
      `🔄 CENÁRIO MUDOU — ${symbol}: HTF virou ${newHTF === "BULL" ? "ALTISTA" : "BAIXISTA"} ${emoji}. Revise posições abertas!`,
      "info"
    );
    // Se tem sinal ativo na direção errada avisa
    const activeDir = activeSignals.get(symbol);
    if (activeDir) {
      const isConflict = (activeDir === "BUY" && newHTF === "BEAR") ||
                         (activeDir === "SELL" && newHTF === "BULL");
      if (isConflict) {
        sendMarketAlert(symbol, "signal_conflict",
          `⚠️ ATENÇÃO: Sinal ${activeDir} ativo em ${symbol} mas HTF virou contra! Considere gerenciar a posição.`,
          "warning"
        );
      }
    }
  }
  if (newHTF) lastHTFBias.set(symbol, newHTF);

  // 4. Captura de liquidez
  if (result.analysis?.liquidity_sweeps?.bull?.detected) {
    sendMarketAlert(symbol, "liq_bull",
      `⚡ LIQUIDEZ CAPTURADA em ${result.analysis.liquidity_sweeps.bull.level}! Setup de reversão de alta possível.`,
      "warning"
    );
  }
  if (result.analysis?.liquidity_sweeps?.bear?.detected) {
    sendMarketAlert(symbol, "liq_bear",
      `⚡ LIQUIDEZ CAPTURADA em ${result.analysis.liquidity_sweeps.bear.level}! Setup de reversão de baixa possível.`,
      "warning"
    );
  }
}

function checkScoreboardReset() {
  const today = new Date().toDateString();
  if (liveScoreboard.date !== today) {
    liveScoreboard.signals = 0; liveScoreboard.wins = 0;
    liveScoreboard.losses  = 0; liveScoreboard.profit = 0;
    liveScoreboard.date    = today;
    pendingNotifications.length = 0;
    signalCache.clear();
    analysisCache.clear();
    processingAssets.clear();
    activeSignals.clear();
    alertCache.clear();
    console.log("[LiveRoom] Novo dia — caches limpos");
  }
}

async function callEaSignalV3(strategy, symbol, historicalData = null, mode = "express") {
  const priceData = allPrices.get(symbol);
  if (!priceData) throw new Error(`Sem dados para ${symbol}.`);
  let closes, highs, lows, opens;
  if (priceData.closes && Array.isArray(priceData.closes) && priceData.closes.length >= 30) {
    closes = priceData.closes; highs = priceData.highs || []; lows = priceData.lows || []; opens = priceData.opens || [];
  } else {
    const bid = parseFloat(priceData.bid); const c1 = parseFloat(priceData.close1 || bid), c2 = c1*0.9995, c3 = c1*0.999; const h1 = parseFloat(priceData.high1 || c1*1.002), l1 = parseFloat(priceData.low1 || c1*0.998);
    closes = []; highs = []; lows = []; opens = [];
    for(let i=54;i>=3;i--){const f=1+(Math.random()-0.5)*0.001;closes.push(parseFloat((bid*f).toFixed(5)));highs.push(parseFloat((bid*f*1.001).toFixed(5)));lows.push(parseFloat((bid*f*0.999).toFixed(5)));opens.push(parseFloat((bid*f*0.9995).toFixed(5)));}
    closes.push(c3,c2,c1,bid);highs.push(h1,h1,h1,h1);lows.push(l1,l1,l1,l1);opens.push(c3,c2,c1,bid*0.9998);
  }
  const body = { strategy, symbol, mode, closes, highs, lows, opens, historical_win_rate: historicalData?.win_rate ?? -1, historical_sample_size: historicalData?.sample_size ?? 0, hour_win_rate: historicalData?.hour_win_rate ?? -1, hour_sample_size: historicalData?.hour_sample_size ?? 0 };
  const response = await fetch(EA_SIGNAL_V3_URL, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${EA_SIGNAL_KEY}` }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result = await response.json(); result.live_price = priceData.bid; result.live_symbol = symbol; return result;
}

// ─────────────────────────────────────────────
// LIVE ROOM — Analisa ativo v18
// ─────────────────────────────────────────────
async function analyzeLiveAsset(symbol, isPriority = false) {
  const priceData = allPrices.get(symbol);
  if (!priceData || !isPriceFresh(priceData)) return;

  const strategy = getStrategyForAsset(symbol);
  const lockKey  = `${symbol}-${strategy}`;

  // ── TRAVA ──
  if (processingAssets.has(lockKey)) return;
  processingAssets.add(lockKey);

  try {
    // ── FILTRO DE HORÁRIO ──
    if (!isGoodTradingHour(symbol)) {
      if (liveRoomClients.size > 0) {
        const session = getSessionName();
        broadcastToLiveRoom({
          type: "no_signal", asset: symbol, strategy,
          strategy_label: STRATEGIES[strategy]?.label || strategy,
          mode: getMostUsedMode(),
          reason: `${symbol} fora do horário de negociação — ${session}`,
          timestamp: new Date().toISOString()
        });
      }
      return;
    }

    // ── ANTI-DUPLICATA DE ANÁLISE ──
    const lastAnalysis = analysisCache.get(lockKey) || 0;
    const minInterval  = isPriority ? ANALYSIS_INTERVAL_PRIORITY : ANALYSIS_INTERVAL_NORMAL;
    if (Date.now() - lastAnalysis < minInterval) return;
    analysisCache.set(lockKey, Date.now());

    const mode       = getMostUsedMode();
    const hour       = new Date().getUTCHours();
    const stats      = await fetchHistoricalStats(symbol, strategy);
    const hourStats  = stats.hour_stats?.[hour] || {};
    const histData   = { win_rate: stats.win_rate, sample_size: stats.sample_size, hour_win_rate: hourStats.win_rate ?? -1, hour_sample_size: hourStats.count ?? 0 };
    const stratLabel = STRATEGIES[strategy]?.label || strategy;

    if (liveRoomClients.size > 0) {
      broadcastToLiveRoom({ type: "thinking", asset: symbol, strategy, strategy_label: stratLabel, mode, price: priceData.bid, is_priority: isPriority, message: `${isPriority ? "🎯" : "🧠"} ${isPriority ? "Análise prioritária" : "Monitorando"} ${symbol} — ${stratLabel} [${mode.toUpperCase()}]`, timestamp: new Date().toISOString() });
      await new Promise(r => setTimeout(r, 1200));
    }

    const result = await callEaSignalV3(strategy, symbol, histData, mode);
    const currentPrice = parseFloat(priceData.bid);

    // ── VERIFICA ALERTAS DE MERCADO ──
    checkMarketAlerts(symbol, result, currentPrice);

    if (result.status === "new_signal" && result.direction) {

      // ── FILTRO HTF ──
      const htfBias   = result.htf_bias || "NEUTRAL";
      const minProb   = getMinProbByHTF(result.direction, htfBias);
      const isWith    = (result.direction === "BUY" && htfBias === "BULL") ||
                        (result.direction === "SELL" && htfBias === "BEAR");
      const isAgainst = (result.direction === "BUY" && htfBias === "BEAR") ||
                        (result.direction === "SELL" && htfBias === "BULL");

      if (result.probability < minProb) {
        const htfMsg = isAgainst
          ? `Contra HTF ${htfBias} — exige ${minProb}% (atual: ${result.probability}%)`
          : `HTF neutro — exige ${minProb}% (atual: ${result.probability}%)`;
        console.log(`[LiveRoom] ❌ HTF bloqueou: ${symbol} ${result.direction} — ${htfMsg}`);
        if (liveRoomClients.size > 0) {
          broadcastToLiveRoom({ type: "no_signal", asset: symbol, strategy, strategy_label: stratLabel, mode, reason: `Filtro HTF: ${htfMsg}`, timestamp: new Date().toISOString() });
        }
        return;
      }

      // ── COOLDOWN DE SINAL ──
      const signalKey  = `${symbol}-${result.direction}`;
      const lastSignal = signalCache.get(signalKey) || { timestamp: 0, price: 0 };
      const timePassed = Date.now() - lastSignal.timestamp;
      const priceChg   = lastSignal.price > 0 ? Math.abs(currentPrice - lastSignal.price) / lastSignal.price : 1;

      if (timePassed < SIGNAL_COOLDOWN && priceChg < PRICE_CHANGE_THRESHOLD) {
        const remaining = Math.round((SIGNAL_COOLDOWN - timePassed) / 1000);
        if (liveRoomClients.size > 0) broadcastToLiveRoom({ type: "no_signal", asset: symbol, strategy, strategy_label: stratLabel, mode, reason: `Cooldown ativo — ${remaining}s restantes`, timestamp: new Date().toISOString() });
        return;
      }

      // ── IMPEDE BUY E SELL SIMULTÂNEOS ──
      const currentDirection = activeSignals.get(symbol);
      if (currentDirection && currentDirection !== result.direction) {
        const oppositeKey = `${symbol}-${currentDirection}`;
        const opp = signalCache.get(oppositeKey) || { timestamp: 0 };
        if (Date.now() - opp.timestamp < SIGNAL_COOLDOWN) {
          console.log(`[LiveRoom] ⚠️ Conflito: ${symbol} já tem ${currentDirection} — ignorando ${result.direction}`);
          return;
        }
      }

      // Atualiza caches
      signalCache.set(signalKey, { timestamp: Date.now(), price: currentPrice });
      activeSignals.set(symbol, result.direction);
      setTimeout(() => { if (activeSignals.get(symbol) === result.direction) activeSignals.delete(symbol); }, SIGNAL_COOLDOWN);

      const htfLabel = isWith ? "✅ A favor do HTF" : isAgainst ? "⚠️ Contra HTF" : "➡️ HTF neutro";

      liveScoreboard.signals++;
      const signal = {
        type: "signal", asset: symbol, strategy, strategy_label: stratLabel, mode,
        direction: result.direction, entry: result.entry, sl: result.sl, tp: result.tp,
        tp1: result.tp1, tp2: result.tp2 || null, tp3: result.tp3 || null,
        tp1_label: result.tp1_label, tp2_label: result.tp2_label, tp3_label: result.tp3_label,
        probability: result.probability, reason: result.reason,
        confirmations: result.confirmations, indicators: result.indicators,
        trend_strength: result.trend_strength, is_range: result.is_range,
        htf_bias: htfBias, htf_label: htfLabel, vwap: result.vwap,
        volume_profile: result.volume_profile, market_structure: result.market_structure,
        analysis: result.analysis, probability_adjustment: result.probability_adjustment,
        historical: stats.sample_size > 0 ? { win_rate: stats.win_rate, sample_size: stats.sample_size } : null,
        id: `LIVE-${Date.now()}`,
        hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        timestamp: new Date().toISOString(),
        session: getSessionName(),
      };

      liveSignalHistory.unshift(signal);
      if (liveSignalHistory.length > 50) liveSignalHistory.pop();
      await saveLiveSignal(signal);
      if (liveRoomClients.size > 0) broadcastToLiveRoom(signal);
      notifyAllClients(signal);
      console.log(`[LiveRoom] 🟢 ${result.direction} ${symbol} | ${stratLabel} | Prob: ${result.probability}% | HTF: ${htfBias} (${htfLabel}) | Sessão: ${getSessionName()}`);

      // ── ORDEM AUTOMÁTICA DO LIVE ROOM ──
      let targetSlaveId = null;
      if (isSlaveOnline(LIVE_ROOM_BOT_ID)) {
        targetSlaveId = LIVE_ROOM_BOT_ID;
      } else if (activeSlaves.size > 0) {
        activeSlaves.forEach((data, userId) => {
          if (!targetSlaveId && (new Date() - data.lastSeen) / 1000 < SLAVE_TIMEOUT_S) targetSlaveId = userId;
        });
      }
      if (targetSlaveId) {
        slavePendingOrders.set(targetSlaveId, {
          order_id: generateOrderId(), direction: result.direction, symbol,
          sl: result.sl, tp: result.tp1 || result.tp, lot_size: 0.01,
          strategy, probability: result.probability,
          confirmations: result.confirmations || 0, trend_strength: result.trend_strength || 0,
          source: "LIVE-ROOM", timestamp: new Date().toISOString()
        });
        console.log(`[LiveRoom] 📤 Ordem automática: ${result.direction} ${symbol} → ${targetSlaveId}`);
      }

    } else {
      if (liveRoomClients.size > 0) {
        broadcastToLiveRoom({ type: "no_signal", asset: symbol, strategy, strategy_label: STRATEGIES[strategy]?.label || strategy, mode: getMostUsedMode(), reason: result.reason || "Aguardando setup ideal", is_range: result.is_range || false, indicators: result.indicators, htf_bias: result.htf_bias, timestamp: new Date().toISOString() });
      }
    }

  } catch (err) {
    console.error(`[LiveRoom] Erro ${symbol}:`, err.message);
  } finally {
    processingAssets.delete(lockKey);
  }
}

async function runLiveRoom() {
  checkScoreboardReset();
  if (liveRoomClients.size > 0) {
    broadcastToLiveRoom({ type: "scoreboard", signals: liveScoreboard.signals, wins: liveScoreboard.wins, losses: liveScoreboard.losses, profit: liveScoreboard.profit, win_rate: liveScoreboard.signals > 0 ? ((liveScoreboard.wins / liveScoreboard.signals) * 100).toFixed(1) : "0.0", session: getSessionName(), timestamp: new Date().toISOString() });
  }
  const focusedAsset = getMostFocusedAsset();
  for (const symbol of LIVE_ASSETS) {
    if (symbol === focusedAsset) continue;
    if (allPrices.get(symbol) && isPriceFresh(allPrices.get(symbol))) {
      await analyzeLiveAsset(symbol, false);
      if (liveRoomClients.size > 0) await new Promise(r => setTimeout(r, 1500));
    }
  }
}

async function runFocusedAsset() {
  const f = getMostFocusedAsset();
  if (!f) return;
  const pd = allPrices.get(f);
  if (pd && isPriceFresh(pd)) await analyzeLiveAsset(f, true);
}

function startLiveRoom24h() {
  if (!liveRoomInterval) { liveRoomInterval = setInterval(runLiveRoom, 30000); console.log("[LiveRoom] Loop 30s iniciado"); }
  if (!focusInterval)    { focusInterval    = setInterval(runFocusedAsset, 10000); console.log("[LiveRoom] Loop 10s iniciado"); }
}

app.post("/webhook/hotmart", async (req, res) => {
  const event = req.body;
  if (["PURCHASE_APPROVED","PURCHASE_COMPLETE","SUBSCRIPTION_REACTIVATED"].includes(event?.event)) {
    const email = event?.data?.buyer?.email; const product = event?.data?.product?.name || ""; const price = event?.data?.purchase?.price?.value || 0;
    let plan = "basic", months = 1;
    if (product.toLowerCase().includes("elite") || price >= 390) plan = "elite";
    else if (product.toLowerCase().includes("pro") || price >= 190) plan = "pro";
    if (price >= 900) months = 12;
    if (email) { await activateUserPlan(email, plan, months); broadcastToSite({ type: "plan_activated", email, plan }); }
  }
  if (["PURCHASE_CANCELED","PURCHASE_REFUNDED","SUBSCRIPTION_CANCELLATION"].includes(event?.event)) {
    const email = event?.data?.buyer?.email; if (email) await activateUserPlan(email, "free", 0);
  }
  res.json({ status: "ok" });
});

app.post("/master-trade", async (req, res) => {
  const { symbol, direction, risk_percent, sl_percent, tp_percent, strategy, probability } = req.body;
  if (!symbol || !direction) return res.status(400).json({ error: "symbol e direction obrigatórios" });
  const eliteSlaves = []; activeSlaves.forEach((data, userId) => { if ((new Date() - data.lastSeen) / 1000 < SLAVE_TIMEOUT_S && data.plan === "elite") eliteSlaves.push({ userId, ...data }); });
  let copied = 0;
  for (const slave of eliteSlaves) { slavePendingOrders.set(slave.userId, { order_id: generateOrderId(), direction, symbol, sl: 0, tp: 0, lot_size: 0, risk_percent: risk_percent || 1.0, sl_percent: sl_percent || 0.5, tp_percent: tp_percent || 1.0, strategy: strategy || "COPY", probability: probability || 0, is_copy_trade: true, timestamp: new Date().toISOString() }); copied++; }
  broadcastToSite({ type: "copy_trade", symbol, direction, strategy, probability, clients: copied, timestamp: new Date().toISOString() });
  res.json({ status: "ok", clients_copied: copied });
});

app.post("/price", (req, res) => {
  const data = req.body; if (!data || !data.symbol) return res.status(400).json({ error: "Dados inválidos" });
  mt5LastSeen = new Date();
  const priceData = { symbol: data.symbol, bid: data.bid, ask: data.ask, spread: data.spread, rsi: data.rsi, ema20: data.ema20, ema50: data.ema50, close1: data.close1, high1: data.high1, low1: data.low1, closes: data.closes || null, highs: data.highs || null, lows: data.lows || null, opens: data.opens || null, strategy: data.strategy || "SMC_PRO", receivedAt: new Date().toISOString() };
  allPrices.set(data.symbol, priceData); broadcastToSite({ type: "price", ...priceData }); broadcastToSite({ type: "mt5_status", connected: true });
  res.json({ status: "ok", symbols_tracked: allPrices.size });
});

app.get("/prices", (req, res) => { const prices = []; allPrices.forEach((data, symbol) => prices.push({ symbol, bid: data.bid, ask: data.ask, fresh: isPriceFresh(data) })); res.json({ total: prices.length, mt5_connected: isMt5Online(), prices, timestamp: new Date().toISOString() }); });
app.get("/strategies", (req, res) => { res.json({ strategies: STRATEGIES, timestamp: new Date().toISOString() }); });
app.get("/live-signals", (req, res) => { res.json({ active: true, clients: liveRoomClients.size, signals: liveSignalHistory.slice(0, 20), scoreboard: liveScoreboard, assets: LIVE_ASSETS, focused_asset: getMostFocusedAsset(), pending_notifications: pendingNotifications.slice(0, 5), session: getSessionName(), timestamp: new Date().toISOString() }); });

app.post("/live-signal-result", async (req, res) => {
  const { signal_id, result, profit, close_price, tp_hit } = req.body;
  const signal = liveSignalHistory.find(s => s.id === signal_id);
  if (signal) { signal.result = result; signal.profit = profit; if (signal.supabase_id) await updateLiveSignalResult(signal.supabase_id, result, profit, close_price, tp_hit); }
  const profitVal = parseFloat(profit) || 0;
  if (result === "win") { liveScoreboard.wins++; liveScoreboard.profit += profitVal; } else if (result === "loss") { liveScoreboard.losses++; liveScoreboard.profit += profitVal; }
  broadcastToLiveRoom({ type: "signal_result", signal_id, result, profit: profitVal, scoreboard: liveScoreboard, timestamp: new Date().toISOString() });
  res.json({ status: "ok" });
});

app.get("/supabase-test", async (req, res) => {
  try {
    const testData = { asset: "TEST", strategy: "SMC_PRO", direction: "BUY", entry_price: 100, sl: 99, tp1: 101, probability: 80, confirmations: 1, hour_of_day: new Date().getUTCHours(), day_of_week: new Date().getUTCDay(), result: "open" };
    const result = await supabasePost("live_signals", testData);
    res.json({ status: "ok", result, timestamp: new Date().toISOString() });
  } catch(err) { res.json({ status: "error", error: err.message }); }
});

app.get("/live-learning", async (req, res) => {
  try {
    const data = await supabaseGet("live_signals?result=neq.open&select=asset,strategy,result,profit,hour_of_day,probability,rsi,atr&order=created_at.desc&limit=500");
    if (!data || data.length === 0) return res.json({ status: "no_data", message: "Ainda sem dados suficientes.", assets: {} });
    const groups = {};
    data.forEach(d => { const key = `${d.asset}-${d.strategy}`; if (!groups[key]) groups[key] = { asset: d.asset, strategy: d.strategy, wins: 0, losses: 0, total: 0, profit: 0, hours: {} }; const g = groups[key]; g.total++; g.profit += d.profit || 0; if (d.result === "win") g.wins++; else g.losses++; const h = d.hour_of_day; if (h !== null) { if (!g.hours[h]) g.hours[h] = { wins: 0, total: 0 }; g.hours[h].total++; if (d.result === "win") g.hours[h].wins++; } });
    const assets = {};
    Object.values(groups).forEach((g) => { if (!assets[g.asset]) assets[g.asset] = {}; assets[g.asset][g.strategy] = { strategy_label: STRATEGIES[g.strategy]?.label || g.strategy, total_signals: g.total, wins: g.wins, losses: g.losses, win_rate: parseFloat((g.wins/g.total).toFixed(3)), win_rate_pct: `${(g.wins/g.total*100).toFixed(1)}%`, total_profit: parseFloat(g.profit.toFixed(2)), recommendation: g.total >= 20 ? g.wins/g.total >= 0.6 ? "✅ Performando bem" : g.wins/g.total >= 0.45 ? "⚠ Moderado" : "❌ Ajustando filtros" : "📊 Coletando dados..." }; });
    res.json({ status: "ok", total_signals_analyzed: data.length, assets, last_updated: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/all-trades", async (req, res) => {
  try {
    const limit = req.query.limit || 500;
    const trades = await supabaseGet(`trades?order=created_at.desc&limit=${limit}`);
    if (!trades || trades.length === 0) return res.json({ total: 0, trades: [], stats: { total: 0, wins: 0, losses: 0, win_rate: 0, total_profit: 0 } });
    const validTrades = trades.filter(t => t.result === "win" || t.result === "loss");
    const wins   = validTrades.filter(t => t.result === "win").length;
    const losses = validTrades.filter(t => t.result === "loss").length;
    const totalProfit = validTrades.reduce((sum, t) => sum + (parseFloat(t.profit) || 0), 0);
    const winRate = validTrades.length > 0 ? ((wins / validTrades.length) * 100).toFixed(1) : 0;
    res.json({ total: trades.length, trades, stats: { total: validTrades.length, wins, losses, win_rate: parseFloat(winRate), win_rate_pct: `${winRate}%`, total_profit: parseFloat(totalProfit.toFixed(2)), total_profit_formatted: `$${totalProfit.toFixed(2)}` }, timestamp: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/slave-register", async (req, res) => {
  const { user_id, account, symbol, balance, status } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id obrigatório" });
  if (status === "disconnected") { activeSlaves.delete(user_id); broadcastToSite({ type: "slave_status", user_id, connected: false }); return res.json({ status: "ok" }); }
  const planCheck = await checkProPlan(user_id); if (!planCheck.allowed) return res.status(403).json({ status: "blocked", message: "Plano necessário." });
  const limits = getPlanLimits(planCheck.plan || "basic");
  activeSlaves.set(user_id, { account: account || "unknown", symbol: symbol || "BTCUSD", balance: balance || 0, plan: planCheck.plan || "basic", limits, lastSeen: new Date() });
  broadcastToSite({ type: "slave_status", user_id, connected: true, balance, plan: planCheck.plan });
  res.json({ status: "ok", user_id, plan: planCheck.plan, limits });
});

app.get("/slave-order", (req, res) => {
  const userId = req.query.user_id; if (!userId) return res.status(400).json({ error: "user_id obrigatório" });
  if (activeSlaves.has(userId)) { const s = activeSlaves.get(userId); s.lastSeen = new Date(); activeSlaves.set(userId, s); } else activeSlaves.set(userId, { account: "unknown", symbol: "BTCUSD", balance: 0, plan: "basic", lastSeen: new Date() });
  if (slavePendingOrders.has(userId)) { const order = slavePendingOrders.get(userId); slavePendingOrders.delete(userId); return res.json({ hasOrder: true, ...order }); }
  res.json({ hasOrder: false });
});

app.post("/slave-confirm", (req, res) => { const { user_id, order_id, symbol, direction, price, lot, sl, tp } = req.body; slaveExecutions.push({ user_id, order_id, symbol, direction, price, lot, sl, tp, timestamp: new Date().toISOString() }); broadcastToSite({ type: "order_confirmed", user_id, order_id, direction, symbol, price, lot, sl, tp, timestamp: new Date().toISOString() }); res.json({ status: "ok" }); });

app.post("/slave-trade-closed", async (req, res) => {
  const { user_id, symbol, direction, close_price, profit, result, strategy, probability, confirmations, trend_strength, sl, tp } = req.body;
  if (!user_id || !symbol) return res.status(400).json({ error: "user_id e symbol obrigatórios" });
  const profitVal = parseFloat(profit) || 0; const resultStr = profitVal > 0 ? "win" : "loss";
  broadcastToSite({ type: "trade_closed", user_id, symbol, direction, profit: profitVal, result: resultStr, strategy, timestamp: new Date().toISOString() });
  const now = new Date();
  const source = req.body.source || "SLAVE";
  await saveTradeToSupabase({ user_code: user_id, symbol, direction: direction || "buy", entry_price: parseFloat(close_price) || 0, sl: parseFloat(sl) || 0, tp: parseFloat(tp) || 0, profit: profitVal, result: resultStr, hour_of_day: now.getUTCHours(), day_of_week: now.getUTCDay(), market_strength: 0, atr_value: 0, probability: parseFloat(probability) || 0, strategy: strategy || "UNKNOWN", confirmations: parseInt(confirmations) || 0, trend_strength: parseFloat(trend_strength) || 0, source });
  if (source === "LIVE-ROOM") {
    const recentSignal = liveSignalHistory.find(s => s.asset === symbol && s.direction?.toUpperCase() === direction?.toUpperCase() && s.result === "open");
    if (recentSignal) {
      recentSignal.result = resultStr; recentSignal.profit = profitVal;
      if (recentSignal.supabase_id) await updateLiveSignalResult(recentSignal.supabase_id, resultStr, profitVal, close_price, 0);
      if (resultStr === "win") { liveScoreboard.wins++; liveScoreboard.profit += profitVal; }
      else { liveScoreboard.losses++; liveScoreboard.profit += profitVal; }
      broadcastToLiveRoom({ type: "signal_result", signal_id: recentSignal.id, result: resultStr, profit: profitVal, scoreboard: liveScoreboard, timestamp: new Date().toISOString() });
      if (activeSignals.get(symbol) === direction?.toUpperCase()) activeSignals.delete(symbol);
    }
  }
  res.json({ status: "ok" });
});

app.post("/slave-error", (req, res) => { broadcastToSite({ type: "slave_error", ...req.body }); res.json({ status: "ok" }); });

app.post("/client-execute-order", async (req, res) => {
  const { user_id, symbol, direction, sl, tp, lot_size, strategy, probability, confirmations, trend_strength } = req.body;
  if (!user_id || !symbol || !direction) return res.status(400).json({ error: "user_id, symbol e direction obrigatórios." });
  const planCheck = await checkProPlan(user_id); const limits = getPlanLimits(planCheck.plan || "basic");
  if (limits.assets !== "ALL" && !limits.assets.includes(symbol)) return res.status(403).json({ error: `Ativo ${symbol} não disponível.` });
  if (!limits.autoTrade) return res.status(403).json({ error: "Auto Trade não disponível." });
  if (!isSlaveOnline(user_id)) return res.status(503).json({ error: "EA Slave não conectado.", slave_online: false });
  const slVal = parseFloat(sl), tpVal = parseFloat(tp); if (!slVal || !tpVal) return res.status(400).json({ error: "SL e TP inválidos." });
  const orderId = generateOrderId();
  slavePendingOrders.set(user_id, { order_id: orderId, direction, symbol, sl: slVal, tp: tpVal, lot_size: parseFloat(lot_size) || 0.01, strategy: strategy || "SMC_PRO", probability: parseFloat(probability) || 0, confirmations: parseInt(confirmations) || 0, trend_strength: parseFloat(trend_strength) || 0, timestamp: new Date().toISOString() });
  res.json({ status: "ok", message: "Ordem enviada.", order_id: orderId });
});

app.get("/slave-status", (req, res) => { const userId = req.query.user_id; if (!userId) return res.status(400).json({ error: "user_id obrigatório" }); const exists = activeSlaves.has(userId); const slave = activeSlaves.get(userId); const ago = exists ? Math.round((new Date() - slave.lastSeen) / 1000) : null; res.json({ user_id: userId, slave_online: exists && ago < SLAVE_TIMEOUT_S, last_seen: ago, balance: slave?.balance ?? null, plan: slave?.plan ?? null }); });

app.get("/user-trades", async (req, res) => { const userCode = req.query.user_code; if (!userCode) return res.status(400).json({ error: "user_code obrigatório" }); try { const response = await fetch(`${SUPABASE_URL}/rest/v1/trades?user_code=eq.${userCode}&order=created_at.desc&limit=500`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }); res.json({ user_code: userCode, trades: await response.json() }); } catch (err) { res.status(500).json({ error: err.message }); } });

app.get("/plan-limits/:userId", async (req, res) => { const planCheck = await checkProPlan(req.params.userId); res.json({ user_id: req.params.userId, plan: planCheck.plan || "basic", limits: getPlanLimits(planCheck.plan || "basic") }); });

wss.on("connection", (ws) => {
  siteClients.add(ws);
  ws.send(JSON.stringify({ type: "mt5_status", connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "symbols_available", symbols: Array.from(allPrices.keys()) }));
  ws.send(JSON.stringify({ type: "strategies_available", strategies: STRATEGIES }));
  ws.send(JSON.stringify({ type: "session_info", session: getSessionName(), timestamp: new Date().toISOString() }));
  if (pendingNotifications.length > 0) ws.send(JSON.stringify({ type: "pending_notifications", notifications: pendingNotifications, timestamp: new Date().toISOString() }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
      if (msg.type === "analyze") {
        const strategy = msg.strategy || "SMC_PRO"; const symbol = msg.symbol || "BTCUSD"; const mode = msg.mode || "express";
        ws.send(JSON.stringify({ type: "analyzing", status: "processing", strategy, mode }));
        try {
          const stats = await fetchHistoricalStats(symbol, strategy); const hour = new Date().getUTCHours(); const hourStats = stats.hour_stats?.[hour] || {};
          const result = await callEaSignalV3(strategy, symbol, { win_rate: stats.win_rate, sample_size: stats.sample_size, hour_win_rate: hourStats.win_rate ?? -1, hour_sample_size: hourStats.count ?? 0 }, mode);
          ws.send(JSON.stringify({ type: "analysis_result", symbol, strategy, mode, strategy_label: STRATEGIES[strategy]?.label || strategy, direction: result.direction, entry: result.entry, sl: result.sl, tp: result.tp, tp1: result.tp1, tp2: result.tp2, tp3: result.tp3, tp_levels: result.tp_levels, tp1_label: result.tp1_label, tp2_label: result.tp2_label, tp3_label: result.tp3_label, probability: result.probability, score: result.probability, reason: result.reason, indicators: result.indicators, live_price: result.live_price, status: result.status, confirmations: result.confirmations, trend_strength: result.trend_strength, is_range: result.is_range, htf_bias: result.htf_bias, vwap: result.vwap, volume_profile: result.volume_profile, market_structure: result.market_structure, analysis: result.analysis, probability_adjustment: result.probability_adjustment, timestamp: new Date().toISOString() }));
        } catch (err) { ws.send(JSON.stringify({ type: "error", message: err.message })); }
      }
      if (msg.type === "get_price") { const symbol = msg.symbol?.toUpperCase(); const pd = symbol ? allPrices.get(symbol) : null; if (pd && isPriceFresh(pd)) ws.send(JSON.stringify({ type: "price", ...pd })); else ws.send(JSON.stringify({ type: "price_unavailable", symbol })); }
      if (msg.type === "join_live_room") { liveRoomClients.add(ws); clientFocusAsset.set(ws, null); clientStrategies.set(ws, { ...DEFAULT_STRATEGIES }); clientModes.set(ws, msg.mode || "express"); ws.send(JSON.stringify({ type: "live_room_joined", history: liveSignalHistory.slice(0, 10), scoreboard: liveScoreboard, assets: LIVE_ASSETS, strategies: DEFAULT_STRATEGIES, strategies_info: STRATEGIES, session: getSessionName(), message: "Bem-vindo! A IA monitora 24h.", timestamp: new Date().toISOString() })); broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size }); }
      if (msg.type === "leave_live_room") { liveRoomClients.delete(ws); clientFocusAsset.delete(ws); clientStrategies.delete(ws); clientModes.delete(ws); broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size }); }
      if (msg.type === "set_mode") { clientModes.set(ws, msg.mode === "complete" ? "complete" : "express"); ws.send(JSON.stringify({ type: "mode_updated", mode: msg.mode, timestamp: new Date().toISOString() })); }
      if (msg.type === "focus_asset") { const symbol = msg.asset?.toUpperCase(); if (symbol) { clientFocusAsset.set(ws, symbol); const pd = allPrices.get(symbol); if (pd && isPriceFresh(pd)) await analyzeLiveAsset(symbol, true); } }
      if (msg.type === "set_live_strategy") { const { asset, strategy } = msg; if (asset && strategy) { const strategies = clientStrategies.get(ws) || { ...DEFAULT_STRATEGIES }; strategies[asset] = strategy; clientStrategies.set(ws, strategies); const pd = allPrices.get(asset); if (pd && isPriceFresh(pd)) await analyzeLiveAsset(asset, true); ws.send(JSON.stringify({ type: "strategy_updated", asset, strategy, strategy_label: STRATEGIES[strategy]?.label || strategy, timestamp: new Date().toISOString() })); } }
    } catch (e) { console.error("[WS] Erro:", e); }
  });
  ws.on("close", () => { siteClients.delete(ws); liveRoomClients.delete(ws); clientFocusAsset.delete(ws); clientStrategies.delete(ws); clientModes.delete(ws); broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size }); });
});

setInterval(() => { activeSlaves.forEach((data, userId) => { if ((new Date() - data.lastSeen) / 1000 > SLAVE_REMOVE_S) { activeSlaves.delete(userId); broadcastToSite({ type: "slave_status", user_id: userId, connected: false }); } }); if (mt5LastSeen && (new Date() - mt5LastSeen) > MT5_TIMEOUT_MS) broadcastToSite({ type: "mt5_status", connected: false }); }, 5000);
setInterval(async () => { try { await fetch(`${RAILWAY_URL}/health`); } catch {} }, 4 * 60 * 1000);

app.get("/health", (_, res) => {
  const slaves = []; activeSlaves.forEach((data, userId) => { const ago = Math.round((new Date() - data.lastSeen) / 1000); slaves.push({ user_id: userId, online: ago < SLAVE_TIMEOUT_S, balance: data.balance, plan: data.plan, last_seen_secs: ago }); });
  const prices = []; allPrices.forEach((data, symbol) => prices.push({ symbol, bid: data.bid, fresh: isPriceFresh(data) }));
  const hour = new Date().getUTCHours();
  res.json({
    status: "online", version: "v18",
    mt5_connected: isMt5Online(), symbols_count: allPrices.size, symbols: prices,
    site_clients: siteClients.size,
    slaves_online: slaves.filter(s => s.online).length, slaves_total: activeSlaves.size, slaves,
    elite_online: slaves.filter(s => s.online && s.plan === "elite").length,
    live_room_active: true, live_room_clients: liveRoomClients.size,
    live_signals_today: liveScoreboard.signals,
    session: getSessionName(),
    trading_hours: {
      current_utc: hour,
      forex_xau_active: hour >= 8 && hour < 17,
      crypto_active: true,
      best_session: hour >= 13 && hour < 17 ? "🇺🇸 Overlap NY+Londres ⭐⭐⭐" : hour >= 8 && hour < 17 ? "🇬🇧 Sessão Londres ⭐" : "🌙 Fora de sessão",
    },
    active_signals: Object.fromEntries(activeSignals),
    focused_asset: getMostFocusedAsset(), current_mode: getMostUsedMode(),
    learning_cache_size: historicalCache.size,
    analysis_cache_size: analysisCache.size,
    signal_cache_size: signalCache.size,
    alert_cache_size: alertCache.size,
    processing_count: processingAssets.size,
    live_room_bot: isSlaveOnline(LIVE_ROOM_BOT_ID),
    htf_config: HTF_MIN_PROB,
    cooldown_minutes: SIGNAL_COOLDOWN / 60000,
    strategies: Object.keys(STRATEGIES),
    timestamp: new Date().toISOString(),
  });
});

httpServer.listen(PORT, async () => {
  console.log(`[Railway] v18 rodando na porta ${PORT}`);
  console.log(`[Railway] Cooldown: ${SIGNAL_COOLDOWN/60000}min`);
  console.log(`[Railway] Filtro HTF: com=${HTF_MIN_PROB.WITH}% | neutro=${HTF_MIN_PROB.NEUTRAL}% | contra=${HTF_MIN_PROB.AGAINST}%`);
  console.log(`[Railway] Sessões: Forex/XAU 08h-17h UTC | Crypto 24h`);
  startLiveRoom24h();
});
