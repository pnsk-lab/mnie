# Mnie: Finance Management System

<img width="1672" height="941" alt="Your money.
Your machine" src="https://github.com/user-attachments/assets/9ac413e9-161f-451c-9afc-1847308aedbc" />

[![技術者倫理 遵守済み](https://img.shields.io/badge/%E6%8A%80%E8%A1%93%E8%80%85%E5%80%AB%E7%90%86-%E9%81%B5%E5%AE%88%E6%B8%88%E3%81%BF-0a0a0a?style=for-the-badge&labelColor=ffffff)](https://技術者倫理.com)
[![codecov](https://codecov.io/gh/pnsk-lab/mnie/graph/badge.svg?token=XL59TF1Y5S)](https://codecov.io/gh/pnsk-lab/mnie)

Self-host finance management for running your own portfolio, trading, API key, OAuth, MCP, and CLI workflows.

## Mnie SDK

`@repo/client-mnie` opens a remote financial workspace. `@mnie/sdk` provides the same
workspace contract locally for directly connected providers.

```ts
import { connectMnie } from '@repo/client-mnie'

const workspace = await connectMnie({ baseURL, token })
const valuation = await workspace.invoke('portfolio.valuation.get', { baseCurrency: 'JPY' })
const positions = await workspace.profile('sbi_xxx').invoke('investments.positions.list', {})
```

Individual profiles implement `FinancialProvider`; cross-profile aggregation implements
`FinancialWorkspace`. See `docs/docs/sdk/workspaces.md` for direct, local, and remote usage.

## Apps

- `apps/mnie-app`: bundled server plus UI runtime
- `apps/mnie-server`: API, OAuth, MCP, RPC, storage, and profile session management
- `apps/mnie-ui`: web UI

## Packages

- `packages/mnie-types`: shared finance SDK interfaces
- `packages/client-mnie`: authenticated Mnie connection client
- `packages/mnie-sdk`: high-level `mnie` SDK
- `packages/mnie-cli`: CLI using `client-mnie`
- `packages/auth-bitwarden`: Bitwarden Auth Manager
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
    image: ghcr.io/pnsk-lab/mnie:latest
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
  ghcr.io/pnsk-lab/mnie:latest
```

#### With Nix

```bash
nix run 'github:pnsk-lab/mnie#mnie'
```

### NixOS (systemd)

The flake exports a NixOS module that runs Mnie as a native systemd service:

```nix
{
  inputs.mnie.url = "github:pnsk-lab/mnie";

  outputs =
    { nixpkgs, mnie, ... }:
    {
      nixosConfigurations.my-host = nixpkgs.lib.nixosSystem {
        system = "x86_64-linux";
        modules = [
          mnie.nixosModules.systemd
          {
            services.mnie = {
              enable = true;
              runtime = "native";
              envFile = /etc/mnie.env;
            };
          }
        ];
      };
    };
}
```

## Acknowledgment

- This project is inspired by [MoneyForward](https://moneyforward.com/).
