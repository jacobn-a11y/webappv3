# ── Stage 1: Install dependencies ─────────────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /app

# Install OpenSSL for Prisma (node:22-slim needs it explicitly)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Generate Prisma client (needs schema + node_modules)
COPY prisma ./prisma
RUN npx prisma generate

# ── Stage 2: Build TypeScript ─────────────────────────────────────────────────
FROM node:22-slim AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package.json tsconfig.json ./
COPY src ./src

RUN npm run build

# ── Stage 3: Production runtime ──────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

RUN apt-get update -y && \
    apt-get install -y openssl chromium && \
    rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create non-root user
RUN addgroup --system --gid 1001 storyengine && \
    adduser --system --uid 1001 --ingroup storyengine storyengine

# Copy only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy Prisma schema + generated client from deps stage
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy compiled JS from build stage
COPY --from=build /app/dist ./dist

# Own app files as non-root user
RUN chown -R storyengine:storyengine /app
USER storyengine

EXPOSE 3000

CMD ["node", "dist/index.js"]
