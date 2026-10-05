# Travel Band — Full Project Plan

Driver attendance and shift tracking for a tourism transport company in Cairo.
Today it is a single `index.html` (Arabic/English, RTL/LTR) backed by Firebase Realtime Database, with a Google Apps Script webhook that mirrors records to Google Sheets.

---

## 1. Current State (from the code)

| Area | What exists |
|---|---|
| Pages | Dashboard, Drivers, Attendance, Reports |
| Data | `drivers` (name, phone, plate, busSign) and `attendance` (driver, date, start 07:30 fixed, end time, shift type, route, note) in Firebase RTDB |
| Shifts | Half day 12:30, Normal 14:00, Extra 21:00, Custom time |
| i18n | AR/EN toggle via `data-ar` / `data-en` attributes and a `t()` helper |
| Sync | Fire-and-forget POST to Google Apps Script (`no-cors`) |
| Access | Client-side PIN lock screen; separate client-side PIN to delete records |

### Known problems (to fix first)

1. **No real security.** Both PINs are hardcoded in client JS, so anyone can read them via view-source. The Firebase config is public (normal), but with no Auth and no Security Rules, the database is likely world-readable/writable.
2. **XSS.** Driver names, routes and notes are interpolated into `innerHTML` unescaped. A malicious name like `<img onerror=...>` would run for every viewer.
3. **Data integrity.** Duplicate attendance for the same driver and date is allowed. Shift type is stored as a translated label (so records saved in AR vs EN differ) instead of a stable code. Start time is hardcoded to 7:30 in the UI.
4. **Language switch is partial.** `toggleLang` only retranslates some tag types; the page flips to LTR but some static text stays in Arabic.
5. **Sheets sync is silent.** `no-cors` means failures are invisible. Deletes and edits are never synced.
6. **Missing features.** No edit for drivers/attendance, no export, no date-range reports, no license field entry (the profile view reads `license` but the form never saves it).
7. **Maintainability.** ~700 lines of HTML, CSS and JS in one file, no tests, no README.

---

## 2. Goals

- **G1:** Safe enough to hold real staff data (phones, plates).
- **G2:** Fast daily workflow: record a driver's day in under 15 seconds, on a phone.
- **G3:** Reliable reporting for payroll (days worked, half days, extras per period).
- **G4:** Maintainable codebase that one person can extend.

**Non-goals (for now):** GPS tracking, passenger booking, customer-facing site, native apps.

---

## 3. Roadmap

### Phase 0 — Housekeeping (½ day)
- [ ] Add `README.md` (purpose, setup, deploy, data model).
- [ ] Add `.gitignore`, `LICENSE` (or mark private).
- [ ] Enable GitHub Pages or Firebase Hosting for deployment.
- [ ] Tag current version `v0.1`.

### Phase 1 — Security and correctness (2–3 days) **← do first**
- [x] Add **Firebase Authentication** (email/password or Google) for staff; remove the PIN lock screen.
- [x] Write **Realtime Database Security Rules**: only authenticated users read/write; validate field types and lengths; only an `admin` role can delete.
- [x] Replace the delete PIN with the admin role check.
- [ ] Rotate the Apps Script URL/secret; add a shared secret check inside the script.
- [x] Escape all user content (an `esc()` helper, or build DOM with `textContent`).
- [ ] Restrict the Firebase API key by HTTP referrer in Google Cloud console.
- [x] Store `shiftType` as a code (`half`, `normal`, `extra`, `custom`) and translate only at render time; migrate existing records.
- [x] Block duplicate attendance (same `driverId` + `date`) with a confirm-to-overwrite.

### Phase 2 — Core features (1 week)
- [ ] Edit driver (including license, status active/inactive instead of hard delete).
- [ ] Edit attendance record (with edited-by and edited-at audit fields).
- [ ] Configurable shift presets and default start time (settings page or Firebase node).
- [ ] Attendance form: remember last route per driver; "same as yesterday" quick-fill.
- [ ] Bulk entry: one screen listing all active drivers with tap-to-mark shifts for a date.
- [ ] Absence / day-off / sick statuses (currently only presence is recorded).
- [ ] Proper input validation: Egyptian mobile (`01[0125]xxxxxxxx`), plate format, required fields.

