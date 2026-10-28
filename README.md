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

*Password managers (e.g. Bitwarden passkeys)*: passkeys without PRF support are accepted. The master key is then wrapped with a passphrase (PBKDF2-SHA-256, 600k iterations, random salt; stored with a `pw1:` prefix) that you keep in your password manager and enter at sign-in.

SQLite stores only users, credentials/wrapped keys and note metadata (id, title, category, timestamps). On startup the notes directory is scanned and DB rows with missing files are removed.

## API

`GET /api/auth/status`, `GET /api/auth/credentials`, `DELETE /api/auth/credentials/:id`, `PATCH /api/auth/credentials/:id/name`, `POST /api/auth/add-credential/start|finish`;
`POST /api/auth/register`, `/register/verify`, `/signin/challenge`, `/signin/verify`, `/logout`;
`GET/POST /api/notes` (`?limit&offset&category`), `GET/PUT/DELETE /api/notes/:noteId`, `GET /api/notes/:noteId/metadata`, `GET /api/categories`.

## Onboarding and admin portal

- **First start**: a default `admin` account is created and its randomly generated password is printed **once** in the server log (`docker compose logs`). It is stored only as a bcrypt hash.
- **First user**: open the app, choose the **Register** tab, enter a username and register your YubiKey/passkey (PRF-capable). Registration signs you in and creates your wrapped master key.
- **Admin portal** at `/admin` (password login, separate from WebAuthn sessions; admin sessions cannot access notes). The dashboard lists users (created, last login, authenticator and note counts), lets admins revoke individual authenticators (never the last one) and delete users with their notes.
- **Reload**: the server session survives a page reload (`GET /api/auth/status`), but the master key is memory-only, so you are asked to touch your authenticator to unlock your notes again.
- **Authenticators** (header button): register additional authenticators (the master key is wrapped for each, with an optional name encrypted by the master key so only you can read it) and revoke your own authenticators other than the one in the current session or the last one.
- Admin API: `GET /api/admin/status`, `POST /login`, `/logout`, `GET /users`, `DELETE /users/:id`, `GET /users/:id/credentials`, `DELETE /users/:id/credentials/:credentialId`.

## Configuration

See `.env.example`: `SYSTEM_ENCRYPTION_KEY` (64 hex chars), `SESSION_SECRET`, `PORT` (4000), `WEBAUTHN_ID`, `WEBAUTHN_ORIGIN`, `WEBAUTHN_NAME`, `DATA_DIR` (`./data`), `NODE_ENV`.

## Development

```sh
cd server && npm ci && npm test && SYSTEM_ENCRYPTION_KEY=$(openssl rand -hex 32) SESSION_SECRET=dev npm run dev
cd client && npm ci && npm run dev   # http://localhost:5173 (proxies /api to :4000)
```

For WebAuthn on the Vite dev server set `WEBAUTHN_ORIGIN=http://localhost:5173`.

## Deployment

```sh
cp .env.example .env   # fill in values, set WEBAUTHN_ID/WEBAUTHN_ORIGIN to your domain
docker compose up -d --build
# multi-platform image: docker buildx build --platform linux/arm64,linux/amd64 .
```

