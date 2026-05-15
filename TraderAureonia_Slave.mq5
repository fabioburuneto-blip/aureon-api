//+------------------------------------------------------------------+
//| TraderAureonia_Slave.mq5                                         |
//| EA Slave v5 — Salva estratégia, probabilidade e confirmações    |
//+------------------------------------------------------------------+
#property copyright "TraderAureonia AI"
#property version   "5.0"
#property description "EA Slave — Recebe e executa ordens do TraderAureonia AI"
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

//+------------------------------------------------------------------+
//| CONFIGURAÇÕES DO USUÁRIO                                         |
//+------------------------------------------------------------------+
input string InpUserId       = "";
input double InpLotSize      = 0.01;
input bool   InpUseAutoLot   = true;
input double InpRiskPercent  = 1.0;
input bool   InpShowAlerts   = true;
input string InpRailwayUrl   = "https://aureon-api-production-3d61.up.railway.app";

//+------------------------------------------------------------------+
//| VARIÁVEIS GLOBAIS                                                |
//+------------------------------------------------------------------+
string   lastOrderId    = "";
bool     connected      = false;
bool     isProUser      = false;
datetime lastClosedDeal = 0;

// Dados da ordem atual para salvar ao fechar
string   currentStrategy     = "";
double   currentProbability  = 0;
int      currentConfirmations = 0;
double   currentTrendStrength = 0;
string   currentDirection    = "";
double   currentEntryPrice   = 0;
double   currentSL           = 0;
double   currentTP           = 0;

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
   Print("[Slave] TraderAureonia AI Slave v5.0");
   Print("[Slave] User ID: ", InpUserId);
   if(InpUseAutoLot)
      Print("[Slave] Lote: AUTO (", InpRiskPercent, "% risco)");
   else
      Print("[Slave] Lote: FIXO (", InpLotSize, ")");
   Print("===========================================");

   // Inicializa lastClosedDeal com o último deal do histórico
   HistorySelect(TimeCurrent() - 86400, TimeCurrent());
   int deals = HistoryDealsTotal();
   if(deals > 0)
     {
      ulong ticket = HistoryDealGetTicket(deals - 1);
      lastClosedDeal = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
     }

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
//| Timer                                                            |
//+------------------------------------------------------------------+
void OnTimer()
  {
   if(!connected || !isProUser) return;
   CheckForOrders();
   CheckClosedOrders();
  }

//+------------------------------------------------------------------+
//| Registra o slave                                                |
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

   string json = CharArrayToString(result);

   if(res == 403)
     {
      isProUser = false; connected = false;
      string reason  = ExtractString(json, "\"reason\":\"");
      string message = ExtractString(json, "\"message\":\"");
      Print("[Slave] ACESSO NEGADO: ", message);
      if(StringFind(reason, "expired") >= 0)
         MessageBox("Seu plano PRO expirou!\n\nRenove em traderaureonia.com.br",
                    "TraderAureonia Slave — Plano Expirado", MB_OK | MB_ICONWARNING);
      else
         MessageBox("Plano PRO necessario!\n\nAssine em traderaureonia.com.br",
                    "TraderAureonia Slave — Upgrade Necessario", MB_OK | MB_ICONWARNING);
      return;
     }

   if(res == 200 || res == 201)
     {
      isProUser = true; connected = true;
      Print("[Slave] Conectado com plano PRO! Aguardando ordens...");
      if(InpShowAlerts) Alert("TraderAureonia Slave PRO conectado!");
     }
   else
      Print("[Slave] Erro ao conectar. Codigo: ", res);
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
//| Verifica ordens pendentes                                       |
//+------------------------------------------------------------------+
void CheckForOrders()
  {
   string url = InpRailwayUrl + "/slave-order?user_id=" + InpUserId;
   uchar  post[], result[];
   string headers = "", response_headers;

   int res = WebRequest("GET", url, headers, 3000, post, result, response_headers);

   if(res <= 0)
     {
      if(connected) { Print("[Slave] Conexao perdida. Reconectando..."); connected = false; RegisterSlave(); }
      return;
     }
   if(!connected) { connected = true; Print("[Slave] Reconectado."); }

   string json = CharArrayToString(result);
   if(StringFind(json, "\"hasOrder\":true") < 0) return;

   string orderId   = ExtractString(json, "\"order_id\":\"");
   string direction = ExtractString(json, "\"direction\":\"");
   string symbol    = ExtractString(json, "\"symbol\":\"");
   double sl        = ExtractDouble(json, "\"sl\":");
   double tp        = ExtractDouble(json, "\"tp\":");
   double lotSize   = ExtractDouble(json, "\"lot_size\":");

   // ── Dados da análise para salvar ao fechar ──
   string strategy    = ExtractString(json, "\"strategy\":\"");
   double probability = ExtractDouble(json, "\"probability\":");
   double confirmations = ExtractDouble(json, "\"confirmations\":");
   double trendStr    = ExtractDouble(json, "\"trend_strength\":");

   if(orderId == lastOrderId || orderId == "") return;
   lastOrderId = orderId;
   if(symbol == "") symbol = _Symbol;

   // Guarda dados da ordem atual
   currentStrategy      = strategy;
   currentProbability   = probability;
   currentConfirmations = (int)confirmations;
   currentTrendStrength = trendStr;
   currentDirection     = direction;
   currentSL            = sl;
   currentTP            = tp;

   Print("[Slave] Ordem recebida: ", direction, " ", symbol,
         " SL:", sl, " TP:", tp,
         " Estrategia:", strategy,
         " Prob:", probability, "%");

   if(InpShowAlerts) Alert("TraderAureonia: Ordem ", direction, " ", symbol, " recebida!");

   double lot;
   if(InpUseAutoLot) lot = CalculateLot(symbol, sl, direction);
   else lot = lotSize > 0 ? lotSize : InpLotSize;
   if(lot <= 0) lot = InpLotSize;

   currentEntryPrice = (direction == "BUY")
      ? SymbolInfoDouble(symbol, SYMBOL_ASK)
      : SymbolInfoDouble(symbol, SYMBOL_BID);

   ExecuteOrder(symbol, direction, sl, tp, lot, orderId);
  }

