# Changelog

## 3.5.3
- The profile pass never checked `isBlocked()`. It relied on the consecutive-failure
  counter alone, which only fires after six profiles have each burned an attempt.
  It now detects a block page on arrival, refunds the attempt, un-retires the lead
  and stops. A rate limit can no longer retire good leads.
- Added **Revive leads killed by a throttle**, which resets leads marked dead that
  never returned a median.

## 3.5.2
- Fixed leads being orphaned out of the queue permanently. `markVisited` fires
  *before* navigating (see 3.2.1), so a lead whose page never loaded was stamped
  into `visited` while still unenriched, and the queue build excluded it forever.
  Leads are now retired by two real attempts, not by presence in `visited`.
- Attempt counts live in their own small store written before the leads blob, so
  they survive a storage-quota failure. Keeping them inside the leads blob would
  have reset every counter on reload and reintroduced the 3.2.0 refresh loop.
- Added **Rebuild enrich queue** to force a rebuild instead of waiting for the
  queue to drain.
- CSV gained `enriched`, `tries` and `was_visited` so a blank median can be told
  apart from a rejection.

## 3.5.1
- Retry once on TikTok's transient "something went wrong" shell, guarded per URL.
- Strip the leading `@` when matching TikTok profile paths. Without this the
  match never fired on TikTok and dead profiles kept returning.
- Panel field for seconds between profiles.

## 3.5.0
- Widened targeting beyond AI creators to professions and everyday life admin:
  45 TikTok tags, profession vocabulary in the scoring list.
- TikTok Auto Run.

## 3.4.0
- Auto Run chaining search, resolve and enrich.
- Queue ordering changed to newest batch first. Ordering by relevance alone meant
  an aged lead with a high keyword score always beat a lead found tonight that has
  no bio yet and therefore scores zero.
- CSV gained `batch` and `found_by_query`.

## 3.3.0 - 3.3.3
- Word-boundary keyword matching. Substring matching had been scoring ordinary
  names as relevant because "ai" appears inside them, admitting several hundred
  junk leads.
- Source weighting. Commenter-sourced leads qualified at 3.5% against 15.4% for
  post-sourced, so commenter harvesting is off by default.
- Removed the EDC/gear vertical, a bad bet for an app-first launch.

## 3.2.1
- Fixed an infinite refresh loop on a single profile. The cause was a storage
  quota failure: the enriched flag never persisted across the page load. `visited`
  is now written *before* the large leads blob so it survives a failed write, and
  the queue rebuild happens after the current profile is marked.
- URL normalisation before comparison.
