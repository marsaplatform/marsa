# مفاتيح الوكلاء وروابط الدعوة والتنبيهات

*جديد في 0.14.0.*

## مفاتيح الوكلاء

مفتاح الوكيل مفتاح API للفريق له **صلاحيات** محددة و**تاريخ انتهاء إلزامي**. أعطِ كل وكيل أو أداة
مفتاحه الخاص بدل مفتاح الفريق: ترى متى استُخدم آخر مرة، وتستطيع إلغاءه وحده.

- يُنشئه **مالك** الفريق من صفحة **مفاتيح الوكلاء** (`/team/agents`)، أو بمفتاح الفريق عبر الـ API، أو
  المسؤول.
- الحقول: اسم، ووصف اختياري، وصلاحية واحدة أو أكثر، ومدة انتهاء ٧ أو ٣٠ أو ٩٠ يومًا، أو
  عدد أيام مخصص (٣٦٥ على الأكثر).
- يُعرض المفتاح (`marsa_agent_…`) **مرة واحدة**. تحفظ Spaces بصمته SHA-256 وبادئة قصيرة فقط.
- يعمل مفتاح الوكيل **حيثما يعمل مفتاح الفريق** (`X-Team-Key` أو `Authorization: Bearer`)،
  في حدود صلاحياته. خارجها: `403 INSUFFICIENT_SCOPE`. إذا أُلغي أو انتهى: `401`.
- مفاتيح الوكلاء لا تستطيع إنشاء مفاتيح أو روابط دعوة أو Webhooks؛ هذا يحتاج مفتاح الفريق أو مالكًا.
- بعض المسارات الحساسة (سجل النشاط وتصدير الفريق والـ Webhook) لمفتاح الفريق فقط: يحصل مفتاح الوكيل على `403 TEAM_KEY_REQUIRED`.

| الصلاحية | تسمح بـ |
| --- | --- |
| `workers:read` | عرض الوركرات وإصداراتها وكودها |
| `workers:deploy` | نشر الوركرات وإعادة نشرها والرجوع بها وحذفها |
| `spaces:read` | `GET /api/teams/<team>/sites` و`GET /api/sites/<id>` لمواقع الفريق |
| `spaces:write` | النشر (`POST /api/sites`) واستبدال مواقع الفريق وتمديدها وحذفها |
| `kv:read` | قراءة قيم KV والملفات المرفوعة لمواقع الفريق |
| `kv:write` | كتابة قيم KV والملفات وحذفها |
| `mcp` | استخدام خادم MCP لمساحة من مساحات الفريق (`/mcp/s/<id>`) بالمفتاح؛ الأدوات تُصفّى حسب الصلاحيات الأخرى |

```bash
# Create (team key)
curl -s -X POST "https://marsa.example.com/api/teams/sanad/agent-keys" \
  -H "X-Team-Key: $MARSA_TEAM_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-bot","scopes":["workers:read","workers:deploy"],"expiresInDays":30}'
# List (no secrets), revoke
curl -s "https://marsa.example.com/api/teams/sanad/agent-keys" -H "X-Team-Key: $MARSA_TEAM_KEY"
curl -s -X DELETE "https://marsa.example.com/api/teams/sanad/agent-keys/<id>" -H "X-Team-Key: $MARSA_TEAM_KEY"
```

عندما يُستخدم مفتاح من عنوان لم يستخدمه من قبل (بما في ذلك أول استخدام)، يصل تنبيه إلى
مالكي الفريق. تُحفظ بصمة مفتاحية لعنوان IP فقط (HMAC بسر من الخادم)، ولا يُحفظ العنوان نفسه أبدًا.

## روابط دعوة الوكلاء

يستطيع المالك إنشاء **رابط لمرة واحدة** (صالح ٢٤ ساعة) بدل المفتاح، وتسليمه للوكيل:

- `GET /agent-invite/<token>`: تعليمات البدء بصيغة Markdown (أو JSON مع `Accept: application/json` أو
  `?format=json`): اسم الفريق المختصر، وعنوان الـ API، والتوثيق، وأمثلة curl، وإعداد MCP.
- `POST /agent-invite/<token>/claim`: يُعيد مفتاح الوكيل الجديد **مرة واحدة** (`201`). بعدها يصبح الرابط
  ميتًا (`404 INVITE_INVALID`)، كما بعد ٢٤ ساعة.
- كلاهما محدود المعدل لكل IP (٣٠ في الساعة)، والاستلام يُسجَّل في سجل نشاط الفريق.

الـ API: `POST /api/teams/<team>/agent-invites` (بالحقول نفسها للمفتاح) يُعيد `{"url"}`؛
و`DELETE /api/teams/<team>/agent-invites/<id>` يلغي رابطًا.

## الإشعارات

يحصل المالكون (والمسؤول) على **مركز إشعارات** داخل التطبيق بجرس وعدد غير المقروء:

- نشر وركر وإعادة نشره والرجوع به وحذفه
- إنشاء مفتاح وكيل وإلغاؤه وانتهاؤه، واستلام دعوة، واستخدام من عنوان جديد
- تدوير مفتاح الفريق، وانضمام أعضاء أو إزالتهم
- للمسؤول فقط: تغيير مفتاح Cloudflare أو إزالته، وفشل فحص التخزين (ونجاحه مجددًا)

الـ API: `GET /api/teams/<team>/notifications` و`POST …/notifications/read` (مفتاح الفريق)؛
و`GET /api/admin/notifications` و`POST /api/admin/notifications/read` (المسؤول).

## Webhooks

اختياري: Webhook صادر واحد لكل فريق (صفحة الإشعارات، أو `PUT /api/teams/<team>/webhook`
مع `{"url"}`) وWebhook واحد للمنصة للمسؤول (`PUT /api/admin/webhook`) يستقبل
كل الإشعارات.

- `POST` بـ JSON: `text` و`content` (فتعرضه Webhooks الواردة في Slack و Discord كما هو)،
  إضافة إلى `event` (`kind` و`at` و`team` و`actor` و`detail`).
- الترويسات: `X-Marsa-Event` و`X-Marsa-Delivery` و`X-Marsa-Timestamp` و
  `X-Marsa-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>" with the signing secret>`.
  السر (`whsec_…`) يُعرض مرة واحدة ويُحفظ مشفرًا (يحتاج `MARSA_SECRETS_KEY`).
- حتى ٣ محاولات (بعد ٢ ثانية و١٠ ثوانٍ)؛ لا إعادة عند 4xx إلا 408/429. لا تُتبع التحويلات.
- `https://` إلى خادم عام فقط. `WEBHOOK_ALLOW_PRIVATE=true` يسمح بـ `http://` والعناوين الخاصة
  (للاختبار المحلي فقط).
- الاختبار: زر **إرسال تجربة**، أو `POST …/webhook/test`. لا إشعارات بالبريد (حاليًا).
