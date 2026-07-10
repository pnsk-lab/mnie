---
title: SDK
description: One typed interface for finance operations.
---

# Typed end to end

The SDK keeps the same operation contract across direct clients, RPC, and automation.

## Read

```ts
import { getCashPositions, getIssueBoard } from 'mnie'

const [positions, board] = await Promise.all([
  getCashPositions({ profile }),
  getIssueBoard({ profile, issueCode: '7203', market: 'XTKS' }),
])
```

## Act

Order estimation, placement, correction, and cancellation are guarded explicitly.

```ts
await placeCashOrder({
  profile,
  allowTrading: true,
  order,
})
```

## Compose

| Surface             | Purpose                                 |
| ------------------- | --------------------------------------- |
| `mnie`              | Profile-injected operations             |
| `@repo/client-mnie` | Authenticated connection                |
| `@repo/mnie-types`  | Requests, responses, and operation maps |

> One contract. No translation layer.
