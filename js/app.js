import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, push, onValue, remove, update, get } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { SHIFTS, STATUSES, statusOf, normDigits, shiftCode, esc, normName, addDays, weekStart, monthRange, fmtHours, csvCell, formatDate, isEgyptianMobile, formatTime12, hoursOfRecord, summarizeReport } from "./utils.js";

const firebaseConfig = {
  apiKey: "AIzaSyDtY0yMhxgtog1fzyb7Qqurcge68iM2T3E",
  authDomain: "abdelrahman-transport.firebaseapp.com",
  databaseURL: "https://abdelrahman-transport-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "abdelrahman-transport",
  storageBucket: "abdelrahman-transport.firebasestorage.app",
  messagingSenderId: "219656259545",
  appId: "1:219656259545:web:07eaae9d9b804c20243bc8"
};
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

let drivers = {}, attendance = {}, workOrders = {};
const DEFAULT_SETTINGS = { startTime:'07:30', halfEnd:'12:30', normalEnd:'14:00', extraEnd:'21:00' };
let settings = { ...DEFAULT_SETTINGS };
let loaded = 0;
let currentLang = 'ar';
let savedLang = null;
try { savedLang = localStorage.getItem('tb_lang'); } catch(_) { /* storage blocked */ }
let isOffline = false, loadTimer = null, lastFocus = null;
let isAdmin = false;
let unsubscribers = [];
let clockTimer = null;

const shiftEndKey = { half:'halfEnd', normal:'normalEnd', extra:'extraEnd' };
function shiftEnd(code) { return shiftEndKey[code] ? settings[shiftEndKey[code]] : ''; }
function statusLabel(s) { return currentLang === 'ar' ? STATUSES[s].ar : STATUSES[s].en; }
function isActive(d) { return d && d.status !== 'inactive'; }
// Always show a driver's CURRENT name (records keep the name they were saved with as a fallback, e.g. deleted drivers)
function drvName(r) { return (r.driverId && drivers[r.driverId] && drivers[r.driverId].name) || r.driverName || ''; }
// State-dependent wrappers around the pure helpers in utils.js
const hoursOf = a => hoursOfRecord(a, settings.startTime);
const formatTime = v => formatTime12(v, t('م','PM'), t('ص','AM'));
const reportSummary = records => summarizeReport(records, drvName, settings.startTime);
// Table cells that depend on the attendance status
function startCell(a) { return statusOf(a)==='present' ? `<span class="badge badge-green">${formatTime(a.startTime||settings.startTime)}</span>` : '—'; }
function endCell(a) { return statusOf(a)==='present' ? `<b style="color:var(--orange)">${formatTime(a.endTime)}</b>` : '—'; }
function typeCell(a) {
  const s = statusOf(a);
  return s==='present' ? `<span class="badge ${shiftBadge(a.shiftType)}">${shiftLabel(a.shiftType)}</span>` : `<span class="badge ${STATUSES[s].badge}">${statusLabel(s)}</span>`;
}
function shiftLabel(s) { const c = shiftCode(s); return currentLang === 'ar' ? SHIFTS[c].ar : SHIFTS[c].en; }

// Escape any user-supplied text before putting it inside innerHTML

// ===== DIALOGS (replace browser alert/confirm) =====
let dialogResolve = null;
function openDialog(msg, withCancel) {
  return new Promise(resolve => {
    if (dialogResolve) dialogResolve(false);
    dialogResolve = resolve;
    document.getElementById('dialogMsg').textContent = msg;
    const ok = document.getElementById('dialogOk'), cancel = document.getElementById('dialogCancel');
    ok.textContent = withCancel ? t('تأكيد','Confirm') : t('حسناً','OK');
    cancel.textContent = t('إلغاء','Cancel');
    cancel.style.display = withCancel ? '' : 'none';
    lastFocus = document.activeElement;
    document.getElementById('dialogOverlay').classList.add('open');
    ok.focus();
  });
}
function closeDialog(result) {
  document.getElementById('dialogOverlay').classList.remove('open');
  if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(result); }
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
const alert = msg => { openDialog(String(msg), false); };
const askConfirm = msg => openDialog(String(msg), true);
document.getElementById('dialogOk').addEventListener('click', () => closeDialog(true));
document.getElementById('dialogCancel').addEventListener('click', () => closeDialog(false));

