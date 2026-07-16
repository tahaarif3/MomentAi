# Stage 1: Build dependencies and generate Prisma Client
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# Copy package configuration files
COPY package*.json ./

# Install all dependencies (including Prisma CLI)
RUN npm ci

# Copy Prisma schema definition
COPY prisma ./prisma/

# Generate the Prisma client for runtime query execution
RUN npx prisma generate

# Stage 2: Final lightweight runner
FROM node:20-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package configuration files
COPY package*.json ./

# Install production dependencies (includes prisma CLI for migrate deploy)
RUN npm ci --omit=dev

# Copy generated Prisma Client files from builder stage
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy application source files
COPY src ./src
COPY prisma ./prisma
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000

# Apply migrations then start Express
CMD ["./docker-entrypoint.sh"]
