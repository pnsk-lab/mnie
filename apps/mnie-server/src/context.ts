import type { ServerConfig } from './config'
import type { Db } from './db'

export type AppBindings = {
  Variables: {
    db: Db
    config: ServerConfig
    authenticated: boolean
    auth: AuthContext
  }
}

export type AuthContext =
  | {
      type: 'none'
      authenticated: false
    }
  | {
      type: 'session'
      authenticated: true
      sessionId: string
    }
  | {
      type: 'apiKey'
      authenticated: true
      apiKeyId: string
      scopes: string[]
    }
