---
title: CLI
description: Operate Mnie from a terminal or an agent.
---

# Finance, piped

The Mnie CLI turns the same typed finance surface into JSON-friendly terminal commands. Use it from a shell, a script, or an agent without building another integration layer.

## Connect

Save a server origin and API key as a named profile.

```bash
mnie profile add local \
  --origin https://mnie.example.com \
  --api-key "$MNIE_API_KEY" \
  --storage keyring
```

Origins must not include a path. Use `--storage keyring` to keep the API key in the platform keyring, or `--storage file` to store it in `~/.mnie-cli/profiles.json` with mode `0600`.

```bash
mnie profile list
mnie profile use local
```

## Login

OAuth login opens an approval page and stores the resulting access token as a profile.

```bash
mnie login \
  --origin https://mnie.example.com \
  --profile local \
  --storage keyring
```

The CLI uses Authorization Code with PKCE and receives the callback on a temporary localhost port.

## Call

Inspect the methods exposed by the connected Mnie server.

```bash
mnie rpc methods --profile local
```

Call a method with its parameters as one JSON argument.

```bash
mnie rpc call market.issue.board \
  '{"issueCode":"7203","market":"T"}' \
  --profile local \
  --provider sbisec --profile-id sbi_xxx
```

Output is formatted JSON, so it can be inspected directly or passed to another process.

```bash
mnie rpc call account.positions.cash \
  --profile local \
  --provider sbisec --profile-id sbi_xxx \
  | jq
```

::: tip PROFILE FIRST
Omit `--profile` after selecting a default with `mnie profile use`. Keep it explicit in automation when multiple environments exist.
:::

## Trade

Read operations can be called directly. Live placement, correction, and cancellation require explicit trading permission in their JSON parameters.

```json
{
  "allowTrading": true
}
```

::: warning DELIBERATE ACTION
Only include `allowTrading: true` after the exact live order has been reviewed and confirmed. Estimation methods should be preferred before submission.
:::

## Commands

```text
mnie --help
mnie profile add <name> --origin <origin> --api-key <key>
mnie profile list
mnie profile use <name>
mnie login --origin <origin>
mnie rpc methods
mnie rpc call <method> [json-params]
```
