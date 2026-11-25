/* Run ONLY in the affected app WebView's DevTools console, not a separate website.
   Reads existing IndexedDB stores without calling any API, syncing, deleting or restoring.
   Does not create a database if one is absent. Output contains business invoice data.
   If the installed app cannot be inspected, do not uninstall it just to enable debugging. */
(async () => {
  const inventory = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : null;
  const wanted = {
    TDMobilePOS_LocalDB: ['orders', 'order_items', 'payments'],
    TDMobilePOS_OfflineDB: ['sync_queue', 'master_cache']
  };
  const evidence = { capturedAtUtc: new Date().toISOString(), origin: location.origin, databases: {}, localFallback: {} };
  // IndexedDB may be unavailable while the persistent fallback still has the orders.
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (typeof key === 'string' && (key === 'td_offline_sync_queue' || key === 'td_cache_invoices_list' ||
        key === 'new_invoice_draft' || key === 'td_cache_server_id_map' || key.startsWith('td_cache_inv_detail_'))) {
      const raw = localStorage.getItem(key);
      try { evidence.localFallback[key] = JSON.parse(raw); }
      catch { evidence.localFallback[key] = raw; }
    }
  }
  for (const [name, stores] of Object.entries(wanted)) {
    if (!inventory) {
      evidence.databases[name] = { found: null, note: 'Inventory unavailable; no database was opened.' }; continue;
    }
    if (!inventory.some(db => db.name === name)) {
      evidence.databases[name] = { found: false }; continue;
    }
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => { request.transaction.abort(); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Database busy: ' + name));
      request.onsuccess = () => resolve(request.result);
    });
    try {
      const available = stores.filter(store => db.objectStoreNames.contains(store));
      const snapshot = await new Promise((resolve, reject) => {
        const transaction = db.transaction(available, 'readonly');
        const result = {};
        for (const store of available) {
          const request = transaction.objectStore(store).getAll();
          request.onsuccess = () => {
            result[store] = store === 'master_cache'
              ? request.result.filter(entry => entry.key === 'invoices_list' || String(entry.key).startsWith('inv_detail_'))
              : request.result;
          };
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Read aborted'));
      });
      evidence.databases[name] = { found: true, version: db.version, stores: snapshot };
    } finally { db.close(); }
  }
  // Kept only in this console session. No file, storage or network writes are made.
  globalThis.mobilePosInvoiceEvidence = evidence;
  console.log('Invoice evidence read. Preserve the complete object before attempting recovery.', evidence);
  console.log('In Chrome DevTools you can copy it with: copy(JSON.stringify(mobilePosInvoiceEvidence))');
  return evidence;
})();
