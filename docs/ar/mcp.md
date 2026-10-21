# خادم MCP لكل مساحة

لكل مساحة (موقع منشور) خادم [Model Context Protocol](https://modelcontextprotocol.io)
خاص بها. يتصل به وكيل ذكاء اصطناعي مثل Claude أو Cursor أو VS Code بمفتاح لا يعمل إلا
لتلك المساحة، ثم يقرأ الملفات، ويقرأ بيانات KV والملفات المرفوعة ويكتبها، ويستطيع
نشر إصدار جديد على الرابط نفسه.

```
https://marsa.example.com/mcp/s/<siteId>
```

النقل هو **Streamable HTTP** (إصدارات البروتوكول `2025-11-25` و`2025-06-18` و`2025-03-26`)،
فلا شيء للتثبيت. الخادم بلا حالة ويرد على كل طلب بـ JSON عادي:
لا بث يبدأه الخادم (`GET` يُعيد `405`) ولا معرّف جلسة.

## المفاتيح

المفاتيح موجودة في صفحة الموقع في لوحة الفريق (**وصول MCP**). سجّل الدخول من `/login` وافتح
موقعًا لتراها.

- **الإنشاء**: أعطِ المفتاح اسمًا واختر صلاحيته. يُعرض المفتاح (`marsa_mcp_…`) **مرة واحدة**،
  فانسخه فورًا. تُحفظ بصمته SHA-256 فقط مع الموقع.
- **الصلاحية**:
  - `قراءة فقط` تعطيك `get_site_info` و`list_files` و`read_file`، إضافة إلى `kv_list` و`kv_get`
    و`list_uploads` إذا كان للفريق وصول إلى الخلفية.
  - `قراءة وكتابة` تضيف `replace_site_files`، وأيضًا `kv_put` و`kv_delete` و`upload_file` و
    `delete_file` إذا كان للفريق وصول إلى الخلفية.
- **الإلغاء**: يتوقف المفتاح عن العمل فورًا.
- تتسع المساحة لـ ١٠ مفاتيح على الأكثر. لا يُعيدها الـ API أبدًا (`GET /api/sites/<id>`).
  تتوقف عن العمل عند انتهاء المساحة أو حذفها، وتبقى بعد الاستبدال.

أرسل المفتاح بصيغة `Authorization: Bearer marsa_mcp_…`. المفتاح المفقود أو غير المعروف أو الملغى، أو
مفتاح مساحة أخرى، أو مساحة منتهية، كلها تُعيد `401`.

## ربط عميل

تعرض صفحة الموقع هذه المقتطفات بالرابط الحقيقي. استبدل `marsa_mcp_…` بمفتاحك.

**Cursor** (`.cursor/mcp.json`). العملاء الآخرون الذين يقبلون رابطًا وترويسات يستخدمون JSON نفسه:

```json
{
  "mcpServers": {
    "marsa-<siteId>": {
      "url": "https://marsa.example.com/mcp/s/<siteId>",
      "headers": { "Authorization": "Bearer marsa_mcp_…" }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add --transport http marsa-<siteId> \
  https://marsa.example.com/mcp/s/<siteId> \
  --header "Authorization: Bearer marsa_mcp_…"
```

**Claude Desktop** (`claude_desktop_config.json`). لا يستطيع إرسال ترويسة إلى خادم بعيد بنفسه،
فاستخدم الجسر [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```json
{
  "mcpServers": {
    "marsa-<siteId>": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://marsa.example.com/mcp/s/<siteId>",
               "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer marsa_mcp_…" }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{ "servers": { "marsa-<siteId>": {
  "type": "http", "url": "https://marsa.example.com/mcp/s/<siteId>",
  "headers": { "Authorization": "Bearer marsa_mcp_…" } } } }
```

**TypeScript SDK** (`@modelcontextprotocol/sdk`):

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://marsa.example.com/mcp/s/<siteId>"),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.MARSA_MCP_TOKEN}` } } },
);
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);
console.log(await client.listTools());
console.log(await client.callTool({ name: "get_site_info", arguments: {} }));
```

## الأدوات

| الأداة | الصلاحية | تحتاج الخلفية | ما تفعله |
| --- | --- | --- | --- |
| `get_site_info` | ro | لا | الرابط والعنوان والانتهاء والحجم والفريق وحالة الخلفية وصلاحية المفتاح |
| `list_files` | ro | لا | الملفات المنشورة وأحجامها |
| `read_file` | ro | لا | ملف نصي منشور واحد (حتى 256 KB). الملفات الثنائية تُعيد حجمها فقط |
| `kv_list` / `kv_get` | ro | نعم | مفاتيح KV، وقيمة JSON المحفوظة تحت مفتاح واحد |
| `list_uploads` | ro | نعم | الملفات المرفوعة (R2) وروابطها العامة |
| `replace_site_files` | rw | لا | نشر إصدار جديد على الرابط نفسه. `files: [{path, content, encoding?}]`، و`encoding: "base64"` للملفات الثنائية. الحدود وحصة الفريق نفسها كما في `PUT /api/sites/<id>` |
| `kv_put` / `kv_delete` | rw | نعم | حفظ أي قيمة JSON، أو حذف مفتاح |
| `upload_file` / `delete_file` | rw | نعم | تخزين ملف (نصي أو base64)، أو حذف ملف بمعرّفه |

الأدوات التي لا يستطيع المفتاح استخدامها لا تظهر في `tools/list`. استدعاء إحداها رغم ذلك يُعيد خطأ أداة
(`isError: true`). لخطأ الأداة الرموز نفسها كما في HTTP API، مثل
`BACKEND_NOT_ALLOWED` و`VALUE_TOO_LARGE` و`TOO_MANY_KEYS` و`TEAM_QUOTA_EXCEEDED`.

## الحدود

| الإعداد | الافتراضي | المعنى |
| --- | --- | --- |
| `MCP_REQUESTS_PER_MINUTE` | `60` | الطلبات لكل مفتاح في الدقيقة. فوق الحد تحصل على HTTP `429` مع `Retry-After` |
| `MCP_WRITES_PER_HOUR` | `60` | استدعاءات أدوات الكتابة لكل مفتاح في الساعة. فوق الحد تحصل على خطأ أداة `RATE_LIMITED` |
| `MCP_KV_WRITES_PER_DAY` | `500` | استدعاءات `kv_put` و`kv_delete` على مستوى النسخة كلها في اليوم |

خطة Workers KV المجانية في Cloudflare تسمح بـ ١٠٠٠ كتابة يوميًا لكل حساب. الحد الأخير يُبقي
مسار MCP عند نصف ذلك، فيبقى مجال للصفحات و HTTP API. ارفعه في الخطة المدفوعة.

## الأمان

- المفتاح سر حامل (bearer) لمساحة واحدة، فعامله مثل مفتاح التعديل. ألغِه إذا تسرّب.
- طلبات المتصفح التي تحمل `Origin` من موقع آخر تُرفض (`403`)، وهذا يحمي من DNS
  rebinding. الوكلاء لا يرسلون `Origin`، فلا يتأثرون.
- طلبات JSON-RPC المجمّعة (batch) تُرفض.
