/**
 * TraderAureonia AI — Servidor Railway v6
 * 
 * NOVIDADE v6: Sistema de Slaves
 * - Usuários PRO instalam o EA Slave no MT5 deles
 * - Quando você opera, a ordem é replicada para todos os slaves ativos
 * - Cada slave tem um User ID único
 */

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const PORT = process.env.PORT || 3001;

const EA_SIGNAL_V3_URL = "https://traderaureonia.base44.app/api/functions/eaSignal_v3";
const EA_SIGNAL_KEY    = "abc123forte";

const MANUAL_MODE_DURATION_MS = 2 * 60 * 1000; // 2 minutos
const MT5_TIMEOUT_MS          = 15000;

// ─────────────────────────────────────────────
// Estado do servidor
// ─────────────────────────────────────────────
const siteClients   = new Set();
let lastPrice       = null;
let lastCandles     = null;
let pendingOrder    = null;
let mt5LastSeen     = null;
let manualModeUntil = null;

// ── Sistema de Slaves ──
// Mapa de slaves ativos: userId → { account, symbol, balance, lastSeen, status }
const activeSlaves = new Map();

// Fila de ordens para slaves: userId → { order_id, direction, symbol, sl, tp, lot_size, timestamp }
const slavePendingOrders = new Map();

// Histórico de execuções dos slaves
const slaveExecutions = [];

// Contador de ordem ID
let orderCounter = 1;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function isMt5Online() {
  return mt5LastSeen && (new Date() - mt5LastSeen) < MT5_TIMEOUT_MS;
}

function isManualMode() {
  return manualModeUntil && new Date() < manualModeUntil;
}

function activateManualMode() {
  manualModeUntil = new Date(Date.now() + MANUAL_MODE_DURATION_MS);
  console.log(`[Railway] 🔴 Modo Manual ativado até ${manualModeUntil.toISOString()}`);
  broadcastToSite({ type: "manual_mode", active: true, until: manualModeUntil.toISOString() });
}

function deactivateManualMode() {
  manualModeUntil = null;
  broadcastToSite({ type: "manual_mode", active: false });
}

function generateOrderId() {
  return `ORD-${Date.now()}-${orderCounter++}`;
}

// ─────────────────────────────────────────────
// ROTAS HTTP — Robô MT5 Master (seu robô)
// ─────────────────────────────────────────────

// MT5 envia preço + candles a cada tick
app.post("/price", (req, res) => {
  const data = req.body;
  if (!data || !data.symbol) return res.status(400).json({ error: "Dados inválidos" });

  mt5LastSeen = new Date();

  lastPrice = {
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
    receivedAt: new Date().toISOString(),
  };

  if (data.closes && Array.isArray(data.closes) && data.closes.length >= 30) {
    lastCandles = {
      symbol:    data.symbol,
      strategy:  data.strategy || "QUICK",
      closes:    data.closes,
      highs:     data.highs  || [],
      lows:      data.lows   || [],
      opens:     data.opens  || [],
      updatedAt: new Date().toISOString(),
    };
  }

  broadcastToSite({ type: "price", ...lastPrice });
  broadcastToSite({ type: "mt5_status", connected: true });

  res.json({ status: "ok" });
});

// MT5 master consulta modo manual
app.get("/robot-allowed", (req, res) => {
  mt5LastSeen = new Date();
  const manual = isManualMode();
  res.json({
    allowed:      !manual,
    manual_mode:  manual,
    manual_until: manualModeUntil?.toISOString() ?? null,
  });
});

// MT5 master busca ordem pendente
app.get("/pending-order", (req, res) => {
  mt5LastSeen = new Date();
  if (pendingOrder) {
    const order = pendingOrder;
    pendingOrder = null;
    console.log(`[Railway] Entregando ordem ao MT5 master: ${order.direction} ${order.symbol}`);
    return res.json({ hasOrder: true, order });
  }
  res.json({ hasOrder: false });
});

