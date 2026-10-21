# الاستضافة الذاتية

مرسى عملية Node.js واحدة ومجلد بيانات واحد. لا قاعدة بيانات ولا خدمات خارجية.

## أمر واحد

```bash
docker compose up -d --build
```

افتح `http://localhost:8080`. تُحفظ المواقع في وحدة التخزين `marsa-data` في Docker.

بدون compose:

```bash
docker build -t marsa . && docker run -d --name marsa -p 8080:8080 -v marsa-data:/data marsa
```

بدون Docker (Node.js 20+):

```bash
npm ci && npm run build && npm start
```

## الإعدادات

كل إعداد متغير بيئة بقيمة افتراضية آمنة. انسخ
[`.env.example`](../.env.example) إلى `.env` (يقرؤه compose و`npm run dev`).

| المتغير | الافتراضي | المعنى |
| --- | --- | --- |
| `PORT` / `HOST` | `8080` / `0.0.0.0` | عنوان الاستماع |
| `PUBLIC_URL` | `http://localhost:$PORT` | العنوان الأساسي في روابط المشاركة والتوثيق و`/llms.txt` |
| `DATA_DIR` | `./data` (`/data` في Docker) | مكان حفظ المواقع |
| `DEFAULT_TTL_HOURS` | `24` | المدة عندما لا يختار الرافع |
| `MIN_TTL_HOURS` / `MAX_TTL_HOURS` | `1` / `168` | المدى المسموح للمدة؛ لا يعيش رابط أطول من الإنشاء + الحد الأقصى |
| `SWEEP_INTERVAL_SECONDS` | `60` | كم مرة تُحذف المواقع المنتهية |
| `MAX_FILE_MB` / `MAX_SITE_MB` / `MAX_FILES` | `10` / `25` / `500` | حدود الحجم والعدد |
| `UPLOADS_PER_HOUR` | `20` | عمليات الإنشاء والتحديث لكل IP في الساعة |
| `API_REQUESTS_PER_MINUTE` | `120` | أي طلب `/api` لكل IP في الدقيقة |
| `TRUST_PROXY` | `false` | قراءة IP العميل من `X-Real-IP` / آخر قفزة في `X-Forwarded-For` |
| `ADMIN_TOKEN` | فارغ (الإدارة معطّلة) | مفتاح Bearer لـ `/api/admin/*` ولتسجيل دخول الإدارة، ٢٤ حرفًا على الأقل |
| `SESSION_SECRET` | عشوائي عند كل تشغيل | مفتاح HMAC لكوكيز الدخول ورموز CSRF، ٣٢ حرفًا على الأقل |
| `SESSION_TTL_HOURS` / `ADMIN_SESSION_TTL_HOURS` | `168` / `12` | مدة جلسة الفريق / الإدارة |
| `LOGIN_ATTEMPTS_PER_15_MIN` | `10` | محاولات الدخول لكل IP في ١٥ دقيقة |
| `TEAM_MAX_SITES` | `50` | الحصة الافتراضية: المواقع الحية لكل فريق (يستطيع المسؤول تغييرها لكل فريق) |
| `TEAM_MAX_MB` | `200` | الحصة الافتراضية: الميغابايت عبر مواقع الفريق الحية (يستطيع المسؤول تغييرها لكل فريق) |
| `OPERATOR_NAME` / `OPERATOR_ADDRESS` / `OPERATOR_LAW` / `OPERATOR_EMAIL` | marsaplatform / Bologna, Italy / Italy / info@marsaplatform.com | المتحكم في البيانات الظاهر في سياسة الخصوصية (`/privacy`). **اضبطها عند الاستضافة الذاتية.** |
| `OPERATOR_AUTHORITY` / `OPERATOR_AUTHORITY_URL` | Italian Garante / https://www.garanteprivacy.it | الجهة الرقابية المذكورة في سياسة الخصوصية |
| `OPERATOR_CLOUDFLARE_DPA` | فارغ (عنصر نائب معلَّم) | اتفاقية معالجة البيانات مع Cloudflare المذكورة في سياسة الخصوصية (رابط أو مرجع) |
| `VISITS` | `true` | عدّ مشاهدات الصفحات لكل موقع يوميًا بخصوصية (انظر [الفرق](teams.md)) |
| `VISITS_RETENTION_DAYS` | `90` | أيام عدّ الزيارات المحفوظة (٣١ على الأقل) |
| `VISITS_FLUSH_SECONDS` | `60` | كم مرة تُكتب الأعداد المخزنة مؤقتًا على القرص |
| `MCP_REQUESTS_PER_MINUTE` | `60` | طلبات MCP لكل مفتاح مساحة في الدقيقة (انظر [MCP](mcp.md)) |
| `MCP_WRITES_PER_HOUR` | `60` | استدعاءات أدوات الكتابة في MCP لكل مفتاح في الساعة |
| `MCP_KV_WRITES_PER_DAY` | `500` | استدعاءات `kv_put`/`kv_delete` في MCP يوميًا على مستوى النسخة (خطة KV المجانية: ١٠٠٠ يوميًا) |
| `DISPLAY_TZ` | `Asia/Dubai` | المنطقة الزمنية للأوقات والرسوم البيانية في اللوحات (ثم تحوّلها المتصفحات إلى منطقة المشاهد نفسه) |
| `FEATURED_SITES` | فارغ | معرّفات المواقع لبطاقة «مميز» في الصفحة الرئيسية، مفصولة بفواصل (أول موقع حي). فارغ = أحدث صفحة مدرجة |

