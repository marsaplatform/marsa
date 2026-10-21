---
title: Agent notes (tell the admin what went wrong)
summary: Leave a short note at any stage (deploy, build, runtime, recipe) when something fails or is unclear. The admin sees it in the dashboard, blockers ring the bell, and you can read the reply.
version: 1
updated: 2026-10-21
tags: agents, feedback, support
order: 9
---
## Goal

The platform admin learns about problems from the agents that hit them, with enough context to fix them (stage, target, version, the error text), and the agent gets an answer.

## When to leave a note

- A deploy or build fails and the error does not tell you how to fix it.
- A Worker or MCP server fails at runtime because of the platform (bindings, flags, keys, quotas).
- A recipe is wrong, out of date or unclear. That is a `recipe` note with the recipe slug as the target.
- You have a **suggestion**, or need the admin to change something (quota, enable Workers, a flag).

Do not leave a note for every retry: one note per problem, with the error text.

## How

With the team key or **any** agent key (no special scope):

```sh
curl -s -X POST "$MARSA_URL/api/teams/<team>/notes" \
  -H "X-Team-Key: $MARSA_AGENT_KEY" -H "content-type: application/json" \
  -d '{
    "severity": "blocker",
    "stage": "deploy",
    "category": "bindings",
    "message": "PUT …/workers/morassel returns 400 \"binding NEWS: not a Worker of this team\" although news is ours.",
    "target": { "type": "worker", "id": "morassel" },
    "version": "4",
    "agent": "sanad-agent"
  }'
```

| Field | Values |
|---|---|
| `severity` (required) | `info`, `bug`, `blocker` (rings the admin's bell), `suggestion` |
| `message` (required) | Up to 2000 characters: what you did, what happened (the error), and what you expected |
| `stage` | `deploy`, `build`, `runtime`, `recipe`, `other` (default) |
| `category` | A short label, e.g. `bindings`, `upload`, `keys`, `mcp-recipe` |
| `target` | `{"type": "space" \| "worker" \| "mcp" \| "recipe", "id": "…"}` |
| `version` | A deploy or version id (`4`, a commit SHA) |
| `agent` | Your agent's name (default: the key's name) |

## Over MCP

When connected to a Space: call the tool **`leave_note`** with the same fields. The target defaults to that space.

## Read the replies

Read your team's notes, their status (`open`, `ack`, `resolved`) and the admin's replies:

```sh
curl -s "$MARSA_URL/api/teams/<team>/notes?status=open" -H "X-Team-Key: $MARSA_AGENT_KEY"
```

## Rules

- **Never put keys, tokens, passwords or cookies in a note.** Anything that looks like one is replaced with `[redacted]`. If that happens, rotate the leaked credential anyway.
- You can send at most 30 notes per hour per key and 16 KB per request.
- Notes are shown as plain text, so HTML and markdown are not rendered.
- Team members see their team's notes on **Agent notes** in the dashboard, and the platform admin sees every team's notes.
