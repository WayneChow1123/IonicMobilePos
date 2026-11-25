/** Invoice numbers are editable labels, not unique identities. First source wins. */
export function mergeInvoiceRecords(...sources: any[][]): any[] {
  const result: any[] = [];
  const seen = new Map<string, any>();
  const keys = (row: any) => ['id', 'serverId', 'offlineId', 'clientId', 'offlineReferenceId']
    .map(field => row?.[field]).filter(value => value !== undefined && value !== null && value !== '')
    .map(value => String(value).toLowerCase());
  for (const rows of sources) for (const row of rows) {
    if (!row) continue;
    const identities = keys(row);
    const matches = [...new Set(identities.map(id => seen.get(id)).filter(Boolean))];
    let target = matches.sort((a, b) => result.indexOf(a) - result.indexOf(b))[0];
    if (!target) { target = { ...row }; result.push(target); }
    else {
      Object.assign(target, { ...row, ...target });
      for (const duplicate of matches.slice(1)) {
        Object.assign(target, { ...duplicate, ...target });
        result.splice(result.indexOf(duplicate), 1);
        for (const [key, value] of seen) if (value === duplicate) seen.set(key, target);
      }
    }
    for (const id of [...identities, ...keys(target)]) seen.set(id, target);
  }
  return result;
}
