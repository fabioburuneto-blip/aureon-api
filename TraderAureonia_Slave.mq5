//+------------------------------------------------------------------+
//| TraderAureonia_Slave.mq5                                         |
//| EA Slave v2 — Opera de forma independente por cliente            |
//+------------------------------------------------------------------+
#property copyright "TraderAureonia AI"
#property version   "2.0"
#property description "EA Slave — Recebe e executa suas ordens do TraderAureonia AI"
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

//+------------------------------------------------------------------+
//| CONFIGURAÇÕES DO USUÁRIO                                         |
//+------------------------------------------------------------------+
input string InpUserId       = "";      // User ID (ex: USER-FABIOBUR)
input double InpLotSize      = 0.01;    // Lote fixo
input bool   InpUseAutoLot   = true;    // Calcular lote automaticamente pelo saldo
input double InpRiskPercent  = 1.0;     // Risco por operação em % do saldo
input bool   InpShowAlerts   = true;    // Mostrar alertas quando ordem chegar
input string InpRailwayUrl   = "https://aureon-api-production-3d61.up.railway.app";

//+------------------------------------------------------------------+
//| VARIÁVEIS GLOBAIS                                                |
//+------------------------------------------------------------------+
string lastOrderId = "";
bool   connected   = false;

//+------------------------------------------------------------------+
//| Inicialização                                                    |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpUserId == "" || StringLen(InpUserId) < 5)
     {
      MessageBox(
         "User ID nao configurado!\n\n"
         "1. Acesse traderaureonia.com.br\n"
         "2. Va em Auto Trader\n"
         "3. Copie seu User ID\n"
         "4. Cole no campo User ID deste EA",
         "TraderAureonia Slave — Configuracao necessaria",
         MB_OK | MB_ICONWARNING
      );
      return INIT_PARAMETERS_INCORRECT;
     }

   trade.SetExpertMagicNumber(88882);
   trade.SetDeviationInPoints(20);

   Print("===========================================");
   Print("[Slave] TraderAureonia AI Slave v2.0");
   Print("[Slave] User ID: ", InpUserId);
   if(InpUseAutoLot)
      Print("[Slave] Modo Lote: AUTO (", InpRiskPercent, "% risco)");
   else
      Print("[Slave] Modo Lote: FIXO (", InpLotSize, ")");
   Print("[Slave] Servidor: ", InpRailwayUrl);
   Print("===========================================");

   RegisterSlave();
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
   string account = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);

   string body = "{";
   body += "\"user_id\":\"" + InpUserId + "\",";
   body += "\"account\":\"" + account + "\",";
   body += "\"symbol\":\"" + _Symbol + "\",";
   body += "\"balance\":" + DoubleToString(balance, 2) + ",";
   body += "\"status\":\"connected\"";
   body += "}";

   string headers = "Content-Type: application/json\r\n";
   uchar  data[], result[];
   int    len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string response_headers;

   int res = WebRequest("POST", InpRailwayUrl + "/slave-register",
                        headers, 5000, data, result, response_headers);

   if(res == 200 || res == 201)
     {
      connected = true;
      Print("[Slave] Conectado! Aguardando ordens do site...");
      if(InpShowAlerts)
         Alert("TraderAureonia Slave conectado! Pronto para receber ordens.");
     }
   else
      Print("[Slave] Erro ao conectar. Codigo: ", res, " — Verifique o User ID.");
  }

//+------------------------------------------------------------------+
//| Desregistra o slave                                             |
//+------------------------------------------------------------------+
void UnregisterSlave()
  {
   string body = "{\"user_id\":\"" + InpUserId + "\",\"status\":\"disconnected\"}";
   string headers = "Content-Type: application/json\r\n";
   uchar  data[], result[];
   int    len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string response_headers;
   WebRequest("POST", InpRailwayUrl + "/slave-register",
              headers, 3000, data, result, response_headers);
  }

//+------------------------------------------------------------------+
//| Verifica se há ordem nova para executar                         |
//+------------------------------------------------------------------+
void CheckForOrders()
  {
   string url = InpRailwayUrl + "/slave-order?user_id=" + InpUserId;
   uchar  post[], result[];
   string headers = "", response_headers;

   int res = WebRequest("GET", url, headers, 3000, post, result, response_headers);

   if(res <= 0)
     {
      if(connected)
        {
         Print("[Slave] Conexao perdida. Reconectando...");
         connected = false;
         RegisterSlave();
        }
      return;
     }

   if(!connected)
     {
      Print("[Slave] Reconectado.");
      connected = true;
     }

   string json = CharArrayToString(result);
   if(StringFind(json, "\"hasOrder\":true") < 0) return;

   // Extrai dados
   string orderId   = ExtractString(json, "\"order_id\":\"");
   string direction = ExtractString(json, "\"direction\":\"");
   string symbol    = ExtractString(json, "\"symbol\":\"");
   double sl        = ExtractDouble(json,  "\"sl\":");
   double tp        = ExtractDouble(json,  "\"tp\":");
   double lotSize   = ExtractDouble(json,  "\"lot_size\":");

   // Evita duplicata
   if(orderId == lastOrderId || orderId == "") return;
   lastOrderId = orderId;

   if(symbol == "") symbol = _Symbol;

   Print("[Slave] Ordem recebida: ", direction, " ", symbol,
         " SL:", sl, " TP:", tp);

   if(InpShowAlerts)
      Alert("TraderAureonia: Ordem ", direction, " ", symbol, " recebida!");

   // Calcula lote
   double lot;
   if(InpUseAutoLot)
      lot = CalculateLot(symbol, sl, direction);
   else
      lot = lotSize > 0 ? lotSize : InpLotSize;

   if(lot <= 0) lot = InpLotSize;

   ExecuteOrder(symbol, direction, sl, tp, lot, orderId);
  }