//+------------------------------------------------------------------+
//| Detecta ordens fechadas e salva no Supabase via Railway         |
//+------------------------------------------------------------------+
void CheckClosedOrders()
  {
   HistorySelect(TimeCurrent() - 86400, TimeCurrent());
   int deals = HistoryDealsTotal();

   for(int i = deals - 1; i >= 0; i--)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(!HistoryDealSelect(ticket)) continue;

      datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      if(dealTime <= lastClosedDeal) continue;

      long dealEntry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      if(dealEntry != DEAL_ENTRY_OUT) continue;

      string symbol  = HistoryDealGetString(ticket, DEAL_SYMBOL);
      double profit  = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double price   = HistoryDealGetDouble(ticket, DEAL_PRICE);
      int    dType   = (int)HistoryDealGetInteger(ticket, DEAL_TYPE);
      string dir     = (dType == DEAL_TYPE_BUY) ? "buy" : "sell";

      if(symbol == "") continue;

      Print("[Slave] Trade fechado: ", symbol, " Profit:", profit,
            " Estrategia:", currentStrategy,
            " Prob:", currentProbability, "%");

      // Envia para o Railway com todos os dados
      string p_s    = DoubleToString(price,  5); StringReplace(p_s,  ",", ".");
      string pr_s   = DoubleToString(profit, 2); StringReplace(pr_s, ",", ".");
      string prob_s = DoubleToString(currentProbability, 1); StringReplace(prob_s, ",", ".");
      string ts_s   = DoubleToString(currentTrendStrength, 1); StringReplace(ts_s, ",", ".");
      string sl_s   = DoubleToString(currentSL, 5); StringReplace(sl_s, ",", ".");
      string tp_s   = DoubleToString(currentTP, 5); StringReplace(tp_s, ",", ".");

      string body = "{";
      body += "\"user_id\":\"" + InpUserId + "\",";
      body += "\"symbol\":\"" + symbol + "\",";
      body += "\"direction\":\"" + dir + "\",";
      body += "\"close_price\":" + p_s + ",";
      body += "\"profit\":" + pr_s + ",";
      body += "\"result\":\"" + (profit > 0 ? "win" : "loss") + "\",";
      body += "\"strategy\":\"" + currentStrategy + "\",";
      body += "\"probability\":" + prob_s + ",";
      body += "\"confirmations\":" + IntegerToString(currentConfirmations) + ",";
      body += "\"trend_strength\":" + ts_s + ",";
      body += "\"sl\":" + sl_s + ",";
      body += "\"tp\":" + tp_s;
      body += "}";

      string headers = "Content-Type: application/json\r\n";
      uchar  data[], res[];
      int    len = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8) - 1;
      ArrayResize(data, len);
      string rh;
      int result_code = WebRequest("POST", InpRailwayUrl + "/slave-trade-closed",
                                   headers, 3000, data, res, rh);

      if(result_code == 200 || result_code == 201)
         Print("[Slave] Trade salvo com sucesso! Estrategia:", currentStrategy);
      else
         Print("[Slave] Erro ao salvar trade. Codigo: ", result_code);

      lastClosedDeal = dealTime;
     }
  }

//+------------------------------------------------------------------+
//| Calcula lote                                                    |
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
   return NormalizeDouble(MathMax(minLot, MathMin(lot, maxLot)), 2);
  }

//+------------------------------------------------------------------+
//| Executa ordem                                                   |
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
   else { Print("[Slave] Direcao invalida: ", direction); return; }

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
//| Confirma execução                                               |
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
//| Helpers JSON                                                    |
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