// MT5 master confirma execução — replica para todos os slaves
app.post("/order-executed", (req, res) => {
  const data = req.body;
  console.log(`[Railway] ✅ Ordem executada pelo MT5 master:`, data);

  // Notifica o site
  broadcastToSite({
    type:      "order_confirmed",
    symbol:    data.symbol,
    ticket:    data.ticket,
    direction: data.direction,
    entry:     data.entry,
    sl:        data.sl,
    tp:        data.tp,
    timestamp: new Date().toISOString(),
  });

  // ── REPLICA PARA TODOS OS SLAVES ATIVOS ──
  replicateToSlaves({
    direction: data.direction,
    symbol:    data.symbol,
    sl:        data.sl,
    tp:        data.tp,
    lot_size:  data.lot || 0.01,
  });

  res.json({ status: "ok" });
});

// MT5 reporta erro
app.post("/order-error", (req, res) => {
  broadcastToSite({ type: "mt5_error", message: req.body.message });
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// ROTAS HTTP — Slaves (MT5 dos usuários PRO)
// ─────────────────────────────────────────────

// Slave registra presença (conectar/desconectar)
app.post("/slave-register", (req, res) => {
  const { user_id, account, symbol, balance, status } = req.body;

  if (!user_id) return res.status(400).json({ error: "user_id obrigatório" });

  if (status === "disconnected") {
    activeSlaves.delete(user_id);
    console.log(`[Railway] Slave desconectado: ${user_id}`);
    broadcastToSite({ type: "slave_status", user_id, connected: false });
    return res.json({ status: "ok", message: "Slave desregistrado" });
  }

  // TODO: Verificar se o user_id é válido e tem plano PRO ativo no Supabase
  // Por enquanto aceita qualquer ID

  activeSlaves.set(user_id, {
    account:   account || "unknown",
    symbol:    symbol  || "BTCUSD",
    balance:   balance || 0,
    lastSeen:  new Date(),
    status:    "connected",
  });

  console.log(`[Railway] ✅ Slave conectado: ${user_id} | Conta: ${account} | Saldo: ${balance}`);
  broadcastToSite({
    type:     "slave_status",
    user_id,
    connected: true,
    account,
    balance,
  });

  res.json({
    status:  "ok",
    message: "Slave registrado com sucesso!",
    user_id,
    slaves_online: activeSlaves.size,
  });
});

// Slave busca ordem pendente para ele
app.get("/slave-order", (req, res) => {
  const userId = req.query.user_id;

  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });

  // Atualiza lastSeen do slave
  if (activeSlaves.has(userId)) {
    const slave = activeSlaves.get(userId);
    slave.lastSeen = new Date();
    activeSlaves.set(userId, slave);
  }

  // Verifica se tem ordem pendente para esse slave
  if (slavePendingOrders.has(userId)) {
    const order = slavePendingOrders.get(userId);
    slavePendingOrders.delete(userId); // Remove após entregar
    console.log(`[Railway] Entregando ordem ao slave ${userId}: ${order.direction} ${order.symbol}`);
    return res.json({ hasOrder: true, ...order });
  }

  res.json({ hasOrder: false });
});

// Slave confirma que executou a ordem
app.post("/slave-confirm", (req, res) => {
  const { user_id, order_id, symbol, direction, price, lot } = req.body;
  console.log(`[Railway] ✅ Slave ${user_id} executou: ${direction} ${symbol} @ ${price}`);

  slaveExecutions.push({
    user_id, order_id, symbol, direction, price, lot,
    timestamp: new Date().toISOString(),
  });

  broadcastToSite({
    type:      "slave_executed",
    user_id,
    order_id,
    direction,
    symbol,
    price,
    lot,
    timestamp: new Date().toISOString(),
  });

  res.json({ status: "ok" });
});

// Slave reporta erro
app.post("/slave-error", (req, res) => {
  const { user_id, order_id, message } = req.body;
  console.error(`[Railway] ❌ Slave ${user_id} erro: ${message}`);

  broadcastToSite({
    type:     "slave_error",
    user_id,
    order_id,
    message,
    timestamp: new Date().toISOString(),
  });

  res.json({ status: "ok" });
});