TLS is terminated by a separate Caddy instance (not part of this repo's compose file); the app listens on plain HTTP port 4000 and data persists in `./data`. See [Caddy reverse proxy](#caddy-reverse-proxy).

### Caddy reverse proxy

Configure your existing Caddy to proxy your domain to the app (TLS is assumed to be handled there already):

```
notes.example.com {
	reverse_proxy <docker-host-ip-or-hostname>:4000
}
```

Set `WEBAUTHN_ID=notes.example.com` and `WEBAUTHN_ORIGIN=https://notes.example.com` in `.env`; `WEBAUTHN_ORIGIN` must exactly match the URL used in the browser. If Caddy runs in Docker on the same host, either attach it to the same network and use `selfnotes:4000`, or use the host's IP and the published port 4000. Restrict port 4000 to the Caddy host (e.g. firewall) so it isn't reachable directly.

## Raspberry Pi Docker Deployment

### Prerequisites

- Raspberry Pi 3/4/5 (4 GB+ RAM recommended for building; 1 GB can run the built image) with Raspberry Pi OS (Bookworm or newer, 64-bit recommended; 32-bit also works, see below)
- Docker Engine 24+ and the Docker Compose v2 plugin
- A domain name pointing at the Pi (required for WebAuthn/YubiKey) served over HTTPS by your separate Caddy, which must be able to reach port 4000 on the Pi
- Internet access and ~3 GB free disk space for the build

### Install Docker and Docker Compose

```sh
# update the OS
sudo apt update && sudo apt full-upgrade -y

# install Docker Engine and the Compose plugin using the official convenience script
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
rm get-docker.sh

# allow your user to run docker without sudo (log out and back in afterwards)
sudo usermod -aG docker $USER

# verify
docker --version
docker compose version
uname -m   # aarch64 = 64-bit, armv7l = 32-bit
```

### Quick Start

```sh
# 1. clone the repository and check out the branch
git clone https://github.com/mpowney/sec-selfnotes.git
cd sec-selfnotes
git checkout copilot/develop-encrypted-note-app

# 2. create the environment file
cp .env.example .env

# 3. generate secrets and append them (or edit .env by hand)
echo "SYSTEM_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "SESSION_SECRET=$(openssl rand -base64 48)"
nano .env
#   SYSTEM_ENCRYPTION_KEY=<64 hex chars>   (back this up; losing it makes notes unreadable)
#   SESSION_SECRET=<random string>
#   WEBAUTHN_ID=notes.example.com                (your domain, no scheme)
#   WEBAUTHN_ORIGIN=https://notes.example.com    (must match the browser URL exactly)

# 4. build the image (native build on a 64-bit Pi produces linux/arm64)
docker compose build

# 5. start in the background
docker compose up -d

# 6. check status, then open https://<your-domain> (served via your separate Caddy)
docker compose ps
docker compose logs -f selfnotes
```

Notes: the app is published on port 4000; point your separate Caddy at it (see [Caddy reverse proxy](#caddy-reverse-proxy)). Data is persisted in `./data`.

### Manual Docker Build and Run (without Compose)

```sh
# build for ARM64 (use --platform linux/arm/v7 on 32-bit OS)
docker build -t sec-selfnotes .

# run; persists data in ./data (the container runs as uid 1000 "node")
mkdir -p data && sudo chown 1000:1000 data
docker run -d --name selfnotes --restart unless-stopped \
  --env-file .env \
  -e NODE_ENV=production -e DATA_DIR=/data -e PORT=4000 \
  -p 4000:4000 \
  -v "$(pwd)/data:/data" \
  sec-selfnotes
```

The app is served over plain HTTP on port 4000. WebAuthn only works on `localhost` or HTTPS, so put your Caddy (or other TLS proxy) in front.

### Raspberry Pi Specific Configuration

**32-bit ARM (armv7).** The Dockerfile uses `node:22-bookworm-slim`, which publishes `linux/arm/v7` images, so `docker compose build` works natively on a 32-bit OS. Native modules (e.g. SQLite) compile during the build, which is slow; builds can instead be done on another machine:

```sh
docker buildx create --use
docker buildx build --platform linux/arm64,linux/arm/v7 -t sec-selfnotes --load .   # --load supports a single platform; use --push with a registry for multi-platform
```

**TLS/HTTPS.** TLS is handled by your separate Caddy instance; see [Caddy reverse proxy](#caddy-reverse-proxy). Ensure its site block proxies to this Pi on port 4000 and that `WEBAUTHN_ORIGIN` is `https://<domain>`.

### Troubleshooting

**Container fails to start**
```sh
docker compose logs selfnotes
```
Compose refuses to start if `SYSTEM_ENCRYPTION_KEY`, `SESSION_SECRET`, `WEBAUTHN_ID` or `WEBAUTHN_ORIGIN` are unset. The key must be 64 hex characters (`openssl rand -hex 32`).

**Out of memory on older Pi models (1 GB RAM)**
```sh
free -h
# add temporary swap for the build
sudo dphys-swapfile swapoff
sudo sed -i 's/^CONF_SWAPSIZE=.*/CONF_SWAPSIZE=2048/' /etc/dphys-swapfile
sudo dphys-swapfile setup && sudo dphys-swapfile swapon
```
Alternatively build the image on another machine (see above) and pull it on the Pi.

**SQLite database locking / permission errors**
- Keep `./data` on local storage (SD card/SSD), not NFS/SMB, which break SQLite locking.
- Run only one instance against a given data directory.
- Fix ownership: `sudo chown -R 1000:1000 data`
- Stop the container before copying or backing up the database files: `docker compose stop selfnotes`

**Network and connectivity**
```sh
docker compose ps                      # selfnotes should be "running"
curl -I http://localhost:4000          # test locally on the Pi
sudo ss -tlnp | grep ':4000'           # check the port is bound
```
Check that Caddy can reach port 4000 on the Pi, DNS (`dig +short notes.example.com`) and any firewall (`sudo ufw status`).

**WebAuthn / YubiKey problems**
- `WEBAUTHN_ID` must be the bare domain and `WEBAUTHN_ORIGIN` must exactly match the URL in the browser (scheme, host, port).
- WebAuthn requires HTTPS (or `localhost`); verify the certificate is valid.
- Changing `WEBAUTHN_ID` invalidates previously registered keys.

**Node.js memory issues**
```sh
# cap the V8 heap by adding to the selfnotes service in docker-compose.yml
#   environment:
#     NODE_OPTIONS: --max-old-space-size=256
docker stats --no-stream
```
If `npm ci` is killed during the build, add swap as above.

### Performance Optimization

- Use an SSD (USB 3) instead of an SD card for `./data` and Docker's storage.
- Limit resources in `docker-compose.yml` (e.g. `mem_limit: 512m` on `selfnotes`) so the OS keeps headroom.
- Set `NODE_OPTIONS=--max-old-space-size=<MB>` to roughly 50-60% of the memory available to the container.
- Run the Pi headless (`sudo raspi-config` → boot to console) to free RAM.
- Reclaim disk space regularly: `docker image prune -f`.

### Monitoring

```sh
docker compose ps                         # container state
docker compose logs -f --tail=100         # live logs
docker stats                              # CPU / memory per container
docker inspect --format '{{.State.Status}} restarts={{.RestartCount}}' $(docker compose ps -q selfnotes)
vcgencmd measure_temp                     # SoC temperature
free -h && df -h                          # memory and disk
vcgencmd get_throttled                    # 0x0 = no under-voltage/throttling
```

### Updating

```sh
cd sec-selfnotes
cp -a data data.bak-$(date +%F)           # back up first
git pull origin copilot/develop-encrypted-note-app
docker compose build --pull
docker compose up -d
docker image prune -f
```
