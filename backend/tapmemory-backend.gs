/**
 * Tap Memory wallet sign-ups back end (Google Apps Script).
 *
 * SETUP (about 5 minutes):
 * 1. Create a new Google Sheet, e.g. "Tap Memory Wallets".
 * 2. In the sheet: Extensions > Apps Script. Delete what's there, paste this whole file, Save.
 * 3. Deploy > New deployment > type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    Click Deploy and approve the permissions.
 * 4. Copy the Web app URL (ends in /exec).
 * 5. In index.html, paste it into:  const SIGNUP_ENDPOINT="...";
 *
 * Every wallet submitted on tapmemory.io lands in the "Wallets" tab.
 * The same wallet is never added twice. A "Summary" tab shows the totals.
 * If you edit this script later, use Deploy > Manage deployments > Edit > New version
 * so the same URL keeps working.
 */

const SHEET_NAME = 'Wallets';
const WALLET_RE = /^(0x[a-fA-F0-9]{40}|[a-z0-9-]+(\.[a-z0-9-]+)*\.eth)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    let data = {};
    try { data = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}

    const wallet = String(data.wallet || '').trim().slice(0, 100);
    let email = String(data.email || '').trim().slice(0, 200);
    if (!WALLET_RE.test(wallet)) return json({ ok: false, error: 'invalid_wallet' });
    if (email && !EMAIL_RE.test(email)) email = '';

    const sh = sheet();
    const last = sh.getLastRow();
    if (last > 1) {
      const existing = sh.getRange(2, 2, last - 1, 1).getValues()
        .map(r => String(r[0]).toLowerCase());
      if (existing.indexOf(wallet.toLowerCase()) !== -1) return json({ ok: true, duplicate: true });
    }

    sh.appendRow([
      new Date(),
      safe(wallet),
      safe(email),
      safe(String(data.page || '').slice(0, 100))
    ]);
    return json({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

// Visiting the URL in a browser shows how many wallets are in.
function doGet() {
  const n = Math.max(0, sheet().getLastRow() - 1);
  return json({ ok: true, wallets: n });
}

function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['Submitted', 'Wallet', 'Email', 'Site']);
    sh.setFrozenRows(1);
    sh.getRange('A1:D1').setFontWeight('bold');
    sh.setColumnWidth(2, 380);
    sh.setColumnWidth(3, 240);
    let sum = ss.getSheetByName('Summary') || ss.insertSheet('Summary');
    sum.getRange('A1:B3').setValues([
      ['Total wallets', "=COUNTA('" + SHEET_NAME + "'!B2:B)"],
      ['With email', "=COUNTA('" + SHEET_NAME + "'!C2:C)"],
      ['Last 24 hours', "=COUNTIF('" + SHEET_NAME + "'!A2:A,\">\"&NOW()-1)"]
    ]);
    sum.getRange('A1:A3').setFontWeight('bold');
  }
  return sh;
}

// Stop anything that starts with = + - @ from being run as a spreadsheet formula.
function safe(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
