#!/usr/bin/env bash
# First-boot setup of a fresh Ubuntu 22.04 / 24.04 server for UniVerse. cloud-init runs it once; it is safe to re-run.
# Installs Node 22 + Caddy (automatic HTTPS), creates the `universe` user and folders, generates the app's secrets and
# the GitHub deploy key on the server (they never leave it), opens only ports 22 / 80 / 443, and starts the deploy +
# backup timers. The first deploy happens on its own once the deploy key is added on GitHub.
set -Eeuo pipefail
export DEBIAN_FRONTEND=noninteractive
log() { echo "[universe-bootstrap] $*"; }

# 1. swap: a 1 GB server needs it to build the web app
if ! swapon --show=NAME --noheadings | grep -q '^/swapfile$'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

# 2. packages
log "installing packages"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git sqlite3 build-essential python3 ufw openssl \
  debian-keyring debian-archive-keyring apt-transport-https
if ! command -v node >/dev/null 2>&1 || [[ $(node -v) != v22.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

# 3. app user + folders (the data folder is the only place the app writes user data)
id universe >/dev/null 2>&1 || useradd --system --home-dir /var/lib/universe/home --shell /usr/sbin/nologin universe
install -d -m 0755 /opt/universe /opt/universe/releases
install -d -o universe -g universe -m 0750 /var/lib/universe /var/lib/universe/uploads /var/lib/universe/home /var/lib/universe/npm-cache
install -d -m 0700 /var/lib/universe/backups
install -d -g universe -m 0750 /etc/universe

# 4. the app's settings + secrets (generated here; they never leave this server)
if [[ ! -f /etc/universe/universe.env ]]; then
  log "generating secrets"
  umask 027
  cat >/etc/universe/universe.env <<ENV
NODE_ENV="production"
PORT="4000"
TRUST_PROXY="1"
DB_PATH="/var/lib/universe/universe.db"
UPLOADS_DIR="/var/lib/universe/uploads"
BUZZ_ALIAS_SECRET="$(openssl rand -hex 32)"
CURSOR_SECRET="$(openssl rand -hex 32)"
NODE_OPTIONS="--max-old-space-size=512"
ENV
  umask 022
fi
chown root:universe /etc/universe/universe.env
chmod 640 /etc/universe/universe.env

# 5. the deploy key: read-only access to the GitHub repo, added by you on GitHub
if [[ ! -f /etc/universe/deploy_key ]]; then
  ssh-keygen -q -t ed25519 -N '' -C "universe-server@$(hostname)" -f /etc/universe/deploy_key
fi
chmod 600 /etc/universe/deploy_key
chmod 644 /etc/universe/deploy_key.pub

# 6. firewall: SSH + web only (the app's own port 4000 is never exposed)
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

# 7. services
systemctl daemon-reload
systemctl enable --now universe-deploy.timer universe-backup.timer
/usr/local/bin/universe-config caddy-reload || true

log "done. Next: add the deploy key on GitHub (universe-config deploy-key); the app deploys itself within 2 minutes."
