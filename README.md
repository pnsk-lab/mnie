# Mnie

[![技術者倫理 遵守済み](https://img.shields.io/badge/%E6%8A%80%E8%A1%93%E8%80%85%E5%80%AB%E7%90%86-%E9%81%B5%E5%AE%88%E6%B8%88%E3%81%BF-0a0a0a?style=for-the-badge&labelColor=ffffff)](https://技術者倫理.com)

Self-host finance management for running your own portfolio, trading, API key, OAuth, MCP, and CLI workflows.

## Mnie SDK

`@repo/client-mnie` opens an authenticated Mnie connection. `mnie` provides high-level
finance operations that accept either that connection or a direct SBI client as a profile.

```ts
import { getCashPositions, getIssueBoard } from 'mnie'

const positions = await getCashPositions({ profile })
const board = await getIssueBoard({ profile, issueCode: '7203', market: 'XTKS' })
```

The high-level SDK exposes the complete typed API as profile-injected operations: session
and account data, positions, market search/boards/charts/rankings, news/watchlists, and every
order estimate or placement operation. Live operations retain the required
`allowTrading: true` type guard.

`@repo/mnie-types` also exports `MnieOperationMap`, per-operation
`MnieOperationRequest` / `MnieOperationResponse`, and the discriminated `MnieRequest` /
`MnieResponse` unions for routers, logging, and transport layers.

## Apps

- `apps/mnie-app`: bundled server plus UI runtime
- `apps/mnie-server`: API, OAuth, MCP, RPC, storage, and profile session management
- `apps/mnie-ui`: web UI

## Packages

- `packages/mnie-types`: shared finance SDK interfaces
- `packages/client-mnie`: authenticated Mnie connection client
- `packages/mnie-sdk`: high-level `mnie` SDK
- `packages/mnie-cli`: CLI using `client-mnie`
- `packages/provider-sbi-sec`: SBI Securities provider
- `packages/provider-mobile-suica`: Mobile Suica provider

### Install

Before running, setup .env, refering `.env.example`.

#### With docker

Docker uses `MNIE_KEYRING_BACKEND=sqlite` because platform keyrings are not available in
headless containers. Set `MNIE_KEYRING_SECRET` in `.env` before saving SBI passkeys.

docker-compose.yml:

```yaml
services:
  mnie:
    image: git.yutakobayashi.com/nakasyou/mnie:latest
    ports:
      - '18787:8787'
    env_file:
      - .env
    volumes:
      - ./data:/app/data
```

or

```bash
docker run --rm -it --name mnie \
  -p 18787:8787 \
  --env-file .env \
  -v "$PWD/data:/app/data" \
  git.yutakobayashi.com/nakasyou/mnie:latest
```

#### With Nix

```bash
nix run 'git+https://git.yutakobayashi.com/nakasyou/mnie.git#mnie'
```
