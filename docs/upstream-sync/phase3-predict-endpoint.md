# Upstream Sync — Phase 3: `/estimate` vs `/predict` Endpoint Verification

**Date:** 2026-10-07
**Scope:** Verify an earlier, unverified claim that upstream deprecated the `/estimate` endpoint in favor of a new `/predict` endpoint around `v0.2.7`, and that our fork might still depend on a broken/removed `/estimate` endpoint. This phase is read-only investigation; no code was changed.

## TL;DR

**The original claim's shape was right (a `/predict` → `/estimate` deprecation did happen), but the risk assessment was wrong.** `/estimate` is not broken and is not at imminent risk — it is a deliberate, still-functional, same-handler compatibility alias for `/predict`, on both upstream's current `main` and the live production backend. Our fork is **byte-for-byte identical** to upstream's current `main` for every file in this code path. **Recommendation: NO ACTION NEEDED.**

## 1. Our fork's code paths

- `app/api/estimate/route.ts` → calls `handlePredict(req, deprecated=true, metricRoute='estimate')`
- `app/api/predict/route.ts` → calls `handlePredict(req)` (not deprecated)
- Both go through the same `lib/api/predict-proxy.ts::handlePredict()`, which **always** fetches `${AISIMULATORS_GATEWAY_URL}/predict`, regardless of which Next.js route was hit. The `deprecated` flag only controls whether *our own* response carries synthetic `Deprecation` / `Sunset` / `Link` HTTP headers — it does not change which backend path is called.
- `lib/api/estimate-adapter.ts` (used by `app/predict/Performance.tsx`) posts directly to `/api/predict?include=config,memory` — it never calls `/api/estimate` at all.
- Searched the whole app/UI layer for literal `/api/estimate` call sites: **none exist**. The only hits are a comment in `.env.example` and a row in `docs/ARCHITECTURE_DETAILED.md`'s route table. `/api/estimate` is effectively dead code kept solely as a **public backwards-compatibility surface** for any external caller still using it — our own frontend doesn't depend on it.
- `.env.example` confirms the real gateway: `AISIMULATORS_GATEWAY_URL=https://aisimulators.dev`.

**Conclusion for (c):** our fork's `/api/estimate` route works end-to-end today — but functionally it was *already* just forwarding to the backend's `/predict`, not `/estimate`, from day one of this fork (see §3).

## 2. Live backend verification (`https://aisimulators.dev`)

All requests made directly against the real production gateway on 2026-10-07:

| Check | Result |
|---|---|
| `GET /openapi.json` | `200 OK`. Both `/estimate` and `/predict` are listed paths, **same operation** (`summary: "Post Predict"` for both — i.e. one Python function handles both routes). `/estimate` → `deprecated: true`. `/predict` → `deprecated: false`. |
| `GET /systems`, `GET /models` | `200 OK` — service healthy. |
| `POST /estimate` with a minimal real payload (`Qwen/Qwen3-32B`, `h200_sxm`, isl 512/osl 128, tp 1, batch 8) | `HTTP/2 200`, full valid JSON response (`ttft`, `tpot`, `tokens_per_second`, etc. all populated with real numbers). No warning field, no redirect, no error. |
| `POST /predict` with the identical payload | `HTTP/2 200`, **byte-identical response body** to the `/estimate` call above (only `x-upstream-server` differs — load-balanced to a different backend process). |
| Response headers on either route | No `Deprecation`/`Sunset`/`Warning` headers come from the **backend** itself — that signaling only exists in our/upstream's Next.js proxy layer, not on the raw AISimulators API. |

