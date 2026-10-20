# Use cases

Each case has a small, fictional sample site in [`examples/`](../examples). Try one:

```bash
(cd examples/agent-report && zip -qr ../../report.zip .)
curl -s -X POST "https://marsa.example.com/api/sites?ttlHours=24" \
  -H "Content-Type: application/zip" --data-binary @report.zip
```

## 1. An AI agent shares an HTML report

An agent analyses data and builds a one-page report with charts. Instead of pasting HTML into
chat, it zips the page, posts it, and answers with the link. Use a short TTL (a day) and the
[agent prompt](agents.md). Sample: [`examples/agent-report`](../examples/agent-report).

## 2. A prototype or demo for a client

A designer or developer sends a clickable prototype for feedback. No hosting setup, no account for
the client, and the demo disappears when the review window closes. Update it in place with `PUT` as
feedback comes in. Sample: [`examples/client-prototype`](../examples/client-prototype).

## 3. A temporary event page

A meetup, workshop or one-day sale needs a page with the schedule, the place and a sign-up link,
for a week at most. Upload with `ttlHours=168`. Sample: [`examples/event-page`](../examples/event-page).

## 4. A class assignment

Students publish their HTML/CSS homework and hand in the link. The teacher opens it in any browser;
nothing to install, nothing to clean up after grading. Teachers can run their own instance (see
[self-hosting](self-hosting.md)) with `ADMIN_TOKEN` set to see every submission.
Sample: [`examples/class-assignment`](../examples/class-assignment).

## 5. A static build preview from CI

Every pull request gets a preview link of its built site (`dist/`, `build/`, `public/`), posted as a
PR comment, and the preview expires by itself. Copy
[`examples/ci-preview/marsa-preview.yml`](../examples/ci-preview/marsa-preview.yml) into
`.github/workflows/` and set a repository **variable** `MARSA_URL` to your instance. No secrets are
needed. Sample site: [`examples/ci-preview/site`](../examples/ci-preview/site).
