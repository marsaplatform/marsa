---
title: احمِ خادم MCP بمفاتيح مساحات
summary: فعّل «طلب مفاتيح API» لوركر، ووزّع مفاتيح لكل مستخدم بحدود معدّل وقائمة أدوات، وتحقق منها بمساعد من ٤٠ سطرًا.
version: 2
updated: 2026-10-21
tags: mcp, workers, security, keys
order: 5
---
## الهدف

ألّا يستدعي خادم MCP (أو أي وركر للفريق) إلا من أعطيتموه مفتاحًا، ولكل مفتاح حدّه (في الدقيقة واليوم) وأدواته المسموحة وانتهاؤه وإحصاءات استخدامه وإلغاؤه بنقرة. تحفظ مساحات المفاتيح (مُجزّأة) وتعدّ الاستخدام، والوركر يسألها في كل طلب.

## متى تستخدمها

- خادمكم يستدعي مصادر مدفوعة أو محدودة، أو تريدون معرفة من يستخدمه.
- تريدون المشاركة مع شركاء دون فتحه للإنترنت كله.

## كيف تعمل

1. تفعّلون **طلب مفاتيح API** للوركر (الفريق ← الوركرات ← *مفاتيح API*، أو عبر الـ API). تضيف مساحات سرّين للوركر: `MARSA_KEYS_URL` (عنوان التحقق) و`MARSA_KEYS_SECRET` (رمز تحقق خاص بالوركر لا يظهر لأحد).
2. تنشئون مفاتيح لمستخدميكم (`msk_…` تظهر مرة واحدة وتُحفظ مُجزّأة). لكل مفتاح حدوده الخاصة (وإلا فحدود الوركر الافتراضية) وانتهاء وقائمة أدوات.
3. يقرأ الوركر مفتاح المتصل (`Authorization: Bearer msk_…` أو `X-Api-Key`) ويرسل `POST $MARSA_KEYS_URL` بـ `{key, tool, uses}`. ترد مساحات بـ `allow` و`status` (200/401/403/429) و`remaining` و`tools` وتعدّ الطلب.
4. افتراضيًا يسأل المساعد مساحات في **كل** طلب، فالحدود دقيقة. التخزين المؤقت اختياري: `requireKey(request, env, { cache: 30 })` يحفظ السماح حتى ٣٠ ثانية (دون تجاوز حصة الدقيقة أو `cacheSeconds` من مساحات) ويبلّغ عن الاستخدامات المخزّنة في الفحص التالي.

**حدود بصراحة:** العدّ في خادم مساحات (في الذاكرة ويُحفظ كل ~١٥ ثانية)، فإعادة تشغيل مساحات قد تُفقد ثوانيَ من العدّ. إن فعّلتم التخزين المؤقت فلكل نسخة (isolate) من الوركر ذاكرتها، وقد يشغّل Cloudflare عدة نسخ في وقت واحد، فقد يتجاوز المفتاح حد الدقيقة بمقدار ما تبقّى من حصته في كل نسخة خلال نافذة التخزين (في اختبار حيّ بحد ٣ في الدقيقة مرّ ٤–٥ طلبات قبل رسائل 429). وإن تعذّر الوصول لمساحات يرفض المساعد (503) إلا إذا مرّرتم `failOpen: true`.

## الخطوات

1. انشروا وركر MCP كالمعتاد (راجعوا وصفة *خادم MCP على وركر في مساحات*).
2. أضيفوا المساعد إلى الكود (بلا اعتماديات):
   ```sh
   curl -s https://marsa.example.com/api/keys/helper.v2.js > marsa-keys.js
   cat marsa-keys.js worker.js > bundle.js
   ```
3. استدعوا `requireKey()` في بداية `/mcp` (ومرّروا اسم الأداة في `tools/call` لتطبيق قوائم الأدوات).
4. أعيدوا النشر، ثم فعّلوا **طلب مفاتيح API** واضبطوا الحدود الافتراضية (مثلًا ٦٠ في الدقيقة و٥٠٠٠ في اليوم).
5. أنشئوا مفتاحًا لكل مستخدم (اسم وبريد اختياري)، وأرسلوه له بشكل خاص، واطلبوا منه إرساله كـ `Authorization: Bearer <key>`.
6. راقبوا الاستخدام (طلبات اليوم و٧ أيام، آخر استخدام، عدد 429) في تبويب مفاتيح API. تُبلغ مساحات المالكين عند إنشاء مفتاح أو إلغائه وعند ارتفاع 429 (١٠ و١٠٠ و١٠٠٠ في اليوم).

ما يقابلها في الـ API (مفتاح الفريق أو مفتاح وكيل بصلاحية `workers:deploy`، والقراءة تحتاج `workers:read`):

```sh
T=https://marsa.example.com/api/teams/<team>/workers/<name>
curl -s -X PUT  $T/keys/settings -H "X-Team-Key: $K" -H 'content-type: application/json' -d '{"required":true,"perMinute":60,"perDay":5000}'
curl -s -X POST $T/keys -H "X-Team-Key: $K" -H 'content-type: application/json' -d '{"label":"Partner A","expiresInDays":90,"perMinute":30,"tools":["search_items"]}'
curl -s        $T/keys -H "X-Team-Key: $K"
curl -s -X DELETE $T/keys/<keyId> -H "X-Team-Key: $K"
```

وفي MCP المساحة الأدوات نفسها: `list_user_keys` و`create_user_key` و`revoke_user_key`.

## القالب

```js
// worker.js (after the helper from /api/keys/helper.v2.js)
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const msg = await request.clone().json().catch(() => null);
    const tool = msg?.method === "tools/call" ? String(msg.params?.name ?? "") : "";
    const gate = await requireKey(request, env, { tool });
    if (!gate.ok) return gate.response; // 401 no/invalid/revoked/expired key, 403 tool not allowed, 429 over limit
    return handleMcp(msg, env, gate.keyId); // your JSON-RPC handler
  },
};
```

## قائمة التحقق قبل النشر

- [ ] المساعد داخل الحزمة، و`/mcp` يستدعي `requireKey()` قبل أي عمل.
- [ ] ‏`tools/call` يمرر اسم الأداة.
- [ ] «طلب مفاتيح API» مفعّل والحدود الافتراضية مضبوطة.
- [ ] حيًّا: بلا مفتاح ← 401، مفتاح صالح ← 200، تجاوز الحد ← 429، مفتاح ملغى ← 401.
- [ ] أُرسلت المفاتيح بشكل خاص ولا تظهر في الكود أو المتغيرات أو الصفحات أو المحادثات.

## أخطاء شائعة

- **تفعيل المفاتيح قبل نشر المساعد**: الوركر ما زال يجيب الجميع (لا تستطيع مساحات منع طلبات لا يفحصها الوركر).
- **فحص المفتاح بعد تنفيذ العمل**: افحصوا أولًا دائمًا.
- **تسجيل ترويسة `Authorization`** في الوركر: لا تسجّلوا المفاتيح أبدًا.
- **تفعيل `cache` مع توقع عدّ دقيق**: اتركوا `cache` مطفأً (الافتراضي) حين يجب أن يكون الحد دقيقًا، واستخدموا `{ cache: 30 }` فقط لوركر كثير الطلبات يتحمّل بعض التجاوز.
- **استخدام نسخة قديمة من المساعد** (من `/api/keys/helper.js` قبل 0.14.1): كانت تخزّن افتراضيًا. نزّلوا `/api/keys/helper.v2.js` من جديد.
- **`failOpen: true`** على شيء مكلف: إن تعذّر الوصول لمساحات يدخل الجميع.
