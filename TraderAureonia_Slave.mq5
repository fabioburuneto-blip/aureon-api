//+------------------------------------------------------------------+
//| TraderAureonia_Slave.mq5                                         |
//| EA Slave v5.1 — SymbolSelect para todos os ativos               |
//+------------------------------------------------------------------+
#property copyright "TraderAureonia AI"
#property version   "5.2"
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

input string InpUserId        = "";
input string InpWhatsappPhone = "";
input string InpRailwayUrl    = "https://aureon-api-production-3d61.up.railway.app";
input bool   InpShowAlerts    = true;

string   lastOrderId     = "";
bool     connected       = false;
bool     isProUser       = false;
datetime lastClosedDeal  = 0;
string   currentPlan     = "basic";

string   currentStrategy      = "";
double   currentProbability   = 0;
int      currentConfirmations = 0;
double   currentTrendStr      = 0;
double   currentSL            = 0;
double   currentTP            = 0;
bool     isCopyTrade          = false;
string   currentSymbol        = "";
string   currentSource        = "";

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpUserId == "" || StringLen(InpUserId) < 5)
     {
      MessageBox("User ID não configurado!\n\nAcesse traderaureonia.com.br → Auto Trader → copie seu User ID",
                 "TraderAureonia Slave", MB_OK|MB_ICONWARNING);
      return INIT_PARAMETERS_INCORRECT;
     }
   trade.SetExpertMagicNumber(88882);
   trade.SetDeviationInPoints(20);
   HistorySelect(TimeCurrent()-86400, TimeCurrent());
   int deals = HistoryDealsTotal();
   if(deals > 0)
     { ulong t = HistoryDealGetTicket(deals-1); lastClosedDeal = (datetime)HistoryDealGetInteger(t,DEAL_TIME); }
   RegisterSlave();
   EventSetMillisecondTimer(2000);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   UnregisterSlave();
  }

void OnTimer()
  {
   if(!connected || !isProUser) return;
   CheckForOrders();
   CheckClosedOrders();
  }

//+------------------------------------------------------------------+
void RegisterSlave()
  {
   string body = "{";
   body += "\"user_id\":\"" + InpUserId + "\",";
   body += "\"account\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   body += "\"symbol\":\"" + _Symbol + "\",";
   body += "\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2) + ",";
   body += "\"whatsapp_phone\":\"" + InpWhatsappPhone + "\",";
   body += "\"status\":\"connected\"";
   body += "}";

   string headers = "Content-Type: application/json\r\n";
   uchar  data[], result[]; string rh;
   int    len = StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8)-1;
   ArrayResize(data,len);
   int res = WebRequest("POST", InpRailwayUrl+"/slave-register", headers, 5000, data, result, rh);
   string json = CharArrayToString(result);

   if(res == 403)
     {
      isProUser = false; connected = false;
      string msg = ExtractString(json,"\"message\":\"");
      MessageBox(msg, "TraderAureonia — Acesso Negado", MB_OK|MB_ICONWARNING);
      return;
     }
   if(res == 200 || res == 201)
     {
      isProUser = true; connected = true;
      currentPlan = ExtractString(json,"\"plan\":\"");
      Print("[Slave v5.2] Conectado! Plano: ", currentPlan);
      if(InpShowAlerts) Alert("TraderAureonia Slave v5.1 conectado — Plano: ", currentPlan);
     }
  }

void UnregisterSlave()
  {
   string body = "{\"user_id\":\""+InpUserId+"\",\"status\":\"disconnected\"}";
   string headers = "Content-Type: application/json\r\n";
   uchar data[],result[]; int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8)-1;
   ArrayResize(data,len); string rh;
   WebRequest("POST",InpRailwayUrl+"/slave-register",headers,3000,data,result,rh);
  }

//+------------------------------------------------------------------+
bool PrepareSymbol(string symbol)
  {
   // ── CORREÇÃO PRINCIPAL ──
   // Garante que o símbolo está disponível no Market Watch
   // e com dados suficientes para operar

   if(symbol == "") { Print("[Slave] Símbolo vazio!"); return false; }

   // Adiciona ao Market Watch se não estiver
   if(!SymbolSelect(symbol, true))
     {
      Print("[Slave] ❌ Não foi possível selecionar: ", symbol);
      return false;
     }

   // Aguarda dados do símbolo ficarem disponíveis
   int attempts = 0;
   while(SymbolInfoDouble(symbol, SYMBOL_BID) == 0 && attempts < 10)
     {
      Sleep(500);
      attempts++;
     }

   if(SymbolInfoDouble(symbol, SYMBOL_BID) == 0)
     {
      Print("[Slave] ❌ Sem dados de preço para: ", symbol, " (mercado fechado?)");
      return false;
     }

   // Verifica se trading está habilitado para o símbolo
   bool tradeAllowed = (bool)SymbolInfoInteger(symbol, SYMBOL_TRADE_MODE);
   if(!tradeAllowed)
     {
      Print("[Slave] ❌ Trading desabilitado para: ", symbol, " (fora do horário?)");
      return false;
     }

   Print("[Slave] ✅ Símbolo pronto: ", symbol,
         " Bid:", DoubleToString(SymbolInfoDouble(symbol,SYMBOL_BID),5));
   return true;
  }