// Site busca lista de slaves ativos (para dashboard admin)
app.get("/slaves-status", (req, res) => {
  const slaves = [];
  activeSlaves.forEach((data, userId) => {
    const lastSeenAgo = Math.round((new Date() - data.lastSeen) / 1000);
    slaves.push({
      user_id:        userId,
      account:        data.account,
      balance:        data.balance,
      last_seen_secs: lastSeenAgo,
      online:         lastSeenAgo < 10,
    });
  });

  res.json({
    total:       slaves.length,
    online:      slaves.filter(s => s.online).length,
    slaves,
    executions:  slaveExecutions.slice(-20), // últimas 20 execuções
  });
});

// ─────────────────────────────────────────────
// Replica ordem para todos os slaves ativos
// ─────────────────────────────────────────────
function replicateToSlaves(orderData) {
  if (activeSlaves.size === 0) {
    console.log("[Railway] Nenhum slave ativo para replicar.");
    return;
  }

  const orderId = generateOrderId();
  let count = 0;

  activeSlaves.forEach((slaveData, userId) => {
    const lastSeenAgo = (new Date() - slaveData.lastSeen) / 1000;

    // Só replica para slaves que responderam nos últimos 10 segundos
    if (lastSeenAgo > 10) {
      console.log(`[Railway] Slave ${userId} offline (${lastSeenAgo}s). Pulando.`);
      return;
    }

    slavePendingOrders.set(userId, {
      order_id:  orderId,
      direction: orderData.direction,
      symbol:    orderData.symbol,
      sl:        orderData.sl,
      tp:        orderData.tp,
      lot_size:  orderData.lot_size || 0.01,
      timestamp: new Date().toISOString(),
    });

    count++;
    console.log(`[Railway] Ordem replicada para slave ${userId}`);
  });

  if (count > 0) {
    console.log(`[Railway] ✅ Ordem ${orderId} replicada para ${count} slave(s)`);
    broadcastToSite({
      type:    "order_replicated",
      order_id: orderId,
      slaves:  count,
      direction: orderData.direction,
      symbol:  orderData.symbol,
    });
  }
}

// ─────────────────────────────────────────────
// ROTAS HTTP — Site
// ─────────────────────────────────────────────

// Site pausa o robô antes de executar ordem manual
app.post("/pause-robot", (req, res) => {
  activateManualMode();
  res.json({
    status:  "ok",
    message: "Robô pausado por 2 minutos.",
    until:   manualModeUntil.toISOString(),
  });
});

app.post("/resume-robot", (req, res) => {
  deactivateManualMode();
  res.json({ status: "ok", message: "Robô voltou a operar." });
});

// Site executa ordem via HTTP
app.post("/execute-order", async (req, res) => {
  const { symbol, direction, entry, sl, tp, lot_size } = req.body;

  if (!symbol || !direction)
    return res.status(400).json({ error: "symbol e direction obrigatórios" });

  if (!isMt5Online())
    return res.status(503).json({ error: "MT5 não está conectado." });

  activateManualMode();
  await new Promise(resolve => setTimeout(resolve, 500));

  pendingOrder = { symbol, direction, entry: entry || 0, sl: sl || 0, tp: tp || 0, lot_size: lot_size || 0.01 };

  console.log(`[Railway] ✅ Ordem do site: ${direction} ${symbol}`);
  broadcastToSite({ type: "order_sent", message: `Ordem ${direction} ${symbol} enviada ao MT5...` });

  res.json({ status: "ok", message: "Ordem enfileirada para o MT5." });
});