// Escape closes the top-most dialog/modal; Tab stays inside it
document.addEventListener('keydown', e => {
  const dlg = document.getElementById('dialogOverlay'), modal = document.getElementById('addDriverModal');
  const box = dlg.classList.contains('open') ? dlg : modal.classList.contains('open') ? modal : null;
  if (!box) return;
  if (e.key === 'Escape') { e.preventDefault(); if (box === dlg) closeDialog(false); else window.closeModal(); return; }
  if (e.key === 'Tab') {
    const f = [...box.querySelectorAll('button,input,select,textarea,[href]')].filter(x => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length-1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});

// ===== OFFLINE BANNER =====
function updateOfflineBanner() {
  const b = document.getElementById('offlineBanner');
  b.textContent = t('⚠️ لا يوجد اتصال — التغييرات ستُحفظ عند عودة الإنترنت، لا تغلق الصفحة','⚠️ Offline — changes sync when you reconnect; keep this page open');
  b.classList.toggle('show', isOffline);
}
window.addEventListener('offline', () => { isOffline = true; updateOfflineBanner(); });
window.addEventListener('online', () => { isOffline = false; updateOfflineBanner(); });

function checkLoaded() { loaded++; if (loaded >= 4) { clearTimeout(loadTimer); document.getElementById('loadingOverlay').style.display='none'; migrateShiftCodes(); } }

function startListening() {
  loaded = 0;
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => { if (loaded < 4) { document.getElementById('loadingOverlay').style.display='none'; isOffline = true; updateOfflineBanner(); } }, 10000);
  unsubscribers.push(onValue(ref(db,'.info/connected'), snap => { isOffline = snap.val() !== true; updateOfflineBanner(); }));
  unsubscribers.push(onValue(ref(db,'settings'), snap => { settings = { ...DEFAULT_SETTINGS, ...(snap.val()||{}) }; renderShiftOptions(); fillSettingsForm(); renderAll(); checkLoaded(); }, onDbError));
  unsubscribers.push(onValue(ref(db,'drivers'), snap => { drivers = snap.val()||{}; renderAllDrivers(); refreshSelects(); renderDashboard(); renderBulk(); checkLoaded(); }, onDbError));
  unsubscribers.push(onValue(ref(db,'attendance'), snap => { attendance = snap.val()||{}; renderAttendance(); renderDashboard(); renderBulk(); checkLoaded(); }, onDbError));
  unsubscribers.push(onValue(ref(db,'workOrders'), snap => { workOrders = snap.val()||{}; renderWorkOrders(); checkLoaded(); }, onDbError));
}
function stopListening() { clearTimeout(loadTimer); isOffline = false; updateOfflineBanner(); unsubscribers.forEach(u => u()); unsubscribers = []; drivers = {}; attendance = {}; workOrders = {}; settings = { ...DEFAULT_SETTINGS }; }
function onDbError(err) {
  console.error(err);
  document.getElementById('loadingOverlay').style.display='none';
  showLogin(t('ليس لديك صلاحية الدخول. تواصل مع المسؤول.','You do not have access. Contact the administrator.'));
  signOut(auth);
}

// One-off: convert old translated shift labels to stable codes (admin only)
function migrateShiftCodes() {
  if (!isAdmin) return;
  const patch = {};
  Object.entries(attendance).forEach(([id,a]) => { if (!SHIFTS[a.shiftType]) patch['attendance/'+id+'/shiftType'] = shiftCode(a.shiftType); });
  if (Object.keys(patch).length) update(ref(db), patch).catch(e => console.error('Shift migration failed', e));
}

// ===== LANG =====
function applyLang(lang) {
  currentLang = lang;
  try { localStorage.setItem('tb_lang', lang); } catch(_) { /* storage blocked */ }
  const html = document.getElementById('htmlRoot');
  html.setAttribute('lang', lang);
  html.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
  document.getElementById('langDot').textContent = lang === 'ar' ? 'ع' : 'EN';
  document.getElementById('langLabel').textContent = lang === 'ar' ? 'AR' : 'EN';
  document.querySelectorAll('[data-ar]').forEach(el => { if (el.tagName !== 'INPUT') el.textContent = el.getAttribute(lang === 'ar' ? 'data-ar' : 'data-en'); });
  document.querySelectorAll('[data-ph-ar]').forEach(el => el.setAttribute('placeholder', el.getAttribute(lang === 'ar' ? 'data-ph-ar' : 'data-ph-en')));
  document.getElementById('driverModalTitle').textContent = editingDriverId ? t('✏️ تعديل بيانات السائق','✏️ Edit Driver') : t('➕ إضافة سائق جديد','➕ Add New Driver');
  document.getElementById('driverSaveBtn').textContent = editingDriverId ? t('حفظ التعديلات','Save Changes') : t('إضافة السائق','Add Driver');
  if (editingAttendId) document.getElementById('attendSaveBtn').textContent = t('حفظ التعديل','Save changes');
  updateOfflineBanner();
  renderAll(); refreshSelects(); window.fillAttendDriverInfo();
}
window.toggleLang = function() { applyLang(currentLang === 'ar' ? 'en' : 'ar'); }

function t(ar, en) { return currentLang === 'ar' ? ar : en; }

// ===== LOCK =====
function showLogin(msg) {
  document.getElementById('loadingOverlay').style.display='none';
  document.getElementById('lockScreen').style.display='flex';
  const err = document.getElementById('lockError');
  if (msg) { err.textContent = msg; err.style.display='block'; } else err.style.display='none';
}

// PIN login. Behind the scenes the PIN is the password of one of two shared Firebase accounts
// (admin / staff), so it is verified by Firebase on the server, never in this page.
const PIN_ACCOUNTS = ['staff@travelband.app', 'admin@travelband.app'];

window.doLogin = async function() {
  const pin = normDigits(document.getElementById('loginPin').value).trim();
  if (pin.length < 6) return showLogin(t('الكود السري 6 أرقام على الأقل','The PIN must be at least 6 digits'));
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  try {
    let signedIn = false, lastErr = null;
    for (const email of PIN_ACCOUNTS) {
      try { await signInWithEmailAndPassword(auth, email, pin); signedIn = true; break; }
      catch (err) { lastErr = err; if (err.code === 'auth/too-many-requests' || err.code === 'auth/network-request-failed') break; }
    }
    if (!signedIn) throw lastErr;
    document.getElementById('loginPin').value = '';
  } catch (err) {
    console.error(err);
    const msg = err && err.code === 'auth/too-many-requests' ? t('محاولات كتير، حاول لاحقاً','Too many attempts, try later')
      : err && err.code === 'auth/network-request-failed' ? t('لا يوجد اتصال بالإنترنت','No internet connection')
      : t('❌ الكود غلط','❌ Wrong PIN');
    showLogin(msg);
    document.getElementById('loginPin').value = '';
  } finally { btn.disabled = false; }
}
window.doLogout = function() { signOut(auth); }
document.getElementById('loginPin').addEventListener('keydown', e => { if(e.key==='Enter') window.doLogin(); });

onAuthStateChanged(auth, async user => {
  stopListening();
  if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
  if (!user) { isAdmin = false; showLogin(); return; }
  try {
    const role = (await get(ref(db,'users/'+user.uid+'/role'))).val();
    if (role !== 'admin' && role !== 'supervisor') {
      await signOut(auth);
      return showLogin(t('حسابك غير مفعّل. تواصل مع المسؤول.','Your account is not activated. Contact the administrator.'));
    }
    isAdmin = role === 'admin';
    document.getElementById('navSettings').style.display = isAdmin ? '' : 'none';
  } catch (e) {
    console.error(e);
    await signOut(auth);
    return showLogin(t('تعذر التحقق من الصلاحيات','Could not verify permissions'));
  }
  document.getElementById('lockScreen').style.display='none';
  document.getElementById('loadingOverlay').style.display='flex';
  setTodayDate(); startClock(); startListening();
});

function startClock() {
  function upd() { document.getElementById('clockDisplay').textContent = new Date().toLocaleTimeString(currentLang==='ar'?'ar-EG':'en-US',{timeZone:'Africa/Cairo',hour12:true}); }
  upd(); clockTimer = setInterval(upd,1000);
}
function setTodayDate() {
  const today = new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});
  document.getElementById('attendDate').value = today;
  document.getElementById('filterDate').value = today;
  document.getElementById('bulkDate').value = today;
  window.repPreset('month');
  renderStatusOptions(); renderBulk();
}

// ===== NAV =====
window.showPage = function(id, btn) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>{ b.classList.remove('active'); b.removeAttribute('aria-current'); });
  document.getElementById('page-'+id).classList.add('active');
  btn.classList.add('active'); btn.setAttribute('aria-current','page');
  if(id==='reports') renderReports();
  if(id==='drivers') renderAllDrivers();
}

// ===== MODAL =====
let editingDriverId = null;
window.openModal = function(id) {
  editingDriverId = (typeof id === 'string' && drivers[id]) ? id : null;
  const d = editingDriverId ? drivers[editingDriverId] : {};
  document.getElementById('driverName').value = d.name || '';
  document.getElementById('driverPhone').value = d.phone || '';
  document.getElementById('driverLicense').value = d.license || '';
  document.getElementById('driverPlate').value = d.plate || '';
  document.getElementById('driverBusSign').value = d.busSign || '';
  document.getElementById('driverModalTitle').textContent = editingDriverId ? t('✏️ تعديل بيانات السائق','✏️ Edit Driver') : t('➕ إضافة سائق جديد','➕ Add New Driver');
  document.getElementById('driverSaveBtn').textContent = editingDriverId ? t('حفظ التعديلات','Save Changes') : t('إضافة السائق','Add Driver');
  document.getElementById('addDriverModal').classList.add('open');
}
window.closeModal = function() { document.getElementById('addDriverModal').classList.remove('open'); editingDriverId = null; }

// ===== TOAST =====
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}

// ===== DRIVERS =====
const SHEETS_URL = 'https://script.google.com/macros/s/AKfycbx4Urquc-MQwVBqFPIg_TtMIa0ovbrx7cEkcUWaQ2oMrx0J3ii3T-QVXLPAjvZ3Q_LU/exec';

