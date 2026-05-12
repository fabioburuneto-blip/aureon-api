/**
 * TraderAureonia AI — Servidor Railway v9
 *
 * NOVIDADES v9:
 * 1. Endpoint /slave-trade-closed — salva trade fechado no Supabase com lucro real
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

const PORT             = process.env.PORT || 3001;
const EA_SIGNAL_V3_URL = "https://traderaureonia.base44.app/api/functions/eaSignal_v3";
const EA_SIGNAL_KEY    = "abc123forte";
const CHECK_SLAVE_URL  = "https://traderaureonia.base44.app/api/functions/checkSlaveAccess";
const MT5_TIMEOUT_MS   = 15000;
const SLAVE_TIMEOUT_S  = 30;
const SLAVE_REMOVE_S   = 60;

const SUPABASE_URL = "https://vxxdkxlvkrxkfbrvxdal.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4eGRreGx2a3J4a2ZicnZ4ZGFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNjE5MzksImV4cCI6MjA5MTkzNzkzOX0.Z1A_L_ObyDwWSoT0lp9uoB0qpRx7-Tt_oEDpifd-U7s";

// ─────────────────────────────────────────────
// Estado
// ─────────────────────────────────────────────
const siteClients        = new Set();
let   lastPrice          = null;
let   lastCandles        = null;
let   mt5LastSeen        = null;
const activeSlaves       = new Map();
const slavePendingOrders = new Map();
const slaveExecutions    = [];
let   orderCounter       = 1;

// ─────────────────────────────────────────────
// Helpers
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

// ─────────────────────────────────────────────
// Valida plano PRO
// ─────────────────────────────────────────────
async function checkProPlan(userId) {
  try {
    const response = await fetch(`${CHECK_SLAVE_URL}?user_id=${userId}`);
    if (!response.ok) return { allowed: true };
    const data = await response.json();
    console.log(`[Railway] PRO check ${userId}: allowed=${data.allowed} plan=${data.plan}`);
    return data;
  } catch (err) {
    console.error(`[Railway] Erro PRO check:`, err.message);
    return { allowed: true };
  }
}

// ─────────────────────────────────────────────
// Salva trade no Supabase
// ─────────────────────────────────────────────
async function saveTradeToSupabase(tradeData) {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/trades`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "apikey":        SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer":        "return=minimal",
      },
      body: JSON.stringify(tradeData),
    });

    if (response.ok) {
      console.log(`[Railway] Trade salvo: ${tradeData.direction} ${tradeData.symbol} Profit:${tradeData.profit}`);
    } else {
      const err = await response.text();
      console.error(`[Railway] Erro Supabase: ${err}`);
    }
  } catch (err) {
    console.error(`[Railway] Erro Supabase:`, err.message);
  }
}

// ─────────────────────────────────────────────
// ROTAS — MT5 Master
// ─────────────────────────────────────────────
app.post("/price", (req, res) => {
  const data = req.body;
  if (!data || !data.symbol) return res.status(400).json({ error: "Dados inválidos" });

  mt5LastSeen = new Date();
  lastPrice = {
    symbol: data.symbol, bid: data.bid, ask: data.ask, spread: data.spread,
    rsi: data.rsi, ema20: data.ema20, ema50: data.ema50,
    close1: data.close1, high1: data.high1, low1: data.low1,
    receivedAt: new Date().toISOString(),
  };

  if (data.closes && Array.isArray(data.closes) && data.closes.length >= 30) {
    lastCandles = {
      symbol: data.symbol, strategy: data.strategy || "QUICK",
      closes: data.closes, highs: data.highs || [],
      lows: data.lows || [], opens: data.opens || [],
      updatedAt: new Date().toISOString(),
    };
  }

  broadcastToSite({ type: "price", ...lastPrice });
  broadcastToSite({ type: "mt5_status", connected: true });
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// ROTAS — Slaves
// ─────────────────────────────────────────────

// Registra slave com validação PRO
app.post("/slave-register", async (req, res) => {
  const { user_id, account, symbol, balance, status } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id obrigatório" });

  if (status === "disconnected") {
    activeSlaves.delete(user_id);
    broadcastToSite({ type: "slave_status", user_id, connected: false });
    return res.json({ status: "ok" });
  }

  const planCheck = await checkProPlan(user_id);

  if (!planCheck.allowed) {
    console.log(`[Railway] Slave ${user_id} bloqueado: ${planCheck.reason}`);
    return res.status(403).json({
      status:  "blocked",
      reason:  planCheck.reason,
      message: planCheck.reason === "Plan expired"
        ? "Seu plano PRO expirou. Renove em traderaureonia.com.br"
        : "Plano PRO necessario. Assine em traderaureonia.com.br",
    });
  }

  activeSlaves.set(user_id, {
    account: account || "unknown", symbol: symbol || "BTCUSD",
    balance: balance || 0, plan: planCheck.plan || "pro",
    lastSeen: new Date(),
  });

  console.log(`[Railway] Slave PRO online: ${user_id} | Plano: ${planCheck.plan}`);
  broadcastToSite({ type: "slave_status", user_id, connected: true, balance, plan: planCheck.plan });

  res.json({ status: "ok", message: "Slave PRO registrado!", user_id, plan: planCheck.plan });
});

// Slave busca ordem
app.get("/slave-order", (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });

  if (activeSlaves.has(userId)) {
    const slave = activeSlaves.get(userId);
    slave.lastSeen = new Date();
    activeSlaves.set(userId, slave);
  } else {
    activeSlaves.set(userId, { account: "unknown", symbol: "BTCUSD", balance: 0, lastSeen: new Date() });
  }

  if (slavePendingOrders.has(userId)) {
    const order = slavePendingOrders.get(userId);
    slavePendingOrders.delete(userId);
    return res.json({ hasOrder: true, ...order });
  }

  res.json({ hasOrder: false });
});

// Slave confirma abertura de ordem
app.post("/slave-confirm", (req, res) => {
  const { user_id, order_id, symbol, direction, price, lot, sl, tp } = req.body;
  console.log(`[Railway] Slave ${user_id} abriu: ${direction} ${symbol} @ ${price}`);

  slaveExecutions.push({
    user_id, order_id, symbol, direction, price, lot, sl, tp,
    timestamp: new Date().toISOString(),
  });

  broadcastToSite({
    type: "order_confirmed", user_id, order_id, direction, symbol, price, lot, sl, tp,
    timestamp: new Date().toISOString(),
  });

  res.json({ status: "ok" });
});

// ── NOVO: Slave reporta trade FECHADO com lucro real ──
app.post("/slave-trade-closed", async (req, res) => {
  const { user_id, symbol, direction, close_price, profit, result } = req.body;

  if (!user_id || !symbol) return res.status(400).json({ error: "user_id e symbol obrigatórios" });

  const profitVal = parseFloat(profit) || 0;
  const resultStr = profitVal > 0 ? "win" : "loss";

  console.log(`[Railway] Trade fechado: ${user_id} | ${direction} ${symbol} | Profit: ${profitVal} | ${resultStr}`);

  // Notifica o site
  broadcastToSite({
    type:        "trade_closed",
    user_id,
    symbol,
    direction,
    close_price: parseFloat(close_price) || 0,
    profit:      profitVal,
    result:      resultStr,
    timestamp:   new Date().toISOString(),
  });

  // Salva no Supabase com todos os dados
  const now = new Date();
  await saveTradeToSupabase({
    symbol:          symbol,
    direction:       direction || "buy",
    entry_price:     parseFloat(close_price) || 0,
    sl:              0,
    tp:              0,
    profit:          profitVal,
    result:          resultStr,
    hour_of_day:     now.getUTCHours(),
    day_of_week:     now.getUTCDay(),
    market_strength: 0,
    atr_value:       0,
    probability:     0,
  });

  res.json({ status: "ok", message: "Trade fechado salvo no Supabase." });
});

// Slave reporta erro
app.post("/slave-error", (req, res) => {
  const { user_id, order_id, message } = req.body;
  console.error(`[Railway] Slave ${user_id} erro: ${message}`);
  broadcastToSite({ type: "slave_error", user_id, order_id, message });
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// ROTA — Cliente executa ordem
// ─────────────────────────────────────────────
app.post("/client-execute-order", (req, res) => {
  const { user_id, symbol, direction, entry, sl, tp, lot_size } = req.body;

  if (!user_id || !symbol || !direction)
    return res.status(400).json({ error: "user_id, symbol e direction obrigatórios." });

  if (!isSlaveOnline(user_id)) {
    const exists      = activeSlaves.has(user_id);
    const lastSeenAgo = exists ? Math.round((new Date() - activeSlaves.get(user_id).lastSeen) / 1000) : null;
    return res.status(503).json({
      error: "Seu EA Slave não está conectado.", slave_online: false, last_seen: lastSeenAgo,
    });
  }

  const slVal = parseFloat(sl);
  const tpVal = parseFloat(tp);

  if (!slVal || !tpVal || slVal === 0 || tpVal === 0)
    return res.status(400).json({ error: "SL e TP inválidos. Faça uma nova análise." });

  const orderId = generateOrderId();

  slavePendingOrders.set(user_id, {
    order_id: orderId, direction, symbol,
    sl: slVal, tp: tpVal, lot_size: parseFloat(lot_size) || 0.01,
    timestamp: new Date().toISOString(),
  });

  console.log(`[Railway] Ordem para ${user_id}: ${direction} ${symbol} SL:${slVal} TP:${tpVal}`);

  res.json({ status: "ok", message: "Ordem enviada para seu MT5.", order_id: orderId });
});

// Status do slave
app.get("/slave-status", (req, res) => {
  const userId      = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });
  const exists      = activeSlaves.has(userId);
  const slave       = activeSlaves.get(userId);
  const lastSeenAgo = exists ? Math.round((new Date() - slave.lastSeen) / 1000) : null;
  res.json({
    user_id: userId, slave_online: exists && lastSeenAgo < SLAVE_TIMEOUT_S,
    last_seen: lastSeenAgo, balance: slave?.balance ?? null,
    account: slave?.account ?? null, plan: slave?.plan ?? null,
  });
});

app.get("/slaves-status", (req, res) => {
  const slaves = [];
  activeSlaves.forEach((data, userId) => {
    const lastSeenAgo = Math.round((new Date() - data.lastSeen) / 1000);
    slaves.push({ user_id: userId, online: lastSeenAgo < SLAVE_TIMEOUT_S,
                  balance: data.balance, plan: data.plan, last_seen_secs: lastSeenAgo });
  });
  res.json({ total: slaves.length, online: slaves.filter(s => s.online).length,
             slaves, executions: slaveExecutions.slice(-20) });
});

// ─────────────────────────────────────────────
// eaSignal_v3
// ─────────────────────────────────────────────
async function callEaSignalV3(strategy, symbol) {
  if (!lastPrice) throw new Error("MT5 não está enviando dados.");
  let body;
  if (lastCandles && lastCandles.closes.length >= 30) {
    body = { strategy, symbol: symbol || lastCandles.symbol,
             closes: lastCandles.closes, highs: lastCandles.highs,
             lows: lastCandles.lows, opens: lastCandles.opens };
  } else {
    const bid = parseFloat(lastPrice.bid);
    const c1  = parseFloat(lastPrice.close1 || bid);
    const c2  = parseFloat(lastPrice.close2 || c1 * 0.9995);
    const c3  = parseFloat(lastPrice.close3 || c1 * 0.9990);
    const h1  = parseFloat(lastPrice.high1  || c1 * 1.002);
    const l1  = parseFloat(lastPrice.low1   || c1 * 0.998);
    const closes = [], highs = [], lows = [], opens = [];
    for (let i = 34; i >= 3; i--) {
      const f = 1 + (Math.random() - 0.5) * 0.001;
      closes.push(parseFloat((bid * f).toFixed(2)));
      highs.push(parseFloat((bid * f * 1.001).toFixed(2)));
      lows.push(parseFloat((bid * f * 0.999).toFixed(2)));
      opens.push(parseFloat((bid * f * 0.9995).toFixed(2)));
    }
    closes.push(c3, c2, c1, bid); highs.push(h1, h1, h1, h1);
    lows.push(l1, l1, l1, l1);   opens.push(c3, c2, c1, bid * 0.9998);
    body = { strategy, symbol: symbol || lastPrice.symbol, closes, highs, lows, opens };
  }
  const response = await fetch(EA_SIGNAL_V3_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${EA_SIGNAL_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result = await response.json();
  result.live_price  = lastPrice.bid;
  result.live_symbol = lastPrice.symbol;
  return result;
}

// ─────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────
wss.on("connection", (ws) => {
  siteClients.add(ws);
  ws.send(JSON.stringify({ type: "mt5_status",   connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "slaves_count", count: activeSlaves.size }));
  if (lastPrice) ws.send(JSON.stringify({ type: "price", ...lastPrice }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "analyze") {
        const strategy = msg.strategy || "QUICK";
        const symbol   = msg.symbol   || (lastPrice?.symbol ?? "BTCUSD");
        ws.send(JSON.stringify({ type: "analyzing", status: "processing" }));
        try {
          const result = await callEaSignalV3(strategy, symbol);
          ws.send(JSON.stringify({
            type: "analysis_result", symbol, timeframe: msg.timeframe, strategy,
            direction: result.direction, entry: result.entry, sl: result.sl, tp: result.tp,
            probability: result.probability, score: result.probability, reason: result.reason,
            indicators: result.indicators, live_price: result.live_price,
            live_symbol: result.live_symbol, status: result.status,
            confirmations: result.confirmations, timestamp: new Date().toISOString(),
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
      }
    } catch (e) { console.error("[Railway] Erro WS:", e); }
  });

  ws.on("close", () => siteClients.delete(ws));
});

// ─────────────────────────────────────────────
// Limpeza
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

function broadcastToSite(data) {
  const msg = JSON.stringify(data);
  siteClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// ─────────────────────────────────────────────
// Health
// ─────────────────────────────────────────────
app.get("/health", (_, res) => {
  const slaves = [];
  activeSlaves.forEach((data, userId) => {
    const ago = Math.round((new Date() - data.lastSeen) / 1000);
    slaves.push({ user_id: userId, online: ago < SLAVE_TIMEOUT_S,
                  balance: data.balance, plan: data.plan, last_seen_secs: ago });
  });
  res.json({
    status: "online", version: "v9",
    mt5_connected: isMt5Online(),
    live_price: lastPrice?.bid ?? null, live_symbol: lastPrice?.symbol ?? null,
    has_candles: lastCandles !== null, candles_count: lastCandles?.closes?.length ?? 0,
    site_clients: siteClients.size,
    slaves_online: slaves.filter(s => s.online).length,
    slaves_total: activeSlaves.size, slaves,
    timestamp: new Date().toISOString(),
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v9 rodando na porta ${PORT}`);
  console.log(`[Railway] Novo endpoint: POST /slave-trade-closed`);
});
