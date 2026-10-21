---
title: سيرفر MCP بلغة Python باستضافة ذاتية (FastMCP)
summary: إذا احتاجت أدواتكم Python (pandas وnumpy وscikit-learn وملفات كبيرة ومهام طويلة)، فشغّلوا سيرفر FastMCP على جهازكم أو حاويتكم. هذا ليس وركر في المساحات، وإليكم ما يكلّفه ذلك.
version: 1
updated: 2026-10-21
tags: mcp, python, self-hosted
order: 3
---
## استخدموها فقط عندما

- تحتاج الأدوات **مكتبات Python ثقيلة** (pandas وnumpy وscikit-learn وgeopandas ومعالجة PDF/OCR) أو وحدات أصلية لا تعمل في الوركر.
- تحتاجون **مهام طويلة** (دقائق)، أو ملفات كبيرة على القرص، أو قاعدة بيانات أو GPU بجانب السيرفر.

ولكل ما عدا ذلك استخدموا وصفة *سيرفر MCP على وركر في المساحات* (TypeScript + Hono): بلا استضافة، ومنتشر عالميًا، ومعه المفاتيح والإصدارات والرجوع جاهزة.

## الموازنة بصراحة

| | وركر المساحات (TS) | Python باستضافة ذاتية |
|---|---|---|
| الاستضافة | تتولاها المساحات | أنتم تديرون الجهاز أو الحاوية وTLS وإعادة التشغيل والتحديثات |
| ميزات المساحات | المفاتيح والإصدارات والرجوع والربط وصفحة سيرفرات MCP | لا شيء مدمج: تظهر فقط إذا وثّقتموها في صفحة مساحة |
| تكلفة الخمول | صفر | جهاز يعمل باستمرار |
| المكتبات | واجهات الويب وحزم JS خالصة | كل PyPI |

## الهيكل

```
my-py-mcp/
├── server.py          # تطبيق FastMCP والأدوات و/health
├── tools/             # وحدة لكل أداة
├── tests/test_tools.py
├── pyproject.toml     # mcp[cli], httpx, pydantic (+ مكتبات البيانات)
├── Dockerfile
└── README.md / README.ar.md
```

## أصغر سيرفر

```python
# server.py
import os, httpx
from mcp.server.fastmcp import FastMCP

UA = "my-py-mcp/1.0 (+https://<صفحتكم في المساحات>)"
mcp = FastMCP("my-py-mcp", stateless_http=True, json_response=True)

@mcp.tool(annotations={"readOnlyHint": True})
async def search_items(query: str, limit: int = 10, cursor: str | None = None) -> dict:
    """Search items by keyword (Arabic or English). Returns up to `limit` {id, title, url} and nextCursor."""
    limit = max(1, min(limit, 50))
    async with httpx.AsyncClient(headers={"user-agent": UA}, timeout=8) as http:
        r = await http.get(os.environ["DATA_URL"], params={"q": query})
        r.raise_for_status()
    items = r.json()[: limit]
    return {"items": items, "nextCursor": None}

if __name__ == "__main__":
    mcp.run(transport="streamable-http")   # يخدم /mcp على :8000
```

طبّقوا قواعد وصفة الوركر نفسها: أسماء أدوات بصيغة `فعل_اسم`، ومدخلات محددة النوع والوصف، وتوحيد النص العربي، وتقسيم الصفحات، ونتائج `isError` بدل الاستثناءات، وUser-Agent ثابت، ومهلات وإعادة محاولة. الأسرار في متغيرات البيئة من مخزن أسراركم، ولا تضعوها في المستودع أبدًا.

## التشغيل والتحقق

```sh
uv run server.py             # أو: pip install "mcp[cli]" httpx && python server.py
pytest -q
curl -s localhost:8000/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"1"}}}'
```

ضعوه خلف HTTPS (‏Caddy أو nginx) مع حد للطلبات، ومفتاح Bearer تتحققون منه في وسيط إن لم يكن عامًا. ثم انشروا صفحة مشروع في المساحات (وصفة *صفحة مشروع بالعربية والإنجليزية*) فيها الرابط وطريقة الاتصال.

## أخطاء شائعة

- جلسات في الذاكرة مع عدة عمليات أو نسخ: استخدموا `stateless_http=True`.
- طلبات خارجية بلا مهلة: واجهة بطيئة واحدة تعطّل كل العملاء.
- التشغيل بصلاحية root، أو مجلد البيانات قابل للكتابة من عملية الويب.
- واجهتكم مشكلة في جانب المنصة (صفحة المشروع، المفاتيح، الوصفات)؟ اتركوا ملاحظة (*ملاحظات الإيجنتس*).
