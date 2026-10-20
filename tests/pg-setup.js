import pg from 'pg';
import { randomBytes } from 'node:crypto';

const adminUrl = 'postgres://appointment:appointment@127.0.0.1:5432/postgres';

export async function createDatabase() {
  const name = 'aa_' + randomBytes(8).toString('hex');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  return `postgres://appointment:appointment@127.0.0.1:5432/${name}`;
}

export async function dropDatabase(url) {
  const name = new URL(url).pathname.slice(1);
  if (!/^aa_[a-f0-9]+$/.test(name)) throw new Error('拒绝删除非测试库');
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
  await admin.query(`DROP DATABASE IF EXISTS ${name}`);
  await admin.end();
}
