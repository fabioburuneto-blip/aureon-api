//+------------------------------------------------------------------+
//| TraderAureonia_Slave.mq5                                         |
//| EA Slave v5.8 — 27 Ativos PU Prime                             |
//| v5.8: FIX direção+entry invertidos — usa deal de ABERTURA        |
//|       (DEAL_ENTRY_IN) para direção e preço, não o de fechamento  |
//|       + logs de diagnóstico nos pontos de falha silenciosa       |
//| v5.7: reporta SÓ trades abertos por este EA (magic 88882) e     |
//|       não pula mais fechamentos quando 2+ fecham no mesmo ciclo |
//| v5.6: nomes corretos PU Prime (forex .s, JPN225ft.s)            |
//| v5.5: SL/TP/metadados por posição (evita cross-contaminação)    |
//+------------------------------------------------------------------+
#property copyright "TraderAureonia AI"
#property version   "5.8"
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

input string InpUserId        = "";
input string InpWhatsappPhone = "";
input string InpRailwayUrl    = "https://aureon-api-production-3d61.up.railway.app";
input bool   InpShowAlerts    = true;
input double InpDefaultLot    = 0.01;
input int    InpMaxPositions  = 20;

#define SLAVE_MAGIC 88882   // ✅ v5.7: magic deste EA (usado pra filtrar fechamentos)

string   lastOrderId     = "";
bool     connected       = false;
bool     isProUser       = false;
datetime lastClosedDeal  = 0;
string   currentPlan     = "basic";
datetime lastHeartbeat   = 0;
datetime lastRegister    = 0;
int      failCount       = 0;
int      HEARTBEAT_SEC   = 10;
int      RECONNECT_SEC   = 30;
int      MAX_FAILS       = 5;

string   currentStrategy      = "";
double   currentProbability   = 0;
int      currentConfirmations = 0;
double   currentTrendStr      = 0;
double   currentSL            = 0;
double   currentTP            = 0;
string   currentSymbol        = "";
string   currentSource        = "";

struct TradeMeta {
   ulong  posId;
   string symbol;
   double sl;
   double tp;
   string strategy;
   double probability;
   int    confirmations;
   double trendStrength;
   string source;
};
TradeMeta g_trades[];
int MAX_TRADE_META = 100;

void StoreTradeMeta(ulong posId, string symbol, double sl, double tp) {
   int n = ArraySize(g_trades);
   if(n >= MAX_TRADE_META) ArrayRemove(g_trades, 0, 1);
   n = ArraySize(g_trades);
   ArrayResize(g_trades, n+1);
   g_trades[n].posId         = posId;
   g_trades[n].symbol        = symbol;
   g_trades[n].sl            = sl;
   g_trades[n].tp            = tp;
   g_trades[n].strategy      = currentStrategy;
   g_trades[n].probability   = currentProbability;
   g_trades[n].confirmations = currentConfirmations;
   g_trades[n].trendStrength = currentTrendStr;
   g_trades[n].source        = currentSource;
}

bool GetTradeMeta(ulong posId, TradeMeta &out) {
   for(int i=0; i<ArraySize(g_trades); i++) {
      if(g_trades[i].posId == posId) {
         out = g_trades[i];
         ArrayRemove(g_trades, i, 1);
         return true;
      }
   }
   return false;
}

string SYMBOL_MAP_SITE[];
string SYMBOL_MAP_MT5[];

void AddSymbol(string site, string mt5) {
   int n = ArraySize(SYMBOL_MAP_SITE);
   ArrayResize(SYMBOL_MAP_SITE, n+1);
   ArrayResize(SYMBOL_MAP_MT5,  n+1);
   SYMBOL_MAP_SITE[n] = site;
   SYMBOL_MAP_MT5[n]  = mt5;
}

