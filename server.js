/**
 * TraderAureonia AI — Servidor Railway v16
 * - WhatsApp Bot via Baileys
 * - Usa JID original sem normalização
 * - Anti-duplicata no Live Room
 * - Sala ao vivo 24h
 * - Live Learning com Supabase
 * - Copy Trade Elite
 * - Webhook Hotmart
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
app.get("/download/slave", (_, res) => { res.download(path.join(__dirname, "TraderAureonia_Slave.mq5")); });
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

let waSocket       = null;
let waConnected    = false;
let waQRCode       = null;
let waQRCodeBase64 = null;
const waSubscribers          = new Map(); // jid → { plan, email, active }
const waPendingRegistrations = new Map(); // jid → { step }

const STRATEGIES = {
  SMC_PRO:   { label: "SMC Pro",        plan: "basic" },
  PA:        { label: "Price Action",    plan: "basic" },
  WYCKOFF:   { label: "Wyckoff",         plan: "pro"   },
  SD:        { label: "Supply & Demand", plan: "pro"   },
  FIBONACCI: { label: "Fibonacci",       plan: "pro"   },
  AI:        { label: "IA (Todas)",      plan: "elite" },
};

const siteClients        = new Set();
const allPrices          = new Map();
let   mt5LastSeen        = null;
const activeSlaves       = new Map();
const slavePendingOrders = new Map();
const slaveExecutions    = [];
let   orderCounter       = 1;

const liveRoomClients      = new Set();
const liveSignalHistory    = [];
let   liveRoomInterval     = null;
let   focusInterval        = null;
const clientFocusAsset     = new Map();
const clientStrategies     = new Map();
const clientModes          = new Map();
const pendingNotifications = [];
const analysisCache        = new Map(); // anti-duplicata

const historicalCache = new Map();
let   lastCacheUpdate = 0;
const CACHE_TTL_MS    = 5 * 60 * 1000;

const LIVE_ASSETS = ["BTCUSD", "XAUUSD.s", "EURUSD", "GBPUSD", "ETHUSD"];
const DEFAULT_STRATEGIES = {
  BTCUSD: "SMC_PRO", "XAUUSD.s": "SMC_PRO",
  EURUSD: "PA", GBPUSD: "SD", ETHUSD: "FIBONACCI",
};

const liveScoreboard = { signals: 0, wins: 0, losses: 0, profit: 0, date: new Date().toDateString() };

const PLAN_LIMITS = {
  basic: { assets: ["BTCUSD"], strategies: ["SMC_PRO","PA"], modes: ["express"], maxPositions: 3, autoTrade: false, copyTrade: false, liveRoom: true, whatsapp: true },
  pro:   { assets: ["BTCUSD","EURUSD","XAUUSD.s"], strategies: ["SMC_PRO","PA","WYCKOFF","SD","FIBONACCI"], modes: ["express","complete"], maxPositions: 10, autoTrade: true, copyTrade: false, liveRoom: true, whatsapp: true },
  elite: { assets: "ALL", strategies: ["SMC_PRO","PA","WYCKOFF","SD","FIBONACCI","AI"], modes: ["express","complete"], maxPositions: 20, autoTrade: true, copyTrade: true, liveRoom: true, whatsapp: true },
};
function getPlanLimits(plan) { return PLAN_LIMITS[plan] || PLAN_LIMITS.basic; }

function isMt5Online() { return mt5LastSeen && (new Date() - mt5LastSeen) < MT5_TIMEOUT_MS; }
function generateOrderId() { return `ORD-${Date.now()}-${orderCounter++}`; }
function isSlaveOnline(userId) {
  if (!activeSlaves.has(userId)) return false;
  return (new Date() - activeSlaves.get(userId).lastSeen) / 1000 < SLAVE_TIMEOUT_S;
}
function isPriceFresh(priceData) {
  if (!priceData) return false;
  return (new Date() - new Date(priceData.receivedAt)) / 1000 < PRICE_EXPIRE_S;
}
function getStrategyForAsset(symbol) {
  const votes = {};
  clientStrategies.forEach((s) => { const st = s[symbol]; if (st) votes[st] = (votes[st] || 0) + 1; });
  if (Object.keys(votes).length === 0) return DEFAULT_STRATEGIES[symbol] || "SMC_PRO";
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}
function getMostFocusedAsset() {
  const votes = {};
  clientFocusAsset.forEach((symbol) => { if (symbol) votes[symbol] = (votes[symbol] || 0) + 1; });
  if (Object.keys(votes).length === 0) return null;
  return Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0];
}
function getMostUsedMode() {
  let express = 0, complete = 0;
  clientModes.forEach(m => m === "complete" ? complete++ : express++);
  return complete > express ? "complete" : "express";
}

async function supabaseGet(p) {
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }); return await r.json(); } catch { return []; }
}
async function supabasePost(p, body) {
  try { const r = await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=representation" }, body: JSON.stringify(body) }); return await r.json(); } catch { return null; }
}
async function supabasePatch(p, body) {
  try { await fetch(`${SUPABASE_URL}/rest/v1/${p}`, { method: "PATCH", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" }, body: JSON.stringify(body) }); } catch {}
}

// ─────────────────────────────────────────────
// WHATSAPP — Envia mensagem usando JID original
// ─────────────────────────────────────────────
async function sendWAMessage(jid, message) {
  if (!waConnected || !waSocket) {
    console.log("[WhatsApp] Não conectado — não enviou para", jid);
    return false;
  }
  try {
    // Usa o JID exatamente como veio do Baileys — não modifica nada
    await waSocket.sendMessage(jid, { text: message });
    console.log("[WhatsApp] ✅ Enviado para:", jid);
    return true;
  } catch (err) {
    console.error(`[WhatsApp] ❌ Erro ao enviar para ${jid}:`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// WHATSAPP — Bot de respostas
// Usa jid como chave principal (não phone)
// ─────────────────────────────────────────────
async function handleWhatsAppMessage(jid, text) {
  console.log(`[WhatsApp] Processando mensagem de ${jid}: "${text}"`);
  const pending = waPendingRegistrations.get(jid);

  if (text === "parar" || text === "stop" || text === "cancelar") {
    if (waSubscribers.has(jid)) {
      const sub = waSubscribers.get(jid);
      waSubscribers.delete(jid);
      if (sub.phone) await supabasePatch(`wa_subscribers?phone=eq.${sub.phone}`, { active: false });
      await sendWAMessage(jid, "✅ Você foi removido da lista de sinais.\n\nPara receber novamente envie *OI*.");
    } else {
      await sendWAMessage(jid, "Você não estava cadastrado na lista de sinais.");
    }
    waPendingRegistrations.delete(jid);
    return;
  }

  if (text === "status" || text === "plano") {
    const sub = waSubscribers.get(jid);
    if (sub) {
      const planLabel = sub.plan === "elite" ? "🏆 Elite" : sub.plan === "pro" ? "⭐ PRO" : "📊 Básico";
      const limits    = getPlanLimits(sub.plan);
      const assets    = limits.assets === "ALL" ? "Todos os ativos" : limits.assets.join(", ");
      await sendWAMessage(jid, `📊 *Seu Status TraderAureonia AI*\n\nPlano: ${planLabel}\nAtivos: ${assets}\n\nPara parar envie *PARAR*\nAcesse: traderaureonia.com.br`);
    } else {
      await sendWAMessage(jid, `Você não está cadastrado.\n\nEnvie *OI* para se cadastrar.`);
    }
    return;
  }

  if (text === "ajuda" || text === "help" || text === "menu") {
    await sendWAMessage(jid, `🤖 *TraderAureonia AI — Comandos*\n\n*OI* — Cadastrar\n*STATUS* — Ver plano\n*PARAR* — Parar sinais\n*AJUDA* — Ver menu\n\n🌐 traderaureonia.com.br`);
    return;
  }

  if (pending && pending.step === "waiting_email") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(text)) {
      await sendWAMessage(jid, "❌ Email inválido. Envie um email válido.\n\nEx: seuemail@gmail.com");
      return;
    }
    const users = await supabaseGet(`users?email=eq.${encodeURIComponent(text)}&select=id,email,plan`);
    let plan = "basic";
    if (users && users.length > 0) plan = users[0].plan || "basic";
    const planLabel = plan === "elite" ? "🏆 Elite" : plan === "pro" ? "⭐ PRO" : "📊 Básico";
    const limits    = getPlanLimits(plan);
    const assets    = limits.assets === "ALL" ? "Todos os ativos" : limits.assets.join(", ");
    // Salva o jid como identificador (não o phone deformado)
    const phone = jid.replace("@s.whatsapp.net", "");
    await supabasePost("wa_subscribers", { phone, email: text, plan, active: true, created_at: new Date().toISOString() });
    waSubscribers.set(jid, { plan, email: text, active: true, phone });
    waPendingRegistrations.delete(jid);
    await sendWAMessage(jid,
      `✅ *Cadastro realizado!*\n\n📧 Email: ${text}\n📊 Plano: ${planLabel}\n📈 Ativos: ${assets}\n\nVocê receberá sinais automaticamente!\n\nFormato:\n🟢 SINAL BUY BTCUSD\nEntrada: 78.250 | SL: 77.900 | TP1: 78.800\nProb: 84%\n\nPara parar envie *PARAR*\n🌐 traderaureonia.com.br`
    );
    console.log(`[WhatsApp] ✅ Novo subscriber: ${jid} | Plano: ${plan}`);
    return;
  }

  if (["oi","olá","ola","hello","hi","início","inicio"].includes(text)) {
    if (waSubscribers.has(jid)) {
      const sub       = waSubscribers.get(jid);
      const planLabel = sub.plan === "elite" ? "🏆 Elite" : sub.plan === "pro" ? "⭐ PRO" : "📊 Básico";
      await sendWAMessage(jid, `👋 Você já está cadastrado!\nPlano: ${planLabel}\n\nEnvie *STATUS* para ver detalhes.\nEnvie *PARAR* para cancelar.`);
      return;
    }
    waPendingRegistrations.set(jid, { step: "waiting_email" });
    await sendWAMessage(jid,
      `👋 *Bem-vindo à TraderAureonia AI!*\n\n🤖 Receba sinais de trading com IA no WhatsApp!\n\n📊 Estratégias:\n• SMC Pro | Price Action\n• Wyckoff | Supply & Demand\n• Fibonacci | IA (todas)\n\nPara começar, envie o *email* que você usa em traderaureonia.com.br:\n\n_(Não tem conta? Crie em traderaureonia.com.br)_`
    );
    return;
  }

  await sendWAMessage(jid, `🤖 Não entendi. Envie *AJUDA* para ver os comandos.`);
}

// ─────────────────────────────────────────────
// WHATSAPP — Inicializa Baileys
// ─────────────────────────────────────────────
async function startWhatsApp() {
  try {
    console.log("[WhatsApp] Iniciando...");
    let baileys;
    try { baileys = require("@whiskeysockets/baileys"); console.log("[WhatsApp] Baileys carregado via require"); }
    catch(e) { baileys = await import("@whiskeysockets/baileys"); console.log("[WhatsApp] Baileys carregado via import"); }

    console.log("[WhatsApp] Keys:", Object.keys(baileys).slice(0,10).join(", "));
    const makeWASocket              = baileys.makeWASocket || baileys.default?.makeWASocket || (typeof baileys.default === "function" ? baileys.default : null);
    const useMultiFileAuthState     = baileys.useMultiFileAuthState     || baileys.default?.useMultiFileAuthState;
    const DisconnectReason          = baileys.DisconnectReason          || baileys.default?.DisconnectReason;
    const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;

    console.log("[WhatsApp] makeWASocket:", typeof makeWASocket);
    if (typeof makeWASocket !== "function") { setTimeout(startWhatsApp, 30000); return; }

    let pino; try { pino = require("pino"); } catch { pino = () => ({ level: "silent", child: () => ({}) }); }
    const { state, saveCreds } = await useMultiFileAuthState("./wa_auth");

    let version = [2, 3000, 1015901307];
    try { const v = await fetchLatestBaileysVersion(); version = v.version; console.log("[WhatsApp] Versão:", version.join(".")); } catch { console.log("[WhatsApp] Versão padrão"); }

    waSocket = makeWASocket({
      version, auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: true,
      browser: ["TraderAureonia AI", "Chrome", "1.0.0"],
    });
    console.log("[WhatsApp] Socket criado!");

    waSocket.ev.on("creds.update", saveCreds);

    waSocket.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      console.log("[WhatsApp] connection.update:", connection || "sem connection", qr ? "QR disponível" : "");
      if (qr) {
        waQRCode = qr;
        try {
          const QRCode = require("qrcode");
          QRCode.toDataURL(qr, (err, url) => {
            if (!err) { waQRCodeBase64 = url; broadcastToSite({ type: "wa_qr", qr: url }); console.log("[WhatsApp] ✅ QR Code gerado"); }
          });
        } catch { broadcastToSite({ type: "wa_qr_text", qr }); }
      }
      if (connection === "open") {
        waConnected = true; waQRCode = null; waQRCodeBase64 = null;
        console.log("[WhatsApp] ✅ CONECTADO!");
        broadcastToSite({ type: "wa_connected", connected: true });
        loadWaSubscribers();
      }
      if (connection === "close") {
        waConnected = false;
        broadcastToSite({ type: "wa_connected", connected: false });
        const statusCode      = (lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason?.loggedOut;
        console.log(`[WhatsApp] Fechado. StatusCode: ${statusCode} | Reconectar: ${shouldReconnect}`);
        if (shouldReconnect) setTimeout(startWhatsApp, 5000);
        else console.log("[WhatsApp] Deslogado permanentemente");
      }
    });

    // ── RECEBE MENSAGENS — usa JID original do Baileys ──
    waSocket.ev.on("messages.upsert", async ({ messages, type }) => {
      console.log("[WhatsApp] messages.upsert! type:", type, "qtd:", messages.length);
      for (const msg of messages) {
        const jid = msg.key.remoteJid;
        console.log("[WhatsApp] msg from:", jid, "fromMe:", msg.key.fromMe);
        if (!msg.message || msg.key.fromMe) continue;
        if (jid.includes("@g.us")) continue; // ignora grupos

        // Log de diagnóstico
        console.log("[WhatsApp] Tipos de conteúdo:", JSON.stringify(Object.keys(msg.message)));

        // Extrai texto de todos os tipos possíveis
        const text = (
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.imageMessage?.caption ||
          msg.message.videoMessage?.caption ||
          msg.message.buttonsResponseMessage?.selectedDisplayText ||
          msg.message.listResponseMessage?.title ||
          ""
        ).trim().toLowerCase();

        console.log("[WhatsApp] Texto:", text, "| JID:", jid);

        if (!text) continue;

        // Usa o JID original do Baileys — sem modificar nada
        await handleWhatsAppMessage(jid, text);
      }
    });

  } catch (err) {
    console.error("[WhatsApp] ERRO:", err.message);
    setTimeout(startWhatsApp, 10000);
  }
}

async function loadWaSubscribers() {
  try {
    const data = await supabaseGet("wa_subscribers?active=eq.true&select=phone,plan,email,name");
    if (data && Array.isArray(data)) {
      data.forEach(s => {
        // Reconstrói JID aproximado — será atualizado quando o usuário mandar mensagem
        const jid = `${s.phone}@s.whatsapp.net`;
        waSubscribers.set(jid, { plan: s.plan, email: s.email, name: s.name, active: true, phone: s.phone });
      });
      console.log(`[WhatsApp] ${data.length} subscribers carregados`);
    }
  } catch {}
}

async function sendSignalToSubscribers(signal) {
  if (!waConnected || waSubscribers.size === 0) return;
  const { asset, direction, strategy, probability, entry, sl, tp1, tp2, tp3, mode } = signal;
  const stratLabel = STRATEGIES[strategy]?.label || strategy;
  const emoji      = direction === "BUY" ? "🟢" : "🔴";
  const modeLabel  = mode === "complete" ? "📊 Completo" : "⚡ Express";
  let sent = 0;
  for (const [jid, sub] of waSubscribers.entries()) {
    if (!sub.active) continue;
    const limits = getPlanLimits(sub.plan);
    if (limits.assets !== "ALL" && !limits.assets.includes(asset)) continue;
    if (!limits.strategies.includes(strategy)) continue;
    const message =
      `${emoji} *SINAL ${direction} — ${asset}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 ${stratLabel} | ${modeLabel}\n` +
      `🎯 Probabilidade: ${probability}%\n\n` +
      `💵 Entrada: *${entry}*\n` +
      `🛑 Stop Loss: ${sl}\n` +
      `✅ TP1: ${tp1}${tp2 ? `\n✅ TP2: ${tp2}` : ""}${tp3 ? `\n✅ TP3: ${tp3}` : ""}\n\n` +
      `⏰ ${new Date().toLocaleTimeString("pt-BR")}\n` +
      `🌐 traderaureonia.com.br`;
    await sendWAMessage(jid, message);
    await new Promise(r => setTimeout(r, 500));
    sent++;
  }
  if (sent > 0) console.log(`[WhatsApp] Sinal enviado para ${sent} subscribers`);
}

app.get("/whatsapp/qr", (req, res) => {
  if (waConnected) return res.send(`<html><body style="background:#0a0a0a;color:#00ff00;font-family:monospace;text-align:center;padding:50px"><h1>✅ WhatsApp Conectado!</h1><p>Subscribers: ${waSubscribers.size}</p></body></html>`);
  if (waQRCodeBase64) return res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;text-align:center;padding:50px"><h1>📱 Escanear QR Code</h1><p>WhatsApp → Menu → Aparelhos conectados → Conectar aparelho</p><img src="${waQRCodeBase64}" style="width:300px;height:300px;border:3px solid #00ff00;border-radius:12px"/><script>setTimeout(()=>location.reload(),10000)</script></body></html>`);
  res.send(`<html><body style="background:#0a0a0a;color:#fff;font-family:monospace;text-align:center;padding:50px"><h1>⏳ Aguardando QR Code...</h1><p>Aguarde alguns segundos.</p><script>setTimeout(()=>location.reload(),3000)</script></body></html>`);
});

app.get("/whatsapp/reset", async (req, res) => {
  try {
    const fs = require("fs");
    if (fs.existsSync("./wa_auth")) fs.rmSync("./wa_auth", { recursive: true, force: true });
    waConnected = false; waQRCode = null; waQRCodeBase64 = null; waSocket = null;
    console.log("[WhatsApp] Auth resetado!");
    setTimeout(startWhatsApp, 2000);
    res.send(`<html><body style="background:#0a0a0a;color:#00ff00;font-family:monospace;text-align:center;padding:50px"><h1>✅ Auth resetado!</h1><p>Aguarde 5 segundos</p><script>setTimeout(()=>location.href='/whatsapp/qr',5000)</script></body></html>`);
  } catch(err) { res.send("Erro: " + err.message); }
});

app.get("/whatsapp/status", (req, res) => { res.json({ connected: waConnected, subscribers: waSubscribers.size, has_qr: !!waQRCode, timestamp: new Date().toISOString() }); });
app.get("/whatsapp/subscribers", (req, res) => {
  const list = [];
  waSubscribers.forEach((data, jid) => list.push({ jid, plan: data.plan, email: data.email, active: data.active }));
  res.json({ total: list.length, subscribers: list });
});

async function fetchHistoricalStats(asset, strategy) {
  const key = `${asset}-${strategy}`; const now = Date.now();
  if (historicalCache.has(key) && (now - lastCacheUpdate) < CACHE_TTL_MS) return historicalCache.get(key);
  try {
    const data = await supabaseGet(`live_signals?asset=eq.${encodeURIComponent(asset)}&strategy=eq.${strategy}&result=neq.open&select=result,profit,hour_of_day&order=created_at.desc&limit=200`);
    if (!data || data.length === 0) { const e = { win_rate: -1, sample_size: 0, hour_stats: {} }; historicalCache.set(key, e); return e; }
    const wins = data.filter(d => d.result === "win").length;
    const hg = {};
    data.forEach(d => { const h = d.hour_of_day; if (h == null) return; if (!hg[h]) hg[h] = { wins: 0, total: 0 }; hg[h].total++; if (d.result === "win") hg[h].wins++; });
    const hour_stats = {};
    Object.entries(hg).forEach(([h, s]) => { hour_stats[h] = { win_rate: s.wins / s.total, count: s.total }; });
    const result = { win_rate: wins / data.length, sample_size: data.length, hour_stats };
    historicalCache.set(key, result); lastCacheUpdate = now; return result;
  } catch { return { win_rate: -1, sample_size: 0, hour_stats: {} }; }
}

async function saveLiveSignal(signal) {
  const now = new Date();
  const data = { asset: signal.asset, strategy: signal.strategy, direction: signal.direction, entry_price: signal.entry, sl: signal.sl, tp1: signal.tp1, tp2: signal.tp2 || null, tp3: signal.tp3 || null, probability: signal.probability, confirmations: signal.confirmations || 0, rsi: signal.indicators?.rsi || null, ema9: signal.indicators?.ema9 || null, ema21: signal.indicators?.ema21 || null, atr: signal.indicators?.atr || null, trend_strength: signal.trend_strength || null, is_range: signal.is_range || false, hour_of_day: now.getUTCHours(), day_of_week: now.getUTCDay(), result: "open" };
  try { const saved = await supabasePost("live_signals", data); if (saved && saved[0]) signal.supabase_id = saved[0].id; } catch {}
}

async function updateLiveSignalResult(id, result, profit, closePrice, tpHit) {
  if (!id) return;
  await supabasePatch(`live_signals?id=eq.${id}`, { result, profit: parseFloat(profit) || 0, close_price: closePrice || null, tp_hit: tpHit || 0, closed_at: new Date().toISOString() });
  lastCacheUpdate = 0;
}

async function checkProPlan(userId) {
  try { const r = await fetch(`${CHECK_SLAVE_URL}?user_id=${userId}`); if (!r.ok) return { allowed: true, plan: "basic" }; return await r.json(); } catch { return { allowed: true, plan: "basic" }; }
}

async function saveTradeToSupabase(tradeData) {
  try { await fetch(`${SUPABASE_URL}/rest/v1/trades`, { method: "POST", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" }, body: JSON.stringify(tradeData) }); } catch {}
}

async function activateUserPlan(email, plan, months) {
  try {
    const sr = await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}&select=id,email,plan`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });
    const users = await sr.json();
    const exp = new Date(); exp.setMonth(exp.getMonth() + (months || 1));
    if (users && users.length > 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "return=minimal" }, body: JSON.stringify({ plan, plan_expires_at: exp.toISOString() }) });
      waSubscribers.forEach((sub, jid) => {
        if (sub.email === email) {
          sub.plan = plan; waSubscribers.set(jid, sub);
          if (sub.phone) supabasePatch(`wa_subscribers?phone=eq.${sub.phone}`, { plan });
          sendWAMessage(jid, `🎉 Plano atualizado para *${plan.toUpperCase()}*!\nVocê receberá sinais de mais ativos.`);
        }
      });
    }
  } catch {}
}

function broadcastToSite(data) { const msg = JSON.stringify(data); siteClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); }); }
function broadcastToLiveRoom(data) { const msg = JSON.stringify(data); liveRoomClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); }); }
function notifyAllClients(signal) {
  const n = JSON.stringify({ type: "live_signal_notification", asset: signal.asset, direction: signal.direction, strategy: signal.strategy, strategy_label: STRATEGIES[signal.strategy]?.label || signal.strategy, probability: signal.probability, mode: signal.mode || "express", entry: signal.entry, sl: signal.sl, tp1: signal.tp1, hora: signal.hora, message: `🔴 ${signal.direction} em ${signal.asset} — ${signal.probability}%`, timestamp: new Date().toISOString() });
  siteClients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(n); });
  pendingNotifications.unshift({ ...signal, notified_at: new Date().toISOString() });
  if (pendingNotifications.length > 5) pendingNotifications.pop();
}
function checkScoreboardReset() {
  const today = new Date().toDateString();
  if (liveScoreboard.date !== today) { liveScoreboard.signals = 0; liveScoreboard.wins = 0; liveScoreboard.losses = 0; liveScoreboard.profit = 0; liveScoreboard.date = today; pendingNotifications.length = 0; }
}

async function callEaSignalV3(strategy, symbol, historicalData = null, mode = "express") {
  const priceData = allPrices.get(symbol);
  if (!priceData) throw new Error(`Sem dados para ${symbol}.`);
  let closes, highs, lows, opens;
  if (priceData.closes && Array.isArray(priceData.closes) && priceData.closes.length >= 30) { closes = priceData.closes; highs = priceData.highs || []; lows = priceData.lows || []; opens = priceData.opens || []; }
  else {
    const bid = parseFloat(priceData.bid); const c1 = parseFloat(priceData.close1 || bid), c2 = c1*0.9995, c3 = c1*0.999; const h1 = parseFloat(priceData.high1 || c1*1.002), l1 = parseFloat(priceData.low1 || c1*0.998);
    closes = []; highs = []; lows = []; opens = [];
    for(let i=54;i>=3;i--){const f=1+(Math.random()-0.5)*0.001;closes.push(parseFloat((bid*f).toFixed(5)));highs.push(parseFloat((bid*f*1.001).toFixed(5)));lows.push(parseFloat((bid*f*0.999).toFixed(5)));opens.push(parseFloat((bid*f*0.9995).toFixed(5)));}
    closes.push(c3,c2,c1,bid);highs.push(h1,h1,h1,h1);lows.push(l1,l1,l1,l1);opens.push(c3,c2,c1,bid*0.9998);
  }
  const body = { strategy, symbol, mode, closes, highs, lows, opens, historical_win_rate: historicalData?.win_rate ?? -1, historical_sample_size: historicalData?.sample_size ?? 0, hour_win_rate: historicalData?.hour_win_rate ?? -1, hour_sample_size: historicalData?.hour_sample_size ?? 0 };
  const response = await fetch(EA_SIGNAL_V3_URL, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${EA_SIGNAL_KEY}` }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`eaSignal_v3 retornou ${response.status}`);
  const result = await response.json(); result.live_price = priceData.bid; result.live_symbol = symbol; return result;
}

async function analyzeLiveAsset(symbol, isPriority = false) {
  const priceData = allPrices.get(symbol);
  if (!priceData || !isPriceFresh(priceData)) return;

  const strategy = getStrategyForAsset(symbol);

  // Anti-duplicata — 1x por minuto (exceto foco)
  if (!isPriority) {
    const cacheKey = `${symbol}-${strategy}`;
    const lastTime = analysisCache.get(cacheKey) || 0;
    if (Date.now() - lastTime < 60000) return;
    analysisCache.set(cacheKey, Date.now());
  }

  const mode = getMostUsedMode();
  const hour = new Date().getUTCHours();
  const stats = await fetchHistoricalStats(symbol, strategy);
  const hourStats = stats.hour_stats?.[hour] || {};
  const historicalData = { win_rate: stats.win_rate, sample_size: stats.sample_size, hour_win_rate: hourStats.win_rate ?? -1, hour_sample_size: hourStats.count ?? 0 };
  const stratLabel = STRATEGIES[strategy]?.label || strategy;

  if (liveRoomClients.size > 0) {
    broadcastToLiveRoom({ type: "thinking", asset: symbol, strategy, strategy_label: stratLabel, mode, price: priceData.bid, is_priority: isPriority, message: `${isPriority ? "🎯" : "🧠"} ${isPriority ? "Análise prioritária" : "Monitorando"} ${symbol} — ${stratLabel} [${mode.toUpperCase()}]`, timestamp: new Date().toISOString() });
    await new Promise(r => setTimeout(r, 1200));
  }

  try {
    const result = await callEaSignalV3(strategy, symbol, historicalData, mode);
    if (liveRoomClients.size > 0 && result.indicators) {
      const { rsi } = result.indicators;
      if (rsi > 65) { broadcastToLiveRoom({ type: "alert", asset: symbol, level: "warning", rsi, message: `⚠ RSI em ${rsi} — sobrecompra`, timestamp: new Date().toISOString() }); await new Promise(r => setTimeout(r, 500)); }
      else if (rsi < 35) { broadcastToLiveRoom({ type: "alert", asset: symbol, level: "warning", rsi, message: `⚠ RSI em ${rsi} — sobrevenda`, timestamp: new Date().toISOString() }); await new Promise(r => setTimeout(r, 500)); }
      if (result.htf_bias && result.htf_bias !== "NEUTRAL") { broadcastToLiveRoom({ type: "alert", asset: symbol, level: "info", message: `📈 HTF: ${result.htf_bias === "BULL" ? "ALTISTA 🟢" : "BAIXISTA 🔴"}`, timestamp: new Date().toISOString() }); await new Promise(r => setTimeout(r, 400)); }
      if (result.analysis?.liquidity_sweeps?.bull?.detected) { broadcastToLiveRoom({ type: "alert", asset: symbol, level: "warning", message: `⚡ LIQUIDEZ CAPTURADA em ${result.analysis.liquidity_sweeps.bull.level}!`, timestamp: new Date().toISOString() }); await new Promise(r => setTimeout(r, 500)); }
      if (result.analysis?.liquidity_sweeps?.bear?.detected) { broadcastToLiveRoom({ type: "alert", asset: symbol, level: "warning", message: `⚡ LIQUIDEZ CAPTURADA em ${result.analysis.liquidity_sweeps.bear.level}!`, timestamp: new Date().toISOString() }); await new Promise(r => setTimeout(r, 500)); }
    }
    if (result.status === "new_signal" && result.direction) {
      liveScoreboard.signals++;
      const signal = { type: "signal", asset: symbol, strategy, strategy_label: stratLabel, mode, direction: result.direction, entry: result.entry, sl: result.sl, tp: result.tp, tp1: result.tp1, tp2: result.tp2 || null, tp3: result.tp3 || null, tp1_label: result.tp1_label, tp2_label: result.tp2_label, tp3_label: result.tp3_label, probability: result.probability, reason: result.reason, confirmations: result.confirmations, indicators: result.indicators, trend_strength: result.trend_strength, is_range: result.is_range, htf_bias: result.htf_bias, vwap: result.vwap, volume_profile: result.volume_profile, market_structure: result.market_structure, analysis: result.analysis, probability_adjustment: result.probability_adjustment, historical: stats.sample_size > 0 ? { win_rate: stats.win_rate, sample_size: stats.sample_size } : null, id: `LIVE-${Date.now()}`, hora: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), timestamp: new Date().toISOString() };
      liveSignalHistory.unshift(signal); if (liveSignalHistory.length > 50) liveSignalHistory.pop();
      await saveLiveSignal(signal);
      if (liveRoomClients.size > 0) broadcastToLiveRoom(signal);
      notifyAllClients(signal);
      await sendSignalToSubscribers(signal);
      console.log(`[LiveRoom] 🟢 ${result.direction} ${symbol} | ${stratLabel} [${mode}] | Prob: ${result.probability}% | WA: ${waSubscribers.size}`);
    } else {
      if (liveRoomClients.size > 0) broadcastToLiveRoom({ type: "no_signal", asset: symbol, strategy, strategy_label: stratLabel, mode, reason: result.reason || "Aguardando setup ideal", is_range: result.is_range || false, indicators: result.indicators, htf_bias: result.htf_bias, timestamp: new Date().toISOString() });
    }
  } catch (err) { console.error(`[LiveRoom] Erro ${symbol}:`, err.message); }
}

async function runLiveRoom() {
  checkScoreboardReset();
  if (liveRoomClients.size > 0) broadcastToLiveRoom({ type: "scoreboard", signals: liveScoreboard.signals, wins: liveScoreboard.wins, losses: liveScoreboard.losses, profit: liveScoreboard.profit, win_rate: liveScoreboard.signals > 0 ? ((liveScoreboard.wins / liveScoreboard.signals) * 100).toFixed(1) : "0.0", timestamp: new Date().toISOString() });
  const focusedAsset = getMostFocusedAsset();
  for (const symbol of LIVE_ASSETS) {
    if (symbol === focusedAsset) continue;
    if (allPrices.get(symbol) && isPriceFresh(allPrices.get(symbol))) { await analyzeLiveAsset(symbol, false); if (liveRoomClients.size > 0) await new Promise(r => setTimeout(r, 1500)); }
  }
}
async function runFocusedAsset() { const f = getMostFocusedAsset(); if (!f) return; const pd = allPrices.get(f); if (pd && isPriceFresh(pd)) await analyzeLiveAsset(f, true); }
function startLiveRoom24h() { if (!liveRoomInterval) { liveRoomInterval = setInterval(runLiveRoom, 30000); console.log("[LiveRoom] Loop 30s iniciado"); } if (!focusInterval) { focusInterval = setInterval(runFocusedAsset, 10000); console.log("[LiveRoom] Loop 10s iniciado"); } }

app.post("/webhook/hotmart", async (req, res) => {
  const event = req.body;
  if (["PURCHASE_APPROVED","PURCHASE_COMPLETE","SUBSCRIPTION_REACTIVATED"].includes(event?.event)) { const email = event?.data?.buyer?.email; const product = event?.data?.product?.name || ""; const price = event?.data?.purchase?.price?.value || 0; let plan = "basic", months = 1; if (product.toLowerCase().includes("elite") || price >= 390) plan = "elite"; else if (product.toLowerCase().includes("pro") || price >= 190) plan = "pro"; if (price >= 900) months = 12; if (email) { await activateUserPlan(email, plan, months); broadcastToSite({ type: "plan_activated", email, plan }); } }
  if (["PURCHASE_CANCELED","PURCHASE_REFUNDED","SUBSCRIPTION_CANCELLATION"].includes(event?.event)) { const email = event?.data?.buyer?.email; if (email) await activateUserPlan(email, "basic", 0); }
  res.json({ status: "ok" });
});

app.post("/master-trade", async (req, res) => {
  const { symbol, direction, risk_percent, sl_percent, tp_percent, strategy, probability } = req.body;
  if (!symbol || !direction) return res.status(400).json({ error: "symbol e direction obrigatórios" });
  const eliteSlaves = []; activeSlaves.forEach((data, userId) => { if ((new Date() - data.lastSeen) / 1000 < SLAVE_TIMEOUT_S && data.plan === "elite") eliteSlaves.push({ userId, ...data }); });
  let copied = 0; for (const slave of eliteSlaves) { slavePendingOrders.set(slave.userId, { order_id: generateOrderId(), direction, symbol, sl: 0, tp: 0, lot_size: 0, risk_percent: risk_percent || 1.0, sl_percent: sl_percent || 0.5, tp_percent: tp_percent || 1.0, strategy: strategy || "COPY", probability: probability || 0, is_copy_trade: true, timestamp: new Date().toISOString() }); copied++; }
  broadcastToSite({ type: "copy_trade", symbol, direction, strategy, probability, clients: copied, timestamp: new Date().toISOString() });
  res.json({ status: "ok", clients_copied: copied });
});

app.post("/price", (req, res) => {
  const data = req.body; if (!data || !data.symbol) return res.status(400).json({ error: "Dados inválidos" });
  mt5LastSeen = new Date();
  const priceData = { symbol: data.symbol, bid: data.bid, ask: data.ask, spread: data.spread, rsi: data.rsi, ema20: data.ema20, ema50: data.ema50, close1: data.close1, high1: data.high1, low1: data.low1, closes: data.closes || null, highs: data.highs || null, lows: data.lows || null, opens: data.opens || null, strategy: data.strategy || "SMC_PRO", receivedAt: new Date().toISOString() };
  allPrices.set(data.symbol, priceData); broadcastToSite({ type: "price", ...priceData }); broadcastToSite({ type: "mt5_status", connected: true });
  res.json({ status: "ok", symbols_tracked: allPrices.size });
});

app.get("/prices", (req, res) => { const prices = []; allPrices.forEach((data, symbol) => prices.push({ symbol, bid: data.bid, ask: data.ask, fresh: isPriceFresh(data) })); res.json({ total: prices.length, mt5_connected: isMt5Online(), prices, timestamp: new Date().toISOString() }); });
app.get("/strategies", (req, res) => { res.json({ strategies: STRATEGIES, timestamp: new Date().toISOString() }); });
app.get("/live-signals", (req, res) => { res.json({ active: true, clients: liveRoomClients.size, signals: liveSignalHistory.slice(0, 20), scoreboard: liveScoreboard, assets: LIVE_ASSETS, focused_asset: getMostFocusedAsset(), pending_notifications: pendingNotifications.slice(0, 5), wa_connected: waConnected, wa_subscribers: waSubscribers.size, timestamp: new Date().toISOString() }); });

app.post("/live-signal-result", async (req, res) => {
  const { signal_id, result, profit, close_price, tp_hit } = req.body;
  const signal = liveSignalHistory.find(s => s.id === signal_id);
  if (signal) { signal.result = result; signal.profit = profit; if (signal.supabase_id) await updateLiveSignalResult(signal.supabase_id, result, profit, close_price, tp_hit); }
  const profitVal = parseFloat(profit) || 0;
  if (result === "win") { liveScoreboard.wins++; liveScoreboard.profit += profitVal; } else if (result === "loss") { liveScoreboard.losses++; liveScoreboard.profit += profitVal; }
  broadcastToLiveRoom({ type: "signal_result", signal_id, result, profit: profitVal, scoreboard: liveScoreboard, timestamp: new Date().toISOString() });
  res.json({ status: "ok" });
});

app.get("/live-learning", async (req, res) => {
  try {
    const data = await supabaseGet("live_signals?result=neq.open&select=asset,strategy,result,profit,hour_of_day,probability,rsi,atr&order=created_at.desc&limit=500");
    if (!data || data.length === 0) return res.json({ status: "no_data", message: "Ainda sem dados suficientes.", assets: {} });
    const groups = {};
    data.forEach(d => { const key = `${d.asset}-${d.strategy}`; if (!groups[key]) groups[key] = { asset: d.asset, strategy: d.strategy, wins: 0, losses: 0, total: 0, profit: 0, hours: {} }; const g = groups[key]; g.total++; g.profit += d.profit || 0; if (d.result === "win") g.wins++; else g.losses++; const h = d.hour_of_day; if (h !== null) { if (!g.hours[h]) g.hours[h] = { wins: 0, total: 0 }; g.hours[h].total++; if (d.result === "win") g.hours[h].wins++; } });
    const assets = {};
    Object.values(groups).forEach((g) => { if (!assets[g.asset]) assets[g.asset] = {}; assets[g.asset][g.strategy] = { strategy_label: STRATEGIES[g.strategy]?.label || g.strategy, total_signals: g.total, wins: g.wins, losses: g.losses, win_rate: parseFloat((g.wins/g.total).toFixed(3)), win_rate_pct: `${(g.wins/g.total*100).toFixed(1)}%`, total_profit: parseFloat(g.profit.toFixed(2)), recommendation: g.total >= 20 ? g.wins/g.total >= 0.6 ? "✅ Performando bem" : g.wins/g.total >= 0.45 ? "⚠ Moderado" : "❌ Ajustando filtros" : "📊 Coletando dados..." }; });
    res.json({ status: "ok", total_signals_analyzed: data.length, assets, last_updated: new Date().toISOString() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/slave-register", async (req, res) => {
  const { user_id, account, symbol, balance, status, whatsapp_phone } = req.body;
  if (!user_id) return res.status(400).json({ error: "user_id obrigatório" });
  if (status === "disconnected") { activeSlaves.delete(user_id); broadcastToSite({ type: "slave_status", user_id, connected: false }); return res.json({ status: "ok" }); }
  const planCheck = await checkProPlan(user_id); if (!planCheck.allowed) return res.status(403).json({ status: "blocked", message: "Plano necessário." });
  const limits = getPlanLimits(planCheck.plan || "basic");
  activeSlaves.set(user_id, { account: account || "unknown", symbol: symbol || "BTCUSD", balance: balance || 0, plan: planCheck.plan || "basic", whatsapp_phone: whatsapp_phone || null, limits, lastSeen: new Date() });
  broadcastToSite({ type: "slave_status", user_id, connected: true, balance, plan: planCheck.plan });
  res.json({ status: "ok", user_id, plan: planCheck.plan, limits });
});

app.get("/slave-order", (req, res) => {
  const userId = req.query.user_id; if (!userId) return res.status(400).json({ error: "user_id obrigatório" });
  if (activeSlaves.has(userId)) { const s = activeSlaves.get(userId); s.lastSeen = new Date(); activeSlaves.set(userId, s); } else activeSlaves.set(userId, { account: "unknown", symbol: "BTCUSD", balance: 0, plan: "basic", lastSeen: new Date() });
  if (slavePendingOrders.has(userId)) { const order = slavePendingOrders.get(userId); slavePendingOrders.delete(userId); return res.json({ hasOrder: true, ...order }); }
  res.json({ hasOrder: false });
});

app.post("/slave-confirm", (req, res) => { const { user_id, order_id, symbol, direction, price, lot, sl, tp } = req.body; slaveExecutions.push({ user_id, order_id, symbol, direction, price, lot, sl, tp, timestamp: new Date().toISOString() }); broadcastToSite({ type: "order_confirmed", user_id, order_id, direction, symbol, price, lot, sl, tp, timestamp: new Date().toISOString() }); res.json({ status: "ok" }); });

app.post("/slave-trade-closed", async (req, res) => {
  const { user_id, symbol, direction, close_price, profit, result, strategy, probability, confirmations, trend_strength, sl, tp } = req.body;
  if (!user_id || !symbol) return res.status(400).json({ error: "user_id e symbol obrigatórios" });
  const profitVal = parseFloat(profit) || 0; const resultStr = profitVal > 0 ? "win" : "loss";
  broadcastToSite({ type: "trade_closed", user_id, symbol, direction, profit: profitVal, result: resultStr, strategy, timestamp: new Date().toISOString() });
  const now = new Date();
  await saveTradeToSupabase({ user_code: user_id, symbol, direction: direction || "buy", entry_price: parseFloat(close_price) || 0, sl: parseFloat(sl) || 0, tp: parseFloat(tp) || 0, profit: profitVal, result: resultStr, hour_of_day: now.getUTCHours(), day_of_week: now.getUTCDay(), market_strength: 0, atr_value: 0, probability: parseFloat(probability) || 0, strategy: strategy || "UNKNOWN", confirmations: parseInt(confirmations) || 0, trend_strength: parseFloat(trend_strength) || 0 });
  res.json({ status: "ok" });
});

app.post("/slave-error", (req, res) => { broadcastToSite({ type: "slave_error", ...req.body }); res.json({ status: "ok" }); });

app.post("/client-execute-order", async (req, res) => {
  const { user_id, symbol, direction, sl, tp, lot_size, strategy, probability, confirmations, trend_strength, mode } = req.body;
  if (!user_id || !symbol || !direction) return res.status(400).json({ error: "user_id, symbol e direction obrigatórios." });
  const planCheck = await checkProPlan(user_id); const limits = getPlanLimits(planCheck.plan || "basic");
  if (limits.assets !== "ALL" && !limits.assets.includes(symbol)) return res.status(403).json({ error: `Ativo ${symbol} não disponível no plano ${planCheck.plan}.` });
  if (!limits.autoTrade) return res.status(403).json({ error: "Auto Trade não disponível no plano Básico." });
  if (!isSlaveOnline(user_id)) return res.status(503).json({ error: "EA Slave não está conectado.", slave_online: false });
  const slVal = parseFloat(sl), tpVal = parseFloat(tp); if (!slVal || !tpVal) return res.status(400).json({ error: "SL e TP inválidos." });
  const orderId = generateOrderId();
  slavePendingOrders.set(user_id, { order_id: orderId, direction, symbol, sl: slVal, tp: tpVal, lot_size: parseFloat(lot_size) || 0.01, strategy: strategy || "SMC_PRO", probability: parseFloat(probability) || 0, confirmations: parseInt(confirmations) || 0, trend_strength: parseFloat(trend_strength) || 0, timestamp: new Date().toISOString() });
  res.json({ status: "ok", message: "Ordem enviada.", order_id: orderId });
});

app.get("/slave-status", (req, res) => { const userId = req.query.user_id; if (!userId) return res.status(400).json({ error: "user_id obrigatório" }); const exists = activeSlaves.has(userId); const slave = activeSlaves.get(userId); const ago = exists ? Math.round((new Date() - slave.lastSeen) / 1000) : null; res.json({ user_id: userId, slave_online: exists && ago < SLAVE_TIMEOUT_S, last_seen: ago, balance: slave?.balance ?? null, plan: slave?.plan ?? null }); });

app.get("/user-trades", async (req, res) => { const userCode = req.query.user_code; if (!userCode) return res.status(400).json({ error: "user_code obrigatório" }); try { const response = await fetch(`${SUPABASE_URL}/rest/v1/trades?user_code=eq.${userCode}&order=created_at.desc&limit=500`, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }); res.json({ user_code: userCode, trades: await response.json() }); } catch (err) { res.status(500).json({ error: err.message }); } });

app.get("/plan-limits/:userId", async (req, res) => { const planCheck = await checkProPlan(req.params.userId); res.json({ user_id: req.params.userId, plan: planCheck.plan || "basic", limits: getPlanLimits(planCheck.plan || "basic") }); });

wss.on("connection", (ws) => {
  siteClients.add(ws);
  ws.send(JSON.stringify({ type: "mt5_status", connected: isMt5Online() }));
  ws.send(JSON.stringify({ type: "wa_connected", connected: waConnected, subscribers: waSubscribers.size }));
  ws.send(JSON.stringify({ type: "symbols_available", symbols: Array.from(allPrices.keys()) }));
  ws.send(JSON.stringify({ type: "strategies_available", strategies: STRATEGIES }));
  if (pendingNotifications.length > 0) ws.send(JSON.stringify({ type: "pending_notifications", notifications: pendingNotifications, timestamp: new Date().toISOString() }));

  ws.on("message", async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
      if (msg.type === "analyze") {
        const strategy = msg.strategy || "SMC_PRO"; const symbol = msg.symbol || "BTCUSD"; const mode = msg.mode || "express";
        ws.send(JSON.stringify({ type: "analyzing", status: "processing", strategy, mode }));
        try {
          const stats = await fetchHistoricalStats(symbol, strategy); const hour = new Date().getUTCHours(); const hourStats = stats.hour_stats?.[hour] || {};
          const result = await callEaSignalV3(strategy, symbol, { win_rate: stats.win_rate, sample_size: stats.sample_size, hour_win_rate: hourStats.win_rate ?? -1, hour_sample_size: hourStats.count ?? 0 }, mode);
          ws.send(JSON.stringify({ type: "analysis_result", symbol, strategy, mode, strategy_label: STRATEGIES[strategy]?.label || strategy, direction: result.direction, entry: result.entry, sl: result.sl, tp: result.tp, tp1: result.tp1, tp2: result.tp2, tp3: result.tp3, tp_levels: result.tp_levels, tp1_label: result.tp1_label, tp2_label: result.tp2_label, tp3_label: result.tp3_label, probability: result.probability, score: result.probability, reason: result.reason, indicators: result.indicators, live_price: result.live_price, status: result.status, confirmations: result.confirmations, trend_strength: result.trend_strength, is_range: result.is_range, htf_bias: result.htf_bias, vwap: result.vwap, volume_profile: result.volume_profile, market_structure: result.market_structure, analysis: result.analysis, probability_adjustment: result.probability_adjustment, timestamp: new Date().toISOString() }));
        } catch (err) { ws.send(JSON.stringify({ type: "error", message: err.message })); }
      }
      if (msg.type === "get_price") { const symbol = msg.symbol?.toUpperCase(); const pd = symbol ? allPrices.get(symbol) : null; if (pd && isPriceFresh(pd)) ws.send(JSON.stringify({ type: "price", ...pd })); else ws.send(JSON.stringify({ type: "price_unavailable", symbol })); }
      if (msg.type === "join_live_room") { liveRoomClients.add(ws); clientFocusAsset.set(ws, null); clientStrategies.set(ws, { ...DEFAULT_STRATEGIES }); clientModes.set(ws, msg.mode || "express"); ws.send(JSON.stringify({ type: "live_room_joined", history: liveSignalHistory.slice(0, 10), scoreboard: liveScoreboard, assets: LIVE_ASSETS, strategies: DEFAULT_STRATEGIES, strategies_info: STRATEGIES, message: "Bem-vindo! A IA monitora 24h.", timestamp: new Date().toISOString() })); broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size }); }
      if (msg.type === "leave_live_room") { liveRoomClients.delete(ws); clientFocusAsset.delete(ws); clientStrategies.delete(ws); clientModes.delete(ws); broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size }); }
      if (msg.type === "set_mode") { clientModes.set(ws, msg.mode === "complete" ? "complete" : "express"); ws.send(JSON.stringify({ type: "mode_updated", mode: msg.mode, timestamp: new Date().toISOString() })); }
      if (msg.type === "focus_asset") { const symbol = msg.asset?.toUpperCase(); if (symbol) { clientFocusAsset.set(ws, symbol); const pd = allPrices.get(symbol); if (pd && isPriceFresh(pd)) await analyzeLiveAsset(symbol, true); } }
      if (msg.type === "set_live_strategy") { const { asset, strategy } = msg; if (asset && strategy) { const strategies = clientStrategies.get(ws) || { ...DEFAULT_STRATEGIES }; strategies[asset] = strategy; clientStrategies.set(ws, strategies); const pd = allPrices.get(asset); if (pd && isPriceFresh(pd)) await analyzeLiveAsset(asset, true); ws.send(JSON.stringify({ type: "strategy_updated", asset, strategy, strategy_label: STRATEGIES[strategy]?.label || strategy, timestamp: new Date().toISOString() })); } }
    } catch (e) { console.error("[WS] Erro:", e); }
  });
  ws.on("close", () => { siteClients.delete(ws); liveRoomClients.delete(ws); clientFocusAsset.delete(ws); clientStrategies.delete(ws); clientModes.delete(ws); broadcastToLiveRoom({ type: "live_viewers", count: liveRoomClients.size }); });
});

setInterval(() => { activeSlaves.forEach((data, userId) => { if ((new Date() - data.lastSeen) / 1000 > SLAVE_REMOVE_S) { activeSlaves.delete(userId); broadcastToSite({ type: "slave_status", user_id: userId, connected: false }); } }); if (mt5LastSeen && (new Date() - mt5LastSeen) > MT5_TIMEOUT_MS) broadcastToSite({ type: "mt5_status", connected: false }); }, 5000);
setInterval(async () => { try { await fetch(`${RAILWAY_URL}/health`); } catch {} }, 4 * 60 * 1000);

app.get("/health", (_, res) => {
  const slaves = []; activeSlaves.forEach((data, userId) => { const ago = Math.round((new Date() - data.lastSeen) / 1000); slaves.push({ user_id: userId, online: ago < SLAVE_TIMEOUT_S, balance: data.balance, plan: data.plan, last_seen_secs: ago }); });
  const prices = []; allPrices.forEach((data, symbol) => prices.push({ symbol, bid: data.bid, fresh: isPriceFresh(data) }));
  res.json({ status: "online", version: "v16", mt5_connected: isMt5Online(), symbols_count: allPrices.size, symbols: prices, site_clients: siteClients.size, slaves_online: slaves.filter(s => s.online).length, slaves_total: activeSlaves.size, slaves, elite_online: slaves.filter(s => s.online && s.plan === "elite").length, live_room_active: true, live_room_clients: liveRoomClients.size, live_signals_today: liveScoreboard.signals, focused_asset: getMostFocusedAsset(), current_mode: getMostUsedMode(), learning_cache_size: historicalCache.size, whatsapp_connected: waConnected, whatsapp_subscribers: waSubscribers.size, strategies: Object.keys(STRATEGIES), timestamp: new Date().toISOString() });
});

httpServer.listen(PORT, async () => {
  console.log(`[Railway] v16 rodando na porta ${PORT}`);
  console.log(`[Railway] Estratégias: ${Object.keys(STRATEGIES).join(", ")}`);
  startLiveRoom24h();
  setTimeout(startWhatsApp, 3000);
});
