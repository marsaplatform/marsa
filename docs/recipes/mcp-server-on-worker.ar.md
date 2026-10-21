---
title: سيرفر MCP على وركر في المساحات
summary: الطريقة المعتمدة لبناء سيرفر MCP عن بُعد ونشره على المساحات. قالب جاهز للتنزيل بـ TypeScript وHono وحزمة MCP الرسمية، يُنشر بدون wrangler، ومعه اختبارات وفحص حي.
version: 4
updated: 2026-10-21
tags: mcp, workers, typescript, hono, starter
order: 1
---
## ابدأ من هنا

**نزّل القالب:** [`starter.zip`](/api/recipes/mcp-server-on-worker/starter.zip). شجرة الملفات معروضة أعلاه. القالب يُبنى وينجح في اختباراته، وجرّبناه بالنشر على فريق مؤقت عبر API المساحات قبل هذا الإصدار.

```sh
curl -sLo starter.zip https://marsa.example.com/api/recipes/mcp-server-on-worker/starter.zip
unzip starter.zip -d my-mcp && cd my-mcp && npm install && npm run check
```

## الهدف

سيرفر MCP عن بُعد على `https://<team>-<name>.marsaplatform.com/mcp` يضيفه أي عميل MCP بالرابط فقط. يعمل كوركر للفريق يُنشر عبر المساحات، فلا يحتاج أحد إلى حساب Cloudflare أو رمز أو تسجيل دخول في wrangler. ويعمل مع مفاتيح المساحات والإصدارات والرجوع والربط بين الوركرز وصفحة «سيرفرات MCP» في لوحة التحكم.

## أي تقنية؟ (توصية صريحة)

| | المعتمد: **TypeScript + Hono على Workers** | Python (استضافة ذاتية) |
|---|---|---|
| أين يعمل | وركر في المساحات: بلا سيرفر تديره، منتشر عالميًا، وبدء تشغيل سريع | جهازك أو حاويتك (راجعوا وصفة *سيرفر MCP بلغة Python باستضافة ذاتية*) |
| مكتبة MCP | `@modelcontextprotocol/sdk` الرسمية + zod | `mcp` / FastMCP |
| يناسب | أدوات بحث واستعلام فوق واجهات HTTP، والخلاصات، والبيانات المرجعية الصغيرة | pandas/numpy/scikit، والملفات الكبيرة، والمهام الطويلة، وقاعدة بيانات بجانبه |
| القيود | وحدة ES واحدة، وحدود لوقت المعالج، بلا وحدات أصلية، والحزمة ضمن حصة الفريق (1 ميجا افتراضيًا) | أنتم مسؤولون عن التحديثات وTLS والتشغيل المستمر والتوسع |

ماذا وجدنا في المستودعات الفعلية: **أطلس وملجأ وERX** كلها تستخدم حزمة MCP الرسمية مع zod. أطلس يعمل على Workers بـ `WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })` و`CfWorkerJsonSchemaValidator`، وينشئ `McpServer` جديدًا لكل طلب، ويستخدم Bun للتطوير والاختبارات وwrangler للنشر. ملجأ وERX يستخدمان Node وtsx وvitest. **لا يستخدم أيٌّ منها Hono**. أضاف القالب Hono للتوجيه فقط (`/` و`/health` و`/mcp` و404 وCORS)، وحجمه نحو 56 ك.ب، ويُبقي الكود مقروءًا كلما زادت المسارات. ويمكن الاستغناء عنه بتوجيه `fetch` عادي بالطريقة نفسها.

**Bun** مناسب على جهازكم (`bun install` و`bun run build:bun` و`bun x vitest run`). أما ما يُنشر فيجب أن يكون دائمًا **وحدة ES واحدة لـ Workers** (`dist/worker.js` فيها `export default { fetch }`)، بلا واجهات خاصة بـ Bun أو Node (`Bun.*` و`fs` و`child_process`).

## هيكل المجلدات

