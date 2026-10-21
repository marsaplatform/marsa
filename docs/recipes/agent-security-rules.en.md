---
title: Security rules for agents
summary: The house rules for any agent working on Spaces: keys never shown, scoped expiring keys, backups and a rollback note before live changes, no private data.
version: 1
updated: 2026-10-21
tags: security, agents
order: 3
---
## Goal

Let agents do real work on your team's sites and Workers without leaking a key, losing data or making a change nobody can undo. Paste these rules into the agent's instructions (system prompt, `AGENTS.md`, project rules).

## When to use

- Every time an agent gets a Spaces key, an MCP token or deploy rights.
- Before any live change (deploy, delete, rotate, DNS, data migration).

## Steps

1. **Never print or echo a secret.** Not in the terminal, logs, chat replies, commit messages, PR text or screenshots. Read keys from environment variables or files (`$MARSA_AGENT_KEY`, a file with mode 600). When you must show a key exists, show its prefix only (`marsa_agent_abc1…`).
   - Do: `curl -H "X-Team-Key: $MARSA_AGENT_KEY" …`
   - Don't: `echo $MARSA_AGENT_KEY`, `cat .env`, `set -x` around commands with keys, `env | sort`.
2. **Use a scoped agent key with an expiry**, not the team key. Ask an owner for an agent invite link (Team → Agent keys → Invite an agent) with the fewest scopes the job needs (e.g. `workers:read` + `workers:deploy` for a deploy bot; `spaces:read` + `mcp` for a reader). Prefer 7 or 30 days. The owner sees last use and can revoke it.
3. **Secrets live in Spaces, not in code.** Worker secrets go in `secrets` (write-only); never in `vars`, code, HTML or KV values.
4. **Before any live change: back up, write a rollback note, then change.**
   - Backup: download what you will change (site ZIP / `GET` the KV keys / Worker version list).
   - Rollback note: one paragraph with the exact command to undo (e.g. "roll back Worker `api` to v3: `POST /api/teams/<team>/workers/api/rollback {\"version\":3}`").
   - Change one thing at a time, then verify (status codes, `/health`, `initialize`), and report.
5. **No private data.** Published sites and site KV are public to anyone with the link (and KV reads are public by default). Never publish personal data, contact lists, internal documents, credentials or anything a person did not agree to share.
6. **Stay inside your team.** Don't touch other teams' sites or Workers, platform settings, or scripts not created by Spaces. If a step needs more access, stop and ask a human.
7. **Report honestly.** Say what you changed, what you verified, what failed, and what you did not do.

## Starter template

Paste into the agent's instructions:

```md
## Marsa Spaces rules
- Keys: read from $MARSA_AGENT_KEY. Never print, echo, log or paste any key, token or password. Show prefixes only.
- Scope: use only team <slug>. Don't touch other teams, platform settings or non-Spaces Workers.
- Before a live change: back up, write the rollback command, then change ONE thing and verify.
- Secrets go in Worker `secrets`, never in code, vars, HTML or KV.
- Never publish personal or private data; published pages and KV are public.
- If something needs more access or is irreversible, stop and ask.
- Final report: changes, verification, failures, rollback, anything left.
```

## Checklist before deploy

- [ ] The key in use is an agent key with only the needed scopes and an expiry.
- [ ] No secret appears in the command history, output, code, vars, commit or report.
- [ ] A backup exists and the rollback command is written down.
- [ ] The change was verified live after it was made.
- [ ] Nothing private was published.

## Common pitfalls

- **Debug output** (`curl -v`, `set -x`) prints the `Authorization` header.
- **Pasting `.env` into a chat** "to check it".
- **Long-lived team key in a CI secret** shared by many jobs: use separate agent keys per job, so revoking one does not break the rest.
- **"Quick fix" straight in production** with no rollback note; then no one knows how to undo it.
- **Putting a token in a published page** "just for a demo": anyone can read the page source.
- **Leaving a test team, site or Worker behind** after an experiment: clean up.
