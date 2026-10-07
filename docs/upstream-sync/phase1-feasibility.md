# Upstream Sync — Phase 1 Feasibility Assessment

**Date:** 2026-10-07
**Scope:** Verify 7 candidate GPU-sizing-accuracy fixes reported by a prior (unverified) AI investigation against the real upstream history of [redhat-performance/configiq](https://github.com/redhat-performance/configiq), and assess cherry-pick feasibility into this fork.

## 0. Setup

- `upstream` remote added: `https://github.com/redhat-performance/configiq.git`
- `git fetch upstream --tags` succeeded. Tags confirmed present: `v0.2.6`, `v0.2.7`, `v0.2.8`, `v0.2.9` (and earlier: `v0.2.1`–`v0.2.5`).
- Our fork's single-commit history (`main`, 3 commits, no shared ancestry with upstream) was diffed file-by-file against each upstream tag to find the *real* fork point, since there is no `git merge-base`.

### ⚠️ Important correction to the task's premise

The task assumed our fork point is close to `v0.2.5` (package.json says `"version": "0.2.5"`, ~190 commits / 273 files behind). That package-version number is **misleading** — upstream's `package.json` `"version"` field stayed `"0.2.5"` all the way through `v0.2.9` (it's not bumped per release; releases are tracked via git tags only).

Diffing our fork's initial commit against each tag tells the real story:

| Compared to | Differing files |
|---|---|
| `v0.2.5` | 292 |
| `v0.2.6` | 261 |
| `v0.2.7` | 219 |
| `v0.2.8` | 174 |
| `v0.2.9` | **74** |

Our fork is actually **much closer to `v0.2.9`** than to `v0.2.5`. Supporting evidence:
- Our fork already has the `services/aiconfigurator` → `services/aisimulators` rename (no `aiconfigurator` references exist anywhere in our tree).
- Our fork's Next.js version is `^16.3.6`, identical to upstream at `v0.2.9` (upstream was `^14.2.0` at `v0.2.5`).
- `services/aisimulators/tools/api_service/app.py` — the file touched by 5 of the 7 leads — is **byte-for-byte identical** between our fork and upstream `v0.2.9`.

Of the 74 files that *do* differ from `v0.2.9`, nearly all are clearly our own RHOAI customizations (README, wizard step pages, `WizardContext`, `excel-service/`, `data/*.json` roadmap/reference files, examples, Containerfiles, branding). This changes the practical conclusion significantly: **most of the 7 leads turned out to already be present** in our fork, carried in "for free" because our fork's actual source snapshot sits near `v0.2.9`, not `v0.2.5`. The real gaps are narrower and more specific than the original premise suggested.

## 1. Lead-by-lead verification

