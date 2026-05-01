/**
 * TraderAureonia AI — Servidor WebSocket
 * Ponte entre MT5 e Site em tempo real
 * Versão: JavaScript puro (Node.js)
 */

const express    = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

app.use(express.json());

const PORT = process.env.PORT || 3001;

// URL da sua API no Base44
const BASE44_API_URL = "https://traderaureonia.base44.app/api/functions/eaSignal_v3";

// ─────────────────────────────────────────────
// Conexões ativas
// ─────────────────────────────────────────────
let mt5Client    = null;        // Robô MT5
const siteClients = new Set();  // Usuários do site
let lastPriceData = null;       // Último preço recebido

// ─────────────────────────────────────────────
// WebSocket — gerencia conexões
// ─────────────────────────────────────────────
wss.on("connection", (ws, req) => {
  const params     = new URL(req.url, "http://localhost").searchParams;
  const clientType = params.get("type");

  console.log(`[Railway] Nova conexão: ${clientType} | ${new Date().toISOString()}`);

  // ── Conexão do Robô MT5 ──
  if (clientType === "mt5") {
    mt5Client = ws;
    console.log("[Railway] ✅ MT5 conectado");

    // Avisa o site que o MT5 está online
    broadcastToSite({ type: "mt5_status", connected: true });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // Preço em tempo real — repassa para o site
        if (msg.type === "price") {
          lastPriceData = msg;
          broadcastToSite(msg);
        }

        // MT5 confirmou que executou a ordem
        if (msg.type === "order_executed") {
          console.log("[Railway] ✅ Ordem executada:", msg);
          broadcastToSite({
            type:      "order_confirmed",
            symbol:    msg.symbol,
            ticket:    msg.ticket,
            direction: msg.direction,
            entry:     msg.entry,
            sl:        msg.sl,
            tp:        msg.tp,
            timestamp: new Date().toISOString(),
          });
        }

        // MT5 reportou erro
        if (msg.type === "error") {
          console.error("[Railway] ❌ Erro do MT5:", msg.message);
          broadcastToSite({ type: "mt5_error", message: msg.message });
        }

      } catch (e) {
        console.error("[Railway] Erro ao parsear mensagem do MT5:", e);
      }
    });

    ws.on("close", () => {
      console.log("[Railway] ⚠️ MT5 desconectado");
      mt5Client = null;
      broadcastToSite({ type: "mt5_status", connected: false });
    });

    ws.on("error", (err) => console.error("[Railway] Erro MT5:", err));
    return;
  }

  // ── Conexão do Site ──
  if (clientType === "site") {
    siteClients.add(ws);
    console.log(`[Railway] ✅ Site conectado | Total: ${siteClients.size}`);

    // Envia status atual assim que o site conecta
    ws.send(JSON.stringify({
      type:      "mt5_status",
      connected: mt5Client !== null && mt5Client.readyState === WebSocket.OPEN,
    }));

    // Envia o último preço imediatamente se já tiver
    if (lastPriceData) {
      ws.send(JSON.stringify(lastPriceData));
    }

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        // ── Site pediu análise ──
        if (msg.type === "analyze") {
          console.log(`[Railway] 📊 Análise: ${msg.symbol} ${msg.timeframe} ${msg.strategy}`);

          ws.send(JSON.stringify({ type: "analyzing", status: "processing" }));

          try {
            const result = await callBase44API({
              symbol:       msg.symbol,
              timeframe:    msg.timeframe,
              strategy:     msg.strategy,
              currentPrice: lastPriceData,
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
            ws.send(JSON.stringify({
              type:    "error",
              message: "Falha ao analisar. Tente novamente.",
            }));
          }
        }

        // ── Site pediu para executar ordem ──
        if (msg.type === "execute_order") {
          if (!mt5Client || mt5Client.readyState !== WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type:    "error",
              message: "MT5 não está conectado. Verifique o robô.",
            }));
            return;
          }

          console.log(`[Railway] 🚀 Enviando ordem ao MT5: ${msg.direction} ${msg.symbol}`);

          mt5Client.send(JSON.stringify({
            type:      "execute_order",
            symbol:    msg.symbol,
            direction: msg.direction,
            entry:     msg.entry,
            sl:        msg.sl,
            tp:        msg.tp,
            lot_size:  msg.lot_size || 0.01,
          }));

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

    ws.on("error", (err) => console.error("[Railway] Erro site:", err));
    return;
  }

  // Conexão sem tipo — fecha
  console.warn("[Railway] Conexão sem tipo. Fechando.");
  ws.close();
});

// ─────────────────────────────────────────────
// Envia mensagem para todos os usuários do site
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
// Chama a API do Base44 para análise técnica
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
// Health check — Railway usa para saber se está vivo
// ─────────────────────────────────────────────
app.get("/health", (_, res) => {
  res.json({
    status:        "online",
    mt5_connected: mt5Client !== null && mt5Client.readyState === WebSocket.OPEN,
    site_clients:  siteClients.size,
    timestamp:     new Date().toISOString(),
  });
});

// ─────────────────────────────────────────────
// Inicia o servidor
// ─────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[Railway] 🚀 Servidor rodando na porta ${PORT}`);
});
