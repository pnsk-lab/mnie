import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.MNIE_DATABASE_PATH ?? './data/mnie-app.sqlite',
  },
})
