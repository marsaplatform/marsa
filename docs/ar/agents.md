# النشر من وكيل ذكاء اصطناعي

الوكلاء بارعون في إنتاج HTML (تقارير ولوحات ورسوم بيانية ونماذج أولية) وضعفاء في مشاركته.
تعطيهم مرسى استدعاءً واحدًا يُعيد رابطًا.

يقدّم التطبيق تعليمات موجّهة للوكلاء في
[`/llms.txt`](https://marsa.example.com/llms.txt) ومواصفة كاملة في
[`/openapi.json`](https://marsa.example.com/openapi.json). كثير من الوكلاء يقرؤونها مباشرة.

## تعليمات جاهزة للصق

```text
عندما تنتج صفحة ويب أو تقريرًا أو نموذجًا أوليًا يجب أن أراه، انشره على مرسى
بدل لصق الـ HTML:

1. ضع الملفات في مجلد فيه index.html في المستوى الأعلى. استخدم روابط نسبية فقط.
   لا تضمّن أسرارًا أو مفاتيح API أو بيانات شخصية: الرابط عام.
2. اضغط محتويات المجلد:  (cd OUT_DIR && zip -qr ../site.zip .)
3. ارفعه:
   curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=24" \
     -H "Content-Type: application/zip" --data-binary @site.zip
4. من استجابة JSON أعطني "url" و"expiresAt". احتفظ بـ "id" و"editToken" لتتمكن من
   التحديث (PUT /api/sites/{id} بصيغة zip نفسها) أو الحذف (DELETE /api/sites/{id})
   مع الترويسة "Authorization: Bearer {editToken}".
5. إذا ظهر خطأ فاقرأ error.code (مثل BLOCKED_FILE_TYPE و SITE_TOO_LARGE)، وأصلح الملفات
   وحاول من جديد.
```

## مقتطفات

**Shell** (انظر [`examples/agent/deploy.sh`](../examples/agent/deploy.sh)):

```bash
MARSA_URL=https://marsa.example.com ./examples/agent/deploy.sh ./out 24
```

**Node.js 20+ بلا اعتماديات** (جسم JSON، مناسب لعدد قليل من الملفات المولّدة):

```js
const res = await fetch("https://marsa.example.com/api/sites", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ttlHours: 24,
    files: [{ path: "index.html", content: "<h1>Weekly report</h1><p>All systems normal.</p>" }],
  }),
});
const site = await res.json();
if (!res.ok) throw new Error(`${site.error.code}: ${site.error.message}`);
console.log(site.url);
```

**Python بالمكتبة القياسية فقط:**

```python
import io, json, os, urllib.request, zipfile

buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    for root, _, files in os.walk("out"):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, "out"))

req = urllib.request.Request(
    "https://marsa.example.com/api/sites?ttlHours=24",
    data=buf.getvalue(),
    headers={"Content-Type": "application/zip"},
    method="POST",
)
site = json.load(urllib.request.urlopen(req))
print(site["url"], site["expiresAt"])
```

## نصائح

- فضّل صيغة ZIP لأي شيء فيه صور أو ملفات كثيرة؛ فهي طلب واحد.
- اجعل التقارير مكتفية بذاتها (CSS/JS داخل الصفحة أو ملفات في الـ zip). الصفحات تعمل في عزل و
  لا تستطيع استخدام الكوكيز أو `localStorage`، لكن `fetch()` إلى واجهات API عامة تدعم CORS يعمل.
- اختر أقصر `ttlHours` يناسب القارئ.
- احفظ `editToken` فقط حيث يستطيع الوكيل الوصول إليه مجددًا؛ لا تضعه داخل الموقع أبدًا.
