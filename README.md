# sec-selfnotes

An end-to-end encrypted note-taking application with YubiKey-based authentication and WYSIWYG markdown editor.

## Features

- 🔐 **YubiKey authentication** via WebAuthn/FIDO2 (passkey login — no passwords)
- 🔒 **Two-layer end-to-end encryption** (server + client with PRF-derived keys)
- 📝 **WYSIWYG markdown editor** for rich note editing
- 📂 **Categorized notes** with filesystem-based storage
- 🌐 **Multi-note UI** with left sidebar navigation
- 💾 **SQLite database** — lightweight for Raspberry Pi
- 🐳 **Docker containerized** — runs on Raspberry Pi (arm64) and macOS/Linux (amd64)
- 🖥️ **React + Fluent UI v9** frontend

## Architecture

- `server/` – Node 22 + Express + TypeScript, SQLite (`better-sqlite3`), WebAuthn via `@simplewebauthn/server`.
- `client/` – React + Fluent UI v9, `@uiw/react-md-editor` (lazy loaded) for markdown editing.

**Encryption layers**

1. *Client (E2E)*: a random master key is wrapped (AES-256-GCM) with a key derived from the authenticator's WebAuthn PRF output; one wrapped copy per credential is stored in SQLite. Each note's markdown (including its front-matter metadata: title, category, created, modified, tags) is encrypted in the browser as `SCE1` = `["SCE1"][12-byte IV][AES-256-GCM ciphertext]`. The server rejects anything that is not SCE1 and never sees plaintext.
2. *Server*: the SCE1 blob is encrypted again with a per-note AES-256-GCM key derived via HKDF-SHA256 from `SYSTEM_ENCRYPTION_KEY` and the note id, then written to `DATA_DIR/notes/<category>/<noteId>.md`.

SQLite stores only users, credentials/wrapped keys and note metadata (id, title, category, timestamps). On startup the notes directory is scanned and DB rows with missing files are removed.

## API

`POST /api/auth/register`, `/register/verify`, `/signin/challenge`, `/signin/verify`, `/logout`;
`GET/POST /api/notes` (`?limit&offset&category`), `GET/PUT/DELETE /api/notes/:noteId`, `GET /api/notes/:noteId/metadata`, `GET /api/categories`.

## Configuration

See `.env.example`: `SYSTEM_ENCRYPTION_KEY` (64 hex chars), `SESSION_SECRET`, `PORT` (4000), `RP_ID`, `RP_ORIGIN`, `RP_NAME`, `DATA_DIR` (`./data`), `NODE_ENV`.

## Development

```sh
cd server && npm ci && npm test && SYSTEM_ENCRYPTION_KEY=$(openssl rand -hex 32) SESSION_SECRET=dev npm run dev
cd client && npm ci && npm run dev   # http://localhost:5173 (proxies /api to :4000)
```

For WebAuthn on the Vite dev server set `RP_ORIGIN=http://localhost:5173`.

## Deployment

```sh
cp .env.example .env   # fill in values, set RP_ID/RP_ORIGIN to your domain
docker compose up -d --build
# multi-platform image: docker buildx build --platform linux/arm64,linux/amd64 .
```

Caddy terminates TLS (see `Caddyfile`); data persists in `./data`.
