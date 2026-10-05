# Phase 1 — Setup Checklist

The code now expects Firebase Authentication and role-based Security Rules.
**Do these steps in order before deploying the new `index.html`**, otherwise nobody can log in.

Firebase project: `abdelrahman-transport` (console: https://console.firebase.google.com).

## 1. Enable sign-in
Build → Authentication → Get started → **Sign-in method** → enable **Email/Password** (users only ever type a PIN; the email part is internal).

## 2. Create the two PIN accounts
The app logs in with a **PIN only**. A PIN is the password of one of two shared accounts, so Firebase checks it on its servers.

Authentication → Users → **Add user**, twice:

| Email (exactly) | Password = the PIN | Role |
|---|---|---|
| `admin@travelband.app` | the admin PIN | admin (can delete, settings) |
| `staff@travelband.app` | the staff PIN | supervisor (add/edit only) |

- PINs must be **at least 6 digits** (Firebase minimum). 8 digits is better. The two PINs must be different.
- Give the admin PIN only to the owner.
- To change a PIN later: Authentication → Users → ⋮ → Reset password (or delete and re-add the user, then redo step 3 with the new UID).
- Copy each user's **User UID**.

### Give each account its role
Realtime Database → Data → add at the root:

```
users
  <ADMIN_UID>: { role: "admin" }
  <STAFF_UID>: { role: "supervisor" }
```

Anyone else, or an account without a role, is signed out immediately and cannot read data.

## 3. Publish the rules
Realtime Database → **Rules** → paste the contents of `database.rules.json` → Publish.
(Or with the CLI: `firebase deploy --only database`.)

Test in the Rules Playground: an unauthenticated read of `/drivers` must be denied.

## 4. Restrict the API key
Google Cloud Console → APIs & Services → Credentials → the Browser key used in `index.html`:
- Application restrictions → **Websites** → add only your deployed domain (and `http://localhost:*` for testing).
- API restrictions → keep only Identity Toolkit API, Token Service API, Firebase Realtime Database API.

## 5. First login
Open the site, sign in as the admin. On first load the admin session converts old records' shift labels
(`نص يوم`, `Half Day`, ...) to codes (`half`, `normal`, `extra`, `custom`) — required by the new rules.
**Back up first:** Realtime Database → ⋮ → Export JSON.

> Until the admin has logged in once, old records that still hold text labels cannot be re-saved
> (the rules only accept codes), but they still display correctly.

## 6. Secure the Google Sheets webhook
The page now sends the user's Firebase ID token with every sync (`idToken` field). Make the Apps Script reject calls without a valid token:

```js
function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const API_KEY = 'YOUR_FIREBASE_WEB_API_KEY';
  const res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + API_KEY,
    { method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ idToken: data.idToken }), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    return ContentService.createTextOutput('unauthorized');
  }
  delete data.idToken;
  // ...existing code that appends the row to the sheet...
}
```

Then redeploy the script as a new version. Optionally rotate the deployment URL (new deployment) and update `SHEETS_URL` in `index.html`, since the old URL is public in git history.

## What changed in code
- PIN lock screen → Firebase email/password login with role check; Logout button.
- Delete buttons and delete actions are admin-only (also enforced by the rules); the hardcoded delete PIN is gone.
- All user-supplied text is escaped before rendering (`esc()`).
- Shift type stored as a code, translated only on display; old data auto-migrated.
- One attendance record per driver per date; saving again asks to replace.
- Save/delete failures are now reported instead of silently ignored.

## Phase 2 additions
Republish `database.rules.json` (new fields: driver `status`/`createdAt`, attendance `status`/`createdBy`/`updatedBy`/`updatedAt`, and an admin-only `settings` node).
Defaults need no setup; the admin can change shift end times and the default start time in the new **Settings** tab.
