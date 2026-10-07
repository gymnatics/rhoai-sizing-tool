# Upstream Sync — Phase 4: Full Merge to `v0.2.9`

**Date:** 2026-10-07
**Branch:** `upstream-sync/v0.2.9-full` (created off `main`)
**Scope:** Given Phase 1's finding that our fork is only 74 (now 77, see §0) files different from upstream tag `v0.2.9` — not the ~190-commit / 273-file gap a stale `package.json` version number originally suggested — attempt the full merge/sync to `v0.2.9`, not just prepare a branch and stop.

## TL;DR

**READY FOR REVIEW.** All 77 differing files were categorized, and every file that needed action was resolved — **21 files took upstream's `v0.2.9` content wholesale**, and **56 files required zero changes** (39 are pure RHOAI-only additions that don't exist upstream at all, 9 are files where 100% of the diff is our own RHOAI customization layered over an *otherwise byte-identical* upstream base with no competing upstream change to merge, and 8 are deliberately excluded for documented architectural reasons). **Zero files required a genuine three-way/hand merge** — investigation showed every file we'd customized has no overlapping upstream-side change in the same regions, so there was nothing to reconcile beyond "keep ours." All 4 verification checks (`tsc`, `eslint`, `build`, `test`) pass clean, and all RHOAI-specific features were manually confirmed intact (zero diff vs. `main` on every feature file).

## 0. Setup

- `upstream` remote confirmed present (`https://github.com/redhat-performance/configiq.git`).
- `git fetch upstream --tags && git fetch upstream main` re-run — no new tags landed since Phase 1/2 (still `v0.2.1`–`v0.2.9`). Upstream `main` fetched fresh (same `57dce04` HEAD as Phase 3).
- `git diff --name-status main v0.2.9 -- . | sort` now shows **77 files** (not 74 — the 3-file increase vs. Phase 1 is entirely our own `docs/upstream-sync/phase1-feasibility.md` and `phase3-predict-endpoint.md` reports and the earlier `data/*.json`/`examples/` set growing slightly; no upstream drift occurred between Phase 1 and now, confirmed by identical tag set).

## 1. Full file category breakdown (77 files)

### Category (a) — Our RHOAI-only additions; don't exist upstream at all (`D` status in the diff — i.e., present in `main`, absent from `v0.2.9`). No action needed; expected and correct.

39 files:

| Area | Files |
|---|---|
| Wizard pages | `app/wizard/page.tsx`, `step1/page.tsx`, `step3/page.tsx`, `step4/page.tsx`, `step5/page.tsx` |
| Wizard API | `app/api/generate-excel/route.ts` |
| Wizard components | `components/wizard/ComponentRow.tsx`, `GpuGroupEditor.tsx`, `IntakeImport.tsx`, `WizardStepHeader.tsx`, `wizard.module.css` |
| Coming-soon ribbon | `components/ComingSoonRibbon/ComingSoonRibbon.tsx`, `.module.css` |
| Wizard state/logic | `contexts/WizardContext.tsx`, `lib/wizard/componentData.ts`, `fromConfigIQ.ts`, `sizingCalculator.ts`, `types.ts` |
| Reference data | `data/components.json`, `feature-lifecycle.json`, `migration-checklist.json`, `reference-constants.json`, `roadmap.json`, `source-conflicts.json` |
| Excel service | `excel-service/.dockerignore`, `Dockerfile`, `generator.py`, `main.py`, `requirements.txt`, `test_generator_smoke.py` |
| Examples | `examples/README.md`, `acme-bank-sizing.xlsx`, `meridian-trust-bank-sizing.xlsx`, `sample-customer-email.md`, `sample-sizing-intake.json` |
| Docs/infra | `docker-compose.yml`, `docs/PLAN-subscription-model-selector.md`, `docs/upstream-sync/phase1-feasibility.md`, `phase3-predict-endpoint.md` |

