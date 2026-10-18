// ===== 股票情報站完整版 =====
const DEFAULT_WATCHLIST = ["TSLA","NVDA","AAPL","SPCX","GOOGL","NBIS","CRWV","ONDS","PLTR","RKLB","AVAV","SMR","UNH","META","MSFT","AMZN","INTC","AMD","AVGO","SNDK","MU","TSM","BE","SOFI","ASTS"];
const POS_WORDS = ["beat","surge","jump","rally","record","upgrade","bullish","growth","profit","gain","soar","outperform","raise","strong","optimistic","breakthrough","approve","win","expand","launch","surprise","tops","jumps"];
const NEG_WORDS = ["miss","plunge","drop","fall","downgrade","bearish","loss","cut","lawsuit","probe","warning","risk","concern","weak","decline","selloff","crash","fraud","bankrupt","layoff","slump","tumbles"];
let DATA = null;
let livePrices = {};   // symbol -> {p, t}
let ws = null, wsConnected = false;
let sortMode = "default";
let currentDetail = null;

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem("siw_"+k); return v == null ? d : JSON.parse(v); } catch(e){ return d; } },
  set(k, v) { try { localStorage.setItem("siw_"+k, JSON.stringify(v)); } catch(e){} }
};
function getWatchlist() { return store.get("watchlist", DEFAULT_WATCHLIST.slice()); }
function sentiment(t){ t=(t||"").toLowerCase(); let s=0; POS_WORDS.forEach(w=>{if(t.includes(w))s++;}); NEG_WORDS.forEach(w=>{if(t.includes(w))s--;}); return s; }

// ---- 技術指標 ----
function sma(a,n){const o=new Array(a.length).fill(null);for(let i=n-1;i<a.length;i++){let s=0;for(let j=i-n+1;j<=i;j++)s+=a[j];o[i]=s/n;}return o;}
function ema(a,n){const o=new Array(a.length).fill(null);const k=2/(n+1);let p=null;for(let i=0;i<a.length;i++){p=p===null?a[i]:a[i]*k+p*(1-k);o[i]=i>=n-1?p:null;}return o;}
function rsi(c,n=14){const o=new Array(c.length).fill(null);let g=0,l=0;for(let i=1;i<c.length;i++){const d=c[i]-c[i-1];if(i<=n){if(d>0)g+=d;else l-=d;}if(i===n){let ag=g/n,al=l/n;o[i]=al===0?100:100-100/(1+ag/al);for(let j=i+1;j<c.length;j++){const dd=c[j]-c[j-1];ag=(ag*(n-1)+Math.max(dd,0))/n;al=(al*(n-1)+Math.max(-dd,0))/n;o[j]=al===0?100:100-100/(1+ag/al);}break;}}return o;}
function sd(a,n){const o=new Array(a.length).fill(null);for(let i=n-1;i<a.length;i++){const s=a.slice(i-n+1,i+1);const m=s.reduce((x,y)=>x+y,0)/n;o[i]=Math.sqrt(s.reduce((x,y)=>x+(y-m)*(y-m),0)/n);}return o;}

// ---- Finnhub WebSocket ----
function connectWS(){
  const key = store.get("finnhub_key", "");
  if(!key) { setWsStatus("未連接（未設定 key）"); return; }
  if(ws) try{ ws.close(); }catch(e){}
  try {
    ws = new WebSocket("wss://ws.finnhub.io?token=" + key);
    ws.onopen = () => { wsConnected = true; setWsStatus("● 串流中"); getWatchlist().forEach(s=>ws.send(JSON.stringify({type:"subscribe",symbol:s}))); };
    ws.onmessage = e => {
      try {
        const m = JSON.parse(e.data);
        if(m.type === "trade" && m.data) m.data.forEach(t => {
          const sym = t.s;
          if(livePrices[sym] && livePrices[sym].p !== t.p){ flash(sym); }
          livePrices[sym] = {p:t.p, t:t.t};
          updateRowPrice(sym, t.p);
          if(currentDetail === sym) updateDetailPrice(sym, t.p);
          checkAlerts(sym, t.p);
        });
      }catch(err){}
    };
    ws.onclose = () => { wsConnected=false; setWsStatus("已斷線，5 秒後重連…"); setTimeout(connectWS, 5000); };
    ws.onerror = () => { setWsStatus("連接錯誤（key 可能無效）"); };
  }catch(e){ setWsStatus("連接失敗"); }
}
function setWsStatus(t){ const el=$("ws-status"); if(el) el.textContent=t; }
function flash(sym){ const el=document.querySelector(`[data-sym="${sym}"] .lp`); if(el){ el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } }

