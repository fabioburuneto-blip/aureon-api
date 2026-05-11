//+------------------------------------------------------------------+
//| TraderAureonia_Slave.mq5                                         |
//| EA Slave para usuários PRO do TraderAureonia AI                  |
//| Instale no seu MT5 e coloque seu User ID                         |
//+------------------------------------------------------------------+
#property copyright "TraderAureonia AI"
#property version   "1.0"
#property description "EA Slave — Recebe e executa ordens do TraderAureonia AI"
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

// ─────────────────────────────────────────────
// CONFIGURAÇÕES DO USUÁRIO
// ─────────────────────────────────────────────
input string USER_ID       = "";     // << Cole aqui seu ID (ex: USER-4821)
input double LOT_SIZE      = 0.01;   // Tamanho do lote (0.01 = micro lote)
input bool   AUTO_LOT      = true;   // true = calcula lote pelo saldo automaticamente
input double RISK_PERCENT  = 1.0;    // Risco por operação em % do saldo (se AUTO_LOT = true)
input bool   SHOW_ALERTS   = true;   // Mostrar alertas quando ordem chegar

// URL do servidor Railway — não altere
input string RAILWAY_URL   = "https://aureon-api-production-3d61.up.railway.app";

// ─────────────────────────────────────────────
// VARIÁVEIS GLOBAIS
// ─────────────────────────────────────────────
datetime lastOrderCheck  = 0;
string   lastOrderId     = "";  // ID da última ordem recebida (evita duplicatas)
bool     isConnected     = false;

//+------------------------------------------------------------------+
//| Inicialização                                                    |
//+------------------------------------------------------------------+
int OnInit()
  {
   // Valida o User ID
   if(USER_ID == "" || StringLen(USER_ID) < 5)
     {
      MessageBox(
         "User ID não configurado!\n\n"
         "1. Acesse traderaureonia.com.br\n"
         "2. Vá em Configurações → Plano PRO\n"
         "3. Copie seu User ID\n"
         "4. Cole no campo User ID deste EA",
         "TraderAureonia Slave — Configuração",
         MB_OK | MB_ICONWARNING
      );
      return INIT_PARAMETERS_INCORRECT;
     }

   trade.SetExpertMagicNumber(88881);
   trade.SetDeviationInPoints(20);

   Print("===========================================");
   Print("[Slave] TraderAureonia AI Slave v1.0");
   Print("[Slave] User ID: ", USER_ID);
   Print("[Slave] Servidor: ", RAILWAY_URL);
   Print("[Slave] Auto Lot: ", AUTO_LOT ? "SIM" : "NÃO");
   Print("[Slave] Lote fixo: ", LOT_SIZE);
   Print("===========================================");

   // Registra o slave no servidor
   RegisterSlave();

   // Timer a cada 2 segundos
   EventSetMillisecondTimer(2000);

   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
//| Encerramento                                                     |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   UnregisterSlave();
   Print("[Slave] EA encerrado.");
  }

//+------------------------------------------------------------------+
//| Timer — verifica ordens a cada 2 segundos                       |
//+------------------------------------------------------------------+
void OnTimer()
  {
   CheckForOrders();
  }

//+------------------------------------------------------------------+
//| Registra o slave no Railway                                     |
//+------------------------------------------------------------------+
void RegisterSlave()
  {
   string symbol  = _Symbol;
   string account = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);

   string body = "{";
   body += "\"user_id\":\"" + USER_ID + "\",";
   body += "\"account\":\"" + account + "\",";
   body += "\"symbol\":\"" + symbol + "\",";
   body += "\"balance\":" + DoubleToString(balance, 2) + ",";
   body += "\"status\":\"connected\"";
   body += "}";

   string headers = "Content-Type: application/json\r\n";
   uchar data[], result[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string response_headers;
   int res = WebRequest("POST", RAILWAY_URL + "/slave-register", headers, 5000,
                        data, result, response_headers);

   if(res == 200 || res == 201)
     {
      isConnected = true;
      Print("[Slave] ✅ Conectado ao TraderAureonia AI!");
     }
   else
     {
      Print("[Slave] ⚠️ Erro ao conectar. Código: ", res);
      Print("[Slave] Verifique sua conexão e o User ID.");
     }
  }

