FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy Prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy application source
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Run migrations, seed, and start
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
