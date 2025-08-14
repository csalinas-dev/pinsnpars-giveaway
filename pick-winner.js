#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  graphPagedGET,
  graphGET,              // optional; included for completeness
  extractMentions,       // optional; imported if you want to test helpers
  swapRemove,
  meetsTagRule
} from './utils.js';

/** Bump this as Meta versions roll forward */
const GRAPH = 'https://graph.facebook.com/v23.0';

const argv = yargs(hideBin(process.argv))
  .option('media-id', { type: 'string', demandOption: true, describe: 'Instagram media (post) ID' })
  .option('ig-user-id', { type: 'string', demandOption: true, describe: 'Your IG Business/Creator user ID (not used by all flows, kept for clarity)' })
  .option('access-token', { type: 'string', default: process.env.ACCESS_TOKEN, demandOption: !process.env.ACCESS_TOKEN, describe: 'Long-lived IG Graph token' })
  .option('follow-mode', { choices: ['manual-follow', 'file-follow'], default: 'manual-follow', describe: 'How to verify follow requirement' })
  .option('followers-csv', { type: 'string', describe: 'CSV with a "username" column for file-follow mode' })
  .option('seed', { type: 'string', describe: 'Optional RNG seed for reproducible draws' })
  .help()
  .argv;

/** Tiny seeded RNG for reproducibility (not crypto). */
function makeRNG(seedStr) {
  if (!seedStr) return Math; // fallback to Math.random()
  let h = 2166136261 >>> 0;  // FNV-ish
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return {
    random() {
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 1_000_000) / 1_000_000;
    }
  };
}

const RNG = makeRNG(argv.seed || `${argv['media-id']}|${Date.now()}`);

/**
 * Build the distinct commenter pool (smallest list) in a single pass,
 * and index ALL comment texts by username for the later lazy tag check.
 */
async function getDistinctCommenters(mediaId, accessToken) {
  const url = `${GRAPH}/${mediaId}/comments?fields=id,text,username`;
  const seen = new Set();
  const pool = [];
  const byUser = new Map(); // username -> array of comment texts

  for await (const c of graphPagedGET(url, accessToken)) {
    const uname = (c.username || '').toLowerCase();
    if (!uname) continue;

    if (!byUser.has(uname)) byUser.set(uname, []);
    if (c.text) byUser.get(uname).push(c.text);

    if (!seen.has(uname)) {
      seen.add(uname);
      pool.push(uname);
    }
  }
  return { pool, byUser };
}

/**
 * Lazy like-checker:
 * IG Graph doesn’t provide "has_liked(user)" directly, so we page /likes
 * on demand and cache discovered likers by username.
 */
function makeLikeChecker(mediaId, accessToken) {
  const cache = new Set();  // usernames discovered to have liked
  let exhausted = false;
  const pager = graphPagedGET(`${GRAPH}/${mediaId}/likes?fields=username`, accessToken);

  return async function hasLiked(username) {
    const uname = username.toLowerCase();
    if (cache.has(uname)) return true;
    if (exhausted) return false;

    for await (const liker of pager) {
      const lu = (liker.username || '').toLowerCase();
      if (lu) cache.add(lu);
      if (lu === uname) return true;
    }
    exhausted = true;
    return cache.has(uname);
  };
}

/**
 * Follow verification strategies:
 * - manual-follow: cannot verify via official API; return 'unknown' to be confirmed manually.
 * - file-follow: verify against a provided CSV (expects header 'username' or uses first column).
 */
function makeFollowChecker(mode, csvPath) {
  if (mode === 'file-follow') {
    if (!csvPath) throw new Error('file-follow mode requires --followers-csv <path>');
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = parse(raw, { columns: true, skip_empty_lines: true });
    const follows = new Set(
      rows.map(r => (r.username ?? Object.values(r)[0] ?? '').toLowerCase()).filter(Boolean)
    );
    return async (username) => follows.has(username.toLowerCase());
  }
  // manual-follow
  return async (_username) => 'unknown';
}

async function main() {
  const mediaId = argv['media-id'];
  const token   = argv['access-token'];

  // 1) Pool = distinct commenters; store their comment texts for lazy tag verification
  const { pool, byUser } = await getDistinctCommenters(mediaId, token);

  if (!pool.length) {
    console.log(JSON.stringify({ status: 'no-commenters', count: 0 }, null, 2));
    return;
  }

  const hasLiked   = makeLikeChecker(mediaId, token);
  const isFollower = makeFollowChecker(argv['follow-mode'], argv['followers-csv']);

  // 2) Random sampling with swap-remove
  const eligible = pool.slice();
  let n = eligible.length;
  const audit = [];

  while (n > 0) {
    const i = Math.floor(RNG.random() * n);
    const candidate = eligible[i];

    // Tag rule: >= 3 UNIQUE accounts across ALL their comments
    const tagged3 = meetsTagRule(candidate, byUser);
    if (!tagged3) {
      audit.push({ candidate, tagged3 });
      n = swapRemove(eligible, i, n);
      continue;
    }

    // Like rule (lazy, paged/cached)
    const liked = await hasLiked(candidate);

    // Follow rule (manual/file)
    const followState = await isFollower(candidate);
    const follows = (followState === true);

    audit.push({ candidate, tagged3, liked, follows });

    if (tagged3 && liked && (follows || followState === 'unknown')) {
      const profileUrl = `https://instagram.com/${candidate}`;
      console.log(JSON.stringify({
        status: (followState === 'unknown') ? 'winner-pending-follow-confirmation' : 'winner',
        candidate,
        profileUrl,
        commenters_count: pool.length,
        audit
      }, null, 2));
      return;
    }

    n = swapRemove(eligible, i, n);
  }

  console.log(JSON.stringify({
    status: 'no-qualified-winner-after-checks',
    commenters_count: pool.length,
    audit
  }, null, 2));
}

main().catch(err => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