```
my-mcp-worker/
├── src/
│   ├── index.ts            # تطبيق Hono: / و/health وPOST /mcp وGET/DELETE /mcp → 405 و404؛ export default { fetch }
│   ├── env.d.ts            # أنواع المتغيرات والأسرار والربط
│   ├── mcp/server.ts       # createServer(): سيرفر MCP جديد لكل طلب؛ TOOL_NAMES
│   ├── tools/<tool>.ts     # ملف لكل أداة: مدخلات zod، تقسيم صفحات، مطابقة عربية، ok()/fail()
│   ├── lib/http.ts         # fetchJson(): User-Agent ثابت، مهلة، إعادة محاولة عند 429/5xx
│   ├── lib/cache.ts        # cached(key, ttl, fn): ذاكرة مؤقتة داخل الـ isolate
│   ├── lib/arabic.ts       # normalize()/matches(): الألف والياء والتاء المربوطة والتشكيل والتطويل
│   ├── lib/result.ts       # أشكال نتائج الأدوات
│   ├── i18n/index.ts       # رسائل عربية وإنجليزية
│   └── data/               # بيانات تجريبية (استبدلوها بمصدركم)
├── test/                   # vitest: مسارات HTTP، initialize، tools/list، كل أداة، المكتبات
├── scripts/dev.ts          # سيرفر محلي على :8787
├── scripts/size.mjs        # فحص: وحدة ES واحدة بتصدير افتراضي وضمن الحصة
├── scripts/deploy.ts       # PUT إلى API المساحات (بلا wrangler) مع meta وrepo
├── scripts/smoke.ts        # فحص حي: /health، initialize، tools/list، استدعاء واحد
├── README.md / README.ar.md
├── .env.example            # MARSA_URL, MARSA_TEAM, MARSA_AGENT_KEY, WORKER_NAME
└── package.json, tsconfig.json
```

## قواعد التسمية وتصميم الأدوات

- **اسم الوركر**: من 1 إلى 30 حرفًا من `a-z 0-9 -`، مثل `news` و`atlas-mcp`. يصبح الرابط `https://<team-slug>-<name>.marsaplatform.com`.
- **أسماء الأدوات**: `فعل_اسم` بصيغة snake_case (`search_items` و`get_item` و`list_cities`). من 3 إلى 7 أدوات، وكل أداة تؤدي مهمة واحدة.
- **المدخلات**: مخطط zod مع `.describe()` لكل حقل، وتحوّله الحزمة إلى JSON Schema في `tools/list`. استخدموا قوائم ثابتة للخيارات وحدودًا للأرقام (`limit` من 1 إلى 50، والافتراضي 10).
- **الإدخال العربي**: اقبلوا العربية والإنجليزية. وحّدوا النص قبل المطابقة (أ/إ/آ→ا، ى→ي، ة→ه، واحذفوا التشكيل والتطويل)، واقبلوا `lang: "ar" | "en"` للغة النتائج.
- **تقسيم الصفحات**: `limit` مع `cursor` غير شفاف، وأعيدوا `nextCursor` (وقيمته null في النهاية). لا تُرجعوا أكثر من نحو 50 عنصرًا.
- **المخرجات**: JSON مختصر (معرّفات وعناوين وروابط وتواريخ) في `structuredContent` وكنص. بلا صفحات HTML.
- **الأخطاء**: لا ترموا استثناءً من داخل أداة. أعيدوا `isError: true` مع `{ code, message }` (`NOT_FOUND` و`INVALID_INPUT` و`UPSTREAM_UNAVAILABLE` و`RATE_LIMITED`) ورسالة يستطيع المستخدم أن يتصرف بناءً عليها.
- **التعليقات التوضيحية**: `readOnlyHint: true` لأدوات الاستعلام، و`destructiveHint` لأي أداة تكتب.

## قواعد الوركر

