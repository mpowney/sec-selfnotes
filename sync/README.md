# Sec SelfNotes Sync service

A separate container (`sync/`) that keeps import/export/continuous-sync code out of the core app. It only
serves a static browser tool under `/sync`; **all encryption/decryption happens in the browser** with the
same WebAuthn-PRF master key as the main app, so the servers never see plaintext or tokens. It talks to the
core API (`/api/...`) on the same host name, sharing the session cookie.

## Features
- **OneNote (OneDrive) import + continuous sync** via Microsoft Graph (PKCE, read-only `Notes.Read`). Pages are listed newest-first with a
  per-section watermark so re-syncs are incremental; Graph 429/503 throttling is retried honouring `Retry-After`; pages are fetched with bounded concurrency. Images/attached files are streamed, chunk-encrypted (16 MiB, same format as the core editor) and uploaded as note attachments. Local edits are never overwritten: a changed remote page is saved as a separate "conflict" note.
- **Folder import + watch** (Markdown, text, HTML, relative/`data:` attachments). For **iCloud Notes** run `tools/icloud-export.js` on a Mac (cron/launchd) and watch its output folder (Chromium File System Access API; other browsers can do one-off imports).
- **Export** all notes + attachments to a folder (unlimited size) or a streamed `.zip` (no ZIP64: files < 4 GiB, < 65 535 entries).
- Source-to-note mappings are stored as client-encrypted blobs through `GET/PUT /api/sync-state/:key`.

Limitations: syncing needs the browser tab open and unlocked (the key is memory-only); one-way (source → SelfNotes); source deletions are not propagated; OneNote HTML→Markdown is lossy (ink, complex layouts); replaced attachments of updated notes are not garbage-collected.

## Core API changes
- `GET /api/notes` supports `modifiedSince` (epoch ms) and returns `total`.
- `POST /api/notes` accepts optional `createdAt` / `modifiedAt` to preserve original timestamps.
- `GET|PUT /api/sync-state/:key` store opaque SCE1 sync state (max 8 MB) per user.

## Configuration
| Variable | Default | |
|---|---|---|
| `PORT` | `4100` | listen port |
| `BASE_PATH` | `/sync` | URL prefix forwarded by the proxy (not stripped) |
| `MS_CLIENT_ID` | – | Entra app registration (platform **Single-page application**, redirect URI `https://<host>/sync/`, delegated `Notes.Read`) |
| `MS_TENANT` | `common` | tenant id or `common`/`consumers`/`organizations` |

## Caddy
Serve the sync service from the existing host name under `/sync`. Do **not** strip the prefix
(the service is mounted at `/sync`):

```caddyfile
notes.example.com {
    encode zstd gzip

    # sync service (must come before the catch-all)
    handle /sync* {
        reverse_proxy sync:4100
    }

    handle {
        reverse_proxy selfnotes:4000
    }
}
```

- If Caddy runs in the same compose project use the service names above; otherwise use `localhost:4100` / `localhost:4000` (the compose file publishes both ports).
- `handle` blocks are mutually exclusive, so `/sync*` never reaches the core app (whose SPA catch-all would otherwise answer it). `/api/*` stays on the core app, which the sync page calls same-origin.
- Large attachments: Caddy has no request-body limit by default and streams uploads (16 MiB chunks), so no extra settings are needed. Don't add `request_body max_size` below 17 MiB.
- Set `WEBAUTHN_ID` / `WEBAUTHN_ORIGIN` of the core app to the same public host so the key unlock in `/sync` works.

## Development
```sh
cd sync && npm ci && npm test && npm run build && MS_CLIENT_ID=... npm start
```
