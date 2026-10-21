---
title: استخدام KV والملفات في الموقع
summary: خزّن JSON صغيرًا وملفات مرفوعة بجوار صفحة منشورة: الحدود، تصميم المفاتيح، مكتبة المتصفح، وإعادة المحاولة عند 503 BACKEND_UNAVAILABLE.
version: 1
updated: 2026-10-21
tags: kv, files, sites
order: 4
---
## الهدف

أن تحصل صفحة ثابتة أو وكيل على مخزن بيانات صغير ودائم: قيم JSON في **KV الموقع** وملفات مرفوعة في **ملفات الموقع**، كلاهما خاص بموقع واحد ومدعوم بـ Workers KV وR2 من Cloudflare.

## متى تستخدمها

- صفحة تحتاج حالة: عدّاد، قائمة تسجيل ستصدّرونها، خلاصة مخزّنة، إعدادات يحدّثها الوكيل.
- وكيل ينشر تقريرًا ويرفق ملفات المصدر.
- لا تناسب: البيانات الكبيرة، والبيانات الخاصة (القراءة عامة افتراضيًا)، ومعدلات الكتابة العالية (KV يقبل كتابة واحدة تقريبًا في الثانية لكل مفتاح).

## الخطوات

1. **تأكدوا أنها مفعّلة:** يجب أن يكون الموقع لفريق فُعّلت له الخدمة الخلفية. ‏`GET /api/sites/<id>/kv` يجب أن يرد 200 لا `403 BACKEND_NOT_ALLOWED`.
2. **اعرفوا الحدود:** القيمة حتى ٦٤ ك.ب من JSON، و١٠٠٠ مفتاح و١٠٠ ملف لكل موقع، والمفاتيح ١–١٢٨ حرفًا من `A-Z a-z 0-9 . _ : -`. حد Cloudflare (١٢٠٠ طلب كل ٥ دقائق للمنصة كلها) مشترك بين كل المواقع.
3. **صمّموا المفاتيح كمسارات:** ‏`config` و`feed:latest` و`items:2026-10-21`. قيمة واحدة لكل ما يُقرأ معًا؛ لا قائمة تكبر بلا حد في مفتاح واحد، ولا مفتاح لكل زيارة.
4. **اقرؤوا من الصفحة** بمكتبة المتصفح (لا رمز للقراءة):
   ```html
   <!-- inside your published site: /sdk.js knows which site it is on -->
   <script src="/sdk.js"></script>
   <script>
     marsa.kv.get("config").then((cfg) => { /* render */ }).catch(() => { /* show "temporarily unavailable" */ });
   </script>
   ```
5. **اكتبوا من وكيل أو سكربت** برمز التعديل للموقع (أو مفتاح فريق/وكيل بصلاحية `kv:write`)، لا من الصفحة العامة:
   ```sh
   curl -s -X PUT "https://marsa.example.com/api/sites/<id>/kv/config" \
     -H "Authorization: Bearer $MARSA_EDIT_TOKEN" -H "Content-Type: application/json" \
     -d '{"value": {"title": "Weekly feed", "updated": "2026-10-21"}}'
   ```
6. **أعيدوا المحاولة عند 503.** إن تعذّر الوصول للتخزين ترد مساحات بـ `503 BACKEND_UNAVAILABLE` (مع `Retry-After`). هذا مؤقت: أعيدوا المحاولة بتباعد متزايد (١ ث، ٢ ث، ٤ ث، ٣–٤ مرات) ثم اعرضوا رسالة لطيفة وأبقوا الصفحة تعمل. ‏`429 RATE_LIMITED` يعني أبطِئوا واحترموا `Retry-After`.
7. **الملفات:** ارفعوا بـ `POST /api/sites/<id>/files` (حقل `file`)، واعرضوا القائمة بـ `GET …/files`، واربطوا بالـ `url` المُعاد. احذفوا ما لم تعودوا تحتاجونه.

## القالب

```js
// kv.js: tiny client with retries for 503/429 (Node 18+, Deno, Workers)
const BASE = "https://marsa.example.com/api/sites";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function kv(site, method, key, value, token) {
  const url = `${BASE}/${site}/kv/${encodeURIComponent(key)}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        "user-agent": "my-agent/1.0",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(value !== undefined ? { body: JSON.stringify({ value }) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 503 || res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
      await sleep(Math.min(wait, 10_000));
      continue;
    }
    if (res.status === 404 && method === "GET") return null;
    if (!res.ok) throw new Error(`KV ${method} ${key}: ${res.status} ${await res.text()}`);
    return method === "GET" ? (await res.json()).value : true;
  }
  throw new Error("storage temporarily unavailable (503), try again later");
}

// usage:
// await kv("<id>", "PUT", "feed:latest", { items: [...] }, process.env.MARSA_EDIT_TOKEN);
// const feed = await kv("<id>", "GET", "feed:latest");
```

## قائمة التحقق قبل النشر

- [ ] ‏`GET /api/sites/<id>/kv` يرد 200.
- [ ] لا رمز في الصفحة المنشورة؛ الكتابة من وكيل أو سكربت.
- [ ] لا شيء خاص مخزّن (القراءة عامة افتراضيًا).
- [ ] كل قيمة أصغر بكثير من ٦٤ ك.ب، وعدد المفاتيح محدود.
- [ ] القراءة والكتابة تعيدان المحاولة عند 503/429، وللصفحة رسالة بديلة.
- [ ] المهمة التي تنشئ المفاتيح/الملفات القديمة تحذفها.

## أخطاء شائعة

- **مفتاح واحد يكبر دائمًا** يصل إلى `VALUE_TOO_LARGE`؛ قسّموا بالتاريخ.
- **مفتاح لكل زائر أو حدث** يصل إلى `TOO_MANY_KEYS`؛ اجمعوا.
- **كتابة المفتاح نفسه مرات كثيرة في الثانية**: اجمعوا الكتابات.
- **رمز التعديل في JavaScript الصفحة**: أي أحد يستطيع الكتابة فوق بياناتكم أو حذفها.
- **اعتبار 503 خطأ نهائيًا**: انقطاع التخزين يحدث؛ أعيدوا المحاولة وتراجعوا بلطف.
- **توقع قراءة فورية في كل مكان**: KV متسق في النهاية؛ قد تتأخر القيمة الجديدة حتى ٦٠ ثانية تقريبًا.
