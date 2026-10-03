import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { Prisma } from '@prisma/client';

// Test-only adapter: executes the service's real parameterized SQL in a disposable DB.
export async function writingTestDb() {
  const dev = createRequire(require.resolve('prisma/package.json'));
  const req = createRequire(dev.resolve('@prisma/dev'));
  const { PGlite } = req('@electric-sql/pglite');
  const bundle = dirname(req.resolve('@electric-sql/pglite'));
  const db = new PGlite({
    fsBundle: new Blob([readFileSync(join(bundle, 'pglite.data'))]),
    wasmModule: await WebAssembly.compile(readFileSync(join(bundle, 'pglite.wasm'))),
  });
  await db.waitReady;
  const dir = resolve(__dirname, '../prisma/migrations');
  for (const name of readdirSync(dir)
    .filter((n) => /^\d/.test(n))
    .sort())
    await db.exec(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
  const bridge: any = {
    $queryRaw: async (input: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const sql = Array.isArray(input)
        ? Prisma.sql(input as unknown as TemplateStringsArray, values)
        : (input as Prisma.Sql);
      return (await db.query(sql.text, sql.values)).rows;
    },
    $executeRaw: async (sql: Prisma.Sql) => (await db.query(sql.text, sql.values)).affectedRows,
    $transaction: async (fn: (tx: any) => Promise<unknown>) => {
      await db.exec('BEGIN');
      try {
        const result = await fn(bridge);
        await db.exec('COMMIT');
        return result;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, bridge };
}
