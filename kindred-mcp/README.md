# kindred-mcp

MCP (Model Context Protocol) server for [Kindred](https://github.com/hol0008j/kindred-friend-crm),
a minimal self-hosted friend/relationship CRM.

Exposes Kindred's contacts via MCP tools so any MCP-aware AI client (Claude
Desktop, Cursor, opencode, etc.) can list, search, create, update, and delete
contacts through natural language.

Talks to Kindred over its HTTP agent API (`/api/agent/*`) using Bearer-token
auth. Never touches the SQLite database directly.

## Requirements

- Node.js >= 18 (uses built-in `fetch`)
- A running Kindred instance and its API/feed token

## Setup

```bash
npm install
npm run build
```

Get the token for your Kindred instance (on the Kindred host):

```bash
npm run print:feed-token
```

## Configuration

Two required environment variables, matching the naming already used by
Kindred's agent skill:

- `KINDRED_URL` — base URL of the Kindred instance, e.g. `https://kindred.example.com`
- `KINDRED_TOKEN` — bearer token printed by `npm run print:feed-token`

The server fails fast at startup if either is missing or `KINDRED_URL` isn't
a valid URL.

## Run with an MCP client

Add to your client's MCP config (example for Claude Desktop / Cursor / opencode
style JSON configs):

```json
{
  "mcpServers": {
    "kindred": {
      "command": "node",
      "args": ["/absolute/path/to/kindred-mcp/dist/index.js"],
      "env": {
        "KINDRED_URL": "https://kindred.example.com",
        "KINDRED_TOKEN": "paste-token-here"
      }
    }
  }
}
```

Or run directly for manual testing:

```bash
KINDRED_URL=http://localhost:3000 \
KINDRED_TOKEN=... \
node dist/index.js
```

The server speaks MCP over stdio.

## Tools

### `list_contacts`

List contacts sorted by upcoming birthday (soonest first).

- `q` (string, optional) — case-insensitive substring matched against name and notes.
- `within_days` (integer 0–3660, optional) — only contacts whose next birthday is within N days. For generic "upcoming birthdays" questions, pass `30`.

Each result includes `days_until` (days until that contact's next birthday).

### `get_contact`

Fetch one contact by id.

- `id` (integer, required)

### `create_contact`

Create a contact.

- `first_name` (string, required)
- `birth_month` (integer 1–12, required)
- `birth_day` (integer 1–31, required; validated against the month server-side)
- `last_name` (string, optional)
- `birth_year` (integer 1800–current year, optional, nullable) — if the user doesn't give a year, omit this; never guess
- `notes` (string up to 10000 chars, optional)

Returns the new contact including `id` and `days_until`.

### `update_contact`

Partially update a contact. Only the fields you pass are changed; omitted
fields keep their current values. Pass `birth_year: null` to explicitly clear
an existing birth year.

- `id` (integer, required)
- any subset of `first_name`, `last_name`, `birth_month`, `birth_day`, `birth_year`, `notes`

Under the hood the tool does GET → merge → PUT, because Kindred's HTTP API
is full-replacement only.

### `delete_contact`

Permanently delete a contact. Two-step:

1. Call with `id` only (or `confirm: false`) — returns the contact's details and a confirmation prompt. Nothing is deleted.
2. Call again with `id` and `confirm: true` — actually deletes.

Always show the contact to the user and get explicit approval before the
confirming call.

## Error behavior

All tool errors are returned as MCP `isError` content, not thrown exceptions:

- Network failure → `Could not reach Kindred at <KINDRED_URL>: ...`
- `401` → guidance to check `KINDRED_TOKEN`
- `400` → Kindred's own validation message, verbatim
- `404` → `Contact <id> not found.`

## Development

```bash
npm run build       # tsc -> dist/
npm test            # vitest (mocked fetch, no live Kindred needed)
npm run typecheck   # tsc --noEmit
```

Layout:

```
src/
  index.ts          # stdio bootstrap
  config.ts         # env loading + fail-fast validation
  kindredClient.ts   # typed HTTP wrapper around /api/agent/contacts
  types.ts          # zod schemas mirroring Kindred's validateContact
  errors.ts         # KindredApiError + MCP error mapping
  tools/            # one file per MCP tool
test/
  config.test.ts
  kindredClient.test.ts
  tools.test.ts
```