// Sends the signed-in user's ID token so the Apps Script can verify the caller
// (see docs/PHASE1-SETUP.md for the script-side check).
async function sendToSheets(data) {
  try {
    const idToken = await auth.currentUser?.getIdToken();
    await fetch(SHEETS_URL, {
      method:'POST', mode:'no-cors',
      headers:{'Content-Type':'text/plain;charset=utf-8'},
      body: JSON.stringify({ ...data, idToken })
    });
  } catch (err) { console.log('Sheets sync error:', err); }
}

window.saveDriver = async function() {
  const name = document.getElementById('driverName').value.trim();
  const phone = normDigits(document.getElementById('driverPhone').value).replace(/[\s-]/g,'');
  const license = document.getElementById('driverLicense').value.trim();
  const plate = document.getElementById('driverPlate').value.trim();
  const busSign = document.getElementById('driverBusSign').value.trim();
  if(!name) return alert(t('اكتب اسم السائق','Enter driver name'));
  if(phone && !isEgyptianMobile(phone)) return alert(t('رقم التليفون لازم يكون موبايل مصري (01xxxxxxxxx)','Phone must be an Egyptian mobile number (01xxxxxxxxx)'));
  if(name.length > 100 || license.length > 50 || plate.length > 30 || busSign.length > 30) return alert(t('البيانات طويلة جداً','Input too long'));
  const sameName = Object.entries(drivers).some(([id,d]) => id !== editingDriverId && normName(d.name) === normName(name));
  if(sameName && !(await askConfirm(t('يوجد سائق بنفس الاسم. تكمل؟','A driver with this name already exists. Continue?')))) return;
  const fields = { name, phone, plate, busSign, license };
  if(editingDriverId) {
    update(ref(db,'drivers/'+editingDriverId), fields)
      .then(() => toast(t('تم حفظ التعديلات ✓','Changes saved ✓')))
      .catch(e => { console.error(e); alert(t('تعذر الحفظ','Could not save')); });
  } else {
    push(ref(db,'drivers'), { ...fields, status:'active', createdAt:Date.now() })
      .then(() => toast(t('تم إضافة السائق ✓','Driver added ✓')))
      .catch(e => { console.error(e); alert(t('تعذر الحفظ','Could not save')); });
    sendToSheets({ type:'driver', name, phone, plate, busSign });
  }
  window.closeModal();
}

window.editDriver = function(id) { window.openModal(id); }

window.toggleDriverActive = async function(id) {
  const d = drivers[id]; if(!d) return;
  const next = isActive(d) ? 'inactive' : 'active';
  if(next==='inactive' && !(await askConfirm(t('إيقاف السائق؟ سيختفي من قوائم التسجيل وتبقى سجلاته.','Deactivate this driver? They disappear from entry lists; records are kept.')))) return;
  update(ref(db,'drivers/'+id), { status: next }).catch(e => { console.error(e); alert(t('تعذر الحفظ','Could not save')); });
}

window.deleteDriver = async function(id) {
  if(!isAdmin) return alert(t('المسح للمسؤول فقط','Only admins can delete'));
  if(!(await askConfirm(t('تأكيد مسح السائق؟ (الأفضل إيقافه بدل المسح)','Delete this driver? (deactivating is usually better)')))) return;
  remove(ref(db,'drivers/'+id)).catch(e => { console.error(e); alert(t('تعذر المسح','Could not delete')); });
}

function renderAllDrivers() {
  const el = document.getElementById('allDriversTable');
  const list = Object.entries(drivers);
  if(!list.length){ el.innerHTML=`<div class="empty-state">${t('لا يوجد سائقين','No drivers yet')}</div>`; return; }
  el.innerHTML=`<table><thead><tr>
    <th>${t('الاسم','Name')}</th><th>${t('التليفون','Phone')}</th>
    <th>${t('اللوحة','Plate')}</th><th>${t('الباص','Bus')}</th><th>${t('الحالة','Status')}</th>
    <th></th>
  </tr></thead><tbody>
  ${list.map(([id,d])=>`<tr${isActive(d)?'':' style="opacity:0.55"'}>
    <td><b>${esc(d.name)}</b></td><td>${esc(d.phone)||'—'}</td>
    <td><span class="badge badge-orange">${esc(d.plate)||'—'}</span></td>
    <td><span class="badge badge-blue">${esc(d.busSign)||'—'}</span></td>
    <td><span class="badge ${isActive(d)?'badge-green':'badge-amber'}">${isActive(d)?t('نشط','Active'):t('موقوف','Inactive')}</span></td>
    <td style="white-space:nowrap">
      <button class="btn btn-secondary" style="padding:4px 10px;font-size:0.78rem" onclick="editDriver('${esc(id)}')">${t('تعديل','Edit')}</button>
      <button class="btn btn-secondary" style="padding:4px 10px;font-size:0.78rem" onclick="toggleDriverActive('${esc(id)}')">${isActive(d)?t('إيقاف','Deactivate'):t('تفعيل','Activate')}</button>
      ${isAdmin?`<button class="btn btn-danger" onclick="deleteDriver('${esc(id)}')">${t('مسح','Delete')}</button>`:''}
    </td>
  </tr>`).join('')}</tbody></table>`;
  refreshSelects();
}

function refreshSelects() {
  const all = Object.entries(drivers);
  const optHtml = list => `<option value="">${t('— اختر سائق —','— Select Driver —')}</option>` + list.map(([id,d])=>`<option value="${esc(id)}">${esc(d.name)}</option>`).join('');
  // Entry forms list active drivers only (plus the one currently selected, e.g. when editing an old record)
  ['attendDriver','woDriver'].forEach(sid=>{
    const el = document.getElementById(sid); if(!el) return;
    const keep = el.value;
    el.innerHTML = optHtml(all.filter(([id,d])=>isActive(d)||id===keep));
    if(keep && drivers[keep]) el.value = keep;
  });
  ['driverViewSelect'].forEach(sid=>{
    const el = document.getElementById(sid); if(!el) return;
    const keep = el.value; el.innerHTML = optHtml(all); if(keep && drivers[keep]) el.value = keep;
  });
  const rs = document.getElementById('reportDriverSelect');
  if(rs) { const keep = rs.value; rs.innerHTML = `<option value="">${t('كل السائقين','All drivers')}</option>` + all.map(([id,d])=>`<option value="${esc(id)}">${esc(d.name)}</option>`).join(''); if(keep && drivers[keep]) rs.value = keep; }
  const f = document.getElementById('woFilterDriver');
  if(f) { const keep = f.value; f.innerHTML = `<option value="">${t('كل السائقين','All drivers')}</option>` + all.map(([id,d])=>`<option value="${esc(id)}">${esc(d.name)}</option>`).join(''); if(keep && drivers[keep]) f.value = keep; }
}

