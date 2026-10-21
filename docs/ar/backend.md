# خلفية البيانات والملفات الاختيارية (Cloudflare)

النشر الثابت هو كل ما يحتاجه معظم الناس، و**لا يتطلب خلفية أبدًا**. عندما تحتاج صفحة أو
وكيل أيضًا إلى **تخزين قليل من البيانات** (عدّاد، نتائج نموذج، كتلة حالة JSON) أو
**ملفات** (صور مرفوعة، تصديرات مولّدة)، تستطيع مرسى تمرير ذلك إلى
[Cloudflare](https://www.cloudflare.com): القيم تذهب إلى **Workers KV**، والملفات إلى **R2**. تتحدث مرسى مع
واجهات HTTP العامة في Cloudflare مباشرة من Node؛ لا وركر للنشر ولا شيء للتثبيت.

## هل أحتاج إلى تثبيت أي شيء؟

| تريد أن… | تحتاج |
| --- | --- |
| تستخدم نسخة مرسى لشخص آخر | لا شيء. ارفع من المتصفح أو استدعِ الـ API. |
| تستضيف نسختك من مرسى | مرسى فقط: `docker compose up -d --build`. لا قاعدة بيانات ولا حساب Cloudflare. |
| تعطي الصفحات والوكلاء KV وملفات | حساب Cloudflare (الخطة المجانية تكفي) فيه مساحة أسماء KV واحدة وحاوية R2 واحدة، مربوطة بخمسة متغيرات بيئة. |

بدون ضبط متغيرات `CLOUDFLARE_*` / `R2_*` تبدأ مرسى طبيعيًا، ويقول السجل
`data/files backend: off (static publishing only)`، ويُبلغ `/api/config` بـ `"backend": {"enabled": false}`،
وكل مسارات الخلفية تُعيد:

```json
HTTP 503
{ "error": { "code": "BACKEND_NOT_CONFIGURED",
  "message": "This Marsa instance has no data/files backend. Static publishing works; set the CLOUDFLARE_* and R2_* variables to enable KV and files." } }
```

## من يستطيع استخدامها

فقط المواقع المرفوعة بمفتاح **فريق** أعطاه المسؤول **وصولًا إلى الخلفية** (انظر
[الفرق](teams.md)). رفع الضيوف ومواقع الفرق الأخرى تحصل على `403 BACKEND_NOT_ALLOWED`. المواقع
المسموح لها على نسخة بلا خلفية مُعدّة تحصل على `503` أعلاه. اضبط `BACKEND_GUEST_ACCESS=true` للسماح
لكل موقع باستخدام الخلفية، كما في 0.3.

## ما الذي تضيفه

لكل موقع، محصورة بمعرّفه وتُحذف معه:

- **KV**: قيم JSON تحت مفاتيح قصيرة (`GET/PUT/DELETE /api/sites/:id/kv/:key` و`GET /api/sites/:id/kv`).
- **الملفات**: رفع وعرض وتنزيل وحذف (`/api/sites/:id/files` و`/api/sites/:id/files/:fileId`).
- **SDK للمتصفح** في `/sdk.js` فيه `marsa.kv.*` و`marsa.files.*`.

القواعد:

- **الكتابة تحتاج دائمًا مفتاح التعديل للموقع** (`Authorization: Bearer …`).
- **القراءة عامة** ما دام الموقع حيًا (`BACKEND_PUBLIC_READ=true`، الافتراضي): البيانات
  عامة بقدر الصفحة. اضبط `BACKEND_PUBLIC_READ=false` لطلب المفتاح للقراءة أيضًا.
- عند انتهاء الموقع أو حذفه، تُحذف مدخلات KV والملفات الخاصة به **من Cloudflare**.
- **مفتاح API في Cloudflare ومفاتيح R2 لا تغادر الخادم أبدًا**. المتصفحات تتحدث مع مرسى فقط.
- الحدود: `BACKEND_MAX_VALUE_KB` (64) لكل قيمة، و`BACKEND_MAX_KEYS` (1000) و`BACKEND_MAX_FILES` (100)
  لكل موقع، و`MAX_FILE_MB` لكل ملف؛ رفع الملفات يُحتسب ضمن `UPLOADS_PER_HOUR`؛ أنواع الملفات المحظورة
  تُرفض كما في رفع المواقع؛ التنزيلات تُقدَّم مع CSP العزل.

## الإعداد

### ١. أنشئ مفتاح API في Cloudflare

لوحة Cloudflare ← **Manage account → Account API tokens → Create token → Custom token** (مفتاح API
للمستخدم يعمل أيضًا). الصلاحيات، كلها بنطاق **Account**، محصورة بحسابك:

| الصلاحية | السبب |
| --- | --- |
| `Workers KV Storage: Edit` | قراءة قيم KV وكتابتها وعرضها وحذفها؛ إنشاء مساحة الأسماء |
| `Workers R2 Storage: Edit` | إنشاء الحاوية؛ مفاتيح S3 المشتقة من هذا المفتاح تقرأ الكائنات وتكتبها |

دوّن **Account ID** (اللوحة ← Workers & Pages ← الشريط الجانبي، أو صفحة النظرة العامة لأي نطاق).

### ٢. أنشئ مساحة أسماء KV وحاوية R2

```bash
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/cloudflare-setup.mjs --write-env .env
```

السكربت آمن للتكرار: يتحقق من المفتاح، ثم ينشئ (أو يعيد استخدام، بمطابقة الاسم) مساحة أسماء KV
بعنوان `marsa-kv` وحاوية R2 باسم `marsa-files` (غيّرهما بـ `CLOUDFLARE_KV_TITLE` / `R2_BUCKET`). لا
يلمس أبدًا مساحات أسماء أو حاويات أخرى. يطبع معرّف مساحة الأسماء والحاوية ومعرّف مفتاح وصول R2.
الأسرار لا تُطبع أبدًا؛ `--write-env FILE` يكتبها في ذلك الملف (بصلاحية 600) بدلًا من ذلك.

**بيانات اعتماد S3 لـ R2.** تُقرأ كائنات R2 وتُكتب عبر واجهة R2 المتوافقة مع S3، والتي توقّع
الطلبات بزوج مفاتيح وصول. توثّق Cloudflare أن أي مفتاح API بصلاحيات R2 يعمل
كزوج كهذا: **Access Key ID = معرّف المفتاح**، و**Secret Access Key = بصمة SHA-256 بالست عشري لقيمة
المفتاح** ([توثيق R2: Get S3 API credentials from an API token](https://developers.cloudflare.com/r2/api/tokens/#get-s3-api-credentials-from-an-api-token)).
سكربت الإعداد يشتق الاثنين لك. إن فضّلت مفتاحًا منفصلًا محصورًا بالحاوية، فأنشئه من
**R2 → Manage API tokens** (صلاحية *Object Read & Write* محصورة بالحاوية) واستخدم
Access Key ID / Secret Access Key الخاصين به بدلًا من ذلك.

### ٣. اضبط مرسى

في `.env` (القيم أمثلة):

```bash
CLOUDFLARE_ACCOUNT_ID=0123456789abcdef0123456789abcdef
CLOUDFLARE_API_TOKEN=your-api-token
CLOUDFLARE_KV_NAMESPACE_ID=your-kv-namespace-id
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
# optional
R2_BUCKET=marsa-files
# R2_ENDPOINT=https://<account>.eu.r2.cloudflarestorage.com   # only for EU/FedRAMP jurisdiction buckets
BACKEND_PUBLIC_READ=true
```

اضبط القيم الخمس المطلوبة كلها أو لا شيء منها: الإعداد الجزئي يوقف مرسى عند البدء برسالة تسمّي
القيم الناقصة. أعد تشغيل مرسى؛ يجب أن يقول السجل
`data/files backend: cloudflare (KV namespace …, R2 bucket …)`.

## الاستخدام

### من وكيل أو سكربت (كتابة)

```bash
BASE=https://marsa.example.com; ID=k3v9x2mq7a; TOKEN="marsa_…"

curl -s -X PUT "$BASE/api/sites/$ID/kv/notes" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"value": ["Buy milk", "Ship the demo"]}'

curl -s -X POST "$BASE/api/sites/$ID/files" -H "Authorization: Bearer $TOKEN" -F "file=@chart.png"
```

### من الصفحة المنشورة (قراءة)

```html
<script src="/sdk.js"></script>
<ul id="notes"></ul>
<script>
  marsa.kv.get("notes").then((notes = []) => {
    for (const n of notes) document.getElementById("notes").append(Object.assign(document.createElement("li"), { textContent: n }));
  });
  marsa.files.list().then((files) => console.log(files.map((f) => marsa.files.url(f.id))));
</script>
```

مرجع الـ SDK:

| الاستدعاء | يفعل |
| --- | --- |
| `marsa.kv.get(key)` | القيمة، أو `undefined` إن لم تكن موجودة |
| `marsa.kv.list()` | كل المفاتيح |
| `marsa.kv.set(key, value)` / `marsa.kv.delete(key)` | يحتاج `marsa.auth(token)` أولًا |
| `marsa.files.list()` | `[{ id, name, size, mime, createdAt, url }]` |
| `marsa.files.url(id)` | رابط التنزيل |
| `marsa.files.upload(file, name?)` / `marsa.files.delete(id)` | يحتاج `marsa.auth(token)` |
| `marsa.auth(token)` | استخدام مفتاح تعديل للكتابة |

**لا تضع مفتاح تعديل في صفحة منشورة أبدًا**: يستطيع أي أحد قراءة المصدر. الكتابة للوكلاء
والسكربتات والمالك (مثلًا صفحة إدارة خاصة تفتحها محليًا وتستدعي `marsa.auth()`
بمفتاح تلصقه).

تُرمى الأخطاء كـ `MarsaError` مع `.code` (`BACKEND_NOT_CONFIGURED` و`NOT_FOUND` و`EXPIRED` و
`INVALID_KEY` و`VALUE_TOO_LARGE` و`TOO_MANY_KEYS` و`TOO_MANY_FILES` و`BLOCKED_FILE_TYPE` و`RATE_LIMITED`).

صفحة تجريبية في [`examples/backend-notes`](../examples/backend-notes).

## الـ API

| الاستدعاء | المصادقة | النتيجة |
| --- | --- | --- |
| `GET /api/sites/:id/kv` | عام* | `{ "keys": [...] }` |
| `GET /api/sites/:id/kv/:key` | عام* | `{ "key", "value" }` أو `404 KEY_NOT_FOUND` |
| `PUT /api/sites/:id/kv/:key` | مفتاح التعديل | الجسم `{ "value": <any JSON> }` |
| `DELETE /api/sites/:id/kv/:key` | مفتاح التعديل | `204` |
| `GET /api/sites/:id/files` | عام* | `{ "files": [...] }` |
| `POST /api/sites/:id/files` | مفتاح التعديل | حقل multipart باسم `file` (و`name` اختياري)، أو جسم خام مع `?name=` |
| `GET /api/sites/:id/files/:fileId` | عام* | الملف |
| `DELETE /api/sites/:id/files/:fileId` | مفتاح التعديل | `204` |

\* مفتاح التعديل مطلوب عند `BACKEND_PUBLIC_READ=false`. المفاتيح من ١ إلى ١٢٨ حرفًا من
`A-Z a-z 0-9 . _ : -`.

## تنظيم البيانات في Cloudflare

- مساحة أسماء **Workers KV**: مدخل واحد لكل (موقع، مفتاح)، باسم `<siteId>/<key>`، والقيمة = نص JSON.
  عرض مفاتيح موقع هو عرض بالبادئة `<siteId>/`.
- حاوية **R2**: كائن واحد لكل ملف، باسم `<siteId>/<fileId>/<percent-encoded original name>`، يُحفظ
  مع نوع محتواه. معرّف الملف (`f` + الوقت بالأساس ٣٦ + ١٦ حرفًا ست عشريًا) يفصل الملفات المرفوعة بالاسم
  نفسه ويجعل القوائم تعود بترتيب الرفع.
- حذف موقع أو انتهاؤه يزيل كل مدخلات KV بالبادئة `<siteId>/` (حذف مجمّع) وكائنات R2.

### أشياء يجب معرفتها عن Cloudflare

- استدعاءات Workers KV تمر عبر REST API في Cloudflare، وهي محدودة بـ
  **١٢٠٠ طلب كل ٥ دقائق** لكل مفتاح ([حدود Cloudflare API](https://developers.cloudflare.com/fundamentals/api/reference/limits/)).
  كل قراءة أو كتابة KV من صفحة تكلّف طلبًا أو اثنين منها. R2 (واجهة S3) ليست تحت هذا الحد.
- يقبل Workers KV **كتابة واحدة في الثانية للمفتاح نفسه**؛ تعيد مرسى محاولة الاستدعاء المحدود (429) أو
  الفاشل (5xx) مرتين مع انتظار قصير قبل الاستسلام.
- KV **متسق في النهاية**. القراءة والكتابة عبر REST API فورية عادة، لكن
  العرض، أو القراءة مباشرة بعد حذف مجمّع، قد يتأخر حتى دقيقة تقريبًا. لذلك `BACKEND_MAX_KEYS`
  حد مرن.
- الخطة المجانية تشمل ١٠٠٬٠٠٠ قراءة KV و١٠٠٠ كتابة KV يوميًا، و10 GB من تخزين R2
  ([حدود KV](https://developers.cloudflare.com/kv/platform/limits/)، [أسعار R2](https://developers.cloudflare.com/r2/pricing/)).

إذا فشل استدعاء تنظيف إلى Cloudflare (مثلًا Cloudflare غير متاح وقت الانتهاء)، تسجّل مرسى
`[backend] purge of <id> failed`. يمكن إيجاد هذه البقايا بالبادئة `<siteId>/` وحذفها من
لوحة Cloudflare (مساحة أسماء KV ← المدخلات، حاوية R2 ← الكائنات).
