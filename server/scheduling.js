// Resource engine. Callers that persist a decision must already be inside a transaction.
// allocate() takes a transaction-scoped advisory lock on merchant+date so two processes cannot confirm the same capacity.
import { db } from './db.js';

export const RESOURCE_KINDS = ['photographer','room','equipment'];
export const minute = value => {
  // Browsers submit <input type="time"> as HH:MM or HH:MM:SS. Seconds are ignored.
  if (typeof value !== 'string') throw Object.assign(new Error('时段格式无效'),{status:400});
  const matched=value.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  if (!matched) throw Object.assign(new Error('时段格式无效'),{status:400});
  return Number(matched[1])*60+Number(matched[2]);
};
export const fail = (status,message) => {throw Object.assign(new Error(message),{status});};
export function requirementsOf(source) {
  if (!Array.isArray(source) || source.length<1 || source.length>3) fail(400,'请设置1～3类套餐资源需求');
  const result=[];
  for (const item of source) {
    if (!item || !RESOURCE_KINDS.includes(item.kind) || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>50 || result.some(x=>x.kind===item.kind)) fail(400,'资源需求类型或数量无效');
    result.push({kind:item.kind,quantity:item.quantity});
  }
  if (!result.some(x=>x.kind==='photographer')) fail(400,'摄影套餐至少需要一名摄影师');
  return result;
}
export function requiredResourcesForBooking(bookingId) {
  return db.prepare('SELECT kind,quantity FROM booking_requirements WHERE booking_id=? ORDER BY kind').all(bookingId);
}
export function bookingWindow(booking) {
  const start=minute(booking.preferred_time)-booking.buffer_before;
  const end=minute(booking.preferred_time)+booking.duration_minutes+booking.buffer_after;
  if (start<0||end>1440||start>=end) fail(409,'套餐包含的准备或收尾时间超出当天范围');
  return {start,end};
}
function overlaps(a,b,c,d){return a<d&&c<b;}
function freeCapacity(resource,date,start,end,ignoreBookingId='') {
  const weeklyCount=db.prepare('SELECT COUNT(*) AS total FROM resource_weekly_hours WHERE resource_id=?').get(resource.id).total;
  if (weeklyCount) {
    const weekday=new Date(date+'T00:00:00Z').getUTCDay();
    const hours=db.prepare('SELECT start_min,end_min FROM resource_weekly_hours WHERE resource_id=? AND weekday=?').all(resource.id,weekday);
    if (!hours.some(h=>h.start_min<=start&&h.end_min>=end)) return 0;
  }
  const blocks=db.prepare('SELECT start_min,end_min FROM resource_blocks WHERE resource_id=? AND date=?').all(resource.id,date);
  if (blocks.some(b=>overlaps(start,end,b.start_min,b.end_min))) return 0;
  const booked=db.prepare(`SELECT b.preferred_time,b.duration_minutes,b.buffer_before,b.buffer_after,a.quantity
    FROM booking_allocations a JOIN bookings b ON b.id=a.booking_id
    WHERE a.resource_id=? AND b.preferred_date=? AND b.status IN ('confirmed','completed') AND b.id<>?`).all(resource.id,date,ignoreBookingId);
  const changes=[];
  for (const b of booked) {
    const existingStart=minute(b.preferred_time)-b.buffer_before;
    const existingEnd=minute(b.preferred_time)+b.duration_minutes+b.buffer_after;
    if (!overlaps(start,end,existingStart,existingEnd)) continue;
    changes.push([Math.max(start,existingStart),b.quantity], [Math.min(end,existingEnd),-b.quantity]);
  }
  // End events come before start events for half-open booking intervals.
  changes.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let used=0,maxUsed=0;
  for (const [,diff] of changes){used+=diff;maxUsed=Math.max(maxUsed,used);}
  return Math.max(0,resource.capacity-maxUsed);
}
export function freeAt(resource, date, booking, ignoreBookingId='') {
  if (!resource?.active) return 0;
  const {start,end}=bookingWindow(booking);
  return freeCapacity(resource, date, start, end, ignoreBookingId);
}
function sameDayLoad(resourceId, date, ignoreBookingId) {
  return db.prepare(`SELECT COALESCE(SUM(a.quantity),0) AS total
    FROM booking_allocations a JOIN bookings b ON b.id=a.booking_id
    WHERE a.resource_id=? AND b.preferred_date=? AND b.status IN ('confirmed','completed') AND b.id<>?`)
    .get(resourceId, date, ignoreBookingId).total;
}
export function allocate({merchantId,date,time,duration,before=0,after=0,requirements,requested,ignoreBookingId=''}) {
  db.prepare('SELECT pg_advisory_xact_lock(hashtext(?)::bigint)').get(`${merchantId}:${date}`);
  const {start,end}=bookingWindow({preferred_time:time,duration_minutes:duration,buffer_before:before,buffer_after:after});
  if (db.prepare('SELECT 1 FROM days_off WHERE merchant_id=? AND date=?').get(merchantId,date)) fail(409,'工作室该日暂停预约');
  if (start<9*60||end>21*60) fail(409,'该套餐的拍摄、准备和收尾时间必须在09:00–21:00内');
  const resources=db.prepare('SELECT id,kind,name,capacity,active FROM resources WHERE merchant_id=? ORDER BY kind,id').all(merchantId);
  if (requested !== undefined && requested !== null) {
    if (!Array.isArray(requested)||requested.length>60) fail(400,'资源分配格式无效');
    const selections=[],totals=new Map(),seen=new Set();
    for (const item of requested) {
      if (!item || typeof item.resource_id!=='string'||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>50||seen.has(item.resource_id)) fail(400,'指定资源格式无效');
      seen.add(item.resource_id);
      const resource=resources.find(x=>x.id===item.resource_id);
      if (!resource||!resource.active) fail(400,'指定资源不存在或不可用');
      if (freeCapacity(resource,date,start,end,ignoreBookingId)<item.quantity) fail(409,`${resource.name} 在该时段已被占用或不可用`);
      totals.set(resource.kind,(totals.get(resource.kind)||0)+item.quantity);
      selections.push({resource_id:resource.id,kind:resource.kind,quantity:item.quantity,name:resource.name});
    }
    if (requirements.length!==totals.size || requirements.some(rule=>totals.get(rule.kind)!==rule.quantity)) fail(400,'所选资源数量不满足套餐配置');
    return selections;
  }
  const selected=[];
  for (const rule of requirements) {
    let remaining=rule.quantity;
    const pool=resources.filter(x=>x.kind===rule.kind&&x.active).map(resource=>({
      resource,
      available:freeCapacity(resource,date,start,end,ignoreBookingId),
      load:sameDayLoad(resource.id,date,ignoreBookingId)
    })).sort((a,b)=>b.available-a.available||a.load-b.load||(a.resource.id<b.resource.id?-1:a.resource.id>b.resource.id?1:0));
    for (const item of pool) {
      const take=Math.min(item.available,remaining);
      if (take>0) {selected.push({resource_id:item.resource.id,kind:item.resource.kind,quantity:take,name:item.resource.name});remaining-=take;}
      if (!remaining) break;
    }
    if (remaining) fail(409,`该时段${{photographer:'摄影师',room:'场地',equipment:'设备'}[rule.kind]}资源不足，请选择其他时段`);
  }
  return selected;
}