| # | Lead (as given) | Real SHA | Verified message | In range v0.2.5→v0.2.9? |
|---|---|---|---|---|
| 1 | preserve prefilled GPU system value when applying fallback | `0ac5f68f809883bdbaa03c73e60fc481527cd792` | `fix: preserve prefilled GPU system value when applying fallback` | ✅ exact match |
| 2 | improve GPU display-name handling with startup-time fallback dict | `58466b67a374c0e6f299291a4ea0858b995557c8` | `fix: improve GPU display-name handling with startup-time fallback dict` | ✅ exact match |
| 3 | use bounded native recommendation sweep | `9ce939bdd8a5eb6acdb0b9b82c0786058ed18334` | `fix(aisimulators): use bounded native recommendation sweep` | ✅ exact match (scoped prefix added) |
| 4 | continue search past infeasible GPU windows | `1c10ed4b8ad0fef972d0e64376ef6a30aa7e2abb` | `fix: continue search past infeasible GPU windows` | ✅ exact match |
| 5 | KV-cache serving mode + backend memory defaults (PR #157) | `fabb7c42cfd5d4d1c00358e5fcc9aedbfa059c45` + `87e849fce627e0db7c9bf5249100aa0e1bb25c09` (merge commit `ad641403e914cdafaee6d42deef2dcc63df7b6d0`) | `fix: align KV cache backend defaults` + `fix: preserve KV cache memory edits` | ✅ exact match, PR #157 confirmed via `gh pr view` |
| 6 | Recommend peak memory display fix (PR #145) | `735a82570...` (merge commit `c315bc30c8866dca0e7bd0368239f1663a165c6d`) | `fix: show recommend memory breakdown` | ✅ exact match, PR #145 confirmed via `gh pr view` |
| 7 | derive predict throughput per GPU | `fed978c6452577b2a4203e2c2f5f35c239b0b899` | `fix: derive predict throughput per GPU` | ⚠️ exact message match, but commit date is **2026-10-06**, i.e. it lands on `upstream/main` **after** the `v0.2.9` tag (2026-10-04). Not part of the v0.2.9 release; it's an unreleased, newer fix. |

All 7 leads' *messages* were verified as real, non-paraphrased commits — no fabrications. Lead #7 is the only one that needed a correction: it's post-`v0.2.9`, not inside the `v0.2.6`–`v0.2.9` release range the task described.

## 2. What each commit actually changes

1. **`0ac5f68`** — `app/performance/PerformanceEstimate.tsx` (9 lines). Fixes a bug where a prefilled/selected GPU system could be silently overwritten when the fallback GPU-selection logic ran. *Note: this file was later renamed to `app/predict/Performance.tsx` by upstream commit `0c83229` ("refactor: rename predict performance UI").*
2. **`58466b6`** — `services/aiconfigurator/tools/api_service/app.py` + its test file (31 lines). Adds a startup-time fallback dictionary so GPU display names are never blank/missing in API responses. *(Pre-rename path; later lives at `services/aisimulators/tools/api_service/app.py`.)*
3. **`9ce939b`** — same `app.py`, large refactor (268 lines) that bounds the native recommendation sweep to a fixed search window instead of an unbounded search, preventing timeouts.
4. **`1c10ed4`** — same `app.py` (13 lines). Makes the incremental recommendation search continue past a GPU window that raises `NoViableParallelConfig` instead of aborting the whole search, so valid configurations later in the sweep aren't silently skipped.
5. **PR #157** (`fabb7c4` + `87e849f`) — `app/kv-cache/KvCacheCalc.tsx`, `.module.css`, `lib/hooks/useCatalog.ts`, `useCatalog.test.ts`. Loads memory-fraction/fraction-kind defaults from the selected backend's catalog metadata, keeps them editable (tracks a "user edited" ref so the default doesn't clobber manual edits), and restyles the KV-cache serving-mode control. Also includes a `mapBackendOption()` extraction refactor in `useCatalog.ts`.
6. **PR #145** (`735a825`) — `app/recommend/Sizing.tsx`, `lib/api/recommend.ts`, `lib/api/__tests__/recommend.test.ts`, `services/aisimulators/tools/api_service/app.py`. Requests native AISimulators memory details for recommendations, normalizes memory-breakdown bytes, and shows model-weights/KV-cache/overhead breakdown plus peak memory per GPU on the recommend result tile.
7. **`fed978c`** — same `app.py` (36 lines). Adds `_prediction_total_gpus()`: when the backend doesn't report `num_total_gpus` directly, derive total GPU count from TP/PP/attention-DP/worker counts (separately for agg vs. disaggregated prefill/decode), so per-GPU throughput isn't miscalculated when the backend omits that field.

## 3. Fork file-structure compatibility

- **aiconfigurator → aisimulators rename:** our fork is **already past** this rename — no adaptation needed. `git cherry-pick` with the `ort` merge strategy actually auto-detected the rename and retargeted patches for leads #2–#4 onto `services/aisimulators/...` without manual path mapping.
- **Next.js 16:** our fork is already on `^16.3.6`, matching upstream `v0.2.9`. None of the 7 leads touch Next.js/webpack config, so this had no bearing on any of them.
- **Lead #1's file rename** (`app/performance/PerformanceEstimate.tsx` → `app/predict/Performance.tsx`) is also already reflected in our fork.
- All target files/paths for every lead exist in our fork in the same (post-rename) relative locations as upstream.

## 4. Dry-run cherry-pick results

Performed on scratch branch `scratch/upstream-assess` (created off `main`), each attempt followed by `cherry-pick --abort` + `git reset --hard main`. Branch deleted afterward.

| # | SHA(s) | Outcome | Why |
|---|---|---|---|
| 1 | `0ac5f68` | **Heavy conflict** on `app/predict/Performance.tsx` | Our file is identical to `v0.2.9`, which already carries this fix forward (through the rename). The conflict is upstream's old patch colliding with content that's already fixed — **not** a real gap. |
| 2 | `58466b6` | **Heavy conflict** on both touched files | Same cause: our `app.py` already equals `v0.2.9`'s, which supersedes this early fix by ~270 lines of later refactors (leads #3/#4). Not a real gap. |
| 3 | `9ce939b` | **Heavy conflict** on `app.py` | Same cause — already fully superseded/incorporated in our current `app.py` (confirmed byte-identical to `v0.2.9`). |
| 4 | `1c10ed4` | **Minor conflict** — test file conflicted, but `app.py` hunk applied "cleanly" | Applying it produced a **literal duplicate** of the exact same `if "NoViableParallelConfig" in msg...` block that already exists in our file — hard proof the fix is already present, applying it again would just duplicate dead code. |
| 5 | `fabb7c4` + `87e849f` (PR #157) | **Clean** (`M`/`M`/`A`/`M`, zero conflicts) | Confirmed genuinely missing from our fork. Applies as a clean 2-commit stack. |
| 6 | `735a825` (PR #145) | **Conflict** on `app/recommend/Sizing.tsx` | Diffing our `Sizing.tsx` against `v0.2.9` shows the *only* differences are our own wizard-integration code (`WizardContext`, "Add to sizing wizard" button, `WizardStepHeader`) — the upstream memory-breakdown fix itself is already fully present. The conflict is noise from our customization sharing the same region of the file, not a missing fix. The other 3 files in this PR (`lib/api/recommend.ts`, its test, `app.py`) are byte-identical to `v0.2.9` — already applied. |
| 7 | `fed978c` | **Clean** (`M`/`M`, zero conflicts) | Confirmed genuinely missing (it postdates `v0.2.9`). Applies cleanly. |

## 5. Recommendations

| # | Lead | Recommendation | Rationale |
|---|---|---|---|
| 1 | `0ac5f68` preserve prefilled GPU value | **SKIP** | Already present in our fork (superseded, content-identical to v0.2.9's descendant state). Cherry-picking would reintroduce reverted/stale code and conflict. |
| 2 | `58466b6` GPU display-name fallback dict | **SKIP** | Already present (file identical to v0.2.9, which supersedes this commit). |
| 3 | `9ce939b` bounded native recommendation sweep | **SKIP** | Already present (same reasoning as #2). |
| 4 | `1c10ed4` continue search past infeasible windows | **SKIP** | Already present — empirically proven by the duplicate-block cherry-pick result. |
| 5 | PR #157 KV-cache backend memory defaults | **CHERRY-PICK** | Genuinely missing, clean 2-commit stack (`fabb7c4`, `87e849f`), no structural obstacles. This is the single clearest actionable fix from the original 7 leads. |
| 6 | PR #145 recommend peak memory display | **SKIP** (with a caveat) | Core fix already present; only our own wizard UI code overlaps the same lines. **Caveat:** worth a quick manual read-through of current `Sizing.tsx` to confirm the memory-breakdown UI and our wizard "Add to sizing" button render correctly together — they were never explicitly reconciled since the fix predates our customization pass. |
| 7 | `fed978c` derive predict throughput per GPU | **CHERRY-PICK** | Genuinely missing (it's newer than our fork's effective baseline and than `v0.2.9`), applies cleanly, directly fixes a per-GPU throughput miscalculation — matches the "GPU-sizing-accuracy" theme closely. |

**Net result: of the 7 original leads, only 2 (PR #157, and `fed978c`) represent real gaps.** The other 5 are already incorporated into our fork because our fork's true baseline is close to `v0.2.9`, not `v0.2.5` as originally assumed.

## 6. Additional candidates noticed (not in the original 7 leads)

While reading the full `v0.2.5..v0.2.9` commit log (190 commits), several other commits in the same "bounded recommendation search" saga and backend-metadata-hardening area stood out as GPU/sizing-accuracy relevant:

- `9fe042c` `fix(aisimulators): bound native recommendation search`
- `7943e30` `fix(aisimulators): preserve default context parallelism`
- `b421ac7` `fix(aisimulators): preserve bounded search inputs`
- `fe514b3` `fix: bound recommendation search budget`
- `99c22cc` `fix: optimize narrow recommendation windows`
- `aba80a0` `fix: harden backend metadata and memory defaults`
- `c894515` `fix: normalize engine metrics in REST responses`
- `b93b159` `fix: patch vLLM 0.30 metrics compatibility`

All of these touch `services/aisimulators/tools/api_service/app.py` (or, for `aba80a0`, also `app/predict/Performance.tsx` / `app/api/catalog/route.ts` / `app/settings/Settings.tsx`) — every one of those files is already confirmed byte-identical between our fork and `v0.2.9`, so **these are very likely already present too**, by the same "our baseline is ~v0.2.9" logic. They were not individually dry-run cherry-picked (time-boxed to the 7 original leads), so a Phase 2 pass could spot-check 2–3 of them to be certain, but no action is expected to be needed.

## 7. Suggested next step

A real Phase 2 worth prioritizing: **re-baseline the "~190 commits / 273 files behind" assumption.** Since our fork's actual content is only ~74 files different from `v0.2.9`, a much smaller and more precise upstream-diff exercise (against `v0.2.9` specifically, not `v0.2.5`) would be far more productive than treating this as a 190-commit sync effort.
