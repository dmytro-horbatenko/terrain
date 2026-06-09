import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Prisma 7: the connection URL lives here (and in the PrismaClient driver
// adapter), no longer in schema.prisma's datasource block.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
