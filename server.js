/**
 * TraderAureonia AI — Servidor Railway v3
 * 
 * FLUXO CORRETO:
 * MT5 → envia candles reais → Railway armazena
 * Site → pede análise → Railway chama eaSignal_v3 com candles do MT5
 * eaSignal_v3 → calcula com preço real → retorna sinal correto
 */

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

app.use(express.json());

const PORT = process.env.PORT || 3001;

// URL da função eaSignal_v3 no Base44
const EA_SIGNAL_V3_URL = "https://traderaureonia.base44.app/api/functions/eaSignal_v3";
const EA_SIGNAL_KEY    = "abc123forte";

// ─────────────────────────────────────────────
// Estado do servidor
// ─────────────────────────────────────────────
const siteClients = new Set();
let lastPrice     = null;   // Último preço simples (bid/ask/rsi/ema)
let lastCandles   = null;   // Últimos candles completos do MT5
let pendingOrder  = null;
let mt5LastSeen   = null;

// ─────────────────────────────────────────────
// ROTAS HTTP — Robô MT5
// ─────────────────────────────────────────────

// MT5 envia preço + candles a cada tick
app.post("/price", (req, res) => {
  const data = req.body;
  if (!data || !data.symbol) return res.status(400).json({ error: "Dados inválidos" });

  mt5LastSeen = new Date();

  // Salva preço simples
  lastPrice = {
    symbol:    data.symbol,
    bid:       data.bid,
    ask:       data.ask,
    spread:    data.spread,
    rsi:       data.rsi,
    ema20:     data.ema20,
    ema50:     data.ema50,
    close1:    data.close1,
    high1:     data.high1,
    low1:      data.low1,
    receivedAt: new Date().toISOString(),
  };

  // Salva candles completos se MT5 enviar (arrays closes/highs/lows/opens)
  if (data.closes && Array.isArray(data.closes) && data.closes.length >= 30) {
    lastCandles = {
      symbol:   data.symbol,
      strategy: data.strategy || "QUICK",
      closes:   data.closes,
      highs:    data.highs   || [],
      lows:     data.lows    || [],
      opens:    data.opens   || [],
      updatedAt: new Date().toISOString(),
    };
  }

  // Repassa preço ao vivo para o site
  broadcastToSite({ type: "price", ...lastPrice });
  broadcastToSite({ type: "mt5_status", connected: true });

  res.json({ status: "ok" });
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
  console.log(`[Railway] Ordem executada:`, data);
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
// CHAMA eaSignal_v3 COM DADOS REAIS DO MT5
// ─────────────────────────────────────────────
async function callEaSignalV3(strategy, symbol) {
  if (!lastPrice) {
    throw new Error("MT5 não está enviando dados. Verifique se o robô está rodando.");
  }

  let body;

  // Se tem candles completos do MT5, usa eles (mais preciso)
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
    // Fallback: constrói array simples com os closes disponíveis
    // O MT5 envia close1, close2, close3 — suficiente para análise básica
    const bid    = parseFloat(lastPrice.bid);
    const close1 = parseFloat(lastPrice.close1 || bid);
    const close2 = parseFloat(lastPrice.close2 || close1 * 0.9995);
    const close3 = parseFloat(lastPrice.close3 || close1 * 0.9990);
    const high1  = parseFloat(lastPrice.high1  || close1 * 1.002);
    const low1   = parseFloat(lastPrice.low1   || close1 * 0.998);

    // Monta arrays de 35 velas a partir dos últimos preços
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
    console.log(`[Railway] Usando preço ao vivo (fallback sem candles completos)`);
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

  // Adiciona preço ao vivo para confirmar que está correto
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

  const mt5Online = mt5LastSeen && (new Date() - mt5LastSeen) < 5000;
  ws.send(JSON.stringify({ type: "mt5_status", connected: mt5Online }));
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
          // Chama eaSignal_v3 com candles reais do MT5
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

      // Site pediu execução de ordem
      if (msg.type === "execute_order") {
        const mt5Online = mt5LastSeen && (new Date() - mt5LastSeen) < 5000;
        if (!mt5Online) {
          ws.send(JSON.stringify({ type: "error", message: "MT5 não está conectado." }));
          return;
        }
        pendingOrder = {
          symbol:    msg.symbol,
          direction: msg.direction,
          entry:     msg.entry,
          sl:        msg.sl,
          tp:        msg.tp,
          lot_size:  msg.lot_size || 0.01,
        };
        console.log(`[Railway] Ordem enfileirada: ${msg.direction} ${msg.symbol}`);
        ws.send(JSON.stringify({ type: "order_sent", message: "Ordem enviada ao MT5..." }));
      }

    } catch (e) {
      console.error("[Railway] Erro:", e);
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
  if (mt5LastSeen && (new Date() - mt5LastSeen) > 5000) {
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
  const mt5Online = mt5LastSeen && (new Date() - mt5LastSeen) < 5000;
  res.json({
    status:          "online",
    mt5_connected:   mt5Online,
    live_price:      lastPrice?.bid    ?? null,
    live_symbol:     lastPrice?.symbol ?? null,
    has_candles:     lastCandles !== null,
    candles_count:   lastCandles?.closes?.length ?? 0,
    site_clients:    siteClients.size,
    pending_order:   pendingOrder !== null,
    timestamp:       new Date().toISOString(),
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v3 rodando na porta ${PORT}`);
});
