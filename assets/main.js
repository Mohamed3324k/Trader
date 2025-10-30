// ===== Helpers =====
const $ = (id)=>document.getElementById(id);
const toggles = ()=>[...document.querySelectorAll('.toggle')].reduce((a,t)=>{a[t.dataset.key]=t.checked;return a;},{});
const toNum = (v)=>Number(v ?? 0);

// ===== Parsers =====
function parseCSV(text){
  const lines = text.trim().split(/\r?\n/);
  let rows = []; let start = 0;
  const head = lines[0]?.toLowerCase() || '';
  if(head.includes('time') && head.includes('open')) start = 1;
  for(let i=start;i<lines.length;i++){
    const p = lines[i].split(',');
    if(p.length<5) continue;
    rows.push({ time:p[0], open:toNum(p[1]), high:toNum(p[2]), low:toNum(p[3]), close:toNum(p[4]) });
  }
  return rows;
}
function parseJSON(text){
  const data = JSON.parse(text);
  if(Array.isArray(data)) return data.map(d=>({time:d.time,open:toNum(d.open),high:toNum(d.high),low:toNum(d.low),close:toNum(d.close)}));
  if(Array.isArray(data.candles)) return data.candles.map(d=>({time:d.time,open:toNum(d.open),high:toNum(d.high),low:toNum(d.low),close:toNum(d.close)}));
  return [];
}

// ===== Indicators =====
function ema(values, period){
  const k = 2/(period+1);
  const out = []; let emaPrev = values[0];
  out.push(emaPrev);
  for(let i=1;i<values.length;i++){ emaPrev = values[i]*k + emaPrev*(1-k); out.push(emaPrev); }
  return out;
}
function rsi(values, period=14){
  const out = Array(values.length).fill(null);
  let gains=0, losses=0;
  for(let i=1;i<=period;i++){ const d=values[i]-values[i-1]; gains+=Math.max(0,d); losses+=Math.max(0,-d); }
  let avgGain=gains/period, avgLoss=losses/period;
  let rs = avgGain/Math.max(1e-9,avgLoss); out[period]=100-100/(1+rs);
  for(let i=period+1;i<values.length;i++){
    const d=values[i]-values[i-1], g=Math.max(0,d), l=Math.max(0,-d);
    avgGain=(avgGain*(period-1)+g)/period; avgLoss=(avgLoss*(period-1)+l)/period;
    rs=avgGain/Math.max(1e-9,avgLoss); out[i]=100-100/(1+rs);
  }
  return out;
}
function cci(high, low, close, period=20){
  const tp = high.map((h,i)=>(h+low[i]+close[i])/3);
  const out = Array(tp.length).fill(null);
  for(let i=period-1;i<tp.length;i++){
    const s = tp.slice(i-period+1,i+1);
    const sma = s.reduce((a,b)=>a+b,0)/period;
    const md = s.reduce((m,v)=>m+Math.abs(v-sma),0)/period;
    out[i] = (tp[i]-sma)/(0.015*Math.max(1e-9,md));
  }
  return out;
}
function isDoji(o,h,l,c){ const body=Math.abs(c-o), range=Math.max(1e-9,h-l); return body/range<0.1; }
function momentumOk(closes, len=3){
  const n=closes.length; if(n<len+1) return false;
  const last=closes.slice(-len-1); let ups=0,downs=0;
  for(let i=1;i<last.length;i++){ if(last[i]>last[i-1]) ups++; if(last[i]<last[i-1]) downs++; }
  return ups===len || downs===len;
}
function priceActionSignal(last2){
  if(last2.length<2) return null;
  const [p,c]=last2;
  const bull = c.close>c.open && p.close<p.open && c.close>=p.open && c.open<=p.close;
  const bear = c.close<c.open && p.close>p.open && c.open>=p.close && c.close<=p.open;
  if(bull) return 'buy'; if(bear) return 'sell'; return null;
}
function pivotHighIdx(highs, left=2, right=2){
  const n=highs.length, piv=Array(n).fill(false);
  for(let i=left;i<n-right;i++){
    let ok=true;
    for(let j=1;j<=left;j++) if(!(highs[i]>highs[i-j])) ok=false;
    for(let j=1;j<=right;j++) if(!(highs[i]>highs[i+j])) ok=false;
    if(ok) piv[i]=true;
  } return piv;
}
function pivotLowIdx(lows, left=2, right=2){
  const n=lows.length, piv=Array(n).fill(false);
  for(let i=left;i<n-right;i++){
    let ok=true;
    for(let j=1;j<=left;j++) if(!(lows[i]<lows[i-j])) ok=false;
    for(let j=1;j<=right;j++) if(!(lows[i]<lows[i+j])) ok=false;
    if(ok) piv[i]=true;
  } return piv;
}

