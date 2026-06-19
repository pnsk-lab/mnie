FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.json vite.config.ts ./
COPY packages/sbi-client/package.json packages/sbi-client/package.json
COPY apps/csbie/package.json apps/csbie/package.json
COPY apps/csbie-server/package.json apps/csbie-server/package.json
COPY apps/csbie-ui/package.json apps/csbie-ui/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN bun --filter @repo/csbie build

FROM oven/bun:1-slim AS runtime
ENV NODE_ENV=production
ENV CSBIE_DATABASE_PATH=/app/data/csbie.sqlite
WORKDIR /app
COPY --from=build /app/apps/csbie/dist ./apps/csbie/dist
COPY --from=build /app/apps/csbie-ui/dist ./apps/csbie-ui/dist
COPY --from=build /app/node_modules/.bun/@napi-rs+keyring@*/node_modules/@napi-rs/keyring ./node_modules/@napi-rs/keyring
COPY --from=build /app/node_modules/.bun/@napi-rs+keyring-linux-x64-gnu@*/node_modules/@napi-rs/keyring-linux-x64-gnu ./node_modules/@napi-rs/keyring-linux-x64-gnu
WORKDIR /app/apps/csbie/dist
EXPOSE 8787
CMD ["bun", "index.js"]
