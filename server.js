/**
 * TraderAureonia AI — Servidor Railway v2
 * 
 * CORREÇÃO PRINCIPAL:
 * Calcula entrada, SL e TP usando o preço ao vivo do MT5
 * em vez de chamar a Base44 API (que retornava preços antigos)
 */

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const { createServer } = require("http");

const app        = express();
const httpServer = createServer(app);
const wss        = new WebSocketServer({ server: httpServer });

app.use(express.json());

const PORT = process.env.PORT || 3001;

// ─────────────────────────────────────────────
// Estado do servidor
// ─────────────────────────────────────────────
const siteClients  = new Set();
let   lastPrice    = null;       // Último preço ao vivo do MT5
let   pendingOrder = null;       // Ordem aguardando execução
let   mt5LastSeen  = null;       // Último ping do MT5

// ─────────────────────────────────────────────
// ROTAS HTTP — usadas pelo Robô MT5
// ─────────────────────────────────────────────

// MT5 envia preço a cada tick via POST
app.post("/price", (req, res) => {
  const data = req.body;
  if (!data || !data.symbol) return res.status(400).json({ error: "Dados inválidos" });

  lastPrice   = { ...data, receivedAt: new Date().toISOString() };
  mt5LastSeen = new Date();

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
// ANÁLISE COM PREÇO AO VIVO
// Calcula direção, entrada, SL e TP usando os
// dados reais enviados pelo MT5
// ─────────────────────────────────────────────
function analyzeWithLivePrice(symbol, timeframe, strategy, priceData) {
  if (!priceData) {
    throw new Error("Sem dados de preço do MT5. Verifique se o robô está rodando.");
  }

  const bid    = parseFloat(priceData.bid);
  const ask    = parseFloat(priceData.ask);
  const rsi    = parseFloat(priceData.rsi    || 50);
  const ema20  = parseFloat(priceData.ema20  || bid);
  const ema50  = parseFloat(priceData.ema50  || bid);
  const close1 = parseFloat(priceData.close1 || bid);
  const close2 = parseFloat(priceData.close2 || bid);
  const close3 = parseFloat(priceData.close3 || bid);
  const high1  = parseFloat(priceData.high1  || bid * 1.001);
  const low1   = parseFloat(priceData.low1   || bid * 0.999);

  // ── ATR estimado (range médio das últimas velas) ──
  const range1    = high1 - low1;
  const atr       = range1 > 0 ? range1 : bid * 0.003;
  const minDist   = bid * 0.004; // mínimo 0.4% do preço
  const slDist    = Math.max(atr * 1.8, minDist);
  const tpDist    = Math.max(atr * 2.5, minDist * 2);

  // ── Detecta direção por estratégia ──
  let direction  = "BUY";
  let score      = 60;
  let reasons    = [];

  // EMA Cross — tendência principal
  const emaBullish = ema20 > ema50;
  const emaBearish = ema20 < ema50;
  if (emaBullish) { score += 10; reasons.push("EMA20 acima da EMA50 (tendência de alta)"); }
  if (emaBearish) { score -= 10; reasons.push("EMA20 abaixo da EMA50 (tendência de baixa)"); }

  // RSI
  if (rsi < 35)      { score += 15; reasons.push(`RSI sobrevendido (${rsi.toFixed(1)})`); }
  else if (rsi > 65) { score -= 15; reasons.push(`RSI sobrecomprado (${rsi.toFixed(1)})`); }
  else if (rsi > 50) { score += 5;  reasons.push(`RSI favorável alta (${rsi.toFixed(1)})`); }
  else               { score -= 5;  reasons.push(`RSI favorável baixa (${rsi.toFixed(1)})`); }

  // Momentum de candles
  const momentum = close1 - close3;
  if (momentum > 0) { score += 8;  reasons.push("Momentum positivo (fechamentos subindo)"); }
  else              { score -= 8;  reasons.push("Momentum negativo (fechamentos caindo)"); }

  // Preço vs EMA20
  if (bid > ema20) { score += 7; reasons.push("Preço acima da EMA20"); }
  else             { score -= 7; reasons.push("Preço abaixo da EMA20"); }

  // Ajuste por estratégia
  if (strategy === "smart_money" || strategy === "SMC") {
    // SMC — prefere contra-tendência em zonas de liquidez
    if (rsi > 70) { score -= 10; reasons.push("Zona de venda institucional"); }
    if (rsi < 30) { score += 10; reasons.push("Zona de compra institucional"); }
  }

  if (strategy === "price_action" || strategy === "PA") {
    // Price Action — foco no momentum
    score += momentum > 0 ? 5 : -5;
  }

  if (strategy === "vwap_vol" || strategy === "VWAP") {
    // VWAP — foco na posição vs médias
    if (bid > ema20 && bid > ema50) score += 8;
    if (bid < ema20 && bid < ema50) score -= 8;
  }

  // Define direção final
  direction = score >= 55 ? "BUY" : "SELL";

  // Normaliza score entre 45 e 92
  const probability = Math.min(0.92, Math.max(0.45, score / 100));
  const finalScore  = Math.round(probability * 100);

  // ── Calcula entrada, SL e TP com preço atual ──
  const entry = direction === "BUY" ? ask : bid;
  const sl    = direction === "BUY" ? entry - slDist : entry + slDist;
  const tp    = direction === "BUY" ? entry + tpDist : entry - tpDist;

  // Arredonda para dígitos do símbolo
  const digits = bid > 1000 ? 2 : bid > 10 ? 3 : 5;
  const round  = (n) => parseFloat(n.toFixed(digits));

  const rr = (tpDist / slDist).toFixed(1);

  return {
    direction,
    entry:       round(entry),
    sl:          round(sl),
    tp:          round(tp),
    probability: parseFloat(probability.toFixed(2)),
    score:       finalScore,
    risk_reward: rr,
    reason:      reasons.slice(0, 3).join(" · "),
    indicators: {
      rsi:    rsi.toFixed(1),
      ema20:  round(ema20),
      ema50:  round(ema50),
      atr:    round(atr),
    },
  };
}

// ─────────────────────────────────────────────
// WEBSOCKET — usado pelo Site
// ─────────────────────────────────────────────
wss.on("connection", (ws, req) => {
  console.log(`[Railway] Site conectado | Total: ${siteClients.size + 1}`);
  siteClients.add(ws);

  const mt5Online = mt5LastSeen && (new Date() - mt5LastSeen) < 5000;
  ws.send(JSON.stringify({ type: "mt5_status", connected: mt5Online }));

  if (lastPrice) {
    ws.send(JSON.stringify({ type: "price", ...lastPrice }));
  }

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // ── Site pediu análise ──
      if (msg.type === "analyze") {
        console.log(`[Railway] Análise: ${msg.symbol} ${msg.timeframe} ${msg.strategy}`);
        ws.send(JSON.stringify({ type: "analyzing", status: "processing" }));

        try {
          // USA O PREÇO AO VIVO DO MT5 para calcular
          const result = analyzeWithLivePrice(
            msg.symbol,
            msg.timeframe,
            msg.strategy,
            lastPrice  // ← preço atual do MT5
          );

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
            risk_reward: result.risk_reward,
            reason:      result.reason,
            indicators:  result.indicators,
            live_price:  lastPrice?.bid,
            timestamp:   new Date().toISOString(),
          }));

        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
      }

      // ── Site pediu para executar ordem ──
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
    status:        "online",
    mt5_connected: mt5Online,
    live_price:    lastPrice?.bid    ?? null,
    live_symbol:   lastPrice?.symbol ?? null,
    live_rsi:      lastPrice?.rsi    ?? null,
    site_clients:  siteClients.size,
    pending_order: pendingOrder !== null,
    timestamp:     new Date().toISOString(),
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v2 rodando na porta ${PORT}`);
});
