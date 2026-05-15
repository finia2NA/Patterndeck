#!/bin/bash
# Deploy PatternDeck frontend + backend to VPS
# Usage: bash deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

SERVER="ionos"
REMOTE_APP="/home/patterndeck/app"
REMOTE_WEB="/home/patterndeck/web"
TEMP_DIR="/tmp/patterndeck-deploy"

echo "=== Building frontend (Expo web) ==="
pnpm --filter client exec expo export --platform web --clear

echo ""
echo "=== Building shared package ==="
pnpm --filter @patterndeck/shared build

echo ""
echo "=== Building backend (TypeScript) ==="
pnpm --filter server build

echo ""
echo "=== Uploading to server ==="
ssh ${SERVER} "mkdir -p ${TEMP_DIR}/{server,client,shared,scripts,web}"

# Upload server files (source + dist + prisma, excluding node_modules/.env/db)
# Include root-level pnpm files so pnpm install --filter works on the VPS
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.env' \
  --exclude='*.db' \
  --exclude='*.db-journal' \
  server/ ${SERVER}:${TEMP_DIR}/server/

rsync -az \
  package.json pnpm-workspace.yaml pnpm-lock.yaml \
  ${SERVER}:${TEMP_DIR}/

rsync -az scripts/admin.sh ${SERVER}:${TEMP_DIR}/scripts/admin.sh

rsync -az \
  deploy/patterndeck.nginx.conf deploy/patterndeck.service \
  ${SERVER}:${TEMP_DIR}/

# Send real client package.json so the lockfile matches
rsync -az client/package.json ${SERVER}:${TEMP_DIR}/client/package.json

# Upload shared workspace package required by the backend at runtime
rsync -az --delete \
  --exclude='node_modules' \
  shared/ ${SERVER}:${TEMP_DIR}/shared/

# Upload web static files
rsync -az --delete \
  client/dist/ ${SERVER}:${TEMP_DIR}/web/

echo ""
echo "=== Deploying on server ==="
ssh ${SERVER} << 'DEPLOY_EOF'
  set -euo pipefail

  REMOTE_APP="/home/patterndeck/app"
  REMOTE_WEB="/home/patterndeck/web"
  TEMP_DIR="/tmp/patterndeck-deploy"

  ENV_DIR="/home/patterndeck/env"
  id patterndeck &>/dev/null || useradd --system --create-home --shell /bin/bash patterndeck
  mkdir -p ${ENV_DIR} ${REMOTE_APP}/server ${REMOTE_WEB} /home/patterndeck/data

  # Install nginx config on first deploy. Do not overwrite later, because certbot
  # manages this file after HTTPS is enabled.
  [ -f /etc/nginx/sites-available/patterndeck ] || install -m 0644 ${TEMP_DIR}/patterndeck.nginx.conf /etc/nginx/sites-available/patterndeck
  ln -sf /etc/nginx/sites-available/patterndeck /etc/nginx/sites-enabled/patterndeck
  rm -f /etc/nginx/sites-enabled/grammarcrammer
  install -m 0644 ${TEMP_DIR}/patterndeck.service /etc/systemd/system/patterndeck.service
  systemctl daemon-reload

  # Carry forward data/secrets from the pre-rename deployment.
  if [ -d /home/grammarcrammer ]; then
    if [ ! -f /home/patterndeck/data/patterndeck.db ] && [ -f /home/grammarcrammer/data/grammarcrammer.db ]; then
      cp /home/grammarcrammer/data/grammarcrammer.db /home/patterndeck/data/patterndeck.db
    fi

    if [ ! -f ${ENV_DIR}/server.env ]; then
      if [ -f /home/grammarcrammer/env/server.env ]; then
        cp /home/grammarcrammer/env/server.env ${ENV_DIR}/server.env
      elif [ -f /home/grammarcrammer/app/server/.env ]; then
        cp /home/grammarcrammer/app/server/.env ${ENV_DIR}/server.env
      fi
    fi
  fi

  # Move .env files to persistent location if still inside app/
  [ -f ${REMOTE_APP}/server/.env ] && [ ! -f ${ENV_DIR}/server.env ] && mv ${REMOTE_APP}/server/.env ${ENV_DIR}/server.env
  [ -f ${REMOTE_APP}/client/.env ] && [ ! -f ${ENV_DIR}/client.env ] && mv ${REMOTE_APP}/client/.env ${ENV_DIR}/client.env

  if [ -f ${ENV_DIR}/server.env ]; then
    sed -i \
      -e 's|^DATABASE_URL=.*|DATABASE_URL="file:/home/patterndeck/data/patterndeck.db"|' \
      -e 's|^APP_URL=.*|APP_URL="https://patterndeck.richardhanss.de"|' \
      -e 's|^EMAIL_FROM=.*|EMAIL_FROM="PatternDeck <noreply@patterndeck.richardhanss.de>"|' \
      ${ENV_DIR}/server.env
  fi

  # Stop service
  systemctl stop patterndeck 2>/dev/null || true
  systemctl stop grammarcrammer 2>/dev/null || true

  # Swap in new app files
  rm -rf ${REMOTE_APP}/*
  cp -r ${TEMP_DIR}/package.json ${TEMP_DIR}/pnpm-workspace.yaml ${TEMP_DIR}/pnpm-lock.yaml ${REMOTE_APP}/
  cp -r ${TEMP_DIR}/server ${REMOTE_APP}/server
  cp -r ${TEMP_DIR}/client ${REMOTE_APP}/client
  cp -r ${TEMP_DIR}/shared ${REMOTE_APP}/shared
  cp -r ${TEMP_DIR}/scripts ${REMOTE_APP}/scripts

  # Symlink .env files from persistent location
  [ -f ${ENV_DIR}/server.env ] && ln -sf ${ENV_DIR}/server.env ${REMOTE_APP}/server/.env
  [ -f ${ENV_DIR}/client.env ] && ln -sf ${ENV_DIR}/client.env ${REMOTE_APP}/client/.env

  # Swap in new web files
  rm -rf ${REMOTE_WEB}/*
  cp -r ${TEMP_DIR}/web/* ${REMOTE_WEB}/

  # Fix ownership and permissions for nginx
  chown -R patterndeck:patterndeck ${REMOTE_APP} ${REMOTE_WEB}
  chmod o+x /home/patterndeck
  chmod -R o+r ${REMOTE_WEB}
  find ${REMOTE_WEB} -type d -exec chmod o+x {} +

  # Install production dependencies (prisma is a prod dep)
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm
  cd ${REMOTE_APP}
  sudo -u patterndeck pnpm install --filter server --prod --frozen-lockfile --ignore-scripts

  # Generate Prisma client and run migrations
  cd ${REMOTE_APP}/server
  sudo -u patterndeck npx prisma generate
  sudo -u patterndeck npx prisma migrate deploy

  # Start service
  systemctl disable grammarcrammer 2>/dev/null || true
  systemctl start patterndeck

  # Cleanup
  rm -rf ${TEMP_DIR}

  echo ""
  echo "Service status: $(systemctl is-active patterndeck)"
DEPLOY_EOF

echo ""
echo "=== Verifying deployment ==="
sleep 2
STATUS=$(curl -sf https://patterndeck.richardhanss.de/api/v1/health 2>&1) && echo "Health check: ${STATUS}" || echo "Health check failed (may need DNS/SSL setup first)"

echo ""
echo "=== Done ==="
