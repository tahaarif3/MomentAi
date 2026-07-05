# Stage 1: Build dependencies and generate Prisma Client
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package configuration files
COPY package*.json ./

# Install all dependencies (including devDependencies for Prisma)
RUN npm ci

# Copy Prisma schema definition
COPY prisma ./prisma/

# Generate the Prisma client for runtime query execution
RUN npx prisma generate

# Stage 2: Final lightweight runner
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy package configuration files
COPY package*.json ./

# Install only runtime production dependencies
RUN npm ci --only=production

# Copy generated Prisma Client files from builder stage
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Copy application source files
COPY src ./src
COPY prisma ./prisma

EXPOSE 3000

# Run the Express server in production mode
CMD ["node", "src/server.js"]
