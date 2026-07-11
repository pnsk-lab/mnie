---
title: SDK
description: Provider-neutral financial providers and cross-profile workspaces.
---

# SDK

Mnie separates individual financial-service operations from cross-profile operations.

- `FinancialProvider`: one profile, usable directly or through the server
- `FinancialWorkspace`: multiple profiles and aggregate operations
- `@mnie/sdk`: helpers and `createLocalWorkspace`
- `connectMnie`: a remote workspace backed by `mnie-server`

See [Workspaces and providers](./workspaces.md) for direct, local, and remote examples.
