# DeepLook search

Separate from the browser package. A question goes to Mimo. Page text comes from the DeepLook browser at `POST http://127.0.0.1:47231/v1/open`.

## Run

Start the browser API first, from the `browser-api` worktree:

```bash
npm run api
```

Then, in this directory:

```bash
export MIMO_API_KEY=your-xiaomi-mimo-token
npm install
npm run dev
```

Open [http://127.0.0.1:47241](http://127.0.0.1:47241).

`MIMO_API_KEY` is required. Without it the page still opens sources, then stops with that variable name in the error. Optional `MIMO_MODEL` defaults to `mimo-v2.6-flash`. Token-plan keys use `https://token-plan-sgp.xiaomimimo.com/v1/chat/completions` with an `api-key` header.

The system prompt is read from `server/system-prompt.md`; `DEEPLOOK_PROMPT_PATH` overrides that path. `DEEPLOOK_BROWSER_URL` overrides the browser endpoint (default `http://127.0.0.1:47231/v1/open`).

## Production

`npm run build` writes `dist/`. `npm start` runs `server/main.ts`, which serves `dist/` plus `/api/query` and `/api/service` on `HOST`:`PORT` (default `127.0.0.1:47241`). The `Dockerfile` in this directory does both; on Coolify set `HOST=0.0.0.0`, `MIMO_API_KEY`, and `DEEPLOOK_BROWSER_URL=http://deeplook-browser:47231/v1/open`.

## Nymetric

Choosing Nymetric on the page checks [nymetric.com](https://nymetric.com). That site has no public API yet, so the choice shows the goal and builds no tools.
