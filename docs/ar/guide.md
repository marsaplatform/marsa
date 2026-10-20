# دليل Marsa بالعربي

Marsa (مَرسى) بيحوّل فولدر ملفات ثابتة لرابط عام بينتهي لوحده. مفيش حسابات: اللي معاه **مفتاح التعديل** هو اللي يقدر يدير الموقع.
الأمثلة بتستخدم `https://marsa.example.com` كعنوان للخدمة، ولما تقرأ الدليل جوه نسخة شغالة بيتبدّل بالعنوان الحقيقي.

## محتاج أنزّل حاجة؟

- **لو بتستخدم نسخة Marsa شغالة**: مش محتاج أي حاجة. ارفع من المتصفح أو استخدم الـ API.
- **لو هتشغّل نسختك**: محتاج Marsa بس، بأمر واحد: `docker compose up -d --build`. مفيش قاعدة بيانات ولا خدمات تانية، وكل مميزات النشر شغالة.
- **الـ backend الاختياري للبيانات والملفات** هو الحاجة الوحيدة اللي بتستخدم خدمة بره، وهي Cloudflare (Workers KV للبيانات وR2 للملفات)، وهو مقفول افتراضيًا. مش محتاج تنزّل حاجة، بتربط حساب Cloudflare بمتغيرات البيئة.

## الرفع من المتصفح

1. افتح الصفحة الرئيسية وانزل لـ **جرّب دلوقتي** (أو افتح `/ar/new`).
2. اسحب فولدر أو ملفات أو ملف `.zip`، أو استخدم **اختار ملفات** أو **اختار فولدر**.
3. اختار مدة الرابط (من ساعة لحد الحد الأقصى، 7 أيام افتراضيًا).
4. انسخ الرابط وابعته لأي حد.

المتصفح بيفتكر المواقع اللي رفعتها ومفاتيحها تحت **اللي رفعته من المتصفح ده**، فتقدر تمسحها بعدين من نفس المتصفح.

### شروط الموقع

- حط `index.html` في أول مستوى. لو كل الملفات جوه فولدر واحد، Marsa بيشيله لوحده.
- استخدم روابط نسبية (`css/style.css` مش `/css/style.css`)، لأن المواقع بتتعرض تحت `/s/<id>/`.
- ملف `404.html` في أول مستوى بيظهر للصفحات اللي مش موجودة.
- الملفات المخفية (`.env` و`.git/`) بتتشال، وسكريبتات السيرفر والبرامج (`.php` و`.py` و`.sh` و`.exe`...) بتترفض.

## الـ API

```bash
# ارفع ملف zip
(cd my-site && zip -qr ../site.zip .)
curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=24" \
  -H "Content-Type: application/zip" --data-binary @site.zip

# أو ابعت الملفات كـ JSON
curl -s -X POST https://marsa.example.com/api/sites -H "Content-Type: application/json" \
  -d '{"ttlHours": 6, "files": [{"path": "index.html", "content": "<h1>أهلًا</h1>"}]}'
```