void InitSymbolMap() {
   AddSymbol("BTCUSD",     "BTCUSD");
   AddSymbol("ETHUSD",     "ETHUSD");
   AddSymbol("BNBUSD",     "BNBUSD");
   AddSymbol("SOLUSD",     "SOLUSD");
   AddSymbol("XRPUSD",     "XRPUSD");
   AddSymbol("ADAUSD",     "ADAUSD");
   AddSymbol("DOTUSD",     "DOTUSD");
   AddSymbol("EURUSD.s",   "EURUSD.s");
   AddSymbol("GBPUSD.s",   "GBPUSD.s");
   AddSymbol("USDJPY.s",   "USDJPY.s");
   AddSymbol("AUDUSD.s",   "AUDUSD.s");
   AddSymbol("USDCAD.s",   "USDCAD.s");
   AddSymbol("USDCHF.s",   "USDCHF.s");
   AddSymbol("NZDUSD.s",   "NZDUSD.s");
   AddSymbol("EURGBP.s",   "EURGBP.s");
   AddSymbol("GBPJPY.s",   "GBPJPY.s");
   AddSymbol("EURJPY.s",   "EURJPY.s");
   AddSymbol("XAUUSD.s",   "XAUUSD.s");
   AddSymbol("XAGUSD.s",   "XAGUSD.s");
   AddSymbol("WTIUSD",     "WTIUSD");
   AddSymbol("NATGAS",     "NATGAS");
   AddSymbol("NAS100.s",   "NAS100.s");
   AddSymbol("SP500.s",    "SP500.s");
   AddSymbol("US30.s",     "US30.s");
   AddSymbol("GER40.s",    "GER40.s");
   AddSymbol("UK100.s",    "UK100.s");
   AddSymbol("JPN225ft.s", "JPN225ft.s");
   AddSymbol("EURUSD",     "EURUSD.s");
   AddSymbol("GBPUSD",     "GBPUSD.s");
   AddSymbol("USDJPY",     "USDJPY.s");
   AddSymbol("AUDUSD",     "AUDUSD.s");
   AddSymbol("USDCAD",     "USDCAD.s");
   AddSymbol("USDCHF",     "USDCHF.s");
   AddSymbol("NZDUSD",     "NZDUSD.s");
   AddSymbol("EURGBP",     "EURGBP.s");
   AddSymbol("GBPJPY",     "GBPJPY.s");
   AddSymbol("EURJPY",     "EURJPY.s");
   AddSymbol("NAS100",     "NAS100.s");
   AddSymbol("SP500",      "SP500.s");
   AddSymbol("US30",       "US30.s");
   AddSymbol("GER40",      "GER40.s");
   AddSymbol("UK100",      "UK100.s");
   AddSymbol("JPN225",     "JPN225ft.s");
   AddSymbol("JPN225.s",   "JPN225ft.s");
   AddSymbol("XAUUSD",     "XAUUSD.s");
   AddSymbol("XAGUSD",     "XAGUSD.s");
}

string ResolveMT5Symbol(string siteSymbol) {
   for(int i=0; i<ArraySize(SYMBOL_MAP_SITE); i++)
      if(SYMBOL_MAP_SITE[i] == siteSymbol) return SYMBOL_MAP_MT5[i];
   return siteSymbol;
}

int OnInit() {
   if(InpUserId==""||StringLen(InpUserId)<5) {
      MessageBox("User ID não configurado!\n\nAcesse traderaureonia.com.br → copie seu User ID",
                 "TraderAureonia Slave v5.8",MB_OK|MB_ICONWARNING);
      return INIT_PARAMETERS_INCORRECT;
   }
   trade.SetExpertMagicNumber(SLAVE_MAGIC);
   trade.SetDeviationInPoints(30);
   InitSymbolMap();
   HistorySelect(TimeCurrent()-86400,TimeCurrent());
   int deals=HistoryDealsTotal();
   if(deals>0){ulong t=HistoryDealGetTicket(deals-1);lastClosedDeal=(datetime)HistoryDealGetInteger(t,DEAL_TIME);}
   RegisterSlave();
   EventSetMillisecondTimer(2000);
   Print("╔════════════════════════════════════════════════════╗");
   Print("║  TraderAureonia Slave v5.8 — 27 Ativos PU Prime   ║");
   Print("║  User: ",InpUserId,"                              ║");
   Print("║  Reporta só trades deste EA (magic 88882)         ║");
   Print("╚════════════════════════════════════════════════════╝");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); UnregisterSlave(); }

void OnTimer() {
   datetime now=TimeCurrent();
   if(now-lastHeartbeat>=HEARTBEAT_SEC){lastHeartbeat=now;SendHeartbeat();}
   if(!connected||!isProUser) {
      if(now-lastRegister>=RECONNECT_SEC){Print("[Slave v5.8] Reconectando...");RegisterSlave();}
      return;
   }
   CheckClosedOrders();
}

