/**
 * TraderAureonia AI — Servidor Railway v10
 * - Armazena preços de TODOS os ativos enviados pelo MT5
 * - Salva estratégia, probabilidade, confirmações no Supabase
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
// Estado
// ─────────────────────────────────────────────
const siteClients        = new Set();
const allPrices          = new Map();
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
function isPriceFresh(priceData) {
  if (!priceData) return false;
  return (new Date() - new Date(priceData.receivedAt)) / 1000 < PRICE_EXPIRE_S;
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
    return { allowed: true };
  }
}

// ─────────────────────────────────────────────
// Salva trade no Supabase — com todos os campos
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
    if (response.ok)
      console.log(`[Railway] ✅ Trade salvo: ${tradeData.strategy || "?"} | ${tradeData.direction} ${tradeData.symbol} | Prob:${tradeData.probability}% | ${tradeData.result}`);
    else
      console.error(`[Railway] Erro Supabase: ${await response.text()}`);
  } catch (err) {
    console.error(`[Railway] Erro Supabase:`, err.message);
  }
}

// ─────────────────────────────────────────────
// ROTAS — MT5 Master envia preços
// ─────────────────────────────────────────────
app.post("/price", (req, res) => {
  const data = req.body;
  if (!data || !data.symbol) return res.status(400).json({ error: "Dados inválidos" });

  mt5LastSeen = new Date();

  const priceData = {
    symbol:     data.symbol,
    bid:        data.bid,
    ask:        data.ask,
    spread:     data.spread,
    rsi:        data.rsi,
    ema20:      data.ema20,
    ema50:      data.ema50,
    close1:     data.close1,
    high1:      data.high1,
    low1:       data.low1,
    closes:     data.closes  || null,
    highs:      data.highs   || null,
    lows:       data.lows    || null,
    opens:      data.opens   || null,
    strategy:   data.strategy || "QUICK",
    receivedAt: new Date().toISOString(),
  };

  allPrices.set(data.symbol, priceData);
  broadcastToSite({ type: "price", ...priceData });
  broadcastToSite({ type: "mt5_status", connected: true });
  res.json({ status: "ok", symbols_tracked: allPrices.size });
});

// ─────────────────────────────────────────────
// ROTAS — Preços para o Site
// ─────────────────────────────────────────────
app.get("/price/:symbol", (req, res) => {
  const symbol    = req.params.symbol.toUpperCase();
  const priceData = allPrices.get(symbol);

  if (!priceData)
    return res.status(404).json({ error: "Preço não disponível.", symbol, available: Array.from(allPrices.keys()) });

  if (!isPriceFresh(priceData))
    return res.status(503).json({ error: "Preço desatualizado.", symbol, last_update: priceData.receivedAt });

  res.json({
    symbol:      priceData.symbol,
    bid:         priceData.bid,
    ask:         priceData.ask,
    spread:      priceData.spread,
    rsi:         priceData.rsi,
    ema20:       priceData.ema20,
    ema50:       priceData.ema50,
    receivedAt:  priceData.receivedAt,
    age_seconds: Math.round((new Date() - new Date(priceData.receivedAt)) / 1000),
  });
});

app.get("/prices", (req, res) => {
  const prices = [];
  allPrices.forEach((data, symbol) => {
    prices.push({ symbol, bid: data.bid, ask: data.ask, spread: data.spread, rsi: data.rsi, fresh: isPriceFresh(data), receivedAt: data.receivedAt });
  });
  res.json({ total: prices.length, mt5_connected: isMt5Online(), prices, timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// ROTAS — Slaves
// ─────────────────────────────────────────────
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

  console.log(`[Railway] Slave PRO: ${user_id} | ${planCheck.plan} | $${balance}`);
  broadcastToSite({ type: "slave_status", user_id, connected: true, balance, plan: planCheck.plan });
  res.json({ status: "ok", message: "Slave PRO registrado!", user_id, plan: planCheck.plan });
});

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
    console.log(`[Railway] Entregando ordem ao slave ${userId}: ${order.direction} ${order.symbol}`);
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

// ─────────────────────────────────────────────
// ROTA — Trade fechado pelo Slave
// Salva com TODOS os campos incluindo estratégia e probabilidade
// ─────────────────────────────────────────────
app.post("/slave-trade-closed", async (req, res) => {
  const {
    user_id, symbol, direction, close_price, profit, result,
    strategy, probability, confirmations, trend_strength, sl, tp
  } = req.body;

  if (!user_id || !symbol) return res.status(400).json({ error: "user_id e symbol obrigatórios" });

  const profitVal = parseFloat(profit)      || 0;
  const probVal   = parseFloat(probability) || 0;
  const confVal   = parseInt(confirmations) || 0;
  const tsVal     = parseFloat(trend_strength) || 0;
  const resultStr = profitVal > 0 ? "win" : "loss";

  console.log(`[Railway] Trade fechado: ${user_id} | ${symbol} | Estrategia:${strategy} | Prob:${probVal}% | Profit:${profitVal} | ${resultStr}`);

  broadcastToSite({
    type: "trade_closed", user_id, symbol, direction,
    close_price: parseFloat(close_price) || 0,
    profit: profitVal, result: resultStr,
    strategy, probability: probVal,
    timestamp: new Date().toISOString(),
  });

  const now = new Date();
  await saveTradeToSupabase({
    symbol,
    direction:        direction    || "buy",
    entry_price:      parseFloat(close_price) || 0,
    sl:               parseFloat(sl)  || 0,
    tp:               parseFloat(tp)  || 0,
    profit:           profitVal,
    result:           resultStr,
    hour_of_day:      now.getUTCHours(),
    day_of_week:      now.getUTCDay(),
    market_strength:  0,
    atr_value:        0,
    probability:      probVal,
    strategy:         strategy    || "UNKNOWN",
    confirmations:    confVal,
    trend_strength:   tsVal,
  });

  res.json({ status: "ok", message: "Trade salvo com estratégia e probabilidade." });
});

app.post("/slave-error", (req, res) => {
  const { user_id, order_id, message } = req.body;
  broadcastToSite({ type: "slave_error", user_id, order_id, message });
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// ROTA — Cliente executa ordem
// ─────────────────────────────────────────────
app.post("/client-execute-order", (req, res) => {
  const { user_id, symbol, direction, entry, sl, tp, lot_size, strategy, probability, confirmations, trend_strength } = req.body;

  if (!user_id || !symbol || !direction)
    return res.status(400).json({ error: "user_id, symbol e direction obrigatórios." });

  if (!isSlaveOnline(user_id)) {
    const exists      = activeSlaves.has(user_id);
    const lastSeenAgo = exists ? Math.round((new Date() - activeSlaves.get(user_id).lastSeen) / 1000) : null;
    return res.status(503).json({ error: "Seu EA Slave não está conectado.", slave_online: false, last_seen: lastSeenAgo });
  }

  const slVal = parseFloat(sl);
  const tpVal = parseFloat(tp);
  if (!slVal || !tpVal || slVal === 0 || tpVal === 0)
    return res.status(400).json({ error: "SL e TP inválidos. Faça uma nova análise." });

  const orderId = generateOrderId();

  slavePendingOrders.set(user_id, {
    order_id:      orderId,
    direction,
    symbol,
    sl:            slVal,
    tp:            tpVal,
    lot_size:      parseFloat(lot_size) || 0.01,
    // Passa dados da análise para o Slave salvar ao fechar
    strategy:      strategy      || "UNKNOWN",
    probability:   parseFloat(probability)    || 0,
    confirmations: parseInt(confirmations)    || 0,
    trend_strength: parseFloat(trend_strength) || 0,
    timestamp:     new Date().toISOString(),
  });

  console.log(`[Railway] Ordem para ${user_id}: ${direction} ${symbol} | ${strategy} | Prob:${probability}%`);
  res.json({ status: "ok", message: "Ordem enviada para seu MT5.", order_id: orderId });
});

app.get("/slave-status", (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });
  const exists      = activeSlaves.has(userId);
  const slave       = activeSlaves.get(userId);
  const lastSeenAgo = exists ? Math.round((new Date() - slave.lastSeen) / 1000) : null;
  res.json({ user_id: userId, slave_online: exists && lastSeenAgo < SLAVE_TIMEOUT_S, last_seen: lastSeenAgo, balance: slave?.balance ?? null, account: slave?.account ?? null, plan: slave?.plan ?? null });
});

app.get("/slaves-status", (req, res) => {
  const slaves = [];
  activeSlaves.forEach((data, userId) => {
    const ago = Math.round((new Date() - data.lastSeen) / 1000);
    slaves.push({ user_id: userId, online: ago < SLAVE_TIMEOUT_S, balance: data.balance, plan: data.plan, last_seen_secs: ago });
  });
  res.json({ total: slaves.length, online: slaves.filter(s => s.online).length, slaves, executions: slaveExecutions.slice(-20) });
});

// ─────────────────────────────────────────────
// eaSignal_v3
// ─────────────────────────────────────────────
async function callEaSignalV3(strategy, symbol) {
  const priceData = allPrices.get(symbol);
  if (!priceData) throw new Error(`Sem dados de preço para ${symbol}. O MT5 ainda não enviou dados deste ativo.`);

  let body;
  if (priceData.closes && Array.isArray(priceData.closes) && priceData.closes.length >= 30) {
    body = { strategy, symbol, closes: priceData.closes, highs: priceData.highs || [], lows: priceData.lows || [], opens: priceData.opens || [] };
    console.log(`[Railway] Análise ${symbol} com ${priceData.closes.length} candles reais`);
  } else {
    const bid = parseFloat(priceData.bid);
    const c1  = parseFloat(priceData.close1 || bid);
    const c2  = c1 * 0.9995, c3 = c1 * 0.9990;
    const h1  = parseFloat(priceData.high1 || c1 * 1.002);
    const l1  = parseFloat(priceData.low1  || c1 * 0.998);
    const closes = [], highs = [], lows = [], opens = [];
    for (let i = 34; i >= 3; i--) {
      const f = 1 + (Math.random() - 0.5) * 0.001;
      closes.push(parseFloat((bid * f).toFixed(5)));
      highs.push(parseFloat((bid * f * 1.001).toFixed(5)));
      lows.push(parseFloat((bid * f * 0.999).toFixed(5)));
      opens.push(parseFloat((bid * f * 0.9995).toFixed(5)));
    }
    closes.push(c3, c2, c1, bid); highs.push(h1, h1, h1, h1);
    lows.push(l1, l1, l1, l1);   opens.push(c3, c2, c1, bid * 0.9998);
    body = { strategy, symbol, closes, highs, lows, opens };
  }

  const response = await fetch(EA_SIGNAL_V3_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${EA_SIGNAL_KEY}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result = await response.json();
  result.live_price  = priceData.bid;
  result.live_symbol = symbol;
  return result;
}

// ─────────────────────────────────────────────
// WebSocket — Site
// ─────────────────────────────────────────────
wss.on("connection", (ws) => {
  siteClients.add(ws);
  ws.send(JSON.stringify({ type: "mt5_status",      connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "slaves_count",    count: activeSlaves.size }));
  ws.send(JSON.stringify({ type: "symbols_available", symbols: Array.from(allPrices.keys()) }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      if (msg.type === "analyze") {
        const strategy = msg.strategy || "QUICK";
        const symbol   = msg.symbol   || "BTCUSD";
        console.log(`[Railway] Análise: ${symbol} ${strategy}`);
        ws.send(JSON.stringify({ type: "analyzing", status: "processing" }));
        try {
          const result = await callEaSignalV3(strategy, symbol);
          ws.send(JSON.stringify({
            type: "analysis_result", symbol, timeframe: msg.timeframe, strategy,
            direction: result.direction, entry: result.entry, sl: result.sl, tp: result.tp,
            tp1: result.tp1, tp2: result.tp2, tp3: result.tp3,
            tp_levels: result.tp_levels, tp1_label: result.tp1_label,
            tp2_label: result.tp2_label, tp3_label: result.tp3_label,
            probability: result.probability, score: result.probability,
            reason: result.reason, indicators: result.indicators,
            live_price: result.live_price, live_symbol: result.live_symbol,
            status: result.status, confirmations: result.confirmations,
            trend_strength: result.trend_strength, is_range: result.is_range,
            timestamp: new Date().toISOString(),
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
      }

      if (msg.type === "get_price") {
        const symbol    = msg.symbol?.toUpperCase();
        const priceData = symbol ? allPrices.get(symbol) : null;
        if (priceData && isPriceFresh(priceData))
          ws.send(JSON.stringify({ type: "price", ...priceData }));
        else
          ws.send(JSON.stringify({ type: "price_unavailable", symbol, message: `Preço de ${symbol} não disponível.` }));
      }

    } catch (e) { console.error("[Railway] Erro WS:", e); }
  });

  ws.on("close", () => siteClients.delete(ws));
});

// ─────────────────────────────────────────────
// Limpeza automática
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
// Health check
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
    status: "online", version: "v10",
    mt5_connected: isMt5Online(),
    symbols_count: allPrices.size, symbols: prices,
    site_clients:  siteClients.size,
    slaves_online: slaves.filter(s => s.online).length,
    slaves_total:  activeSlaves.size, slaves,
    timestamp:     new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// Keep-alive — evita Railway dormir
// ─────────────────────────────────────────────
setInterval(async () => {
  try {
    await fetch(`${RAILWAY_URL}/health`);
    console.log(`[Railway] Keep-alive OK — ${new Date().toISOString()}`);
  } catch (e) {
    console.log(`[Railway] Keep-alive erro: ${e.message}`);
  }
}, 4 * 60 * 1000);

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v10 rodando na porta ${PORT}`);
  console.log(`[Railway] Salvando: strategy, probability, confirmations, trend_strength`);
});
