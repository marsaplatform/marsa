# Agent keys, invite links and alerts

*New in 0.14.0.*

## Agent keys

An agent key is a team API key with **scopes** and a **required expiry**. Give each agent or tool
its own key instead of the team key: you can see when it was last used, and revoke it alone.

- Created by a team **owner** on **Agent keys** (`/team/agents`), with the team key over the API, or
  by the admin.
- Fields: a name, an optional description, one or more scopes, and an expiry of 7, 30 or 90 days, or
  a custom number of days (at most 365).
- The key (`marsa_agent_…`) is shown **once**. Spaces stores only its SHA-256 and a short prefix.
- An agent key works **wherever the team key does** (`X-Team-Key` or `Authorization: Bearer`),
  limited to its scopes. Outside them: `403 INSUFFICIENT_SCOPE`. Revoked or expired: `401`.
- Agent keys cannot create keys, invite links or webhooks; that needs the team key or an owner.

| Scope | Allows |
| --- | --- |
| `workers:read` | List Workers, versions and code |
| `workers:deploy` | Deploy, redeploy, roll back and delete Workers |
| `spaces:read` | `GET /api/teams/<team>/sites`, `GET /api/sites/<id>` for the team's sites |
| `spaces:write` | Publish (`POST /api/sites`), replace, extend and delete the team's sites |
| `kv:read` | Read KV values and uploaded files of the team's sites |
| `kv:write` | Write and delete KV values and files |
| `mcp` | Use a team space's MCP server (`/mcp/s/<id>`) with the key; tools are filtered by the other scopes |

```bash
# Create (team key)
curl -s -X POST "https://marsa.example.com/api/teams/sanad/agent-keys" \
  -H "X-Team-Key: $MARSA_TEAM_KEY" -H "Content-Type: application/json" \
  -d '{"name":"ci-bot","scopes":["workers:read","workers:deploy"],"expiresInDays":30}'
# List (no secrets), revoke
curl -s "https://marsa.example.com/api/teams/sanad/agent-keys" -H "X-Team-Key: $MARSA_TEAM_KEY"
curl -s -X DELETE "https://marsa.example.com/api/teams/sanad/agent-keys/<id>" -H "X-Team-Key: $MARSA_TEAM_KEY"
```

When a key is used from an address it has not used before (including its first use), the team's
owners get an alert. Only a keyed hash of the IP (HMAC with a server secret) is kept, never the IP.

## Agent invite links

An owner can create a **one-time link** (valid 24 hours) instead of a key, and hand it to an agent:

- `GET /agent-invite/<token>`: onboarding as Markdown (or JSON with `Accept: application/json` or
  `?format=json`): the team slug, API base, docs, curl examples and an MCP config.
- `POST /agent-invite/<token>/claim`: returns the new agent key **once** (`201`). After that the link
  is dead (`404 INVITE_INVALID`), as it is after 24 hours.
- Both are rate-limited per IP (30 per hour) and the claim is in the team's activity log.

API: `POST /api/teams/<team>/agent-invites` (same fields as a key) returns `{"url"}`;
`DELETE /api/teams/<team>/agent-invites/<id>` cancels one.

## Notifications

Owners (and the admin) get an in-app **notification center** with a bell and an unread count:

- Worker deploy, redeploy, rollback and delete
- Agent key created, revoked, expired, invite claimed, used from a new address
- Team key rotated, members joined or removed
- Admin only: Cloudflare token changed or removed, the storage check failing (and passing again)

API: `GET /api/teams/<team>/notifications` and `POST …/notifications/read` (team key);
`GET /api/admin/notifications` and `POST /api/admin/notifications/read` (admin).

## Webhooks

Optional: one outgoing webhook per team (Notifications page, or `PUT /api/teams/<team>/webhook`
with `{"url"}`) and one platform webhook for the admin (`PUT /api/admin/webhook`), which receives
every notification.

- `POST` with JSON: `text` and `content` (so Slack and Discord incoming webhooks show it as-is),
  plus `event` (`kind`, `at`, `team`, `actor`, `detail`).
- Headers: `X-Marsa-Event`, `X-Marsa-Delivery`, `X-Marsa-Timestamp`, and
  `X-Marsa-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<body>" with the signing secret>`.
  The secret (`whsec_…`) is shown once and stored encrypted (needs `MARSA_SECRETS_KEY`).
- Up to 3 attempts (after 2 s and 10 s); no retry on 4xx except 408/429. Redirects are not followed.
- `https://` to a public host only. `WEBHOOK_ALLOW_PRIVATE=true` allows `http://` and private hosts
  (local testing only).
- Test: the **Send test** button, or `POST …/webhook/test`. No email notifications (yet).