- المسارات: `POST /mcp` (‏Streamable HTTP بلا حالة وبردود JSON: `enableJsonResponse: true` وبلا معرّف جلسة)، و`GET /mcp` و`DELETE /mcp` ← 405، و`GET /health` ← `{"ok":true,"version":"…"}`، و`GET /` ← صفحة قصيرة أو رابط لصفحة مشروعكم في المساحات.
- **الأسرار** (رموز المصادر الخارجية) تُرسل في `secrets` عند النشر. هي للكتابة فقط، ولا يرى الفريق إلا أسماءها. لا تضعوها أبدًا في الكود أو `vars` أو المستودع أو README.
- **المتغيرات** للإعدادات غير السرية: حتى 32 ك.ب لكل متغير و64 ك.ب إجمالًا. البيانات الأكبر مكانها KV/ملفات المساحة أو رابط خارجي.
- كل طلب لمصدر خارجي يحمل **User-Agent ثابتًا** و**مهلة** (8 ثوانٍ) و**إعادة محاولة** متدرّجة عند 429/5xx (`src/lib/http.ts`).
- خزّنوا البيانات المرجعية على مستوى الوحدة (`src/lib/cache.ts`) واستجابات GET في `caches.default`. لا تخزّنوا أبدًا إجابات خاصة بمستخدم.

## البناء والاختبار محليًا

```sh
npm run dev       # http://localhost:8787/mcp (‏Node عبر @hono/node-server)
npm test          # vitest: مسارات HTTP، initialize، tools/list، كل أداة
npm run build     # esbuild src/index.ts --bundle --format=esm --platform=browser --target=es2022 --minify --outfile=dist/worker.js
npm run build:bun # المخرج نفسه بـ: bun build src/index.ts --target=browser --format=esm --minify --outfile=dist/worker.js
npm run check     # فحص الأنواع + الاختبارات + البناء + فحص الحجم (وحدة ES واحدة بتصدير افتراضي، أقل من 1 ميجا)
```

حجم حزمة القالب نحو 400 ك.ب، أكثره من zod (253 ك.ب) وajv (206 ك.ب، تجلبه حزمة MCP) والحزمة نفسها (183 ك.ب) وHono (56 ك.ب) قبل التصغير. حصة فريقكم معروضة في صفحة الوركرز.

## النشر عبر المساحات (بلا wrangler)

يشغّل `scripts/deploy.ts` الأمر `npm run check`، ثم يرسل `dist/worker.js` مع ملاحظة والبيانات المُعلنة ومستودع git:

```sh
cp .env.example .env   # MARSA_URL, MARSA_TEAM, MARSA_AGENT_KEY (بصلاحية workers:deploy), WORKER_NAME. لا ترفعوا .env أبدًا
set -a; . ./.env; set +a
npm run deploy
```

وهذا ما يرسله كطلب عادي:

```sh
curl -s -X PUT "$MARSA_URL/api/teams/$MARSA_TEAM/workers/$WORKER_NAME" \
  -H "X-Team-Key: $MARSA_AGENT_KEY" -H "content-type: application/json" \
  --data-binary @- <<JSON
{ "code": $(jq -Rs . < dist/worker.js),
  "note": "v1.2.0: add get_item",
  "vars": { "DATA_URL": "https://example.org/data.json" },
  "requiredEnv": ["DATA_URL", "UPSTREAM_TOKEN"],
  "secrets": { "UPSTREAM_TOKEN": "…من مخزن أسراركم…" },
  "meta": { "kind": "mcp", "language": "typescript", "framework": "hono", "toolsCount": 2, "spaceSlug": "<معرّف المساحة>" },
  "repo": { "url": "https://github.com/<org>/<repo>", "branch": "main", "commitSha": "<git rev-parse HEAD>" } }
JSON
```

