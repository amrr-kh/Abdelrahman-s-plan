import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, normDigits, normName, isEgyptianMobile, shiftCode, statusOf, formatDate, formatTime12,
  addDays, weekStart, monthRange, toMinutes, hoursOfRecord, fmtHours, csvCell, summarizeReport
} from '../../js/utils.js';

test('esc escapes HTML so user text cannot inject markup', () => {
  assert.equal(esc('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(esc("O'Brien & Sons"), 'O&#39;Brien &amp; Sons');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('normDigits converts Arabic-Indic and Persian digits', () => {
  assert.equal(normDigits('٠١٠١٢٣٤٥٦٧٨'), '01012345678');
  assert.equal(normDigits('۰۱۱'), '011');
  assert.equal(normDigits(null), '');
});

test('isEgyptianMobile accepts 010/011/012/015 numbers only', () => {
  ['01012345678', '01112345678', '01212345678', '01512345678'].forEach(n => assert.ok(isEgyptianMobile(n), n));
  ['01312345678', '0101234567', '010123456789', '+201012345678', ''].forEach(n => assert.ok(!isEgyptianMobile(n), n));
});

test('normName ignores diacritics, alef/ya/ta-marbuta variants and spacing', () => {
  assert.equal(normName('أحمد  مُحمد'), normName('احمد محمد'));
  assert.equal(normName('فاطمة'), normName('فاطمه'));
  assert.equal(normName('  Ali  Hassan '), 'ali hassan');
});

test('shiftCode keeps codes and maps legacy translated labels', () => {
  assert.equal(shiftCode('half'), 'half');
  assert.equal(shiftCode('نص يوم'), 'half');
  assert.equal(shiftCode('Extra'), 'extra');
  assert.equal(shiftCode('شغل عادي'), 'normal');
  assert.equal(shiftCode('something odd'), 'custom');
});

test('statusOf treats records without a status as present', () => {
  assert.equal(statusOf({}), 'present');
  assert.equal(statusOf({ status: 'sick' }), 'sick');
  assert.equal(statusOf({ status: 'bogus' }), 'present');
});

test('formatDate / formatTime12', () => {
  assert.equal(formatDate('2026-10-05'), '05/10/2026');
  assert.equal(formatDate(''), '—');
  assert.equal(formatTime12('14:00', 'م', 'ص'), '2:00 م');
  assert.equal(formatTime12('00:30'), '12:30 AM');
  assert.equal(formatTime12('12:00'), '12:00 PM');
  assert.equal(formatTime12(''), '—');
});

test('date helpers: Egyptian week starts on Saturday', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(weekStart('2026-10-05'), '2026-10-03'); // Monday -> Saturday
  assert.equal(weekStart('2026-10-03'), '2026-10-03'); // Saturday stays
  assert.equal(weekStart('2026-10-09'), '2026-10-03'); // Friday -> previous Saturday
});

test('monthRange handles offsets across years and leap years', () => {
  assert.deepEqual(monthRange('2026-10-05', 0), ['2026-10-01', '2026-10-31']);
  assert.deepEqual(monthRange('2026-01-15', -1), ['2025-12-01', '2025-12-31']);
  assert.deepEqual(monthRange('2024-02-10', 0), ['2024-02-01', '2024-02-29']);
});

test('hoursOfRecord: normal, overnight, missing times and non-present', () => {
  assert.equal(toMinutes('07:30'), 450);
  assert.equal(toMinutes('bad'), null);
  assert.equal(hoursOfRecord({ startTime: '07:30', endTime: '14:00' }, '07:30'), 6.5);
  assert.equal(hoursOfRecord({ endTime: '14:00' }, '08:00'), 6); // falls back to default start
  assert.equal(hoursOfRecord({ startTime: '20:00', endTime: '02:00' }, '07:30'), 6); // overnight
  assert.equal(hoursOfRecord({ status: 'off', endTime: '' }, '07:30'), 0);
  assert.equal(hoursOfRecord({ startTime: '07:30', endTime: '' }, '07:30'), 0);
  assert.equal(fmtHours(6.456), '6.46');
});

test('csvCell quotes values and blocks spreadsheet formula injection', () => {
  assert.equal(csvCell('plain'), '"plain"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("http://evil")'), '"\'=HYPERLINK(""http://evil"")"');
  assert.equal(csvCell('+1'), '"\'+1"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(5), '"5"');
});

test('summarizeReport totals per driver, uses current names, counts off/sick separately', () => {
  const records = [
    { driverId: 'a', driverName: 'Old A', status: 'present', shiftType: 'half', startTime: '07:30', endTime: '12:30' },
    { driverId: 'a', driverName: 'Old A', shiftType: 'extra', startTime: '07:30', endTime: '21:00' },
    { driverId: 'a', driverName: 'Old A', status: 'off', shiftType: 'none' },
    { driverId: 'b', driverName: 'B', status: 'sick', shiftType: 'none' },
    { driverId: 'b', driverName: 'B', shiftType: 'نص يوم', startTime: '07:30', endTime: '12:30' } // legacy label
  ];
  const rows = summarizeReport(records, r => (r.driverId === 'a' ? 'New A' : r.driverName), '07:30');
  assert.deepEqual(rows.map(r => r.name), ['B', 'New A']);
  const a = rows.find(r => r.name === 'New A');
  assert.equal(a.days, 2);
  assert.equal(a.half, 1);
  assert.equal(a.extra, 1);
  assert.equal(a.off, 1);
  assert.equal(a.hours, 5 + 13.5);
  const b = rows.find(r => r.name === 'B');
  assert.equal(b.sick, 1);
  assert.equal(b.half, 1);
  assert.equal(b.days, 1);
});
