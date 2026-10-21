---
title: خادم MCP على وركر في مساحات
summary: انشر خادم MCP عن بُعد (Streamable HTTP على ‎/mcp) كوركر للفريق، مع الأسرار والتخزين المؤقت وفحص حيّ.
version: 1
updated: 2026-10-21
tags: mcp, workers
order: 1
---
## الهدف

خادم MCP على العنوان `https://<الفريق>-<الاسم>.marsaplatform.com/mcp` يضيفه أي عميل MCP بالرابط فقط. يعمل كوركر للفريق تنشره مساحات نيابةً عنكم، فلا يحتاج أحد حسابًا أو مفتاحًا في Cloudflare.

هذا هو الشكل الذي نجح مع خوادم أطلس وملجأ وأخبار سند: عملية واحدة، Streamable HTTP بلا حالة، ردود JSON، ومسار ‎`/health`، ومجموعة أدوات صغيرة موصوفة جيدًا.

## متى تستخدمها

- عندكم بيانات أو API يريد الوكلاء الاستعلام منها (بحث، استعلام، خلاصة) وتريدون رابطًا واحدًا لمشاركته.
- العمل في كل طلب قصير (بضع طلبات لمصادر خارجية). المهام الطويلة وقواعد البيانات لا تناسب الوركر.
- الوركرز مفعّلة لفريقكم (اطلبوا ذلك من المسؤول) ومعكم مفتاح الفريق أو مفتاح وكيل بصلاحية `workers:deploy`.

## الخطوات

1. **صمّموا الأدوات أولًا.** من ٣ إلى ٧ أدوات، كل أداة تفعل شيئًا واحدًا، بأسماء أفعال (`search_reports`، `get_report`). لكل مُدخل نوع ووصف من سطر واحد، وأعيدوا JSON مختصرًا (معرّفات وعناوين وروابط) لا صفحات كاملة. علّموا أدوات القراءة بـ `readOnlyHint: true`.
2. **بنية الوركر:** وحدة ES واحدة فيها `export default { async fetch(request, env, ctx) { … } }` (كائن لا class). المسارات:
   - `POST /mcp`: ‏JSON-RPC (`initialize` و`tools/list` و`tools/call` و`ping`) بردود `application/json` بلا جلسات.
   - `GET /mcp`: ‏`405`.
   - `GET /health`: ‏`{"ok":true}`.
   - `GET /`: صفحة قصيرة أو تحويل إلى صفحة المشروع على مساحات.
3. **اجمعوا الكود في وحدة واحدة** (مثلًا `esbuild --bundle --format=esm`) وتأكدوا أن الناتج فيه `export default` وأنه تحت حد الفريق (١٠٢٤ ك.ب افتراضيًا).
4. **الأسرار في مساحات لا في الكود.** مفاتيح المصادر الخارجية تُرسل في `secrets` عند النشر (للكتابة فقط، يرى الفريق أسماءها فقط). الإعدادات العادية في `vars` (حتى ٣٢ ك.ب للمتغير و٦٤ ك.ب للمجموع منذ 0.14.0).
5. **ثبّتوا User-Agent** في كل طلب لمصدر خارجي، فبعض واجهات البيانات العامة تحجب الطلبات بدونه.
6. **خزّنوا عمل البداية الباردة** في متغير على مستوى الوحدة، وخزّنوا ردود GET بـ `caches.default` لدقائق. لا تخزّنوا ردودًا خاصة بمستخدم.
7. **افشلوا بلطف.** إن ردّ مصدر أو KV الموقع بـ `503 BACKEND_UNAVAILABLE` أو انتهت المهلة، أعيدوا نتيجة أداة فيها `isError: true` ورسالة واضحة، لا استثناءً. استعملوا `AbortSignal.timeout(8000)`.
8. **اختبروا محليًا** بـ `npx wrangler dev worker.js` ثم أرسلوا طلبات قائمة التحقق.
9. **انشروا عبر مساحات:**
   ```sh
   curl -s -X PUT "https://marsa.example.com/api/teams/<team>/workers/<name>" \
     -H "X-Team-Key: $MARSA_AGENT_KEY" -H "Content-Type: application/json" \
     --data-binary @deploy.json   # {"code": "...", "vars": {...}, "secrets": {...}, "note": "v1"}
   ```
   كل نشر يُحفظ كإصدار (آخر ١٠): يمكن إعادة النشر أو الرجوع من اللوحة أو الـ API أو MCP.
