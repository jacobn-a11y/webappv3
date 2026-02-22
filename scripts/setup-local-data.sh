#!/usr/bin/env bash
set -euo pipefail

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for local Postgres/Redis setup."
  exit 1
fi

brew services start postgresql@16 >/dev/null
brew services start redis >/dev/null

# Ensure DB exists
if ! /opt/homebrew/opt/postgresql@16/bin/psql -h 127.0.0.1 -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='storyengine'" | grep -q 1; then
  /opt/homebrew/opt/postgresql@16/bin/createdb -h 127.0.0.1 storyengine
fi

PG_USER="${PG_USER:-$(whoami)}"
export DATABASE_URL="postgresql://${PG_USER}@127.0.0.1:5432/storyengine"

npm run db:push
npm run db:seed

echo "Local DB seeded successfully."
