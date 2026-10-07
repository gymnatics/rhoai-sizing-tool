# Upstream Sync — Phase 2: Cherry-Pick Execution

**Date:** 2026-10-07
**Branch:** `upstream-fixes/gpu-and-throughput` (created off `main`)
**Scope:** Execute the 2 confirmed gaps identified in [Phase 1](./phase1-feasibility.md) (PR #157, `fed978c`), and independently spot-check the 8 "very likely already present" candidates noted in Phase 1 §6, without blindly trusting the earlier inference.

## 0. Setup

- `upstream` remote already existed (`https://github.com/redhat-performance/configiq.git`); `git fetch upstream --tags` re-run to refresh — no new commits or tags landed since Phase 1 (still `v0.2.1`–`v0.2.9`).
- Branch created: `git checkout -b upstream-fixes/gpu-and-throughput main`.

## 1. Cherry-picks applied

All three commits applied **cleanly, with zero conflicts**, exactly as Phase 1's dry run predicted. No path/naming adaptations were needed — our fork's `services/aisimulators/...` layout and `app/kv-cache/...`, `app/predict/...` structure already matched upstream's post-rename state.

| # | Upstream SHA | Our new SHA | Message | Files touched |
|---|---|---|---|---|
| 1 | `fabb7c42cfd5d4d1c00358e5fcc9aedbfa059c45` | `afcfbdb6337523f418b8aba2f99534b84a0ab8fb` | `fix: align KV cache backend defaults` | `app/kv-cache/KvCacheCalc.tsx`, `app/kv-cache/KvCacheCalc.module.css`, `lib/hooks/useCatalog.ts`, `lib/hooks/useCatalog.test.ts` (new file) |
| 2 | `87e849fce627e0db7c9bf5249100aa0e1bb25c09` | `3434fc5db1425c2e45d0b69c058f0500362f3105` | `fix: preserve KV cache memory edits` | `app/kv-cache/KvCacheCalc.tsx` |
| 3 | `fed978c6452577b2a4203e2c2f5f35c239b0b899` | `4c9a558b8e4e78eece22c9f468aed441e8c9c016` | `fix: derive predict throughput per GPU` | `services/aisimulators/tools/api_service/app.py`, `services/aisimulators/tests/unit/tools/test_api_service.py` |

All three commits were cherry-picked with `-x`, so each new commit message carries a trailing `(cherry picked from commit <original-sha>)` line linking back to upstream.

**Together, commits #1–#2 complete PR #157** (KV-cache serving-mode + backend memory defaults — loads memory-fraction/fraction-kind defaults from the selected backend's catalog metadata, tracks a "user edited" ref so defaults don't clobber manual edits, restyles the KV-cache serving-mode control, and extracts a `mapBackendOption()` helper in `useCatalog.ts`).

**Commit #3** adds `_prediction_total_gpus()` to `app.py`: when the backend doesn't report `num_total_gpus` directly, it derives total GPU count from TP/PP/attention-DP/worker counts (handled separately for aggregated vs. disaggregated prefill/decode), fixing per-GPU throughput miscalculation on `/api/predict` responses when the backend omits that field.

No conflicts arose, so no "resolve carefully" or "abort and note" scenarios from the task instructions were triggered.

## 2. Spot-check of the 8 "likely already present" candidates

Per Phase 1 §6, these 8 commits were flagged as very likely already present (same saga, touching files already confirmed byte-identical to `v0.2.9`) but were not individually dry-run tested. This phase ran a non-destructive, evidence-based check for each — **no blind cherry-picks**.

**Method:**
1. `git show <sha> --stat` to get exact files touched.
2. `git merge-base --is-ancestor <sha> v0.2.9` to confirm the commit is actually part of `v0.2.9`'s history (not a tangent branch).
3. `git diff v0.2.9 -- <file>` for every touched file, evaluated **on `main`** (i.e. before any Phase 2 cherry-picks), to isolate the true pre-existing baseline.

| # | SHA | Message | Ancestor of v0.2.9? | Files touched | Diff vs v0.2.9 on `main` (pre-cherry-pick) | Verdict |
|---|---|---|---|---|---|---|
| 1 | `9fe042c13f8317e65e7f3301f90ef81ab646cd91` | `fix(aisimulators): bound native recommendation search` | ✅ Yes | `services/aisimulators/tools/api_service/app.py`, `.../tests/unit/tools/test_api_service.py` | 0 lines (byte-identical) | **CONFIRMED SKIP** — already present |
| 2 | `7943e307eaf7e55e349d65941cc47e45ae2e1082` | `fix(aisimulators): preserve default context parallelism` | ✅ Yes | `services/aisimulators/tools/api_service/app.py` | 0 lines | **CONFIRMED SKIP** |
| 3 | `b421ac74e4f52a4d8007d377cf609b247a5688d2` | `fix(aisimulators): preserve bounded search inputs` | ✅ Yes | `services/aisimulators/tools/api_service/app.py` | 0 lines | **CONFIRMED SKIP** |
| 4 | `fe514b3bbd14c06a0720dec263cc71253855d1b6` | `fix: bound recommendation search budget` | ✅ Yes | `services/aisimulators/tools/api_service/app.py`, `.../tests/unit/tools/test_api_service.py` | 0 lines | **CONFIRMED SKIP** |
| 5 | `99c22cc65490f0c6a98f0aba36f629c3261e92ac` | `fix: optimize narrow recommendation windows` | ✅ Yes | `services/aisimulators/tools/api_service/app.py`, `.../tests/unit/tools/test_api_service.py` | 0 lines | **CONFIRMED SKIP** |
| 6 | `aba80a0dfdc791c08b0a025310a85ffafdb4b098` | `fix: harden backend metadata and memory defaults` | ✅ Yes | `app/api/catalog/route.ts`, `app/predict/Performance.tsx`, `app/settings/Settings.tsx`, `services/aisimulators/tools/api_service/app.py`, `.../tests/unit/tools/test_api_service.py` | 0 lines across **all 5 files** | **CONFIRMED SKIP** |
| 7 | `c8945151821d93efb52aed2daa4586e0754da27b` | `fix: normalize engine metrics in REST responses` | ✅ Yes | `services/aisimulators/tools/api_service/app.py`, `.../tests/unit/tools/test_api_service.py` | 0 lines | **CONFIRMED SKIP** |
| 8 | `b93b1590b8fae0d409684054de99d257d8be2618` | `fix: patch vLLM 0.30 metrics compatibility` | ✅ Yes | `services/tritonserver/Containerfile`, `services/tritonserver/patches/vllm-030-metrics.patch` | N/A — see below | **CONFIRMED SKIP (not applicable)** |

**Note on #8 (`b93b159`):** this one differs in kind from the other seven. It doesn't touch `app.py` at all — it touches a `services/tritonserver/` Containerfile and vLLM patch file for a Triton Inference Server + FIL/vLLM-backend container image. **Our fork does not ship a `services/tritonserver/` directory at all** (`services/` in our tree only contains `aicostings`, `aisimulators`, `configiq-py`, `scripts`). This is an intentional architectural divergence in the RHOAI fork, not a missing fix — there is no Triton service here to patch. Confirmed via directory listing, not just file diff. SKIP is correct, but for a different reason than the other seven (inapplicable vs. already-incorporated).

**Result: no new gaps found.** All 8 spot-check commits are confirmed either already fully incorporated (1–7, via byte-identical files that are provable ancestors of `v0.2.9`) or structurally inapplicable to our fork (8). This empirically validates Phase 1's "our baseline is ~v0.2.9" inference — it was not merely plausible, it holds exactly across all 8 additional commits checked.

## 3. excel-service/ impact check

Per task step 7, confirmed via `git show <sha> --stat --name-only` across **all 11 commits examined** (the 3 cherry-picked + the 8 spot-checked) that **none** touch `excel-service/`. All changes are confined to the Next.js app (`app/`, `lib/hooks/`), the `services/aisimulators/` Python service, and (for the inapplicable `b93b159`) a nonexistent `services/tritonserver/` directory. The Python `excel-service/` is entirely unaffected by this round of fixes, as expected (these are GPU-sizing/KV-cache/throughput fixes, unrelated to Excel export).

## 4. Verification suite results

Run from repo root on the `upstream-fixes/gpu-and-throughput` branch, after all 3 cherry-picks were applied, with the repo's existing `node_modules` (already installed):

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ **PASS** — zero errors |
| ESLint | `npx eslint .` | ✅ **PASS** — zero errors/warnings |
| Build | `npm run build` | ✅ **PASS** — compiled successfully, all 30 routes generated (static + dynamic) |
| Tests | `npm run test` (vitest) | ✅ **PASS** — 28 test files, 299 tests, all passed |

**No adaptations were required.** Because the cherry-picks applied with zero conflicts and our fork's file layout/naming (the `aiconfigurator` → `aisimulators` rename, the `PerformanceEstimate.tsx` → `Performance.tsx` rename, Next.js 16) already matched upstream's post-`v0.2.9` state, the cherry-picked code compiled, linted, built, and tested without any manual changes to imports, paths, or types. No semantic behavior was altered from the original upstream commits.

(Note: `npm run build` emits a harmless `fatal: No tags can describe '<sha>'` line from `scripts/inject-build-metadata.js`'s `git describe` call, because the new cherry-pick commits aren't yet reachable from any tag in this fork. This does not affect build success — the build-metadata injection step tolerates the failure and falls back gracefully, and the build completes normally.)

## 5. Branch / PR status

- Branch `upstream-fixes/gpu-and-throughput` created off `main`, containing:
  1. `afcfbdb` — `fix: align KV cache backend defaults` (cherry-picked, PR #157 part 1/2)
  2. `3434fc5` — `fix: preserve KV cache memory edits` (cherry-picked, PR #157 part 2/2)
  3. `4c9a558` — `fix: derive predict throughput per GPU` (cherry-picked)
  4. This report doc commit
- Branch was **not** merged into `main`, per instructions.
- Pushed to `origin` as `upstream-fixes/gpu-and-throughput`.
- See final chat report for PR creation status.

## 6. Summary

| Metric | Count |
|---|---|
| Commits cherry-picked | 3 (2 logical fixes: PR #157 [2 commits] + `fed978c`) |
| Cherry-picks with conflicts | 0 |
| Cherry-picks aborted/reverted | 0 |
| Spot-check commits confirmed already present | 7 |
| Spot-check commits confirmed inapplicable | 1 (`b93b159` — no `tritonserver` service in fork) |
| New gaps found beyond original Phase 1 scope | 0 |
| Verification checks passed | 4 / 4 (tsc, eslint, build, test) |
| `excel-service/` impact | None — confirmed across all 11 commits examined |
