// Pure helpers (no DOM, no Firebase) so they can be unit-tested with `node --test`.

export const SHIFTS = {
  half:   { ar:'نص يوم',    en:'Half Day', end:'12:30' },
  normal: { ar:'شغل عادي',  en:'Normal',   end:'14:00' },
  extra:  { ar:'شغل إضافي', en:'Extra',    end:'21:00' },
  custom: { ar:'وقت محدد',  en:'Custom',   end:'' },
  none:   { ar:'—',         en:'—',        end:'' }
};

export const STATUSES = {
  present: { ar:'حاضر', en:'Present', badge:'badge-green' },
  off:     { ar:'إجازة', en:'Day off', badge:'badge-blue' },
  sick:    { ar:'مرضي', en:'Sick',    badge:'badge-red' }
};

export const LEGACY_SHIFT = { 'نص يوم':'half','Half Day':'half','شغل عادي':'normal','Normal':'normal','شغل إضافي':'extra','Extra':'extra','وقت محدد':'custom','Custom':'custom' };

export function statusOf(a) { return STATUSES[a.status] ? a.status : 'present'; }

export function normDigits(s) { return String(s||'').replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); }

export function shiftCode(s) { return SHIFTS[s] ? s : (LEGACY_SHIFT[s] || 'custom'); }

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

export function normName(s) { return String(s||'').replace(/[ً-ٟـ]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/\s+/g,' ').trim().toLowerCase(); }

export function addDays(str, n) { const d = new Date(str+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }

export function weekStart(str) { const d = new Date(str+'T00:00:00Z'); return addDays(str, -((d.getUTCDay()+1) % 7)); }  // Egyptian week starts Saturday

export function monthRange(str, offset) {
  const [y,m] = str.split('-').map(Number);
  return [new Date(Date.UTC(y, m-1+offset, 1)).toISOString().slice(0,10), new Date(Date.UTC(y, m+offset, 0)).toISOString().slice(0,10)];
}

export function toMinutes(hhmm) { const [h,m] = String(hhmm||'').split(':').map(Number); return (isNaN(h)||isNaN(m)) ? null : h*60+m; }

export function fmtHours(h) { return String(Math.round(h*100)/100); }

export function csvCell(v) {
  let s = String(v ?? '');
  if(/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // stop spreadsheet formula injection
  return '"' + s.replace(/"/g,'""') + '"';
}

export function formatDate(d){ if(!d) return '—'; const [y,m,day]=d.split('-'); return `${day}/${m}/${y}`; }

export const isEgyptianMobile = p => /^01[0125][0-9]{8}$/.test(p);

// 12-hour clock text; pass the localised AM/PM labels
export function formatTime12(v, pm = 'PM', am = 'AM') {
  if (!v) return '—';
  const [h, m] = v.split(':');
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr === 0 ? 12 : hr}:${m} ${hr >= 12 ? pm : am}`;
}

// Worked hours for a present record (end earlier than start = overnight)
export function hoursOfRecord(a, defaultStart) {
  if (statusOf(a) !== 'present') return 0;
  const s = toMinutes(a.startTime || defaultStart), e = toMinutes(a.endTime);
  if (s === null || e === null) return 0;
  let d = e - s; if (d < 0) d += 1440;
  return d / 60;
}

// Per-driver totals for a list of attendance records
export function summarizeReport(records, nameOf, defaultStart) {
  const map = {};
  records.forEach(a => {
    const key = a.driverId || a.driverName;
    const r = map[key] || (map[key] = { name: nameOf(a), days: 0, half: 0, normal: 0, extra: 0, custom: 0, off: 0, sick: 0, hours: 0 });
    const st = statusOf(a);
    if (st !== 'present') { r[st]++; return; }
    r.days++; r.hours += hoursOfRecord(a, defaultStart);
    const c = shiftCode(a.shiftType); r[c === 'none' ? 'custom' : c]++;
  });
  return Object.values(map).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// ===== Expiry tracking (vehicle papers, maintenance, driver licences) =====
export const VEHICLE_DATE_FIELDS = ['insuranceExpiry', 'licenseExpiry', 'nextMaintenance'];

// Whole days from `today` to `dateStr` (both YYYY-MM-DD); negative = already past; null if no/invalid date
export function daysUntil(dateStr, today) {
  if (!dateStr) return null;
  const a = Date.parse(dateStr + 'T00:00:00Z'), b = Date.parse(today + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

export function expiryStatus(days, warnDays = 30) {
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  return days <= warnDays ? 'soon' : 'ok';
}

// Everything expired or expiring within warnDays, most urgent first. Inactive vehicles/drivers are ignored.
export function collectExpiries(vehicles, drivers, today, warnDays = 30) {
  const items = [];
  const push = (kind, id, field, label, date) => {
    const days = daysUntil(date, today), status = expiryStatus(days, warnDays);
    if (status === 'expired' || status === 'soon') items.push({ kind, id, field, label, date, days, status });
  };
  Object.entries(vehicles || {}).forEach(([id, v]) => {
    if (v.status === 'inactive') return;
    const label = [v.busSign, v.plate].filter(Boolean).join(' · ');
    VEHICLE_DATE_FIELDS.forEach(f => push('vehicle', id, f, label, v[f]));
  });
  Object.entries(drivers || {}).forEach(([id, d]) => {
    if (d.status === 'inactive') return;
    push('driver', id, 'driverLicense', d.name || '', d.licenseExpiry);
  });
  return items.sort((a, b) => a.days - b.days);
}
