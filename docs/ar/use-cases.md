# حالات الاستخدام

لكل حالة موقع تجريبي صغير ووهمي في [`examples/`](../examples). جرّب واحدًا:

```bash
(cd examples/agent-report && zip -qr ../../report.zip .)
curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=24" \
  -H "Content-Type: application/zip" --data-binary @report.zip
```

## ١. وكيل ذكاء اصطناعي يشارك تقريرًا بصيغة HTML

يحلل الوكيل بيانات ويبني تقريرًا من صفحة واحدة فيه رسوم بيانية. بدل لصق HTML في
المحادثة، يضغط الصفحة ويرسلها ثم يرد بالرابط. استخدم مدة قصيرة (يوم واحد) و
[تعليمات الوكيل](agents.md). المثال: [`examples/agent-report`](../examples/agent-report).

## ٢. نموذج أولي أو عرض لعميل

يرسل مصمم أو مطوّر نموذجًا أوليًا قابلًا للنقر لأخذ الملاحظات. لا إعداد استضافة، ولا حساب
للعميل، ويختفي العرض عند انتهاء فترة المراجعة. حدّثه في مكانه بـ `PUT` كلما وصلت
ملاحظات. المثال: [`examples/client-prototype`](../examples/client-prototype).

## ٣. صفحة فعالية مؤقتة

لقاء أو ورشة عمل أو تخفيضات ليوم واحد تحتاج صفحة فيها الجدول والمكان ورابط التسجيل،
لأسبوع على الأكثر. ارفع بـ `ttlHours=168`. المثال: [`examples/event-page`](../examples/event-page).

## ٤. واجب دراسي

ينشر الطلاب واجبات HTML/CSS ويسلّمون الرابط. يفتحه المعلم في أي متصفح؛
لا شيء للتثبيت ولا شيء للتنظيف بعد التصحيح. يستطيع المعلمون تشغيل نسختهم الخاصة (انظر
[الاستضافة الذاتية](self-hosting.md)) مع ضبط `ADMIN_TOKEN` لرؤية كل التسليمات.
المثال: [`examples/class-assignment`](../examples/class-assignment).

## ٥. معاينة بناء ثابت من CI

يحصل كل pull request على رابط معاينة لموقعه المبني (`dist/` أو `build/` أو `public/`)، يُنشر
كتعليق على الـ PR، وتنتهي المعاينة من تلقاء نفسها. انسخ
[`examples/ci-preview/marsa-preview.yml`](../examples/ci-preview/marsa-preview.yml) إلى
`.github/workflows/` واضبط **متغير** المستودع `MARSA_URL` على نسختك. لا حاجة إلى أسرار.
الموقع التجريبي: [`examples/ci-preview/site`](../examples/ci-preview/site).
