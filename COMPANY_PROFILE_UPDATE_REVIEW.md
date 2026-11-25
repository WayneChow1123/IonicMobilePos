# Company address after APK updates — November 16, 2026

## Current policy — November 25, 2026 (supersedes offline editing below)

The user now requires API-confirmed company saves. A new offline company edit is
rejected without storing or displaying that edit. Online edits become visible and
show success only when PUT returns the submitted fields and expected next version.
An uncertain response retains a retry operation with its stable ID, but continues
displaying the previous API-confirmed profile and reports that confirmation is pending.
This retry record is not treated as a successful local company setting.

Already-confirmed profiles remain cached for offline viewing. Neither legacy
local-only edits nor built-in company names/addresses are displayed as configured
data before API confirmation. Old unsent edits can still migrate safely as described
below. An unconfigured API now returns empty company fields and version 0 instead
of the built-in B JAYA address. Settings explains that an internet connection is
required. Both the updated APK and updated API must be deployed for this behavior.

Payment review: a paid-invoice API error does not establish whether an earlier
request succeeded. The payment form now retains the same operation ID for an
identical retry, normalizes duplicate selected invoice identities, and refreshes
choices on an already-paid conflict with an explanatory message. It never treats
that conflict alone as a successful new payment. The bulk API rejects duplicate
invoice entries and serializes balance reads/writes with per-invoice SQL application
locks, alongside the existing transactionally stored operation replay receipts.

Validation: 119 isolated browser regressions and 42 disposable LocalDB integration
scenarios passed. These include successful replay after full payment (one payment
row only), concurrent different payment operations, database-persisted company
fields read by another API session, offline company-save rejection, and HTTP success
returning old company fields being refused as confirmation. This verifies source
behavior, not the client's specific incident. No live API/database was accessed.
The review LocalDB instance was stopped after its test database was cleaned up.

## Earlier investigation — November 16

Reported: a client re-enters a company address after APK updates because the old
address returns. This has not been reproduced on the client's original device.
No live API requests or database changes were made in this investigation.

The source stores versioned profiles and pending edits in localStorage, and saves
confirmed shared profiles through the API into CompanyProfiles. There is no APK
startup instruction clearing the profile or resetting that SQL row. However,
automatic refresh previously accepted a lower server version (including version 0
with the built-in address), silently replacing a newer confirmed device profile.

Follow-up: the user inspected the database and did not find the updated address.
The source also had a legacy migration gap: a customized v1/local-only profile
stayed local-only indefinitely when the API returned version 0. It required the
user to edit and save again. This is consistent with the report, but the client's
installed APK/cache and active server database have not been inspected directly.

Legacy customized profiles now migrate automatically only after a valid API
response confirms version 0 (no configured shared profile). Migration persists a
pending operation before sending, with expectedVersion 0 and a stable operation
ID across restart/retry. Another device winning the race produces a conflict,
retaining the local address. Existing configured API data is never automatically
overwritten by a legacy profile. Built-in defaults are not treated as user edits.

The client now retains its confirmed copy if the server returns a lower version,
or different fields with the same version. Settings shows a conflict explaining
that the address was kept. Editing is blocked until consistent server data returns
or the user explicitly chooses Reload API Profile. A genuinely newer shared
profile still propagates normally. Requests also bypass HTTP caches using a query
nonce and no-cache headers. A versioned confirmed copy is not automatically written
back to repair a regressed server, avoiding overwriting legitimate changes from
another device. Legacy version-0 migration is the guarded exception described above.

115 isolated browser tests passed, including legacy migration/retry/races, confirmed-address restart, offline
pending restart/reconnect, cross-device refresh, and stale versions 0/1/2. A mocked
restart validates service persistence; it does not certify physical APK upgrade
behavior or prove the incident's cause.

## Acceptance and investigation

1. Save a test address online and verify Settings says Saved to API.
2. Confirm a second device receives it. This distinguishes an API save from a
   pending change on only one device.
3. Overinstall the updated APK with the same application ID/signing identity,
   without clearing data. Verify the address both offline and after reconnecting.
4. If an old address returns or a conflict appears, ask the API administrator to
   inspect the active database (read only):

   SELECT DB_NAME() AS DatabaseName;
   SELECT Id, AppName, CompanyName, Address, City, Version, UpdatedAt
   FROM CompanyProfiles WHERE Id = 1;

Compare the stored address/version before and after deployment, and confirm that
the API connection string still targets the intended database. Do not blindly
overwrite that row or clear the client's app storage. If local data was removed,
only the server's persisted shared profile can restore the confirmed address.
