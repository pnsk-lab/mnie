---
title: SDK
description: Provider-neutral financial providers and cross-profile clients.
---

# SDK

Mnie separates individual financial-service methods from cross-profile reads.

- `FinancialProvider`: one profile, usable directly or through the server
- `MnieClient`: multiple accounts and aggregate methods over flat RPC names
- `@mnie/sdk`: helpers and `createLocalClient`
- `connectMnie`: a remote client backed by `mnie-server`

See [Workspaces and providers](./workspaces.md) for direct, local, and remote examples.
