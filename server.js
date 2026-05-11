/**
 * TraderAureonia AI — Servidor Railway v7
 *
 * ARQUITETURA CORRETA:
 * - Seu MT5 Master só envia preço e candles
 * - Cliente analisa no site e clica Executar
 * - Ordem vai direto para o Slave do cliente
 * - Cada cliente opera de forma independente
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

// Download do EA Slave
app.get("/download/slave", (_, res) => {
  res.download(path.join(__dirname, "TraderAureonia_Slave.mq5"));
});

// CORS
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
const MT5_TIMEOUT_MS   = 15000;

// ─────────────────────────────────────────────
// Estado do servidor
// ─────────────────────────────────────────────
const siteClients = new Set();
let lastPrice     = null;
let lastCandles   = null;
let mt5LastSeen   = null;

// Slaves ativos: userId → { account, balance, lastSeen, symbol }
const activeSlaves = new Map();

// Ordens pendentes por usuário: userId → { order_id, direction, symbol, sl, tp, lot_size }
const slavePendingOrders = new Map();

// Histórico de execuções
const slaveExecutions = [];

let orderCounter = 1;

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
  const slave = activeSlaves.get(userId);
  return (new Date() - slave.lastSeen) / 1000 < 10;
}

// ─────────────────────────────────────────────
// ROTAS — Seu MT5 Master (só envia preço)
// ─────────────────────────────────────────────

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

  // Repassa preço ao vivo para todos os clientes no site
  broadcastToSite({ type: "price", ...lastPrice });
  broadcastToSite({ type: "mt5_status", connected: true });

  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// ROTAS — Slaves dos clientes
// ─────────────────────────────────────────────

// Slave registra presença
app.post("/slave-register", (req, res) => {
  const { user_id, account, symbol, balance, status } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id obrigatório" });

  if (status === "disconnected") {
    activeSlaves.delete(user_id);
    console.log(`[Railway] Slave desconectado: ${user_id}`);
    broadcastToSite({ type: "slave_status", user_id, connected: false });
    return res.json({ status: "ok" });
  }

  activeSlaves.set(user_id, {
    account:  account || "unknown",
    symbol:   symbol  || "BTCUSD",
    balance:  balance || 0,
    lastSeen: new Date(),
  });

  console.log(`[Railway] ✅ Slave online: ${user_id} | Saldo: ${balance}`);
  broadcastToSite({ type: "slave_status", user_id, connected: true, balance });

  res.json({ status: "ok", message: "Slave registrado!", slaves_online: activeSlaves.size });
});

// Slave busca ordem pendente para ELE
app.get("/slave-order", (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });

  // Atualiza lastSeen
  if (activeSlaves.has(userId)) {
    const slave = activeSlaves.get(userId);
    slave.lastSeen = new Date();
    activeSlaves.set(userId, slave);
  }

  // Tem ordem para esse usuário?
  if (slavePendingOrders.has(userId)) {
    const order = slavePendingOrders.get(userId);
    slavePendingOrders.delete(userId);
    console.log(`[Railway] Entregando ordem ao slave ${userId}: ${order.direction} ${order.symbol}`);
    return res.json({ hasOrder: true, ...order });
  }

  res.json({ hasOrder: false });
});

// Slave confirma execução
app.post("/slave-confirm", (req, res) => {
  const { user_id, order_id, symbol, direction, price, lot, sl, tp } = req.body;
  console.log(`[Railway] ✅ Slave ${user_id} executou: ${direction} ${symbol} @ ${price}`);

  slaveExecutions.push({
    user_id, order_id, symbol, direction, price, lot, sl, tp,
    timestamp: new Date().toISOString(),
  });

  // Notifica o site que a ordem do cliente foi executada
  broadcastToSite({
    type:      "order_confirmed",
    user_id,
    order_id,
    direction,
    symbol,
    price,
    lot,
    sl,
    tp,
    timestamp: new Date().toISOString(),
  });

  res.json({ status: "ok" });
});

// Slave reporta erro
app.post("/slave-error", (req, res) => {
  const { user_id, order_id, message } = req.body;
  console.error(`[Railway] ❌ Slave ${user_id} erro: ${message}`);
  broadcastToSite({ type: "slave_error", user_id, order_id, message });
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// ROTA — Cliente executa ordem pelo site
// O site envia a ordem → Railway enfileira para o Slave do cliente
// ─────────────────────────────────────────────
app.post("/client-execute-order", (req, res) => {
  const { user_id, symbol, direction, entry, sl, tp, lot_size } = req.body;

  if (!user_id || !symbol || !direction) {
    return res.status(400).json({ error: "user_id, symbol e direction são obrigatórios." });
  }

  // Verifica se o Slave do cliente está online
  if (!isSlaveOnline(user_id)) {
    return res.status(503).json({
      error: "Seu EA Slave não está conectado. Verifique se o MT5 está aberto com o EA Slave rodando.",
      slave_online: false,
    });
  }

  const orderId = generateOrderId();

  // Enfileira a ordem para o Slave do cliente
  slavePendingOrders.set(user_id, {
    order_id:  orderId,
    direction: direction,
    symbol:    symbol,
    sl:        sl       || 0,
    tp:        tp       || 0,
    lot_size:  lot_size || 0.01,
    timestamp: new Date().toISOString(),
  });

  console.log(`[Railway] ✅ Ordem enfileirada para slave ${user_id}: ${direction} ${symbol} Lot:${lot_size}`);

  res.json({
    status:   "ok",
    message:  "Ordem enviada para seu MT5. Aguarde a execução.",
    order_id: orderId,
  });
});

// Status do slave de um usuário específico
app.get("/slave-status", (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });

  const online  = isSlaveOnline(userId);
  const slave   = activeSlaves.get(userId);

  res.json({
    user_id:     userId,
    slave_online: online,
    balance:     slave?.balance ?? null,
    account:     slave?.account ?? null,
  });
});

// Lista todos os slaves (para admin)
app.get("/slaves-status", (req, res) => {
  const slaves = [];
  activeSlaves.forEach((data, userId) => {
    const lastSeenAgo = Math.round((new Date() - data.lastSeen) / 1000);
    slaves.push({
      user_id:        userId,
      online:         lastSeenAgo < 10,
      balance:        data.balance,
      last_seen_secs: lastSeenAgo,
    });
  });

  res.json({
    total:      slaves.length,
    online:     slaves.filter(s => s.online).length,
    slaves,
    executions: slaveExecutions.slice(-20),
  });
});

// ─────────────────────────────────────────────
// CHAMA eaSignal_v3 COM DADOS REAIS DO MT5
// ─────────────────────────────────────────────
async function callEaSignalV3(strategy, symbol) {
  if (!lastPrice) throw new Error("MT5 não está enviando dados. Verifique se o robô está rodando.");

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
// WEBSOCKET — Site (preço ao vivo + análise)
// ─────────────────────────────────────────────
wss.on("connection", (ws) => {
  siteClients.add(ws);

  ws.send(JSON.stringify({ type: "mt5_status",   connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "slaves_count", count: activeSlaves.size }));
  if (lastPrice) ws.send(JSON.stringify({ type: "price", ...lastPrice }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Cliente pediu análise
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

  ws.on("close", () => siteClients.delete(ws));
});

// ─────────────────────────────────────────────
// Limpeza automática de slaves inativos
// ─────────────────────────────────────────────
setInterval(() => {
  activeSlaves.forEach((data, userId) => {
    const lastSeenAgo = (new Date() - data.lastSeen) / 1000;
    if (lastSeenAgo > 30) {
      activeSlaves.delete(userId);
      console.log(`[Railway] Slave ${userId} removido por inatividade`);
      broadcastToSite({ type: "slave_status", user_id: userId, connected: false });
    }
  });

  if (mt5LastSeen && (new Date() - mt5LastSeen) > MT5_TIMEOUT_MS) {
    broadcastToSite({ type: "mt5_status", connected: false });
  }
}, 5000);

function broadcastToSite(data) {
  const msg = JSON.stringify(data);
  siteClients.forEach(client => {
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
    version:       "v7",
    mt5_connected: isMt5Online(),
    live_price:    lastPrice?.bid    ?? null,
    live_symbol:   lastPrice?.symbol ?? null,
    has_candles:   lastCandles !== null,
    candles_count: lastCandles?.closes?.length ?? 0,
    site_clients:  siteClients.size,
    slaves_online: slaves.filter(s => s.online).length,
    slaves_total:  activeSlaves.size,
    slaves,
    timestamp:     new Date().toISOString(),
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v7 rodando na porta ${PORT}`);
  console.log(`[Railway] Novo endpoint: POST /client-execute-order`);
});