- **`meta`** (اختياري): يخبر لوحة التحكم بنوع الوركر. من دونه تستنتج المساحات النوع من الكود، وتفحص `/mcp` فحص قراءة فقط (`initialize` و`tools/list`، مع تخزين مؤقت، ودون `tools/call` أبدًا). قيم `kind` هي: `mcp` أو `web` (موقع/API) أو `other`. ويربط `spaceSlug` الوركر بصفحة مشروعه في المساحات.
- **`repo`** (اختياري): يظهر في عمود المستودع. تتحقق المساحات من GitHub قراءةً فقط وتخزّن النتيجة: عام أو خاص أو غير موجود، ومتزامن أو متأخر عن الفرع.
- **`requiredEnv`** (اختياري، 0.15.2): أسماء متغيرات البيئة التي يحتاجها الكود. يُظهر تبويب **المتغيرات والأسرار** في صفحة الوركر أي اسم ناقص (وأيضًا الأسماء التي يراها في الكود بصيغة `env.X`). لإضافة سر أو تغييره لاحقًا دون إعادة نشر: `PUT /api/teams/<team>/workers/<name>/secrets/<NAME>` مع `{"value":"…"}` (كتابة فقط؛ لا تُرجع القيمة أبدًا)، و`DELETE` لحذفه، أو أداة MCP ‏`set_worker_secret`. يحتاج مفتاح الإيجنت صلاحية `workers:secrets` (أو `workers:deploy`).
- بعد النشر راجع `GET …/workers/<name>/health` و`…/usage?range=24h` و`…/logs` (أو أداة MCP ‏`worker_status`). وإذا بقي شيء معطّلًا فاترك ملاحظة.
- لتغيير `meta` أو `repo` أو المساحة المربوطة لاحقًا دون إعادة نشر: `POST /api/teams/<team>/workers/<name>/links`، أو أداة MCP ‏`set_worker_links`، أو تبويب **الإعدادات** في صفحة الوركر.

عبر MCP (إيجنت متصل بـ MCP إحدى المساحات): تقبل أداة `deploy_worker` الحقول نفسها: `code` و`vars` و`secrets` و`meta` و`repo` و`compatibilityFlags` و`bindings`.

## التحقق الحي

```sh
URL=https://<team>-<name>.marsaplatform.com npm run smoke
# أو يدويًا:
U=https://<team>-<name>.marsaplatform.com
curl -s $U/health
curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}'
curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_items","arguments":{"query":"مكتبة","limit":3}}}'
```

بعدها يظهر الوركر في صفحة **سيرفرات MCP** في لوحة التحكم، مع عنوانه وعدد أدواته وتقنيته وحالة مستودعه ومفاتيحه.

## قائمة الفحص قبل النشر

- [ ] ينجح `npm run check`: فحص الأنواع والاختبارات والبناء وفحص الحجم (وحدة ES واحدة فيها `export default { fetch }`).
- [ ] لا رمز ولا كلمة مرور ولا مفتاح في الكود أو `vars` أو المستودع أو README أو الاختبارات. مكانها `secrets`، و`.env` مُدرج في `.gitignore`.
- [ ] كل طلب خارجي يحمل User-Agent ومهلة وإعادة محاولة.
- [ ] `/health` يعيد 200، و`GET /mcp` يعيد 405، والمسارات المجهولة تعيد 404.
- [ ] أوصاف الأدوات تذكر ما تُرجعه وعدد العناصر واللغة.
- [ ] الإدخال العربي مُختبر، والتقسيم يُرجع `nextCursor`.
- [ ] ‏`note` و`meta` في النشر، و`repo` مع الـ commit الذي بنيتموه.
- [ ] بعد النشر ينجح الفحص الحي (`initialize` و`tools/list` واستدعاء واحد).

## الإصدارات والرجوع

يُحفظ كل نشر كإصدار (آخر 10)، مع الكود والمتغيرات والأعلام والربط والملاحظة وSHA-256، دون قيم الأسرار. للرجوع إلى إصدار سابق: من صفحة الوركر (**الإصدارات**)، أو `POST /api/teams/<team>/workers/<name>/rollback {"version": 3}`، أو أداة MCP ‏`rollback_worker`. ولإعادة نشر أحدث إصدار: `redeploy_worker`. اكتبوا رقم إصداركم في `/health` وفي `note` النشر ليتطابقا.

## الحماية بمفاتيح المساحات

لتحديد من يستطيع الاستدعاء، فعّلوا **طلب مفاتيح API** في تبويب مفاتيح API للوركر وأضيفوا المساعد (راجعوا وصفة *احموا MCP بمفاتيح المساحات*). يحصل كل مستخدم على مفتاح `msk_…` بحدود في الدقيقة واليوم، وقائمة أدوات اختيارية، وتاريخ انتهاء، وإحصاءات استخدام. وتعرض صفحة **سيرفرات MCP** حالة الحماية لكل سيرفر، وفيها زر *مفاتيح المستخدمين*.

