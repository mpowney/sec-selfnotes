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

## Raspberry Pi Docker Deployment

### Prerequisites

- Raspberry Pi 3/4/5 (4 GB+ RAM recommended for building; 1 GB can run the built image) with Raspberry Pi OS (Bookworm or newer, 64-bit recommended; 32-bit also works, see below)
- Docker Engine 24+ and the Docker Compose v2 plugin
- A domain name pointing at the Pi (required for WebAuthn/YubiKey and automatic HTTPS), with ports 80 and 443 reachable
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
git checkout copilot/copilotdevelop-encrypted-note-app

# 2. create the environment file
cp .env.example .env

# 3. generate secrets and append them (or edit .env by hand)
echo "SYSTEM_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "SESSION_SECRET=$(openssl rand -base64 48)"
nano .env
#   SYSTEM_ENCRYPTION_KEY=<64 hex chars>   (back this up; losing it makes notes unreadable)
#   SESSION_SECRET=<random string>
#   RP_ID=notes.example.com                (your domain, no scheme)
#   RP_ORIGIN=https://notes.example.com    (must match the browser URL exactly)

# 4. set your domain in the Caddyfile (replace {$RP_ID:localhost} with your domain)
nano Caddyfile

# 5. build the image (native build on a 64-bit Pi produces linux/arm64)
docker compose build

# 6. start in the background
docker compose up -d

# 7. check status, then open https://<your-domain>
docker compose ps
docker compose logs -f selfnotes
```

Notes: the `caddy` service does not receive `.env` values, so set the domain directly in the `Caddyfile` as in step 4. Data is persisted in `./data` and Caddy certificates in the `caddy_data` volume.

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

Without Caddy the app is served over plain HTTP on port 4000. WebAuthn only works on `localhost` or HTTPS, so put a TLS proxy in front for real use.

### Raspberry Pi Specific Configuration

**32-bit ARM (armv7).** The Dockerfile uses `node:22-bookworm-slim`, which publishes `linux/arm/v7` images, so `docker compose build` works natively on a 32-bit OS. Native modules (e.g. SQLite) compile during the build, which is slow; builds can instead be done on another machine:

```sh
docker buildx create --use
docker buildx build --platform linux/arm64,linux/arm/v7 -t sec-selfnotes --load .   # --load supports a single platform; use --push with a registry for multi-platform
```

**TLS/HTTPS with Caddy.** Caddy obtains and renews Let's Encrypt certificates automatically when:

- the domain's DNS points to the Pi's public IP
- ports 80 and 443 are forwarded to the Pi
- `Caddyfile` contains your real domain, and `RP_ORIGIN` is `https://<domain>`

```sh
docker compose logs caddy   # watch certificate issuance
```

For LAN-only use, Caddy can issue internal certificates with `tls internal` inside the site block; browsers must then trust Caddy's local root CA.

### Troubleshooting

**Container fails to start**
```sh
docker compose logs selfnotes
```
Compose refuses to start if `SYSTEM_ENCRYPTION_KEY`, `SESSION_SECRET`, `RP_ID` or `RP_ORIGIN` are unset. The key must be 64 hex characters (`openssl rand -hex 32`).

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
docker compose ps                      # both services should be "running"
curl -I http://localhost:80            # test locally on the Pi
sudo ss -tlnp | grep -E ':(80|443)'    # check nothing else is bound to the ports
```
Check router port forwarding, DNS (`dig +short notes.example.com`) and any firewall (`sudo ufw status`).

**WebAuthn / YubiKey problems**
- `RP_ID` must be the bare domain and `RP_ORIGIN` must exactly match the URL in the browser (scheme, host, port).
- WebAuthn requires HTTPS (or `localhost`); verify the certificate is valid.
- Changing `RP_ID` invalidates previously registered keys.

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
- Limit resources in `docker-compose.yml` (e.g. `mem_limit: 512m` on `selfnotes`) so Caddy and the OS keep headroom.
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
git pull origin copilot/copilotdevelop-encrypted-note-app
docker compose build --pull
docker compose up -d
docker image prune -f
```
