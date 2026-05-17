/**
 * TraderAureonia AI — Servidor Railway v11
 * - Copy Trade para clientes Elite
 * - Webhook Hotmart para ativação automática de planos
 * - Alertas WhatsApp via CallMeBot
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
// Restrições por plano
// ─────────────────────────────────────────────
const PLAN_LIMITS = {
  basic: {
    assets:        ["BTCUSD"],
    strategies:    ["QUICK"],
    maxPositions:  3,
    riskMin:       1.0,
    riskMax:       1.0,
    autoTrade:     false,
    copyTrade:     false,
    martingale:    false,
    whatsapp:      false,
  },
  pro: {
    assets:        ["BTCUSD", "EURUSD", "XAUUSD.s"],
    strategies:    ["QUICK", "MA", "SMC", "PA", "MARTINGALE"],
    maxPositions:  10,
    riskMin:       0.5,
    riskMax:       3.0,
    autoTrade:     true,
    copyTrade:     false,
    martingale:    false,
    whatsapp:      true,
  },
  elite: {
    assets:        "ALL",
    strategies:    ["QUICK", "MA", "SMC", "PA", "MARTINGALE"],
    maxPositions:  20,
    riskMin:       0.1,
    riskMax:       5.0,
    autoTrade:     true,
    copyTrade:     true,
    martingale:    true,
    whatsapp:      true,
  },
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.basic;
}

// ─────────────────────────────────────────────
// Valida plano PRO/Elite via Base44
// ─────────────────────────────────────────────
async function checkProPlan(userId) {
  try {
    const response = await fetch(`${CHECK_SLAVE_URL}?user_id=${userId}`);
    if (!response.ok) return { allowed: true, plan: "basic" };
    const data = await response.json();
    return data;
  } catch (err) {
    return { allowed: true, plan: "basic" };
  }
}

// ─────────────────────────────────────────────
// Salva trade no Supabase
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
// Ativa/atualiza plano do usuário no Supabase
// ─────────────────────────────────────────────
async function activateUserPlan(email, plan, months) {
  try {
    // Busca usuário pelo email
    const searchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,plan`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const users = await searchRes.json();

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + (months || 1));

    if (users && users.length > 0) {
      // Atualiza plano existente
      await fetch(
        `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type":  "application/json",
            "apikey":        SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Prefer":        "return=minimal",
          },
          body: JSON.stringify({ plan, plan_expires_at: expiresAt.toISOString() }),
        }
      );
      console.log(`[Hotmart] Plano ${plan} ativado para ${email} até ${expiresAt.toDateString()}`);
    } else {
      console.log(`[Hotmart] Usuário não encontrado: ${email}`);
    }
  } catch (err) {
    console.error(`[Hotmart] Erro ao ativar plano:`, err.message);
  }
}

// ─────────────────────────────────────────────
// Alerta WhatsApp via CallMeBot
// ─────────────────────────────────────────────
async function sendWhatsAppAlert(phone, message) {
  if (!phone) return;
  try {
    const encoded = encodeURIComponent(message);
    await fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encoded}&apikey=YOUR_CALLMEBOT_KEY`);
    console.log(`[WhatsApp] Alerta enviado para ${phone}`);
  } catch (err) {
    console.error(`[WhatsApp] Erro:`, err.message);
  }
}

// ─────────────────────────────────────────────
// WEBHOOK HOTMART — Ativa plano automaticamente
// ─────────────────────────────────────────────
app.post("/webhook/hotmart", async (req, res) => {
  const event = req.body;
  console.log(`[Hotmart] Webhook recebido: ${event?.event}`);

  // Eventos de compra aprovada ou assinatura ativa
  if (event?.event === "PURCHASE_APPROVED" ||
      event?.event === "PURCHASE_COMPLETE" ||
      event?.event === "SUBSCRIPTION_REACTIVATED") {

    const email    = event?.data?.buyer?.email;
    const product  = event?.data?.product?.name || "";
    const price    = event?.data?.purchase?.price?.value || 0;

    // Define o plano baseado no produto ou preço
    let plan   = "basic";
    let months = 1;

    if (product.toLowerCase().includes("elite") || price >= 390) {
      plan = "elite";
    } else if (product.toLowerCase().includes("pro") || price >= 190) {
      plan = "pro";
    }

    // Se for anual (preço maior)
    if (price >= 900) months = 12;

    if (email) {
      await activateUserPlan(email, plan, months);
      broadcastToSite({ type: "plan_activated", email, plan, months });
    }
  }

  // Cancelamento ou reembolso — volta para basic
  if (event?.event === "PURCHASE_CANCELED" ||
      event?.event === "PURCHASE_REFUNDED" ||
      event?.event === "SUBSCRIPTION_CANCELLATION") {

    const email = event?.data?.buyer?.email;
    if (email) {
      await activateUserPlan(email, "basic", 0);
      console.log(`[Hotmart] Plano cancelado para ${email}`);
    }
  }

  res.json({ status: "ok" });
});

// ─────────────────────────────────────────────
// COPY TRADE — Robô master envia ordem
// Railway replica para todos os slaves Elite
// ─────────────────────────────────────────────
app.post("/master-trade", async (req, res) => {
  const { symbol, direction, risk_percent, sl_percent, tp_percent, strategy, probability } = req.body;

  if (!symbol || !direction)
    return res.status(400).json({ error: "symbol e direction obrigatórios" });

  console.log(`[CopyTrade] Master: ${direction} ${symbol} | Risco: ${risk_percent}%`);

  // Encontra todos os slaves Elite online
  const eliteSlaves = [];
  activeSlaves.forEach((data, userId) => {
    const isOnline = (new Date() - data.lastSeen) / 1000 < SLAVE_TIMEOUT_S;
    if (isOnline && data.plan === "elite") {
      eliteSlaves.push({ userId, ...data });
    }
  });

  console.log(`[CopyTrade] ${eliteSlaves.length} clientes Elite online`);

  // Envia ordem para cada slave Elite
  let copied = 0;
  for (const slave of eliteSlaves) {
    const orderId = generateOrderId();

    // Calcula lote proporcional ao saldo do cliente
    // O slave vai calcular o lote baseado no % de risco
    slavePendingOrders.set(slave.userId, {
      order_id:       orderId,
      direction,
      symbol,
      sl:             0, // Slave calcula baseado no sl_percent
      tp:             0, // Slave calcula baseado no tp_percent
      lot_size:       0, // Slave calcula baseado no risco
      risk_percent:   risk_percent  || 1.0,
      sl_percent:     sl_percent    || 0.5,
      tp_percent:     tp_percent    || 1.0,
      strategy:       strategy      || "COPY",
      probability:    probability   || 0,
      is_copy_trade:  true,
      timestamp:      new Date().toISOString(),
    });

    // Alerta WhatsApp se o slave tiver número cadastrado
    if (slave.whatsapp_phone) {
      await sendWhatsAppAlert(
        slave.whatsapp_phone,
        `🤖 TraderAureonia Copy Trade\n${direction} ${symbol}\nEstratégia: ${strategy}\nProbabilidade: ${probability}%`
      );
    }

    copied++;
  }

  broadcastToSite({
    type:    "copy_trade",
    symbol, direction, strategy, probability,
    clients: copied,
    timestamp: new Date().toISOString(),
  });

  res.json({ status: "ok", clients_copied: copied, elite_online: eliteSlaves.length });
});

// ─────────────────────────────────────────────
// ROTA — Verifica permissões do plano
// ─────────────────────────────────────────────
app.get("/plan-limits/:userId", async (req, res) => {
  const { userId } = req.params;
  const planCheck = await checkProPlan(userId);
  const limits    = getPlanLimits(planCheck.plan || "basic");
  res.json({ user_id: userId, plan: planCheck.plan || "basic", limits });
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
  if (!priceData)
    return res.status(404).json({ error: "Preço não disponível.", symbol, available: Array.from(allPrices.keys()) });
  if (!isPriceFresh(priceData))
    return res.status(503).json({ error: "Preço desatualizado.", symbol });
  res.json({ symbol: priceData.symbol, bid: priceData.bid, ask: priceData.ask, spread: priceData.spread, rsi: priceData.rsi, receivedAt: priceData.receivedAt });
});

app.get("/prices", (req, res) => {
  const prices = [];
  allPrices.forEach((data, symbol) => prices.push({ symbol, bid: data.bid, ask: data.ask, fresh: isPriceFresh(data), receivedAt: data.receivedAt }));
  res.json({ total: prices.length, mt5_connected: isMt5Online(), prices, timestamp: new Date().toISOString() });
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
        : "Plano necessario. Assine em traderaureonia.com.br",
    });
  }

  const limits = getPlanLimits(planCheck.plan || "basic");
  activeSlaves.set(user_id, {
    account: account || "unknown", symbol: symbol || "BTCUSD",
    balance: balance || 0, plan: planCheck.plan || "basic",
    whatsapp_phone: whatsapp_phone || null,
    limits, lastSeen: new Date(),
  });

  console.log(`[Slave] Conectado: ${user_id} | Plano: ${planCheck.plan} | $${balance}`);
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

  const profitVal = parseFloat(profit)         || 0;
  const probVal   = parseFloat(probability)    || 0;
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
    probability: probVal, strategy: strategy || "UNKNOWN",
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

// ─────────────────────────────────────────────
// ROTA — Cliente executa ordem (verifica plano)
// ─────────────────────────────────────────────
app.post("/client-execute-order", async (req, res) => {
  const { user_id, symbol, direction, sl, tp, lot_size, strategy, probability, confirmations, trend_strength } = req.body;
  if (!user_id || !symbol || !direction)
    return res.status(400).json({ error: "user_id, symbol e direction obrigatórios." });

  // Verifica plano
  const planCheck = await checkProPlan(user_id);
  const limits    = getPlanLimits(planCheck.plan || "basic");

  // Verifica se o ativo está liberado para o plano
  if (limits.assets !== "ALL" && !limits.assets.includes(symbol)) {
    return res.status(403).json({
      error: `Ativo ${symbol} não disponível no plano ${planCheck.plan}. Faça upgrade para acessar.`,
      plan: planCheck.plan,
    });
  }

  // Verifica se Auto Trade está liberado
  if (!limits.autoTrade) {
    return res.status(403).json({
      error: "Auto Trade não disponível no plano Básico. Faça upgrade para o plano PRO.",
      plan: planCheck.plan,
    });
  }

  if (!isSlaveOnline(user_id)) {
    const exists      = activeSlaves.has(user_id);
    const lastSeenAgo = exists ? Math.round((new Date() - activeSlaves.get(user_id).lastSeen) / 1000) : null;
    return res.status(503).json({ error: "EA Slave não está conectado.", slave_online: false, last_seen: lastSeenAgo });
  }

  const slVal = parseFloat(sl);
  const tpVal = parseFloat(tp);
  if (!slVal || !tpVal || slVal === 0 || tpVal === 0)
    return res.status(400).json({ error: "SL e TP inválidos. Faça nova análise." });

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

  // Alerta WhatsApp para plano PRO e Elite
  const slave = activeSlaves.get(user_id);
  if (slave?.whatsapp_phone && limits.whatsapp) {
    await sendWhatsAppAlert(
      slave.whatsapp_phone,
      `📊 TraderAureonia Signal\n${direction} ${symbol}\nEstratégia: ${strategy}\nProbabilidade: ${probability}%\nEntrada aprovada!`
    );
  }

  console.log(`[Order] ${user_id}: ${direction} ${symbol} | ${strategy} | Prob:${probability}%`);
  res.json({ status: "ok", message: "Ordem enviada para seu MT5.", order_id: orderId });
});

// ─────────────────────────────────────────────
// ROTA — Trades do usuário
// ─────────────────────────────────────────────
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/slave-status", (req, res) => {
  const userId = req.query.user_id;
  if (!userId) return res.status(400).json({ error: "user_id obrigatório" });
  const exists      = activeSlaves.has(userId);
  const slave       = activeSlaves.get(userId);
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
    const c1 = parseFloat(priceData.close1 || bid);
    const c2 = c1*0.9995, c3 = c1*0.999;
    const h1 = parseFloat(priceData.high1 || c1*1.002);
    const l1 = parseFloat(priceData.low1  || c1*0.998);
    const closes=[],highs=[],lows=[],opens=[];
    for(let i=34;i>=3;i--){const f=1+(Math.random()-0.5)*0.001;closes.push(parseFloat((bid*f).toFixed(5)));highs.push(parseFloat((bid*f*1.001).toFixed(5)));lows.push(parseFloat((bid*f*0.999).toFixed(5)));opens.push(parseFloat((bid*f*0.9995).toFixed(5)));}
    closes.push(c3,c2,c1,bid);highs.push(h1,h1,h1,h1);lows.push(l1,l1,l1,l1);opens.push(c3,c2,c1,bid*0.9998);
    body = { strategy, symbol, closes, highs, lows, opens };
  }
  const response = await fetch(EA_SIGNAL_V3_URL, { method:"POST", headers:{"Content-Type":"application/json","Authorization":`Bearer ${EA_SIGNAL_KEY}`}, body:JSON.stringify(body) });
  if (!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result = await response.json();
  result.live_price  = priceData.bid;
  result.live_symbol = symbol;
  return result;
}

// ─────────────────────────────────────────────
// WebSocket
// ─────────────────────────────────────────────
wss.on("connection", (ws) => {
  siteClients.add(ws);
  ws.send(JSON.stringify({ type: "mt5_status",      connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "slaves_count",    count: activeSlaves.size }));
  ws.send(JSON.stringify({ type: "symbols_available", symbols: Array.from(allPrices.keys()) }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }

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
    } catch (e) { console.error("[WS] Erro:", e); }
  });

  ws.on("close", () => siteClients.delete(ws));
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
  try { await fetch(`${RAILWAY_URL}/health`); console.log(`[Keep-alive] OK`); } catch (e) {}
}, 4 * 60 * 1000);

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
    slaves.push({ user_id: userId, online: ago < SLAVE_TIMEOUT_S, balance: data.balance, plan: data.plan, last_seen_secs: ago });
  });
  const prices = [];
  allPrices.forEach((data, symbol) => prices.push({ symbol, bid: data.bid, fresh: isPriceFresh(data) }));
  res.json({
    status: "online", version: "v11",
    mt5_connected: isMt5Online(),
    symbols_count: allPrices.size, symbols: prices,
    site_clients: siteClients.size,
    slaves_online: slaves.filter(s => s.online).length,
    slaves_total: activeSlaves.size, slaves,
    elite_online: slaves.filter(s => s.online && s.plan === "elite").length,
    timestamp: new Date().toISOString(),
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Railway] Servidor v11 rodando na porta ${PORT}`);
  console.log(`[Railway] Copy Trade, Webhook Hotmart e Limites por plano ativos`);
});
