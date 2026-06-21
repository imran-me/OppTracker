# Backup & Restore Guide

Your data lives in your **browser's Local Storage** under the key `pomls_data_v1`.
That means it is private and works offline — but it is tied to **one browser on one
device**. Clearing your browser data, switching devices, or using a different browser
will not carry your records over automatically.

The fix is simple: **export a backup file and keep it in Google Drive.** You can restore
it anywhere, anytime.

---

## Where the buttons are

Click the **cloud icon** (☁️) in the top bar of any page to open the *Backup & data* menu:

- **Export full backup (JSON)** — saves a file named `pomls-backup-YYYY-MM-DD.json`
- **Import backup** — restores from a `.json` file you select
- **Reset to sample data** — clears everything back to the demo records

---

## Recommended routine

A 30-second habit that keeps your data safe:

1. After a session of updates, click **Export full backup (JSON)**.
2. The file downloads to your computer/phone.
3. Upload that file to a Google Drive folder (e.g. *Drive → OppTrack Backups*).
4. Done. Your latest state is now safely in the cloud.

Do this **weekly**, or after any big update (new applications, status changes, etc).

---

## Backing up to Google Drive — step by step

### On a computer
1. Click **Export full backup (JSON)** → the file lands in your *Downloads* folder.
2. Open <https://drive.google.com>.
3. Create a folder called **OppTrack Backups** (once).
4. Drag the downloaded `.json` file into that folder.

### On a phone
1. Tap **Export full backup (JSON)** → it saves to your *Downloads*.
2. Open the **Google Drive** app → **+ → Upload**.
3. Pick the `pomls-backup-…json` file.

> Tip: keep the last few dated backups rather than overwriting, so you can roll back if
> you ever delete something by mistake.

---

## Restoring your data

On any device or browser:

1. Open the site (locally or your GitHub Pages link).
2. Download your latest backup from Google Drive to the device.
3. Click the **cloud icon → Import backup**.
4. Select the `.json` file.
5. The app restores everything and reloads. ✔️

---

## Moving from laptop to phone (or vice-versa)

1. On the **source** device: **Export full backup** → upload to Google Drive.
2. On the **target** device: download that file → **Import backup**.

Both devices now show the same data. (They will **not** stay in sync afterwards — repeat
the export/import whenever you want to move the latest state. For automatic sync, see the
*Future upgrade: Firebase* section in the main `README.md`.)

---

## Frequently asked

**Is my data sent anywhere?**
No. Everything stays in your browser. Backup files only go to Google Drive when *you*
upload them.

**What happens if I clear my browser history/cache?**
Local Storage can be wiped along with it. Always keep a recent exported backup.

**Can I read or edit the backup file?**
Yes — it is plain, human-readable JSON. You can open it in any text editor, though it is
safest to let the app import it back.

**The import did nothing / showed an error.**
Make sure you are selecting a file exported *from this app* (it must contain an
`opportunities` list). Files from other apps will be rejected.
