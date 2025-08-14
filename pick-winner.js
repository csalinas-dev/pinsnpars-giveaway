#!/usr/bin/env node
import 'dotenv/config';
import fs from 'fs';
import { parse } from 'csv-parse/sync';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { graphPagedGET, graphGET, extractMentions, swapRemove } from './utils.js';

/**
 * CONFIG
 * Point at the current Graph API version. You can bump it later without code changes.
 */
const GRAPH = 'https://graph.facebook.com/v23.0'; // current as of writing

const argv = yargs(hideBin(process.argv))
  .option('media-id', { type: 'string', demandOption: true })
  .option('ig-user-id', { type: 'string', demandOption: true })
  .option('access-token', { type: 'string', default: process.env.ACCESS_TOKEN, demandOption: !process.env.ACCESS_TOKEN })
  .option('follow-mode', { choices: ['manual-follow', 'file-follow'], default: 'manual-follow' })
  .option('followers-csv', { type: 'string', describe: 'CSV file with a username column; used when follow-mode=file-follow' })
  .option('seed', { type: 'string', describe: 'Optional RNG seed for reproducible draws' })
  .help()
  .argv;

function makeRNG(seedStr) {
  // Tiny seeded RNG for reproducibility; not crypto-secure (not needed here)
  if (!seedStr) return Math;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return {
    random() {
      // xorshift-ish
      h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
      return ((h >>> 0) % 1_000_000) / 1_000_000;
    }
  };
}

const RNG = makeRNG(argv.seed || `${argv.mediaId}|${Date.now()}`);

/** STEP 1: fetch comments lazily, build distinct eligible commenter set */
async function getEligibleCommenters(mediaId, accessToken) {
  const url = `${GRAPH}/${mediaId}/comments?fields=id,text,username`;
  const seen = new Set();           // distinct usernames
  const eligible = [];

  for await (const c of graphPagedGET(url, accessToken)) {
    const uname = (c.username || '').toLowerCase();
    if (!uname || seen.has(uname)) continue;
    const tags = extractMentions(c.text);
    if (tags.length >= 3) {
      seen.add(uname);
      eligible.push(uname);
    }
  }
  return eligible;
}

/**
 * STEP 2: check if user liked the media.
 * IG Graph lacks a "has_liked(media,user)" endpoint, so we page the likes edge until found (or exhausted).
 * We cache discovered likers in a Set to avoid re-walking pages on subsequent checks.
 */
function makeLikeChecker(mediaId, accessToken) {
  const cache = new Set();       // usernames discovered so far
  let exhausted = false;         // whether we've paged every like already
  const pager = graphPagedGET(`${GRAPH}/${mediaId}/likes?fields=username`, accessToken);

  return async function hasLiked(username) {
    const uname = username.toLowerCase();
    if (cache.has(uname)) return true;

    // If we've already exhausted the likes stream and didn't see uname, it's false.
    if (exhausted) return false;

    // Consume pages until we either find the user or we run out.
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
 * STEP 3: follow verification
 * - manual-follow: return 'unknown' and a profile URL; you confirm manually.
 * - file-follow: check against provided CSV (expects a column named 'username' or first column).
 */
function makeFollowChecker(mode, csvPath) {
  if (mode === 'file-follow') {
    if (!csvPath) throw new Error('file-follow mode requires --followers-csv');
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = parse(raw, { columns: true, skip_empty_lines: true });
    // Try to be flexible about header
    const follows = new Set(
      rows.map(r => (r.username ?? Object.values(r)[0] ?? '').toLowerCase()).filter(Boolean)
    );
    return async (username) => follows.has(username.toLowerCase());
  }
  // manual-follow mode
  return async (username) => {
    // Not verifiable via official API; caller must confirm
    return 'unknown';
  };
}

/** MAIN draw */
async function main() {
  const mediaId = argv['media-id'];
  const igUserId = argv['ig-user-id'];
  const token   = argv['access-token'];

  const eligible = await getEligibleCommenters(mediaId, token);

  if (!eligible.length) {
    console.log(JSON.stringify({ status: 'no-eligible-commenters', eligible_count: 0 }, null, 2));
    return;
  }

  const hasLiked = makeLikeChecker(mediaId, token);
  const isFollower = makeFollowChecker(argv['follow-mode'], argv['followers-csv']);

  // Random sampling with swap-remove (O(1) per rejection)
  let n = eligible.length;
  const audit = [];
  while (n > 0) {
    const i = Math.floor(RNG.random() * n);
    const candidate = eligible[i];

    const liked = await hasLiked(candidate);
    const followState = await isFollower(candidate);
    const follows = (followState === true);

    audit.push({ candidate, liked, follows });

    if (liked && (follows || followState === 'unknown')) {
      // If manual-follow mode, we surface the profile URL for human confirmation
      const profileUrl = `https://instagram.com/${candidate}`;
      console.log(JSON.stringify({
        status: (followState === 'unknown') ? 'winner-pending-follow-confirmation' : 'winner',
        candidate,
        profileUrl,
        eligible_count: eligible.length,
        audit
      }, null, 2));
      return;
    }

    n = swapRemove(eligible, i, n);
  }

  console.log(JSON.stringify({ status: 'no-qualified-winner-after-checks', eligible_count: eligible.length, audit }, null, 2));
}

main().catch(e => {
  console.error(e.stack || e.message || e);
  process.exit(1);
});
