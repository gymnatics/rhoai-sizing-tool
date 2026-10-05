# RHOAI Sizing Wizard

A fork of [ConfigIQ](https://github.com/redhat-performance/configiq) extended into a full **Red Hat OpenShift AI (RHOAI) cluster sizing wizard**. ConfigIQ's LLM/GPU sizing tools remain unchanged and power Step 2; this fork adds customer intake, use-case demand modeling, RHOAI platform sizing, and a customer-ready, formula-driven Excel export on top of it.

See `docs/architecture.md` and `docs/ARCHITECTURE_DETAILED.md` for scope and architecture background.

## Getting started: `/wizard`

`/wizard` is the entry point. It asks a single upfront question:

- **Full RHOAI platform sizing** — the complete 5-step flow below.
- **LLM sizing only** — skips Steps 1/3/4 and goes straight to Step 2, producing a lightweight Disclaimer + Model Catalog + GPU Performance workbook.

The ConfigIQ homepage (`/`) has a banner linking here, and Step 2 (`/recommend`) shows the wizard progress header whenever a mode has been chosen.

## The sizing wizard (full mode)

| Step | What it does |
|---|---|
| 1. Customer & hardware (`/wizard/step1`) | Customer profile, deployment target, OpenShift version, GPU inventory, growth assumptions. Can import a `sizing-intake.json` produced by the `rhoai-sizing-intake` Cursor agent skill (`.cursor/skills/rhoai-sizing-intake/` in the parent workspace) instead of manual entry. |
| 2. Model sizing (`/recommend`) | ConfigIQ's **Recommend Sizing** page, with a wizard progress header and continue CTA added. Search any HuggingFace model, pick a GPU, run the analysis, then click **"Add to sizing wizard"** — an inline "Continue to use case mapping →" link appears once at least one model is added. |
| 3. Use case mapping (`/wizard/step3`) | Map each sized model to one or more **freeform** use cases (no predefined categories) with concurrent users, token estimates, and SLA targets. Includes the Stress-methodology note (see below). |
| 4. Platform sizing (`/wizard/step4`) | Toggle RHOAI 3.5 components (including AI Gateway / MaaS), see lifecycle history / source conflicts / planned 3.6 breaking changes inline, configure non-GPU workloads and storage. |
| 5. Review & generate (`/wizard/step5`) | Headline numbers, the itemized non-GPU platform overhead table, sizing checks, and a button that calls the Python Excel service to download the formula-driven `.xlsx` workbook. Branches to a simplified view in LLM-only mode. |

Wizard state (including `wizardMode: 'full' | 'llm-only' | null`) persists to `localStorage` (`contexts/WizardContext.tsx`) and the platform sizing math lives in `lib/wizard/sizingCalculator.ts`. Reference data (RHOAI components, GPU specs, version-tracker lifecycle/migration/conflict/roadmap data, and the itemized `platformOverheadLineItems` Table D figures) is in `data/*.json`.

### Target concurrency (Step 2) vs. concurrent users (Step 3)

These are easy to conflate but mean different things, and both end up in the Excel in different roles:

- **Target concurrency** (ConfigIQ's Recommend Sizing, Step 2) sizes **one replica's** batching capacity — how
  many requests that single replica should serve at once while still meeting your TTFT/TPOT targets. It becomes
  `maxConcurrentPerReplica` on the captured model (persisted on the `Models` sheet), and is the **divisor** in the
  wizard's replica formula: `replicas = ceil(requestsInFlight / maxConcurrentPerReplica)`.
- **Concurrent users — Low/High** (Step 3, per use case) is the **total demand** for that use case — how many
  people/requests are hitting the model at once across *all* replicas. It becomes the Inputs sheet's literal
  use-case rows, and is the **numerator** in that same formula.

Left at a low default (e.g. `1`) while Step 3 has real demand, "Target concurrency" silently inflates the
replica/GPU count — e.g. 1 request/replica capacity against 24 requests in flight forces 24 replicas. The wizard
surfaces this: Step 3 shows the mapped model's captured capacity next to the use-case fields, and both the live
Step 5 dashboard and the generated Excel's Sizing Summary include a check ("replica count vs. captured per-replica
concurrency") that fires whenever a model's capacity looks too low for its mapped demand, naming the fix (go back
to Step 2 and raise Target concurrency to a realistic per-replica batch size, then re-add the model).

### Use cases without a sized model: "unmapped" vs. "external"

A use case's "Served by" dropdown has three states, and Step 3 warns immediately (not just later at Step 5 or in
the Excel) whenever one looks like a mistake:

