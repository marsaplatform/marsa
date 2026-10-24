# مرجع الـ API

العنوان الأساسي: `https://marsa.example.com`. المواصفة القابلة للقراءة آليًا في
[`/openapi.json`](https://marsa.example.com/openapi.json).

كل الاستجابات JSON. تبدو الأخطاء هكذا:

```json
{ "error": { "code": "BLOCKED_FILE_TYPE", "message": "file type not allowed: run.sh", "path": "run.sh" } }
```

الاستدعاءات الموثّقة تستخدم `Authorization: Bearer <token>`: **مفتاح التعديل** للموقع، أو
**مفتاح الإدارة** للنسخة في `/api/admin/*`.

## إنشاء موقع: `POST /api/sites`

ثلاث صيغ للجسم. `ttlHours` اختياري في كل مكان (في سلسلة الاستعلام أو الجسم) ويُحصر بين
الحد الأدنى والأقصى للنسخة.

**ملف ZIP** (الأفضل للوكلاء والسكربتات):

```bash
(cd my-site && zip -qr ../site.zip .)
curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=24" \
  -H "Content-Type: application/zip" --data-binary @site.zip
```

**ملفات JSON** (مفيدة عندما تولّد الـ HTML بالكود):

```bash
curl -s -X POST https://marsa.example.com/api/sites \
  -H "Content-Type: application/json" \
  -d '{"ttlHours": 6, "files": [
        {"path": "index.html", "content": "<h1>Hello</h1><img src=\"dot.png\">"},
        {"path": "dot.png", "content": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "encoding": "base64"}
      ]}'
```

**Multipart** (ما يرسله الرافع في المتصفح): حقول `files` متكررة، وحقول `paths` اختيارية مقابلة
بالمسار النسبي لكل ملف، و`ttlHours` اختياري.

```bash
curl -s -X POST https://marsa.example.com/api/sites \
  -F "files=@index.html" -F "paths=index.html" \
  -F "files=@style.css"  -F "paths=css/style.css" \
  -F "ttlHours=72"
```

الاستجابة `201`:

```json
{ "id": "k3v9x2mq7a", "url": "https://marsa.example.com/s/k3v9x2mq7a/", "expiresAt": "…",
  "editToken": "marsa_…", "fileCount": 2, "totalBytes": 1234, "createdAt": "…", "updatedAt": "…",
  "files": { "index.html": { "size": 120, "mime": "text/html; charset=utf-8" } } }
```

## القراءة والتحديث والتمديد والحذف

| الاستدعاء | الجسم | النتيجة |
| --- | --- | --- |
| `GET /api/sites/:id` | لا شيء | `200` بيانات الموقع |
| `PUT /api/sites/:id` | الصيغ نفسها كالإنشاء | `200`؛ يستبدل **كل** الملفات، الرابط نفسه والانتهاء نفسه |
| `PATCH /api/sites/:id` | `{"ttlHours": 24}` | `200`؛ الانتهاء الجديد = الآن + المدة، ولا يتجاوز الإنشاء + المدة القصوى |
| `DELETE /api/sites/:id` | لا شيء | `204`؛ تُحذف الملفات فورًا |

```bash
TOKEN="marsa_…"; ID="k3v9x2mq7a"
curl -s -X PUT    "https://marsa.example.com/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/zip" --data-binary @site.zip
curl -s -X PATCH  "https://marsa.example.com/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"ttlHours": 48}'
curl -s -X DELETE "https://marsa.example.com/api/sites/$ID" -H "Authorization: Bearer $TOKEN"
```

المفتاح الخاطئ والموقع غير الموجود كلاهما يُعيد `404` عمدًا، حتى لا يمكن تخمين المعرّفات.

## معلومات عامة

| الاستدعاء | النتيجة |
| --- | --- |
| `GET /api/config` | حدود هذه النسخة (مدى المدة، وحدود الحجم، والرفع في الساعة) |
| `GET /healthz` | `{"ok": true}` |
| `GET /openapi.json` | مواصفة OpenAPI 3.1 |
| `GET /llms.txt` | تعليمات نصية لوكلاء الذكاء الاصطناعي |
| `GET /s/:id/...` | الموقع المنشور |

## الإدارة (فقط عند ضبط `ADMIN_TOKEN`)

| الاستدعاء | النتيجة |
| --- | --- |
| `GET /api/admin/backend/check` | فحص مباشر لمخزني KV والملفات (`{enabled, kind, kv:{ok,status?,error?}, files:{…}}`) |
| `GET /api/admin/sites` | كل المواقع بأحجامها وانتهائها (بلا مفاتيح) |
| `DELETE /api/admin/sites/:id` | حذف أي موقع |
| `POST /api/admin/sweep` | حذف المواقع المنتهية الآن |
| `GET /api/admin/teams` | الفرق مع عدد مواقعها الحية (بلا مفاتيح) |
| `POST /api/admin/teams` | إنشاء فريق `{"name", "backend"?, "directory"?}`؛ الاستجابة فيها مفتاحه مرة واحدة |
| `PATCH /api/admin/teams/:id` | تغيير `name` أو `backend` أو `directory` |
| `POST /api/admin/teams/:id/rotate` | مفتاح فريق جديد؛ القديم يتوقف عن العمل |
| `POST /api/admin/teams/:id/notes` | إرسال ملاحظة إلى الفريق باسم مسؤول المنصة `{"severity","message","stage"?,"category"?,"target"?}` (0.17.0؛ بلا تنبيه ولا webhook). وأيضًا نموذج **أرسل ملاحظة إلى فريق** في الإدارة › الملاحظات |
| `GET /api/admin/teams/:id/export` | الفريق كملف zip (الأعضاء بلا كلمات مرور، والنشاط، والمساحات وملفاتها، والبيانات، والوركرات بكودها وإصداراتها، ومفاتيح الوكلاء بلا أسرار، والوصفات، والملاحظات، والإشعارات) |
| `DELETE /api/admin/teams/:id?confirm=<name or id>` | نقل فريق إلى سلة المحذوفات لمدة ٧ أيام (يُحفظ تصدير، وتُطفأ الوركرات، وتتوقف المفاتيح). `?sites=delete` يحذف مواقعه أيضًا عند الحذف النهائي؛ `?purge=now` يحذفه نهائيًا فورًا |
| `GET /api/admin/trash` | الفرق المحذوفة التي تنتظر انتهاء المهلة |
| `GET /api/admin/trash/:id/export` | التصدير المحفوظ عند حذف الفريق |
| `POST /api/admin/trash/:id/restore` | إعادة الفريق (المفاتيح والأعضاء والوركرات) |
| `DELETE /api/admin/trash/:id?confirm=<name or id>` | حذفه نهائيًا الآن |
| `GET /api/admin/backups` | حالة النسخ الاحتياطي: آخر تشغيل، وآخر تشغيل ناجح، والنسخ المحفوظة، والتشغيل القادم، وآخر اختبار استعادة |
| `POST /api/admin/backups/run` | أخذ نسخة احتياطية الآن (مشفرة، تُرفع ثم تُقرأ وتُفحص) |
| `POST /api/admin/backups/test-restore` | استعادة أحدث نسخة في مجلد مؤقت، وفحصها، وحذف المجلد |
| `POST /api/admin/sessions/end-all` | إنهاء كل جلسات الإدارة (وإلا فهي تبقى بعد إعادة التشغيل) |

إذا كان `ADMIN_TOKEN` فارغًا تُعيد هذه المسارات `404`. لوحة الفرق في المتصفح على `/admin`؛
انظر [الفرق](teams.md).

## الفرق والدليل

- ارفع مع `X-Team-Key: <team key>` (أو `Authorization: Bearer <team key>`) على `POST /api/sites`
  لربط الموقع بفريق. المفتاح الخاطئ يُعيد `401 INVALID_TEAM_KEY`.
- `GET /api/directory`: JSON عام بالمواقع الحية للفرق المدرجة، مجمّعة حسب الفريق (تخزين مؤقت ٣٠ ثانية).
- [مفتاح الوكيل](agent-keys.md) (`marsa_agent_…`، 0.14.0) يعمل حيثما يعمل مفتاح الفريق، في حدود
  صلاحياته: `spaces:write` لنشر مواقع الفريق واستبدالها وتمديدها وحذفها، و`spaces:read` لـ
  `GET /api/sites/:id` و`GET /api/teams/:team/sites`، و`kv:read`/`kv:write` لـ KV الفريق
  وملفاته. خارج صلاحياته: `403 INSUFFICIENT_SCOPE`.
- `GET /api/teams/:team/sites` (مفتاح الفريق أو `spaces:read`): مواقع الفريق الحية.
- مفاتيح الوكلاء وروابط الدعوة والإشعارات والـ Webhooks: انظر [مفاتيح الوكلاء والتنبيهات](agent-keys.md).

## رموز الأخطاء

| الرمز | HTTP | المعنى |
| --- | --- | --- |
| `EMPTY_UPLOAD` | 400 | لا ملفات صالحة بعد حذف الملفات المخفية |
| `INVALID_REQUEST` | 400 | نوع محتوى غير مدعوم أو جسم غير سليم |
| `INVALID_PATH` / `ZIP_SLIP_REJECTED` | 400 | مسار مطلق أو `..` في مسار ملف |
| `INVALID_ZIP` | 400 | لا يمكن قراءة الأرشيف |
| `INVALID_ENCODING` | 400 | `encoding` ليس `utf8` أو `base64` |
| `FILE_TOO_LARGE` / `SITE_TOO_LARGE` / `TOO_MANY_FILES` / `ZIP_BOMB_REJECTED` | 413 | تجاوز حدًا للحجم أو العدد |
| `BLOCKED_FILE_TYPE` | 415 | سكربت خادم أو ملف تنفيذي في الرفع |
| `NOT_FOUND` | 404 | موقع غير معروف، أو مفتاح خاطئ، أو الإدارة معطّلة |
| `EXPIRED` | 410 | انتهى الرابط |
| `UNAUTHORIZED` | 401 | مفتاح إدارة خاطئ |
| `INVALID_TEAM_KEY` | 401 | مفتاح فريق غير معروف أو مُدوَّر عند الرفع |
| `BACKEND_NOT_ALLOWED` | 403 | الموقع ليس في فريق له وصول إلى الخلفية |
| `BACKEND_NOT_CONFIGURED` | 503 | مسموح، لكن النسخة ليس لها خلفية بيانات/ملفات مُعدّة |
| `BACKEND_UNAVAILABLE` | 503 | فشل مخزن البيانات/الملفات (مثلًا رُفضت بيانات اعتماده)؛ أعد المحاولة لاحقًا (`Retry-After`) أو أخبر المسؤول |
| `INSUFFICIENT_SCOPE` | 403 | مفتاح وكيل بلا الصلاحية التي يحتاجها الاستدعاء |
| `TEAM_KEY_REQUIRED` | 403 | الاستدعاء يحتاج مفتاح الفريق نفسه (النشاط، التصدير، الـ Webhook)؛ لا تستطيع مفاتيح الوكلاء استخدامه |
| `RATE_LIMITED` | 429 | تمهّل؛ انظر ترويسة `Retry-After` |
| `SYNTAX_ERROR` / `MISSING_MODULE` / `NOT_A_MODULE` | 400 | رُفض كود الوركر قبل الرفع (0.17.0؛ انظر [الوركرات](workers.md)) |
| `VALIDATION_FAILED` | 400 | رفضت Cloudflare سكربت الوركر (خطؤها 10021) |
| `INVALID_CRON` | 400 | تعبير cron غير صحيح، أو يعمل أكثر من مرة كل ١٠ دقائق |
| `CRON_QUOTA` / `CRON_ACCOUNT_LIMIT` / `KV_QUOTA` / `KV_ACCOUNT_LIMIT` | 409 | امتلأت حصة الجدولة أو التخزين الخاص |

## الوصفات ومفاتيح API للوركرات (0.14.0)

- `GET /api/recipes?lang=en|ar`: الوصفات المضمّنة ووصفات المنصة (ووصفات فريقك مع مفتاح فريق أو وكيل). `GET /api/recipes/<slug>?lang=ar&format=md`: وصفة واحدة بصيغة markdown (JSON بدون `format=md`).
- `PUT|DELETE /api/teams/<team>/recipes/<slug>`: وصفات الفريق (مفتاح الفريق، أو مفتاح وكيل بصلاحية `spaces:write`). الجسم: `{"title_en","title_ar","summary_en","summary_ar","body_en","body_ar","tags"}`.
- `GET|POST /api/teams/<team>/workers/<name>/keys` و`PUT …/keys/settings` و`DELETE …/keys/<id>`: مفاتيح API للمستخدمين النهائيين لوركر (انظر [الوركرات](workers.md)).
- `POST /api/keys/verify` (Bearer = `MARSA_KEYS_SECRET` الخاص بالوركر) و`GET /api/keys/helper.v2.js` (`/api/keys/helper.js` يحوّل إليه): يستخدمها الوركر.

## النشاط وتصدير الفريق (0.16.0)

- `GET /api/teams/<team>/activity` (مفتاح الفريق فقط؛ مفاتيح الوكلاء تحصل على `403 TEAM_KEY_REQUIRED`): سجل نشاط الفريق، الأحدث أولًا، بصيغة `{entries, count}`. المرشحات: `since` / `until` (وقت ISO أو ميلي ثانية)، و`action` (مطابق تمامًا، أو بادئة تنتهي بـ `-` مثل `worker-`)، و`site`، و`limit` (الافتراضي ٥٠٠، والأقصى ٥٠٠٠). `format=csv` أو `format=jsonl` ينزّل الصفوف نفسها.
- `GET /api/admin/activity?team=<id>|platform` (المسؤول): سجل فريق واحد، أو سجل المنصة، أو كل السجلات بدون `team`. المرشحات والصيغ نفسها؛ وتحمل الصفوف `team` (اسم الفريق).
- `GET /api/teams/<team>/export` (مفتاح الفريق فقط): ملف zip فيه مواقع الفريق وملفاتها، والوركرات وإصداراتها، و KV والملفات المرفوعة، والأعضاء، ومفاتيح الوكلاء، والوصفات، والملاحظات، والإشعارات، وسجل النشاط. لا يُضمَّن أي مفتاح أو سر. `GET /api/admin/teams/<id>/export` للمسؤول يُعيد ملف zip نفسه.

```bash
curl -s "https://marsa.example.com/api/teams/sanad/activity?action=worker-&format=csv" \
  -H "X-Team-Key: $MARSA_TEAM_KEY" -o activity.csv
```

## مهام النشر وإعدادات تشغيل الوركر (0.17.0)

- ينتظر نشر الوركر حتى ٦٠ ثانية ويردّ كما كان؛ والنشر الأبطأ يردّ `202` مع
  `{"job": {"id", "status", "statusUrl"}}`. `?wait=0…90` أو `?async=1` أو `Prefer: respond-async` تحدد الانتظار.
  استعلم `GET /api/teams/<team>/jobs/<id>`؛ و`GET /api/teams/<team>/jobs?worker=<name>` يعرض المهام الأخيرة.
  ردود النشر الناجح فيها `health: {path, status, ms, ok}`.
- `GET /api/teams/<team>/workers/<name>/runtime`: تاريخ التوافق وعلاماته، والربط، والجدولة، والتخزين،
  وأسماء المتغيرات والأسرار، والحدود (٣٢ متغيرًا، ٣٢ كيلوبايت للقيمة، ٦٤ كيلوبايت إجمالًا لكل وركر).
- يقبل النشر `"crons": ["*/30 * * * *"]` و`"storage": "kv"` (تخزين KV خاص باسم `env.STORE`). التفاصيل في
  [الوركرات](workers.md).
- `urllib` في Python يحصل على خطأ Cloudflare رقم 1010 بقيمة User-Agent الافتراضية: أرسل ترويسة `User-Agent` خاصة بك.

## كل ما سوى ذلك

القائمة الكاملة للمسارات، بما فيها API الإدارة والـ Webhooks والإشعارات وعمليات الوركر
(`…/env` و`…/secrets/<NAME>` و`…/health` و`…/logs` و`…/usage` و`…/versions/<n>`) ومفاتيح الوكلاء، موجودة في
[`/openapi.json`](https://marsa.example.com/openapi.json). اختبار آلي يُبقيها متوافقة مع الخادم.
