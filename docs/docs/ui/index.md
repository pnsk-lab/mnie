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

### NixOS systemd service

Import the `systemd` module from the flake and select the native runtime:

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
              dataDir = "/var/lib/mnie-app";
              port = 18787;
            };
          }
        ];
      };
    };
}
```

The module creates `mnie.service`, waits for `network-online.target`, restarts the
service after failures, and stores the SQLite database below `dataDir`. The environment
file must already exist on the host. For a headless service, set
`MNIE_KEYRING_BACKEND=sqlite` and `MNIE_KEYRING_SECRET` in that file.

After rebuilding NixOS, check the service with:

```bash
systemctl status mnie
journalctl -u mnie -f
```

::: warning KEEP THE KEY
Back up the data volume and keyring secret together. Losing either makes stored credentials unavailable.
:::