الرد فيه `url` و`expiresAt` و`id` و`editToken`. المفتاح بيظهر **مرة واحدة بس**، وMarsa بيخزّن الـ hash بتاعه بس، فلو ضاع مايترجعش.
المرجع الكامل بالإنجليزي في [API](/docs/api) وفي [`/openapi.json`](https://marsa.example.com/openapi.json).

## الإدارة بالمفتاح

```bash
TOKEN="marsa_…"; ID="k3v9x2mq7a"; BASE=https://marsa.example.com
curl -s -X PUT    "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/zip" --data-binary @site.zip   # تبديل كل الملفات
curl -s -X PATCH  "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"ttlHours": 48}'  # تغيير المدة
curl -s -X DELETE "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN"   # مسح فوري
```

الرابط عمره ما يعيش أكتر من وقت إنشاؤه + `MAX_TTL_HOURS`، مهما مدّيته. ولو انتهى، ارفعه تاني وخد رابط جديد.

## الـ AI agents

الخدمة بتقدّم تعليمات للـ agents على [`/llms.txt`](https://marsa.example.com/llms.txt). ودي رسالة تقدر تديها للـ agent:

```text
لما تعمل صفحة أو تقرير أو نموذج أولي محتاج أشوفه، انشره على Marsa بدل ما تبعتلي الـ HTML:
1. حط الملفات في فولدر فيه index.html، وبروابط نسبية بس. ماتحطش أسرار أو مفاتيح أو بيانات شخصية، لأن الرابط عام.
2. اضغط محتوى الفولدر:  (cd OUT_DIR && zip -qr ../site.zip .)
3. ارفعه:  curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=24" -H "Content-Type: application/zip" --data-binary @site.zip
4. ابعتلي "url" و"expiresAt" من الرد، واحتفظ بـ "id" و"editToken" علشان التحديث أو المسح.
5. لو حصل خطأ، اقرأ error.code وصلّح الملفات وجرّب تاني.
```

أمثلة جاهزة بـ Shell وNode وPython في [دليل الـ agents](/docs/agents).

## استخدامات حقيقية

- **agent بيشارك تقرير HTML**: بدل ما يلزق كود، بيرجع رابط. المثال: `examples/agent-report`.
- **نموذج أولي لعميل**: ديمو للمراجعة من غير استضافة ولا حساب. المثال: `examples/client-prototype`.
- **صفحة إيفنت مؤقتة**: لمدة أسبوع بـ `ttlHours=168`. المثال: `examples/event-page`.
- **واجب دراسي**: الطلبة يسلّموا رابط. المثال: `examples/class-assignment`.
- **معاينة من الـ CI**: كل Pull Request ياخد رابط معاينة كتعليق. المثال: `examples/ci-preview`.

## تشغيل نسختك

```bash
docker compose up -d --build     # http://localhost:8080
```

أهم الإعدادات (متغيرات بيئة، والقيم الافتراضية في `.env.example`):

| المتغير | الافتراضي | المعنى |
| --- | --- | --- |
| `PUBLIC_URL` | `http://localhost:8080` | العنوان اللي بيتبني بيه الرابط |
| `DEFAULT_TTL_HOURS` / `MAX_TTL_HOURS` | `24` / `168` | مدة الرابط |
| `MAX_FILE_MB` / `MAX_SITE_MB` / `MAX_FILES` | `10` / `25` / `500` | حدود الحجم والعدد |
| `UPLOADS_PER_HOUR` | `20` | عدد الرفعات لكل IP في الساعة |
| `TRUST_PROXY` | `false` | خليه `true` لو ورا reverse proxy انت متحكم فيه |
| `ADMIN_TOKEN` | فاضي | لو اتحط، بيفتح `/api/admin/*` لإدارة كل المواقع |

التفاصيل الكاملة في [دليل الاستضافة](/docs/self-hosting).

## الـ backend الاختياري (Cloudflare)

لو صفحة أو agent محتاجين يخزّنوا بيانات صغيرة (KV) أو ملفات، Marsa يقدر يوصّلهم بـ Cloudflare: البيانات في Workers KV والملفات في R2، من غير Worker ولا تنزيل. كل البيانات مربوطة بالموقع وبتتمسح معاه.
- الكتابة محتاجة مفتاح التعديل دايمًا، والقراءة عامة طول ما الموقع شغال (`BACKEND_PUBLIC_READ=true`).
- الـ API token ومفاتيح R2 بيفضلوا على السيرفر، والمتصفح عمره ما بيشوفهم.
- الإعداد: اعمل API token في Cloudflare بصلاحيتين `Workers KV Storage: Edit` و`Workers R2 Storage: Edit`، وشغّل `CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node scripts/cloudflare-setup.mjs --write-env .env`. السكريبت بيعمل الـ KV namespace والـ R2 bucket (أو بيستخدمهم لو موجودين)، وبيكتب `CLOUDFLARE_KV_NAMESPACE_ID` و`R2_BUCKET` و`R2_ACCESS_KEY_ID` و`R2_SECRET_ACCESS_KEY` في الملف. ومحتاج كمان `CLOUDFLARE_ACCOUNT_ID` و`CLOUDFLARE_API_TOKEN` في نفس الملف.
- من غيرهم، الـ routes دي بترد `503 BACKEND_NOT_CONFIGURED` والنشر شغال عادي.
- في الصفحة: `<script src="/sdk.js"></script>` وبعدين `marsa.kv.get("key")`.

التفاصيل بالإنجليزي في [دليل الـ backend](/docs/backend).

## الفرق ولوحة الأدمن

لو النسخة فيها `ADMIN_TOKEN`، افتح `/ar/admin` وحط مفتاح الأدمن. من هناك تقدر:
- تعمل فريق وتاخد **مفتاح الفريق** (بيظهر مرة واحدة بس، والسيرفر بيحفظ الـ hash بتاعه بس).
- تحدد لكل فريق إذا كان ليه **وصول للباك إند** ولا لأ، وإذا كان **يظهر في الدليل العام** على الصفحة الرئيسية (شغال افتراضيًا).
- تعمل مفتاح جديد (القديم بيبطل على طول) أو تمسح الفريق.

الفريق بيرفع بالهيدر `X-Team-Key: <key>`. الرفع من غير مفتاح بيفضل زي ما هو (ضيف). مواقع الضيوف والفرق اللي من غير باك إند بترد `403 BACKEND_NOT_ALLOWED` على الـ KV والملفات، والفرق المسموح لها بترد `503 BACKEND_NOT_CONFIGURED` لحد ما الـ backend يتظبط (متغيرات Cloudflare).

الصفحة الرئيسية فيها قسم **منشورات الفرق**: لكل فريق عنوان، وتحته كروت الصفحات الشغالة بالعنوان والرابط ووقت الانتهاء. نفس البيانات على `GET /api/directory`. مفيش أي مفاتيح أو مواقع ضيوف بتظهر فيه.

التفاصيل بالإنجليزي في [دليل الفرق](/docs/teams).

## الخصوصية

- أي حد معاه الرابط يقدر يشوف الموقع.
- مفيش حسابات ولا cookies للتتبع ولا تحليلات.
- الـ IP بيستخدم في الذاكرة بس لحدود الاستخدام، ومش بيتسجّل.
- الصفحات المرفوعة بتشتغل جوه sandbox ومتقدرش توصل للتطبيق.
