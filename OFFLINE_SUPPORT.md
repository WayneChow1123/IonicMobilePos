# Offline support and validation

**Final verification (2026-11-04): 46 browser regression tests and 26 isolated SQL
controller/filter integration scenarios pass.** CN single/multiple selection and unpaid
invoice cancellation follow the confirmed rules. Company name, display name and both
address lines are now saved through versioned API endpoints, with device caching,
pending offline sync and conflict handling. See OFFLINE_FINAL_REVIEW.md for phone and
two-device test steps. No production deployment or APK installation was performed.

This change repairs offline CRUD and reconnect behavior in the installed POS app.
It changes **both** the Ionic app and the API. Deploy the updated API before installing
the updated app. No deployment or production database operation was performed during development.

## Supported local operations

- Categories: create, edit, delete and view; pending changes are preserved during refresh.
- Products and customers: local CRUD with persistent temporary-to-server ID mappings.
- Customer special prices: string IDs are preserved until the customer/product has synced.
- Invoices: one upload source, consistent edited items and totals, cancellation of unsent
  UUID invoices, and cached detail/receipt preview. Edits made after an upload attempt
  follow the original create as a separate update.
- Payments: resolve customer and invoice IDs before upload, retain failed payments,
  map returned payment IDs, and restore cached balances when cancelling a local payment.
- Credit notes: preserve customer IDs, map returned credit-note IDs, update return-credit
  balances on edit/delete, and queue refund-credit applications. Selected refund credit
  is reserved locally when creating an invoice and restored if that unsent invoice is cancelled.
- Company profile: shared through API, cached on the device, with pending offline changes.
- Printer, theme and font settings retain their device-specific behavior.

Local storage writes report failure if neither IndexedDB nor localStorage can persist
the data. Cache values are copied to avoid changing one cached record through an alias
to another cache. IndexedDB queue writes wait for transaction completion.

## Shared company profile

GET /System/GetCompanyProfile and PUT /System/UpdateCompanyProfile persist the shared
profile. PUT uses ExpectedVersion and returns 409 on concurrent changes. The
CompanyProfiles singleton table is provisioned at startup; EF migration
20261104060000_AddCompanyProfile is also supplied. Saves report API success only
after acknowledgement. Active devices refresh on foreground/focus, settings entry
and a 30-second polling interval. Offline edits remain visibly pending.

## Reconnect protocol

The app checks `GET /System/GetOfflineSyncCapabilities` before draining the queue.
An unavailable/old API leaves the queue on the device and reports that an API update is needed.

Each mutation carries a persistent `X-Offline-Operation-Id`. The API stores its successful
JSON response in `OfflineOperations` in the **same SQL transaction** as the mutation.
A SQL application lock serializes retries of the same operation. A retry with the same
request returns the saved result; reuse of an operation ID with different data returns 409.
This covers lost-response retries without repeating payment/credit/stock changes.

The API bootstrap provisions `OfflineOperations`, matching the existing startup schema
workflow. Migration `20261104050000_AddOfflineOperations` and its model snapshot are
also included for installations that manage schema through EF migrations. The migration
checks whether the bootstrap already created the table.

Bulk payment responses now include payment IDs and the change-credit-note ID. Payment
and excess-credit creation commit together. Refund-credit sync sends the expected amount
and target invoice; conflicting server balances produce a reviewable error instead of
silently moving the credit to another invoice. Existing online calls using an empty body
retain their previous behavior.

## Verification

Verified on 2026-11-04: **46/46 browser regression tests and 26 SQL scenarios passed**, Angular development build
passed, and the .NET API build completed with zero errors (nullable warnings remain).

Run the focused regression suite with:

```text
npm run test:offline
```

The suite uses real IndexedDB and Dexie in Karma's isolated headless Chrome profile,
with a mocked HttpClient. It does not call the production API or use the user's app database.
It covers UUID cancellation, edited upload data, restart persistence, category CRUD,
special-price IDs, customer/product/invoice/payment dependencies, stock reloads,
credit balances and reservations, lost-response retries, old API rejection, and storage failures.

Build checks:

```text
npx ng build --configuration development
dotnet build --no-restore
```

## Boundaries and release checks

- Historical server data must first be downloaded to the device. Background invoice-detail
  prefetch now considers all listed invoices, but cutting the connection before downloading
  completes cannot make missing details available. Clearing app data removes local data.
- Server backup and server-generated report endpoints still require a connection. A device
  cannot retrieve server records it has never downloaded. Browser cold-start availability
  is not provided by this change; the Android app bundles its application assets.
- The server remains authoritative for stock, customer/credit balances and validation.
  A conflict is retained in the queue and surfaced for review; it is not discarded as success.
- SQL transaction/replay behavior has now passed isolated SQL LocalDB controller/filter
  integration tests, including concurrent retries, rollback and changed-body 409. The
  actual deployed API, HTTP routing/binding and phone end-to-end flows still need staging tests.
- Before release, test airplane mode on an Android device: create/edit/delete/view,
  force-close/reopen, reconnect, check server balances and IDs, and test Bluetooth printing.
  No APK was rebuilt or installed as part of this change.
