#!/usr/bin/env bash
set -euo pipefail

export NODE_ENV=development
export PORT=3000
export APP_URL="http://localhost:5173"
PG_USER="${PG_USER:-$(whoami)}"
export DATABASE_URL="postgresql://${PG_USER}@127.0.0.1:5432/storyengine"
export REDIS_URL="redis://127.0.0.1:6379"

# Local test-mode auth (seeded owner user)
export DEV_AUTH_BYPASS=true
export DEV_USER_ID="usr_alice"

# Required runtime secrets for startup (safe local placeholders)
export AI_KEY_ENCRYPTION_SECRET="dev_local_encryption_secret_1234567890abcdef"
export STRIPE_SECRET_KEY="sk_test_local"
export WORKOS_API_KEY="workos_test_local"
export WORKOS_CLIENT_ID="client_test_local"
export WORKOS_REDIRECT_URI="http://localhost:3000/api/auth/callback"
export RESEND_API_KEY="re_test_local"
export OPENAI_API_KEY="sk-test-local"
export PINECONE_API_KEY="pc-test-local"
export PINECONE_INDEX="storyengine-transcripts"
export PLATFORM_ADMIN_API_KEY="platform_dev_key"
export BILLING_ENABLED=false

npm run dev
