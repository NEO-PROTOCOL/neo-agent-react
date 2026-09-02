FROM node:22.22.0-bookworm-slim

ENV NODE_ENV=production
ENV PORT=4001

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/engine/package.json packages/engine/package.json
COPY services/worker/package.json services/worker/package.json

RUN pnpm --filter neo-worker... install --prod --frozen-lockfile

COPY packages/engine packages/engine
COPY services/worker services/worker

USER node

EXPOSE 4001

CMD ["pnpm", "start:worker-api"]
