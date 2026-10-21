# my-mcp-worker

خادم MCP على وركر في مرسى سبيسز، مبني بـ **TypeScript وHono وMCP SDK الرسمي**. يعمل بـ Streamable HTTP بلا حالة وبردود JSON على `/mcp`، وفيه `/health`، ويقبل مدخلات عربية وإنجليزية، ومعه اختبارات ونشر بدون wrangler. [English](README.md)

## الهيكل

- `src/index.ts`: تطبيق Hono (‏`/` و`/health` و`/mcp` بطريقة POST، و404 لغيرها)، والتصدير الافتراضي `{ fetch }`.
- `src/mcp/server.ts`: ينشئ McpServer جديدًا لكل طلب، وفيه `TOOL_NAMES`.
- `src/tools/<أداة>.ts`: ملف لكل أداة، فيه مدخلات zod وترقيم الصفحات والمطابقة العربية.
- `src/lib/http.ts`: ‏User-Agent ثابت، ومهلة، وإعادة المحاولة عند 429 و5xx.
- `src/lib/cache.ts`: ذاكرة مؤقتة داخل الـ isolate.
- `src/lib/arabic.ts`: توحيد الحروف والتشكيل والأرقام.
- `src/lib/result.ts`: شكل النتيجة الناجحة والخطأ.
- `src/i18n`: رسائل عربية وإنجليزية.
- `test/`: اختبارات vitest.
- `scripts/`: ‏`dev` و`size` و`deploy` (عبر Spaces API) و`smoke` (فحص حيّ).

## الأوامر

```sh
npm install
npm run dev          # http://localhost:8787/mcp
npm test
npm run check        # فحص الأنواع والاختبارات والبناء والحجم
cp .env.example .env # املأ MARSA_TEAM و MARSA_AGENT_KEY و WORKER_NAME، ولا ترفع .env أبدًا
set -a; . ./.env; set +a
npm run deploy
URL=https://<team>-<name>.marsaplatform.com npm run smoke
```

يمكن استعمال Bun محليًا. أما ما يُنشر فهو دائمًا وحدة ES واحدة: `dist/worker.js`.
