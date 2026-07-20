---
name: kindred
description: Manage contacts and birthdays in a self-hosted Kindred friend CRM via its REST API. Use when the user asks to list, search, add, update, or delete contacts, or to check whose birthday is coming up.
license: MIT
metadata:
  audience: agents
  app: kindred-friend-crm
---

## Purpose

Kindred is a minimal self-hosted friend/relationship CRM. It stores people
(name, birthday, notes) in SQLite. This skill lets an AI agent manage those
contacts through Kindred's token-authenticated REST API.

## Setup

You need two pieces of configuration, preferably from environment variables:

- `KINDRED_URL` — base URL of the instance, e.g. `http://192.168.1.50:3000`
- `KINDRED_TOKEN` — the shared API token (same secret as the ICS feed token)

If they are not set, ask the user. The token is the one printed by the
installer, or by running `npm run print:feed-token` on the server. Do not
invent or guess either value. Send the token on every request as
`Authorization: Bearer $KINDRED_TOKEN`. Never log or echo the token.

## API reference

All endpoints are relative to `$KINDRED_URL` and require the Bearer token.
Requests and responses are JSON. Errors are `{"error": "<message>"}` with a
matching HTTP status (401 bad/missing token, 400 invalid input, 404 not found).

### Contact object

```json
{
  "id": 1,
  "name": "Ada Lovelace",
  "birth_month": 12,
  "birth_day": 10,
  "birth_year": 1815,
  "notes": "Met at the maths society",
  "days_until": 143
}
```

- `birth_year` may be `null` (year unknown/irrelevant). `notes` may be `""`.
- `days_until` (days until next birthday) is computed by the server on reads;
  never send it on writes.

### List / search contacts

```
GET /api/agent/contacts
GET /api/agent/contacts?q=<text>           # substring match on name + notes
GET /api/agent/contacts?within_days=<n>    # birthdays in the next n days
```

Returns an array of contacts sorted by upcoming birthday (soonest first).
`q` and `within_days` can be combined.

```bash
curl -sS -H "Authorization: Bearer $KINDRED_TOKEN" \
  "$KINDRED_URL/api/agent/contacts?within_days=30"
```

### Get one contact

```
GET /api/agent/contacts/<id>
```

### Create a contact

```
POST /api/agent/contacts
{"name": "Grace Hopper", "birth_month": 12, "birth_day": 9, "birth_year": 1906, "notes": "..."}
```

- Required: `name` (string), `birth_month` (1–12), `birth_day` (valid for the
  month). Optional: `birth_year` (1800–current year or `null`), `notes`.
- Responds 201 with the created contact.

```bash
curl -sS -X POST -H "Authorization: Bearer $KINDRED_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Grace Hopper","birth_month":12,"birth_day":9,"birth_year":1906}' \
  "$KINDRED_URL/api/agent/contacts"
```

### Update a contact

```
PUT /api/agent/contacts/<id>
```

Full replacement, not a patch: the body must contain `name`, `birth_month`,
and `birth_day` plus any optional fields. To change only part of a contact,
GET it first, merge the change, and PUT the merged object (without
`id`/`days_until`).

### Delete a contact

```
DELETE /api/agent/contacts/<id>
```

Permanent. Responds 204 with an empty body.

## Rules

- Always GET before PUT so unchanged fields are preserved (PUT replaces the
  whole record).
- Always confirm with the user before DELETE; deletions are irreversible.
- When the user gives a birthday like "March 5th" without a year, omit
  `birth_year` (or send `null`) — do not guess a year.
- After creating or updating, report the resulting contact (including its
  `id` and `days_until`) back to the user.
- When asked about "upcoming birthdays" without a timeframe, use
  `within_days=30`.
- If a request returns 401, stop and ask the user to check `KINDRED_TOKEN`;
  do not retry with other tokens.
