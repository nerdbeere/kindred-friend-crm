# Kindred

A minimal self-hosted friend/relationship CRM. Keep a list of people and their
birthdays; Kindred exposes one ICS calendar feed you can subscribe to from
Home Assistant (or any calendar app) so you never miss a birthday.

- **Contacts**: name, birthday (year optional), freeform notes
- **Web UI**: list / add / edit / delete, sorted by upcoming birthday
- **ICS feed**: `GET /api/feed/<token>.ics` — one all-day, yearly-recurring
  event per contact, regenerated live from the database on every request
- **Storage**: single SQLite file (`data/kindred.db`)
- **Auth**: none beyond the secret token in the feed URL — the whole point is
  that Home Assistant can poll the feed directly

Non-goals for v1: no login, no reminders/notifications, no tagging or
relationship types, no photos, no multi-user.

## Deploy to Proxmox LXC (one-liner)

Run as root on a Proxmox host:

```bash
curl -fsSL https://raw.githubusercontent.com/nerdbeere/kindred-friend-crm-install/main/setup-lxc.sh | bash
```

What it does:

1. Creates an unprivileged Debian 12 LXC (DHCP, starts on boot)
2. Installs Node.js 22 + build tools inside the container
3. Clones **this** (private) repo, runs `npm ci` + `npm run build`
4. Installs a `kindred` systemd service (enabled on boot) running `npm start`
5. Prints your secret ICS feed URL to paste into Home Assistant

Because the app repo is private, the installer generates a **read-only GitHub
deploy key** inside the container, prints the public key, and waits while you
add it at:

```
https://github.com/nerdbeere/kindred-friend-crm/settings/keys
```