// ---- 報價 ----
function getPrice(sym){
  if(livePrices[sym]) return livePrices[sym].p;
  const s = DATA && DATA.stocks[sym];
  if(s && s.prices.length) return s.prices[s.prices.length-1].c;
  return null;
}
function getPrevClose(sym){
  const s = DATA && DATA.stocks[sym];
  if(s && s.prices.length > 1) return s.prices[s.prices.length-2].c;
  return null;
}

// ---- 渲染 ----
function renderIndices(){
  if(!DATA) return;
  $("indices").innerHTML = Object.entries(DATA.indices).map(([n,d])=>{
    const p=d.prices, last=p[p.length-1].c, prev=p.length>1?p[p.length-2].c:d.prev;
    const chg=prev?(last-prev)/prev*100:0, cls=chg>=0?"up":"dn";
    return `<div class="idx"><div class="n">${n}</div><div class="p">${fmtNum(last)}</div><div class="c ${cls}">${chg>=0?"+":""}${chg.toFixed(2)}%</div></div>`;
  }).join("");
}
function fmtNum(v){ return v>=1000 ? v.toLocaleString("en-US",{maximumFractionDigits:2}) : v.toFixed(2); }
function sparkline(prices){
  const c=prices.slice(-30).map(p=>p.c); if(c.length<2) return "";
  const min=Math.min(...c), max=Math.max(...c), rg=max-min||1;
  const w=80,h=24;
  const pts=c.map((v,i)=>`${(i/(c.length-1)*w).toFixed(1)},${(h-2-(v-min)/rg*(h-4)).toFixed(1)}`).join(" ");
  const up=c[c.length-1]>=c[0];
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${up?"#3ddc84":"#ff6b6b"}" stroke-width="1.5"/></svg>`;
}
function renderWatchlist(){
  const wl=getWatchlist();
  let rows=wl.map(sym=>{
    const s=DATA&&DATA.stocks[sym];
    const px=getPrice(sym), pc=getPrevClose(sym);
    const chg=(px!=null&&pc)?(px-pc)/pc*100:null;
    const cls=chg==null?"":chg>=0?"up":"dn";
    return {sym, px, chg, cls, spark:s?sparkline(s.prices):""};
  });
  if(sortMode==="chg") rows.sort((a,b)=>(b.chg??-999)-(a.chg??-999));
  else if(sortMode==="name") rows.sort((a,b)=>a.sym.localeCompare(b.sym));
  $("watchlist-body").innerHTML=rows.map(r=>`
    <div class="wl-row" data-sym="${r.sym}" onclick="openDetail('${r.sym}')">
      <div class="wl-sym">${r.sym}</div>
      <div class="wl-spark">${r.spark}</div>
      <div class="wl-px"><span class="lp">${r.px!=null?"$"+r.px.toFixed(2):"—"}</span><div class="wl-chg ${r.cls}">${r.chg!=null?(r.chg>=0?"+":"")+r.chg.toFixed(2)+"%":"—"}</div></div>
      <button class="wl-x" onclick="event.stopPropagation();removeTicker('${r.sym}')">×</button>
    </div>`).join("");
}
function updateRowPrice(sym, px){
  const row=document.querySelector(`[data-sym="${sym}"]`); if(!row) return;
  const pc=getPrevClose(sym), chg=pc?(px-pc)/pc*100:null;
  const lp=row.querySelector(".lp"); if(lp) lp.textContent="$"+px.toFixed(2);
  const c=row.querySelector(".wl-chg");
  if(c&&chg!=null){ c.textContent=(chg>=0?"+":"")+chg.toFixed(2)+"%"; c.className="wl-chg "+(chg>=0?"up":"dn"); }
}
function removeTicker(sym){
  store.set("watchlist", getWatchlist().filter(s=>s!==sym));
  if(wsConnected&&ws) try{ ws.send(JSON.stringify({type:"unsubscribe",symbol:sym})); }catch(e){}
  renderWatchlist();
}
function addTicker(){
  const v=$("add-input").value.trim().toUpperCase(); if(!v) return;
  const wl=getWatchlist();
  if(wl.includes(v)){ $("add-input").value=""; return; }
  if(!DATA||!DATA.stocks[v]){ alert("數據入面冇 "+v+"，淨係支援觀察名單 25 隻。"); return; }
  wl.push(v); store.set("watchlist",wl);
  if(wsConnected&&ws) try{ ws.send(JSON.stringify({type:"subscribe",symbol:v})); }catch(e){}
  $("add-input").value=""; renderWatchlist();
}
function setSort(m){ sortMode=m; document.querySelectorAll(".sort-btn").forEach(b=>b.classList.toggle("active",b.dataset.m===m)); renderWatchlist(); }