### Category (a′) — "Pure superset" `M`-status files: 100% of the diff is our own RHOAI addition on top of an otherwise byte-identical upstream base. No competing upstream change exists in these regions, so there is nothing to merge; keeping `main`'s version as-is is correct.

9 files, each individually verified by reading the full diff:

| File | What our diff vs. `v0.2.9` actually contains |
|---|---|
| `app/page.tsx` | Only the "New: RHOAI Sizing Wizard" homepage banner card + its `RocketIcon` import. Rest identical. |
| `app/recommend/Sizing.tsx` | Only the wizard progress header, "Add to sizing wizard" button, "Models in this sizing" list, and the Step-2-specific concurrency help text. Rest identical (confirms Phase 1's prediction). |
| `components/layout/AppShell.tsx` | Only the "RHOAI SIZING WIZARD" nav group (5 wizard step links) + their icon imports. Rest identical. |
| `app/layout.tsx` | Only the `WizardProvider` wrap + its import + the `ProgressStepper` PatternFly CSS import it needs. Rest identical. |
| `app/cluster-cost/page.tsx` | Only a `ComingSoonRibbon` wrap (import + open/close tag). Rest identical. |
| `app/routing/page.tsx` | Only a `ComingSoonRibbon` wrap. Rest identical. |
| `.env.example` | Only our added `EXCEL_SERVICE_URL` line + its comment. Rest identical. |
| `.gitignore` | Only our added excel-service/`.cursor/`/`.github/workflows/` ignore lines. Rest identical. |
| `README.md` | Our RHOAI wizard documentation section sits *above* an otherwise-unchanged ConfigIQ README body (confirmed: upstream's current README for the retained section is identical to ours, just without our added rows/paragraphs). |

### Category (c) — Upstream changed, we never touched; taken wholesale from `v0.2.9` onto `upstream-sync/v0.2.9-full`.

21 files, verified file-by-file to contain zero RHOAI-specific content before taking:

| File | Upstream change adopted |
|---|---|
| `app/kv-cache/KvCacheCalc.tsx`, `.module.css` | PR #157 — KV-cache backend memory-fraction/kind defaults loaded from catalog metadata, "user edited" tracking ref, serving-mode toggle restyle. Verified zero wizard/RHOAI references in this file. |
| `lib/hooks/useCatalog.ts`, `useCatalog.test.ts` (new) | PR #157's `mapBackendOption()` extraction refactor + its new unit test. Pure refactor, no RHOAI content. |
| `scripts/tested_models/README.md`, `dataset_common.py`, `export_triton.py`, `requirements.txt`, `train_classifiers.py` | Upstream's Hugging Face ground-truth dataset pipeline hardening (public-dataset validation, `huggingface_hub` dependency, Triton export tweaks). Entirely upstream-owned tooling, unrelated to the wizard. |
| `scripts/tested_models/download_ground_truth.py`, `publish_ground_truth.py` (new), `tests/test_hf_data_tools.py` (new) | New HF dataset download/publish scripts + their tests, part of the same tested-models pipeline. |
| `services/aisimulators/Containerfile`, `README.md`, `uv.lock` | BLIS v0.9.2 + BLIS catalog multi-stage build additions, `export_blis_catalog.py` wiring, doc updates. |
| `services/aisimulators/tools/export_blis_catalog.py` (new), `tests/unit/tools/test_export_blis_catalog.py` (new) | The BLIS catalog export tool itself + its test. |
| `services/aicostings/uv.lock`, `uv.lock` (root) | Lockfile drift from the above new Python dependencies. |
| `pyproject.toml` | Added `huggingface_hub>=0.30.0` to the `tested-models` dependency group. |
| `package-lock.json` | Pure npm-metadata drift (newer npm added a `"libc"` field to several optional native packages). `package.json` itself is byte-identical between `main` and `v0.2.9` — confirmed before taking. |

### Category — Deliberately excluded (not category (c), despite being `A`/added-upstream status). Documented, not blindly taken.

8 files:

| File(s) | Why excluded |
|---|---|
| `.github/workflows/build.yml`, `ci.yml`, `release.yml`, `tested-models.yml`, `tritonserver.yml` | `.github/workflows/` is explicitly listed in our fork's own `.gitignore` (added intentionally by this fork). Taking these would silently re-enable upstream's CI workflows against our fork's `.github/workflows/` path, overriding a deliberate decision. **Not taken.** If this fork wants its own CI, it should be designed separately — not inherited wholesale from upstream's workflow files. |
| `services/tritonserver/Containerfile`, `README.md`, `patches/vllm-030-metrics.patch` | Confirmed in Phase 2 (§2, item 8): our fork does not ship a `services/tritonserver/` directory at all (`services/` only contains `aisimulators`, `aicostings`, `configiq-py`, `scripts`). This is a pre-existing, intentional architectural divergence, not a missing fix. Re-verified in this phase: `services/tritonserver/` still does not exist anywhere in our tree. **Not taken.** |

### Category (b) — Both sides changed, needs real 3-way merge.

**Zero files.** This is the headline finding of this phase: every single file we had customized for RHOAI purposes turned out, on full-diff inspection, to contain **no overlapping upstream-side change** in the same code regions — the entire diff for each was additive-only on our side. The task's working hypothesis (that files like `app/recommend/Sizing.tsx`, `app/page.tsx`, `components/layout/AppShell.tsx` would need careful line-by-line reconciliation) did not materialize once actually inspected; Phase 1's note that the `Sizing.tsx` "conflict" during dry-run cherry-picking was noise from our own code sharing lines with an unrelated old patch, not a real content conflict, generalizes to every other customized file in this diff. Nothing was deferred because nothing qualified for this category.

### Count check

39 (a) + 9 (a′) + 21 (c) + 8 (deliberately excluded) + 0 (b) = **77** ✅ matches the full diff count.

## 2. Category (b) merge results

**N/A — no category (b) files existed.** See §1 above for the investigation that established this.

## 3. Verification suite results

Run from repo root on `upstream-sync/v0.2.9-full`, after the category (c) commit, using the existing `node_modules`:

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ **PASS** — zero errors |
| ESLint | `npx eslint .` | ✅ **PASS** — zero errors/warnings |
| Build | `npm run build` | ✅ **PASS** — compiled successfully, all 30 routes generated (same route set as Phase 2 — `/wizard` and its 4 steps, `/api/generate-excel`, etc. all present) |
| Tests | `npm run test` (vitest) | ✅ **PASS** — 28 test files, 299 tests, all passed |

No code adaptation was needed beyond the direct `git checkout v0.2.9 -- <file>` for the 21 category (c) files — they applied with zero conflicts because none of them carried any RHOAI-specific content to clobber.

(Same harmless `fatal: No tags can describe '<sha>'` note as Phase 2 — `scripts/inject-build-metadata.js`'s `git describe` call fails gracefully because this branch's commits aren't reachable from any tag yet; build metadata injection tolerates it and the build completes normally.)

## 4. RHOAI feature survival confirmation

Per task step 8, manually re-read (not browser-tested) every key RHOAI surface after the merge, and additionally ran `git diff main -- <file>` for each to get a hard guarantee of zero unintended change:

```
git diff main -- app/wizard/page.tsx app/recommend/Sizing.tsx app/page.tsx \
  components/layout/AppShell.tsx app/wizard/step5/page.tsx contexts/WizardContext.tsx
→ 0 lines of diff
```

| Feature | File | Confirmed present |
|---|---|---|
| Wizard landing page mode selection ("Full platform sizing" vs. "LLM sizing only") | `app/wizard/page.tsx` | ✅ Untouched (0 diff vs. `main`) |
| Step 2 wizard header + model list + continue CTA | `app/recommend/Sizing.tsx` | ✅ `WizardStepHeader` import/usage (L34, L452), "Add to sizing wizard" button (L924–966), "Models in this sizing" list (L976) all present verbatim |
| Step 5 platform overhead card + llm-only branch + start-new-sizing button | `app/wizard/step5/page.tsx` | ✅ `calculateSizing` import (L8), `llmOnly` branch (L24), "Non-GPU platform overhead" card (L187–209), "Start new sizing" button (L266) all present |
| Homepage wizard banner | `app/page.tsx` | ✅ "New: RHOAI Sizing Wizard" banner + "Start sizing →" CTA (L114, L128) present |
| Wizard nav in sidebar | `components/layout/AppShell.tsx` | ✅ "RHOAI SIZING WIZARD" nav group + all 5 step links present |

No RHOAI feature was reverted, altered, or touched by this merge. This is expected by construction — none of the 21 category (c) files intersect with any RHOAI-owned file or region — but was verified directly rather than assumed.

## 5. Branch / PR

- Branch: `upstream-sync/v0.2.9-full`, created off `main`.
- Contains 1 functional commit (`sync: adopt upstream v0.2.9 changes for untouched files`, 21 files changed) + this report commit.
- **Not merged into `main`**, per instructions.
- Pushed to `origin`.
- Draft PR opened: see final chat response for link.
- `main` confirmed clean and unaffected after switching back (see §6).

## 6. Relationship to the open PR #1 (`upstream-fixes/gpu-and-throughput`, Phase 2)

Two of the 21 category (c) files this phase took (`app/kv-cache/KvCacheCalc.tsx`/`.module.css`, `lib/hooks/useCatalog.ts`/`.test.ts`) carry the **exact same PR #157 content** that Phase 2 already cherry-picked onto `upstream-fixes/gpu-and-throughput` (PR #1, still open/unmerged). Verified byte-identical: `diff <(git show upstream-fixes/gpu-and-throughput:app/kv-cache/KvCacheCalc.tsx) <(git show v0.2.9:app/kv-cache/KvCacheCalc.tsx)` and the same for `useCatalog.ts` both produced **zero diff**. This is expected — Phase 2 cherry-picked those exact upstream commits, and this phase takes the same content via the `v0.2.9` tag.

**Practical consequence:** these two files' content is included in *both* open branches. Whichever of PR #1 or this `v0.2.9` sync PR merges to `main` first will make the other's overlap on these specific files a no-op (git will see no diff to apply for them on the second merge). No conflict risk — just a redundancy worth flagging for whoever reviews these two PRs, so they aren't surprised to see the same KV-cache/catalog diff show up twice. Recommend merging the `v0.2.9` sync PR first (it's the broader, now-fully-verified sync) and letting PR #1 "catch up" naturally (its unique remaining content is only the post-`v0.2.9` `fed978c` throughput fix to `services/aisimulators/tools/api_service/app.py`, which this phase does not touch).

## 7. Final status

### ✅ READY FOR REVIEW

- All 77 differing files categorized and accounted for.
- All actionable files (21, category c) successfully synced from `v0.2.9` with zero conflicts.
- Zero files fell into category (b) (needs hand-merge) — none were deferred because none qualified.
- Zero files were taken incorrectly or need further investigation; the 8 excluded files have documented, verified rationale (gitignored CI workflows; nonexistent tritonserver service).
- Full verification suite (tsc, eslint, build, test) passes clean.
- All RHOAI-specific features manually confirmed intact with zero unintended diff vs. `main`.
- Only non-blocking note: 2 of the 21 synced files overlap in content with the still-open PR #1 (harmless, see §6).

This branch is complete and verified. It needs human review before merging to `main` — specifically, a decision on merge order relative to PR #1 (§6), and a final look at whether the deliberately-excluded `.github/workflows/*` upstream CI files are wanted in any form for this fork (currently: no, by existing `.gitignore` policy, unchanged by this phase).
