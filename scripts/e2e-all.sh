#!/usr/bin/env bash
# Construit et teste l'application dans ses 3 configurations :
# production (Supabase factice), sans configuration, démo.
# Aucune base réelle n'est contactée.
set -euo pipefail
PORT=3200
pkill -f "next-server" 2>/dev/null || true
run() {
  local mode=$1; shift
  echo "════ $mode ════"
  rm -rf .next
  env "$@" npx next build > /tmp/e2e-build-$mode.log 2>&1 || { tail -30 /tmp/e2e-build-$mode.log; exit 1; }
  env "$@" npx next start -p $PORT > /tmp/e2e-server-$mode.log 2>&1 &
  local pid=$!
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/" && break; sleep 0.5; done
  E2E_MODE=$mode E2E_BASE_URL=http://localhost:$PORT CRON_SECRET="${CRON_SECRET_TEST:-}" npx vitest run --config vitest.e2e.config.mts || { stop; exit 1; }
  stop
}
# Arrête le serveur ET ses processus enfants, puis attend que le port soit libre.
stop() {
  pkill -f "next-server" 2>/dev/null || true
  pkill -f "next start -p $PORT" 2>/dev/null || true
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/" || return 0; sleep 0.5; done
  echo "Le port $PORT est toujours occupé" >&2; exit 1
}
FAKE=(NEXT_PUBLIC_SUPABASE_URL=https://e2etest.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_e2e)
run production NEXT_PUBLIC_APP_ENV=production "${FAKE[@]}" SUPABASE_SERVICE_ROLE_KEY=e2e-service-role-secret
run noenv -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY NEXT_PUBLIC_APP_ENV=production
export CRON_SECRET_TEST=cron-secret-de-test-0123456789
run demo NEXT_PUBLIC_APP_ENV=demo "${FAKE[@]}" SUPABASE_SERVICE_ROLE_KEY=e2e-service-role-secret \
  DEMO_SUPABASE_PROJECT_REF=autreprojetdemo PRODUCTION_SUPABASE_PROJECT_REF=e2etest \
  CRON_SECRET=$CRON_SECRET_TEST DEMO_USER_EMAIL=demo@moka.demo DEMO_USER_PASSWORD=demo-password-1
