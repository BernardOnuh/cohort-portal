import { defineConfig } from 'prisma/config'
import { PrismaLibSql } from '@prisma/adapter-libsql'
import dotenv from 'dotenv'

dotenv.config()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./dev.db',
  },
  migrate: {
    adapter: () => new PrismaLibSql({
      url: process.env.DATABASE_URL ?? 'file:./dev.db',
      authToken: process.env.TURSO_AUTH_TOKEN,
    })
  }
})