//+------------------------------------------------------------------+
//| Calcula lote proporcional ao saldo                              |
//+------------------------------------------------------------------+
double CalculateLot(string symbol, double sl, string direction)
  {
   double ask      = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid      = SymbolInfoDouble(symbol, SYMBOL_BID);
   double entry    = (direction == "BUY") ? ask : bid;
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double risk     = balance * (InpRiskPercent / 100.0);
   double slDist   = MathAbs(entry - sl);

   if(slDist <= 0) return InpLotSize;

   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double point     = SymbolInfoDouble(symbol, SYMBOL_POINT);

   if(tickValue == 0 || tickSize == 0) return InpLotSize;

   double slPoints = slDist / point;
   double lot      = risk / (slPoints * (tickValue / tickSize));
   double minLot   = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot   = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double stepLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);

   lot = MathFloor(lot / stepLot) * stepLot;
   lot = MathMax(minLot, MathMin(lot, maxLot));

   Print("[Slave] Lote calculado: ", NormalizeDouble(lot, 2),
         " (Risco: ", InpRiskPercent, "% = $", DoubleToString(risk, 2), ")");

   return NormalizeDouble(lot, 2);
  }

//+------------------------------------------------------------------+
//| Executa a ordem                                                 |
//+------------------------------------------------------------------+
void ExecuteOrder(string symbol, string direction, double sl, double tp,
                  double lot, string orderId)
  {
   double ask    = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid    = SymbolInfoDouble(symbol, SYMBOL_BID);
   int    digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double newSL  = NormalizeDouble(sl, digits);
   double newTP  = NormalizeDouble(tp, digits);
   bool   result = false;

   if(direction == "BUY")
      result = trade.Buy(lot, symbol, ask, newSL, newTP, "TA-" + orderId);
   else if(direction == "SELL")
      result = trade.Sell(lot, symbol, bid, newSL, newTP, "TA-" + orderId);
   else
     {
      Print("[Slave] Direcao invalida: ", direction);
      return;
     }

   if(result)
     {
      double price = trade.ResultPrice();
      Print("[Slave] EXECUTADO! ", direction, " ", symbol,
            " Lot:", lot, " @ ", price, " SL:", newSL, " TP:", newTP);
      ConfirmExecution(orderId, symbol, direction, lot, price, newSL, newTP);
     }
   else
     {
      int    err  = GetLastError();
      string desc = trade.ResultRetcodeDescription();
      Print("[Slave] Erro: ", err, " — ", desc);
      ReportError(orderId, "Erro " + IntegerToString(err) + ": " + desc);
     }
  }

//+------------------------------------------------------------------+
//| Confirma execução para o Railway                               |
//+------------------------------------------------------------------+
void ConfirmExecution(string orderId, string symbol, string direction,
                      double lot, double price, double sl, double tp)
  {
   string p_s  = DoubleToString(price, 5); StringReplace(p_s,  ",", ".");
   string l_s  = DoubleToString(lot,   2); StringReplace(l_s,  ",", ".");
   string sl_s = DoubleToString(sl,    5); StringReplace(sl_s, ",", ".");
   string tp_s = DoubleToString(tp,    5); StringReplace(tp_s, ",", ".");

   string body = "{";
   body += "\"user_id\":\"" + InpUserId + "\",";
   body += "\"order_id\":\"" + orderId + "\",";
   body += "\"symbol\":\"" + symbol + "\",";
   body += "\"direction\":\"" + direction + "\",";
   body += "\"price\":" + p_s + ",";
   body += "\"lot\":" + l_s + ",";
   body += "\"sl\":" + sl_s + ",";
   body += "\"tp\":" + tp_s;
   body += "}";

   string headers = "Content-Type: application/json\r\n";
   uchar  data[], result[];
   int    len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string response_headers;
   WebRequest("POST", InpRailwayUrl + "/slave-confirm",
              headers, 3000, data, result, response_headers);
  }

//+------------------------------------------------------------------+
//| Reporta erro                                                    |
//+------------------------------------------------------------------+
void ReportError(string orderId, string message)
  {
   string body = "{\"user_id\":\"" + InpUserId + "\","
                 "\"order_id\":\"" + orderId + "\","
                 "\"message\":\"" + message + "\"}";
   string headers = "Content-Type: application/json\r\n";
   uchar  data[], result[];
   int    len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
   ArrayResize(data, len);
   string response_headers;
   WebRequest("POST", InpRailwayUrl + "/slave-error",
              headers, 3000, data, result, response_headers);
  }

//+------------------------------------------------------------------+
//| Extrai string de JSON                                           |
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
//| Extrai double de JSON                                           |
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
