# Prompt: publish your output to Marsa

Paste this into your agent's instructions. Replace the URL with your instance.

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
   update (PUT /api/sites/{id}) or delete (DELETE /api/sites/{id}) with the header
   "Authorization: Bearer {editToken}".
5. If you get an error, read error.code, fix the files and try again.
```

Agents that can read URLs can also be pointed at `https://marsa.example.com/llms.txt`.
