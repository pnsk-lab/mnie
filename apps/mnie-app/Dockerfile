FROM oven/bun:1 AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock tsconfig.json vite.config.ts ./
COPY scripts/download-capsolve-model.ts scripts/download-capsolve-model.ts
COPY packages/auth-bitwarden/package.json packages/auth-bitwarden/package.json
COPY packages/capsolve-sp/package.json packages/capsolve-sp/package.json
COPY packages/provider-sbi-sec/package.json packages/provider-sbi-sec/package.json
COPY packages/provider-mobile-suica/package.json packages/provider-mobile-suica/package.json
COPY packages/provider-paypay/package.json packages/provider-paypay/package.json
COPY packages/provider-paypay-bank/package.json packages/provider-paypay-bank/package.json
COPY packages/provider-smbc-direct/package.json packages/provider-smbc-direct/package.json
COPY packages/mnie-types/package.json packages/mnie-types/package.json
COPY packages/mnie-sdk/package.json packages/mnie-sdk/package.json
COPY packages/mnie-cli/package.json packages/mnie-cli/package.json
COPY packages/client-mnie/package.json packages/client-mnie/package.json
COPY packages/client-nissay-401k/package.json packages/client-nissay-401k/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
COPY apps/mnie-app/package.json apps/mnie-app/package.json
COPY apps/mnie-server/package.json apps/mnie-server/package.json
COPY apps/mnie-ui/package.json apps/mnie-ui/package.json
COPY example/package.json example/package.json
COPY docs/package.json docs/package.json
RUN bun install --frozen-lockfile

FROM deps AS build
COPY . .
RUN MNIE_BUILD_DTS=false ./node_modules/.bin/vp run --no-cache sdk-build \
  && bun --filter @repo/mnie-app build
RUN mkdir -p /keyring-node-modules/@napi-rs \
  && cp -R /app/node_modules/.bun/@napi-rs+keyring@*/node_modules/@napi-rs/keyring /keyring-node-modules/@napi-rs/keyring \
  && for package in /app/node_modules/.bun/@napi-rs+keyring-linux-*@*/node_modules/@napi-rs/keyring-linux-*; do \
    cp -R "$package" "/keyring-node-modules/@napi-rs/$(basename "$package")"; \
  done

FROM oven/bun:1-slim AS runtime
ENV NODE_ENV=production
ENV MNIE_DATABASE_PATH=/app/data/mnie-app.sqlite
ENV MNIE_KEYRING_BACKEND=sqlite
ENV MNIE_KEYRING_SQLITE_PATH=/app/data/mnie-app.keyring.sqlite
WORKDIR /app
COPY --from=build /app/apps/mnie-app/dist ./apps/mnie-app/dist
COPY --from=build /app/apps/mnie-ui/dist ./apps/mnie-ui/dist
COPY --from=build /app/models/model.onnx ./models/model.onnx
COPY --from=build /keyring-node-modules ./node_modules
WORKDIR /app/apps/mnie-app/dist
ENV CAPSOLVE_MODEL_PATH=/app/models/model.onnx
EXPOSE 8787
CMD ["bun", "index.js"]
