import { Worker } from 'node:worker_threads';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgres://appointment:appointment@127.0.0.1:5432/appointment';
}

const CAPACITY = 2_000_000;
const sab = new SharedArrayBuffer(8 + CAPACITY);
const header = new Int32Array(sab, 0, 2);
const bytes = new Uint8Array(sab, 8);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toPg(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

const worker = new Worker(new URL('./pg-worker.js', import.meta.url), {
  workerData: { sab, databaseUrl: process.env.DATABASE_URL }
});
worker.unref();

function read() {
  const length = Atomics.load(header, 1);
  return JSON.parse(decoder.decode(bytes.subarray(0, length)));
}
function write(payload) {
  const encoded = encoder.encode(JSON.stringify(payload));
  if (encoded.length > bytes.length) throw new Error('数据库请求超过缓冲');
  bytes.set(encoded);
  Atomics.store(header, 1, encoded.length);
}

export const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('连接 PostgreSQL 超时')), 15000);
  const finish = () => {
    const state = Atomics.load(header, 0);
    if (state !== 7 && state !== 9) {
      setImmediate(finish);
      return;
    }
    clearTimeout(timer);
    if (state === 9) {
      const failure = read();
      Atomics.store(header, 0, 0);
      reject(new Error(failure.message || 'PostgreSQL 连接失败'));
      return;
    }
    Atomics.store(header, 0, 0);
    resolve();
  };
  worker.on('error', error => { clearTimeout(timer); reject(error); });
  setImmediate(finish);
});

function call(request) {
  write(request);
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
  const deadline = Date.now() + 20000;
  while (Atomics.load(header, 0) !== 2) {
    if (Date.now() > deadline) throw new Error('数据库请求超时');
    Atomics.wait(header, 0, 1, 200);
  }
  const response = read();
  Atomics.store(header, 0, 0);
  if (!response.ok) {
    const error = new Error(response.message || '数据库错误');
    error.code = response.code;
    throw error;
  }
  return response.data;
}

export function exec(sql) {
  call({ op: 'exec', sql });
}
export function query(sql, params, op) {
  return call({ op, text: toPg(sql), params: params.map(value => value === undefined ? null : value) });
}
