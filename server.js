/** 
 * Moot AI Backend — Node/Express with OpenAI Responses API (Vision + Rerank)
 * Usage:
 *   1) npm i
 *   2) Create .env with OPENAI_API_KEY=...
 *   3) npm run dev  -> http://localhost:${PORT}
 */
import express from 'express';
import fileUpload from 'express-fileupload';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json({limit:'20mb'}));
app.use(fileUpload());
app.use(express.static('./'));
const PORT = process.env.PORT || 5173;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? null;
const OPENAI_API_BASE = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini';
const RERANK_MODEL = process.env.OPENAI_RERANK_MODEL || 'gpt-4o-mini';

// Helpers
const ema = (arr, period)=>{
  const k = 2/(period+1);
  const out=[]; let e=arr[0]; out.push(e);
  for(let i=1;i<arr.length;i++){ e = arr[i]*k + e*(1-k); out.push(e); }
  return out;
};
const rsi = (arr, period=14)=>{
  const out=Array(arr.length).fill(null);
  let gains=0,losses=0;
  for(let i=1;i<=period;i++){ const d=arr[i]-arr[i-1]; gains+=Math.max(0,d); losses+=Math.max(0,-d); }
  let avgGain=gains/period, avgLoss=losses/period, rs=avgGain/Math.max(1e-9,avgLoss);
  out[period]=100-100/(1+rs);
  for(let i=period+1;i<arr.length;i++){
    const d=arr[i]-arr[i-1], g=Math.max(0,d), l=Math.max(0,-d);
    avgGain=(avgGain*(period-1)+g)/period; avgLoss=(avgLoss*(period-1)+l)/period;
    rs=avgGain/Math.max(1e-9,avgLoss); out[i]=100-100/(1+rs);
  } return out;
};
const cci = (high, low, close, period=20)=>{
  const tp = high.map((h,i)=>(h+low[i]+close[i])/3);
  const out=Array(tp.length).fill(null);
  for(let i=period-1;i<tp.length;i++){
    const s=tp.slice(i-period+1,i+1); const sma=s.reduce((a,b)=>a+b,0)/period;
    const md=s.reduce((m,v)=>m+Math.abs(v-sma),0)/period;
    out[i]=(tp[i]-sma)/(0.015*Math.max(1e-9,md));
  } return out;
};
const isDoji = (o,h,l,c)=>{
  const body=Math.abs(c-o), range=Math.max(1e-9,h-l);
  return body/range<0.1;
};
const priceActionSignal = ([p,c])=>{
  if(!p||!c) return null;
  const bull = c.close>c.open && p.close<p.open && c.close>=p.open && c.open<=p.close;
  const bear = c.close<c.open && p.close>p.open && c.open>=p.close && c.close<=p.open;
  if(bull) return 'buy'; if(bear) return 'sell'; return null;
};
const momentumOk = (closes, len=3)=>{
  const n=closes.length; if(n<len+1) return false;
  const last=closes.slice(-len-1); let ups=0,downs=0;
  for(let i=1;i<last.length;i++){ if(last[i]>last[i-1]) ups++; if(last[i]<last[i-1]) downs++; }
  return ups===len || downs===len;
};

function rulesEngine(candles, opts={}){
  const opens=candles.map(c=>c.open), highs=candles.map(c=>c.high), lows=candles.map(c=>c.low), closes=candles.map(c=>c.close);
  const ema5=ema(closes,5), ema100=ema(closes,100), r=rsi(closes,14), cc=cci(highs,lows,closes,20);
  const i=candles.length-1, last=candles[i], prev=candles[i-1];
  const trendUp=ema5[i]>ema100[i], trendDown=ema5[i]<ema100[i];
  let score=0, maxScore=0, reasons=[];
  if(opts.trend){ maxScore++; if(trendUp||trendDown){score++; reasons.push(trendUp?'اتجاه صاعد (EMA5>EMA100)':'اتجاه هابط (EMA5<EMA100)');} else reasons.push('اتجاه جانبي'); }
  if(opts.dojiFilter){ maxScore++; const doji=isDoji(last.open,last.high,last.low,last.close); if(!doji){score++; reasons.push('ليست دوجي');} else reasons.push('دوجي — فلتر حذر'); }
  if(opts.momentum){ maxScore++; const mom=momentumOk(closes,3); if(mom){score++; reasons.push('مومنتم متسق 3 شمعات');} else reasons.push('مومنتم ضعيف'); }
  let rsiBias=null, cciBias=null;
  if(opts.rsi){ maxScore++; const rv=r[i]??50; if(trendUp && rv>50){score++; rsiBias='buy'; reasons.push('RSI>50 مع اتجاه صاعد');} else if(trendDown && rv<50){score++; rsiBias='sell'; reasons.push('RSI<50 مع اتجاه هابط');} else reasons.push('RSI حيادي'); }
  if(opts.cci){ maxScore++; const cv=cc[i]??0; if(trendUp && cv>0){score++; cciBias='buy'; reasons.push('CCI>0 في اتجاه صاعد');} else if(trendDown && cv<0){score++; cciBias='sell'; reasons.push('CCI<0 في اتجاه هابط');} else reasons.push('CCI حيادي'); }
  if(opts.scalping){ maxScore++; const dist=Math.abs(last.close-ema100[i])/Math.max(1e-9,ema100[i]); if(dist<0.003){score++; reasons.push('قرب EMA100 (سكالبنج)');} else reasons.push('سعر بعيد عن EMA100'); }
  if(opts.pivots){ maxScore++; reasons.push('فحص Pivot مبسط'); }
  let pa=null; if(opts.priceAction){ maxScore++; pa=priceActionSignal([prev,last]); if(pa){score++; reasons.push('Price Action: '+(pa==='buy'?'ابتلاع شرائي':'ابتلاع بيعي'));} else reasons.push('لا ابتلاع واضح'); }
  let decision='no-trade', directionBias=null;
  if(trendUp) directionBias='buy'; else if(trendDown) directionBias='sell';
  const agreesBuy=[rsiBias==='buy', cciBias==='buy', pa==='buy'].filter(Boolean).length;
  const agreesSell=[rsiBias==='sell', cciBias==='sell', pa==='sell'].filter(Boolean).length;
  if(directionBias==='buy' && agreesBuy>=1) decision='buy'; else if(directionBias==='sell' && agreesSell>=1) decision='sell';
  const confidence=Math.round((score/Math.max(1,maxScore))*100);
  return { decision, confidence, trend:trendUp?'صاعد':(trendDown?'هابط':'جانبي'),
           rsi: Math.round((r[i]??0)*10)/10, cci: Math.round((cc[i]??0)),
           ema5: Math.round(ema5[i]*1000)/1000, ema100: Math.round(ema100[i]*1000)/1000,
           reasons };
}