//+------------------------------------------------------------------+
void CheckForOrders()
  {
   string url = InpRailwayUrl + "/slave-order?user_id=" + InpUserId;
   uchar post[],result[]; string headers="",rh;
   int res = WebRequest("GET",url,headers,3000,post,result,rh);
   if(res <= 0) { if(connected){connected=false;Print("[Slave] Conexão perdida.");RegisterSlave();} return; }
   if(!connected) { connected=true; Print("[Slave] Reconectado."); }
   string json = CharArrayToString(result);
   if(StringFind(json,"\"hasOrder\":true") < 0) return;

   string orderId   = ExtractString(json,"\"order_id\":\"");
   string direction = ExtractString(json,"\"direction\":\"");
   string symbol    = ExtractString(json,"\"symbol\":\"");
   double sl        = ExtractDouble(json,"\"sl\":");
   double tp        = ExtractDouble(json,"\"tp\":");
   double lot_size  = ExtractDouble(json,"\"lot_size\":");
   string strategy  = ExtractString(json,"\"strategy\":\"");
   string source    = ExtractString(json,"\"source\":\"");
   double prob      = ExtractDouble(json,"\"probability\":");
   double conf      = ExtractDouble(json,"\"confirmations\":");
   double ts        = ExtractDouble(json,"\"trend_strength\":");
   bool   isCopy    = StringFind(json,"\"is_copy_trade\":true") >= 0;
   double risk_pct  = ExtractDouble(json,"\"risk_percent\":");
   double sl_pct    = ExtractDouble(json,"\"sl_percent\":");
   double tp_pct    = ExtractDouble(json,"\"tp_percent\":");

   if(orderId == lastOrderId || orderId == "") return;
   lastOrderId = orderId;

   // Se símbolo vazio usa o do gráfico como fallback
   if(symbol == "") symbol = _Symbol;

   currentStrategy      = strategy;
   currentProbability   = prob;
   currentConfirmations = (int)conf;
   currentTrendStr      = ts;
   isCopyTrade          = isCopy;
   currentSymbol        = symbol;
   currentSource        = source;

   Print("[Slave v5.1] Ordem recebida: ", direction, " ", symbol,
         " | ", (source != "" ? source : (isCopy ? "COPY TRADE" : "AUTO TRADE")),
         " | Estratégia: ", strategy,
         " | Prob: ", prob, "%");

   if(InpShowAlerts) Alert("TraderAureonia: ", (source!=""?"["+source+"] ":""), direction, " ", symbol);

   // ── PREPARA O SÍMBOLO ANTES DE OPERAR ──
   if(!PrepareSymbol(symbol))
     {
      Print("[Slave v5.1] ⚠️ Pulando ordem — símbolo não disponível: ", symbol);
      return;
     }

   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double entryPrice = (direction == "BUY") ? ask : bid;

   double newSL, newTP, lot;

   if(isCopy && risk_pct > 0)
     {
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double slDist  = entryPrice * (sl_pct / 100.0);
      double tpDist  = entryPrice * (tp_pct / 100.0);
      newSL = (direction=="BUY") ? entryPrice-slDist : entryPrice+slDist;
      newTP = (direction=="BUY") ? entryPrice+tpDist : entryPrice-tpDist;
      double slPoints = slDist / SymbolInfoDouble(symbol,SYMBOL_POINT);
      lot = CalcLotByRisk(symbol, risk_pct, slPoints);
     }
   else
     {
      newSL = sl;
      newTP = tp;
      lot   = lot_size > 0 ? lot_size : 0.01;
     }

   currentSL = newSL;
   currentTP = newTP;

   ExecuteOrder(symbol, direction, newSL, newTP, lot, orderId);
  }

//+------------------------------------------------------------------+
double CalcLotByRisk(string symbol, double riskPct, double slPoints)
  {
   double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskAmount = balance * (riskPct / 100.0);
   double tickValue  = SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_VALUE);
   double tickSize   = SymbolInfoDouble(symbol,SYMBOL_TRADE_TICK_SIZE);
   if(tickValue==0||tickSize==0||slPoints==0) return SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   double lot  = riskAmount / (slPoints * (tickValue/tickSize));
   double minL = SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   lot = MathFloor(lot/step)*step;
   return NormalizeDouble(MathMax(minL,MathMin(lot,maxL)),2);
  }

