# Setup (personal use — one account)

The app has a single account for you. Your **PIN is that account's password**, and Firebase checks it on its servers.
Do these once. Nothing else needs a login or a role.

Firebase project: `abdelrahman-transport` — https://console.firebase.google.com/project/abdelrahman-transport

## 1. Back up (30 seconds)
Realtime Database → Data → ⋮ → **Export JSON**. Keep the file.

## 2. Turn on login
Build → Authentication → Get started → Sign-in method → **Email/Password** → Enable → Save.

## 3. Create your one account
Authentication → Users → **Add user**:
- Email: `owner@travelband.app` (exactly; you never type it, the app does)
- Password: **your PIN** — at least 6 digits (Firebase's minimum); 8 digits is better.

## 4. Close sign-ups
Authentication → **Settings** → User actions → turn off **Enable create (sign-up)** → Save.
This stops anyone else from making an account against your public project key. Leave Anonymous sign-in off (it is by default).

## 5. Publish the security rules
Realtime Database → **Rules** → replace everything with the contents of `database.rules.json` → **Publish**.
After this, only someone signed in with your PIN can read or change data (the old `buses` node becomes unreadable; the app doesn't use it).
Check: opening `https://abdelrahman-transport-default-rtdb.europe-west1.firebasedatabase.app/drivers.json` in a browser should say "Permission denied".

## 6. Allow your website address
Authentication → Settings → **Authorized domains** → add the address the site is hosted on (for example `your-project.vercel.app`).

## 7. Restrict the API key (recommended)
https://console.cloud.google.com → APIs & Services → Credentials → the Browser key → Application restrictions: **Websites** → add your site address.

## 8. First login
Open the site, type your PIN. The first admin login converts old shift labels (`نص يوم`, `Half Day`…) to codes. Back up first (step 1).

---

## Optional: photo scan, Sheets, nightly backup (Google Apps Script)
Needed only for the work-order photo scan and the nightly backup. See [WORK-ORDER-SCAN-SETUP.md](WORK-ORDER-SCAN-SETUP.md).
The script accepts only requests carrying a valid Firebase login token from your project.

Nightly backup: paste `apps-script/Code.gs` and `apps-script/appsscript.json`, then run `installBackupTrigger` once.
It saves the database to a Drive folder called "Travel Band Backups" and keeps the last 30.

## Changing your PIN
Authentication → Users → ⋮ → **Reset password** (or delete the user and add it again with the new PIN).

## Notes
- Firebase rate-limits wrong PIN guesses ("too many attempts" appears for a while).
- If you ever want other people to use it, they should get their own accounts. Tell me and I'll add roles back.