// ===== Core analysis (rules engine fallback) =====
function analyze(candles, opts){
  const opens=candles.map(c=>c.open), highs=candles.map(c=>c.high), lows=candles.map(c=>c.low), closes=candles.map(c=>c.close);
  const ema5 = ema(closes,5), ema100 = ema(closes,100);
  const r = rsi(closes,14), cc = cci(highs,lows,closes,20);
  const pivH=pivotHighIdx(highs), pivL=pivotLowIdx(lows);
  const i=candles.length-1, last=candles[i], prev=candles[i-1];
  const trendUp = ema5[i]>ema100[i], trendDown=ema5[i]<ema100[i];

  let score=0, maxScore=0, reasons=[];

  if(opts.trend){ maxScore++; if(trendUp||trendDown){score++; reasons.push(trendUp?'اتجاه صاعد (EMA5>EMA100)':'اتجاه هابط (EMA5<EMA100)');} else reasons.push('اتجاه جانبي'); }
  if(opts.dojiFilter){ maxScore++; const doji=isDoji(last.open,last.high,last.low,last.close); if(!doji){score++; reasons.push('ليست دوجي');} else reasons.push('دوجي — فلتر حذر'); }
  if(opts.momentum){ maxScore++; const mom=momentumOk(closes,3); if(mom){score++; reasons.push('مومنتم متسق 3 شمعات');} else reasons.push('مومنتم ضعيف'); }

  let rsiBias=null, cciBias=null;
  if(opts.rsi){ maxScore++; const rv=r[i]??50; if(trendUp && rv>50){score++; rsiBias='buy'; reasons.push('RSI>50 مع اتجاه صاعد');} else if(trendDown && rv<50){score++; rsiBias='sell'; reasons.push('RSI<50 مع اتجاه هابط');} else reasons.push('RSI حيادي'); }
  if(opts.cci){ maxScore++; const cv=cc[i]??0; if(trendUp && cv>0){score++; cciBias='buy'; reasons.push('CCI>0 في اتجاه صاعد');} else if(trendDown && cv<0){score++; cciBias='sell'; reasons.push('CCI<0 في اتجاه هابط');} else reasons.push('CCI حيادي'); }

  if(opts.scalping){ maxScore++; const dist=Math.abs(last.close-ema100[i])/Math.max(1e-9,ema100[i]); if(dist<0.003){score++; reasons.push('سعر قريب من EMA100 (سكالبنج)');} else reasons.push('سعر بعيد عن EMA100'); }
  if(opts.pivots){ maxScore++; if(pivL[i-1] && trendUp){score++; reasons.push('Pivot Low قريب مع اتجاه صاعد');} else if(pivH[i-1] && trendDown){score++; reasons.push('Pivot High قريب مع اتجاه هابط');} else reasons.push('لا Pivot داعم قريب'); }

  let pa=null;
  if(opts.priceAction){ maxScore++; pa=priceActionSignal([prev,last]); if(pa){score++; reasons.push('Price Action: '+(pa==='buy'?'ابتلاع شرائي':'ابتلاع بيعي'));} else reasons.push('لا نموذج ابتلاع واضح'); }

  let decision='no-trade'; let directionBias=null;
  if(trendUp) directionBias='buy'; else if(trendDown) directionBias='sell';
  const agreesBuy=[rsiBias==='buy', cciBias==='buy', pa==='buy'].filter(Boolean).length;
  const agreesSell=[rsiBias==='sell', cciBias==='sell', pa==='sell'].filter(Boolean).length;
  if(directionBias==='buy' && agreesBuy>=1) decision='buy';
  else if(directionBias==='sell' && agreesSell>=1) decision='sell';
  const confidence = Math.round((score/Math.max(1,maxScore))*100);
  return { decision, confidence,
    trend: trendUp?'صاعد':(trendDown?'هابط':'جانبي'),
    rsi: Math.round((r[i]??0)*10)/10,
    cci: Math.round((cc[i]??0)),
    ema5: Math.round(ema5[i]*1000)/1000,
    ema100: Math.round(ema100[i]*1000)/1000,
    reasons };
}

