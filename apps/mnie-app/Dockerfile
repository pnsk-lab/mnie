FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.json vite.config.ts ./
COPY packages/client-sbi/package.json packages/client-sbi/package.json
COPY packages/mnie-types/package.json packages/mnie-types/package.json
COPY packages/mnie-sdk/package.json packages/mnie-sdk/package.json
COPY packages/mnie-cli/package.json packages/mnie-cli/package.json
COPY apps/mnie-app/package.json apps/mnie-app/package.json
COPY apps/mnie-server/package.json apps/mnie-server/package.json
COPY apps/mnie-ui/package.json apps/mnie-ui/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun --filter @repo/mnie-app build

FROM oven/bun:1-slim AS runtime
ENV NODE_ENV=production
ENV MNIE_DATABASE_PATH=/app/data/mnie-app.sqlite
ENV MNIE_KEYRING_BACKEND=sqlite
ENV MNIE_KEYRING_SQLITE_PATH=/app/data/mnie-app.keyring.sqlite
WORKDIR /app
COPY --from=build /app/apps/mnie-app/dist ./apps/mnie-app/dist
COPY --from=build /app/apps/mnie-ui/dist ./apps/mnie-ui/dist
COPY --from=build /app/node_modules/.bun/@napi-rs+keyring@*/node_modules/@napi-rs/keyring ./node_modules/@napi-rs/keyring
COPY --from=build /app/node_modules/.bun/@napi-rs+keyring-linux-x64-gnu@*/node_modules/@napi-rs/keyring-linux-x64-gnu ./node_modules/@napi-rs/keyring-linux-x64-gnu
WORKDIR /app/apps/mnie-app/dist
EXPOSE 8787
CMD ["bun", "index.js"]
