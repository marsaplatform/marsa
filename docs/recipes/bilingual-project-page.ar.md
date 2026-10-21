---
title: صفحة مشروع ثنائية اللغة على مساحات
summary: صفحة ثابتة لكل مشروع (العربية أولًا ثم الإنجليزية) فيها طريقة الاتصال واللقطات واتجاه صحيح من اليمين لليسار وفحص للجوال.
version: 2
updated: 2026-10-21
tags: sites, arabic, design
order: 2
---
## الهدف

صفحة مشروع سريعة ونظيفة (لخادم MCP أو مجموعة بيانات أو أداة) منشورة على مساحات، مقروءة بالعربية والإنجليزية، تخبر الزائر في أقل من دقيقة: ما هو المشروع، ولمن، وكيف يتصل به. هذا هو النمط المستخدم في صفحات أطلس وملجأ وERX.

## متى تستخدمها

- أطلقتم شيئًا (خادم MCP، وركر، تقرير) وتحتاجون رابطًا للمشاركة.
- تريدون الصفحة باسم الفريق (مفتاح الفريق أو مفتاح وكيل بصلاحية `spaces:write`) ليحدّثها الزملاء، ويمكن للمسؤول جعل مواقع الفريق دائمة.

## هيكل المجلدات

```
my-project-page/
├── index.html          # الصفحة الإنجليزية (lang="en")، فيها رابط إلى /ar/
├── ar/
│   └── index.html      # الصفحة العربية (lang="ar" dir="rtl")، فيها رابط عودة إلى /
├── assets/
│   ├── style.css       # ملف تنسيق واحد بخصائص منطقية (يعمل في الاتجاهين)
│   ├── app.js          # اختياري: أزرار النسخ وتبديل اللغة
│   └── shot-1.webp     # لقطات شاشة مضغوطة بعرض وارتفاع محددين
├── cover.png           # ‏1200×630 في الجذر: تستخدمه المساحات صورة غلاف في الدليل ولوحة التحكم
└── README.md           # اختياري: طريقة تحديث الصفحة (بلا مفاتيح أبدًا)
```

- استخدموا روابط نسبية (`assets/style.css` من الجذر و`../assets/style.css` من `ar/`) لتعمل الصفحة على أي نطاق.
- ملف `cover.(png|jpg|webp)` في الجذر له الأولوية. من دونه تستخدم المساحات `og:image`، ثم أول صورة في الصفحة.
- ضعوا `<meta property="og:image" content="cover.png">` نفسه في الصفحتين، مع `og:title` بلغة كل صفحة.
- **اربطوا مستودع المصدر** (اختياري): بعد النشر أرسلوا `PATCH /api/sites/<id>` مع `{"repo": {"url": "https://github.com/<org>/<repo>", "branch": "main", "commitSha": "<sha>"}}` (برمز التعديل أو مفتاح الفريق)، أو من تبويب **الإعدادات** في المساحة. بعدها تُظهر جداول المساحات هل المستودع عام أم خاص، وهل الصفحة متزامنة مع الفرع.
- لصفحة خادم MCP: انشروا الوركر مع `"meta": {"spaceSlug": "<معرّف هذه المساحة>"}` لتربط صفحة **خوادم MCP** بينهما.

## الخطوات

1. **اكتبوا المحتوى أولًا بالعربية والإنجليزية** بهذا الترتيب: البطل (الاسم ووعد في سطر وزر رئيسي)، ماذا يفعل (٣–٥ نقاط)، لمن، طريقة الاتصال (كتل جاهزة للنسخ)، لقطات أو صورة غلاف بنص بديل، المصادر والحدود والخصوصية، التواصل والمصدر والإصدار وتاريخ آخر تحديث.
2. **اختاروا التخطيط:** صفحتان (`index.html` إنجليزية و`ar/index.html` عربية كما في الشجرة أعلاه) مع رابط تبديل اللغة في كل منهما. ولجمهور عربي أولًا يمكن عكسهما (العربية في الجذر و`en/index.html`). هذا أسهل للحفاظ على الصحة من صفحة واحدة مختلطة.
3. **اضبطوا الاتجاه:** ‏`<html lang="ar" dir="rtl">` في الصفحة العربية، وخصائص CSS المنطقية (`margin-inline-start` و`text-align: start`)، ولفّ الكود والروابط والبريد والأرقام المختلطة بالعربية في `<bdi>` أو `dir="ltr"`، وكتل الكود دائمًا `dir="ltr"`.
4. **الخط:** خطوط النظام كافية، والعربية تحتاج حجمًا أكبر قليلًا وتباعد أسطر ١٫٧–١٫٨. تجنبوا خطوط CDN الخارجية قدر الإمكان.
5. **الصور:** اضغطوها (WebP أو PNG محسّن)، وحددوا `width` و`height`، و`loading="lazy"` لما تحت الشاشة الأولى.
6. **الجوال:** اختبروا على عرض ٣٦٠–٣٩٠ بكسل: لا تمرير أفقي، وكتل الكود تُمرَّر داخل صندوقها، وأهداف اللمس ٤٤ بكسل على الأقل.
7. **انشروا** كملف ZIP بمفتاح الفريق ليكون الموقع للفريق:
   ```sh
   (cd page && zip -qr ../page.zip .)
   curl -s -X POST "https://marsa.example.com/api/sites" \
     -H "X-Team-Key: $MARSA_AGENT_KEY" -H "Content-Type: application/zip" --data-binary @page.zip
   ```
   احفظوا `editToken` سرًّا (به تحدّثون نفس الرابط عبر `PUT /api/sites/<id>`).
