import {
  ensurePostgresSchema,
  getPostgresStoreStatus,
} from '../server/postgresPortfolioStore.mjs';

try {
  await ensurePostgresSchema({ force: true });
  console.log('AtomFolio Postgres schema is ready.');
  console.log(JSON.stringify(getPostgresStoreStatus(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database migration failed.');
  process.exitCode = 1;
}
