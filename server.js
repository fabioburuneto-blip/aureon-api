/**
 * TraderAureonia AI — Servidor Railway v13
 * - Focus Asset: ativo selecionado analisa a cada 10s
 * - Live Trading Room com IA pensando em voz alta
 * - Copy Trade Elite automático
 * - Webhook Hotmart
 * - Limites por plano
 * - Keep-alive automático
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

app.get("/download/slave", (_, res) => {
  res.download(path.join(__dirname, "TraderAureonia_Slave.mq5"));
});

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─────────────────────────────────────────────
// CONFIGURAÇÕES
// ─────────────────────────────────────────────
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
// ESTADO GLOBAL
// ─────────────────────────────────────────────
const siteClients        = new Set();
const allPrices          = new Map();
let   mt5LastSeen        = null;
const activeSlaves       = new Map();
const slavePendingOrders = new Map();
const slaveExecutions    = [];
let   orderCounter       = 1;

// Live Trading Room
const liveRoomClients   = new Set();
const liveSignalHistory = [];
let   liveRoomInterval  = null;  // Loop de 30s para todos os ativos
let   focusInterval     = null;  // Loop de 10s para ativo em foco
let   liveRoomActive    = false;

// Mapa de qual ativo cada cliente está focando
// ws → symbol
const clientFocusAsset  = new Map();

// Mapa de qual estratégia cada cliente quer para cada ativo
// ws → { BTCUSD: "QUICK", XAUUSD.s: "SMC", ... }
const clientStrategies  = new Map();

const LIVE_ASSETS = ["BTCUSD", "XAUUSD.s", "EURUSD", "GBPUSD", "ETHUSD"];
const DEFAULT_STRATEGIES = {
  BTCUSD:     "QUICK",
  "XAUUSD.s": "SMC",
  EURUSD:     "MA",
  GBPUSD:     "PA",
  ETHUSD:     "QUICK",
};

const liveScoreboard = {
  signals: 0, wins: 0, losses: 0, profit: 0,
  date: new Date().toDateString(),
};

// ─────────────────────────────────────────────
// LIMITES POR PLANO
// ─────────────────────────────────────────────
const PLAN_LIMITS = {
  basic: {
    assets: ["BTCUSD"], strategies: ["QUICK"],
    maxPositions: 3, autoTrade: false, copyTrade: false,
    liveRoom: true, liveDelaySecs: 60, whatsapp: false,
  },
  pro: {
    assets: ["BTCUSD","EURUSD","XAUUSD.s"],
    strategies: ["QUICK","MA","SMC","PA","MARTINGALE"],
    maxPositions: 10, autoTrade: true, copyTrade: false,
    liveRoom: true, liveDelaySecs: 0, whatsapp: true,
  },
  elite: {
    assets: "ALL",
    strategies: ["QUICK","MA","SMC","PA","MARTINGALE"],
    maxPositions: 20, autoTrade: true, copyTrade: true,
    liveRoom: true, liveDelaySecs: 0, whatsapp: true,
  },
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.basic;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function isMt5Online() {
  return mt5LastSeen && (new Date() - mt5LastSeen) < MT5_TIMEOUT_MS;
}
function generateOrderId() {
  return `ORD-${Date.now()}-${orderCounter++}`;
}
function isSlaveOnline(userId) {
  if (!activeSlaves.has(userId)) return false;
  return (new Date() - activeSlaves.get(userId).lastSeen) / 1000 < SLAVE_TIMEOUT_S;
}
function isPriceFresh(priceData) {
  if (!priceData) return false;
  return (new Date() - new Date(priceData.receivedAt)) / 1000 < PRICE_EXPIRE_S;
}

// Retorna a estratégia que a maioria dos clientes quer para um ativo
function getStrategyForAsset(symbol) {
  const votes = {};
  clientStrategies.forEach((strategies) => {
    const strat = strategies[symbol];
    if (strat) votes[strat] = (votes[strat] || 0) + 1;
  });
  if (Object.keys(votes).length === 0) return DEFAULT_STRATEGIES[symbol] || "QUICK";
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}

// Retorna o ativo que mais clientes estão focando
function getMostFocusedAsset() {
  const votes = {};
  clientFocusAsset.forEach((symbol) => {
    if (symbol) votes[symbol] = (votes[symbol] || 0) + 1;
  });
  if (Object.keys(votes).length === 0) return null;
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}

// ─────────────────────────────────────────────
// VALIDA PLANO PRO
// ─────────────────────────────────────────────
async function checkProPlan(userId) {
  try {
    const response = await fetch(`${CHECK_SLAVE_URL}?user_id=${userId}`);
    if (!response.ok) return { allowed: true, plan: "basic" };
    return await response.json();
  } catch { return { allowed: true, plan: "basic" }; }
}

// ─────────────────────────────────────────────
// SALVA TRADE NO SUPABASE
// ─────────────────────────────────────────────
async function saveTradeToSupabase(tradeData) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/trades`, {
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify(tradeData),
    });
    if (response.ok)
      console.log(`[Supabase] Trade salvo: ${tradeData.user_code} | ${tradeData.strategy} | ${tradeData.result}`);
    else
      console.error(`[Supabase] Erro: ${await response.text()}`);
  } catch (err) {
    console.error(`[Supabase] Erro:`, err.message);
  }
}

// ─────────────────────────────────────────────
// ATIVA PLANO VIA HOTMART WEBHOOK
// ─────────────────────────────────────────────
async function activateUserPlan(email, plan, months) {
  try {
    const searchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,plan`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await searchRes.json();
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (months || 1));
    if (users && users.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: {
          "Content-Type":  "application/json",
          "apikey":        SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer":        "return=minimal",
        },
        body: JSON.stringify({ plan, plan_expires_at: expiresAt.toISOString() }),
      });
      console.log(`[Hotmart] Plano ${plan} ativado para ${email}`);
    }
  } catch (err) {
    console.error(`[Hotmart] Erro:`, err.message);
  }
}

// ─────────────────────────────────────────────
// ALERTA WHATSAPP
// ─────────────────────────────────────────────
async function sendWhatsAppAlert(phone, message) {
  if (!phone) return;
  try {
    const encoded = encodeURIComponent(message);
    await fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=YOUR_CALLMEBOT_KEY`);
  } catch {}
}

// ─────────────────────────────────────────────
// LIVE ROOM — Broadcast
// ─────────────────────────────────────────────
function broadcastToLiveRoom(data) {
  const msg = JSON.stringify(data);
  liveRoomClients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
}

function checkScoreboardReset() {
  const today = new Date().toDateString();
  if (liveScoreboard.date !== today) {
    liveScoreboard.signals = 0;
    liveScoreboard.wins    = 0;
    liveScoreboard.losses  = 0;
    liveScoreboard.profit  = 0;
    liveScoreboard.date    = today;
  }
}

// ─────────────────────────────────────────────
// LIVE ROOM — Analisa um ativo
// ─────────────────────────────────────────────
async function analyzeLiveAsset(symbol, isPriority = false) {
  const priceData = allPrices.get(symbol);
  if (!priceData || !isPriceFresh(priceData)) return;

  const strategy = getStrategyForAsset(symbol);
  const price     = priceData.bid;

  // Fase 1 — Pensando
  broadcastToLiveRoom({
    type: "thinking", asset: symbol, strategy, price,
    is_priority: isPriority,
    message: `${isPriority ? "🎯" : "🧠"} ${isPriority ? "Análise prioritária" : "Monitorando"} ${symbol} — Estratégia: ${strategy}`,
    timestamp: new Date().toISOString(),
  });

  await new Promise(r => setTimeout(r, 1500));

  try {
    const result = await callEaSignalV3(strategy, symbol);

    // Fase 2 — Alertas dos indicadores
    if (result.indicators) {
      const { rsi, ema9, ema21 } = result.indicators;

      if (rsi > 65) {
        broadcastToLiveRoom({
          type: "alert", asset: symbol, level: "warning",
          message: `⚠ RSI em ${rsi} — zona de sobrecompra, cautela para BUY`,
          timestamp: new Date().toISOString(),
        });
        await new Promise(r => setTimeout(r, 800));
      } else if (rsi < 35) {
        broadcastToLiveRoom({
          type: "alert", asset: symbol, level: "warning",
          message: `⚠ RSI em ${rsi} — zona de sobrevenda, cautela para SELL`,
          timestamp: new Date().toISOString(),
        });
        await new Promise(r => setTimeout(r, 800));
      }

      const emaDiffPct = (Math.abs(ema9 - ema21) / price) * 100;
      if (emaDiffPct < 0.05) {
        broadcastToLiveRoom({
          type: "alert", asset: symbol, level: "info",
          message: `🔍 EMAs muito próximas em ${symbol} — mercado indeciso`,
          timestamp: new Date().toISOString(),
        });
        await new Promise(r => setTimeout(r, 800));
      }
    }

    // Fase 3 — Resultado
    if (result.status === "new_signal" && result.direction) {
      liveScoreboard.signals++;

      const signal = {
        type: "signal", asset: symbol, strategy,
        direction: result.direction, entry: result.entry,
        sl: result.sl, tp: result.tp,
        tp1: result.tp1, tp2: result.tp2 || null, tp3: result.tp3 || null,
        tp1_label: result.tp1_label, tp2_label: result.tp2_label, tp3_label: result.tp3_label,
        probability: result.probability, reason: result.reason,
        confirmations: result.confirmations, indicators: result.indicators,
        trend_strength: result.trend_strength, is_range: result.is_range,
        id: `LIVE-${Date.now()}`,
        hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        timestamp: new Date().toISOString(),
      };

      liveSignalHistory.unshift(signal);
      if (liveSignalHistory.length > 50) liveSignalHistory.pop();

      broadcastToLiveRoom(signal);

      // Alerta WhatsApp
      activeSlaves.forEach((slave) => {
        const limits = getPlanLimits(slave.plan);
        if (slave.whatsapp_phone && limits.whatsapp) {
          sendWhatsAppAlert(
            slave.whatsapp_phone,
            `🔴 Live Room — ${result.direction} ${symbol}\nEstratégia: ${strategy}\nProb: ${result.probability}%\nEntrada: ${result.entry} | SL: ${result.sl} | TP1: ${result.tp1}`
          );
        }
      });

      console.log(`[LiveRoom] 🟢 SINAL: ${result.direction} ${symbol} ${strategy} | Prob: ${result.probability}%`);

    } else {
      broadcastToLiveRoom({
        type: "no_signal", asset: symbol,
        reason: result.reason || "Sem condições claras",
        is_range: result.is_range || false,
        indicators: result.indicators,
        timestamp: new Date().toISOString(),
      });
    }

  } catch (err) {
    console.error(`[LiveRoom] Erro ${symbol}:`, err.message);
  }
}

// ─────────────────────────────────────────────
// LIVE ROOM — Loop principal (30s — todos os ativos)
// ─────────────────────────────────────────────
async function runLiveRoom() {
  if (liveRoomClients.size === 0) return;
  checkScoreboardReset();

  broadcastToLiveRoom({
    type: "scoreboard",
    signals: liveScoreboard.signals,
    wins: liveScoreboard.wins,
    losses: liveScoreboard.losses,
    profit: liveScoreboard.profit,
    win_rate: liveScoreboard.signals > 0
      ? ((liveScoreboard.wins / liveScoreboard.signals) * 100).toFixed(1) : "0.0",
    timestamp: new Date().toISOString(),
  });

  // Analisa todos os ativos exceto o que está em foco
  // (o foco tem seu próprio loop de 10s)
  const focusedAsset = getMostFocusedAsset();

  for (const symbol of LIVE_ASSETS) {
    if (symbol === focusedAsset) continue; // Pula — já tem loop próprio
    if (allPrices.get(symbol) && isPriceFresh(allPrices.get(symbol))) {
      await analyzeLiveAsset(symbol, false);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ─────────────────────────────────────────────
// LIVE ROOM — Loop prioritário (10s — ativo em foco)
// ─────────────────────────────────────────────
async function runFocusedAsset() {
  if (liveRoomClients.size === 0) return;
  const focusedAsset = getMostFocusedAsset();
  if (!focusedAsset) return;

  const priceData = allPrices.get(focusedAsset);
  if (priceData && isPriceFresh(priceData)) {
    await analyzeLiveAsset(focusedAsset, true); // isPriority = true
  }
}

// ─────────────────────────────────────────────
// INICIA OS LOOPS DO LIVE ROOM
// ─────────────────────────────────────────────
function startLiveRoom() {
  if (!liveRoomInterval) {
    liveRoomInterval = setInterval(runLiveRoom, 30000);
    runLiveRoom();
    console.log("[LiveRoom] Loop de 30s iniciado.");
  }
  if (!focusInterval) {
    focusInterval = setInterval(runFocusedAsset, 10000);
    console.log("[LiveRoom] Loop de 10s (foco) iniciado.");
  }
  liveRoomActive = true;
}

function stopLiveRoom() {
  if (liveRoomInterval) { clearInterval(liveRoomInterval); liveRoomInterval = null; }
  if (focusInterval)    { clearInterval(focusInterval);    focusInterval    = null; }
  liveRoomActive = false;
  console.log("[LiveRoom] Sala vazia — loops parados.");
}

// ─────────────────────────────────────────────
// WEBHOOK HOTMART
// ─────────────────────────────────────────────
app.post("/webhook/hotmart", async (req, res) => {
  const event = req.body;
  if (["PURCHASE_APPROVED","PURCHASE_COMPLETE","SUBSCRIPTION_REACTIVATED"].includes(event?.event)) {
    const email   = event?.data?.buyer?.email;
    const product = event?.data?.product?.name || "";
    const price   = event?.data?.purchase?.price?.value || 0;
    let plan = "basic", months = 1;
    if (product.toLowerCase().includes("elite") || price >= 390) plan = "elite";
    else if (product.toLowerCase().includes("pro") || price >= 190) plan = "pro";
    if (price >= 900) months = 12;
    if (email) { await activateUserPlan(email, plan, months); broadcastToSite({ type: "plan_activated", email, plan }); }
  }
  if (["PURCHASE_CANCELED","PURCHASE_REFUNDED","SUBSCRIPTION_CANCELLATION"].includes(event?.event)) {
    const email = event?.data?.buyer?.email;
    if (email) await activateUserPlan(email, "basic", 0);
  }
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// COPY TRADE
// ─────────────────────────────────────────────
app.post("/master-trade", async (req, res) => {
  const { symbol, direction, risk_percent, sl_percent, tp_percent, strategy, probability } = req.body;
  if (!symbol || !direction) return res.status(400).json({ error: "symbol e direction obrigatórios" });

  const eliteSlaves = [];
  activeSlaves.forEach((data, userId) => {
    const isOnline = (new Date() - data.lastSeen) / 1000 < SLAVE_TIMEOUT_S;
    if (isOnline && data.plan === "elite") eliteSlaves.push({ userId, ...data });
  });

  let copied = 0;
  for (const slave of eliteSlaves) {
    slavePendingOrders.set(slave.userId, {
      order_id: generateOrderId(), direction, symbol,
      sl: 0, tp: 0, lot_size: 0,
      risk_percent: risk_percent || 1.0,
      sl_percent: sl_percent || 0.5,
      tp_percent: tp_percent || 1.0,
      strategy: strategy || "COPY",
      probability: probability || 0,
      is_copy_trade: true,
      timestamp: new Date().toISOString(),
    });
    if (slave.whatsapp_phone) {
      await sendWhatsAppAlert(slave.whatsapp_phone,
        `🤖 Copy Trade: ${direction} ${symbol}\nEstratégia: ${strategy}\nProb: ${probability}%`);
    }
    copied++;
  }

  broadcastToSite({ type: "copy_trade", symbol, direction, strategy, probability, clients: copied, timestamp: new Date().toISOString() });
  res.json({ status: "ok", clients_copied: copied });
});

// ─────────────────────────────────────────────
// ROTAS — Preços MT5
// ─────────────────────────────────────────────
app.post("/price", (req, res) => {
  const data = req.body;
  if (!data || !data.symbol) return res.status(400).json({ error: "Dados inválidos" });
  mt5LastSeen = new Date();
  const priceData = {
    symbol: data.symbol, bid: data.bid, ask: data.ask, spread: data.spread,
    rsi: data.rsi, ema20: data.ema20, ema50: data.ema50,
    close1: data.close1, high1: data.high1, low1: data.low1,
    closes: data.closes || null, highs: data.highs || null,
    lows: data.lows || null, opens: data.opens || null,
    strategy: data.strategy || "QUICK", receivedAt: new Date().toISOString(),
  };
  allPrices.set(data.symbol, priceData);
  broadcastToSite({ type: "price", ...priceData });
  broadcastToSite({ type: "mt5_status", connected: true });
  res.json({ status: "ok", symbols_tracked: allPrices.size });
});

app.get("/price/:symbol", (req, res) => {
  const symbol    = req.params.symbol.toUpperCase();
  const priceData = allPrices.get(symbol);
  if (!priceData) return res.status(404).json({ error: "Preço não disponível.", symbol, available: Array.from(allPrices.keys()) });
  if (!isPriceFresh(priceData)) return res.status(503).json({ error: "Preço desatualizado.", symbol });
  res.json({ symbol: priceData.symbol, bid: priceData.bid, ask: priceData.ask, spread: priceData.spread, rsi: priceData.rsi, receivedAt: priceData.receivedAt });
});

app.get("/prices", (req, res) => {
  const prices = [];
  allPrices.forEach((data, symbol) => prices.push({ symbol, bid: data.bid, ask: data.ask, fresh: isPriceFresh(data), receivedAt: data.receivedAt }));
  res.json({ total: prices.length, mt5_connected: isMt5Online(), prices, timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// ROTAS — Live Room
// ─────────────────────────────────────────────
app.get("/live-signals", (req, res) => {
  res.json({
    active: liveRoomActive, clients: liveRoomClients.size,
    signals: liveSignalHistory.slice(0, 20),
    scoreboard: liveScoreboard, assets: LIVE_ASSETS,
    focused_asset: getMostFocusedAsset(),
    timestamp: new Date().toISOString(),
  });
});

app.post("/live-signal-result", (req, res) => {
  const { signal_id, result, profit } = req.body;
  const signal = liveSignalHistory.find(s => s.id === signal_id);
  if (signal) { signal.result = result; signal.profit = profit; }
  const profitVal = parseFloat(profit) || 0;
  if (result === "win") { liveScoreboard.wins++; liveScoreboard.profit += profitVal; }
  else if (result === "loss") { liveScoreboard.losses++; liveScoreboard.profit += profitVal; }
  broadcastToLiveRoom({ type: "signal_result", signal_id, result, profit: profitVal, scoreboard: liveScoreboard, timestamp: new Date().toISOString() });
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// ROTAS — Slaves
// ─────────────────────────────────────────────
app.post("/slave-register", async (req, res) => {
  const { user_id, account, symbol, balance, status, whatsapp_phone } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id obrigatório" });
  if (status === "disconnected") {
    activeSlaves.delete(user_id);
    broadcastToSite({ type: "slave_status", user_id, connected: false });
    return res.json({ status: "ok" });
  }
  const planCheck = await checkProPlan(user_id);
  if (!planCheck.allowed) {
    return res.status(403).json({
      status: "blocked", reason: planCheck.reason,
      message: planCheck.reason === "Plan expired"
        ? "Seu plano expirou. Renove em traderaureonia.com.br"
        : "Plano necessário. Assine em traderaureonia.com.br",
    });
  }
  const limits = getPlanLimits(planCheck.plan || "basic");
  activeSlaves.set(user_id, {
    account: account || "unknown", symbol: symbol || "BTCUSD",
    balance: balance || 0, plan: planCheck.plan || "basic",
    whatsapp_phone: whatsapp_phone || null,
    limits, lastSeen: new Date(),
  });
  broadcastToSite({ type: "slave_status", user_id, connected: true, balance, plan: planCheck.plan });
  res.json({ status: "ok", user_id, plan: planCheck.plan, limits });
});

app.get("/slave-order", (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });
  if (activeSlaves.has(userId)) {
    const slave = activeSlaves.get(userId);
    slave.lastSeen = new Date();
    activeSlaves.set(userId, slave);
  } else {
    activeSlaves.set(userId, { account: "unknown", symbol: "BTCUSD", balance: 0, plan: "basic", lastSeen: new Date() });
  }
  if (slavePendingOrders.has(userId)) {
    const order = slavePendingOrders.get(userId);
    slavePendingOrders.delete(userId);
    return res.json({ hasOrder: true, ...order });
  }
  res.json({ hasOrder: false });
});

app.post("/slave-confirm", (req, res) => {
  const { user_id, order_id, symbol, direction, price, lot, sl, tp } = req.body;
  slaveExecutions.push({ user_id, order_id, symbol, direction, price, lot, sl, tp, timestamp: new Date().toISOString() });
  broadcastToSite({ type: "order_confirmed", user_id, order_id, direction, symbol, price, lot, sl, tp, timestamp: new Date().toISOString() });
  res.json({ status: "ok" });
});

app.post("/slave-trade-closed", async (req, res) => {
  const { user_id, symbol, direction, close_price, profit, result, strategy, probability, confirmations, trend_strength, sl, tp } = req.body;
  if (!user_id || !symbol) return res.status(400).json({ error: "user_id e symbol obrigatórios" });
  const profitVal = parseFloat(profit) || 0;
  const resultStr = profitVal > 0 ? "win" : "loss";
  broadcastToSite({ type: "trade_closed", user_id, symbol, direction, profit: profitVal, result: resultStr, strategy, timestamp: new Date().toISOString() });
  const now = new Date();
  await saveTradeToSupabase({
    user_code: user_id, symbol, direction: direction || "buy",
    entry_price: parseFloat(close_price) || 0,
    sl: parseFloat(sl) || 0, tp: parseFloat(tp) || 0,
    profit: profitVal, result: resultStr,
    hour_of_day: now.getUTCHours(), day_of_week: now.getUTCDay(),
    market_strength: 0, atr_value: 0,
    probability: parseFloat(probability) || 0,
    strategy: strategy || "UNKNOWN",
    confirmations: parseInt(confirmations) || 0,
    trend_strength: parseFloat(trend_strength) || 0,
  });
  res.json({ status: "ok" });
});

app.post("/slave-error", (req, res) => {
  const { user_id, order_id, message } = req.body;
  broadcastToSite({ type: "slave_error", user_id, order_id, message });
  res.json({ status: "ok" });
});

app.post("/client-execute-order", async (req, res) => {
  const { user_id, symbol, direction, sl, tp, lot_size, strategy, probability, confirmations, trend_strength } = req.body;
  if (!user_id || !symbol || !direction) return res.status(400).json({ error: "user_id, symbol e direction obrigatórios." });
  const planCheck = await checkProPlan(user_id);
  const limits    = getPlanLimits(planCheck.plan || "basic");
  if (limits.assets !== "ALL" && !limits.assets.includes(symbol))
    return res.status(403).json({ error: `Ativo ${symbol} não disponível no plano ${planCheck.plan}.`, plan: planCheck.plan });
  if (!limits.autoTrade)
    return res.status(403).json({ error: "Auto Trade não disponível no plano Básico.", plan: planCheck.plan });
  if (!isSlaveOnline(user_id)) {
    const exists = activeSlaves.has(user_id);
    const lastSeenAgo = exists ? Math.round((new Date() - activeSlaves.get(user_id).lastSeen) / 1000) : null;
    return res.status(503).json({ error: "EA Slave não está conectado.", slave_online: false, last_seen: lastSeenAgo });
  }
  const slVal = parseFloat(sl), tpVal = parseFloat(tp);
  if (!slVal || !tpVal) return res.status(400).json({ error: "SL e TP inválidos." });
  const orderId = generateOrderId();
  slavePendingOrders.set(user_id, {
    order_id: orderId, direction, symbol,
    sl: slVal, tp: tpVal, lot_size: parseFloat(lot_size) || 0.01,
    strategy: strategy || "UNKNOWN",
    probability: parseFloat(probability) || 0,
    confirmations: parseInt(confirmations) || 0,
    trend_strength: parseFloat(trend_strength) || 0,
    timestamp: new Date().toISOString(),
  });
  const slave = activeSlaves.get(user_id);
  if (slave?.whatsapp_phone && limits.whatsapp) {
    await sendWhatsAppAlert(slave.whatsapp_phone,
      `📊 ${direction} ${symbol}\nEstratégia: ${strategy}\nProb: ${probability}%`);
  }
  res.json({ status: "ok", message: "Ordem enviada.", order_id: orderId });
});

app.get("/slave-status", (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });
  const exists = activeSlaves.has(userId);
  const slave  = activeSlaves.get(userId);
  const lastSeenAgo = exists ? Math.round((new Date() - slave.lastSeen) / 1000) : null;
  res.json({ user_id: userId, slave_online: exists && lastSeenAgo < SLAVE_TIMEOUT_S, last_seen: lastSeenAgo, balance: slave?.balance ?? null, plan: slave?.plan ?? null, limits: slave?.limits ?? null });
});

app.get("/slaves-status", (req, res) => {
  const slaves = [];
  activeSlaves.forEach((data, userId) => {
    const ago = Math.round((new Date() - data.lastSeen) / 1000);
    slaves.push({ user_id: userId, online: ago < SLAVE_TIMEOUT_S, balance: data.balance, plan: data.plan, last_seen_secs: ago });
  });
  res.json({ total: slaves.length, online: slaves.filter(s => s.online).length, slaves, executions: slaveExecutions.slice(-20) });
});

app.get("/user-trades", async (req, res) => {
  const userCode = req.query.user_code;
  if (!userCode) return res.status(400).json({ error: "user_code obrigatório" });
  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/trades?user_code=eq.${userCode}&order=created_at.desc&limit=500`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await response.json();
    res.json({ user_code: userCode, total: data.length, trades: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/plan-limits/:userId", async (req, res) => {
  const planCheck = await checkProPlan(req.params.userId);
  const limits    = getPlanLimits(planCheck.plan || "basic");
  res.json({ user_id: req.params.userId, plan: planCheck.plan || "basic", limits });
});

// ─────────────────────────────────────────────
// eaSignal_v3
// ─────────────────────────────────────────────
async function callEaSignalV3(strategy, symbol) {
  const priceData = allPrices.get(symbol);
  if (!priceData) throw new Error(`Sem dados para ${symbol}.`);
  let body;
  if (priceData.closes && Array.isArray(priceData.closes) && priceData.closes.length >= 30) {
    body = { strategy, symbol, closes: priceData.closes, highs: priceData.highs || [], lows: priceData.lows || [], opens: priceData.opens || [] };
  } else {
    const bid = parseFloat(priceData.bid);
    const c1 = parseFloat(priceData.close1 || bid), c2 = c1*0.9995, c3 = c1*0.999;
    const h1 = parseFloat(priceData.high1 || c1*1.002), l1 = parseFloat(priceData.low1 || c1*0.998);
    const closes=[],highs=[],lows=[],opens=[];
    for(let i=34;i>=3;i--){const f=1+(Math.random()-0.5)*0.001;closes.push(parseFloat((bid*f).toFixed(5)));highs.push(parseFloat((bid*f*1.001).toFixed(5)));lows.push(parseFloat((bid*f*0.999).toFixed(5)));opens.push(parseFloat((bid*f*0.9995).toFixed(5)));}
    closes.push(c3,c2,c1,bid);highs.push(h1,h1,h1,h1);lows.push(l1,l1,l1,l1);opens.push(c3,c2,c1,bid*0.9998);
    body = { strategy, symbol, closes, highs, lows, opens };
  }
  const response = await fetch(EA_SIGNAL_V3_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${EA_SIGNAL_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result = await response.json();
  result.live_price = priceData.bid;
  result.live_symbol = symbol;
  return result;
}

// ─────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────
wss.on("connection", (ws) => {
  siteClients.add(ws);
  ws.send(JSON.stringify({ type: "mt5_status",        connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "slaves_count",      count: activeSlaves.size }));
  ws.send(JSON.stringify({ type: "symbols_available", symbols: Array.from(allPrices.keys()) }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // ── Ping ──
      if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }

      // ── Análise normal (TradePage) ──
      if (msg.type === "analyze") {
        const strategy = msg.strategy || "QUICK";
        const symbol   = msg.symbol   || "BTCUSD";
        ws.send(JSON.stringify({ type: "analyzing", status: "processing" }));
        try {
          const result = await callEaSignalV3(strategy, symbol);
          ws.send(JSON.stringify({
            type: "analysis_result", symbol, strategy,
            direction: result.direction, entry: result.entry,
            sl: result.sl, tp: result.tp,
            tp1: result.tp1, tp2: result.tp2, tp3: result.tp3,
            tp_levels: result.tp_levels,
            tp1_label: result.tp1_label, tp2_label: result.tp2_label, tp3_label: result.tp3_label,
            probability: result.probability, score: result.probability,
            reason: result.reason, indicators: result.indicators,
            live_price: result.live_price, status: result.status,
            confirmations: result.confirmations, trend_strength: result.trend_strength,
            is_range: result.is_range, timestamp: new Date().toISOString(),
          }));
        } catch (err) { ws.send(JSON.stringify({ type: "error", message: err.message })); }
      }

      // ── Preço específico ──
      if (msg.type === "get_price") {
        const symbol    = msg.symbol?.toUpperCase();
        const priceData = symbol ? allPrices.get(symbol) : null;
        if (priceData && isPriceFresh(priceData))
          ws.send(JSON.stringify({ type: "price", ...priceData }));
        else
          ws.send(JSON.stringify({ type: "price_unavailable", symbol, message: `Preço de ${symbol} não disponível.` }));
      }

      // ── Entrar na sala ao vivo ──
      if (msg.type === "join_live_room") {
        liveRoomClients.add(ws);
        clientFocusAsset.set(ws, null);
        clientStrategies.set(ws, { ...DEFAULT_STRATEGIES });
        startLiveRoom();

        ws.send(JSON.stringify({
          type:       "live_room_joined",
          history:    liveSignalHistory.slice(0, 10),
          scoreboard: liveScoreboard,
          assets:     LIVE_ASSETS,
          strategies: DEFAULT_STRATEGIES,
          message:    "Bem-vindo à sala ao vivo! A IA está monitorando o mercado.",
          timestamp:  new Date().toISOString(),
        }));

        // Emite contagem de viewers para todos
        broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size });
      }

      // ── Sair da sala ao vivo ──
      if (msg.type === "leave_live_room") {
        liveRoomClients.delete(ws);
        clientFocusAsset.delete(ws);
        clientStrategies.delete(ws);
        broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size });
        if (liveRoomClients.size === 0) stopLiveRoom();
      }

      // ── Definir ativo em foco (analisa a cada 10s) ──
      if (msg.type === "focus_asset") {
        const symbol = msg.asset?.toUpperCase();
        if (symbol) {
          clientFocusAsset.set(ws, symbol);
          console.log(`[LiveRoom] Cliente focando em ${symbol}`);
          // Analisa imediatamente ao focar
          const priceData = allPrices.get(symbol);
          if (priceData && isPriceFresh(priceData)) {
            await analyzeLiveAsset(symbol, true);
          }
        }
      }

      // ── Definir estratégia para um ativo ──
      if (msg.type === "set_live_strategy") {
        const { asset, strategy } = msg;
        if (asset && strategy) {
          const strategies = clientStrategies.get(ws) || { ...DEFAULT_STRATEGIES };
          strategies[asset] = strategy;
          clientStrategies.set(ws, strategies);
          console.log(`[LiveRoom] Estratégia ${strategy} para ${asset}`);

          // Analisa imediatamente com a nova estratégia
          const priceData = allPrices.get(asset);
          if (priceData && isPriceFresh(priceData)) {
            await analyzeLiveAsset(asset, true);
          }

          ws.send(JSON.stringify({
            type: "strategy_updated", asset, strategy,
            message: `Estratégia ${strategy} ativa para ${asset}`,
            timestamp: new Date().toISOString(),
          }));
        }
      }

    } catch (e) { console.error("[WS] Erro:", e); }
  });

  ws.on("close", () => {
    siteClients.delete(ws);
    liveRoomClients.delete(ws);
    clientFocusAsset.delete(ws);
    clientStrategies.delete(ws);
    broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size });
    if (liveRoomClients.size === 0) stopLiveRoom();
  });
});

// ─────────────────────────────────────────────
// Limpeza + Keep-alive
// ─────────────────────────────────────────────
setInterval(() => {
  activeSlaves.forEach((data, userId) => {
    if ((new Date() - data.lastSeen) / 1000 > SLAVE_REMOVE_S) {
      activeSlaves.delete(userId);
      broadcastToSite({ type: "slave_status", user_id: userId, connected: false });
    }
  });
  if (mt5LastSeen && (new Date() - mt5LastSeen) > MT5_TIMEOUT_MS)
    broadcastToSite({ type: "mt5_status", connected: false });
}, 5000);

setInterval(async () => {
  try { await fetch(`${RAILWAY_URL}/health`); console.log(`[Keep-alive] OK`); } catch {}
}, 4 * 60 * 1000);

function broadcastToSite(data) {
  const msg = JSON.stringify(data);
  siteClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────
app.get("/health", (_, res) => {
  const slaves = [];
  activeSlaves.forEach((data, userId) => {
    const ago = Math.round((new Date() - data.lastSeen) / 1000);
    slaves.push({ user_id: userId, online: ago < SLAVE_TIMEOUT_S, balance: data.balance, plan: data.plan, last_seen_secs: ago });
  });
  const prices = [];
  allPrices.forEach((data, symbol) => prices.push({ symbol, bid: data.bid, fresh: isPriceFresh(data) }));
  res.json({
    status: "online", version: "v13",
    mt5_connected: isMt5Online(),
    symbols_count: allPrices.size, symbols: prices,
    site_clients: siteClients.size,
    slaves_online: slaves.filter(s => s.online).length,
    slaves_total: activeSlaves.size, slaves,
    elite_online: slaves.filter(s => s.online && s.plan === "elite").length,
    live_room_active: liveRoomActive,
    live_room_clients: liveRoomClients.size,
    live_signals_today: liveScoreboard.signals,
    focused_asset: getMostFocusedAsset(),
    timestamp: new Date().toISOString(),
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v13 rodando na porta ${PORT}`);
  console.log(`[Railway] Live Room: 30s geral + 10s foco por ativo`);
});