8. **افحصوا الروابط** بعد النشر وأصلحوا كل ما لا يرد 200.

## القالب

```html
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>اسم المشروع: وعد في سطر</title>
<meta name="description" content="وصف قصير بالعربية">
<link rel="alternate" hreflang="en" href="en/">
<style>
  :root { color-scheme: light dark; --ink:#14201c; --accent:#145a49; }
  body { margin:0; font:17px/1.8 system-ui,"Segoe UI",Tahoma,sans-serif; color:var(--ink); }
  main { max-width: 760px; margin-inline: auto; padding: 24px 16px 64px; }
  pre { direction: ltr; text-align: left; overflow-x: auto; background:#0f1a17; color:#e8f3ef; padding:14px; border-radius:10px; }
  .button { display:inline-block; padding:12px 18px; background:var(--accent); color:#fff; border-radius:10px; text-decoration:none; }
  img { max-width:100%; height:auto; border-radius:10px; }
  nav { display:flex; justify-content:space-between; padding:12px 16px; }
</style>
</head>
<body>
<nav><strong>اسم المشروع</strong><a href="en/" hreflang="en" lang="en">English</a></nav>
<main>
  <h1>اسم المشروع</h1>
  <p>وعد المشروع في سطر واحد.</p>
  <p><a class="button" href="#connect">اتصل الآن</a></p>
  <h2>ماذا يفعل</h2>
  <ul><li>…</li><li>…</li><li>…</li></ul>
  <h2 id="connect">طريقة الاتصال</h2>
  <p>عنوان MCP: <bdi dir="ltr"><code>https://team-name.marsaplatform.com/mcp</code></bdi></p>
  <pre><code>{ "mcpServers": { "project": { "url": "https://team-name.marsaplatform.com/mcp" } } }</code></pre>
  <h2>المصادر والخصوصية</h2>
  <p>…</p>
  <img src="cover.webp" width="1200" height="630" alt="لقطة من الواجهة" loading="lazy">
  <p><small>آخر تحديث: <time datetime="2026-10-21">٢١ أكتوبر ٢٠٢٦</time></small></p>
</main>
</body>
</html>
```

الصفحة الإنجليزية (`en/index.html`) مثلها مع `lang="en" dir="ltr"` ورابط عودة إلى `../`.

## قائمة التحقق قبل النشر

- [ ] اللغتان تقولان الشيء نفسه، بلا بقايا ترجمة آلية ولا كلمات لاتينية داخل جمل عربية دون `<bdi>`.
- [ ] ‏`lang` و`dir` في كل صفحة، والكود والروابط من اليسار لليمين.
- [ ] لكل صورة نص بديل بلغة الصفحة، وحجم الموقع صغير (أقل من ٢ م.ب تقريبًا).
- [ ] لا أسرار ولا مفاتيح ولا بريد خاص في الـ HTML (الصفحة عامة لمن معه الرابط).
- [ ] على عرض ٣٦٠ بكسل لا يوجد تمرير أفقي.
- [ ] فحص الروابط:
  ```sh
  B=https://marsa.example.com/s/<id>
  for p in / /en/ /cover.webp; do curl -s -o /dev/null -w "$p %{http_code}\n" "$B$p"; done
  ```
- [ ] جُرّبت طريقة الاتصال فعليًا من عميل نظيف.

## أخطاء شائعة

- **انقلاب الكود والروابط** في الاتجاه العربي: لفّوها بـ `dir="ltr"` أو `<bdi>`.
- **قفز علامات الترقيم** بجوار الكلمات اللاتينية: الحل `<bdi>` أيضًا.
- **روابط مطلقة إلى `/`** تذهب إلى رئيسية مساحات لا موقعكم: استعملوا روابط نسبية (`en/` و`cover.webp`).
- **لقطات ضخمة** تبطئ الصفحة على الجوال: صغّروها إلى نحو ١٢٠٠ بكسل عرضًا.
- **النشر بدون مفتاح الفريق**: يصبح الموقع موقع ضيف قصير العمر بلا وصول للفريق.