double GetATR(string symbol)
  {
   double atr[];
   if(CopyBuffer(iATR(symbol,PERIOD_M5,14),0,0,1,atr)<=0) return 0;
   return atr[0];
  }

//+------------------------------------------------------------------+
void CheckClosedOrders()
  {
   HistorySelect(TimeCurrent()-86400,TimeCurrent());
   int deals = HistoryDealsTotal();
   for(int i=deals-1;i>=0;i--)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(!HistoryDealSelect(ticket)) continue;
      datetime dealTime = (datetime)HistoryDealGetInteger(ticket,DEAL_TIME);
      if(dealTime <= lastClosedDeal) continue;
      long dealEntry = HistoryDealGetInteger(ticket,DEAL_ENTRY);
      if(dealEntry != DEAL_ENTRY_OUT) continue;
      string symbol = HistoryDealGetString(ticket,DEAL_SYMBOL);
      double profit = HistoryDealGetDouble(ticket,DEAL_PROFIT);
      double price  = HistoryDealGetDouble(ticket,DEAL_PRICE);
      int    dType  = (int)HistoryDealGetInteger(ticket,DEAL_TYPE);
      string dir    = (dType==DEAL_TYPE_BUY)?"buy":"sell";
      if(symbol=="") continue;

      string p_s  = StringFormat("%.5f",price);             StringReplace(p_s,",",".");
      string pr_s = StringFormat("%.2f",profit);             StringReplace(pr_s,",",".");
      string pb_s = StringFormat("%.1f",currentProbability); StringReplace(pb_s,",",".");
      string ts_s = StringFormat("%.1f",currentTrendStr);    StringReplace(ts_s,",",".");
      string sl_s = StringFormat("%.5f",currentSL);          StringReplace(sl_s,",",".");
      string tp_s = StringFormat("%.5f",currentTP);          StringReplace(tp_s,",",".");

      string body = "{";
      body += "\"user_id\":\""+InpUserId+"\",";
      body += "\"symbol\":\""+symbol+"\",";
      body += "\"direction\":\""+dir+"\",";
      body += "\"close_price\":"+p_s+",";
      body += "\"profit\":"+pr_s+",";
      body += "\"result\":\""+(profit>0?"win":"loss")+"\",";
      body += "\"strategy\":\""+currentStrategy+"\",";
      body += "\"probability\":"+pb_s+",";
      body += "\"confirmations\":"+IntegerToString(currentConfirmations)+",";
      body += "\"trend_strength\":"+ts_s+",";
      body += "\"sl\":"+sl_s+",";
      body += "\"tp\":"+tp_s+",";
      body += "\"source\":\""+currentSource+"\"";
      body += "}";

      string headers = "Content-Type: application/json\r\n";
      uchar data[],res[]; int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8)-1;
      ArrayResize(data,len); string rh;
      int result2 = WebRequest("POST",InpRailwayUrl+"/slave-trade-closed",headers,3000,data,res,rh);
      if(result2 == 200 || result2 == 201)
         Print("[Slave v5.1] Trade fechado salvo: ", symbol, " ", dir,
               " $", StringFormat("%.2f",profit),
               " | Source: ", currentSource);
      lastClosedDeal = dealTime;
     }
  }

