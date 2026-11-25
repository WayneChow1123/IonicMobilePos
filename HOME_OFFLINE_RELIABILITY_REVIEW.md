# Home offline activity and invoice visibility — November 16, 2026

Offline Log now lives at the top right of the Billing landing page (New Invoice / Reports Log), beside the more button. Opening it reads local history and pending tasks;
it does not trigger synchronization. Automatic synchronization remains enabled.
The modal retains a separate Sync Now action, disabled while syncing.

Invoice Report now also reads PENDING orders from the existing local order store.
An order can remain visible even when its list cache or upload task is missing.
Matching uses record IDs and confirmed server/client aliases, never editable invoice
numbers alone. Synced local archives are excluded to avoid resurrecting deleted
server invoices. Pending deletes remain excluded. Home includes unqueued pending
orders in its count and modal. This read path does not enqueue or upload anything.

106 isolated Chrome tests passed, including missing cache/task visibility, an online
empty-server response with a pending local order, same-number distinct invoices,
and excluding synced archives. Angular production build passed; existing CommonJS
optimization warnings remain. Tests use mocked HTTP, not the live API.

The client can currently create invoices, according to the user's latest check.
This does not establish what happened to November 11/12 records. No records were
recovered, no live data was changed, and no Git push was performed.

## Device acceptance check

1. Use a test device/account. Enable airplane mode, create a uniquely identifiable
   test invoice and confirm its customer, items and amount in Invoice Report.
2. Open Billing > Offline Log. Confirm Created/Pending, then edit the invoice and
   confirm the Edited entry. Opening the log must not require a connection.
3. Close and reopen the app while offline. Confirm the invoice and log remain.
4. Create another test invoice and delete that second invoice while still offline.
   Confirm its local cancellation/deletion is logged and it is absent from Report.
5. Reconnect. Confirm the retained invoice syncs once, the log shows completion,
   and the server/database contains the correct invoice and amounts.

Keep the client's original app data intact while investigating the historical gap.
Do not clear storage, uninstall, or blindly recreate potentially synced invoices.