// ─────────────────────────────────────────────
// CHAMA eaSignal_v3
// ─────────────────────────────────────────────
async function callEaSignalV3(strategy, symbol) {
  if (!lastPrice) throw new Error("MT5 não está enviando dados.");

  let body;

  if (lastCandles && lastCandles.closes.length >= 30) {
    body = {
      strategy,
      symbol: symbol || lastCandles.symbol,
      closes: lastCandles.closes,
      highs:  lastCandles.highs,
      lows:   lastCandles.lows,
      opens:  lastCandles.opens,
    };
  } else {
    const bid    = parseFloat(lastPrice.bid);
    const close1 = parseFloat(lastPrice.close1 || bid);
    const close2 = parseFloat(lastPrice.close2 || close1 * 0.9995);
    const close3 = parseFloat(lastPrice.close3 || close1 * 0.9990);
    const high1  = parseFloat(lastPrice.high1  || close1 * 1.002);
    const low1   = parseFloat(lastPrice.low1   || close1 * 0.998);

    const closes = [], highs = [], lows = [], opens = [];
    for (let i = 34; i >= 3; i--) {
      const f = 1 + (Math.random() - 0.5) * 0.001;
      closes.push(parseFloat((bid * f).toFixed(2)));
      highs.push(parseFloat((bid * f * 1.001).toFixed(2)));
      lows.push(parseFloat((bid * f * 0.999).toFixed(2)));
      opens.push(parseFloat((bid * f * 0.9995).toFixed(2)));
    }
    closes.push(close3, close2, close1, bid);
    highs.push(high1, high1, high1, high1);
    lows.push(low1, low1, low1, low1);
    opens.push(close3, close2, close1, bid * 0.9998);

    body = { strategy, symbol: symbol || lastPrice.symbol, closes, highs, lows, opens };
  }

  const response = await fetch(EA_SIGNAL_V3_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${EA_SIGNAL_KEY}` },
    body:    JSON.stringify(body),
  });

  if (!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result = await response.json();
  result.live_price  = lastPrice.bid;
  result.live_symbol = lastPrice.symbol;
  return result;
}

// ─────────────────────────────────────────────
// WEBSOCKET — Site
// ─────────────────────────────────────────────
wss.on("connection", (ws) => {
  siteClients.add(ws);
  ws.send(JSON.stringify({ type: "mt5_status",   connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "manual_mode",  active: isManualMode() }));
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
            type:          "analysis_result",
            symbol,
            timeframe:     msg.timeframe,
            strategy,
            direction:     result.direction,
            entry:         result.entry,
            sl:            result.sl,
            tp:            result.tp,
            probability:   result.probability,
            score:         result.probability,
            reason:        result.reason,
            indicators:    result.indicators,
            live_price:    result.live_price,
            live_symbol:   result.live_symbol,
            status:        result.status,
            confirmations: result.confirmations,
            timestamp:     new Date().toISOString(),
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
      }

    } catch (e) {
      console.error("[Railway] Erro WS:", e);
    }
  });

  ws.on("close", () => {
    siteClients.delete(ws);
  });
});

// ─────────────────────────────────────────────
// Limpeza automática
// ─────────────────────────────────────────────
setInterval(() => {
  // Desativa modo manual expirado
  if (manualModeUntil && new Date() >= manualModeUntil) deactivateManualMode();

  // Remove slaves offline há mais de 30 segundos
  activeSlaves.forEach((data, userId) => {
    const lastSeenAgo = (new Date() - data.lastSeen) / 1000;
    if (lastSeenAgo > 30) {
      activeSlaves.delete(userId);
      console.log(`[Railway] Slave ${userId} removido por inatividade`);
      broadcastToSite({ type: "slave_status", user_id: userId, connected: false });
    }
  });

  // Detecta MT5 master offline
  if (mt5LastSeen && (new Date() - mt5LastSeen) > MT5_TIMEOUT_MS) {
    broadcastToSite({ type: "mt5_status", connected: false });
  }
}, 5000);

function broadcastToSite(data) {
  const msg = JSON.stringify(data);
  siteClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
app.get("/health", (_, res) => {
  const slaves = [];
  activeSlaves.forEach((data, userId) => {
    slaves.push({
      user_id: userId,
      online:  (new Date() - data.lastSeen) / 1000 < 10,
      balance: data.balance,
    });
  });

  res.json({
    status:        "online",
    version:       "v6",
    mt5_connected: isMt5Online(),
    manual_mode:   isManualMode(),
    live_price:    lastPrice?.bid    ?? null,
    live_symbol:   lastPrice?.symbol ?? null,
    has_candles:   lastCandles !== null,
    candles_count: lastCandles?.closes?.length ?? 0,
    site_clients:  siteClients.size,
    pending_order: pendingOrder !== null,
    slaves_online: slaves.filter(s => s.online).length,
    slaves_total:  activeSlaves.size,
    slaves,
    timestamp:     new Date().toISOString(),
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v6 rodando na porta ${PORT}`);
  console.log(`[Railway] Slaves: /slave-register | /slave-order | /slave-confirm`);
});