**Conclusion for (a):** `/estimate` is **live and fully functional** right now. It is marked `deprecated: true` in the OpenAPI schema (documentation metadata only — FastAPI's `deprecated=True` just affects Swagger/OpenAPI display), but it is not degraded, warned, redirected, or behaviorally different from `/predict` in any way. Both routes are registered against the exact same handler function.

## 3. Upstream source-code state (current `main`, fetched 2026-10-07)

Our fork has an `upstream` remote (`redhat-performance/configiq`) already configured from Phase 1. `git fetch upstream main` pulled upstream's `HEAD` (merge commit `57dce04`, 2026-10-07).

**`diff` of every file in this code path, upstream/main vs. our fork, working tree:**

| File | Result |
|---|---|
| `app/api/estimate/route.ts` | **Identical** |
| `app/api/predict/route.ts` | **Identical** |
| `lib/api/predict-proxy.ts` | **Identical** (including the `DEPRECATION_HEADERS` constant, `Sunset: 'Wed, 30 Sep 2026 00:00:00 GMT'`) |
| `services/aisimulators/docs/api/openapi.yaml` | **Identical** |
| `services/aisimulators/tools/api_service/app.py` | Minor, **unrelated** drift (an `_prediction_total_gpus()` helper and MCP-mount ordering tweak landed upstream after our fork point — not part of the `/estimate`/`/predict` routing). The two route registrations themselves are identical: |

```python
app.post("/predict", response_model=EstimateResponse)(post_predict)
app.post("/estimate", response_model=EstimateResponse, deprecated=True)(post_predict)
```

Upstream's backend service (the FastAPI wrapper that `aisimulators.dev` actually runs) registers **both paths against the same `post_predict` function**. There is no separate, older `/estimate` implementation anywhere — it was never "a different endpoint that might get removed," it is the same code reachable by two URLs, one of which is flagged deprecated for documentation/discoverability purposes.

**Where the migration actually happened:** `git log` on `services/aisimulators/tools/api_service/app.py` surfaces the real commit:

```
931dabd feat: add predict API and deprecate estimate      (2026-09-24)
365995b fix: apply estimate configuration review fixes
4c8c677 feat: wire predict controls to AISimulate
fed978c fix: derive predict throughput per GPU             (2026-10-06, post-v0.2.9)
```

`931dabd` ("feat: add predict API and deprecate estimate", 2026-09-24) is the commit that introduced `/predict` as the canonical route and turned `/estimate` into a compatibility alias with deprecation headers — on both the Next.js proxy layer and the Python backend simultaneously, in one atomic change. **Our fork's single "Initial commit" (2026-10-05) already starts from a source snapshot that includes this commit** — i.e., this migration was never "missing" from our fork; our fork was created *after* upstream did it, so we inherited the finished migration for free, alias and deprecation headers included.

**Conclusion for (c):** upstream's own `app/api/estimate/route.ts` has **not** been deleted, and their backend's `/estimate` route has **not** been removed. Both remain intentionally present as a documented compatibility shim.

## 4. The one real wrinkle: the `Sunset` date has already passed

`lib/api/predict-proxy.ts`'s `DEPRECATION_HEADERS` constant sets:

```
Sunset: 'Wed, 30 Sep 2026 00:00:00 GMT'
```

Today is **2026-10-07** — seven days past that advisory sunset date. Per [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594), the `Sunset` header is informational/advisory only; it does not enforce removal. Live-testing above confirms the endpoint is still fully served past its stated sunset date, on both upstream and the shared production backend — the date appears to have slipped without an actual removal. This is worth tracking (the deadline has lapsed, so a real removal could happen with little additional notice), but it is not currently causing any breakage, and upstream itself is in the identical position (their `main` carries the exact same lapsed date).

## 5. Answers to the task's specific questions

| # | Question | Answer |
|---|---|---|
| (a) | Is `/estimate` live and functional on the real backend right now? | **Yes, fully live and functional.** Confirmed via direct `curl` against `https://aisimulators.dev/estimate` — returns a normal `200` with real prediction data, identical in substance to `/predict`. |
| (b) | Is it marked deprecated? | **Yes**, via OpenAPI `deprecated: true` (backend) and via `Deprecation`/`Sunset`/`Link` response headers (our/upstream's Next.js proxy layer only — not emitted by the raw backend). The advisory `Sunset` date (2026-09-30) has already passed without removal. |
| (c) | Does our fork's own `/api/estimate` route still work end-to-end today? | **Yes.** It's identical to upstream's current implementation, which itself just forwards to the backend's `/predict` path (not `/estimate`) and decorates the response with our own deprecation headers. Our frontend code never actually calls `/api/estimate` anyway — it's inert, externally-facing back-compat surface only. |
| (d) | Near-term removal risk, based on upstream's current `main`? | **Low.** Upstream's own `main`, fetched same-day, still ships `/api/estimate/route.ts`, still registers the backend `/estimate` path, and the live gateway still serves it correctly. Nothing in upstream's current source signals an imminent hard removal — if anything, the lapsed-but-unenforced `Sunset` date suggests the deprecation is being carried indefinitely as a soft compatibility shim rather than actively sunset. |

## 6. Recommendation

### ✅ NO ACTION NEEDED

**Reasoning:**
1. `/estimate` is not broken today, on either the real live backend or upstream's source.
2. Our fork is bit-for-bit identical to upstream's current `main` for every file in this code path (routes, proxy, OpenAPI spec) — there is no drift to fix and nothing to cherry-pick.
3. Our own frontend doesn't call `/api/estimate` internally at all (it already uses `/api/predict` via `lib/api/estimate-adapter.ts`), so even a future hard removal of the backend's `/estimate` alias would have **zero impact on our app's own functionality** — only external third-party callers of our public `/api/estimate` compatibility route would be affected, and that's an upstream-owned contract, not something this fork controls or needs to pre-empt.
4. The only mildly notable fact — the advisory `Sunset` date having passed without enforcement — is identical on upstream's own `main`, so it's not a fork-specific gap to close.

If a future sync pass wants to be extra defensive, the only forward-looking note worth keeping on file is: *if/when upstream's backend eventually hard-removes `/estimate` for real, no code change is needed on our side either* — our `/api/estimate` Next.js route already calls the backend's `/predict` path internally, not `/estimate`, so the backend-side removal of `/estimate` would not affect our proxy at all. (It would only affect any outside caller hitting *our* `/api/estimate` directly, which is an upstream-inherited back-compat contract, not a bug.)

No migration plan is needed because there is nothing to migrate — the migration already happened, before our fork existed, and our fork already reflects its finished state.
