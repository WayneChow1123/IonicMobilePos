# Excel export and database backup — 2026-11-06

Export Bills now produces real `.xlsx` workbooks for All, By Customer and Single.
Invoices contains numeric money columns, dates, payment status, paid amount and balance
due; Items preserves product detail and barcode text; Credit Notes is included when
applicable. Totals use SUM formulas with cached results. Customer text is stored as text,
never interpreted as formulas. Requests are limited to six at a time; unavailable invoice
details produce an error instead of silently exporting incomplete records.

The Export Bills heading is centered independently of the Back button.

Android exports use Capacitor Filesystem cache files and the native Share dialog. Users
must choose an available save/share destination. Browsers use normal downloads. The
new native plugins require rebuilding the Android app; an old installed APK will not
gain this functionality from API deployment alone.

Backup now creates the SQL backup, downloads the returned backup ID as a Blob, and
opens the same save/share flow. A failed download can retry the same completed backup
without creating another database backup. It requires a network connection. API errors
are displayed, and repeated taps are blocked while work is in progress.

API fixes include provisioning BackupRecords for existing installations, unique backup
filenames, quoted database identifiers/parameterized paths, asynchronous SQL commands,
checksum creation and streaming downloads. Full/differential routes remain compatible.
There are no changes to invoice payment, credit or stock rules in this work.

## Validation

- 73 browser tests passed, including an XLSX write/read round-trip, customer/single
  selection, partial-payment amounts, missing detail handling, backup retry, binary HTTP
  response handling and actual rendered heading centering.
- 33 isolated SQL integration scenarios passed. Backup tests create their own random
  database on CodexMobilePosOfflineReview, recreate the backup metadata table, create
  full and differential backups, run RESTORE VERIFYONLY WITH CHECKSUM, and verify the
  downloaded stream. Test backups and the isolated database are removed afterward.
- Angular production build passed; API Release build passed with existing nullable warnings.
- Android plugin synchronization completed. No APK install, native save/share device test,
  live API call, live database backup/deployment or Git push was performed.

## Deployment and manual checks

1. Publish the updated API while keeping production configuration. BackupSettings:
   BackupFolder must be an absolute path accessible to both SQL Server and the API.
   SQL Server's service identity needs write permission; the API needs folder creation,
   file read and database backup/metadata permissions. For a separate SQL host, configure
   a shared location accessible to both; a local path on two different machines is not
   shared automatically. Check API logs if configuration/permission errors remain.
2. Rebuild frontend assets, run `npx cap sync android`, rebuild/install the Android app
   with the Filesystem and Share plugins. Existing receipt PDF printing is unaffected.
3. Test All, By Customer and Single exports. Open `.xlsx` in Excel; compare invoice
   count, item rows, numeric totals, RM100/RM50 paid/RM50 due, returns and applied credit.
   In airplane mode, export previously cached invoices; missing details must report failure.
4. On a test server, tap Backup Database while online. Save the `.bak`, verify its size
   and validate restoration with a DBA on a separate test database. Test download failure
   and Retry Backup Download. Do not restore over the live database as a test.
5. The latest live screenshot reports backup folder access denied. Live server filesystem
   permissions still need to be corrected; a DLL or APK update cannot grant those rights.
   See BACKUP_SERVER_PERMISSION_FIX.md in the API repository for host-specific steps.

## Styling update — 2026-11-06

All exported sheets now use native Excel tables, banded rows, column borders, a merged navy company banner and readable row heights. Invoice financial groups use teal/green headers; outstanding balances and payment statuses have distinct fills. Invoice Date and Term headers and values are centered. Dates, numeric values and totals calculations are unchanged. The 73 browser tests pass, including a write/read check for the native table, fills, borders and alignment. The API adds a backup failure stage and more precise application-identity permission messages; no live ACL changes were performed.
