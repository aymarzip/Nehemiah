FROM node:24.18.1-bookworm-slim AS build

WORKDIR /workspace
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig*.json vitest.config.ts eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY apps/discord/package.json apps/discord/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/discord-kit/package.json packages/discord-kit/package.json
COPY packages/github/package.json packages/github/package.json
COPY packages/llm/package.json packages/llm/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
RUN pnpm build \
  && pnpm --filter @nehemiah/api deploy --prod --legacy /out/api \
  && pnpm --filter @nehemiah/worker deploy --prod --legacy /out/worker \
  && pnpm --filter @nehemiah/discord deploy --prod --legacy /out/discord \
  && pnpm --filter @nehemiah/database deploy --prod --legacy /out/database

FROM node:24.18.1-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
USER node

FROM runtime AS api
COPY --from=build --chown=node:node /out/api/package.json ./package.json
COPY --from=build --chown=node:node /out/api/node_modules ./node_modules
COPY --from=build --chown=node:node /out/api/dist ./dist
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

FROM runtime AS worker
COPY --from=build --chown=node:node /out/worker/package.json ./package.json
COPY --from=build --chown=node:node /out/worker/node_modules ./node_modules
COPY --from=build --chown=node:node /out/worker/dist ./dist
CMD ["node", "dist/main.js"]

FROM runtime AS discord
COPY --from=build --chown=node:node /out/discord/package.json ./package.json
COPY --from=build --chown=node:node /out/discord/node_modules ./node_modules
COPY --from=build --chown=node:node /out/discord/dist ./dist
CMD ["node", "dist/main.js"]

FROM runtime AS migration
COPY --from=build --chown=node:node /out/database/package.json ./package.json
COPY --from=build --chown=node:node /out/database/node_modules ./node_modules
COPY --from=build --chown=node:node /out/database/dist ./dist
COPY --from=build --chown=node:node /out/database/migrations ./migrations
CMD ["node", "dist/cli/migrate.js"]
