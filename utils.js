import fetch from 'node-fetch';

/** Minimal Graph helper with paging */
export async function* graphPagedGET(url, accessToken) {
  let next = new URL(url);
  next.searchParams.set('access_token', accessToken);
  /* Meta’s Graph paginates with {paging:{next}} */
  while (next) {
    const res = await fetch(next.toString());
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Graph error ${res.status}: ${t}`);
    }
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    for (const item of data) yield item;
    const nxt = json?.paging?.next;
    next = nxt ? new URL(nxt) : null;
  }
}

/** GET once */
export async function graphGET(url, accessToken) {
  const u = new URL(url);
  u.searchParams.set('access_token', accessToken);
  const res = await fetch(u.toString());
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Graph error ${res.status}: ${t}`);
  }
  return res.json();
}

/** Extract @mentions from text */
export function extractMentions(text) {
  if (!text) return [];
  // match @username (letters/numbers/._)
  const m = text.match(/@([A-Za-z0-9._]+)/g) || [];
  return m.map(s => s.slice(1).toLowerCase());
}

/** Swap-remove for O(1) deletion from array */
export function swapRemove(arr, i, nRef) {
  arr[i] = arr[nRef - 1];
  nRef -= 1;
  return nRef;
}
