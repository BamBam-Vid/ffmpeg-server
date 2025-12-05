# Multi-stage build for optimized production image

# Stage 1: Builder
FROM node:24.11.1-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.1.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm build

# Stage 2: Production
FROM node:24.11.1-alpine AS production

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.1.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 5675

# Set environment to production
ENV NODE_ENV=production

# Run the application
CMD ["node", "dist/index.js"]
