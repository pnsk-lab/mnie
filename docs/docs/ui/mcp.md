---
title: MCP
description: Connect an MCP client to Mnie and control its access from the UI.
---

# Connect an MCP client

Mnie exposes your configured financial profiles to AI tools through a Streamable HTTP MCP server. The UI handles the OAuth approval flow, so you can review the requested permissions and access policy before a client connects.

## Before you connect

Sign in to the Mnie UI and add at least one provider under **Settings → Providers**. MCP provider operations currently support SBI Securities profiles.

Your Mnie installation must be reachable from the MCP client. Use this server URL, replacing the origin with the origin of your installation:

```text
<YOUR_MNIE_ORIGIN>/api/mcp
```

Only the origin changes. Keep the `/api/mcp` path as shown.

## Authorize a client

1. Add the Mnie MCP server URL to a client that supports Streamable HTTP and OAuth.
2. Start the connection from the client. Mnie opens its authorization page in your browser.
3. Sign in with your passkey if prompted.
4. Review the requested scopes and policy, then approve the connection.

The authorization creates an API key for the MCP client. You can inspect, edit, or revoke it later under **Settings → API keys**.

::: warning CHECK THE POLICY
MCP clients can act within the scopes and provider-operation policy you approve. Grant only the access the client needs, especially for write or trade permissions.
:::

## Available tools

| Tool                   | Purpose                                                     | Required access                                    |
| ---------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| `mnie-profiles-list`   | Lists configured profile IDs, provider IDs, and labels.     | `mcp` scope                                        |
| `mnie-provider-invoke` | Runs an operation supported by a selected provider profile. | `mcp` and `read` scopes, plus an allowed operation |

`mnie-provider-invoke` accepts a profile ID, an operation name, and optional operation input. A client can use the profile list first, then invoke supported read operations such as account, balance, transaction, position, or order-list queries.

## Revoke access

Open **Settings → API keys**, select the key named for the OAuth client, and revoke it. The client can no longer use that access token. You can also edit the key policy to narrow its permitted operations without reconnecting the provider.

## Troubleshooting

- **The authorization page does not open:** confirm that the client supports OAuth for remote Streamable HTTP MCP servers.
- **`missing OAuth scope: mcp`:** reconnect and approve the `mcp` scope, or enable it on the client's API key.
- **`missing OAuth scope: read`:** enable `read` for provider queries.
- **`provider does not support operation`:** use an operation advertised by the selected profile.
- **Provider connection is not implemented:** MCP operations currently connect only to SBI Securities profiles.
