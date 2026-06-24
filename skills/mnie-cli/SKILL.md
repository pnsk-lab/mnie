---
name: mnie-cli
description: 'Use when an AI agent should operate the installed `mnie` command for a user: managing Mnie profiles, logging in, listing RPC methods, calling finance/account/market/order methods, handling passkey IDs, or explaining safe `mnie` usage in an environment where the CLI is already installed.'
---

# Mnie CLI

Use the installed `mnie` command. Do not assume access to the CLI source repository, build artifacts, or project-local scripts.

## Basics

- Confirm `mnie --help` if command syntax is uncertain.
- Use `mnie profile list` to inspect configured profiles when profile context is unclear.
- Use `--profile <name>` when the user specifies a profile; otherwise rely on the configured default profile.
- Use `--passkey-id <id>` when the target RPC method requires an SBI session connection.
- Pass method parameters as a single JSON string to `rpc call`.
- Preserve identifiers such as issue codes, order numbers, and passkey IDs as strings.

## Commands

Read `references/cli-commands.md` for concrete command examples.
Read `references/rpc-methods.md` when choosing an RPC method or forming params for `mnie rpc call`.

## Safety

- Do not invent direct commands such as `mnie account profile` unless `mnie --help` shows that syntax.
- Prefer read-only calls unless the user explicitly asks for a trade/order action.
- For live trading RPC methods, require explicit user confirmation and include `allowTrading: true` only when the user clearly requested submission.
- Do not fabricate API keys, profile names, passkey IDs, trade passwords, or server origins.
- Store profile origins as origins only. Do not include real endpoint paths in profile origins.

## Output

Return concise command results and the exact command shape used, but do not expose secrets such as API keys or access tokens.
