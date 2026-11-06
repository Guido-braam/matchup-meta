# Static site on GitHub Pages, data refreshed by a scheduled committed job

The site is static files on GitHub Pages from a public repo. A scheduled GitHub Action fetches Trainerhill and Limitless data, rebuilds the data JSON and commits it, so Pages republishes. We chose this over a host with its own build (Cloudflare Pages, Netlify) to keep one account and to get the data's history in git; it is why the repo must be public (Pages on the free plan) and why nothing private may live in it.

## Consequences

- The raw Limitless download is kept in the Actions cache, not in the repo: committing it (branch or release asset) would republish raw source data. The cache is evicted after 7 days unused and a run without it can take hours, so the job runs every 6 days (`*/6` on the day of the month) instead of weekly.
- Trainerhill matchups are only refetched on the run on the 1st of the month; Limitless on every run. The matchup data is therefore up to a month older than the share data, by choice.