ولّد مفتاح إدارة وسر جلسات بـ `openssl rand -hex 32`. بدون `SESSION_SECRET`
يُسجَّل خروج الجميع كلما أُعيد تشغيل الحاوية. قدّم التطبيق عبر HTTPS: عندها تصبح كوكيز الجلسة
`Secure` وتستخدم البادئة `__Host-`. اضبط `TRUST_PROXY=true` خلف الوكيل العكسي حتى
يرى حد محاولات الدخول عناوين IP الحقيقية للعملاء.

لا شيء آخر مطلوب. [خلفية البيانات والملفات](backend.md) الاختيارية تضيف متغيرات `CLOUDFLARE_*` و`R2_*` و
`BACKEND_*`؛ اتركها فارغة وتعمل مرسى كاستضافة ثابتة بحتة
(مسارات الخلفية تُعيد `503 BACKEND_NOT_CONFIGURED`).

## خلف وكيل عكسي (reverse proxy)

أنهِ HTTPS عند الوكيل، ووجّه إلى المنفذ 8080، واضبط:

```bash
PUBLIC_URL=https://marsa.example.com
TRUST_PROXY=true
```

مثال Caddy:

```text
marsa.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

اجعل حد حجم الطلب في الوكيل على الأقل `MAX_SITE_MB` × 1.4.

## تشغيل نسخة عامة

- الصفحات المرفوعة تُقدَّم تحت `/s/<id>/` مع Content-Security-Policy من نوع `sandbox`، فتحصل على
  أصل معتم ولا تستطيع لمس التطبيق. إعطاء مرسى نطاقًا خاصًا بها يضيف طبقة أخرى.
- حدود المعدل في ذاكرة عملية واحدة. شغّل نسخة واحدة، أو أضف حدودًا عند الوكيل.
- اجعل `MAX_TTL_HOURS` قصيرًا والحدود صغيرة؛ هذا ما يجعل التعامل مع إساءة الاستخدام رخيصًا.
- مع ضبط `ADMIN_TOKEN` تستطيع عرض أي موقع وحذفه:

```bash
curl -s https://marsa.example.com/api/admin/sites -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s -X DELETE https://marsa.example.com/api/admin/sites/k3v9x2mq7a -H "Authorization: Bearer $ADMIN_TOKEN"
```

- سجّل الدخول من `/admin/login` بالمفتاح نفسه لإدارة **الفرق** (مفاتيح الفرق، والوصول إلى الخلفية لكل
  فريق، والفرق الظاهرة في الدليل العام في الصفحة الرئيسية) ولرؤية **كل المواقع الحية** أو حذفها.
  يسجّل أعضاء الفريق الدخول من `/login` بمفتاح فريقهم. انظر [الفرق](teams.md).

## النسخ الاحتياطي والترقية

كل الحالة في `DATA_DIR` (`sites/<id>/meta.json` و`sites/<id>/files/` و`teams.json` وملفات JSON
الأخرى). للترقية اسحب الكود الجديد وأعد بناء الحاوية؛ صيغة البيانات JSON بلا إصدارات.

### نسخ احتياطية يومية مشفرة (0.16.0)

مرة يوميًا (عند `BACKUP_HOUR_UTC`) تحزم Spaces مجلد البيانات كله، وتضغطه، وتشفّره بـ
AES-256-GCM وترفعه. إذا كانت خلفية Cloudflare مُعدّة يذهب إلى حاوية R2 نفسها تحت
`_marsa-backups/` (خارج الخادم)؛ وإلا إلى `BACKUP_DIR` إن ضُبط. كل نسخة تُنزَّل من جديد
وتُفحص (بصمة كل ملف). الاحتفاظ: أحدث نسخة من كل يوم من آخر ١٤ يومًا، ونسخة لكل أسبوع لمدة
٨ أسابيع. أي فشل يرسل إشعارًا للمسؤول (وللـ Webhook المنصة). الحالة و«انسخ الآن»
و«اختبر الاستعادة» وهذه الخطوات موجودة في **الإدارة › الإعدادات › النسخ الاحتياطي**.

المفتاح مشتق (HKDF-SHA256) من `BACKUP_KEY`، أو من `MARSA_SECRETS_KEY` عند عدم ضبط مفتاح
منفصل. لا يُحفظ أبدًا مع النسخ: **احفظه في مكان آخر**، فلا يمكن فتح نسخة بدونه.

الاستعادة (دائمًا إلى مجلد جديد فارغ؛ البيانات الحية لا تُستبدل أبدًا):

```bash
docker compose exec marsa node dist/backup-cli.js list
docker compose exec marsa node dist/backup-cli.js verify            # newest, or give a key
docker compose exec marsa node dist/backup-cli.js restore _marsa-backups/2026-10/marsa-<time>.msb /data/tmp/restore
docker compose stop marsa
mv /var/lib/marsa-data/tmp/restore /var/lib/marsa-data.restored
mv /var/lib/marsa-data /var/lib/marsa-data.old && mv /var/lib/marsa-data.restored /var/lib/marsa-data
docker compose start marsa
```

(استبدل `marsa` باسم خدمة compose لديك و`/var/lib/marsa-data` بمجلد المضيف الخاص بـ `/data`.)

| المتغير | الافتراضي | المعنى |
| --- | --- | --- |
| `BACKUPS` | `true` | تشغيل النسخ اليومية أو إيقافها |
| `BACKUP_KEY` | `MARSA_SECRETS_KEY` | السر الذي يُشتق منه مفتاح النسخ (٣٢ حرفًا على الأقل) |
| `BACKUP_DIR` | فارغ | مجلد محلي للنسخ عند عدم وجود خلفية R2 (ليس خارج الخادم) |
| `BACKUP_HOUR_UTC` | `1` | ساعة التشغيل اليومي |
| `BACKUP_KEEP_DAILY` / `BACKUP_KEEP_WEEKLY` | `14` / `8` | مدة الاحتفاظ |
| `BACKUP_MAX_MB` | `2048` | رفض النسخ إذا تجاوز الحجم هذا |

### حذف فريق (0.16.0)

حذف فريق يتطلب كتابة اسمه مرة أخرى. يحفظ أولًا تصديرًا (zip)، ويطفئ وركراته، وينقل
الفريق إلى **الفرق المحذوفة** لمدة ٧ أيام: تتوقف مفاتيحه وجلساته ومفاتيح وكلائه، وتخرج مساحاته من
الدليل. الاستعادة تُرجع كل شيء. بعد ٧ أيام يُحذف نهائيًا (الوركرات والبيانات ومساحاته إن
طلبت ذلك)؛ ويُحفظ التصدير ٣٠ يومًا إضافية في `DATA_DIR/trash/`.

### الجلسات

تُحفظ عمليات تسجيل الخروج في `DATA_DIR/sessions.json`، فتبقى الكوكي المسجَّل خروجها ميتة بعد إعادة التشغيل.
**تسجيل الخروج من كل مكان** (إعدادات الإدارة، أو إعدادات مالك الفريق) ينهي كل جلسات ذلك النطاق.
