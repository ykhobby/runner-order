#!/bin/sh
# Runs the community migration and its access-rule tests against a throwaway local Postgres.
# Needs PostgreSQL 17 binaries (brew install postgresql@17). Usage: sh tests/sql/run.sh
set -eu
export LC_ALL=C LANG=C  # Postgres refuses to start on macOS without a valid locale
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
BIN=${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
DATA=$(mktemp -d)
PORT=54329
trap '"$BIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
"$BIN/initdb" -D "$DATA" -U postgres -A trust >/dev/null
"$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -k $DATA -c listen_addresses=''" -l "$DATA/log" -w start >/dev/null
PSQL="$BIN/psql -h $DATA -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -f "$HERE/supabase-stub.sql"
for migration in "$ROOT"/supabase/migrations/*.sql; do $PSQL -f "$migration"; done
for suite in "$HERE"/rls.test.sql "$HERE"/catalogue.test.sql; do $PSQL -o /dev/null -f "$suite"; done
echo "Database tests passed."