//+------------------------------------------------------------------+
//| Desregistra o slave                                             |
//+------------------------------------------------------------------+
void UnregisterSlave()
  {
   string body = "{\"user_id\":\"" + USER_ID + "\",\"status\":\"disconnected\"}";
   string headers = "Content-Type: application/json\r\n";
   uchar data[], result[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string response_headers;
   WebRequest("POST", RAILWAY_URL + "/slave-register", headers, 3000,
              data, result, response_headers);
  }

//+------------------------------------------------------------------+
//| Verifica se há ordem nova para executar                         |
//+------------------------------------------------------------------+
void CheckForOrders()
  {
   string url = RAILWAY_URL + "/slave-order?user_id=" + USER_ID;

   uchar post[], result[];
   string headers = "", response_headers;
   int res = WebRequest("GET", url, headers, 3000, post, result, response_headers);

   if(res <= 0)
     {
      if(isConnected)
        {
         Print("[Slave] ⚠️ Conexão perdida com o servidor.");
         isConnected = false;
        }
      return;
     }

   if(!isConnected)
     {
      Print("[Slave] ✅ Reconectado ao servidor.");
      isConnected = true;
     }

   string json = CharArrayToString(result);

   // Sem ordem nova
   if(StringFind(json, "\"hasOrder\":true") < 0) return;

   // Extrai dados da ordem
   string orderId   = ExtractString(json, "\"order_id\":\"");
   string direction = ExtractString(json, "\"direction\":\"");
   string symbol    = ExtractString(json, "\"symbol\":\"");
   double sl        = ExtractDouble(json, "\"sl\":");
   double tp        = ExtractDouble(json, "\"tp\":");
   double masterLot = ExtractDouble(json, "\"lot_size\":");

   // Evita executar a mesma ordem duas vezes
   if(orderId == lastOrderId || orderId == "")
     {
      return;
     }
   lastOrderId = orderId;

   // Usa o símbolo do gráfico se não vier na ordem
   if(symbol == "") symbol = _Symbol;

   Print("[Slave] 📩 Nova ordem recebida!");
   Print("[Slave] Direção: ", direction, " | Símbolo: ", symbol);
   Print("[Slave] SL: ", sl, " | TP: ", tp);

   // Alerta visual/sonoro
   if(SHOW_ALERTS)
      Alert("TraderAureonia: Nova ordem ", direction, " ", symbol, "!");

   // Calcula o lote proporcional ao saldo do usuário
   double lot = CalculateLot(symbol, sl, direction);

   // Executa a ordem
   ExecuteOrder(symbol, direction, sl, tp, lot, orderId);
  }

//+------------------------------------------------------------------+
//| Calcula lote proporcional ao saldo                              |
//+------------------------------------------------------------------+
double CalculateLot(string symbol, double sl, string direction)
  {
   if(!AUTO_LOT) return LOT_SIZE;

   double ask     = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid     = SymbolInfoDouble(symbol, SYMBOL_BID);
   double entry   = (direction == "BUY") ? ask : bid;
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double risk    = balance * (RISK_PERCENT / 100.0);

   double slDist = MathAbs(entry - sl);
   if(slDist <= 0) return LOT_SIZE;

   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double point     = SymbolInfoDouble(symbol, SYMBOL_POINT);

   if(tickValue == 0 || tickSize == 0) return LOT_SIZE;

   double slPoints = slDist / point;
   double lot      = risk / (slPoints * (tickValue / tickSize));
   double minLot   = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot   = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double stepLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   lot = MathFloor(lot / stepLot) * stepLot;
   lot = MathMax(minLot, MathMin(lot, maxLot));

   return NormalizeDouble(lot, 2);
  }

//+------------------------------------------------------------------+
//| Executa a ordem no MT5                                          |
//+------------------------------------------------------------------+
void ExecuteOrder(string symbol, string direction, double sl, double tp,
                  double lot, string orderId)
  {
   double ask    = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(symbol, SYMBOL_BID);
   int    digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double newSL  = NormalizeDouble(sl, digits);
   double newTP  = NormalizeDouble(tp, digits);

   bool result = false;

   if(direction == "BUY")
      result = trade.Buy(lot, symbol, ask, newSL, newTP, "Slave-" + orderId);
   else if(direction == "SELL")
      result = trade.Sell(lot, symbol, bid, newSL, newTP, "Slave-" + orderId);
   else
     {
      Print("[Slave] ❌ Direção inválida: ", direction);
      return;
     }

   if(result)
     {
      double price = trade.ResultPrice();
      Print("[Slave] ✅ Ordem executada! ", direction, " ", symbol,
            " Lot:", lot, " Preço:", price, " SL:", newSL, " TP:", newTP);

      // Confirma execução para o Railway
      ConfirmExecution(orderId, symbol, direction, lot, price);
     }
   else
     {
      int err = GetLastError();
      Print("[Slave] ❌ Erro ao executar ordem: ", err, " — ", trade.ResultRetcodeDescription());

      // Reporta erro para o Railway
      ReportError(orderId, "Erro " + IntegerToString(err) + ": " + trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
//| Confirma execução para o Railway                               |
//+------------------------------------------------------------------+
void ConfirmExecution(string orderId, string symbol, string direction,
                      double lot, double price)
  {
   string price_s = DoubleToString(price, 5); StringReplace(price_s, ",", ".");
   string lot_s   = DoubleToString(lot,   2); StringReplace(lot_s,   ",", ".");

   string body = "{";
   body += "\"user_id\":\"" + USER_ID + "\",";
   body += "\"order_id\":\"" + orderId + "\",";
   body += "\"symbol\":\"" + symbol + "\",";
   body += "\"direction\":\"" + direction + "\",";
   body += "\"price\":" + price_s + ",";
   body += "\"lot\":" + lot_s + ",";
   body += "\"status\":\"executed\"";
   body += "}";

   string headers = "Content-Type: application/json\r\n";
   uchar data[], result[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string response_headers;
   WebRequest("POST", RAILWAY_URL + "/slave-confirm", headers, 3000,
              data, result, response_headers);
  }

//+------------------------------------------------------------------+
//| Reporta erro para o Railway                                    |
//+------------------------------------------------------------------+
void ReportError(string orderId, string message)
  {
   string body = "{\"user_id\":\"" + USER_ID + "\","
                 "\"order_id\":\"" + orderId + "\","
                 "\"message\":\"" + message + "\"}";
   string headers = "Content-Type: application/json\r\n";
   uchar data[], result[];
   int len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string response_headers;
   WebRequest("POST", RAILWAY_URL + "/slave-error", headers, 3000,
              data, result, response_headers);
  }

//+------------------------------------------------------------------+
//| Extrai string de JSON simples                                   |
//+------------------------------------------------------------------+
string ExtractString(string json, string key)
  {
   int start = StringFind(json, key);
   if(start < 0) return "";
   start += StringLen(key);
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
  }

//+------------------------------------------------------------------+
//| Extrai double de JSON simples                                   |
//+------------------------------------------------------------------+
double ExtractDouble(string json, string key)
  {
   int start = StringFind(json, key);
   if(start < 0) return 0.0;
   start += StringLen(key);
   int end = start;
   while(end < StringLen(json) &&
         StringSubstr(json, end, 1) != "," &&
         StringSubstr(json, end, 1) != "}" &&
         StringSubstr(json, end, 1) != "]")
      end++;
   return StringToDouble(StringSubstr(json, start, end - start));
  }
//+------------------------------------------------------------------+