- **A sized model** — counted normally in GPU/replica demand.
- **Unmapped** (still on the placeholder) — contributes **zero** demand, which is almost always unintentional.
  Step 3 shows an amber warning on that card right away, and the same check reappears on Step 5 and the Excel's
  Sizing Summary ("Use cases not mapped to a sized model") in case it's missed.
- **External model (not sized in this wizard)** — an explicit, intentional choice for a use case served by a
  model outside this tool (e.g. a third-party API). Demand fields are kept for your own notes but deliberately
  excluded from GPU sizing, and — unlike "unmapped" — this does **not** trigger the warning anywhere.

### Stress methodology

Every use case has a Low/High concurrent-user range and a "share in flight" fraction. **Low and High** scenarios multiply `concurrent users × share in flight`. **Stress** deliberately does *not* multiply by share-in-flight — it assumes every High-estimate user has a request in flight simultaneously, as a true worst case. This is documented in Step 3's UI, Step 5's UI, and is visible as a literal formula difference in the generated Excel's Workload Sizing sheet (click a Stress cell vs. a High cell in the same row).

### Excel generation service

`excel-service/` is a separate Python FastAPI microservice (`openpyxl`) that turns the wizard's raw state into the final workbook. The workbook is **formula-driven**: an `Inputs` sheet (yellow fill, editable), a `Reference` sheet (sourced constants), and a `Models` sheet (ConfigIQ-captured results) hold the only literal values; every other sheet (`Sizing Summary`, `Workload Sizing`, `GPU Performance`, `Cluster Architecture`, `Cluster Requirements`, `Red Hat Subscriptions`, `Hardware BOM`, `Backup and DR`, `Model Catalog`) computes with real Excel formulas referencing those cells — so an SE can open the workbook, tweak an assumption, and watch everything downstream recalculate. In **LLM-only** mode the service emits a reduced Disclaimer + Model Catalog + GPU Performance workbook instead.

The Next.js app's live Step 5 dashboard still uses `lib/wizard/sizingCalculator.ts` for an instant preview, but the generated Excel is the canonical, auditable deliverable — if the two ever diverge, the Excel is authoritative.

Run the service alongside the Next.js app:

```bash
cd excel-service
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn main:app --reload --port 8000
```

Or run both together: `docker compose up --build` (see `docker-compose.yml`).

---

# ConfigIQ (upstream)

LLM inference sizing, GPU comparison, and cost modeling for engineers and infrastructure teams.

## Live