// ---- 詳情 ----
function openDetail(sym){
  currentDetail=sym;
  const s=DATA.stocks[sym]; if(!s) return;
  const closes=s.prices.map(p=>p.c), vols=s.prices.map(p=>p.v);
  const live=getPrice(sym), last=live!=null?live:closes[closes.length-1];
  const prev=closes[closes.length-2], chg=last-prev, chgPct=chg/prev*100;
  const s20=sma(closes,20),s50=sma(closes,50),e12=ema(closes,12),e26=ema(closes,26);
  const rA=rsi(closes),sdd=sd(closes,20),rsiL=rA[rA.length-1];
  const mL=e12.map((v,i)=>v==null||e26[i]==null?null:v-e26[i]);
  const mS=ema(mL.filter(v=>v!=null),9), mH=mL[mL.length-1]-mS[mS.length-1];
  const bbU=s20[s20.length-1]+2*sdd[sdd.length-1], bbL=s20[s20.length-1]-2*sdd[sdd.length-1];
  const avgV=vols.slice(-20).reduce((a,b)=>a+b,0)/20, vr=avgV?vols[vols.length-1]/avgV:0;
  let bull=0,bear=0; const sig=[];
  if(rsiL!=null){ if(rsiL<30){bull++;sig.push("RSI "+rsiL.toFixed(1)+" 超賣");} else if(rsiL>70){bear++;sig.push("RSI "+rsiL.toFixed(1)+" 超買");} }
  if(mH>0){bull++;sig.push("MACD 轉強");}else{bear++;sig.push("MACD 轉弱");}
  if(s50[s50.length-1]!=null){ if(last>s50[s50.length-1]){bull++;sig.push("企上 50 日線");}else{bear++;sig.push("跌穿 50 日線");} }
  if(bbL!=null){ if(last<bbL){bull++;sig.push("跌穿布林下軌");} else if(last>bbU){bear++;sig.push("升穿布林上軌");} }
  if(vr>1.5) sig.push("量比 "+vr.toFixed(1)+"x");
  const news=(s.news||[]).map(n=>({...n,s:sentiment(n.t)}));
  const aS=news.length?news.reduce((a,b)=>a+b.s,0)/news.length:0;
  if(aS>0.3)bull++; else if(aS<-0.3)bear++;
  const vd=bull>bear+1?["偏強","v-bull"]:bear>bull+1?["偏弱","v-bear"]:["中性","v-neutral"];
  const cc=chg>=0?"up":"dn";
  const al=store.get("alerts",{});
  $("detail").innerHTML=`
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center"><h2>${sym} <span class="cn">${s.name||""}</span></h2><button class="back" onclick="closeDetail()">← 返回</button></div>
    <div class="price"><span id="d-px">$${last.toFixed(2)}</span> <span class="${cc}" style="font-size:20px" id="d-chg">${chg>=0?"+":""}${chg.toFixed(2)} (${chgPct>=0?"+":""}${chgPct.toFixed(2)}%)</span></div>
    <div class="live-tag">${livePrices[sym]?"● 即時":"○ 延遲（每小時更新）"}</div>
    <canvas id="dchart"></canvas>
    <div class="lg">藍＝股價　黃＝20日線　灰＝50日線</div>
    <div class="grid">
      <div class="metric"><div class="k">RSI (14)</div><div class="v">${rsiL!=null?rsiL.toFixed(1):"—"}</div></div>
      <div class="metric"><div class="k">MACD 柱</div><div class="v ${mH>=0?"up":"dn"}">${mH.toFixed(2)}</div></div>
      <div class="metric"><div class="k">布林通道</div><div class="v sm">${bbL!=null?bbL.toFixed(0)+" – "+bbU.toFixed(0):"—"}</div></div>
      <div class="metric"><div class="k">量比</div><div class="v">${vr.toFixed(2)}x</div></div>
    </div>
    <div class="verdict ${vd[1]}">綜合：${vd[0]}（${sig.join("；")||"無明顯訊號"}）</div>
    <div class="alert-box">
      <div class="k">⚠️ 價格警報 ${al[sym]?"（已設：$"+al[sym].toFixed(2)+"）":""}</div>
      <div class="alert-row"><input type="number" id="alert-px" placeholder="例如 ${last.toFixed(0)}" step="0.01"><button onclick="setAlert('${sym}')">設定</button>${al[sym]?`<button class="ghost" onclick="clearAlert('${sym}')">清除</button>`:""}</div>
      <div class="hint">升穿／跌穿目標價嗰陣，瀏覽器會彈通知（要允許通知權限）</div>
    </div>
  </div>
  <div class="card">
    <h2>📰 近期新聞 <span class="cn">（情緒 ${aS>=0?"+":""}${aS.toFixed(1)}）</span></h2>
    ${news.length?news.map(n=>{
      const c=n.s>0?"sent-pos":n.s<0?"sent-neg":"sent-neu", t=n.s>0?"偏好":n.s<0?"偏淡":"中性";
      let d=""; try{ d=new Date(n.p).toLocaleDateString("zh-HK"); }catch(e){}
      return `<div class="news-item"><a href="${n.l}" target="_blank" rel="noopener">${n.t}</a><span class="sent ${c}">${t}</span><div class="meta">${n.s} · ${d}</div></div>`;
    }).join(""):'<div class="meta">暫時冇新聞</div>'}
  </div>`;
  drawChart($("dchart"),closes,s20,s50);
  $("detail").scrollIntoView();
}
function updateDetailPrice(sym,px){
  const s=DATA.stocks[sym]; if(!s) return;
  const prev=s.prices[s.prices.length-2].c, chg=px-prev, cp=chg/prev*100;
  const e1=$("d-px"), e2=$("d-chg");
  if(e1) e1.textContent="$"+px.toFixed(2);
  if(e2){ e2.textContent=`${chg>=0?"+":""}${chg.toFixed(2)} (${cp>=0?"+":""}${cp.toFixed(2)}%)`; e2.className=chg>=0?"up":"dn"; e2.style.fontSize="20px"; }
}
function closeDetail(){ currentDetail=null; $("detail").innerHTML=""; window.scrollTo(0,0); }
function drawChart(cv,closes,a20,a50){
  const ctx=cv.getContext("2d"), W=cv.width=cv.offsetWidth*2, H=cv.height=260*2;
  const vs=closes.filter(v=>v!=null), mn=Math.min(...vs), mx=Math.max(...vs), pd=(mx-mn)*0.1||1;
  const X=i=>10+i/(closes.length-1)*(W-20), Y=v=>H-10-(v-mn+pd)/(mx-mn+2*pd)*(H-20);
  ctx.strokeStyle="#2a3348";ctx.lineWidth=1;
  for(let g=0;g<4;g++){const y=10+g*(H-20)/3;ctx.beginPath();ctx.moveTo(10,y);ctx.lineTo(W-10,y);ctx.stroke();}
  const ln=(a,c,w)=>{ctx.strokeStyle=c;ctx.lineWidth=w;ctx.beginPath();let st=false;a.forEach((v,i)=>{if(v==null)return;if(!st){ctx.moveTo(X(i),Y(v));st=true;}else ctx.lineTo(X(i),Y(v));});ctx.stroke();};
  ln(a50,"#8b93a7",2);ln(a20,"#f0b429",2);ln(closes,"#2f7cf6",3);
  ctx.fillStyle="#8b93a7";ctx.font="20px sans-serif";ctx.fillText(mx.toFixed(0),14,28);ctx.fillText(mn.toFixed(0),14,H-14);
}

