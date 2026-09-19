# CSV columns

| Column | Meaning |
|---|---|
| `handle` | Account handle, no leading `@` |
| `platform` | `instagram` or `tiktok` |
| `name` | Display name when the profile exposes one |
| `followers` | Follower count at time of enrichment |
| `median_views` | Median of `post_views_sampled`. The pricing basis |
| `post_views_sampled` | Every sampled post view count, pipe separated |
| `relevance` | Keyword score. Good terms +1, bad terms -3 |
| `qualified` | `YES` only if enriched, sample large enough, and median over threshold |
| `email` | Email listed publicly on the profile, when present |
| `link` | Link in bio |
| `bio` / `captions` | Raw text the relevance score was computed from |
| `profile_url` | Canonical profile URL |
| `found_via` | How the lead was discovered. `[no data xN]` means it was retired |
| `batch` | Discovery batch number. Higher is more recent |
| `found_by_query` | Search query or tag that surfaced it |
| `enriched` | Whether the profile has been visited and processed |
| `tries` | Attempts made. Two retires a lead |
| `was_visited` | Whether the URL was ever navigated to |

## Reading a blank median

A blank `median_views` is not a rejection. Check the last three columns:

- `enriched=no`, `tries=0`, `was_visited=no` — still queued, never reached.
- `enriched=no`, `tries=1` — one attempt failed, it will be retried.
- `enriched=YES` with `[no data x2]` in `found_via` — retired after two attempts.

A run that stops early leaves most of the queue in the first state. That is
backlog, not failure.
