export const ZONE_LABELS = {
  'Asia/Shanghai': '中国标准时间',
  'Asia/Hong_Kong': '香港时间',
  'Asia/Taipei': '台北时间',
  'Asia/Tokyo': '日本标准时间',
  'Asia/Singapore': '新加坡时间',
  'Europe/Paris': '中欧时间',
  'Europe/London': '英国时间',
  'America/Los_Angeles': '美国太平洋时间',
  'America/New_York': '美国东部时间',
  UTC: '协调世界时'
};

export function zoneOk(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch { return false; }
}

export function zoneLabel(timeZone) {
  return ZONE_LABELS[timeZone] || timeZone;
}

function partsOf(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ms));
  const pick = type => parts.find(part => part.type === type)?.value;
  let hour = pick('hour');
  if (hour === '24') hour = '00';
  return {
    year: Number(pick('year')), month: Number(pick('month')), day: Number(pick('day')),
    hour: Number(hour), minute: Number(pick('minute')), second: Number(pick('second'))
  };
}

export function localToUtcMs(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let attempt = 0; attempt < 4; attempt++) {
    const local = partsOf(utc, timeZone);
    const seen = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    if (seen === desired) return utc;
    utc += desired - seen;
  }
  return utc;
}

export function zonedDate(timeZone, offsetDays = 0) {
  const local = partsOf(Date.now() + offsetDays * 86400000, timeZone);
  return `${String(local.year).padStart(4,'0')}-${String(local.month).padStart(2,'0')}-${String(local.day).padStart(2,'0')}`;
}
