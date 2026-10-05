# Work-Order Photo Scan — Setup

Flow: photo of the handwritten sheet → Claude reads **name / date / work order** → you review and fix →
saved to the app, the photo goes to the driver's own Drive folder, and a row is added to the driver's own tab in the Google Sheet.

```
browser (resized JPEG) ──► Apps Script web app ──► Claude vision (key stays in Script Properties)
                                   │
                                   ├─► Drive/Travel Band Work Orders/<driver>/date_order.jpg
                                   └─► Sheet tab "<driver>"  (Date | Name on sheet | Work order | Photo | Saved at | Saved by)
browser ──► Realtime Database  workOrders/{id}   (what the app lists and filters)
```

No Firebase paid plan is needed; everything server-side runs in Apps Script.

## 1. Update the Apps Script
1. Open the existing Apps Script project (the one behind `SHEETS_URL`).
2. Replace its code with `apps-script/Code.gs`.
3. Move your **old** `doPost` logic (types `driver` and `attendance`) into `handleLegacy_(data, auth)` at the top of the file, adapting `e.postData.contents` to the already-parsed `data` object.
4. Project Settings → **Script properties**, add:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com (set a monthly spend limit there)
   - `FIREBASE_DB_URL` — `https://abdelrahman-transport-default-rtdb.europe-west1.firebasedatabase.app`
   - `SHEET_ID` — optional; only if the script isn't bound to the spreadsheet
5. **Deploy → Manage deployments → Edit → New version** (keeps the same URL). Accept the Drive / Sheets / external-request permissions.

## 2. Publish the rules
`database.rules.json` now includes `workOrders`. Paste it into Realtime Database → Rules → Publish.

## 3. Use it
1. Log in → **أوامر الشغل / Work Orders**.
2. Tap **Take / choose photo** (opens the phone camera), then **Read data**.
3. Check name, date and work order (Arabic handwriting can be misread); pick the driver; **Save**.

## Notes and limits
- The AI is told to return `null` for anything unreadable instead of guessing; empty fields mean "fill in by hand".
- Every call is authenticated: the script verifies the caller's Firebase token and role before using the AI key.
- Photos are private to the Google account that owns the script. The "Open" link works for people signed in to that account or given access to the Drive folder — share the folder if drivers' supervisors need it.
- Deleting a record in the app (admin) does **not** remove the sheet row or the photo.
- Each driver's Drive folder and sheet tab are matched by the driver's ID: renaming a driver renames them, and two drivers with the same name get a short ID suffix. Reports and tables always show the driver's current name; records keep the plate and bus used on that day.
- Cost: roughly one image-vision request per scan.
