# وركرات الفرق

تستطيع الفرق نشر [Cloudflare Workers](https://developers.cloudflare.com/workers/) صغيرة (واجهات API وWebhooks وخوادم MCP) عبر مرسى Spaces. يربط مسؤول المنصة مفتاح API **واحدًا** من Cloudflare؛ وتنشر Spaces نيابةً عن كل فريق، فـ**لا يرى أي فريق أو وكيل مفتاح Cloudflare ولا يحتاجه أبدًا**.

## كيف تعمل

- **المسؤول، مرة واحدة:** في لوحة الإدارة ← **الإعدادات** (`/admin/settings`)، الصق مفتاح API من Cloudflare (الصلاحيات: *Account · Workers Scripts: Edit* و*Zone · Workers Routes: Edit* و*Zone · DNS: Edit*)، ومعرّف الحساب (اختياري)، والنطاق (مثل `marsaplatform.com`). يُتحقق من المفتاح مع Cloudflare، ويُشفَّر عند التخزين (AES-256-GCM بـ `MARSA_SECRETS_KEY`) وهو **للكتابة فقط**: تعرض اللوحة «مضبوط (…آخر ٤)» وزر **تحقق** فقط. لا يُعيده أي API أبدًا.
- **المسؤول، لكل فريق:** شغّل **الوركرات**، وأعطِ الفريق **اسمًا مختصرًا** (من ٢ إلى ٢٠ حرفًا لاتينيًا صغيرًا أو رقمًا، مثل `sanad`) وحصصًا اختيارية (الافتراضي ٣ وركرات و1024 KB لكل سكربت).
- **الأسماء مفروضة:** الوركر المسمى `hello` في الفريق `sanad` هو السكربت `team-sanad-hello` على `https://sanad-hello.<zone>` (سجل DNS من نوع `AAAA 100::` عبر الوكيل + مسار `sanad-hello.<zone>/*`). بدون نطاق مُعدّ تحصل الوركرات على عنوان `workers.dev`.
- **الأمان:** لا تعدّل Spaces ولا تحذف إلا السكربتات والمسارات وسجلات DNS التي أنشأتها (مسجّلة في `workers.json`). قبل إنشاء أي شيء تتحقق من أن اسم السكربت واسم المضيف (أي سجل DNS) والمسار متاحة، وإلا ترفض بـ `409 NAME_TAKEN` / `409 HOST_TAKEN`.
- **الأدوار:** المالكون والمحررون ينشرون ويحذفون من **لوحة الفريق ← الوركرات**؛ المشاهدون يطّلعون فقط. الوكلاء يستخدمون مفتاح الفريق (API) أو مفتاح MCP بصلاحية قراءة وكتابة لمساحة (أدوات).
- **الإزالة:** إطفاء الوركرات لفريق، أو حذف الفريق، يحذف كل وركراته (المسار وسجل DNS والسكربت). يستطيع المسؤول أيضًا **تعطيل** وركر (يُزال مساره ويبقى السكربت) ثم **تفعيله** مجددًا.
- **التدقيق:** عمليات النشر وإعادة النشر والحذف وتغييرات المسؤول تُكتب في سجل نشاط الفريق؛ وتغييرات المفتاح في سجل المنصة في صفحة وركرات الإدارة. الأسرار لا تُسجَّل أبدًا.

## الـ API (مفتاح الفريق)

أرسل مفتاح الفريق كـ `X-Team-Key: marsa_team_…` (أو `Authorization: Bearer marsa_team_…`). `<team>` هو الاسم المختصر للفريق أو معرّفه. [مفتاح الوكيل](agent-keys.md) يعمل أيضًا: القراءة تحتاج `workers:read`، والتغييرات تحتاج `workers:deploy`.

| الطريقة | المسار | ماذا |
| --- | --- | --- |
| `GET` | `/api/teams/<team>/workers` | عرض الوركرات والحصة |
| `PUT` | `/api/teams/<team>/workers/<name>` | إنشاء أو إعادة نشر (JSON، أو السكربت الخام بنوع `application/javascript`) |
| `POST` | `/api/teams/<team>/workers` | إنشاء (JSON مع `name`)؛ `409 EXISTS` إن كان موجودًا |
| `GET` | `/api/teams/<team>/workers/<name>` | وركر واحد مع فحص مباشر (`live.status`)؛ `?probe=0` يتخطاه |
| `DELETE` | `/api/teams/<team>/workers/<name>` | حذفه (المسار وسجل DNS والسكربت) وإصداراته المحفوظة |
| `GET` | `/api/teams/<team>/workers/<name>/versions` | الإصدارات المحفوظة، الأحدث أولًا (بلا كود) |
| `GET` | `/api/teams/<team>/workers/<name>/versions/<n>` | إصدار واحد مع متغيراته (لا قيم أسرار أبدًا) |
| `GET` | `/api/teams/<team>/workers/<name>/versions/<n>/code` | تنزيل كود إصدار |
| `POST` | `/api/teams/<team>/workers/<name>/redeploy` | إعادة نشر أحدث إصدار محفوظ بنقرة واحدة (`{"note"?}`) |
| `POST` | `/api/teams/<team>/workers/<name>/rollback` | نشر إصدار أقدم من جديد: `{"version": 2, "note"?}` |

جسم JSON: `{"name": "hello", "code": "<ES module>", "vars": {"NAME": "value"}, "secrets": {"API_KEY": "…"}}`.

- يجب أن يكون `code` وحدة ES واحدة (`export default { async fetch(request, env) { … } }`)، حتى حد حجم الفريق.
- `vars` متغيرات بيئة نصية عادية (يستطيع الفريق ضبطها؛ قيمها لم تعد تُعرض افتراضيًا، انظر [قيم المتغيرات](#قيم-المتغيرات)). احذف `vars` عند إعادة النشر للإبقاء على الحالية. حتى ٣٢ متغيرًا، **32 KB لكل واحد و64 KB إجمالًا** (0.14.0؛ كانت 5 KB). تحدّ Cloudflare الربط الواحد بـ 5 KB، فالمتغيرات الأكبر تُسلَّم في وحدة صغيرة مولّدة يدمجها غلاف في `env`؛ ويراها الوركر كسلاسل `env.NAME` عادية. هذا يحتاج تصديرًا افتراضيًا على شكل كائن (`export default { fetch… }`) وليس صنفًا.
- `note` (اختياري، ٢٠٠ حرف) يُحفظ مع الإصدار؛ مع رفع سكربت خام أرسله في الترويسة `X-Marsa-Note`.
- `secrets` أسرار وركر للكتابة فقط (تظهر أسماؤها فقط). `null` يزيل سرًا.
- الأسماء: من ١ إلى ٣٠ حرفًا، `a-z` و`0-9` وشرطات مفردة، لا في الطرفين.

```bash
export MARSA_TEAM_KEY=marsa_team_…        # keep it secret

cat > worker.js <<'JS'
export default {
  async fetch(request, env) {
    return Response.json({ hello: env.WHO ?? "world" });
  },
};
JS

# Create or redeploy (raw script)
curl -s -X PUT "https://marsa.example.com/api/teams/sanad/workers/hello" \
  -H "X-Team-Key: $MARSA_TEAM_KEY" \
  -H "Content-Type: application/javascript" --data-binary @worker.js

# With env vars and a secret (JSON)
jq -n --rawfile code worker.js \
  '{code: $code, vars: {WHO: "Sanad"}, secrets: {UPSTREAM_TOKEN: "…"}}' |
curl -s -X PUT "https://marsa.example.com/api/teams/sanad/workers/hello" \
  -H "X-Team-Key: $MARSA_TEAM_KEY" -H "Content-Type: application/json" --data-binary @-

# List, check, delete
curl -s "https://marsa.example.com/api/teams/sanad/workers" -H "X-Team-Key: $MARSA_TEAM_KEY"
curl -s "https://marsa.example.com/api/teams/sanad/workers/hello" -H "X-Team-Key: $MARSA_TEAM_KEY"
curl -s -X DELETE "https://marsa.example.com/api/teams/sanad/workers/hello" -H "X-Team-Key: $MARSA_TEAM_KEY"
```

الأخطاء: `401 UNAUTHORIZED` (لا مفتاح أو مفتاح غير معروف)، و`404` (مفتاح فريق آخر، وركر غير معروف)، و`403 WORKERS_NOT_ALLOWED` (غير مفعّلة للفريق)، و`400 INVALID_NAME` / `NOT_A_MODULE` / `INVALID_REQUEST`، و`413 SCRIPT_TOO_LARGE`، و`409 WORKER_QUOTA` / `NAME_TAKEN` / `HOST_TAKEN` / `EXISTS`، و`429 RATE_LIMITED` (٦٠ نشرًا لكل فريق في الساعة)، و`502 CLOUDFLARE_ERROR` (رسالة Cloudflare بعد تنظيفها)، و`503 WORKERS_NOT_CONFIGURED`.

## قيم المتغيرات

منذ 0.16.0 تُعيد القوائم (`GET /api/teams/<team>/workers` و`GET …/workers/<name>` و`GET /api/admin/workers` للمسؤول
وأداة MCP `list_workers`) الحقل `varNames` لكل وركر. قيم المتغيرات العادية تخرج منها:

- **حتى 2026-10-28 12:00 UTC** (`VAR_VALUES_SUNSET`) ما زال `vars` يحمل القيم، ويُعلَّم كل وركر بـ
  `varValuesDeprecated: true`، وتحمل الاستجابة `deprecations: [{field:"vars", sunset, message, docs}]`
  إضافة إلى الترويسات `Deprecation` و`Sunset` و`Link: <…/docs/workers#var-values>; rel="deprecation"`.
- **بعد ذلك** يُحذف `vars`. أرسل `?includeValues=1` (مفاتيح الوكلاء تحتاج `workers:deploy`؛ ومفتاح الفريق
  ومفتاح الإدارة مسموح لهما) أو استدعِ `list_workers` مع `{"includeValues": true}` للحصول على القيم.
- الإصدارات (`…/versions/<n>`) وإجابات النشر لم تتغير. الأسرار لم تُعَد أبدًا.

للوكلاء: اقرؤوا `varNames`، واحفظوا القيم في إعداداتكم الخاصة. وصل إشعار جرس لكل فريق لديه وركرات.

## الإصدارات وإعادة النشر بنقرة والرجوع (0.14.0)

كل نشر ناجح يُحفظ كإصدار على خادم Spaces: الكود، والمتغيرات العادية، و**أسماء** الأسرار (لا قيمها أبدًا)، ومن نشره، ومتى، وحجمه وبصمته SHA-256، والملاحظة. يُحفظ آخر **١٠** لكل وركر (في `<DATA_DIR>/worker-versions/` بصلاحية 600) وتُحذف مع الوركر.

- **إعادة النشر** (نقرة واحدة في صفحة الوركرات، أو `POST …/redeploy`) تنشر أحدث إصدار محفوظ من جديد بالكود والمتغيرات نفسها. تبقى الأسرار كما هي في Cloudflare.
- **الرجوع إلى هذا الإصدار** (صفحة الإصدارات، مع تأكيد، أو `POST …/rollback`) ينشر كود إصدار أقدم ومتغيراته. يُسجَّل كإصدار جديد (`action: "rollback"` و`from: <n>`). إذا كان الإصدار القديم يستخدم أسرارًا غير مضبوطة الآن، تذكرها الإجابة في `missingSecrets`.
- **تنزيل الكود** في صفحة الإصدارات، أو `GET …/versions/<n>/code`.
- الوركرات المنشورة قبل 0.14.0 تعرض «لا إصدار محفوظ — سيُحفظ النشر القادم».
- النشر وإعادة النشر والرجوع والحذف ترسل إشعارًا لمالكي الفريق (انظر [مفاتيح الوكلاء والتنبيهات](agent-keys.md)).

## صفحة الوركر (0.15.0)

`/team/workers/<name>` (للمسؤولين: `/admin/teams/<id>/workers/<name>`) فيها تبويبات:

- **نظرة عامة**: الحالة، والرابط الحي (نسخ/فتح)، ونقطة MCP عندما يخدم الكود `/mcp`، وآخر نشر ومن قام به، والحجم، وSHA-256، و**أسماء** المتغيرات والأسرار، وفحص الصحة، وطلبات مفاتيح API في آخر ٧ أيام (تظهر فقط عندما يستخدم الوركر مفاتيح API من مرسى).
- **الإصدارات**: الرجوع إلى أي إصدار محفوظ أو تنزيله.
- **مفاتيح API**: مفاتيح مستخدمي الوركر.
- **الإعدادات**: اشتراط مفاتيح API والحدود، وتعديل متغيرات البيئة، وضبط الأسرار أو إزالتها (القيم للكتابة فقط ولا تُعرض أبدًا)، والتعطيل/التفعيل، والحذف. حفظ المتغيرات أو الأسرار يعيد نشر أحدث كود محفوظ وينشئ إصدارًا جديدًا. الوركر الذي عطّله المسؤول لا يعيد تفعيله إلا المسؤول.
- **النشاط**: النشر والرجوع والإعدادات وتغييرات المفاتيح لهذا الوركر.

عرض المسؤول للقراءة فقط بالنسبة للكود والإعدادات؛ يستطيع المسؤولون التعطيل والتفعيل والحذف.

## علامات التوافق وربط الخدمات (0.15.0)

النشر (`PUT …/workers/<name>` وأداة MCP `deploy_worker`) يقبل هذه الحقول الاختيارية:

- `compatibilityDate`: `YYYY-MM-DD`، من 2021-11-03 حتى اليوم. `null` يضبط الافتراضي للمنصة (`WORKERS_COMPAT_DATE`).
- `compatibilityFlags`: من قائمة مسموحة: `global_fetch_strictly_public` و`nodejs_compat` و`nodejs_als`. أي شيء آخر يُعيد `400`.
- `bindings`: ربط خدمات بوركرات أخرى من **الفريق نفسه**، `[{"name":"NEWS","worker":"news"}]`. في الكود استدعِ `env.NEWS.fetch(request)`. `worker` هو الاسم القصير لأحد وركرات فريقك. ترفض Spaces أسماء السكربتات، ووركرات الفرق الأخرى، والسكربتات التي ليست من Spaces، والوركر نفسه، والأسماء التي تتعارض مع متغير أو سر، وأسماء `MARSA_*`، وأي حقل غير `name`/`worker`.

إذا حذفت حقلًا تبقى القيمة الحالية. `[]` تمسح العلامات أو الربط. تُحفظ الإعدادات مع كل إصدار، فالرجوع يستعيدها. `POST …/workers/<name>/runtime` (أو `set_worker_runtime`، أو تبويب الإعدادات) يغيّر هذه الإعدادات فقط: يعيد نشر أحدث كود محفوظ ولا يلمس الوركر المربوط. حذف وركر يرتبط به وركر آخر يُعيد `409 WORKER_BOUND`.

لماذا: `fetch()` عادي من وركر إلى اسم مضيف آخر على النطاق نفسه يذهب إلى أصل النطاق، لا إلى ذلك الوركر. الربط يجري استدعاءً مباشرًا. و`global_fetch_strictly_public` يجعل الطلب يخرج عبر الإنترنت بدلًا من ذلك.

## النوع والتقنيات والمستودع وصفحة المساحة (0.15.1)

اختياري عند النشر (`PUT`) أو لاحقًا بـ `POST /api/teams/<team>/workers/<name>/links` (MCP: `set_worker_links`، الواجهة: تبويب إعدادات الوركر):

```json
{ "meta": { "kind": "mcp", "language": "typescript", "framework": "hono", "toolsCount": 2, "spaceSlug": "<space id>" },
  "repo": { "url": "https://github.com/org/repo", "branch": "main", "commitSha": "<sha>" },
  "spaceId": "<space id>" }
```

بدون `meta` تخمّن اللوحة من الكود، ولخوادم MCP تفحص `/mcp` للقراءة فقط (`initialize` + `tools/list`، تخزين مؤقت لساعة، ولا `tools/call` أبدًا). تُفحص المستودعات للقراءة فقط على GitHub وتُخزَّن مؤقتًا ١٥ دقيقة. إذا ضبط الخادم `GITHUB_TOKEN` فيستطيع التمييز بين المستودعات الخاصة والمفقودة؛ ويُستخدم المفتاح على الخادم فقط. كل وركر مُعلن أو مكتشف كـ MCP يُدرج في **خوادم MCP** في اللوحة، مع عمودي الصحة والطلبات خلال ٢٤ ساعة (0.16.0).

ابدأ من القالب: `GET /api/recipes/mcp-server-on-worker/starter.zip`. إذا فشل شيء، اترك ملاحظة: `POST /api/teams/<team>/notes` (انظر وصفة *ملاحظات الوكلاء*).

## المتغيرات والأسرار والصحة والسجلات والاستخدام (0.15.2)

- تبويب **المتغيرات والأسرار**: الأسماء والأنواع وأنواع Cloudflare والحالة (مضبوط / فارغ / مفقود / غير مضبوط) لكل
  متغير وسر وربط، تُقرأ مباشرة من Cloudflare. القيم لا تُعرض ولا تُعاد أبدًا. اضبط سرًا أو دوّره
  بـ `PUT /api/teams/<team>/workers/<name>/secrets/<NAME>` `{"value":"…"}` (للكتابة فقط، بلا
  إعادة نشر؛ مفاتيح الوكلاء تحتاج `workers:secrets` أو `workers:deploy`)، وأزله بـ `DELETE`. المتغيرات العادية:
  `PUT|DELETE …/vars/<NAME>` (يعيد نشر أحدث كود محفوظ). أعلن ما يحتاجه الكود بـ
  `"requiredEnv": ["API_KEY", …]` عند النشر. منذ 0.16.0 فقط الأسماء **المعلنة** غير المضبوطة تكون
  `missing` (تحذير). الأسماء التي يقرؤها الكود بلا قيمة افتراضية (`env.X`، وليس `env.X ?? …` أو
  `env.X || …`) وليست معلنة ولا مضبوطة تُدرج كـ `unset`: صف معلومات باهت، لا تحذير.
  `GET …/env` (MCP: `worker_env`) يُعيد العرض نفسه: `{entries, missing, unset, requiredEnv, source}`.
- **الصحة**: تفحص Spaces كل وركر كل ٥ دقائق. فشلان متتاليان = متوقف: إشعار واحد
  (جرس + Webhooks) عند التوقف وواحد عند التعافي. `GET|POST …/health` (`{"enabled": false}`
  يطفئه، و`{"check": true}` يفحص الآن). يضبط المسؤول الفترة في الإعدادات. ما يُعدّ «يعمل»
  (0.16.0):
  - وركرات الويب: طلب GET للرابط يُجيب **بأقل من 400** (404 على `/` يعني متوقف)؛
  - خوادم MCP: `initialize` في MCP (2xx، أو 401/403 للخوادم التي لها مصادقتها الخاصة)، أو GET بأقل من 500؛
  - قاعدتك الخاصة: أعلن `"meta": {"healthPath": "/health", "healthExpect": "2xx"}` عند النشر، أو بـ
    `POST …/links`، أو بـ `POST …/health {"healthPath": "/health", "healthExpect": "200-399"}`، أو في
    تبويب الصحة. يقبل `healthExpect` القيم `2xx` و`200-299` و`200,404` و`<400`، مفصولة بفواصل. فارغ = الافتراضي.
  - الوركرات التي أجابت بـ 4xx على `/` قبل 0.16.0 تحتفظ بالقاعدة القديمة «أقل من 500» (معلّمة في تبويب
    الصحة) حتى تعلن مسارًا أو حالة متوقعة، فلا تُطلق الترقية إنذارات كاذبة.
- **السجلات**: `GET …/logs` — أعداد الأخطاء بالساعة والحالة من تحليلات Cloudflare، إضافة إلى أسطر Workers Logs
  عند تشغيلها بـ `POST …/logs {"enabled": true}`. السلاسل التي تشبه الأسرار تُحجب.
- **الاستخدام**: `GET …/usage?range=24h|7d|30d` — الطلبات والأخطاء ومتوسط CPU والطلبات لكل مفتاح مستخدم نهائي.
- يحتاج مفتاح Cloudflare صلاحية **Account · Account Analytics: Read** لأعداد الاستخدام والأخطاء و
  **Account · Workers Observability: Edit (API: Write)** لأسطر السجلات (صلاحية *Read*
  وحدها يرفضها استعلام السجلات بـ 403)؛ تفحص صفحة إعدادات الإدارة كل صلاحية
  بفحوص للقراءة فقط وتعرض أضواء خضراء/حمراء/رمادية.

## مهام النشر والفحص والجدولة والتخزين الخاص (0.17.0)

### النشر يردّ في الوقت: المهام و202

كل عملية نشر (`PUT|POST …/workers[/<name>]` و`POST …/redeploy` و`POST …/rollback` و`POST …/runtime`) صارت
**مهمة** (job). لكل فريق طابوره الخاص، فلا يؤخّر نشرٌ بطيء لفريقٍ فريقًا آخر.

- **الافتراضي (لا يتغير شيء للسكربتات الحالية):** ينتظر الطلب انتهاء النشر حتى ٦٠ ثانية ويردّ `200/201` كما
  كان، مع إضافة `health` و`job`. رقم المهمة في الترويسة `X-Marsa-Job`.
- إن بقي النشر جاريًا بعد الانتظار، يكون الرد **`202 Accepted`** مع `{"job": {"id", "status", "statusUrl", …}}`
  والترويسة `Location` و`Retry-After: 5`. استعلم `GET /api/teams/<team>/jobs/<id>` حتى يصبح `done` = `true`.
  قيم `status`: `queued` و`running` و`succeeded` و`failed` و`interrupted`. المهمة الناجحة فيها `version`
  و`health`، والفاشلة فيها `error: {status, code, message}`.
- `?wait=0…90` يحدد الانتظار بالثواني. `?async=1` أو الترويسة `Prefer: respond-async` تردّ `202` مباشرة
  بعد الفحوص أدناه.
- `GET /api/teams/<team>/jobs?worker=<name>` يعرض المهام الأخيرة (تُحفظ ٧ أيام). المهمة التي كانت جارية عند
  إعادة تشغيل الخادم تصبح `interrupted`: انشر مرة أخرى.
- كل فشل يُسجَّل في سجل نشاط الفريق باسم `worker-deploy-fail`
  (`GET /api/teams/<team>/activity?action=worker-deploy-fail`) مع رمز الخطأ ورسالته.

```bash
curl -s -X PUT "https://spaces.marsaplatform.com/api/teams/<team>/workers/news?async=1" \
  -H "X-Team-Key: $MARSA_AGENT_KEY" -H "content-type: application/javascript" --data-binary @dist/worker.js
# => 202 {"job":{"id":"job_…","status":"queued","statusUrl":"…/api/teams/<team>/jobs/job_…"}}
curl -s "https://spaces.marsaplatform.com/api/teams/<team>/jobs/job_…" -H "X-Team-Key: $MARSA_AGENT_KEY"
```

### فحص الكود قبل الرفع

قبل إرسال أي شيء إلى Cloudflare يُحلَّل الكود بـ esbuild:

| الرمز | HTTP | المعنى |
| --- | --- | --- |
| `SYNTAX_ERROR` | 400 | الكود لا يُحلَّل؛ الرسالة فيها السطر والعمود |
| `MISSING_MODULE` | 400 | `import` لحزمة (مثل `hono`) غير موجودة في الملف. اجمع الكود أولًا: `esbuild src/index.ts --bundle --format=esm --outfile=dist/worker.js`. استيراد `cloudflare:*` و`node:*` مسموح |
| `NOT_A_MODULE` | 400 | لا يوجد تصدير افتراضي (default export) |
| `VALIDATION_FAILED` | 400 | رفضت Cloudflare السكربت (خطؤها 10021، مثل استثناء عند البدء)؛ الرسالة توضّح السبب |

كل أشكال التصدير الافتراضي مقبولة: `export default {…}` و`export default app` و`export { app as default }`
و`export default class …`.

بعد النشر الناجح يطلب Spaces الوركر مرة واحدة (`meta.healthPath` أو `/`) ويُعيد
`health: {path, status, ms, ok}` (`ok` = أقل من 500). `?health=0` يتخطى هذا الطلب. إن لم يصل رد، يوضّح
`error` السبب (مثل خطأ TLS أو DNS). ولنطاق أُنشئ قبل دقائق، يذكر `note` أن وصول DNS إلى كل المحلِّلات قد يستغرق
بضع دقائق: تحقّق مجددًا بـ `GET …/health`.

### المشغّلات المجدولة (Cron)

```json
{ "code": "…", "crons": ["*/30 * * * *"] }
```

- تعابير cron من خمسة حقول بتوقيت UTC (`الدقيقة الساعة اليوم الشهر يوم-الأسبوع`؛ الأسماء مثل `mon-fri` مقبولة)،
  حتى ٣ لكل وركر. يجب أن يفصل بين التشغيلين **١٠ دقائق** على الأقل (`WORKER_CRON_MIN_MINUTES`).
- يحتاج الوركر دالة `scheduled`: `export default { fetch(…) {…}, async scheduled(controller, env, ctx) {…} }`.
- الحصص: مشغّلان لكل فريق ما لم يضبط المسؤول `maxCrons`؛ وفوقها `409 CRON_QUOTA`. خطة Cloudflare المجانية
  تسمح بـ ٥ مشغّلات للحساب كله، مشتركة مع وركرات أخرى: `409 CRON_ACCOUNT_LIMIT` حين يمتلئ الحساب.
- احذف الحقل لإبقائها، و`[]` أو `null` لإزالتها. تعطيل الوركر يوقفها مؤقتًا، وحذفه يزيلها. متاحة أيضًا في
  `POST …/runtime` وفي أداتي MCP `deploy_worker` و`set_worker_runtime`.

### تخزين خاص لكل وركر (KV)

```json
{ "code": "…", "storage": "kv" }
```

- `"storage": "kv"` ينشئ مساحة Cloudflare KV لا يستخدمها إلا هذا الوركر، مربوطة باسم **`env.STORE`**:
  `await env.STORE.put("key", "value")` و`await env.STORE.get("key")` و`env.STORE.list({prefix})`.
- **حذف الوركر يحذف المساحة وكل بياناتها.** و`"storage": null` يحذفها بالطريقة نفسها. احذف الحقل لإبقائها.
  صدّر بياناتك أولًا إن كنت تحتاجها.
- الاسم `STORE` محجوز: لا يجوز استخدامه لمتغير أو سر ما دام التخزين مفعّلًا.
- الحصص: ٣ وركرات بتخزين لكل فريق ما لم يضبط المسؤول `maxKvWorkers` (`409 KV_QUOTA`)، وحدّ للحساب
  (`409 KV_ACCOUNT_LIMIT`). إن لم يكن لمفتاح المنصة صلاحية *Workers KV Storage: Edit* يُرفض النشر بـ
  `503 KV_NOT_PERMITTED` ولا يتغير شيء.
- تنطبق حدود Cloudflare KV (الخطة المجانية: ١٬٠٠٠ كتابة و١٠٠٬٠٠٠ قراءة يوميًا للحساب، و٢٥ ميغابايت للقيمة).
  KV متّسق في النهاية: قد تستغرق الكتابة حتى دقيقة لتظهر في كل مكان.

### قراءة إعدادات التشغيل

`GET /api/teams/<team>/workers/<name>/runtime` (صلاحية `workers:read`) يُعيد
`{runtime: {compatibilityDate, compatibilityFlags, bindings, crons, storage, logs, varNames, secretNames},
allowedCompatibilityFlags, limits}`. في `limits` حدود المتغيرات: حتى ٣٢ متغيرًا للوركر، و٣٢ كيلوبايت للقيمة
و٦٤ كيلوبايت إجمالًا (رُفعت من ٥ كيلوبايت في 0.14.0)، مع حصص الجدولة والتخزين لفريقك.

### عملاء يحصلون على خطأ Cloudflare رقم 1010 (Python `urllib` وبعض أدوات سطر الأوامر)

النطاق مفعّل عليه **فحص سلامة المتصفح** (Browser Integrity Check) من Cloudflare. يرفض الطلبات التي يبدو
`User-Agent` فيها كسكربت (القيمة الافتراضية لـ `urllib` في Python: `Python-urllib/3.x`) بالخطأ **1010**، قبل أن
يصل الطلب إلى وركرك. إلى أن يُفعَّل استثناء المنصة، أرسل أي User-Agent عادي:

```python
import urllib.request
req = urllib.request.Request(url, headers={"User-Agent": "my-agent/1.0 (+https://example.com)"})
urllib.request.urlopen(req)
```

`requests` و`httpx` و`curl` والمتصفحات لا تتأثر. يستطيع المسؤول تفعيل استثناء لنطاقات وركرات الفرق
(`PUT /api/admin/workers/bic {"enabled": true}`): قاعدة إعدادات واحدة في Cloudflare تُطفئ الفحص لنطاقات وركرات
الفرق فقط. تحتاج صلاحية المفتاح **Zone · Config Rules: Edit** (مؤشر في الإعدادات › صلاحيات Cloudflare)؛ ومن
دونها لا يتغير شيء.

## التشغيل والمراقبة

بعد أن يصبح الوركر حيًا، يستطيع وكيل (أو أنت) تشغيله بلا مفتاح Cloudflare:

١. **أعلن ما يحتاجه**: `requiredEnv` عند النشر. تبويب المتغيرات والأسرار و`GET …/env`
   (`worker_env`) يعرضان المضبوط، و`missing` (معلن وغير مضبوط)، و`unset` (مستخدم في الكود، للمعلومة فقط).

٢. **اضبط الأسرار** بـ `PUT …/secrets/<NAME>` أو `set_worker_secret` (الصلاحية `workers:secrets`). القيم
   للكتابة فقط ولا تُعاد أبدًا.

٣. **افحصه**: `GET …/health` و`GET …/usage` (في MCP: `worker_status` يُعيد الصحة والاستخدام و
   الأخطاء الأخيرة في استدعاء واحد). `GET …/logs` لأسطر الأخطاء (شغّل Workers Logs أولًا).

٤. **أصلح وأعد النشر**: `redeploy_worker` / `rollback_worker`. كل خطوة في سجل نشاط الفريق
   (`GET /api/teams/<team>/activity`، مفتاح الفريق).

## أدوات MCP

عندما تكون الوركرات مفعّلة للفريق، يقدّم خادم MCP للمساحة (انظر [خادم MCP لكل مساحة](mcp.md)) هذه الأدوات أيضًا، بالقواعد نفسها كالـ API:

| الأداة | المفتاح | ما تفعله |
| --- | --- | --- |
| `list_workers` | ro | وركرات الفريق (الأسماء والروابط والحالة والإصدارات) |
| `list_worker_versions` / `get_worker_version` | ro | الإصدارات المحفوظة، وكود إصدار واحد |
| `worker_env` | ro | أسماء المتغيرات والأسرار والربط وأنواعها وحالتها؛ أسماء `missing` و`unset`. لا قيم أبدًا |
| `worker_status` | ro | الصحة (مدة التشغيل، زمن الاستجابة)، والاستخدام (الطلبات، الأخطاء، CPU؛ `range` 24h/7d/30d) والأخطاء الأخيرة |
| `deploy_worker` / `redeploy_worker` / `rollback_worker` / `delete_worker` | rw | النشر، وإعادة نشر أحدث إصدار، والرجوع، والحذف |
| `set_worker_secret` | rw | ضبط سر واحد أو تدويره أو إزالته (للكتابة فقط) |
| `set_worker_runtime` | rw | علامات التوافق وربط الخدمات |
| `set_worker_links` | rw | النوع المعلن واللغة ورابط المستودع وصفحة المساحة ومسار الصحة |
| `list_user_keys` / `create_user_key` / `revoke_user_key` | ro / rw | مفاتيح API لمستخدمي الوركر |

## مفاتيح API لمستخدمي وركرك (0.14.0)

احمِ خادم MCP عامًا (أو أي وركر) بمفاتيح لكل مستخدم تُدار في Spaces. الشرح الكامل: وصفة [احمِ خادم MCP بمفاتيح Spaces](https://marsa.example.com/ar/docs/recipes/protect-mcp-with-keys).

- شغّل **اشتراط مفاتيح API** (الفريق ← الوركرات ← *مفاتيح API*، أو `PUT /api/teams/<team>/workers/<name>/keys/settings` مع `{"required": true, "perMinute": 60, "perDay": 5000}`). تضبط Spaces سرّين للوركر: `MARSA_KEYS_URL` و`MARSA_KEYS_SECRET` (أداة تحقق لكل وركر؛ لا تُعرض أبدًا). لا يُدرجان مع أسرارك، والأسماء التي تبدأ بـ `MARSA_KEYS_` محجوزة.
- إنشاء المفاتيح: `POST …/keys` مع `{"label","email"?,"expiresInDays"?,"perMinute"?,"perDay"?,"tools"?}`. يُعاد المفتاح (`msk_…`) مرة واحدة؛ وتحفظ Spaces بصمة SHA-256 وبادئة. `DELETE …/keys/<id>` يلغيه. `GET …/keys` يعرض الإعدادات والمفاتيح والاستخدام (اليوم، ٧ أيام، أخطاء 429، آخر استخدام).
- في الوركر، الصق المساعد من `/api/keys/helper.v2.js` (رابط بإصدار؛ و`/api/keys/helper.js` القديم يحوّل إليه) واستدعِ `await requireKey(request, env, { tool })` قبل أي عمل. يقرأ `Authorization: Bearer <key>` أو `X-Api-Key`، ويستدعي `POST /api/keys/verify`، ويُعيد `{ ok, response }` (401 مفقود/غير صالح/ملغى/منتهٍ، و403 أداة غير مسموحة، و429 تجاوز حد مع `Retry-After`).
- يجري العدّ في خادم Spaces (في الذاكرة، ويُحفظ كل ١٥ ثانية تقريبًا). افتراضيًا يفحص المساعد كل طلب مع Spaces، فالحدود دقيقة. التخزين المؤقت اختياري: `requireKey(request, env, { tool, cache: 30 })` يحتفظ بالسماح حتى ٣٠ ثانية (ولا يتجاوز أبدًا الحصة المتبقية للدقيقة) ويبلّغ عن الاستخدامات المخزنة في الفحص التالي. لكل نسخة معزولة من الوركر تخزينها الخاص وقد تشغّل Cloudflare عدة نسخ في آن واحد، فمع التخزين المؤقت قد يتجاوز مفتاح حده في الدقيقة بمقدار حصته المتبقية لكل نسخة (في اختبار حي بحد ٣ في الدقيقة: مرّ ٤–٥ طلبات قبل أخطاء 429). إذا تعذّر الوصول إلى Spaces يفشل المساعد مغلقًا (503) إلا إذا مرّرت `failOpen: true`.
- يحصل المالكون على إشعار عند إنشاء مفتاح أو إلغائه وعندما تتجاوز أخطاء 429 لوركر ١٠ و١٠٠ و١٠٠٠ في اليوم. حذف الوركر يحذف مفاتيحه.
- الصلاحيات: القراءة تحتاج `workers:read`؛ والإعدادات والإنشاء والإلغاء تحتاج `workers:deploy`. أدوات MCP: `list_user_keys` و`create_user_key` و`revoke_user_key`.

## API الإدارة

كلها مع `Authorization: Bearer $ADMIN_TOKEN`:

- `GET /api/admin/workers/settings` و`PUT /api/admin/workers/settings` (`{"token","accountId"?,"zone"?}`) و`POST /api/admin/workers/settings/verify` و`DELETE /api/admin/workers/settings` (فقط عند عدم وجود وركرات للفرق).
- `PUT /api/admin/teams/<id>/workers` (`{"enabled", "slug", "maxWorkers", "maxWorkerKb", "maxCrons", "maxKvWorkers"}`)؛ `enabled: false` يحذف وركرات الفريق.
- `GET|PUT /api/admin/workers/bic` (`{"enabled": true|false}`): استثناء فحص سلامة المتصفح لنطاقات وركرات الفرق (0.17.0).
- `GET /api/admin/workers` و`POST /api/admin/workers/<id>/disable|enable` و`DELETE /api/admin/workers/<id>`.

## إعدادات الخادم

| المتغير | الافتراضي | |
| --- | --- | --- |
| `MARSA_SECRETS_KEY` | (فارغ) | مطلوب للوركرات: ٣٢ حرفًا عشوائيًا على الأقل (`openssl rand -hex 32`). أبقه خارج النسخ الاحتياطية لمجلد البيانات. |
| `WORKERS_DEFAULT_MAX` | `3` | الوركرات لكل فريق ما لم يضبط المسؤول حصة |
| `WORKER_MAX_KB` | `1024` | حجم السكربت لكل فريق ما لم يضبط المسؤول حصة |
| `WORKERS_COMPAT_DATE` | `2025-09-01` | تاريخ توافق Cloudflare للسكربتات المنشورة |
| `WORKER_DEPLOY_WAIT_SEC` | `60` | مدة انتظار طلب النشر قبل الرد بـ `202` ومهمة (حتى ٩٠) |
| `WORKER_CRON_MIN_MINUTES` | `10` | أقصر فاصل مسموح بين تشغيلين مجدولين |
| `WORKER_CRONS_PER_TEAM` | `2` | المشغّلات المجدولة لكل فريق ما لم يضبط المسؤول `maxCrons` |
| `WORKER_CRON_ACCOUNT_MAX` | `5` | المشغّلات التي يسمح بها حساب Cloudflare (المجانية ٥، المدفوعة ٢٥٠) |
| `WORKER_KV_PER_TEAM` | `3` | الوركرات ذات التخزين الخاص لكل فريق ما لم يضبط المسؤول `maxKvWorkers` |
| `WORKER_KV_ACCOUNT_MAX` | `100` | مساحات KV التي يحق لـ Spaces الاحتفاظ بها في الحساب |
| `VAR_VALUES_SUNSET` | `2026-10-28T12:00:00Z` | نهاية الفترة التي ما زالت فيها القوائم تُعيد قيم المتغيرات العادية (انظر [قيم المتغيرات](#قيم-المتغيرات)) |

غير متوفر بعد: متابعة السجلات مباشرة (استخدم لوحة Cloudflare)، والربط بغير المتغيرات والأسرار وخدمات الفريق نفسه وتخزين KV الخاص (لا D1 ولا R2 ولا Durable Objects)، والحزم متعددة الملفات (اجمعها أولًا، مثلًا بـ `esbuild --bundle --format=esm`).
