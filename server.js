/**
 * TraderAureonia AI — Servidor Railway
 * 
 * MT5  →  POST HTTP  →  Railway  →  WebSocket  →  Site
 * Site →  WebSocket  →  Railway  →  POST HTTP  →  MT5 executa
 * 
 * MT5 usa WebRequest() (HTTP) — funciona nativamente no MQL5
 * Site usa WebSocket — funciona no navegador
 */

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

app.use(express.json());

const PORT = process.env.PORT || 3001;
const BASE44_API_URL = "https://traderaureonia.base44.app/api/functions/eaSignal_v3";

// ─────────────────────────────────────────────
// Estado do servidor
// ─────────────────────────────────────────────
const siteClients  = new Set();   // Usuários do site via WebSocket
let   lastPrice    = null;        // Último preço recebido do MT5
let   pendingOrder = null;        // Ordem aguardando execução pelo MT5
let   mt5LastSeen  = null;        // Último momento que o MT5 enviou dados

// ─────────────────────────────────────────────
// ROTAS HTTP — usadas pelo Robô MT5
// ─────────────────────────────────────────────

// MT5 envia preço a cada 1 segundo via POST
app.post("/price", (req, res) => {
  const data = req.body;

  if (!data || !data.symbol) {
    return res.status(400).json({ error: "Dados inválidos" });
  }

  // Salva o último preço
  lastPrice   = { ...data, receivedAt: new Date().toISOString() };
  mt5LastSeen = new Date();

  // Repassa preço ao vivo para todos os usuários do site
  broadcastToSite({ type: "price", ...lastPrice });

  // Avisa o site que o MT5 está online
  broadcastToSite({ type: "mt5_status", connected: true });

  res.json({ status: "ok" });
});

// MT5 consulta a cada 1 segundo se há ordem para executar
app.get("/pending-order", (req, res) => {
  mt5LastSeen = new Date();

  if (pendingOrder) {
    const order = pendingOrder;
    pendingOrder = null; // Limpa após entregar
    console.log(`[Railway] Entregando ordem ao MT5: ${order.direction} ${order.symbol}`);
    return res.json({ hasOrder: true, order });
  }

  res.json({ hasOrder: false });
});

// MT5 confirma que executou uma ordem
app.post("/order-executed", (req, res) => {
  const data = req.body;
  console.log(`[Railway] Ordem executada pelo MT5:`, data);

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

  res.json({ status: "ok" });
});

// MT5 reporta erro
app.post("/order-error", (req, res) => {
  broadcastToSite({ type: "mt5_error", message: req.body.message });
  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// WEBSOCKET — usado pelo Site
// ─────────────────────────────────────────────
wss.on("connection", (ws, req) => {
  console.log(`[Railway] Site conectado | Total: ${siteClients.size + 1}`);
  siteClients.add(ws);

  // Envia status atual do MT5 para o site assim que conecta
  const mt5Online = mt5LastSeen && (new Date() - mt5LastSeen) < 5000;
  ws.send(JSON.stringify({ type: "mt5_status", connected: mt5Online }));

  // Envia último preço se já tiver
  if (lastPrice) {
    ws.send(JSON.stringify({ type: "price", ...lastPrice }));
  }

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Site pediu análise
      if (msg.type === "analyze") {
        console.log(`[Railway] Análise pedida: ${msg.symbol} ${msg.timeframe} ${msg.strategy}`);

        ws.send(JSON.stringify({ type: "analyzing", status: "processing" }));

        try {
          const result = await callBase44API({
            symbol:       msg.symbol,
            timeframe:    msg.timeframe,
            strategy:     msg.strategy,
            currentPrice: lastPrice,
          });

          ws.send(JSON.stringify({
            type:        "analysis_result",
            symbol:      msg.symbol,
            timeframe:   msg.timeframe,
            strategy:    msg.strategy,
            direction:   result.direction,
            entry:       result.entry,
            sl:          result.sl,
            tp:          result.tp,
            probability: result.probability,
            score:       result.score,
            reason:      result.reason,
            timestamp:   new Date().toISOString(),
          }));

        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: "Falha na análise. Tente novamente." }));
        }
      }

      // Site pediu para executar ordem
      if (msg.type === "execute_order") {
        const mt5Online = mt5LastSeen && (new Date() - mt5LastSeen) < 5000;

        if (!mt5Online) {
          ws.send(JSON.stringify({
            type:    "error",
            message: "MT5 não está conectado. Verifique o robô.",
          }));
          return;
        }

        // Guarda a ordem para o MT5 buscar no próximo /pending-order
        pendingOrder = {
          symbol:    msg.symbol,
          direction: msg.direction,
          entry:     msg.entry,
          sl:        msg.sl,
          tp:        msg.tp,
          lot_size:  msg.lot_size || 0.01,
        };

        console.log(`[Railway] Ordem enfileirada para MT5: ${msg.direction} ${msg.symbol}`);

        ws.send(JSON.stringify({
          type:    "order_sent",
          message: "Ordem enviada ao MT5. Aguardando confirmação...",
        }));
      }

    } catch (e) {
      console.error("[Railway] Erro ao processar mensagem do site:", e);
    }
  });

  ws.on("close", () => {
    siteClients.delete(ws);
    console.log(`[Railway] Site desconectado | Restam: ${siteClients.size}`);
  });

  ws.on("error", (err) => console.error("[Railway] Erro WebSocket site:", err));
});

// ─────────────────────────────────────────────
// Verifica se MT5 ficou offline (sem ping por 5s)
// ─────────────────────────────────────────────
setInterval(() => {
  if (mt5LastSeen && (new Date() - mt5LastSeen) > 5000) {
    broadcastToSite({ type: "mt5_status", connected: false });
  }
}, 3000);

// ─────────────────────────────────────────────
// Envia para todos os usuários do site
// ─────────────────────────────────────────────
function broadcastToSite(data) {
  const msg = JSON.stringify(data);
  siteClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ─────────────────────────────────────────────
// Chama a API do Base44
// ─────────────────────────────────────────────
async function callBase44API(params) {
  const response = await fetch(BASE44_API_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      action:       "analyze",
      symbol:       params.symbol,
      timeframe:    params.timeframe,
      strategy:     params.strategy,
      price_data:   params.currentPrice,
    }),
  });

  if (!response.ok) throw new Error(`Base44 retornou ${response.status}`);
  return await response.json();
}

// ─────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────
app.get("/health", (_, res) => {
  const mt5Online = mt5LastSeen && (new Date() - mt5LastSeen) < 5000;
  res.json({
    status:        "online",
    mt5_connected: mt5Online,
    last_price:    lastPrice?.bid ?? null,
    last_symbol:   lastPrice?.symbol ?? null,
    site_clients:  siteClients.size,
    pending_order: pendingOrder !== null,
    timestamp:     new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// Inicia
// ─────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor rodando na porta ${PORT}`);
  console.log(`[Railway] MT5  → POST https://aureon-api-production-3d61.up.railway.app/price`);
  console.log(`[Railway] MT5  → GET  https://aureon-api-production-3d61.up.railway.app/pending-order`);
  console.log(`[Railway] Site → WSS  wss://aureon-api-production-3d61.up.railway.app`);
});
