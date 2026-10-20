import pg from 'pg';
import { parentPort, workerData } from 'node:worker_threads';

const { sab, databaseUrl } = workerData;
const header = new Int32Array(sab, 0, 2);
const bytes = new Uint8Array(sab, 8);
const decoder = new TextDecoder();
const encoder = new TextEncoder();

pg.types.setTypeParser(20, value => (value === null ? null : Number(value)));
pg.types.setTypeParser(1082, value => value);
pg.types.setTypeParser(1114, value => value);
pg.types.setTypeParser(1184, value => new Date(value).toISOString());

const client = new pg.Client({ connectionString: databaseUrl });

function write(payload) {
  const encoded = encoder.encode(JSON.stringify(payload));
  if (encoded.length > bytes.length) throw new Error('数据库响应超过缓冲');
  bytes.set(encoded);
  Atomics.store(header, 1, encoded.length);
}

function read() {
  const length = Atomics.load(header, 1);
  return JSON.parse(decoder.decode(bytes.subarray(0, length)));
}

async function handle(request) {
  if (request.op === 'exec') {
    await client.query(request.sql);
    return { changes: 0 };
  }
  const result = await client.query({ text: request.text, values: request.params });
  if (request.op === 'run') return { changes: result.rowCount ?? 0 };
  if (request.op === 'all') return result.rows;
  return result.rows[0] ?? null;
}

try {
  await client.connect();
  await client.query("SET statement_timeout = '8s'");
  write({ ok: true });
  Atomics.store(header, 0, 7);
  Atomics.notify(header, 0);
} catch (error) {
  write({ ok: false, message: error.message });
  Atomics.store(header, 0, 9);
  Atomics.notify(header, 0);
  process.exit(1);
}

parentPort?.unref();
while (true) {
  let flag = Atomics.load(header, 0);
  while (flag !== 1) {
    Atomics.wait(header, 0, flag);
    flag = Atomics.load(header, 0);
  }
  let response;
  try {
    response = { ok: true, data: await handle(read()) };
  } catch (error) {
    response = { ok: false, message: error.message, code: error.code };
  }
  try {
    write(response);
  } catch (error) {
    write({ ok: false, message: error.message });
  }
  Atomics.store(header, 0, 2);
  Atomics.notify(header, 0);
}
