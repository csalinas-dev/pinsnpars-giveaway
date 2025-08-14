import fetch from 'node-fetch';

/**
 * Stream a Graph API collection with built-in pagination.
 * Yields each item from `data` until `paging.next` is exhausted.
 */
export async function* graphPagedGET(url, accessToken) {
  let nextUrl = new URL(url);
  nextUrl.searchParams.set('access_token', accessToken);

  while (nextUrl) {
    const res = await fetch(nextUrl.toString());
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Graph error ${res.status}: ${t}`);
    }
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    for (const item of data) yield item;
    const nxt = json?.paging?.next;
    nextUrl = nxt ? new URL(nxt) : null;
  }
}

/** One-off GET (kept for convenience; not strictly required by the picker) */
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

/** Extract @mentions from a chunk of text (lowercased usernames, no '@'). */
export function extractMentions(text) {
  if (!text) return [];
  const matches = text.match(/@([A-Za-z0-9._]+)/g) || [];
  return matches.map(s => s.slice(1).toLowerCase());
}

/**
 * O(1) swap-remove from an array segment [0..nRef-1].
 * Returns the new logical length after removal.
 */
export function swapRemove(arr, i, nRef) {
  arr[i] = arr[nRef - 1];
  return nRef - 1;
}

/**
 * Check if a user has tagged >= 3 UNIQUE accounts across ALL their comments.
 * `byUserMap`: Map(username -> array of comment texts)
 */
export function meetsTagRule(username, byUserMap) {
  const texts = byUserMap.get(username.toLowerCase()) || [];
  const unique = new Set();
  for (const t of texts) {
    for (const m of extractMentions(t)) {
      unique.add(m);
      if (unique.size >= 3) return true;
    }
  }
  return false;
}
