# Travel Band — Driver Attendance & Work Orders

A web app for a tourism transport company in Cairo. Staff log in, record each driver's daily attendance and shift, scan handwritten work sheets with a phone camera, and view reports. The interface is Arabic (RTL) by default with an English toggle.

## Features
- **PIN login** (6+ digits). Two shared accounts, admin and staff; the PIN is checked by Firebase Authentication, not in the page. Only admins can delete.
- **Drivers**: name, phone, plate, bus sign.
- **Attendance**: date, route, shift (half day 12:30, normal 14:00, extra 21:00, custom), notes. One record per driver per day.
- **Work Orders**: photograph a handwritten Arabic sheet; Claude reads name, date and work order; you review and save. The photo goes to the driver's Drive folder and a row to the driver's own Google Sheet tab.
- **Dashboard and reports**: today's attendance, 7-day chart, drivers not recorded today, top extra shifts; reports with date range, hours worked, per-driver summary, Excel (CSV) export and print/PDF.
- **Google Sheets sync** of drivers and attendance.

## How it's built
| Part | Tech |
|---|---|
| Frontend | Single `index.html` (plain HTML/CSS/JS, no build step) |
| Auth and data | Firebase Authentication + Realtime Database |
| Backend | Google Apps Script web app (`apps-script/Code.gs`): AI reading, Drive, Sheets |
| AI | Anthropic Claude vision, called from Apps Script (the key never reaches the browser) |

```
index.html            page markup
styles.css            styles
js/app.js             app logic (Firebase, rendering, forms)
js/utils.js           pure helpers (unit-tested)
sw.js, manifest.webmanifest, icons/   installable app (PWA)
database.rules.json   Realtime Database security rules
apps-script/          Google Apps Script backend (Code.gs, appsscript.json)
tests/                unit tests and Security Rules tests
docs/                 setup guides
PLAN.md               roadmap
```

## Data model (Realtime Database)
```
users/{uid}          { role: "admin" | "supervisor" }   (set manually in the console)
drivers/{id}         { name, phone, plate, busSign, license? }
attendance/{id}      { driverId, date, startTime, endTime, shiftType: half|normal|extra|custom,
                       driverName, plate, busSign, route, note, timestamp }
workOrders/{id}      { driverId, driverName, sheetName, date, workOrder, photoUrl, timestamp }
```

## Setup
Do these before the first deploy; otherwise nobody can log in.

1. **Firebase**: enable Email/Password sign-in, create the two PIN accounts (`admin@travelband.app`, `staff@travelband.app`, password = PIN), add `users/<uid>/role`, publish `database.rules.json`, add your site's domain under Authentication → Authorized domains. Details: [docs/PHASE1-SETUP.md](docs/PHASE1-SETUP.md).
2. **Apps Script**: paste `apps-script/Code.gs`, set the script properties (`ANTHROPIC_API_KEY`, `FIREBASE_DB_URL`, optional `SHEET_ID`), deploy as a web app, and put the deployment URL in `SHEETS_URL` in `index.html`. Details: [docs/WORK-ORDER-SCAN-SETUP.md](docs/WORK-ORDER-SCAN-SETUP.md).
3. **Restrict the Firebase API key** to your domain in Google Cloud Console.
4. **Host** the repo root as a static site (GitHub Pages: Settings → Pages → deploy from `main`).

- **Installable (PWA)** on phones, works as a home-screen app; mobile bottom navigation; in-app dialogs; offline banner.

## Run locally
No build step. Serve the folder over HTTP (Firebase Auth does not work from `file://`):

```bash
npx serve .
```

Open the printed `http://localhost:...` address, and add `localhost` to Firebase Authorized domains if it isn't there.

## Development
```bash
npm install
npm run lint        # ESLint
npm test            # unit tests (node --test, no extra tools)
npm run test:rules  # Security Rules tests; needs Java (runs in CI automatically)
```
GitHub Actions (`.github/workflows/ci.yml`) runs lint, unit tests and the rules tests on every push and pull request.

## Backups
`apps-script/Code.gs` has `dailyBackup()`, which saves the whole database as a JSON file in your Drive folder "Travel Band Backups" every night and keeps the last 30. To turn it on: paste the updated `Code.gs` and `appsscript.json`, then run `installBackupTrigger` once from the Apps Script editor and accept the permissions. The backups stay inside your Google account.

## Security notes
- Never put the Anthropic key or any secret in `index.html`; the Firebase web config is public by design and is protected by the security rules and key restrictions.
- Use PINs of 8+ digits and keep the admin PIN private; accounts need a role to read any data, and Firebase rate-limits wrong guesses.
- Apps Script verifies the caller's Firebase token and role before doing anything.

## Roadmap
See [PLAN.md](PLAN.md). Next: edit drivers and attendance, bulk entry, date-range reports and export.