// ---- 警報 ----
function setAlert(sym){
  const v=parseFloat($("alert-px").value); if(!v||v<=0){alert("輸入有效價格");return;}
  const al=store.get("alerts",{}); al[sym]=v; store.set("alerts",al);
  if(Notification.permission==="default") Notification.requestPermission();
  openDetail(sym);
}
function clearAlert(sym){ const al=store.get("alerts",{}); delete al[sym]; store.set("alerts",al); openDetail(sym); }
function checkAlerts(sym,px){
  const al=store.get("alerts",{}); const tgt=al[sym]; if(!tgt) return;
  const pc=getPrevClose(sym); if(!pc) return;
  const wasAbove=store.get("alert_state",{})[sym];
  const isAbove=px>=tgt;
  if(wasAbove!==undefined&&wasAbove!==isAbove){
    const dir=isAbove?"升穿":"跌穿";
    if(Notification.permission==="granted") new Notification(`${sym} ${dir} $${tgt.toFixed(2)}`,{body:`現價 $${px.toFixed(2)}`});
    else alert(`${sym} ${dir} $${tgt.toFixed(2)}！現價 $${px.toFixed(2)}`);
  }
  const st=store.get("alert_state",{}); st[sym]=isAbove; store.set("alert_state",st);
}

// ---- 設定 ----
function saveKey(){
  const v=$("fh-key").value.trim();
  if(!v){ alert("請輸入 key"); return; }
  store.set("finnhub_key",v); $("fh-key").value="";
  renderKeyStatus(); connectWS();
}
function clearKey(){ localStorage.removeItem("siw_finnhub_key"); if(ws)try{ws.close();}catch(e){} wsConnected=false; renderKeyStatus(); setWsStatus("未連接（未設定 key）"); }
function renderKeyStatus(){
  const k=store.get("finnhub_key","");
  $("key-status").innerHTML=k?`已連接 ····${k.slice(-4)} <button class="ghost" onclick="clearKey()">清除</button>`:"未設定";
}

// ---- 初始化 ----
async function init(){
  try{
    DATA=await(await fetch("data.json")).json();
    $("updated").textContent=DATA.updated;
    renderIndices(); renderWatchlist(); renderKeyStatus(); connectWS();
    if(Notification.permission==="default"){ /* 唔主動問，等設警報先問 */ }
  }catch(e){ $("watchlist-body").innerHTML='<div class="loading">載入數據失敗，稍後再試。</div>'; }
}
document.addEventListener("DOMContentLoaded",init);