void SendHeartbeat() {
   string url=InpRailwayUrl+"/slave-order?user_id="+InpUserId;
   uchar post[],result[];string headers="",rh;
   int res=WebRequest("GET",url,headers,3000,post,result,rh);
   if(res<=0) {
      failCount++;
      if(failCount>=MAX_FAILS&&connected){connected=false;Print("[Slave v5.8] ⚠️ Conexão perdida");RegisterSlave();}
      return;
   }
   if(!connected){connected=true;Print("[Slave v5.8] ✅ Reconectado!");}
   failCount=0;
   string json=CharArrayToString(result);
   if(StringFind(json,"\"hasOrder\":true")>=0) ProcessOrder(json);
}

void RegisterSlave() {
   lastRegister=TimeCurrent();
   string body="{\"user_id\":\""+InpUserId+"\",\"account\":\""+IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN))+"\","
               "\"symbol\":\"MULTI-ASSET\","
               "\"balance\":"+DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2)+","
               "\"whatsapp_phone\":\""+InpWhatsappPhone+"\","
               "\"status\":\"connected\"}";
   string headers="Content-Type: application/json\r\n";
   uchar data[],result[];string rh;
   int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8)-1;ArrayResize(data,len);
   int res=WebRequest("POST",InpRailwayUrl+"/slave-register",headers,5000,data,result,rh);
   string json=CharArrayToString(result);
   if(res==200||res==201) {
      isProUser=true;connected=true;failCount=0;
      currentPlan=ExtractString(json,"\"plan\":\"");
      Print("[Slave v5.8] ✅ Conectado! Plano: ",currentPlan);
      if(InpShowAlerts) Alert("TraderAureonia Slave v5.8 — Plano: ",currentPlan);
   } else if(res==403) {
      isProUser=false;connected=false;
      Print("[Slave v5.8] ❌ Acesso negado: ",ExtractString(json,"\"message\":\""));
   } else Print("[Slave v5.8] ⚠️ Register: ",res);
}

void UnregisterSlave() {
   string body="{\"user_id\":\""+InpUserId+"\",\"status\":\"disconnected\"}";
   string headers="Content-Type: application/json\r\n";
   uchar data[],result[];int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8)-1;
   ArrayResize(data,len);string rh;
   WebRequest("POST",InpRailwayUrl+"/slave-register",headers,3000,data,result,rh);
}

bool PrepareSymbol(string symbol) {
   if(symbol==""){Print("[Slave v5.8] Símbolo vazio!");return false;}
   string mt5sym=ResolveMT5Symbol(symbol);
   if(!SymbolSelect(mt5sym,true)){Print("[Slave v5.8] ❌ Não selecionou: ",mt5sym);return false;}
   int attempts=0;
   while(SymbolInfoDouble(mt5sym,SYMBOL_BID)==0&&attempts<15){Sleep(300);attempts++;}
   if(SymbolInfoDouble(mt5sym,SYMBOL_BID)==0){Print("[Slave v5.8] ❌ Sem preço: ",mt5sym);return false;}
   ENUM_SYMBOL_TRADE_MODE mode=(ENUM_SYMBOL_TRADE_MODE)SymbolInfoInteger(mt5sym,SYMBOL_TRADE_MODE);
   if(mode==SYMBOL_TRADE_MODE_DISABLED){Print("[Slave v5.8] ❌ Trading desabilitado: ",mt5sym);return false;}
   return true;
}

void ProcessOrder(string json) {
   string orderId   =ExtractString(json,"\"order_id\":\"");
   string direction =ExtractString(json,"\"direction\":\"");
   string siteSymbol=ExtractString(json,"\"symbol\":\"");
   double sl        =ExtractDouble(json,"\"sl\":");
   double tp        =ExtractDouble(json,"\"tp\":");
   double lot_size  =ExtractDouble(json,"\"lot_size\":");
   string strategy  =ExtractString(json,"\"strategy\":\"");
   string source    =ExtractString(json,"\"source\":\"");
   double prob      =ExtractDouble(json,"\"probability\":");
   double conf      =ExtractDouble(json,"\"confirmations\":");
   double ts        =ExtractDouble(json,"\"trend_strength\":");

   if(lot_size<=0) lot_size=InpDefaultLot;
   if(orderId==lastOrderId||orderId=="") return;
   lastOrderId=orderId;
   if(siteSymbol=="") siteSymbol=_Symbol;

   string mt5Symbol=ResolveMT5Symbol(siteSymbol);
   currentStrategy=strategy;currentProbability=prob;
   currentConfirmations=(int)conf;currentTrendStr=ts;
   currentSymbol=mt5Symbol;currentSource=source;

   Print("[Slave v5.8] 📥 ",direction," ",siteSymbol," → ",mt5Symbol,
         " | Source: ",source," | Prob: ",prob,"% | SL:",sl," TP:",tp);

   if(InpShowAlerts) Alert("TraderAureonia: [",source,"] ",direction," ",mt5Symbol);
   if(!AllowEntry(mt5Symbol)) return;
   if(!PrepareSymbol(siteSymbol)) return;

   currentSL=sl;currentTP=tp;
   ExecuteOrder(mt5Symbol,direction,sl,tp,lot_size,orderId);
}

