/** Consistent SQLite snapshot using VACUUM INTO; run with DB_PATH pointing at the live database. */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const src=resolve(process.env.DB_PATH||'./data/appointment.sqlite');
if (!existsSync(src)) throw Error(`Database not found: ${src}`);
const dest=resolve(process.argv[2]||`./data/backups/appointment-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
if (src===dest||existsSync(dest)) throw Error('Backup destination must be new and different from the source');
mkdirSync(dirname(dest),{recursive:true});
const db=new DatabaseSync(src,{readOnly:true});
try {
  db.prepare('VACUUM INTO ?').run(dest);
  chmodSync(dest,0o600);
  console.log(`Backup complete: ${dest}`);
} finally { db.close(); }
