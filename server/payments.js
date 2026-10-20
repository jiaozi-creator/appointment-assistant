import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { db, uid, transaction } from './db.js';

export function paymentMode() {
  const provider = process.env.PAYMENT_PROVIDER || 'test';
  if (provider === 'wechat' && process.env.WECHAT_MCH_ID && process.env.WECHAT_APP_ID && process.env.WECHAT_CERT_SERIAL && (process.env.WECHAT_PRIVATE_KEY || process.env.WECHAT_PRIVATE_KEY_PATH)) {
    return 'wechat';
  }
  return 'test';
}

function privateKey() {
  const pem = process.env.WECHAT_PRIVATE_KEY_PATH
    ? readFileSync(process.env.WECHAT_PRIVATE_KEY_PATH, 'utf8')
    : process.env.WECHAT_PRIVATE_KEY.replace(/\\n/g, '\n');
  return crypto.createPrivateKey(pem);
}

function wechatAuthorization(method, path, body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(message), privateKey()).toString('base64');
  return `WECHATPAY2-SHA256-RSA2048 mchid="${process.env.WECHAT_MCH_ID}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${process.env.WECHAT_CERT_SERIAL}"`;
}

async function wechatRequest(method, path, payload) {
  const body = payload ? JSON.stringify(payload) : '';
  const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
    method,
    headers: { Authorization: wechatAuthorization(method, path, body), Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'appointment-assistant' },
    body: body || undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.message || '微信支付请求失败'), { status: 502 });
  return data;
}

function markPaid(booking, provider, providerRef) {
  transaction(() => {
    const current = db.prepare('SELECT payment_status,status FROM bookings WHERE id=?').get(booking.id);
    if (!current || current.status === 'cancelled') throw Object.assign(new Error('预约已取消，不能支付'), { status: 409 });
    if (current.payment_status === 'paid') return;
    db.prepare('UPDATE bookings SET payment_status=?,updated_at=now() WHERE id=?').run('paid', booking.id);
    db.prepare('INSERT INTO payments(id,booking_id,merchant_id,amount_cents,status,provider,provider_ref) VALUES(?,?,?,?,?,?,?)')
      .run(uid(), booking.id, booking.merchant_id, booking.package_price_cents, 'paid', provider, providerRef || '');
  });
}

export async function payBooking(booking) {
  if (booking.payment_status === 'paid') return { payment_status: 'paid', provider: 'already' };
  if (booking.status === 'cancelled' || booking.status === 'rejected') {
    throw Object.assign(new Error('当前预约不能支付'), { status: 409 });
  }
  if (paymentMode() === 'wechat') {
    const pending = db.prepare("SELECT * FROM payments WHERE booking_id=? AND provider='wechat' AND status='pending' ORDER BY created_at DESC").get(booking.id);
    if (pending) {
      const found = await wechatRequest('GET', `/v3/pay/transactions/out-trade-no/${pending.provider_ref}?mchid=${process.env.WECHAT_MCH_ID}`);
      if (found.trade_state === 'SUCCESS') {
        transaction(() => {
          db.prepare('UPDATE bookings SET payment_status=?,updated_at=now() WHERE id=? AND payment_status<>?').run('paid', booking.id, 'paid');
          db.prepare("UPDATE payments SET status='paid' WHERE id=?").run(pending.id);
        });
        return { payment_status: 'paid', provider: 'wechat' };
      }
      return { payment_status: 'unpaid', provider: 'wechat', out_trade_no: pending.provider_ref };
    }
    const outTradeNo = uid().replaceAll('-', '').slice(0, 32);
    const path = '/v3/pay/transactions/native';
    const data = await wechatRequest('POST', path, {
      appid: process.env.WECHAT_APP_ID,
      mchid: process.env.WECHAT_MCH_ID,
      description: `摄影预约 ${booking.code}`.slice(0, 127),
      out_trade_no: outTradeNo,
      notify_url: process.env.WECHAT_NOTIFY_URL || 'https://example.invalid/api/payments/wechat/notify',
      amount: { total: booking.package_price_cents, currency: 'CNY' }
    });
    db.prepare('INSERT INTO payments(id,booking_id,merchant_id,amount_cents,status,provider,provider_ref) VALUES(?,?,?,?,?,?,?)')
      .run(uid(), booking.id, booking.merchant_id, booking.package_price_cents, 'pending', 'wechat', outTradeNo);
    return { payment_status: 'unpaid', provider: 'wechat', code_url: data.code_url, out_trade_no: outTradeNo };
  }
  markPaid(booking, 'test', 'test-' + booking.code);
  return { payment_status: 'paid', provider: 'test' };
}

export function refundBooking(booking) {
  if (booking.payment_status !== 'paid') return booking.payment_status;
  const payment = db.prepare("SELECT * FROM payments WHERE booking_id=? AND status='paid' ORDER BY created_at DESC").get(booking.id);
  db.prepare('UPDATE bookings SET payment_status=?,updated_at=now() WHERE id=?').run('refunded', booking.id);
  db.prepare('INSERT INTO payments(id,booking_id,merchant_id,amount_cents,status,provider,provider_ref) VALUES(?,?,?,?,?,?,?)')
    .run(uid(), booking.id, booking.merchant_id, booking.package_price_cents, 'refunded', payment?.provider || 'test', payment?.provider_ref || '');
  return 'refunded';
}

export async function refundRemote(booking) {
  if (paymentMode() !== 'wechat') return;
  const payment = db.prepare("SELECT * FROM payments WHERE booking_id=? AND provider='wechat' AND status='paid' ORDER BY created_at DESC").get(booking.id);
  if (!payment?.provider_ref) return;
  await wechatRequest('POST', '/v3/refund/domestic/refunds', {
    out_trade_no: payment.provider_ref,
    out_refund_no: uid().replaceAll('-', '').slice(0, 32),
    amount: { refund: booking.package_price_cents, total: booking.package_price_cents, currency: 'CNY' }
  });
}
