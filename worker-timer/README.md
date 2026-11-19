# biocat-headlines-timer

This Worker is an outside timer for the headlines update. GitHub's own cron on `.github/workflows/headlines.yml` stays in place, including the backup slots. This Worker fires the same workflow on the main slots (`20 1,7,13,19 * * *`) when the public edition is at least 3 hours old.

It deploys with no routes. `fetch` returns 404. Only the scheduled handler runs.

## Token

Create a fine-grained personal access token:

- Repository access: **Only select repositories**, and choose `biocatalystfeed/biocatalystfeed.github.io`.
- Repository permissions: **Actions** read and write, **Metadata** read-only. Metadata is the required read-only permission GitHub adds for a fine-grained token. Every other permission stays **No access**.
- Expiration: **90 days**.

The token is a secret. It is not written in this directory.

## Set the secret

From this directory:

```sh
npx wrangler secret put GH_DISPATCH_TOKEN
```

Paste the token when prompted. Wrangler stores it on the Worker. Do not pass it on the command line, and do not commit it.

## Verify

1. Deploy with `npx wrangler deploy`. The output should show the cron trigger and no routes.
2. In the Cloudflare dashboard, trigger the cron once, or wait for the next `20` minute slot (01:20, 07:20, 13:20, or 19:20 UTC).
3. Read the Worker logs. A current edition logs `fresh, skip`. An old or unreadable edition logs `dispatch 204`. A missing secret logs `GH_DISPATCH_TOKEN not set; skipping`. The logs never include the token or request headers.
4. On GitHub, the **Update headlines** workflow should show a `workflow_dispatch` run on `main` when the Worker dispatched.
