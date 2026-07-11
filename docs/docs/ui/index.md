---
title: Deploy
description: Keep Mnie close to the systems you control.
---

# Run it yourself

Mnie ships as a bundled server and UI. Credentials and portfolio workflows stay on your infrastructure.

## Docker

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

Set `MNIE_KEYRING_BACKEND=sqlite` and a strong `MNIE_KEYRING_SECRET` for headless containers.

## Nix

```bash
nix run 'github:pnsk-lab/mnie#mnie'
```

::: warning KEEP THE KEY
Back up the data volume and keyring secret together. Losing either makes stored credentials unavailable.
:::
