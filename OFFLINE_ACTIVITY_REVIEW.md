# Offline activity list — 2026-11-13

The yellow control at the top right of the Billing landing page now opens Offline Activity rather than immediately
triggering upload. It remains accessible with zero pending tasks as Offline Log.
Automatic synchronization remains enabled. Sync Now is a separate modal action;
offline requests show a pending-data message rather than claiming everything synced.

The modal displays operation type (Create/Edit/Delete), invoice or record reference,
customer, local timestamp, descriptive values/items, error text and completion time.
All / Pending / Synced / Failed filters are available. Pending task count is an upload
task count; multiple edits may be coalesced into the latest payload for the same task.
The journal shows those edits separately, without suggesting each intermediate version
was independently committed to the server.

## Persistence and states

- Pending and failed actions are overlaid from the actual queue; viewing/filtering
  does not upload, delete or cancel them.
- Successful sync archives the operation before removing the queue item.
- A never-sent invoice that is deleted locally shows cancelled pending creation/edits
  plus a local Delete action. No fictitious server deletion is reported.
- Local cancellations for products, customers, categories, CNs, special prices and
  payments are also captured. Other queued types use the same journal.
- Coalesced local edits are logged explicitly; ID-mapping bookkeeping does not invent
  user edits or mutate historical snapshots.
- Journal writes are serialized, including concurrent enqueue/complete and fast
  auto-sync races. Task IDs reused for later edits do not change old completed entries.
- The journal uses the existing persistent cache store, so there is no IndexedDB schema
  upgrade or removal of old data. It keeps all unfinished entries and the latest 1,000
  completed/cancelled/local records on this device. This is a local activity summary,
  not a server audit trail or a full backup.
- Existing pending actions from older APKs are visible. Completed historical operations
  that were never logged cannot be reconstructed, and this does not recover the
  missing November 11/12 invoices.

## Pending-data safety correction

Products and Customers had a sync-failure confirmation whose false/cancel branch
called clearQueue for every record type. Dismissing that prompt could discard pending
invoice tasks. Those branches now offer Retry Sync / Keep Pending and do not clear
the queue. This confirms a source-level risk, not the cause of the reported incident.
No evidence establishes whether the client took that branch on November 11/12.

## Verification and manual check

Validation (November 16): 106 browser regression tests passed; Angular production build passed.

The browser regression suite tests persistent create/edit/delete history, sync
completion, task-ID reuse, failure details, legacy pending tasks, concurrent journal
writes, auto-sync completing before metadata, modal filters/Sync Now events, and
preserving pending invoices when the old product/customer prompt is dismissed.
Use `npm run test:offline`. Production build is checked separately.

On a test device, enter airplane mode, create an unpaid test invoice, edit its amount
and open Offline Log. Check separate Created/Edited entries and values. Closing the
log must not sync. Reopen after force-close and verify persistence. Cancel an unsent
invoice and verify the cancellation/local-delete entries. Repeat another creation and
restore connectivity: pending state should become Synced, and entries should remain
after the queue reaches zero. Simulate sync rejection, dismiss the prompt from Products
or Customers, and confirm the pending data remains visible.

App code only in this feature; no API deployment, original-client device inspection,
APK installation, live data recovery or Git push performed.