### Phase 3 — Reports and export (1 week)
- [ ] Date-range filter (week / month / custom) on reports.
- [ ] Hours worked per record and per period (start → end).
- [ ] Monthly payroll sheet per driver: days, half days, extra shifts, total hours.
- [ ] Export to CSV / Excel and print-friendly PDF.
- [ ] Dashboard: week trend chart, most extra shifts, drivers missing today.
- [ ] Make Google Sheets sync reliable (queue + retry, or replace with a Cloud Function triggered on write).

### Phase 4 — UX and quality (1 week)
- [ ] Mobile-first pass: bigger tap targets, sticky save button, bottom nav.
- [ ] Complete i18n: move strings into one `i18n` dictionary; fix mixed-language leftovers; persist language choice.
- [ ] Loading, empty and error states; offline indicator (RTDB supports offline cache).
- [ ] Replace `alert`/`prompt` with in-app dialogs.
- [ ] Accessibility: labels, focus states, contrast check, keyboard navigation.
- [ ] Installable **PWA** (manifest + service worker) so drivers' supervisors can add it to the home screen.

### Phase 5 — Engineering foundation (parallel, ongoing)
- [ ] Split into `index.html`, `styles.css`, `js/` modules (`firebase.js`, `i18n.js`, `drivers.js`, `attendance.js`, `reports.js`, `utils.js`).
- [ ] Optional: move to Vite for dev server and build; keep it dependency-light.
- [ ] Unit tests for helpers (date/time formatting, shift mapping, report aggregation) and Firebase emulator tests for Security Rules.
- [ ] GitHub Actions: lint (ESLint + Prettier) and rules tests on every PR.
- [ ] Automated daily database backup export (Cloud Scheduler or scripted).

### Phase 6 — Future ideas (backlog)
- Vehicle records: insurance, license expiry, maintenance reminders.
- Driver license expiry alerts.
- Trip/program assignment linked to bookings.
- WhatsApp daily summary to the manager.
- Multi-branch / multi-company support.
- Role levels: admin, supervisor (entry only), viewer.

---

## 4. Target Data Model

```
users/{uid}                 { role: "admin" | "supervisor" | "viewer" }
drivers/{id}                { name, phone, plate, busSign, license, licenseExpiry,
                              status: "active" | "inactive", createdAt }
attendance/{id}             { driverId, date: "YYYY-MM-DD",
                              status: "present" | "off" | "sick",
                              startTime, endTime, shiftType: "half" | "normal" | "extra" | "custom",
                              route, note, createdBy, createdAt, updatedBy, updatedAt }
settings/shifts/{code}      { endTime, labelAr, labelEn }
settings/defaults           { startTime: "07:30" }
```

Denormalized `driverName`, `plate`, `busSign` on attendance can stay for history (so a later plate change doesn't rewrite old records), but `driverId` is the source of truth.

Index in rules: `attendance` on `date`, and on `driverId`, to avoid downloading everything as records grow. Move from loading the whole `attendance` node to querying by date range.

---

## 5. Milestones

| Milestone | Content | Target |
|---|---|---|
| M0 | Housekeeping, README, hosting | Week 1 |
| M1 | Auth, rules, XSS fix, data cleanup | Week 1–2 |
| M2 | Edit/bulk entry/statuses | Week 3 |
| M3 | Reports, export, payroll sheet | Week 4 |
| M4 | Mobile/PWA, full i18n, polish | Week 5 |
| M5 | Modular code, tests, CI, backups | Week 6 |

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Data exposed while rules are open | Do Phase 1 before anything else; lock rules today as a stopgap |
| Migrating label-based shift types | One-off script mapping Arabic/English labels to codes; back up the DB first |
| Staff resistance to login | Google sign-in, long sessions, simple role setup |
| Sheets script breaking silently | Retry queue + visible sync status, or drop Sheets for built-in export |
| Single-developer bus factor | README, modular code, tests |

---

## 7. Definition of Done (per feature)

- Works in Arabic (RTL) and English (LTR) on a phone-width screen.
- Inputs validated and escaped; Security Rules cover the new data.
- No console errors; manually tested against a real Firebase test project.
- README / data model updated.

---

## 8. Immediate Next Steps (this week)

1. Lock Firebase Security Rules to authenticated users (stopgap), then enable Auth.
2. Escape `innerHTML` content.
3. Switch `shiftType` to codes and migrate existing data.
4. Add README and deploy via GitHub Pages / Firebase Hosting.
5. Start the bulk-entry screen, the biggest daily time-saver.
