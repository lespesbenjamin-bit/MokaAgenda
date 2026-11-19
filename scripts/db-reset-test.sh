#!/usr/bin/env bash
# Recrée une base PostgreSQL locale de test, applique la reproduction
# Supabase puis toutes les migrations, dans l'ordre.
# Usage : TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/moka_test ./scripts/db-reset-test.sh
set -euo pipefail
URL="${TEST_DATABASE_URL:-postgres://postgres:postgres@localhost:5432/moka_test}"
ADMIN_URL="${URL%/*}/postgres"
DB="${URL##*/}"
psql "$ADMIN_URL" -qX -v ON_ERROR_STOP=1 -c "drop database if exists \"$DB\" with (force)" -c "create database \"$DB\""
psql "$URL" -qX -v ON_ERROR_STOP=1 -f supabase/tests/supabase-shim.sql
for f in supabase/migrations/*.sql; do
  echo "→ $f"
  psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$f"
done
echo "Base de test prête : $DB"