// ===== DRIVER PROFILE VIEW =====
window.loadDriverProfile = function() {
  const id = document.getElementById('driverViewSelect').value;
  const pa = document.getElementById('driverProfileArea');
  const aa = document.getElementById('driverAttendanceArea');
  if(!id){ pa.innerHTML=''; aa.innerHTML=''; return; }
  const d = drivers[id];
  if(!d){ pa.innerHTML=''; aa.innerHTML=''; return; }
  pa.innerHTML=`<div class="driver-profile">
    <div class="dp-name">👤 ${esc(d.name)}</div>
    <div class="dp-grid">
      <div class="dp-item">${t('التليفون','Phone')}<b>${esc(d.phone)||'—'}</b></div>
      <div class="dp-item">${t('اللوحة','Plate')}<b>${esc(d.plate)||'—'}</b></div>
      <div class="dp-item">${t('الباص','Bus Sign')}<b>${esc(d.busSign)||'—'}</b></div>
      <div class="dp-item">${t('الرخصة','License')}<b>${esc(d.license)||'—'}</b></div>
    </div>
  </div>`;
  // Attendance for this driver
  const rows = Object.entries(attendance).filter(([,a])=>a.driverId===id).sort((a,b)=>b[1].timestamp-a[1].timestamp);
  if(!rows.length){ aa.innerHTML=`<div class="empty-state">${t('لا يوجد حضور لهذا السائق','No attendance records')}</div>`; return; }
  aa.innerHTML=`<h3 style="color:var(--brown);margin-bottom:0.75rem;font-size:0.95rem;">${t('سجل الحضور','Attendance History')}</h3>
  <div class="table-wrap"><table><thead><tr>
    <th>${t('التاريخ','Date')}</th><th>${t('الباص','Bus')}</th><th>${t('البداية','Start')}</th><th>${t('النهاية','End')}</th>
    <th>${t('النوع','Type')}</th><th>${t('المسار','Route')}</th><th>${t('ملاحظات','Notes')}</th>
  </tr></thead><tbody>
  ${rows.map(([,a])=>`<tr>
    <td>${formatDate(a.date)}</td><td><span class="badge badge-blue">${esc(a.busSign)||'—'}</span> <span style="font-size:0.78rem;color:var(--muted)">${esc(a.plate)}</span></td>
    <td>${startCell(a)}</td>
    <td>${endCell(a)}</td>
    <td>${typeCell(a)}</td>
    <td style="font-size:0.82rem;color:var(--muted)">${esc(a.route)||'—'}</td>
    <td style="font-size:0.82rem;color:var(--muted)">${esc(a.note)||'—'}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

// ===== ATTENDANCE =====
let selectedShift = '', selectedStatus = 'present', editingAttendId = null;

function renderStatusOptions() {
  const icon = { present:'✅', off:'🏖', sick:'🤒' };
  document.getElementById('statusOptions').innerHTML = Object.keys(STATUSES).map(k =>
    `<button type="button" class="shift-opt${selectedStatus===k?' selected':''}" aria-pressed="${selectedStatus===k}" onclick="selectStatus('${k}')">${icon[k]} ${statusLabel(k)}</button>`).join('');
  document.getElementById('shiftGroup').style.display = selectedStatus==='present' ? '' : 'none';
  renderShiftOptions();
}

function renderShiftOptions() {
  const icon = { half:'🌤', normal:'☀️', extra:'🌙' };
  document.getElementById('shiftOptions').innerHTML =
    ['half','normal','extra'].map(c => `<button type="button" class="shift-opt${selectedShift===c?' selected':''}" aria-pressed="${selectedShift===c}" onclick="selectShift('${c}')">${icon[c]} ${shiftLabel(c)} ${formatTime(shiftEnd(c))}</button>`).join('') +
    `<button type="button" class="shift-opt${selectedShift==='custom'?' selected':''}" aria-pressed="${selectedShift==='custom'}" onclick="selectShift('custom')">⏰ ${t('وقت تاني','Custom Time')}</button>`;
  document.getElementById('customTimeRow').style.display = (selectedShift==='custom' && selectedStatus==='present') ? 'block' : 'none';
}

window.selectStatus = function(k) { selectedStatus = k; renderStatusOptions(); }
window.selectShift = function(c) { selectedShift = c; renderShiftOptions(); }

function lastRecord(driverId) {
  let best = null;
  Object.values(attendance).forEach(a => { if (a.driverId===driverId && (!best || a.timestamp > best.timestamp)) best = a; });
  return best;
}

window.fillAttendDriverInfo = function() {
  const id = document.getElementById('attendDriver').value;
  const wrap = document.getElementById('attendDriverInfo');
  const btn = document.getElementById('repeatLastBtn');
  const d = drivers[id];
  if(!id || !d){ wrap.style.display='none'; btn.style.display='none'; return; }
  document.getElementById('adPhone').textContent = d.phone||'—';
  document.getElementById('adPlate').textContent = d.plate||'—';
  document.getElementById('adBus').textContent = d.busSign||'—';
  wrap.style.display='block';
  const last = editingAttendId ? null : lastRecord(id);
  if(last) {
    btn.style.display = '';
    btn.textContent = t('↺ كرر آخر تسجيل','↺ Repeat last entry') + ' (' + formatDate(last.date) + ')';
    const r = document.getElementById('attendRoute');
    if(!r.value.trim()) r.value = last.route || '';   // remember the last route per driver
  } else btn.style.display = 'none';
}

window.repeatLast = function() {
  const last = lastRecord(document.getElementById('attendDriver').value);
  if(!last) return;
  selectedStatus = statusOf(last);
  selectedShift = selectedStatus==='present' ? shiftCode(last.shiftType) : '';
  if(selectedShift==='none') selectedShift = '';
  document.getElementById('attendRoute').value = last.route || '';
  if(selectedShift==='custom') document.getElementById('customTime').value = last.endTime || '';
  renderStatusOptions();
}

function resetAttendForm() {
  editingAttendId = null; selectedShift = ''; selectedStatus = 'present';
  ['attendNote','attendRoute','customTime'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('attendEditBanner').style.display = 'none';
  document.getElementById('attendCancelBtn').style.display = 'none';
  document.getElementById('attendSaveBtn').textContent = t('حفظ الحضور','Save Attendance');
  document.getElementById('attendDriverInfo').style.display = 'none';
  document.getElementById('repeatLastBtn').style.display = 'none';
  renderStatusOptions();
}

window.editAttendance = function(id) {
  const a = attendance[id]; if(!a) return;
  editingAttendId = id;
  const sel = document.getElementById('attendDriver');
  if(![...sel.options].some(o => o.value === a.driverId)) sel.insertAdjacentHTML('beforeend', `<option value="${esc(a.driverId)}">${esc(drvName(a))}</option>`);
  sel.value = a.driverId;
  document.getElementById('attendDate').value = a.date || '';
  document.getElementById('attendRoute').value = a.route || '';
  document.getElementById('attendNote').value = a.note || '';
  selectedStatus = statusOf(a);
  selectedShift = selectedStatus==='present' ? shiftCode(a.shiftType) : '';
  document.getElementById('customTime').value = selectedShift==='custom' ? (a.endTime || '') : '';
  const banner = document.getElementById('attendEditBanner');
  banner.textContent = t('✏️ تعديل تسجيل: ','✏️ Editing record: ') + drvName(a) + ' — ' + formatDate(a.date);
  banner.style.display = 'block';
  const cancel = document.getElementById('attendCancelBtn');
  cancel.textContent = t('إلغاء التعديل','Cancel edit'); cancel.style.display = '';
  document.getElementById('attendSaveBtn').textContent = t('حفظ التعديل','Save changes');
  window.fillAttendDriverInfo();
  renderStatusOptions();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.cancelEditAttendance = function() { resetAttendForm(); }

window.saveAttendance = async function() {
  const driverId = document.getElementById('attendDriver').value;
  const date = document.getElementById('attendDate').value;
  const route = document.getElementById('attendRoute').value.trim();
  const note = document.getElementById('attendNote').value.trim();
  const driver = drivers[driverId];
  if(!driverId || !driver) return alert(t('اختر سائق','Select a driver'));
  if(!date) return alert(t('اختر التاريخ','Select a date'));
  let startTime = '', endTime = '', shiftType = 'none';
  if(selectedStatus === 'present') {
    if(!selectedShift) return alert(t('اختر وقت الانصراف','Select end time'));
    endTime = selectedShift==='custom' ? document.getElementById('customTime').value : shiftEnd(selectedShift);
    if(!endTime) return alert(t('اكتب الوقت','Enter time'));
    startTime = settings.startTime; shiftType = selectedShift;
  }
  if(route.length > 200 || note.length > 200) return alert(t('البيانات طويلة جداً','Input too long'));

  // One record per driver per date
  const dup = Object.entries(attendance).find(([id,a]) => a.driverId===driverId && a.date===date && id!==editingAttendId);
  let targetId = editingAttendId;
  if(dup) {
    if(editingAttendId) return alert(t('السائق مسجل بالفعل في هذا اليوم','This driver already has a record on that date'));
    if(!(await askConfirm(t('السائق مسجل بالفعل في هذا اليوم. تستبدل السجل؟','This driver already has a record for this date. Replace it?')))) return;
    targetId = dup[0];
  }
  const me = auth.currentUser?.uid || '';
  const rec = { driverId, date, status:selectedStatus, startTime, endTime, shiftType,
    driverName:driver.name||'', plate:driver.plate||'', busSign:driver.busSign||'', route, note };
  const op = targetId
    ? update(ref(db,'attendance/'+targetId), { ...rec, updatedBy:me, updatedAt:Date.now() })
    : push(ref(db,'attendance'), { ...rec, timestamp:Date.now(), createdBy:me });
  op.then(() => { toast(t('تم تسجيل الحضور ✓','Attendance saved ✓')); resetAttendForm(); })
    .catch(e => { console.error(e); alert(t('تعذر الحفظ','Could not save')); });
  // Sheets only receives new entries (edits would duplicate the row)
  if(!targetId) sendToSheets({ type:'attendance', date, driverName:rec.driverName, plate:rec.plate, busSign:rec.busSign, endTime,
    shiftType: selectedStatus==='present' ? shiftLabel(shiftType) : statusLabel(selectedStatus), route, note });
}

window.deleteAttend = async function(id) {
  if(!isAdmin) return alert(t('المسح للمسؤول فقط','Only admins can delete'));
  if(!(await askConfirm(t('تأكيد مسح السجل؟','Delete this record?')))) return;
  remove(ref(db,'attendance/'+id)).catch(e => { console.error(e); alert(t('تعذر المسح','Could not delete')); });
}

window.clearFilter = function() { document.getElementById('filterDate').value=''; renderAttendance(); }

function renderAttendance() {
  const filterDate = document.getElementById('filterDate')?.value;
  let rows = Object.entries(attendance).sort((a,b)=>b[1].timestamp-a[1].timestamp);
  if(filterDate) rows=rows.filter(([,a])=>a.date===filterDate);
  const el = document.getElementById('attendanceTable');
  if(!rows.length){ el.innerHTML=`<div class="empty-state">${t('لا يوجد سجلات','No records')}</div>`; return; }
  el.innerHTML=`<table><thead><tr>
    <th>${t('السائق','Driver')}</th><th>${t('اللوحة','Plate')}</th><th>${t('التاريخ','Date')}</th>
    <th>${t('البداية','Start')}</th><th>${t('النهاية','End')}</th>
    <th>${t('النوع','Type')}</th><th>${t('المسار','Route')}</th><th>${t('ملاحظات','Notes')}</th><th></th>
  </tr></thead><tbody>
  ${rows.map(([id,a])=>`<tr>
    <td><b>${esc(drvName(a))}</b></td>
    <td><span class="badge badge-orange">${esc(a.plate)||'—'}</span></td>
    <td>${formatDate(a.date)}</td>
    <td>${startCell(a)}</td>
    <td>${endCell(a)}</td>
    <td>${typeCell(a)}</td>
    <td style="font-size:0.82rem;color:var(--muted)">${esc(a.route)||'—'}</td>
    <td style="font-size:0.82rem;color:var(--muted)">${esc(a.note)||'—'}</td>
    <td style="white-space:nowrap"><button class="btn btn-secondary" style="padding:4px 10px;font-size:0.78rem" onclick="editAttendance('${esc(id)}')">${t('تعديل','Edit')}</button>
    ${isAdmin?`<button class="btn btn-danger" onclick="deleteAttend('${esc(id)}')">${t('مسح','Del')}</button>`:''}</td>
  </tr>`).join('')}</tbody></table>`;
}

// ===== BULK ENTRY =====
const BULK_CHOICES = ['half','normal','extra','off','sick'];
let bulkState = {};   // driverId -> { choice, route }
function bulkLabel(c) { return STATUSES[c] ? statusLabel(c) : `${shiftLabel(c)} ${formatTime(shiftEnd(c))}`; }
function bulkDone(date) { return new Set(Object.values(attendance).filter(a => a.date===date).map(a => a.driverId)); }
function bulkPending(date) {
  const done = bulkDone(date);
  return Object.entries(drivers).filter(([id,d]) => isActive(d) && !done.has(id));
}

function renderBulk() {
  const el = document.getElementById('bulkTable'); if(!el) return;
  const date = document.getElementById('bulkDate').value;
  const done = bulkDone(date);
  const list = Object.entries(drivers).filter(([,d]) => isActive(d));
  if(!list.length){ el.innerHTML = `<div class="empty-state">${t('لا يوجد سائقين','No drivers yet')}</div>`; updateBulkBtn(); return; }
  const opts = sel => `<option value="">—</option>` + BULK_CHOICES.map(c => `<option value="${c}"${sel===c?' selected':''}>${esc(bulkLabel(c))}</option>`).join('');
  el.innerHTML = `
    <div class="form-group" style="max-width:260px;margin-bottom:0.75rem;"><label>${t('تطبيق على الكل','Set all to')}</label>
      <select onchange="bulkAll(this.value);this.value=''">${opts('')}</select></div>
    <table><thead><tr><th>${t('السائق','Driver')}</th><th>${t('الحالة / الوردية','Status / Shift')}</th><th>${t('المسار','Route')}</th></tr></thead><tbody>
    ${list.map(([id,d]) => done.has(id)
      ? `<tr style="opacity:0.6"><td><b>${esc(d.name)}</b></td><td colspan="2"><span class="badge badge-green">${t('مسجل بالفعل','Already recorded')}</span></td></tr>`
      : `<tr><td><b>${esc(d.name)}</b></td>
          <td><select aria-label="${esc(d.name)}" onchange="bulkSet('${esc(id)}','choice',this.value)">${opts(bulkState[id]?.choice)}</select></td>
          <td><input type="text" aria-label="${esc(d.name)} — ${t('المسار','Route')}" maxlength="200" value="${esc(bulkState[id]?.route||'')}" oninput="bulkSet('${esc(id)}','route',this.value)" style="width:100%;min-width:160px;background:var(--cream);border:1.5px solid var(--border);border-radius:8px;padding:6px 10px;font-family:inherit"/></td></tr>`
    ).join('')}</tbody></table>`;
  updateBulkBtn();
}

function bulkCount() {
  const date = document.getElementById('bulkDate').value;
  return bulkPending(date).filter(([id]) => bulkState[id]?.choice).length;
}
function updateBulkBtn() {
  const b = document.getElementById('bulkSaveBtn'); if(!b) return;
  const n = bulkCount();
  b.textContent = `${t('💾 حفظ الكل','💾 Save all')} (${n})`;
  b.disabled = n === 0;
}
window.bulkSet = function(id, key, val) {
  bulkState[id] = { ...(bulkState[id]||{}), [key]: val };
  if(key === 'choice') updateBulkBtn();
}
window.bulkAll = function(choice) {
  if(!choice) return;
  const date = document.getElementById('bulkDate').value;
  bulkPending(date).forEach(([id]) => { bulkState[id] = { ...(bulkState[id]||{}), choice }; });
  renderBulk();
}

window.saveBulk = function() {
  const date = document.getElementById('bulkDate').value;
  if(!date) return alert(t('اختر التاريخ','Select a date'));
  const me = auth.currentUser?.uid || '';
  const updates = {}, synced = [], savedIds = [];
  let n = 0;
  const now = Date.now();
  bulkPending(date).forEach(([id,d]) => {
    const s = bulkState[id]; if(!s?.choice) return;
    const present = !STATUSES[s.choice];
    const status = present ? 'present' : s.choice;
    const rec = {
      driverId:id, date, status,
      startTime: present ? settings.startTime : '',
      endTime: present ? shiftEnd(s.choice) : '',
      shiftType: present ? s.choice : 'none',
      driverName:d.name||'', plate:d.plate||'', busSign:d.busSign||'',
      route:(s.route||'').trim().substring(0,200), note:'', timestamp: now + n, createdBy: me
    };
    updates['attendance/' + push(ref(db,'attendance')).key] = rec;
    synced.push({ type:'attendance', date, driverName:rec.driverName, plate:rec.plate, busSign:rec.busSign, endTime:rec.endTime,
      shiftType: present ? shiftLabel(s.choice) : statusLabel(status), route:rec.route, note:'' });
    savedIds.push(id); n++;
  });
  if(!n) return;
  const btn = document.getElementById('bulkSaveBtn'); btn.disabled = true;
  update(ref(db), updates)
    .then(() => { savedIds.forEach(id => delete bulkState[id]); synced.forEach(sendToSheets); toast(t(`تم تسجيل ${n} سائق ✓`,`${n} drivers saved ✓`)); })
    .catch(e => { console.error(e); alert(t('تعذر الحفظ','Could not save')); })
    .finally(renderBulk);
}

// ===== SETTINGS (admin) =====
function fillSettingsForm() {
  const map = { setStart:'startTime', setHalf:'halfEnd', setNormal:'normalEnd', setExtra:'extraEnd' };
  Object.entries(map).forEach(([id,k]) => { const el = document.getElementById(id); if(el) el.value = settings[k]; });
}
window.saveSettings = function() {
  if(!isAdmin) return alert(t('للمسؤول فقط','Admins only'));
  const next = {
    startTime: document.getElementById('setStart').value, halfEnd: document.getElementById('setHalf').value,
    normalEnd: document.getElementById('setNormal').value, extraEnd: document.getElementById('setExtra').value
  };
  if(Object.values(next).some(v => !/^\d{2}:\d{2}$/.test(v))) return alert(t('اكتب كل الأوقات','Fill in every time'));
  update(ref(db,'settings'), next)
    .then(() => toast(t('تم حفظ الإعدادات ✓','Settings saved ✓')))
    .catch(e => { console.error(e); alert(t('تعذر الحفظ','Could not save')); });
}

// ===== DASHBOARD =====
function renderDashboard() {
  renderDashboardExtras();
  const today = new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});
  const todayA = Object.values(attendance).filter(a=>a.date===today);
  const presentA = todayA.filter(a=>statusOf(a)==='present');
  document.getElementById('statsRow').innerHTML=`
    <div class="stat-card"><div class="stat-num">${Object.values(drivers).filter(isActive).length}</div><div class="stat-label">${t('السائقين النشطين','Active Drivers')}</div></div>
    <div class="stat-card"><div class="stat-num">${presentA.length}</div><div class="stat-label">${t('حضور اليوم','Today Attendance')}</div></div>
    <div class="stat-card"><div class="stat-num">${todayA.length-presentA.length}</div><div class="stat-label">${t('إجازة / مرضي اليوم','Off / Sick Today')}</div></div>
    <div class="stat-card"><div class="stat-num">${presentA.filter(a=>shiftCode(a.shiftType)==='extra').length}</div><div class="stat-label">${t('شغل إضافي اليوم','Extra Shifts Today')}</div></div>
    <div class="stat-card"><div class="stat-num">${presentA.filter(a=>shiftCode(a.shiftType)==='half').length}</div><div class="stat-label">${t('نص يوم اليوم','Half Days Today')}</div></div>`;
  const el = document.getElementById('todayTable');
  if(!todayA.length){ el.innerHTML=`<div class="empty-state">${t('لا يوجد حضور اليوم','No attendance today')}</div>`; return; }
  el.innerHTML=`<table><thead><tr>
    <th>${t('السائق','Driver')}</th><th>${t('اللوحة','Plate')}</th><th>${t('الباص','Bus')}</th>
    <th>${t('البداية','Start')}</th><th>${t('النهاية','End')}</th>
    <th>${t('النوع','Type')}</th><th>${t('المسار','Route')}</th>
  </tr></thead><tbody>
  ${[...todayA].reverse().map(a=>`<tr>
    <td><b>${esc(drvName(a))}</b></td>
    <td><span class="badge badge-orange">${esc(a.plate)||'—'}</span></td>
    <td><span class="badge badge-blue">${esc(a.busSign)||'—'}</span></td>
    <td>${startCell(a)}</td>
    <td>${endCell(a)}</td>
    <td>${typeCell(a)}</td>
    <td style="font-size:0.82rem;color:var(--muted)">${esc(a.route)||'—'}</td>
  </tr>`).join('')}</tbody></table>`;
}

// ===== DATE / HOURS HELPERS =====
function todayStr() { return new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'}); }
// Worked hours for a present record (end earlier than start = overnight)

// ===== REPORTS =====
window.repPreset = function(p) {
  const today = todayStr();
  let from = '', to = '';
  if(p==='week') { from = weekStart(today); to = addDays(from, 6); }
  else if(p==='month') [from, to] = monthRange(today, 0);
  else if(p==='lastMonth') [from, to] = monthRange(today, -1);
  document.getElementById('repFrom').value = from;
  document.getElementById('repTo').value = to;
  renderReports();
}

function reportRecords() {
  const from = document.getElementById('repFrom').value, to = document.getElementById('repTo').value;
  const driverId = document.getElementById('reportDriverSelect').value;
  return Object.values(attendance)
    .filter(a => (!from || a.date >= from) && (!to || a.date <= to) && (!driverId || a.driverId === driverId))
    .sort((a,b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(drvName(a)).localeCompare(String(drvName(b)))));
}


function periodLabel() {
  const from = document.getElementById('repFrom').value, to = document.getElementById('repTo').value;
  if(!from && !to) return t('كل الفترة','All time');
  return `${from ? formatDate(from) : '…'} → ${to ? formatDate(to) : '…'}`;
}

function renderReports() {
  const el = document.getElementById('allReportsTable');
  if(!el) return;
  const records = reportRecords();
  const rows = reportSummary(records);
  document.getElementById('repTitle').textContent = `📊 ${t('ملخص السائقين','Drivers Summary')} — ${periodLabel()}`;
  if(!rows.length) {
    el.innerHTML = `<div class="empty-state">${t('لا يوجد بيانات في هذه الفترة','No data in this period')}</div>`;
    document.getElementById('reportContent').innerHTML = '';
    return;
  }
  const tot = rows.reduce((s,r) => { Object.keys(s).forEach(k => s[k] += r[k]); return s; }, { days:0, half:0, normal:0, extra:0, custom:0, off:0, sick:0, hours:0 });
  const cell = v => v || '—';
  el.innerHTML = `<table><thead><tr>
    <th>${t('السائق','Driver')}</th><th>${t('أيام الشغل','Days')}</th>
    <th>${t('نص يوم','Half Day')}</th><th>${t('عادي','Normal')}</th><th>${t('إضافي','Extra')}</th><th>${t('وقت محدد','Custom')}</th>
    <th>${t('إجازة','Off')}</th><th>${t('مرضي','Sick')}</th><th>${t('الساعات','Hours')}</th>
  </tr></thead><tbody>
  ${rows.map(r => `<tr>
    <td><b>${esc(r.name)}</b></td><td><span class="badge badge-blue">${r.days}</span></td>
    <td>${cell(r.half)}</td><td>${cell(r.normal)}</td>
    <td>${r.extra ? `<b style="color:var(--red)">${r.extra}</b>` : '—'}</td><td>${cell(r.custom)}</td>
    <td>${cell(r.off)}</td><td>${cell(r.sick)}</td><td><b>${fmtHours(r.hours)}</b></td>
  </tr>`).join('')}
  <tr style="font-weight:700;background:var(--orange-pale)"><td>${t('الإجمالي','Total')}</td><td>${tot.days}</td><td>${tot.half}</td><td>${tot.normal}</td><td>${tot.extra}</td><td>${tot.custom}</td><td>${tot.off}</td><td>${tot.sick}</td><td>${fmtHours(tot.hours)}</td></tr>
  </tbody></table>`;

  document.getElementById('reportContent').innerHTML = `<table><thead><tr>
    <th>${t('التاريخ','Date')}</th><th>${t('السائق','Driver')}</th><th>${t('البداية','Start')}</th><th>${t('النهاية','End')}</th>
    <th>${t('الساعات','Hours')}</th><th>${t('النوع','Type')}</th><th>${t('المسار','Route')}</th><th>${t('ملاحظات','Notes')}</th>
  </tr></thead><tbody>
  ${records.map(a => `<tr>
    <td>${formatDate(a.date)}</td><td><b>${esc(drvName(a))}</b></td>
    <td>${startCell(a)}</td><td>${endCell(a)}</td>
    <td>${statusOf(a)==='present' ? fmtHours(hoursOf(a)) : '—'}</td><td>${typeCell(a)}</td>
    <td style="font-size:0.82rem;color:var(--muted)">${esc(a.route)||'—'}</td>
    <td style="font-size:0.82rem;color:var(--muted)">${esc(a.note)||'—'}</td>
  </tr>`).join('')}</tbody></table>`;
}
window.renderReports = renderReports;

// ===== EXPORT (CSV opens directly in Excel; BOM keeps Arabic readable) =====
function downloadCsv(name, rows) {
  const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type:'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportName(kind) {
  const from = document.getElementById('repFrom').value || 'all', to = document.getElementById('repTo').value || 'all';
  return `travelband-${kind}_${from}_${to}.csv`;
}
window.exportSummaryCsv = function() {
  const rows = reportSummary(reportRecords());
  if(!rows.length) return alert(t('لا يوجد بيانات','No data'));
  downloadCsv(exportName('summary'), [
    ['Driver','Days worked','Half day','Normal','Extra','Custom','Day off','Sick','Hours'],
    ...rows.map(r => [r.name, r.days, r.half, r.normal, r.extra, r.custom, r.off, r.sick, fmtHours(r.hours)])
  ]);
}
window.exportDetailCsv = function() {
  const records = reportRecords();
  if(!records.length) return alert(t('لا يوجد بيانات','No data'));
  downloadCsv(exportName('details'), [
    ['Date','Driver','Plate','Bus','Status','Shift','Start','End','Hours','Route','Notes'],
    ...records.map(a => { const st = statusOf(a); return [a.date, drvName(a), a.plate, a.busSign, STATUSES[st].en,
      st==='present' ? SHIFTS[shiftCode(a.shiftType)].en : '', st==='present' ? (a.startTime||settings.startTime) : '', a.endTime||'',
      st==='present' ? fmtHours(hoursOf(a)) : '', a.route, a.note]; })
  ]);
}

// ===== DASHBOARD EXTRAS =====
function renderDashboardExtras() {
  const chart = document.getElementById('weekChart');
  if(!chart) return;
  const today = todayStr();
  const days = Array.from({length:7}, (_,i) => addDays(today, i-6));
  const counts = days.map(d => Object.values(attendance).filter(a => a.date===d && statusOf(a)==='present').length);
  const max = Math.max(1, ...counts);
  const W = 700, H = 190, bw = 56, gap = (W - bw*7) / 8;
  chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('الحضور آخر 7 أيام','Attendance, last 7 days'))}" style="width:100%;height:auto;display:block">
    ${counts.map((c,i) => {
      const x = gap + i*(bw+gap), h = Math.round((c/max)*(H-60)), y = H-30-h;
      return `<g><title>${esc(formatDate(days[i]))}: ${c}</title>
        <rect x="${x}" y="${y}" width="${bw}" height="${Math.max(h,2)}" rx="5" fill="var(--orange)"/>
        <text x="${x+bw/2}" y="${y-6}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--brown)">${c}</text>
        <text x="${x+bw/2}" y="${H-10}" text-anchor="middle" font-size="12" fill="var(--muted)">${esc(days[i].slice(8,10)+'/'+days[i].slice(5,7))}</text></g>`;
    }).join('')}
    <line x1="0" y1="${H-30}" x2="${W}" y2="${H-30}" stroke="var(--border)"/></svg>`;

  const recordedToday = new Set(Object.values(attendance).filter(a => a.date===today).map(a => a.driverId));
  const missing = Object.entries(drivers).filter(([id,d]) => isActive(d) && !recordedToday.has(id));
  document.getElementById('missingToday').innerHTML = missing.length
    ? missing.map(([,d]) => `<span class="badge badge-amber" style="margin:3px">${esc(d.name)}</span>`).join('')
    : `<div class="empty-state" style="padding:1rem">${t('كل السائقين مسجلين اليوم ✓','All active drivers are recorded today ✓')}</div>`;

  const [mFrom, mTo] = monthRange(today, 0);
  const extra = {};
  Object.values(attendance).forEach(a => {
    if(a.date>=mFrom && a.date<=mTo && statusOf(a)==='present' && shiftCode(a.shiftType)==='extra') extra[drvName(a)] = (extra[drvName(a)]||0)+1;
  });
  const top = Object.entries(extra).sort((a,b) => b[1]-a[1]).slice(0,5);
  document.getElementById('topExtra').innerHTML = top.length
    ? `<table><tbody>${top.map(([n,c]) => `<tr><td><b>${esc(n)}</b></td><td style="text-align:end"><span class="badge badge-red">${c}</span></td></tr>`).join('')}</tbody></table>`
    : `<div class="empty-state" style="padding:1rem">${t('لا يوجد شغل إضافي هذا الشهر','No extra shifts this month')}</div>`;
}

// ===== HELPERS =====
function shiftBadge(s){ return {half:'badge-amber',normal:'badge-blue',extra:'badge-red',custom:'badge-green',none:'badge-blue'}[shiftCode(s)]; }

// ===== WORK ORDERS (photo of handwritten sheet -> AI reads it) =====
let woImage = null; // base64 JPEG (no prefix)

// Calls the Apps Script backend and reads its JSON reply
async function callScript(payload) {
  const idToken = await auth.currentUser?.getIdToken();
  const res = await fetch(SHEETS_URL, {
    method:'POST',
    headers:{'Content-Type':'text/plain;charset=utf-8'},
    body: JSON.stringify({ ...payload, idToken })
  });
  const out = await res.json();
  if(!out.ok) throw new Error(out.error || 'request failed');
  return out;
}

// Downscale the phone photo so it uploads fast but stays readable
function resizeToJpegBase64(file, maxSide = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

function woStatus(msg) { document.getElementById('woStatus').textContent = msg || ''; }

window.woPhotoChosen = async function(input) {
  const file = input.files && input.files[0];
  if(!file) return;
  try {
    const dataUrl = await resizeToJpegBase64(file);
    woImage = dataUrl.split(',')[1];
    const prev = document.getElementById('woPreview');
    prev.src = dataUrl; prev.style.display = 'block';
    document.getElementById('woReadBtn').style.display = '';
    document.getElementById('woForm').style.display = 'none';
    woStatus(t('اضغط "اقرأ البيانات"','Press "Read data"'));
  } catch(e) { woImage = null; alert(t('تعذر فتح الصورة','Could not open the image')); }
  input.value = '';
}


window.woRead = async function() {
  if(!woImage) return;
  const btn = document.getElementById('woReadBtn');
  btn.disabled = true; woStatus(t('⏳ جاري قراءة الورقة...','⏳ Reading the sheet...'));
  try {
    const r = await callScript({ type:'extractSheet', image: woImage });
    document.getElementById('woName').value = r.name || '';
    document.getElementById('woDate').value = r.date || '';
    document.getElementById('woOrder').value = r.workOrder || '';
    // Pre-select the driver whose name matches the name on the sheet
    const n = normName(r.name);
    const sel = document.getElementById('woDriver');
    sel.value = '';
    if(n) { const hit = Object.entries(drivers).find(([,d]) => { const dn = normName(d.name); return dn && (dn === n || dn.includes(n) || n.includes(dn)); }); if(hit) sel.value = hit[0]; }
    document.getElementById('woForm').style.display = 'block';
    woStatus(t('تمت القراءة — راجع البيانات واختر السائق ثم احفظ.','Done — check the data, choose the driver, then save.'));
  } catch(e) {
    console.error(e);
    woStatus(t('❌ تعذرت القراءة: ','❌ Could not read: ') + e.message);
  } finally { btn.disabled = false; }
}

window.woSave = async function() {
  const driverId = document.getElementById('woDriver').value;
  const sheetName = document.getElementById('woName').value.trim();
  const date = document.getElementById('woDate').value;
  const workOrder = document.getElementById('woOrder').value.trim();
  if(!driverId || !drivers[driverId]) return alert(t('اختر السائق','Select a driver'));
  if(!date) return alert(t('اختر التاريخ','Select a date'));
  if(!workOrder) return alert(t('اكتب أمر الشغل','Enter the work order'));
  if(!woImage) return alert(t('لا توجد صورة','No photo'));
  const driverName = drivers[driverId].name;
  const btn = document.getElementById('woSaveBtn');
  btn.disabled = true; woStatus(t('⏳ جاري الحفظ ورفع الصورة...','⏳ Saving and uploading photo...'));
  try {
    // 1) photo -> driver's Drive folder, row -> driver's own sheet tab
    const r = await callScript({ type:'saveWorkOrder', driverId, driverName, sheetName, date, workOrder, image: woImage });
    // 2) record in the app database
    await push(ref(db,'workOrders'), { driverId, driverName, sheetName, date, workOrder, photoUrl: r.photoUrl, timestamp: Date.now() });
    woImage = null;
    document.getElementById('woPreview').style.display = 'none';
    document.getElementById('woReadBtn').style.display = 'none';
    document.getElementById('woForm').style.display = 'none';
    woStatus('');
    toast(t('تم حفظ أمر الشغل ✓','Work order saved ✓'));
  } catch(e) {
    console.error(e);
    woStatus(t('❌ تعذر الحفظ: ','❌ Could not save: ') + e.message);
  } finally { btn.disabled = false; }
}

window.deleteWorkOrder = async function(id) {
  if(!isAdmin) return alert(t('المسح للمسؤول فقط','Only admins can delete'));
  if(!(await askConfirm(t('تأكيد مسح السجل؟ (الصف في الشيت والصورة يفضلوا زي ما هم)','Delete this record? (the sheet row and photo are kept)')))) return;
  remove(ref(db,'workOrders/'+id)).catch(e => { console.error(e); alert(t('تعذر المسح','Could not delete')); });
}

function renderWorkOrders() {
  const el = document.getElementById('woTable');
  if(!el) return;
  const fd = document.getElementById('woFilterDriver')?.value;
  let rows = Object.entries(workOrders).sort((a,b)=>b[1].timestamp-a[1].timestamp);
  if(fd) rows = rows.filter(([,w])=>w.driverId===fd);
  if(!rows.length){ el.innerHTML=`<div class="empty-state">${t('لا يوجد أوامر شغل','No work orders')}</div>`; return; }
  el.innerHTML=`<table><thead><tr>
    <th>${t('السائق','Driver')}</th><th>${t('التاريخ','Date')}</th><th>${t('أمر الشغل','Work order')}</th>
    <th>${t('الاسم في الورقة','Name on sheet')}</th><th>${t('الصورة','Photo')}</th><th></th>
  </tr></thead><tbody>
  ${rows.map(([id,w])=>`<tr>
    <td><b>${esc(drvName(w))}</b></td><td>${formatDate(w.date)}</td>
    <td>${esc(w.workOrder)}</td><td style="font-size:0.82rem;color:var(--muted)">${esc(w.sheetName)||'—'}</td>
    <td>${/^https:\/\//.test(w.photoUrl||'')?`<a href="${esc(w.photoUrl)}" target="_blank" rel="noopener">${t('فتح','Open')}</a>`:'—'}</td>
    <td>${isAdmin?`<button class="btn btn-danger" onclick="deleteWorkOrder('${esc(id)}')">${t('مسح','Del')}</button>`:''}</td>
  </tr>`).join('')}</tbody></table>`;
}

// Associate every form label with its control (screen readers / tap-to-focus)
document.querySelectorAll('.form-group').forEach(g => {
  const l = g.querySelector(':scope > label'), c = g.querySelector('input,select,textarea');
  if (l && c && c.id && !l.htmlFor) l.htmlFor = c.id;
});
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
if (savedLang === 'en') applyLang('en');

function renderAll(){ renderDashboard(); renderAttendance(); renderAllDrivers(); renderWorkOrders(); renderStatusOptions(); renderBulk(); }
