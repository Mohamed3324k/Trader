# Moot AI — دقيقة واحدة قرار

واجهة + خادم Node لتحليل شارت فريم الدقيقة خلال ~10 ثوانٍ مع **دمج OpenAI (Vision + Reranker)**.

## الميزات
- رفع **CSV/JSON** أو **صورة شارت**.
- مؤشرات: **RSI(14)** / **EMA 5&100** / **CCI(20)** / **Pivots** / **Price Action** + فلاتر **الترند/الدوجي/المومنتم**.
- قرار: **شراء / بيع / لا تداول** + **نسبة ثقة** + **أسباب القرار**.
- **لا رسائل فشل** — في حال غياب الـ API، يعمل محرك قواعد محلي تلقائيًا.
- واجهات:
  - `POST /api/extract` (رؤية): استخراج OHLC من صورة الشارت.
  - `POST /api/analyze` (تحليل): إعادة وزن القرار عبر AI.

## التشغيل محليًا
```bash
npm i
cp .env.example .env   # ثم ضع OPENAI_API_KEY
npm run dev            # http://localhost:10000
```

## النشر على Render
- Environment: Node
- Build Command: `npm install`
- Start Command: `npm run dev`
- Environment Variables:
```
OPENAI_API_KEY=YOUR_KEY
OPENAI_VISION_MODEL=gpt-4o
OPENAI_RERANK_MODEL=gpt-4o
PORT=10000
```
- Free instance ✔️

## ملاحظات مهمة
- لا يوجد نموذج يضمن ربح دائم أو دقة 99% — يتم عرض **نسبة ثقة** فقط.
- لا تشارك مفتاحك علنًا. لا ترفع `.env` إلى GitHub.
