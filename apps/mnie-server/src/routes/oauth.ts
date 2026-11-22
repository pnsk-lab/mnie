import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { Context } from 'hono'
import type { AppBindings } from '../context'
import { oauthClients } from '../db/schema'
import { validateAccountBindings, type ApiKeySettings } from '../security/api-keys'
import { createOAuthAuthorizationCode } from '../security/oauth-provider'

const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
const supportedScopes = new Set(['read', 'trade', 'reconcile'])

const redirectUriAllowed = (redirectUri: string, registeredUris: string[]) => {
  if (registeredUris.includes(redirectUri)) return true
  let requested: URL
  try {
    requested = new URL(redirectUri)
  } catch {
    return false
  }
  if (!loopbackHosts.has(requested.hostname)) return false
  return registeredUris.some((registeredUri) => {
    try {
      const registered = new URL(registeredUri)
      return (
        registered.protocol === requested.protocol &&
        registered.hostname === requested.hostname &&
        registered.pathname === requested.pathname &&
        registered.search === requested.search
      )
    } catch {
      return false
    }
  })
}

const isOwnerSession = (c: Context<AppBindings>) => c.get('auth').type === 'session'

export const createOAuthRoutes = () => {
  const app = new Hono<AppBindings>()

  app.get('/client/:id', async (c) => {
    if (!isOwnerSession(c)) return c.json({ error: 'unauthorized' }, 401)
    const [client] = await c
      .get('db')
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, c.req.param('id')))
    if (!client) return c.json({ error: 'client not found' }, 404)
    return c.json({ client: client.client })
  })

  app.post('/approve', async (c) => {
    if (!isOwnerSession(c)) return c.json({ error: 'unauthorized' }, 401)
    const body = await c.req.json<{
      clientId?: string
      redirectUri?: string
      codeChallenge?: string
      scope?: string
      state?: string
      resource?: string
      settings?: ApiKeySettings
    }>()
    if (!body.clientId || !body.redirectUri || !body.codeChallenge) {
      return c.json({ error: 'clientId, redirectUri and codeChallenge are required' }, 400)
    }
    const requestedScopes = body.scope?.split(' ').filter(Boolean) ?? []
    const unsupportedScope = requestedScopes.find((scope) => !supportedScopes.has(scope))
    if (unsupportedScope) return c.json({ error: `unsupported scope: ${unsupportedScope}` }, 400)

    const [client] = await c
      .get('db')
      .select()
      .from(oauthClients)
      .where(eq(oauthClients.id, body.clientId))
    const redirectUris =
      (client?.client as { redirect_uris?: string[] } | undefined)?.redirect_uris ?? []
    if (!redirectUriAllowed(body.redirectUri, redirectUris)) {
      return c.json({ error: 'redirectUri is not registered for this client' }, 400)
    }

    const grantedScopes = (requestedScopes.length ? requestedScopes : ['read']).filter(
      (scope) => body.settings?.scopes == null || body.settings.scopes.includes(scope),
    )
    if (!grantedScopes.length) return c.json({ error: 'select at least one requested scope' }, 400)
    try {
      const bindings = validateAccountBindings(c.get('db'), body.settings?.accountBindings)
      if (!bindings.length) return c.json({ error: 'select at least one account' }, 400)
      if (bindings.some((binding) => binding.role === 'trade') && !grantedScopes.includes('trade'))
        return c.json({ error: 'trade role requires trade scope' }, 400)
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : 'invalid account binding' },
        400,
      )
    }

    const code = await createOAuthAuthorizationCode(c.get('db'), {
      clientId: body.clientId,
      redirectUri: body.redirectUri,
      codeChallenge: body.codeChallenge,
      scopes: grantedScopes,
      resource: body.resource,
      apiKeySettings: body.settings,
    })

    const redirectUrl = new URL(body.redirectUri)
    redirectUrl.searchParams.set('code', code)
    if (body.state) redirectUrl.searchParams.set('state', body.state)
    return c.json({ redirectTo: redirectUrl.toString() })
  })

  return app
}