Press Enter once it's added and provisioning continues. The installer itself
lives in a public mirror at
[nerdbeere/kindred-friend-crm-install](https://github.com/nerdbeere/kindred-friend-crm-install)
so the app repo can stay private.

### Bringing your own deploy key (non-interactive)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/kindred_deploy_key -N ''
# add ~/.ssh/kindred_deploy_key.pub to the repo's Deploy keys on GitHub, then:
curl -fsSL https://raw.githubusercontent.com/nerdbeere/kindred-friend-crm-install/main/setup-lxc.sh \
  | DEPLOY_KEY=~/.ssh/kindred_deploy_key bash
```

### Setup script options

All optional env vars (defaults shown):

| Var          | Default     | Meaning                          |
| ------------ | ----------- | -------------------------------- |
| `CT_ID`      | next free   | Container ID                     |
| `HOSTNAME`   | `kindred`   | Container hostname               |
| `CORES`      | `1`         | vCPUs                            |
| `MEMORY`     | `1024`      | RAM in MB                        |
| `SWAP`       | `512`       | Swap in MB                       |
| `DISK`       | `8`         | Root disk in GB                  |
| `STORAGE`    | `local-lvm`  | Proxmox storage for rootfs       |
| `BRIDGE`     | `vmbr0`     | Network bridge                   |
| `BRANCH`     | `main`      | Git branch to deploy             |
| `APP_PORT`   | `3000`      | App port                         |
| `NODE_MAJOR` | `22`        | Node.js major version            |

Example: `CT_ID=120 CORES=2 MEMORY=2048 ... | bash`

## Updating

From the Proxmox host (the feed URL survives updates — the token lives in the
database, not in git):

```bash
curl -fsSL https://raw.githubusercontent.com/nerdbeere/kindred-friend-crm-install/main/update-lxc.sh \
  | bash -s -- <CT_ID>
```

Or, if you cloned the repo on the host: `./proxmox/update-lxc.sh <CT_ID>`.
Inside the container: `bash /opt/kindred/scripts/update.sh` (run as root).

The update flow: `git pull --ff-only` → `npm ci` → `npm run build` →
`systemctl restart kindred` → health check → reprints the feed URL.

## Backups & admin

On first boot, browse to `http://<container-ip>:3000/` — the first-run
wizard will let you set an admin password (+ optionally configure
encrypted S3 backups) using the one-time **setup token** the installer
printed on the console.

- `/admin/*` requires login. The admin UI manages encrypted backups and
  one-click restore; everything else (the contacts UI, the ICS feed) is
  unchanged.
- Encrypted backups use `restic` (client-side AES-256), backed by any
  S3-compatible endpoint (B2, R2, AWS S3, MinIO, Wasabi, …). The S3
  operator can only see ciphertext.
- One-click restore via `/admin/backups` (with confirmation modal) or
  `scripts/restore.sh latest` inside the container.

Full backup/restore design, threat model, restore-from-scratch runbook,
IAM policy templates, and a local MinIO test harness are documented in
[`docs/BACKUPS.md`](docs/BACKUPS.md). Test the entire round-trip locally
before pointing it at a real S3 backend:

```bash
npm install
npm run dev:backup-test       # MinIO round-trip
npm run dev:restore-test      # disaster-recovery simulation
```

## Home Assistant integration

1. Run the installer, copy the printed ICS URL
2. In Home Assistant: **Settings → Devices & Services → Add Integration →
   "Remote Calendar"** and paste the URL

Anyone with the URL can read the feed — keep it secret. To rotate the token,
delete the `feed_token` row from the `settings` table (or set `ICS_FEED_TOKEN`
in the systemd unit) and restart the service.

## AI agent API

Machine clients (AI agents, scripts) can manage contacts over a JSON API,
authenticated with the **same token as the ICS feed**, sent as a Bearer
header:

```
Authorization: Bearer <feed-token>
```

| Endpoint                                    | Description                                   |
| ------------------------------------------- | --------------------------------------------- |
| `GET /api/agent/contacts`                   | List all, sorted by upcoming birthday         |
| `GET /api/agent/contacts?q=<text>`          | Substring search on name + notes              |
| `GET /api/agent/contacts?within_days=<n>`   | Only birthdays within the next `n` days       |
| `GET /api/agent/contacts/<id>`              | Get one contact                               |
| `POST /api/agent/contacts`                  | Create (same validation as the web UI)        |
| `PUT /api/agent/contacts/<id>`              | Full-replacement update                       |
| `DELETE /api/agent/contacts/<id>`           | Delete permanently                            |

Reads include a computed `days_until` field. Example:

```bash
TOKEN=$(npm run -s print:feed-token)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/agent/contacts?within_days=30"
```

A ready-made agent skill teaching AI coding assistants how to use this API
lives in [`skills/kindred/SKILL.md`](skills/kindred/SKILL.md) — copy or
symlink it into your agent's skills directory (e.g.
`~/.config/opencode/skills/` or `~/.agents/skills/`).

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
```

The SQLite database is created at `data/kindred.db` on first run (gitignored).
Override with `DATABASE_PATH=...`.

To print the current feed token:

```bash
npm run print:feed-token
```

## Layout

```
app/
  page.tsx                       # server: loads sorted contacts + feed token
  ContactsClient.tsx             # client UI: add/edit/delete, list, copy URL
  api/contacts/route.ts          # GET (list), POST (create)
  api/contacts/[id]/route.ts    # PUT, DELETE
  api/feed/[token]/route.ts     # ICS feed (token-gated, .ics suffix stripped)
  api/agent/contacts/route.ts   # agent API: list/search/upcoming, create
  api/agent/contacts/[id]/route.ts  # agent API: get, update, delete
lib/
  db.ts                          # better-sqlite3 singleton (WAL), schema, token
  contacts.ts                    # CRUD, validation, upcoming-birthday sort
  ics.ts                         # yearly recurring all-day events via `ics`
  agent-auth.ts                  # Bearer-token check for /api/agent/*
skills/
  kindred/SKILL.md               # agent skill: teaches AI to use the API
scripts/
  print-feed-token.js            # token helper (used by deploy + npm script)
  update.sh                      # in-container update flow
proxmox/
  setup-lxc.sh                   # Proxmox host: provision + deploy
  update-lxc.sh                  # Proxmox host: update existing CT
```

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · better-sqlite3 · `ics`
package · single `next build` + `next start` under Node, sized for an LXC.