//+------------------------------------------------------------------+
void ExecuteOrder(string symbol, string direction, double sl, double tp, double lot, string orderId)
  {
   double ask    = SymbolInfoDouble(symbol,SYMBOL_ASK);
   double bid    = SymbolInfoDouble(symbol,SYMBOL_BID);
   int    digits = (int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   double newSL  = NormalizeDouble(sl,digits);
   double newTP  = NormalizeDouble(tp,digits);

   // Valida SL e TP
   double stopLv  = SymbolInfoInteger(symbol,SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(symbol,SYMBOL_POINT);
   double minDist = MathMax(stopLv * 2, ask * 0.001);

   if(direction=="BUY")
     {
      if(newSL >= bid - minDist) newSL = bid - minDist;
      if(newTP <= ask + minDist) newTP = ask + minDist;
     }
   else
     {
      if(newSL <= ask + minDist) newSL = ask + minDist;
      if(newTP >= bid - minDist) newTP = bid - minDist;
     }

   newSL = NormalizeDouble(newSL, digits);
   newTP = NormalizeDouble(newTP, digits);

   // Garante que TP é válido antes de enviar
   if(newTP == 0)
     {
      double atr = GetATR(symbol);
      if(atr <= 0) atr = ask * 0.002;
      newTP = direction=="BUY" ? ask + atr*2.0 : bid - atr*2.0;
      newTP = NormalizeDouble(newTP, digits);
      Print("[Slave v5.2] TP era 0 — calculado via ATR: ", newTP);
     }

   bool result;
   if(direction=="BUY")       result = trade.Buy(lot,symbol,ask,newSL,newTP,"TA-"+orderId);
   else if(direction=="SELL") result = trade.Sell(lot,symbol,bid,newSL,newTP,"TA-"+orderId);
   else return;

   if(result)
     {
      double price = trade.ResultPrice();
      Print("[Slave v5.2] ✅ EXECUTADO! ",direction," ",symbol,
            " Lot:",lot," @ ",price,
            " SL:",newSL," TP:",newTP);

      // Garante SL e TP com PositionModify após execução
      Sleep(500);
      ulong ticket = trade.ResultOrder();
      if(ticket > 0 && PositionSelectByTicket(ticket))
        {
         double posSL = PositionGetDouble(POSITION_SL);
         double posTP = PositionGetDouble(POSITION_TP);
         if(MathAbs(posTP) < 0.001 || MathAbs(posTP - newTP) > SymbolInfoDouble(symbol,SYMBOL_POINT))
           {
            if(trade.PositionModify(symbol, newSL, newTP))
               Print("[Slave v5.2] ✅ SL/TP aplicados via Modify: SL=",newSL," TP=",newTP);
            else
               Print("[Slave v5.2] ⚠️ Modify falhou: ",GetLastError()," — ",trade.ResultRetcodeDescription());
           }
        }
      else
        {
         // Fallback: busca a posição pelo símbolo
         Sleep(1000);
         for(int i=0; i<PositionsTotal(); i++)
           {
            ulong t = PositionGetTicket(i);
            if(!PositionSelectByTicket(t)) continue;
            if(PositionGetString(POSITION_SYMBOL) != symbol) continue;
            if(PositionGetString(POSITION_COMMENT) != "TA-"+orderId) continue;
            double posTP2 = PositionGetDouble(POSITION_TP);
            if(MathAbs(posTP2) < 0.001)
              {
               if(trade.PositionModify(symbol, newSL, newTP))
                  Print("[Slave v5.2] ✅ SL/TP via fallback: SL=",newSL," TP=",newTP);
              }
            break;
           }
        }

      ConfirmExecution(orderId,symbol,direction,lot,price,newSL,newTP);
     }
   else
      Print("[Slave v5.2] ❌ Erro: ",GetLastError()," — ",trade.ResultRetcodeDescription(),
            " | ",direction," ",symbol," SL:",newSL," TP:",newTP);
  }

void ConfirmExecution(string orderId,string symbol,string direction,double lot,double price,double sl,double tp)
  {
   string p_s =StringFormat("%.5f",price); StringReplace(p_s,",",".");
   string l_s =StringFormat("%.2f",lot);   StringReplace(l_s,",",".");
   string sl_s=StringFormat("%.5f",sl);    StringReplace(sl_s,",",".");
   string tp_s=StringFormat("%.5f",tp);    StringReplace(tp_s,",",".");
   string body="{\"user_id\":\""+InpUserId+"\",\"order_id\":\""+orderId+"\","
               "\"symbol\":\""+symbol+"\",\"direction\":\""+direction+"\","
               "\"price\":"+p_s+",\"lot\":"+l_s+",\"sl\":"+sl_s+",\"tp\":"+tp_s+"}";
   string headers="Content-Type: application/json\r\n";
   uchar data[],result[]; int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8)-1;
   ArrayResize(data,len); string rh;
   WebRequest("POST",InpRailwayUrl+"/slave-confirm",headers,3000,data,result,rh);
  }

string ExtractString(string json, string key)
  {
   int s=StringFind(json,key); if(s<0) return "";
   s+=StringLen(key); if(StringGetCharacter(json,s)=='"') s++;
   int e=s; while(e<StringLen(json)&&StringGetCharacter(json,e)!='"') e++;
   return StringSubstr(json,s,e-s);
  }

double ExtractDouble(string json, string key)
  {
   int s=StringFind(json,key); if(s<0) return 0.0;
   s+=StringLen(key); int e=s;
   while(e<StringLen(json)&&StringSubstr(json,e,1)!=","&&StringSubstr(json,e,1)!="}"&&StringSubstr(json,e,1)!="]") e++;
   return StringToDouble(StringSubstr(json,s,e-s));
  }
//+------------------------------------------------------------------+
