/** Logical PostgreSQL backup via pg_dump. DATABASE_URL selects the live database. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = process.env.DATABASE_URL;
if (!source) throw new Error('DATABASE_URL is required');
const dest = resolve(process.argv[2] || `./data/backups/appointment-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`);
if (existsSync(dest)) throw new Error('Backup destination must be a new file');
mkdirSync(dirname(dest), { recursive: true });
const result = spawnSync('pg_dump', ['--dbname', source, '--format', 'custom', '--file', dest], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('pg_dump failed');
chmodSync(dest, 0o600);
console.log(`Backup complete: ${dest}`);
