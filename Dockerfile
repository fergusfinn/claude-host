# ---- Build stage ----
FROM node:22-bookworm-slim AS build

WORKDIR /app

# Install build tools for native modules (node-pty, better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx next build
# Prune devDependencies but keep typescript (needed by Next.js to load next.config.ts)
RUN npm prune --omit=dev && npm install --no-save typescript

# ---- Runtime stage ----
FROM node:22-bookworm-slim

WORKDIR /app

# Runtime dependencies
RUN apt-get update && apt-get install -y \
    tmux \
    bash \
    procps \
    git \
    locales \
  && sed -i '/en_US.UTF-8/s/^# //' /etc/locale.gen \
  && locale-gen \
  && rm -rf /var/lib/apt/lists/*

ENV LANG=en_US.UTF-8
ENV LC_ALL=en_US.UTF-8

# Install global tools: tsx for running TypeScript, Claude CLI, Codex CLI
RUN npm install -g tsx @anthropic-ai/claude-code @openai/codex

# Copy built app from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/server.ts ./server.ts
COPY --from=build /app/cli.ts ./cli.ts
COPY --from=build /app/app ./app
COPY --from=build /app/components ./components
COPY --from=build /app/lib ./lib
COPY --from=build /app/hooks ./hooks
COPY --from=build /app/shared ./shared
COPY --from=build /app/executor ./executor

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

VOLUME /app/data
EXPOSE 3000

ENV NODE_ENV=production

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve"]
