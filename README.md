# cSBI

[![技術者倫理 遵守済み](https://img.shields.io/badge/%E6%8A%80%E8%A1%93%E8%80%85%E5%80%AB%E7%90%86-%E9%81%B5%E5%AE%88%E6%B8%88%E3%81%BF-0a0a0a?style=for-the-badge&labelColor=ffffff)](https://技術者倫理.com)

A client for SBI-compatible servers. This project is not intended for use with a real SBI server.

## cSBI SDK

## cSBIe

cSBIe is a web ui and server for managing SBI-compatible API.

### Install

Before running, setup .env, refering `.env.example`.

#### With docker

Docker uses `CSBIE_KEYRING_BACKEND=sqlite` because platform keyrings are not available in
headless containers. Set `CSBIE_KEYRING_SECRET` in `.env` before saving SBI passkeys.

docker-compose.yml:

```yaml
services:
  csbie:
    image: git.yutakobayashi.com/nakasyou/csbi:latest
    ports:
      - '18787:8787'
    env_file:
      - .env
    volumes:
      - ./data:/app/data
```

or

```bash
docker run --rm -it --name csbie \
  -p 18787:8787 \
  --env-file .env \
  -v "$PWD/data:/app/data" \
  git.yutakobayashi.com/nakasyou/csbi:latest
```

#### With Nix

```bash
nix run 'git+https://git.yutakobayashi.com/nakasyou/csbi.git#csbie'
```
