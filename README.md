# Persona Creator Finder

A Tampermonkey userscript that finds creators on Instagram and TikTok and
qualifies them by **median views** rather than follower count.

It runs entirely in the browser against pages you are already logged into.
There is no server, no API key and no build step.

## Why median views

Follower count is a vanity number and a bad pricing basis. A 1.4M-follower
account whose posts land at 50k views is worth less than a 26k-follower
account whose posts land at 58k. The script samples the view counts visible
on a profile's recent posts, takes the **median** (not the mean, which one
viral video distorts), and qualifies on that.

The ratio of median views to followers is the signal worth watching: a high
ratio usually means an account with real reach that nobody is bidding for
yet.

## What it does

| Pass | Platform | What it does |
|---|---|---|
| Hashtag pass | TikTok | Walks tag pages and collects handles |
| IG search pass | Instagram | Runs keyword searches and queues post URLs |
| Resolve posts | Instagram | Opens queued posts to recover the author handle |
| Enrich profiles | Both | Visits each profile, samples post views, computes the median |

Instagram needs the extra resolve step because keyword search returns
`/p/<id>/` post URLs with no username attached. TikTok tag pages expose
handles directly, so it skips straight to enrichment.

Results export to CSV with handle, platform, followers, median views, the
sampled view list, a relevance score, email (when the profile lists one),
bio, captions and provenance fields.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome, Edge or Firefox.
2. Open the Tampermonkey dashboard, choose **Create a new script**.
3. Replace the contents with [`src/persona-creator-finder.user.js`](src/persona-creator-finder.user.js) and save.
4. Open `https://www.tiktok.com/@someprofile` or any Instagram profile. A control panel appears in the corner.

The script only runs on `instagram.com` and `tiktok.com`, and it needs you
signed in on the site you are running against. Signed-out browsing gets
rate limited far more aggressively.

## Running it

Start from a **profile page**, not a feed or a tag page. Then:

- **Rebuild enrich queue** to pick up anything outstanding.
- **Enrich profiles** to start the pass.
- **Export all** / **Export qualified** when you are done.

### Settings that matter

| Setting | Suggested | Why |
|---|---|---|
| Min average views | `50000` | The qualifying threshold |
| Min relevance | `0` | Tag-sourced leads have no bio to score yet, so anything higher silently drops them |
| Max profiles per run | `40` | Larger runs raise the chance of a rate limit |
| Seconds between profiles | `9` | Lower is faster and gets you blocked sooner |

`minSample`, `harvestComments` and `enrichComments` are code-level defaults
near the top of the file rather than panel fields.

## Rate limiting

Both platforms throttle sustained profile browsing, and once you have been
flagged the threshold stays low for hours. The script stops on its own when
it detects a block page or six consecutive empty profiles.

If that happens, **wait several hours before the next pass.** Restarting
into a live throttle extends it. To test whether it has lifted, load a
single profile by hand rather than starting a run.

## Data and privacy

CSV exports contain other people's personal data: names, emails, follower
counts, view histories. `.gitignore` excludes `*.csv` and `*.xlsx` for that
reason. Keep exports out of version control, and handle them in line with
whatever privacy rules apply to you.

This tool reads public profile pages in a logged-in browser session at
human-ish pacing. It does not bypass authentication, solve CAPTCHAs or
access anything private. Automated collection may still conflict with
Instagram's and TikTok's terms of service. That is your call to make.

## A note on whether you should use this at all

Creator discovery is a solved commercial problem. Paid databases index
hundreds of millions of creators with filters on views, engagement and
**audience geography**, which this script cannot determine and which
matters a great deal if you are buying reach in a specific market.

This exists because it was cheaper than a subscription at the time. If you
are doing this at any scale, price the alternatives first.

## License

MIT. See [LICENSE](LICENSE).