bool AllowEntry(string symbol) {
   if(PositionsTotal()>=InpMaxPositions){Print("[Slave v5.8] Máximo de posições atingido");return false;}
   for(int i=0;i<PositionsTotal();i++) {
      ulong t=PositionGetTicket(i);
      if(!PositionSelectByTicket(t))continue;
      if(PositionGetString(POSITION_SYMBOL)==symbol){Print("[Slave v5.8] Já tem posição em ",symbol);return false;}
   }
   double bal=AccountInfoDouble(ACCOUNT_BALANCE),eq=AccountInfoDouble(ACCOUNT_EQUITY);
   if(bal>0&&(bal-eq)/bal>0.05){Print("[Slave v5.8] Drawdown alto — pausando");return false;}
   return true;
}

double GetATR(string symbol) {
   double atr[];
   if(CopyBuffer(iATR(symbol,PERIOD_M5,14),0,0,1,atr)<=0) return 0;
   return atr[0];
}

void ExecuteOrder(string symbol,string direction,double sl,double tp,double lot,string orderId) {
   double ask=SymbolInfoDouble(symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(symbol,SYMBOL_BID);
   int    digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   double pt=SymbolInfoDouble(symbol,SYMBOL_POINT);
   double stopLv=SymbolInfoInteger(symbol,SYMBOL_TRADE_STOPS_LEVEL)*pt;
   double minD=MathMax(stopLv*3,ask*0.001);

   double newSL=NormalizeDouble(sl,digits);
   double newTP=NormalizeDouble(tp,digits);

   if(direction=="BUY") {
      if(newSL>=bid-minD) newSL=NormalizeDouble(bid-minD*1.5,digits);
      if(newTP<=ask+minD) newTP=NormalizeDouble(ask+minD*1.5,digits);
   } else {
      if(newSL<=ask+minD) newSL=NormalizeDouble(ask+minD*1.5,digits);
      if(newTP>=bid-minD) newTP=NormalizeDouble(bid-minD*1.5,digits);
   }

   if(newTP<=0||MathAbs(newTP-ask)<minD) {
      double atr=GetATR(symbol);if(atr<=0)atr=ask*0.002;
      newTP=direction=="BUY"?NormalizeDouble(ask+atr*2.0,digits):NormalizeDouble(bid-atr*2.0,digits);
   }

   double minLot=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MIN);
   double maxLot=SymbolInfoDouble(symbol,SYMBOL_VOLUME_MAX);
   double stepLot=SymbolInfoDouble(symbol,SYMBOL_VOLUME_STEP);
   lot=MathMax(lot,minLot);lot=MathMin(lot,maxLot);
   lot=MathFloor(lot/stepLot)*stepLot;
   lot=NormalizeDouble(lot,2);

   bool result;
   if(direction=="BUY")       result=trade.Buy(lot,symbol,ask,newSL,newTP,"TA-"+orderId);
   else if(direction=="SELL") result=trade.Sell(lot,symbol,bid,newSL,newTP,"TA-"+orderId);
   else return;

   if(result) {
      Print("[Slave v5.8] ✅ ",direction," ",symbol," Lot:",lot," SL:",newSL," TP:",newTP);
      Sleep(500);
      ulong ticket=trade.ResultOrder();
      if(ticket>0&&PositionSelectByTicket(ticket)) {
         if(MathAbs(PositionGetDouble(POSITION_TP))<0.001||MathAbs(PositionGetDouble(POSITION_TP)-newTP)>pt*10)
            trade.PositionModify(symbol,newSL,newTP);
         ulong posId=PositionGetInteger(POSITION_IDENTIFIER);
         StoreTradeMeta(posId,symbol,newSL,newTP);
      }
      ConfirmExecution(orderId,symbol,direction,lot,trade.ResultPrice(),newSL,newTP);
   } else
      Print("[Slave v5.8] ❌ Erro: ",GetLastError()," | ",direction," ",symbol);
}

