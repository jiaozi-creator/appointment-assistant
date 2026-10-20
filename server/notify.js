import net from 'node:net';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { db, uid } from './db.js';
import { zoneLabel } from './time.js';

function record(row) {
  db.prepare(`INSERT INTO notifications(id,merchant_id,booking_id,channel,event,recipient,subject,body,status,provider)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(uid(), row.merchantId, row.bookingId, row.channel, row.event, row.recipient,
    row.subject || '', row.body, row.status, row.provider);
}

function smtpCommand(socket, line) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = chunk => {
      buffer += chunk.toString();
      if (!buffer.endsWith('\n')) return;
      socket.off('data', onData);
      const code = Number(buffer.slice(0, 3));
      if (code >= 400) reject(new Error(buffer.trim()));
      else resolve(buffer);
    };
    socket.on('data', onData);
    socket.write(line + '\r\n');
  });
}

async function smtpSend({ to, subject, body }) {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === '1' || port === 465;
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) throw new Error('缺少 SMTP_FROM');
  const socket = await new Promise((resolve, reject) => {
    const next = secure ? tls.connect({ host, port, servername: host }, () => resolve(next)) : net.connect(port, host, () => resolve(next));
    next.once('error', reject);
  });
  const readGreeting = () => new Promise((resolve, reject) => {
    socket.once('data', chunk => {
      const code = Number(chunk.toString().slice(0, 3));
      if (code >= 400) reject(new Error(chunk.toString()));
      else resolve();
    });
  });
  await readGreeting();
  await smtpCommand(socket, `EHLO appointment-assistant`);
  let channel = socket;
  if (!secure && process.env.SMTP_SECURE !== '0') {
    await smtpCommand(socket, 'STARTTLS');
    channel = await new Promise((resolve, reject) => {
      const upgraded = tls.connect({ socket, servername: host }, () => resolve(upgraded));
      upgraded.once('error', reject);
    });
    await smtpCommand(channel, 'EHLO appointment-assistant');
  }
  if (process.env.SMTP_USER) {
    await smtpCommand(channel, 'AUTH LOGIN');
    await smtpCommand(channel, Buffer.from(process.env.SMTP_USER).toString('base64'));
    await smtpCommand(channel, Buffer.from(process.env.SMTP_PASS || '').toString('base64'));
  }
  await smtpCommand(channel, `MAIL FROM:<${from}>`);
  await smtpCommand(channel, `RCPT TO:<${to}>`);
  await smtpCommand(channel, 'DATA');
  const message = `From: ${from}\r\nTo: ${to}\r\nSubject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n.`;
  await smtpCommand(channel, message);
  await smtpCommand(channel, 'QUIT');
  channel.end();
}

function aliyunSignature(params, secret) {
  const canonical = Object.keys(params).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`).join('&');
  const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonical)}`;
  return crypto.createHmac('sha1', `${secret}&`).update(stringToSign).digest('base64');
}

async function aliyunSms(phone, templateParam) {
  const params = {
    AccessKeyId: process.env.SMS_ACCESS_KEY_ID,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: phone,
    RegionId: 'cn-hangzhou',
    SignName: process.env.SMS_SIGN_NAME,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
    TemplateCode: process.env.SMS_TEMPLATE_CODE,
    TemplateParam: JSON.stringify(templateParam)
  };
  params.Signature = aliyunSignature(params, process.env.SMS_ACCESS_KEY_SECRET);
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`https://dysmsapi.aliyuncs.com/?${query}`);
  const data = await response.json();
  if (data.Code !== 'OK') throw new Error(data.Message || '短信发送失败');
  return data.BizId || '';
}

export async function deliverEmail(row) {
  if (!row.to) return;
  const base = { merchantId: row.merchantId, bookingId: row.bookingId, channel: 'email', event: row.event, recipient: row.to, subject: row.subject, body: row.body };
  if (!process.env.SMTP_HOST) {
    record({ ...base, status: 'sent', provider: 'test' });
    return;
  }
  try {
    await smtpSend({ to: row.to, subject: row.subject, body: row.body });
    record({ ...base, status: 'sent', provider: 'smtp' });
  } catch (error) {
    record({ ...base, status: 'failed', provider: 'smtp', body: `${row.body}\n${error.message}` });
  }
}

export async function deliverSms(row) {
  if (!row.phone) return;
  const base = { merchantId: row.merchantId, bookingId: row.bookingId, channel: 'sms', event: row.event, recipient: row.phone, subject: '', body: row.body };
  const configured = process.env.SMS_ACCESS_KEY_ID && process.env.SMS_ACCESS_KEY_SECRET && process.env.SMS_SIGN_NAME && process.env.SMS_TEMPLATE_CODE;
  if (!configured) {
    record({ ...base, status: 'sent', provider: 'test' });
    return;
  }
  try {
    await aliyunSms(row.phone, { code: row.code, time: row.when, event: row.event });
    record({ ...base, status: 'sent', provider: 'aliyun' });
  } catch (error) {
    record({ ...base, status: 'failed', provider: 'aliyun', body: `${row.body}\n${error.message}` });
  }
}

function whenText(booking) {
  return `${booking.preferred_date} ${booking.preferred_time}（${zoneLabel(booking.time_zone)}，${booking.time_zone}）`;
}

export async function notifyBooking(event, booking, merchantName) {
  const when = whenText(booking);
  const titles = { submitted: '预约申请已提交', confirmed: '预约已确认', cancelled: '预约已取消' };
  const lines = {
    submitted: `你提交了「${merchantName}」的拍摄预约，编号 ${booking.code}，意向时间 ${when}。当前为待确认，支付状态：${booking.payment_status === 'paid' ? '已支付' : '待支付'}。`,
    confirmed: `「${merchantName}」已确认你的预约 ${booking.code}，时间为 ${when}。`,
    cancelled: `预约 ${booking.code} 已取消（${when}）。${booking.payment_status === 'refunded' ? '已支付金额按原支付通道退回。' : '该预约未支付或无需退款。'}`
  };
  const body = lines[event];
  const owner = db.prepare("SELECT email FROM users WHERE merchant_id=? AND role='owner' AND active=1").get(booking.merchant_id);
  const merchantPhone = db.prepare('SELECT phone FROM merchants WHERE id=?').get(booking.merchant_id)?.phone;
  const jobs = [];
  if (event !== 'confirmed') {
    jobs.push(deliverEmail({ merchantId: booking.merchant_id, bookingId: booking.id, event, to: owner?.email, subject: titles[event], body }));
    if (merchantPhone) jobs.push(deliverSms({ merchantId: booking.merchant_id, bookingId: booking.id, event, phone: merchantPhone, body, code: booking.code, when }));
  }
  jobs.push(deliverEmail({ merchantId: booking.merchant_id, bookingId: booking.id, event, to: booking.contact_email, subject: titles[event], body }));
  jobs.push(deliverSms({ merchantId: booking.merchant_id, bookingId: booking.id, event, phone: booking.contact_phone, body, code: booking.code, when }));
  await Promise.all(jobs);
}
