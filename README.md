# Instagram Giveaway Winner Picker

A Node.js CLI tool that picks a **random Instagram giveaway winner** using a **commenter-first, lazy verification** approach for performance.

The winner is chosen only if they:

1. **Commented** on the giveaway post tagging at least **3 unique accounts**  
   (across all of their comments, not just one).
2. **Liked** the giveaway post.
3. **Follow** your Instagram account.

Because the official Instagram Graph API **does not** provide a direct *is follower* check, the script supports two modes:
- **manual-follow** – returns the winner with a profile link for you to manually confirm they follow you.
- **file-follow** – verifies against a CSV export of your followers that you provide.

---

## Features

- Pulls **distinct commenters** first (smallest dataset for performance).
- Lazy verification for tag count, likes, and follows.
- Caches likes as it pages through them for O(1) rechecks.
- Supports **deterministic draws** with an RNG seed for auditability.
- Outputs **JSON** with the winner and an audit trail of candidates checked.

---

## Requirements

- **Node.js** 18+  
- Instagram **Business** or **Creator** account linked to a Facebook Page.
- A Facebook Developer App with the Instagram Graph API enabled.
- A **long-lived User Access Token** with the following permissions:
  - `instagram_manage_comments` – to read comments.
  - `instagram_basic` – to read basic profile info.
  - (`pages_show_list` is often required during the initial linking process.)

> ℹ️ The token must be for the IG account that owns the giveaway post.

---

## Installation

```bash
git clone https://github.com/your-org/instagram-giveaway-picker.git
cd instagram-giveaway-picker
npm install
````

---

## Setup

1. **Obtain a Long-Lived Access Token**
   Follow Meta’s docs to get a token for your IG Business account.

2. **Find Your IDs**

   * **IG User ID** – your Instagram Business account ID.
   * **Media ID** – the ID of the giveaway post.

3. **(Optional)** Create a `.env` file to store your token:

   ```env
   ACCESS_TOKEN=EAAG...your-long-lived-token
   ```

4. **(Optional)** Prepare `followers.csv` if using `file-follow` mode:
   CSV must have a `username` column or a single column of usernames:

   ```csv
   username
   alice
   bob.smith
   charlie_3
   ```

---

## Usage

### Manual Follow Confirmation (default)

```bash
node pick-winner.js \
  --media-id 17999999999999999 \
  --ig-user-id 17888888888888888 \
  --follow-mode manual-follow
```

### CSV Follow Verification

```bash
node pick-winner.js \
  --media-id 17999999999999999 \
  --ig-user-id 17888888888888888 \
  --follow-mode file-follow \
  --followers-csv ./followers.csv
```

### With a Seed (for reproducible draws)

```bash
node pick-winner.js \
  --media-id 17999999999999999 \
  --ig-user-id 17888888888888888 \
  --seed "giveaway-2025-08-13"
```

> If `ACCESS_TOKEN` is set in `.env`, you can omit `--access-token`.

---

## Output Example

```json
{
  "status": "winner-pending-follow-confirmation",
  "candidate": "alice",
  "profileUrl": "https://instagram.com/alice",
  "commenters_count": 37,
  "audit": [
    { "candidate": "dave", "tagged3": true, "liked": true, "follows": false },
    { "candidate": "steph", "tagged3": false },
    { "candidate": "alice", "tagged3": true, "liked": true, "follows": "unknown" }
  ]
}
```

* `status` can be:

  * `winner` – all checks passed (including file-follow).
  * `winner-pending-follow-confirmation` – passed except follow check (manual mode).
  * `no-qualified-winner-after-checks` – no one met all criteria.
  * `no-commenters` – no comments found.
* `audit` is an ordered list of all candidates checked in sequence.

---

## How It Works

1. **Fetch comments** → Build a distinct commenter list + store all comment texts.
2. **Randomly pick** a commenter from the list.
3. **Check tag rule** → must have tagged ≥ 3 unique accounts across all their comments.
4. **Check like rule** → page `/likes` lazily until found or exhausted.
5. **Check follow rule** → manual (unknown) or file-based verification.
6. **If fail**, remove and repeat until winner or pool is empty.

This “commenter-first + lazy verification” method:

* Minimizes API calls and memory usage.
* Avoids fetching the full likes/followers list unless necessary.
* Keeps logic transparent and auditable.

---

## License

MIT
