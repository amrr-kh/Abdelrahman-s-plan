// Security Rules tests. Run with the Realtime Database emulator (needs Java):
//   npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, update, remove } from 'firebase/database';

let env;
const goodAttendance = {
  driverId: 'd1', date: '2026-10-05', status: 'present', startTime: '07:30', endTime: '14:00',
  shiftType: 'normal', driverName: 'A', plate: '', busSign: '', route: '', note: '', timestamp: 1
};

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-travelband',
    database: { rules: fs.readFileSync('database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 }
  });
});
after(() => env.cleanup());
beforeEach(async () => {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.database();
    await set(ref(db, 'users/admin1'), { role: 'admin' });
    await set(ref(db, 'users/sup1'), { role: 'supervisor' });
    await set(ref(db, 'drivers/d1'), { name: 'Driver One', phone: '', plate: '', busSign: '', status: 'active' });
    await set(ref(db, 'attendance/r1'), goodAttendance);
  });
});

const as = uid => env.authenticatedContext(uid).database();
const anon = () => env.unauthenticatedContext().database();

test('logged-out users cannot read or write anything', async () => {
  await assertFails(get(ref(anon(), 'drivers')));
  await assertFails(get(ref(anon(), 'attendance')));
  await assertFails(set(ref(anon(), 'drivers/x'), { name: 'X' }));
});

test('authenticated users without a role are locked out', async () => {
  await assertFails(get(ref(as('stranger'), 'drivers')));
  await assertFails(set(ref(as('stranger'), 'drivers/x'), { name: 'X' }));
});

test('users can read only their own role, and cannot change it', async () => {
  await assertSucceeds(get(ref(as('sup1'), 'users/sup1/role')));
  await assertFails(get(ref(as('sup1'), 'users/admin1/role')));
  await assertFails(set(ref(as('sup1'), 'users/sup1/role'), 'admin'));
});

test('supervisor can read, add and edit but not delete', async () => {
  const db = as('sup1');
  await assertSucceeds(get(ref(db, 'drivers')));
  await assertSucceeds(set(ref(db, 'drivers/d2'), { name: 'Driver Two', status: 'active' }));
  await assertSucceeds(update(ref(db, 'attendance/r1'), { route: 'Airport', updatedAt: 2 }));
  await assertFails(remove(ref(db, 'attendance/r1')));
  await assertFails(remove(ref(db, 'drivers/d1')));
});

test('admin can delete', async () => {
  await assertSucceeds(remove(ref(as('admin1'), 'attendance/r1')));
  await assertSucceeds(remove(ref(as('admin1'), 'drivers/d1')));
});

test('attendance validation rejects bad data', async () => {
  const db = as('sup1');
  await assertSucceeds(set(ref(db, 'attendance/ok'), goodAttendance));
  await assertFails(set(ref(db, 'attendance/bad1'), { ...goodAttendance, date: '05/10/2026' }));
  await assertFails(set(ref(db, 'attendance/bad2'), { ...goodAttendance, shiftType: 'نص يوم' }));
  await assertFails(set(ref(db, 'attendance/bad3'), { ...goodAttendance, endTime: '25x' }));
  await assertFails(set(ref(db, 'attendance/bad4'), { ...goodAttendance, status: 'holiday' }));
  await assertFails(set(ref(db, 'attendance/bad5'), { ...goodAttendance, extra: 'field' }));
  await assertFails(set(ref(db, 'attendance/bad6'), { ...goodAttendance, route: 'x'.repeat(201) }));
});

test('driver validation rejects bad data', async () => {
  const db = as('sup1');
  await assertFails(set(ref(db, 'drivers/e1'), { phone: '0101' })); // name required
  await assertFails(set(ref(db, 'drivers/e2'), { name: '' }));
  await assertFails(set(ref(db, 'drivers/e3'), { name: 'X', status: 'gone' }));
  await assertFails(set(ref(db, 'drivers/e4'), { name: 'X', admin: true }));
});

test('settings: everyone with a role reads, only admin writes', async () => {
  const s = { startTime: '07:30', halfEnd: '12:30', normalEnd: '14:00', extraEnd: '21:00' };
  await assertSucceeds(set(ref(as('admin1'), 'settings'), s));
  await assertFails(set(ref(as('sup1'), 'settings'), s));
  await assertSucceeds(get(ref(as('sup1'), 'settings')));
  await assertFails(set(ref(as('admin1'), 'settings'), { ...s, startTime: 'late' }));
});

test('work orders: photoUrl must be https', async () => {
  const wo = { driverId: 'd1', driverName: 'A', date: '2026-10-05', workOrder: '123', photoUrl: 'https://drive.google.com/x', timestamp: 1 };
  await assertSucceeds(set(ref(as('sup1'), 'workOrders/w1'), wo));
  await assertFails(set(ref(as('sup1'), 'workOrders/w2'), { ...wo, photoUrl: 'javascript:alert(1)' }));
  await assertFails(remove(ref(as('sup1'), 'workOrders/w1')));
});

test('vehicles: supervisor adds/edits, only admin deletes, dates validated', async () => {
  const v = { plate: 'ABC 123', busSign: 'B1', insuranceExpiry: '2026-12-01', licenseExpiry: '', status: 'active', createdAt: 1 };
  await assertSucceeds(set(ref(as('sup1'), 'vehicles/v1'), v));
  await assertSucceeds(update(ref(as('sup1'), 'vehicles/v1'), { nextMaintenance: '2026-11-15' }));
  await assertFails(set(ref(as('sup1'), 'vehicles/v2'), { ...v, insuranceExpiry: '1/12/2026' }));
  await assertFails(set(ref(as('sup1'), 'vehicles/v3'), { busSign: 'no plate' }));
  await assertFails(set(ref(as('sup1'), 'vehicles/v4'), { ...v, secret: 1 }));
  await assertFails(get(ref(anon(), 'vehicles')));
  await assertFails(remove(ref(as('sup1'), 'vehicles/v1')));
  await assertSucceeds(remove(ref(as('admin1'), 'vehicles/v1')));
});

test('driver licenseExpiry must be a date or empty', async () => {
  await assertSucceeds(update(ref(as('sup1'), 'drivers/d1'), { licenseExpiry: '2027-03-01' }));
  await assertSucceeds(update(ref(as('sup1'), 'drivers/d1'), { licenseExpiry: '' }));
  await assertFails(update(ref(as('sup1'), 'drivers/d1'), { licenseExpiry: 'soon' }));
});