// ===== Progress bar =====
function startProgress(seconds=10){
  const bar = $('bar'); const eta=$('eta'); const status=$('status');
  bar.style.width='0%'; let elapsed=0; status.textContent='يجري التحليل…';
  return new Promise(resolve=>{
    const int=setInterval(()=>{
      elapsed+=0.25;
      const pct=Math.min(100,Math.round((elapsed/seconds)*100));
      bar.style.width=pct+'%'; eta.textContent='≈ '+Math.max(0,Math.ceil(seconds-elapsed))+'s';
      if(pct>=100){clearInterval(int); resolve();}
    },250);
  });
}

// ===== Frontend orchestrator =====
async function handleCandles(candles){
  if(candles.length<120){ $('status').innerHTML='الملف يحتاج <b>≥120</b> شمعة دقيقة للحسابات.'; return; }
  await startProgress(10);
  const opts=toggles();
  // Try backend AI first; fallback to local rules
  let result=null;
  try{
    const res = await fetch('/api/analyze', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ candles, opts })});
    if(res.ok){ result = await res.json(); }
  }catch(e){ /* ignore */ }
  if(!result){ result = analyze(candles, opts); }
  if(opts.trend){
    if(result.decision==='buy' && result.trend!=='صاعد') result.decision='no-trade';
    if(result.decision==='sell' && result.trend!=='هابط') result.decision='no-trade';
  }
  renderResult(result);
}

function renderResult(res){
  const badge=$('decisionBadge'); badge.className='badge';
  if(res.decision==='buy'){ badge.textContent='شراء'; badge.style.background='rgba(16,185,129,.15)'; badge.style.border='1px solid rgba(16,185,129,.3)'; }
  else if(res.decision==='sell'){ badge.textContent='بيع'; badge.style.background='rgba(244,63,94,.15)'; badge.style.border='1px solid rgba(244,63,94,.3)'; }
  else { badge.textContent='لا تداول'; }
  $('confidence').textContent=res.confidence;
  $('trend').textContent=res.trend;
  $('rsi').textContent=Number.isFinite(res.rsi)?res.rsi:'—';
  $('cci').textContent=Number.isFinite(res.cci)?res.cci:'—';
  $('emas').textContent=`${res.ema5} / ${res.ema100}`;
  $('rules').innerHTML='<b>أسباب القرار:</b><br>• '+res.reasons.join('<br>• ');
  $('resultCard').classList.remove('hidden');
  $('status').textContent='اكتمل التحليل.';
}

// ===== Events =====
$('fileInput').addEventListener('change', async (e)=>{
  const file=e.target.files?.[0]; if(!file) return;
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(['csv','txt'].includes(ext)){ const text=await file.text(); return handleCandles(parseCSV(text)); }
  if(['json'].includes(ext)){ const text=await file.text(); return handleCandles(parseJSON(text)); }
  if(['png','jpg','jpeg'].includes(ext)){
    await startProgress(10);
    let candles=null;
    try{
      const form=new FormData(); form.append('image', file);
      const res = await fetch('/api/extract', { method:'POST', body:form });
      if(res.ok){ const data=await res.json(); candles=data.candles; }
    }catch(e){ /* ignore */ }
    if(!candles){
      const seed=[...file.name].reduce((a,c)=>a+c.charCodeAt(0),0);
      const base=100+(seed%20);
      candles=Array.from({length:180},(_,i)=>({time:i,open:base+Math.sin(i/7),high:base+2+Math.sin(i/5),low:base-2+Math.sin(i/9),close:base+Math.sin(i/6)}));
    }
    return handleCandles(candles);
  }
});

$('sampleBtn').addEventListener('click', ()=>{
  const header='time,open,high,low,close\n';
  let t=Date.now()-240*60*1000, rows=[], price=100;
  for(let i=0;i<240;i++){
    const o=price, dir=Math.sin(i/20)+Math.cos(i/37), delta=(Math.random()-0.5)*0.15 + dir*0.06;
    let h=o+Math.abs(delta)*1.5 + Math.random()*0.05, l=o-Math.abs(delta)*1.5 - Math.random()*0.05;
    const c=o+delta; price=c;
    rows.push(`${new Date(t).toISOString()},${o.toFixed(5)},${h.toFixed(5)},${l.toFixed(5)},${c.toFixed(5)}`);
    t+=60*1000;
  }
  const blob=new Blob([header+rows.join('\n')],{type:'text/csv'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a');
  a.href=url; a.download='moot-minute-sample.csv'; a.click(); URL.revokeObjectURL(url);
});

$('year').textContent=new Date().getFullYear();