## استدعاء وركر آخر من فريقكم

استدعاء `fetch("https://<team>-news.marsaplatform.com")` العادي من وركر على النطاق نفسه يذهب إلى الخادم الأصلي لا إلى الوركر الآخر. استخدموا أحد الطريقين:

1. **ربط خدمة (الأفضل)**: لوركرز فريقكم فقط.
   ```json
   { "code": "…", "bindings": [{ "name": "NEWS", "worker": "news" }] }
   ```
   ```js
   const res = await env.NEWS.fetch(new Request("https://news/latest?limit=5"));
   ```
2. **الرابط العام** مع العلم `global_fetch_strictly_public`: ‏`{ "compatibilityFlags": ["global_fetch_strictly_public"] }`.

لتغيير هذه الإعدادات وحدها: `POST /api/teams/<team>/workers/<name>/runtime` أو `set_worker_runtime`. الأعلام المسموحة هي: `global_fetch_strictly_public` و`nodejs_compat` و`nodejs_als`. ولا يمكن حذف وركر يرتبط به وركر آخر (409 `WORKER_BOUND`).

## عند حدوث مشكلة: اتركوا ملاحظة

إذا فشل نشر أو بناء، أو ظهر خطأ تشغيل بلا حل واضح، أو وجدتم هذه الوصفة خاطئة أو غير واضحة، فاتركوا ملاحظة قصيرة لمسؤول المنصة. الملاحظات العائقة تُنبّه جرس المسؤول، ويظهر ردّه في `GET /api/teams/<team>/notes`.

```sh
curl -s -X POST "$MARSA_URL/api/teams/$MARSA_TEAM/notes" -H "X-Team-Key: $MARSA_AGENT_KEY" -H "content-type: application/json" \
  -d '{"severity":"bug","stage":"deploy","category":"bindings","message":"409 WORKER_BOUND عند …","target":{"type":"worker","id":"news"},"version":"4","agent":"my-agent"}'
```

وعبر MCP استخدموا أداة `leave_note`. لا تضعوا مفاتيح أو رموزًا في الملاحظة، فهي تُحذف تلقائيًا. راجعوا وصفة *ملاحظات الإيجنتس*.

## تغيير في الـ API ‏(0.16.0): قيم المتغيرات تخرج من قوائم الوركرز

‏`GET /api/teams/<team>/workers` و`GET …/workers/<name>` وأداة MCP ‏`list_workers` تُرجع الآن `varNames`
لكل وركر. حتى **2026-10-28 الساعة 12:00 UTC** تبقى `vars` بقيمها مع `varValuesDeprecated: true` وعنصر في
`deprecations` وترويستي `Deprecation` و`Sunset`. بعد ذلك لا تُرجَع القيم إلا عند طلبها: `?includeValues=1`
(تحتاج `workers:deploy`) أو `list_workers {"includeValues": true}`. اقرأ `varNames` (أو إعداداتك) بدل الاعتماد على القيم.

## أخطاء شائعة

- **`NOT_A_MODULE`**: فُقد `export default` من الحزمة، أو الكود سكربت service-worker. شغّلوا `npm run check`.
- **‏`fetch()` إلى وركر الفريق يعيد 5xx أو 522**: استخدموا الربط أو `global_fetch_strictly_public` (انظروا أعلاه).
- **SSE والجلسات افتراضيًا**: في الوركر استخدموا `enableJsonResponse: true` وأنشئوا سيرفرًا جديدًا لكل طلب (القالب يفعل الأمرين).
- **واجهات Node في الحزمة** (`fs`، و`Buffer` دون `nodejs_compat`): التزموا بواجهات الويب، أو أضيفوا `nodejs_compat` عن قصد.
- **غياب User-Agent**: المصادر الخارجية تعيد 403 أو 429 في الإنتاج فقط.
- **أسرار في `vars` أو الكود**: أي عضو في الفريق يقرأ المتغيرات، والإصدارات تحفظ الكود. غيّروا السر إن حدث ذلك.
- **رمي استثناء داخل أداة**: أعيدوا `fail()` / `isError: true` ليعرض العميل رسالة مفهومة.