void ConfirmExecution(string orderId,string symbol,string direction,double lot,double price,double sl,double tp) {
   string p_s=StringFormat("%.5f",price);StringReplace(p_s,",",".");
   string l_s=StringFormat("%.2f",lot);StringReplace(l_s,",",".");
   string sl_s=StringFormat("%.5f",sl);StringReplace(sl_s,",",".");
   string tp_s=StringFormat("%.5f",tp);StringReplace(tp_s,",",".");
   string body="{\"user_id\":\""+InpUserId+"\",\"order_id\":\""+orderId+"\","
               "\"symbol\":\""+symbol+"\",\"direction\":\""+direction+"\","
               "\"price\":"+p_s+",\"lot\":"+l_s+",\"sl\":"+sl_s+",\"tp\":"+tp_s+"}";
   string headers="Content-Type: application/json\r\n";
   uchar data[],result[];int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8)-1;
   ArrayResize(data,len);string rh;
   WebRequest("POST",InpRailwayUrl+"/slave-confirm",headers,3000,data,result,rh);
}

// ✅ FIX v5.8: retorna direção E preço reais do deal de ABERTURA (DEAL_ENTRY_IN)
// da posição — não do deal de fechamento (DEAL_ENTRY_OUT). No MT5, fechar uma
// posição gera um deal do TIPO OPOSTO (fechar BUY = deal SELL), então usar o
// deal de saída pra "direção" grava a direção invertida. E só o deal de
// abertura tem o preço de ENTRADA real da posição.
bool GetEntryDealInfo(ulong posId, double &entryPrice, int &entryType) {
   entryPrice = 0;
   entryType  = -1;
   if(!HistorySelectByPosition(posId)) return false;
   int n=HistoryDealsTotal();
   for(int j=0;j<n;j++){
      ulong dt=HistoryDealGetTicket(j);
      if(HistoryDealGetInteger(dt,DEAL_ENTRY)==DEAL_ENTRY_IN){
         entryPrice = HistoryDealGetDouble(dt, DEAL_PRICE);
         entryType  = (int)HistoryDealGetInteger(dt, DEAL_TYPE);
         return (HistoryDealGetInteger(dt,DEAL_MAGIC)==SLAVE_MAGIC);
      }
   }
   return false;
}

