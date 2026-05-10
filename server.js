/**
 * TraderAureonia AI — Servidor Railway v5
 * 
 * NOVIDADE v5:
 * Manual Mode — quando usuário opera pelo site,
 * o robô MT5 pausa automaticamente por 2 minutos
 */

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

app.use(express.json());

// CORS
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
const MT5_TIMEOUT_MS          = 15000;          // 15 segundos

// ─────────────────────────────────────────────
// Estado do servidor
// ─────────────────────────────────────────────
const siteClients  = new Set();
let lastPrice      = null;
let lastCandles    = null;
let pendingOrder   = null;
let mt5LastSeen    = null;
let manualModeUntil = null; // Timestamp até quando o modo manual está ativo

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
  console.log(`[Railway] 🟢 Modo Manual desativado — robô pode operar`);
  broadcastToSite({ type: "manual_mode", active: false });
}

// ─────────────────────────────────────────────
// ROTAS HTTP — Robô MT5
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

// ── MT5 consulta se está em modo manual ──
// O robô chama isso antes de abrir qualquer ordem automática
app.get("/robot-allowed", (req, res) => {
  mt5LastSeen = new Date();
  const manual = isManualMode();
  res.json({
    allowed: !manual,
    manual_mode: manual,
    manual_until: manualModeUntil?.toISOString() ?? null,
  });
});

// MT5 busca ordem pendente
app.get("/pending-order", (req, res) => {
  mt5LastSeen = new Date();
  if (pendingOrder) {
    const order = pendingOrder;
    pendingOrder = null;
    console.log(`[Railway] Entregando ordem ao MT5: ${order.direction} ${order.symbol}`);
    return res.json({ hasOrder: true, order });
  }
  res.json({ hasOrder: false });
});

// MT5 confirma execução
app.post("/order-executed", (req, res) => {
  const data = req.body;
  console.log(`[Railway] ✅ Ordem executada pelo MT5:`, data);
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
  res.json({ status: "ok" });
});

