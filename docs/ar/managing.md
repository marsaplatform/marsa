# إدارة موقع بمفتاحه

لا توجد حسابات في مرسى. **مفتاح التعديل** الذي يُعاد عند الرفع هو المفتاح الوحيد للموقع.
تحفظ مرسى بصمته SHA-256 فقط، فاحفظ المفتاح في مكان آمن إن كنت ستحتاجه لاحقًا.

## في المتصفح

يحفظ الرافع كل موقع تنشئه (الرابط والانتهاء والمفتاح) في `localStorage` في متصفحك.
قائمة **مواقعك في هذا المتصفح** تتيح لك فتحها أو حذفها. مسح بيانات المتصفح ينسى
المفاتيح، لكن المواقع تبقى حتى تنتهي.

## عبر الـ API

```bash
TOKEN="marsa_…"; ID="k3v9x2mq7a"; BASE=https://marsa.example.com

# See what's live
curl -s "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN"

# Replace every file (link and expiry stay the same)
curl -s -X PUT "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/zip" --data-binary @site.zip

# Change the expiry to 48 hours from now (capped at created + MAX_TTL_HOURS)
curl -s -X PATCH "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"ttlHours": 48}'

# Delete right now
curl -s -X DELETE "$BASE/api/sites/$ID" -H "Authorization: Bearer $TOKEN"
```

## القواعد

- لا يمكن أن يعيش رابط أطول من وقت إنشائه مضافًا إليه `MAX_TTL_HOURS` للنسخة
  (٧ أيام افتراضيًا)، مهما مدّدته.
- بعد انتهاء الموقع لا يمكن إحياؤه: ارفعه من جديد للحصول على رابط جديد.
- التحديث يُحتسب ضمن حد الرفع بالساعة.
- أضعت المفتاح؟ انتظر الانتهاء، أو اطلب من مشغّل النسخة، فهو يستطيع حذف أي موقع
  بمفتاح الإدارة.
