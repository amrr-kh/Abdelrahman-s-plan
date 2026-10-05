// Demo mode (open the site with ?demo): an in-memory stand-in for Firebase so the whole app can be tried
// with sample data. Nothing is saved or sent anywhere; a refresh resets it. Not used in normal mode.

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const SHIFT_END = { half: '12:30', normal: '14:00', extra: '21:00' };
const driverRows = [
  ['d1', 'أحمد محمد', '01012345678', 'أ ب ج ١٢٣٤', 'B12', 'L-1001', addDays(today, 12)],
  ['d2', 'محمود حسن', '01123456789', 'س ص ع ٥٦٧٨', 'B07', 'L-1002', addDays(today, 200)],
  ['d3', 'خالد إبراهيم', '01234567890', 'م ن ه ٩٠١٢', 'B03', 'L-1003', addDays(today, -5)],
  ['d4', 'علي سعيد', '01512345678', 'ك ل م ٣٤٥٦', 'B21', 'L-1004', addDays(today, 400)]
];

const data = { drivers: {}, attendance: {}, workOrders: {}, vehicles: {}, settings: {} };
driverRows.forEach(([id, name, phone, plate, busSign, license, licenseExpiry]) => {
  data.drivers[id] = { name, phone, plate, busSign, license, licenseExpiry, status: 'active', createdAt: 1 };
});
data.drivers.d5 = { name: 'سائق سابق', phone: '', plate: '', busSign: '', status: 'inactive', createdAt: 1 };

data.vehicles = {
  v1: { plate: 'أ ب ج ١٢٣٤', busSign: 'B12', model: 'Mercedes Tourismo', insuranceExpiry: addDays(today, 20), licenseExpiry: addDays(today, 300), nextMaintenance: addDays(today, 6), status: 'active', createdAt: 1 },
  v2: { plate: 'س ص ع ٥٦٧٨', busSign: 'B07', model: 'Toyota Coaster', insuranceExpiry: addDays(today, -3), licenseExpiry: addDays(today, 90), nextMaintenance: addDays(today, 60), status: 'active', createdAt: 1 },
  v3: { plate: 'م ن ه ٩٠١٢', busSign: 'B03', model: 'Higer 49', insuranceExpiry: addDays(today, 250), licenseExpiry: addDays(today, 25), nextMaintenance: '', status: 'active', createdAt: 1 }
};

// A week of attendance
const pattern = ['normal', 'half', 'extra', 'normal', 'normal', 'off', 'normal'];
let ts = 1000;
for (let i = 0; i < 7; i++) {
  driverRows.slice(0, 3).forEach(([id, name, , plate, busSign], di) => {
    const kind = pattern[(i + di) % pattern.length];
    const present = kind !== 'off';
    data.attendance['a' + i + id] = {
      driverId: id, date: addDays(today, -i), status: present ? 'present' : 'off',
      startTime: present ? '07:30' : '', endTime: present ? SHIFT_END[kind] : '', shiftType: present ? kind : 'none',
      driverName: name, plate, busSign, route: present ? ['مطار — فندق نيل هيلتون', 'الأهرامات — الجيزة', 'خان الخليلي'][(i + di) % 3] : '', note: '', timestamp: ts++
    };
  });
}

// ---- minimal path store
const parts = p => String(p || '').split('/').filter(Boolean);
const clone = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function getAt(path) {
  let cur = data;
  for (const k of parts(path)) { if (cur == null || typeof cur !== 'object') return null; cur = cur[k]; }
  return cur === undefined ? null : cur;
}
function setAt(path, value) {
  const ks = parts(path);
  if (!ks.length) return;
  let cur = data;
  for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] == null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {}; cur = cur[ks[i]]; }
  const last = ks[ks.length - 1];
  if (value === null || value === undefined) delete cur[last]; else cur[last] = clone(value);
}

const listeners = new Set();
const notify = () => listeners.forEach(l => l());
let counter = 0;

export const initializeApp = () => ({});
export const getDatabase = () => ({});
export const ref = (_db, path = '') => ({ path });
export function onValue(r, cb) {
  const fire = () => cb({ val: () => (r.path === '.info/connected' ? true : clone(getAt(r.path))) });
  listeners.add(fire);
  setTimeout(fire, 0);
  return () => listeners.delete(fire);
}
export function push(r, value) {
  const key = '-demo' + (++counter).toString(36) + Date.now().toString(36);
  if (value !== undefined) { setAt(r.path + '/' + key, value); notify(); }
  const out = Promise.resolve({ key });
  out.key = key;
  return out;
}
export function update(r, values) {
  Object.entries(values).forEach(([k, v]) => setAt([r.path, k].filter(Boolean).join('/'), v));
  notify();
  return Promise.resolve();
}
export function remove(r) { setAt(r.path, null); notify(); return Promise.resolve(); }

// ---- auth: any PIN is accepted
const auth = { currentUser: null };
const authListeners = new Set();
const fireAuth = () => authListeners.forEach(cb => cb(auth.currentUser));
export const getAuth = () => auth;
export function signInWithEmailAndPassword() {
  auth.currentUser = { uid: 'demo', getIdToken: async () => 'demo' };
  fireAuth();
  return Promise.resolve();
}
export function signOut() { auth.currentUser = null; fireAuth(); return Promise.resolve(); }
export function onAuthStateChanged(_a, cb) { authListeners.add(cb); setTimeout(() => cb(auth.currentUser), 0); return () => authListeners.delete(cb); }