void CheckClosedOrders() {
   if(!HistorySelect(TimeCurrent()-86400,TimeCurrent())) return;
   int deals=HistoryDealsTotal();

   double cProfit[]; double cPrice[]; string cSymbol[]; int cType[]; ulong cPosId[];
   datetime maxOut=lastClosedDeal;
   for(int i=0;i<deals;i++) {
      ulong ticket=HistoryDealGetTicket(i);
      if(!HistoryDealSelect(ticket))continue;
      datetime dealTime=(datetime)HistoryDealGetInteger(ticket,DEAL_TIME);
      if(dealTime<=lastClosedDeal)continue;
      if(HistoryDealGetInteger(ticket,DEAL_ENTRY)!=DEAL_ENTRY_OUT)continue;
      if(dealTime>maxOut)maxOut=dealTime;
      int k=ArraySize(cProfit);
      ArrayResize(cProfit,k+1);ArrayResize(cPrice,k+1);ArrayResize(cSymbol,k+1);
      ArrayResize(cType,k+1);ArrayResize(cPosId,k+1);
      cProfit[k]=HistoryDealGetDouble(ticket,DEAL_PROFIT);
      cPrice[k] =HistoryDealGetDouble(ticket,DEAL_PRICE);
      cSymbol[k]=HistoryDealGetString(ticket,DEAL_SYMBOL);
      cType[k]  =(int)HistoryDealGetInteger(ticket,DEAL_TYPE);
      cPosId[k] =HistoryDealGetInteger(ticket,DEAL_POSITION_ID);
   }

   // 🔍 DEBUG: mostra quantos fechamentos foram detectados neste ciclo
   if(ArraySize(cProfit)>0)
      Print("[Slave v5.8] 🔍 ",ArraySize(cProfit)," fechamento(s) detectado(s) neste ciclo (janela: ",TimeToString(lastClosedDeal)," até agora)");

   for(int k=0;k<ArraySize(cProfit);k++) {
      string symbol=cSymbol[k];
      if(symbol=="")continue;

      // ✅ FIX v5.8: direção e preço de ENTRADA vêm do deal de abertura, não do
      // deal de fechamento (cType[k]/cPrice[k] continuam sendo usados só pro
      // preço de FECHAMENTO e pro profit, que esses sim vêm certos do deal OUT).
      double entryPrice=0; int entryType=-1;
      if(!GetEntryDealInfo(cPosId[k], entryPrice, entryType)){
         // 🔍 DEBUG: antes esse caso era ignorado em silêncio — agora avisa
         Print("[Slave v5.8] ⚠️ PosID ",cPosId[k]," (",symbol,") — GetEntryDealInfo falhou (magic diferente de ",SLAVE_MAGIC," ou deal de entrada não encontrado no histórico) — fechamento IGNORADO, não reportado ao servidor");
         continue;
      }

      double profit=cProfit[k];
      double price =cPrice[k];                              // preço de FECHAMENTO
      string dir=(entryType==DEAL_TYPE_BUY)?"buy":"sell";    // ✅ direção REAL da posição

      TradeMeta meta;
      bool hasMeta=GetTradeMeta(cPosId[k],meta);
      double metaSL,metaTP,metaProb,metaTS;int metaConf;string metaStrat,metaSrc;
      if(hasMeta) {
         metaSL=meta.sl;metaTP=meta.tp;metaStrat=meta.strategy;
         metaProb=meta.probability;metaConf=meta.confirmations;
         metaTS=meta.trendStrength;metaSrc=meta.source;
      } else {
         metaSL=currentSL;metaTP=currentTP;metaStrat=currentStrategy;
         metaProb=currentProbability;metaConf=currentConfirmations;
         metaTS=currentTrendStr;metaSrc=currentSource;
      }

      string p_s=StringFormat("%.5f",price);StringReplace(p_s,",",".");
      string e_s=StringFormat("%.5f",entryPrice);StringReplace(e_s,",",".");   // ✅ novo — preço de ENTRADA
      string pr_s=StringFormat("%.2f",profit);StringReplace(pr_s,",",".");
      string pb_s=StringFormat("%.1f",metaProb);StringReplace(pb_s,",",".");
      string ts_s=StringFormat("%.1f",metaTS);StringReplace(ts_s,",",".");
      string sl_s=StringFormat("%.5f",metaSL);StringReplace(sl_s,",",".");
      string tp_s=StringFormat("%.5f",metaTP);StringReplace(tp_s,",",".");

      string body="{\"user_id\":\""+InpUserId+"\","
                  "\"symbol\":\""+symbol+"\","
                  "\"direction\":\""+dir+"\","
                  "\"entry\":"+e_s+","
                  "\"close_price\":"+p_s+","
                  "\"profit\":"+pr_s+","
                  "\"result\":\""+(profit>0?"win":"loss")+"\","
                  "\"strategy\":\""+metaStrat+"\","
                  "\"probability\":"+pb_s+","
                  "\"confirmations\":"+IntegerToString(metaConf)+","
                  "\"trend_strength\":"+ts_s+","
                  "\"sl\":"+sl_s+","
                  "\"tp\":"+tp_s+","
                  "\"source\":\""+metaSrc+"\"}";

      string headers="Content-Type: application/json\r\n";
      uchar data[],res[];int len=StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8)-1;
      ArrayResize(data,len);string rh;
      int result2=WebRequest("POST",InpRailwayUrl+"/slave-trade-closed",headers,3000,data,res,rh);
      if(result2==200||result2==201)
         Print("[Slave v5.8] ✅ Fechado: ",symbol," ",dir," $",StringFormat("%.2f",profit));
      else
         // 🔍 DEBUG: antes essa falha era ignorada em silêncio — agora mostra o motivo
         Print("[Slave v5.8] ❌ FALHA ao reportar fechamento ",symbol," — HTTP:",result2," | GetLastError:",GetLastError()," | Resposta:",CharArrayToString(res));
   }

   lastClosedDeal=maxOut;
}

string ExtractString(string json,string key) {
   int s=StringFind(json,key);if(s<0)return "";
   s+=StringLen(key);if(StringGetCharacter(json,s)=='"')s++;
   int e=s;while(e<StringLen(json)&&StringGetCharacter(json,e)!='"')e++;
   return StringSubstr(json,s,e-s);
}
double ExtractDouble(string json,string key) {
   int s=StringFind(json,key);if(s<0)return 0.0;
   s+=StringLen(key);int e=s;
   while(e<StringLen(json)&&StringSubstr(json,e,1)!=","&&StringSubstr(json,e,1)!="}"&&StringSubstr(json,e,1)!="]")e++;
   return StringToDouble(StringSubstr(json,s,e-s));
}