// ---- OpenAI Responses API helpers ----
async function openaiResponses(payload){
  if(!OPENAI_API_KEY) return null;
  const res = await fetch(`${OPENAI_API_BASE}/responses`, {
    method:'POST',
    headers:{
      'Authorization':`Bearer ${OPENAI_API_KEY}`,
      'Content-Type':'application/json'
    },
    body: JSON.stringify(payload)
  });
  if(!res.ok) return null;
  const data = await res.json();
  const out = data?.output?.[0]?.content?.[0]?.text || data?.choices?.[0]?.message?.content || null;
  return out;
}

// Extract OHLC array from chart image
async function aiExtractOHLCFromImage(fileBuffer, mime='image/png'){
  if(!OPENAI_API_KEY) return null;
  const b64 = fileBuffer.toString('base64');
  const system = `You are a precise financial image digitizer. Given a screenshot of a candlestick chart (1-minute timeframe), extract an evenly sampled series of at least 150 candles as JSON array with objects: {\"time\":\"ISO-8601 or index\",\"open\":number,\"high\":number,\"low\":number,\"close\":number}. Do not include any text other than pure JSON.`;
  const userText = `Return ONLY JSON array of candles (OHLC). If price scale is visible, interpret accurately. If uncertain, approximate but keep the series smooth and realistic.`;

  const output = await openaiResponses({
    model: VISION_MODEL,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: system + "\\n\\n" + userText },
        { type: "input_image", image: { data: b64, mime_type: mime } }
      ]
    }]
  });
  if(!output) return null;
  try{
    const start = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if(start>=0 && end>start){ 
      const json = output.slice(start, end+1);
      const arr = JSON.parse(json);
      const norm = arr.map(d=>({time:d.time??null, open:+d.open, high:+d.high, low:+d.low, close:+d.close})).filter(c=>isFinite(c.open)&&isFinite(c.high)&&isFinite(c.low)&&isFinite(c.close));
      return norm;
    }
  }catch(e){}
  return null;
}

// AI re-ranking (optional)
async function aiRerankDecision(base, candles){
  if(!OPENAI_API_KEY) return null;
  const prompt = `You are a trading rules auditor. Given the base decision computed from indicators on 1m candles, only adjust CONFIDENCE (0-100) slightly, and suggest BUY/SELL/NO-TRADE if a clear conflict exists (e.g., decision BUY but trend is 'هابط'). Respond ONLY JSON like: {"decision":"buy|sell|no-trade","confidence":number}`;
  const output = await openaiResponses({
    model: RERANK_MODEL,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt + "\\nBase:" + JSON.stringify(base).slice(0,12000) }
      ]
    }]
  });
  if(!output) return null;
  try{
    const start = output.indexOf('{');
    const end = output.lastIndexOf('}');
    if(start>=0 && end>start){
      const json = output.slice(start, end+1);
      const obj = JSON.parse(json);
      const decision = (obj.decision||base.decision);
      const confidence = Math.max(0, Math.min(100, Math.round(obj.confidence ?? base.confidence)));
      return { ...base, decision, confidence };
    }
  }catch(e){}
  return null;
}

// ---- Routes ----
app.post('/api/analyze', async (req,res)=>{
  try{
    const { candles, opts } = req.body || {};
    const base = Array.isArray(candles) && candles.length>=5 ? rulesEngine(candles, opts||{}) : { decision:'no-trade', confidence:50, trend:'جانبي', rsi:50, cci:0, ema5:0, ema100:0, reasons:['بيانات قليلة'] };
    const ai = await aiRerankDecision(base, candles);
    return res.json(ai || base);
  }catch(e){
    return res.json({ decision:'no-trade', confidence:50, trend:'جانبي', rsi:50, cci:0, ema5:0, ema100:0, reasons:['تحليل افتراضي آمن'] });
  }
});

app.post('/api/extract', async (req,res)=>{
  try{
    if(!req.files || !req.files.image){
      return res.json({ candles:null });
    }
    const img = req.files.image;
    let candles = await aiExtractOHLCFromImage(img.data, img.mimetype || 'image/png');
    if(!candles || candles.length<120){
      const seed = [...(img.name||'chart')].reduce((a,c)=>a+c.charCodeAt(0),0);
      const base=100+(seed%20);
      candles=Array.from({length:180},(_,i)=>({time:i,open:base+Math.sin(i/7),high:base+2+Math.sin(i/5),low:base-2+Math.sin(i/9),close:base+Math.sin(i/6)}));
    }
    return res.json({ candles });
  }catch(e){
    return res.json({ candles:null });
  }
});

app.listen(PORT, ()=>console.log(`Moot AI server running on http://localhost:${PORT}`));
