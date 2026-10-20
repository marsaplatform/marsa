# Getting started

Marsa turns a folder of static files into a public link that expires on its own.
There is no account: whoever holds the **edit token** can manage the site.

## Do I need to install anything?

- **Using a Marsa instance** someone runs: nothing. Upload in the browser or call the API with `curl`.
- **Hosting your own**: only Marsa, one command: `docker compose up -d --build`. No database and no
  other services. All publishing features work out of the box.
- **The optional data/files backend** (KV and file storage for pages and agents) is the only thing that
  uses [Appwrite](backend.md), and it's off by default. You can use Appwrite Cloud (nothing to install)
  or a self-hosted Appwrite, connected with environment variables.

## Upload from the browser

1. Open the home page and scroll to **Try it now** (or go to `/new`).
2. Drag in a folder, some files, or a single `.zip`. You can also use **Choose files** or **Choose folder**.
3. Pick how long the link should live (1 hour up to the instance maximum, 7 days by default).
4. Copy the link and send it to anyone.

Your browser remembers the sites you uploaded (with their tokens) under **Your drops in this browser**,
so you can delete them later from the same browser.

## What makes a valid site

- Put an `index.html` at the top level. If everything sits inside one folder (for example
  `my-site/index.html`), Marsa strips that folder for you.
- Use relative links (`css/style.css`, not `/css/style.css`), because sites live under `/s/<id>/`.
- A `404.html` at the top level is used for missing pages.
- `about/` serves `about/index.html`, and `about` also finds `about.html`.
- Dotfiles (`.env`, `.git/`, `.DS_Store`) are dropped. Server scripts and executables
  (`.php`, `.py`, `.sh`, `.exe`, ...) are rejected.

## What you get back

```json
{
  "id": "k3v9x2mq7a",
  "url": "https://marsa.example.com/s/k3v9x2mq7a/",
  "expiresAt": "2030-01-02T10:00:00.000Z",
  "editToken": "marsa_…",
  "fileCount": 3,
  "totalBytes": 18342
}
```

The `editToken` is shown **once**. Marsa stores only a hash of it, so a lost token can't be recovered;
the site simply expires on schedule.

## Things to know

- Anyone with the link can open the site. Don't upload secrets, personal data or anything private.
- Uploaded pages run in a browser **sandbox**: scripts work, but the page gets an isolated origin.
  Browser storage (`localStorage`, cookies) is not available to uploaded pages.
- Pages are marked `noindex`, so search engines are asked not to list them.

Next: [use the API](api.md) or [let an AI agent publish for you](agents.md).
