# Contributing to Marsa

Thanks for helping! Marsa aims to stay **small**: a single Node process, no
database, few dependencies. Features that need accounts, teams or a backend
belong in a full platform, not here.

## Setup

```bash
npm install
npm run dev            # http://localhost:8080, reloads on change
```

## Before you open a PR

```bash
npm run lint           # Biome (format + lint); `npm run lint:fix` to auto-fix
npm run typecheck      # tsc --noEmit
npm test               # vitest
npm run build && (npm start &) && npm run smoke   # optional end-to-end check
```

- Add or update a test in `test/` for any behavior change.
- Keep security properties intact: path normalization, blocked types, size caps,
  sandbox CSP on uploaded content, token hashing. If you change one, explain why.
- Never commit secrets, `.env` files, the `data/` folder, real screenshots or
  user content. CI runs gitleaks on every push.
- Keep the UI strings in both English and Arabic (`src/ui.ts`).

## Commit / PR style

- Small, focused PRs with a clear description of the *why*.
- Conventional-ish commit subjects are welcome (`fix: ...`, `feat: ...`), not required.

## Reporting security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
