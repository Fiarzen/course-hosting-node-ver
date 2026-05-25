import { defineConfig } from 'prisma/config'

export default defineConfig({
  migrate: {
    async adapter() {
      const { PrismaPg } = await import('@prisma/adapter-pg')
      const { Pool } = await import('pg')
      return new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL }))
    },
  },
})
