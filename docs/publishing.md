# Publishing on itch.io, with leaderboards

Once this is set up, pushing to `main` on GitHub updates everything:

```
git push (main)
 ├─ GitHub Actions: typecheck + tests ─▶ build ─▶ butler ─▶ itch.io (the html5 upload)
 └─ Vercel:          tests ─▶ build ─▶ https://<project>.vercel.app
                                          ├─ the game (a second place to play it)
                                          └─ /api/*  the leaderboard server ─▶ Upstash Redis
```

If the tests fail, nothing is uploaded. Everything below is free:

| Service | What it does here | Free plan |
|---|---|---|
| itch.io | hosts the game page | Free to publish. itch.io only takes a share of money you make, and you pick the share (default 10%, can be 0%). A free game pays nothing. |
| Vercel (Hobby) | runs the leaderboard server (and a copy of the game) | Free for non-commercial projects. About 4 hours of CPU a month, which is enough to check a few thousand 30-minute runs. |
| Upstash Redis | stores boards, replays and sign-ins | 256 MB and 500,000 commands a month. Showing a board is about 3 commands, posting a run about 10. |
| GitHub Actions | tests and uploads to itch.io | Free for public repositories (2,000 minutes a month for private ones; a run takes about 2). |

The setup takes about half an hour, once. After that, updating is just `git push`.

## 1. Make the itch.io page

1. Make an itch.io account, then go to **Dashboard → Create new project**.
2. Set **Kind of project** to **HTML**, and **Pricing** to *No payments* (or *Donate*).
3. For the first upload, either:
   - let GitHub do it (step 3 below), then come back here, or
   - run `npm run build`, zip the *contents* of `dist/` (so `index.html` is at the top of the zip), and upload the zip.
4. On the upload, tick **This file will be played in the browser**.
5. **Embed options:** viewport 1280 × 720, tick **Mobile friendly** (landscape) and **Fullscreen button**.
6. Save. The page stays a draft until you set **Visibility** to *Public*.

The page's address is `https://<user>.itch.io/<game>`. Steps 3 and 4 need it as `<user>/<game>`.

## 2. Set up the leaderboard server (Vercel and Upstash)

1. **Vercel:** sign up at vercel.com with your GitHub account (Hobby plan). **Add New → Project**, import this repository and deploy it. `vercel.json` already sets the build command (`npm run build:vercel`). You get an address like `https://fodeez-nutz.vercel.app`, where the game is playable too.
2. **Database:** in the Vercel project, open **Storage**, choose **Upstash for Redis** (free plan) and connect it to the project. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables. The server also accepts `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
3. **itch.io sign-in:** go to <https://itch.io/user/settings/oauth-apps> and register an app named *Fodeez Nutz*, with the redirect URI `https://<your-vercel-address>/api/auth/callback`. It has to match exactly. Copy the **client ID**.
4. In Vercel, under **Settings → Environment Variables**, add:
   - `ITCH_CLIENT_ID`: the client ID from the last step.
   - `ADMIN_TOKEN` (optional): a long random string, for taking down cheated runs (see Moderation, below).
5. Redeploy (**Deployments → ⋯ → Redeploy**), because environment variables only reach new deployments.
6. Check `https://<your-vercel-address>/api/health`. It should say `"ok":true,"signIn":true`.

## 3. Connect GitHub to itch.io

1. Make an itch.io API key at <https://itch.io/user/settings/api-keys>.
2. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add:
   - **Secret** `BUTLER_API_KEY`: the API key.
   - **Variable** `ITCH_GAME`: `<user>/<game>`, from step 1.
   - **Variable** `API_URL`: `https://<your-vercel-address>`, so the itch.io build knows where the leaderboards are.
3. Push to `main`, or run **Actions → Test and deploy → Run workflow**. The workflow uploads `dist/` to the `html5` channel of your game with [butler](https://itch.io/docs/butler/).
4. If this is the first upload, tick **This file will be played in the browser** on it on the itch.io edit page (step 1.4). Later uploads replace it and keep that setting.

## Updating the game

Commit and push to `main`. The Actions tab shows the tests and the upload, and Vercel's dashboard shows its deploy. Both take a minute or two. butler only sends the parts that changed. Players get the new version the next time they load the page.

- **Saves survive updates.** They're kept in the player's browser under itch.io's game domain, which stays the same from one build to the next.
- **Leaderboards survive updates** too, unless the update changes a map's layout or bumps `PHYSICS_VERSION`. Then that map's boards start fresh, because old replays wouldn't play out the same. Runs from the old version can't be posted, and a player still on the old version sees a "reload to update" message on the board.
- **Without GitHub:** run `npm run build`, then `butler push dist <user>/<game>:html5`, or upload a new zip on the itch.io edit page and delete the old one.

## Moderation

Every posted run has been replayed by the server, so a fake time can't get on the board. A run made by a bot (a "TAS") with human-looking inputs could still pass, though. To take an entry down, and optionally stop that account posting again:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "https://<your-vercel-address>/api/admin/remove?level=crane:newage&user=itch-12345&ban=1"
```

The `user` id is in the board's data at `https://<your-vercel-address>/api/board?level=crane:newage`.

## Trying it locally

`npm run dev` runs the server too, with an in-memory store and a sign-in where you type any name, so you can test everything without accounts. To test against real itch.io and Upstash instead, set `ITCH_CLIENT_ID`, `KV_REST_API_URL` and `KV_REST_API_TOKEN` before `npm run dev`, and register `http://localhost:5173/api/auth/callback` as a second redirect URI. itch.io allows any port on localhost.

## When something's wrong

| Symptom | Cause |
|---|---|
| No Leaderboards button on itch.io | `API_URL` wasn't set when the itch.io build ran. Set it, then re-run the workflow. |
| "Sign-in is not set up" | `ITCH_CLIENT_ID` is missing in Vercel, or the project wasn't redeployed after adding it. |
| itch.io complains about the redirect URI | The OAuth app's redirect URI doesn't exactly match `https://<your-vercel-address>/api/auth/callback`. |
| "The leaderboard database isn't connected yet" | Upstash isn't connected to the Vercel project, or the project wasn't redeployed. |
| Progress or sign-in is forgotten on itch.io | The browser blocks storage for games in frames (Safari, or Chrome with third-party cookies blocked). The game still runs, but forgets between visits. Those players can play the Vercel copy, where saving works normally. |
