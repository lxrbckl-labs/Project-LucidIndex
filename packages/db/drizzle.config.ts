import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './schema/index.ts',
  out: './migrations',
  dbCredentials: {
    // biome-ignore lint/style/noNonNullAssertion: drizzle-kit reads this at CLI time; absence is a hard fail by design.
    url: process.env.DATABASE_URL!,
  },
})