- [configiq.xyz](https://configiq.xyz) (latest release)
- [configiq.dev](https://configiq.dev) (latest commit)

Built with Next.js + PatternFly, powered by our [AISimulators](https://github.com/ai-dynamo/aisimulate) [REST API](https://aisimulators.dev/docs).

## What it does

| Tool | Description |
|------|-------------|
| **Performance** | Fast GPU memory and cost estimate from model + load profile |
| **Recommend Sizing** | Detailed sizing with batching, quantization, and cost modeling |
| **KV Cache Calculator** | Memory breakdown and KV cache capacity analysis |
| **GPU Explorer** | Compare GPUs across memory, throughput, cost, and availability |
| **Hybrid Savings** | Model cost savings across cloud, on-premise, and hybrid strategies |
| **Routing Economics** | Analyze request routing between model tiers |
| **Cluster cost** | Estimate costs for multi-node GPU clusters |

## Getting started

### Prerequisites

- Node.js >= 20.19.0
- npm >= 10

### Setup

```bash
git clone https://github.com/redhat-performance/configiq.git
cd configiq
npm install
cp .env.example .env.local
npm run dev
```

App runs at **http://localhost:3000**.

### Available commands

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build
npm run type-check   # TypeScript check without building
npm run lint         # ESLint
npm test             # Vitest test suite
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 App Router + TypeScript |
| UI | PatternFly v6 |
| Backend APIs | [AISimulators](https://aisimulators.dev/docs) for GPU sizing and estimation; aicostings for pricing |

## Project structure

```
app/                  Next.js App Router pages
  layout.tsx          Root layout, fonts, PatternFly CSS imports
  page.tsx            Homepage ("Start RHOAI Sizing Wizard" banner added)
  recommend/          Recommend sizing tool (Step 2 of the sizing wizard; wizard header + "Add/Continue" CTA added)
  kv-cache/           KV Cache Calculator
  predict/             Predict performance
  gpu-explorer/       GPU Explorer
  hybrid-savings/     Hybrid Savings
  routing/            Routing Economics
  settings/           App settings
  wizard/             *** RHOAI Sizing Wizard steps (new) ***
    page.tsx          Landing page — "Full platform sizing" vs. "LLM sizing only"
    step1/            Customer profile & hardware
    step3/            Use case mapping (+ Stress methodology note)
    step4/            RHOAI platform sizing
    step5/            Review & generate Excel (+ platform overhead card, llm-only branch)
  api/                Next.js same-origin proxies and application APIs
    recommend/        POST — GPU sizing via AISimulators /recommend
    predict/          POST — GPU performance via AISimulators /predict
    memory/           POST — memory breakdown via AISimulators /memory
    gpus/             GET — GPU catalog via AISimulators /systems
    catalog/          GET — combined systems, models, and backends catalog
    estimate/         POST — compatibility alias for predict
    hf-config/        GET — Hugging Face model config lookup
    health/           GET — health check
    costings/         Pricing-service proxies
    metrics/          Application metrics
    generate-excel/   *** POST — proxies wizard state to excel-service (new) ***
components/
  layout/
    AppShell.tsx      Top-nav masthead + sidebar navigation (wizard nav items added)
  wizard/             *** Wizard UI components (new): WizardStepHeader, GpuGroupEditor,
                           IntakeImport, ComponentRow, wizard.module.css ***
contexts/
  WizardContext.tsx   *** Wizard state across all 5 steps, persisted to localStorage (new) ***
lib/
  api/                AISimulators and aicostings API clients
  wizard/             *** Wizard domain logic (new): types.ts, componentData.ts,
                           sizingCalculator.ts, fromConfigIQ.ts ***
data/                 *** RHOAI reference data (new): components.json (incl. maas component +
                           platformOverheadLineItems), reference-constants.json,
                           feature-lifecycle.json, migration-checklist.json,
                           source-conflicts.json, roadmap.json ***
excel-service/        *** Python FastAPI microservice (new): openpyxl, formula-driven workbook
                           generator (Inputs/Reference/Models literal sheets, every other sheet
                           computed via Excel formulas); branches on mode: 'full' | 'llm-only' ***
docs/                 Architecture docs and ADRs
```

## Contributing

### Before opening a PR

Run these checks before opening a PR:

```bash
npm run type-check   # Must be clean
npm run lint         # Must be clean
npm run build        # Must succeed
```

### Code conventions

1. **GPU math belongs in `aisimulators`** — never write sizing formulas inside React components.
2. **Pricing belongs in the `aicostings` service** — never add costing inside React components.
3. **PatternFly only** — do not add Tailwind, shadcn/ui, or any other component library.
4. **Sentence case everywhere** — no title case in headings or labels.
5. **Server components by default** — add `"use client"` only when needed.
6. **No `any` types** — TypeScript strict mode is enforced.
