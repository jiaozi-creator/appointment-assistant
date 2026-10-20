import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { createDatabase, dropDatabase } from './pg-setup.js';

function boot(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tests/boot-db.js'], {
      env: { ...process.env, DATABASE_URL: url, INIT_OWNER_EMAIL: '', INIT_OWNER_PASSWORD: '', INIT_PLATFORM_EMAIL: '', INIT_PLATFORM_PASSWORD: '' }
    });
    let err = '';
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(err || `exit ${code}`)));
  });
}

test('Postgres schema migration applies once and keeps an empty shop', async () => {
  const url = await createDatabase();
  const client = new pg.Client({ connectionString: url });
  try {
    await boot(url);
    await boot(url);
    await client.connect();
    const versions = await client.query('SELECT version FROM schema_migrations ORDER BY version');
    assert.deepEqual(versions.rows.map(row => row.version), ['001_postgres.sql']);
    const merchants = await client.query('SELECT COUNT(*)::int AS n FROM merchants');
    assert.equal(merchants.rows[0].n, 0);
    const zone = await client.query("SELECT column_default FROM information_schema.columns WHERE table_name='merchants' AND column_name='time_zone'");
    assert.match(zone.rows[0].column_default, /Asia\/Shanghai/);
  } finally {
    await client.end().catch(() => {});
    await dropDatabase(url);
  }
});