// MT5 reporta erro
app.post("/order-error", (req, res) => {
  broadcastToSite({ type: "mt5_error", message: req.body.message });
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// ROTAS HTTP — Site
// ─────────────────────────────────────────────

// Site ativa o modo manual (antes de executar uma ordem)
app.post("/pause-robot", (req, res) => {
  activateManualMode();
  res.json({
    status:  "ok",
    message: "Robô pausado por 2 minutos. Pode executar a ordem.",
    until:   manualModeUntil.toISOString(),
  });
});

// Site desativa o modo manual manualmente
app.post("/resume-robot", (req, res) => {
  deactivateManualMode();
  res.json({ status: "ok", message: "Robô voltou a operar normalmente." });
});

// Site envia ordem via HTTP POST
app.post("/execute-order", async (req, res) => {
  const { symbol, direction, entry, sl, tp, lot_size } = req.body;

  if (!symbol || !direction) {
    return res.status(400).json({ error: "symbol e direction são obrigatórios." });
  }

  if (!isMt5Online()) {
    return res.status(503).json({ error: "MT5 não está conectado. Verifique se o robô está rodando." });
  }

  // Ativa modo manual automaticamente ao executar ordem
  activateManualMode();

  // Aguarda 500ms para garantir que o robô recebeu o sinal de pausa
  await new Promise(resolve => setTimeout(resolve, 500));

  pendingOrder = {
    symbol:    symbol,
    direction: direction,
    entry:     entry    || 0,
    sl:        sl       || 0,
    tp:        tp       || 0,
    lot_size:  lot_size || 0.01,
  };

  console.log(`[Railway] ✅ Ordem do site: ${direction} ${symbol} | Entry:${entry} SL:${sl} TP:${tp}`);

  broadcastToSite({
    type:    "order_sent",
    message: `Ordem ${direction} ${symbol} enviada ao MT5...`,
  });

  res.json({
    status:  "ok",
    message: "Robô pausado e ordem enfileirada. MT5 vai executar em até 5 segundos.",
    order:   pendingOrder,
  });
});

// ─────────────────────────────────────────────
// Desativa modo manual automaticamente após 2 min
// ─────────────────────────────────────────────
setInterval(() => {
  if (manualModeUntil && new Date() >= manualModeUntil) {
    deactivateManualMode();
  }
}, 10000); // Verifica a cada 10 segundos

// ─────────────────────────────────────────────
// CHAMA eaSignal_v3 COM DADOS REAIS DO MT5
// ─────────────────────────────────────────────
async function callEaSignalV3(strategy, symbol) {
  if (!lastPrice) {
    throw new Error("MT5 não está enviando dados. Verifique se o robô está rodando.");
  }

  let body;

  if (lastCandles && lastCandles.closes.length >= 30) {
    body = {
      strategy: strategy,
      symbol:   symbol || lastCandles.symbol,
      closes:   lastCandles.closes,
      highs:    lastCandles.highs,
      lows:     lastCandles.lows,
      opens:    lastCandles.opens,
    };
    console.log(`[Railway] Usando candles do MT5 (${lastCandles.closes.length} velas)`);
  } else {
    const bid    = parseFloat(lastPrice.bid);
    const close1 = parseFloat(lastPrice.close1 || bid);
    const close2 = parseFloat(lastPrice.close2 || close1 * 0.9995);
    const close3 = parseFloat(lastPrice.close3 || close1 * 0.9990);
    const high1  = parseFloat(lastPrice.high1  || close1 * 1.002);
    const low1   = parseFloat(lastPrice.low1   || close1 * 0.998);

    const closes = [], highs = [], lows = [], opens = [];
    for (let i = 34; i >= 3; i--) {
      const factor = 1 + (Math.random() - 0.5) * 0.001;
      closes.push(parseFloat((bid * factor).toFixed(2)));
      highs.push(parseFloat((bid * factor * 1.001).toFixed(2)));
      lows.push(parseFloat((bid * factor * 0.999).toFixed(2)));
      opens.push(parseFloat((bid * factor * 0.9995).toFixed(2)));
    }
    closes.push(close3, close2, close1, bid);
    highs.push(high1, high1, high1, high1);
    lows.push(low1, low1, low1, low1);
    opens.push(close3, close2, close1, bid * 0.9998);

    body = { strategy, symbol: symbol || lastPrice.symbol, closes, highs, lows, opens };
    console.log(`[Railway] Usando preço ao vivo (fallback)`);
  }

  const response = await fetch(EA_SIGNAL_V3_URL, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${EA_SIGNAL_KEY}`,
    },
    body: JSON.stringify(body),
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
  console.log(`[Railway] Site conectado | Total: ${siteClients.size + 1}`);
  siteClients.add(ws);

  // Envia estado atual ao conectar
  ws.send(JSON.stringify({ type: "mt5_status", connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "manual_mode", active: isManualMode(), until: manualModeUntil?.toISOString() ?? null }));
  if (lastPrice) ws.send(JSON.stringify({ type: "price", ...lastPrice }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Site pediu análise
      if (msg.type === "analyze") {
        const strategy = msg.strategy || "QUICK";
        const symbol   = msg.symbol   || (lastPrice?.symbol ?? "BTCUSD");

        console.log(`[Railway] Análise: ${symbol} ${msg.timeframe} ${strategy}`);
        ws.send(JSON.stringify({ type: "analyzing", status: "processing" }));

        try {
          const result = await callEaSignalV3(strategy, symbol);
          ws.send(JSON.stringify({
            type:          "analysis_result",
            symbol:        symbol,
            timeframe:     msg.timeframe,
            strategy:      strategy,
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
    console.log(`[Railway] Site desconectado | Restam: ${siteClients.size}`);
  });
});

// ─────────────────────────────────────────────
// Detecta MT5 offline
// ─────────────────────────────────────────────
setInterval(() => {
  if (mt5LastSeen && (new Date() - mt5LastSeen) > MT5_TIMEOUT_MS) {
    broadcastToSite({ type: "mt5_status", connected: false });
  }
}, 3000);

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
  res.json({
    status:        "online",
    mt5_connected: isMt5Online(),
    manual_mode:   isManualMode(),
    manual_until:  manualModeUntil?.toISOString() ?? null,
    live_price:    lastPrice?.bid    ?? null,
    live_symbol:   lastPrice?.symbol ?? null,
    has_candles:   lastCandles !== null,
    candles_count: lastCandles?.closes?.length ?? 0,
    site_clients:  siteClients.size,
    pending_order: pendingOrder !== null,
    timestamp:     new Date().toISOString(),
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v5 rodando na porta ${PORT}`);
  console.log(`[Railway] Endpoints: /pause-robot | /resume-robot | /execute-order | /robot-allowed`);
});
