# Publishing from an AI agent

Agents are good at producing HTML (reports, dashboards, charts, prototypes) and bad at sharing them.
Marsa gives them one call that returns a link.

The app serves agent-oriented instructions at
[`/llms.txt`](https://marsa.example.com/llms.txt) and a full spec at
[`/openapi.json`](https://marsa.example.com/openapi.json). Many agents can read those directly.

## A prompt you can paste

```text
When you produce a web page, report, or prototype that I should look at, publish it to Marsa
instead of pasting the HTML:

1. Put the files in a folder with an index.html at the top. Use relative links only.
   Don't include secrets, API keys, or personal data: the link is public.
2. Zip the folder's contents:  (cd OUT_DIR && zip -qr ../site.zip .)
3. Upload it:
   curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=24" \
     -H "Content-Type: application/zip" --data-binary @site.zip
4. From the JSON response, give me "url" and "expiresAt". Keep "id" and "editToken" so you can
   update (PUT /api/sites/{id} with the same zip format) or delete (DELETE /api/sites/{id})
   with the header "Authorization: Bearer {editToken}".
5. If you get an error, read error.code (e.g. BLOCKED_FILE_TYPE, SITE_TOO_LARGE), fix the files
   and try again.
```

## Snippets

**Shell** (see [`examples/agent/deploy.sh`](../examples/agent/deploy.sh)):

```bash
MARSA_URL=https://marsa.example.com ./examples/agent/deploy.sh ./out 24
```

**Node.js 20+, no dependencies** (JSON body, good for a few generated files):

```js
const res = await fetch("https://marsa.example.com/api/sites", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    ttlHours: 24,
    files: [{ path: "index.html", content: "<h1>Weekly report</h1><p>All systems normal.</p>" }],
  }),
});
const site = await res.json();
if (!res.ok) throw new Error(`${site.error.code}: ${site.error.message}`);
console.log(site.url);
```

**Python, standard library only:**

```python
import io, json, os, urllib.request, zipfile

buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as z:
    for root, _, files in os.walk("out"):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, "out"))

req = urllib.request.Request(
    "https://marsa.example.com/api/sites?ttlHours=24",
    data=buf.getvalue(),
    headers={"Content-Type": "application/zip"},
    method="POST",
)
site = json.load(urllib.request.urlopen(req))
print(site["url"], site["expiresAt"])
```

## Tips

- Prefer the ZIP format for anything with images or many files; it's one request.
- Keep reports self-contained (inline CSS/JS or files in the zip). Pages run in a sandbox and
  cannot use cookies or `localStorage`, but `fetch()` to public APIs with CORS works.
- Choose the shortest `ttlHours` that works for the reader.
- Store the `editToken` only where the agent can reach it again; never put it inside the site.