10. **تحققوا حيًّا** (أدناه) ثم شاركوا الرابط. لتقييد من يستعمله راجعوا وصفة *احمِ خادم MCP بمفاتيح مساحات*.

## القالب

```js
// worker.js: a minimal stateless MCP server (no dependencies)
const VERSION = "1.0.0";
const UA = "marsa-mcp-example/1.0 (+https://marsa.example.com)";
const TOOLS = [
  {
    name: "search_items",
    description: "Search the catalogue by keyword. Returns up to 10 {id, title, url}.",
    inputSchema: { type: "object", properties: { q: { type: "string", description: "Keywords" } }, required: ["q"] },
    annotations: { readOnlyHint: true },
  },
];
let cache = null; // module-level: survives between requests in the same isolate

async function loadData(env) {
  if (cache && Date.now() - cache.at < 10 * 60_000) return cache.data;
  const res = await fetch(env.DATA_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`source answered ${res.status}`);
  cache = { at: Date.now(), data: await res.json() };
  return cache.data;
}

async function callTool(name, args, env) {
  if (name !== "search_items") throw new Error(`unknown tool: ${name}`);
  const q = String(args?.q ?? "").toLowerCase();
  const data = await loadData(env);
  return data.filter((x) => x.title.toLowerCase().includes(q)).slice(0, 10);
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return json({ ok: true, version: VERSION });
    if (url.pathname !== "/mcp") return new Response("MCP endpoint: /mcp", { status: 404 });
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const msg = await request.json().catch(() => null);
    if (!msg || msg.jsonrpc !== "2.0") return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400);
    if (msg.id === undefined) return new Response(null, { status: 202 }); // notifications
    const reply = (result) => json({ jsonrpc: "2.0", id: msg.id, result });
    switch (msg.method) {
      case "initialize":
        return reply({ protocolVersion: msg.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "example", version: VERSION } });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call":
        try {
          const out = await callTool(msg.params?.name, msg.params?.arguments, env);
          return reply({ content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: { items: out } });
        } catch (e) {
          return reply({ content: [{ type: "text", text: `Temporarily unavailable: ${e.message}. Try again shortly.` }], isError: true });
        }
      default:
        return json({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
    }
  },
};
```

## قائمة التحقق قبل النشر

- [ ] وحدة واحدة فيها `export default { fetch }` (كائن)، وحجمها تحت حد الفريق.
- [ ] لا مفتاح ولا كلمة مرور في الكود أو في `vars`؛ مكانها `secrets`.
- [ ] لكل طلب خارجي User-Agent ومهلة.
- [ ] ‎`/health` يرد 200، و`GET /mcp` يرد 405، والمسارات الأخرى 404.
- [ ] أوصاف الأدوات تقول ماذا تعيد وكم عنصرًا.
- [ ] التشغيل المحلي ينجح في `initialize` و`tools/list`.
- [ ] ملاحظة على النشر (`"note"`) حتى تكون قائمة الإصدارات مفهومة.
- [ ] بعد النشر، الفحص الحي:
  ```sh
  U=https://<team>-<name>.marsaplatform.com
  curl -s $U/health
  curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}'
  curl -s $U/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  ```

## أخطاء شائعة

- **`NOT_A_MODULE`**: الكود بصيغة service worker (‏`addEventListener`) أو فقد الناتج `export default`.
- **تصدير class افتراضي** لا يستقبل متغيرات أكبر من ٥ ك.ب؛ استعملوا كائنًا.
- **متغير كبير جدًا** (واجهته أخبار سند مع حد ٥ ك.ب القديم): الحد الآن ٣٢ ك.ب. البيانات الأكبر مكانها KV/ملفات الموقع أو رابط خارجي.
- **البث افتراضيًا**: بعض مكتبات MCP ترد بـ SSE وتحفظ الجلسات في الذاكرة؛ في الوركر استعملوا ردود JSON بلا حالة.
- **بلا User-Agent**: المصدر يرد 403/429 في الإنتاج فقط.
- **أسرار في `vars` أو الكود**: كل الفريق يقرأ المتغيرات، والإصدارات تحفظ الكود. غيّروا السر فورًا إن حدث ذلك.
- **رمي استثناء داخل أداة**: يرى العميل خطأ بروتوكول بدل رسالة مفهومة؛ أعيدوا `isError: true`.
