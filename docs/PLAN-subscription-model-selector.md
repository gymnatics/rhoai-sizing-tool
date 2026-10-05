# Plan: Multi-model Red Hat AI Subscription Selector

**Source**: [Red Hat AI Subscription Guide (July 2026)](https://www.redhat.com/en/resources/ai-subscription-guide-detail)

## Problem

The tool currently hardcodes a single subscription model (Red Hat AI Enterprise, MCT4990, per-node)
in both the TypeScript calculator (`sizingCalculator.ts`, line ~390) and the Python Excel generator
(`generator.py`, `build_subscriptions_sheet`). Red Hat actually offers **four** subscription models
with fundamentally different counting logic. SEs need to see the right SKUs for the customer's
chosen subscription path — and ideally compare options side-by-side.

## The four subscription models (from the guide)

```
┌──────────────────────────┬────────────────────────────────┬───────────────────────────────────┬──────────────────────┐
│ Product                  │ Unit of measure                │ GPU/accelerator handling           │ Platform included?   │
├──────────────────────────┼────────────────────────────────┼───────────────────────────────────┼──────────────────────┤
│ Red Hat AI Enterprise    │ Per node (physical or virtual) │ Unlimited GPUs/node, no extra SKU │ Yes (OCP, AI-only)   │
│ Red Hat AI Inference     │ Per physical GPU               │ Included in SKU                   │ No (needs OCP/RHEL)  │
│ Red Hat OpenShift AI     │ Core-pair (vCPU÷4) or         │ Separate AI Accelerator SKU       │ No (needs base OCP)  │
│                          │ bare-metal node                │ per physical GPU                  │                      │
│ Red Hat Enterprise       │ Per physical GPU               │ Included in SKU                   │ Yes (RHEL image      │
│ Linux AI                 │                                │                                   │ mode, single server) │
└──────────────────────────┴────────────────────────────────┴───────────────────────────────────┴──────────────────────┘
```

### Key counting rules per model

**AI Enterprise** (current default, simplest):
- Count every physical/virtual node dedicated to AI workloads
- GPU worker nodes + CPU worker nodes (control plane + infra excluded)
- SKU: MCT4990 (1 Physical or Virtual Node), qty = nodes
- Notes: OCP entitlement restricted to AI use; no core/socket limits

**AI Inference** (inference-only, per-GPU):
- Count every physical GPU used for model inference
- Also requires a SEPARATE platform subscription (OCP bare-metal or core-pair)
- SKU 1: AI Inference (per accelerator), qty = total GPUs
- SKU 2: OCP (bare-metal node or core-pair), qty = physical servers or vCPU÷4
- Notes: Does NOT support training/tuning; inference-only

**OpenShift AI** (layered add-on, most complex):
- Core-pair mode: count aggregate vCPUs across AI worker nodes, divide by 4
- OR bare-metal mode: count physical AI worker nodes
- PLUS separate AI Accelerator SKU per physical GPU
- SKU 1: OCP base (core-pair or bare-metal), qty = vCPU÷4 or nodes
- SKU 2: OpenShift AI add-on (same unit), qty = same
- SKU 3: AI Accelerator (1 per GPU), qty = total GPUs
- Notes: Partial cluster coverage allowed (only AI worker nodes need subs)

**RHEL AI** (single-server only):
- Count every physical GPU on the dedicated server
- Includes RHEL OS, no separate RHEL subscription needed
- SKU: RHEL AI (per accelerator), qty = total GPUs on that one server
- Notes: Single-machine only; cannot scale to multi-node cluster

## Data inputs needed for all models

The tool already collects most of what's needed:

| Input                           | Where it lives now                 | Used by which model(s)     |
|---------------------------------|------------------------------------|----------------------------|
| GPU worker node count (per scenario) | `gpuTypeTotals[].nodesRequired` | AI Enterprise              |
| CPU worker node count           | `cpuWorkerNodes`                   | AI Enterprise              |
| Total physical GPUs (per scenario) | `gpuTypeTotals[].gpusRequired`   | AI Inference, OCSAI, RHEL AI |
| Total vCPUs across AI workers   | *not yet computed*                 | OpenShift AI (core-pair)   |
| Physical server count           | `hardware.servers` (when present)  | AI Inference (OCP base)    |
| Deployment target (bare-metal?) | `customer.target`                  | Determines core-pair vs BM |

**New input needed**: `subscriptionModel` on `PlatformConfig` — which of the 4 models the customer
is evaluating. Could also support "compare all" to show a side-by-side.

## Implementation plan

### Todo 1: Reference data — `data/subscription-skus.json`

Save the SKU catalog as structured JSON so both TS and Python can consume it:

```json
{
  "subscriptionModels": [
    {
      "key": "ai_enterprise",
      "label": "Red Hat AI Enterprise",
      "description": "Per-node flat rate, includes unlimited GPUs and OCP (AI use only)",
      "guidanceUrl": "https://www.redhat.com/en/resources/ai-subscription-guide-detail",
      "countingRule": "per_node",
      "skus": [
        {
          "sku": "MCT4990",
          "description": "Red Hat AI Enterprise, Premium (1 Physical or Virtual Node)",
          "unit": "node",
          "countLogic": "gpu_worker_nodes + cpu_worker_nodes",
          "notes": "Control plane and infra nodes excluded. OCP entitlement restricted to AI use."
        }
      ],
      "restrictions": ["AI workloads only on OCP entitlement"],
      "includesGpuEntitlement": true,
      "includesPlatform": true,
      "supportsTraining": true,
      "supportsInference": true
    },
    {
      "key": "ai_inference",
      "label": "Red Hat AI Inference",
      "description": "Per-GPU, inference-only; requires separate OCP/RHEL platform subscription",
      "countingRule": "per_gpu",
      "skus": [
        {
          "sku": "TBD-INFERENCE",
          "description": "Red Hat AI Inference (1 Physical Accelerator)",
          "unit": "GPU",
          "countLogic": "total_physical_gpus"
        },
        {
          "sku": "PLATFORM-BM-OR-CP",
          "description": "Red Hat OpenShift Container Platform (base, bare-metal or core-pair)",
          "unit": "node or core-pair",
          "countLogic": "physical_server_count (BM) or total_ai_worker_vcpus / 4 (CP)",
          "notes": "Required separately; not included in AI Inference SKU"
        }
      ],
      "includesGpuEntitlement": true,
      "includesPlatform": false,
      "supportsTraining": false,
      "supportsInference": true
    },
    {
      "key": "openshift_ai",
      "label": "Red Hat OpenShift AI",
      "description": "Layered add-on: core-pair or bare-metal nodes, plus separate AI Accelerator per GPU",
      "countingRule": "core_pair_or_bare_metal_plus_accelerator",
      "skus": [
        {
          "sku": "OCP-BASE",
          "description": "Red Hat OpenShift Container Platform (base)",
          "unit": "core-pair (2 cores / 4 vCPUs) or bare-metal node",
          "countLogic": "total_ai_worker_vcpus / 4 (CP) or physical_server_count (BM)"
        },
        {
          "sku": "OCSAI-ADDON",
          "description": "Red Hat OpenShift AI Add-on",
          "unit": "core-pair or bare-metal node (matches base)",
          "countLogic": "same as OCP base"
        },
        {
          "sku": "AI-ACCEL",
          "description": "Red Hat AI Accelerator (1 Accelerator)",
          "unit": "GPU",
          "countLogic": "total_physical_gpus",
          "notes": "Mandatory for every physical GPU used for AI compute"
        }
      ],
      "includesGpuEntitlement": false,
      "includesPlatform": false,
      "supportsTraining": true,
      "supportsInference": true
    },
    {
      "key": "rhel_ai",
      "label": "Red Hat Enterprise Linux AI",
      "description": "Per-GPU on a single server; includes RHEL, no separate OS subscription needed",
      "countingRule": "per_gpu_single_server",
      "skus": [
        {
          "sku": "RHEL-AI",
          "description": "Red Hat Enterprise Linux AI (1 Physical Accelerator)",
          "unit": "GPU",
          "countLogic": "total_physical_gpus_on_single_server"
        }
      ],
      "includesGpuEntitlement": true,
      "includesPlatform": true,
      "supportsTraining": false,
      "supportsInference": true,
      "restrictions": ["Single-server only; no multi-node cluster scaling"]
    }
  ]
}
```

### Todo 2: Type changes — `lib/wizard/types.ts`

Add to `PlatformConfig`:

```ts
/** Which Red Hat AI subscription model the customer is evaluating.
 * 'compare' shows a side-by-side of all applicable models. */
subscriptionModel: 'ai_enterprise' | 'ai_inference' | 'openshift_ai' | 'rhel_ai' | 'compare';

/** For OpenShift AI / AI Inference: are underlying OCP nodes licensed
 * via core-pair (vCPU÷4) or bare-metal (1 per physical server)?
 * Only relevant when subscriptionModel is 'openshift_ai' or 'ai_inference'. */
ocpLicensingModel?: 'core_pair' | 'bare_metal';
```

Default: `subscriptionModel: 'ai_enterprise'` (backwards-compatible).

### Todo 3: Calculator changes — `lib/wizard/sizingCalculator.ts`

Replace the current `redHatSubscriptionNodes` (simple per-scenario node count) with a
richer `SubscriptionEstimate` structure:

```ts
interface SkuLine {
  sku: string;
  description: string;
  unit: string;
  qty: Record<Scenario, number>;
  notes?: string;
}

interface SubscriptionEstimate {
  model: string;            // 'ai_enterprise' | 'ai_inference' | ...
  label: string;            // Human-readable model name
  skuLines: SkuLine[];      // One row per SKU needed
  totalLineItems: number;   // Sum of all qty.high across SKUs (for comparison)
}
```

New function `calculateSubscriptions(platform, gpuTypeTotals, cpuWorkerNodes, nodeTiers)`:
- Returns `SubscriptionEstimate` for the chosen model, OR an array of all 4 when `compare`
- Counting logic per model (see "Key counting rules" above)

For **OpenShift AI core-pair** counting, need a new intermediate value: "total vCPUs across
AI worker nodes" = `(cpuWorkerNodes × CPU_WORKER_VCPU) + sum(gpuNodeCount × gpuNodeVcpu)`.
GPU worker node vCPU is currently stored as `0` in `nodeTiers` (we don't track it) — would
need to either:
  (a) Ask the user for GPU worker node vCPU in Step 1 hardware (GpuGroupEditor already has
      "Servers" but not "vCPU per server"), OR
  (b) Use a sensible default (e.g. 128 vCPU per GPU node for HGX-class hardware) and let
      the user override it, OR
  (c) Add a `vcpuPerServer` field to GpuGroup and populate it from common GPU server specs
      (e.g. reference-constants.json could have typical vCPU counts per GPU form factor)

Option (b) is the most pragmatic for v1; add an input field later.

### Todo 4: Step 4 UI — subscription model selector

Add a new card/section to `app/wizard/step4/page.tsx`:

```
┌─────────────────────────────────────────────────────────────────┐
│ Red Hat AI subscription model                                   │
│                                                                 │
│ (?) Which model the customer plans to use determines which     │
│ SKUs appear on the Subscriptions sheet of the Excel workbook.   │
│                                                                 │
│ ○ Red Hat AI Enterprise  — Per node, unlimited GPUs, simplest   │
│ ○ Red Hat AI Inference   — Per GPU, inference-only              │
│ ○ Red Hat OpenShift AI   — Core-pair/BM + AI Accelerator SKU   │
│ ○ Red Hat Enterprise Linux AI — Per GPU, single server          │
│ ○ Compare all            — Shows a side-by-side in the Excel    │
│                                                                 │
│ [If OpenShift AI selected:]                                     │
│ OCP licensing model: ○ Core-pair (2 cores / 4 vCPUs)           │
│                      ○ Bare metal (1 per physical server)       │
│                                                                 │
│ [If RHEL AI selected:]                                          │
│ ⚠ RHEL AI is limited to a single server. If your workload      │
│   needs multi-node scaling, choose AI Enterprise or OCP AI.     │
└─────────────────────────────────────────────────────────────────┘
```

### Todo 5: Step 5 UI — subscription estimate display

Replace the current one-line "Red Hat AI Enterprise subs (High)" stat card with a
multi-SKU table showing each SKU line with qty per scenario, consistent with
whichever model was chosen (or a comparison table if "compare all").

### Todo 6: Excel generator — `build_subscriptions_sheet` rewrite

The Python `build_subscriptions_sheet` in `generator.py` currently emits one MCT4990
row. Rewrite to:
1. Read `wizardState.platform.subscriptionModel` from the payload
2. Emit the correct SKU rows based on the model's counting logic
3. In "compare" mode, emit a section per model (4 tables) so the SE can print/share
   the comparison with the customer
4. All qty cells should be formulas referencing Cluster Architecture / GPU Performance
   cells (consistent with the formula-driven approach)

### Todo 7: Checks — subscription-specific warnings

Add checks to `calculateChecks` (TS) and Sizing Summary D (Excel):
- If `subscriptionModel === 'ai_inference'` and training/tuning jobs > 0 → WARN
  "AI Inference does not support training; switch to AI Enterprise or OpenShift AI"
- If `subscriptionModel === 'rhel_ai'` and total nodes > 1 → WARN
  "RHEL AI is single-server only; this sizing spans N nodes"
- If `subscriptionModel === 'openshift_ai'` and `ocpLicensingModel === 'bare_metal'`
  and customer is on a third-party hypervisor → WARN
  "Bare-metal OCP SKU not available under third-party virtualization; use core-pair"

### Todo 8: Backward compatibility

- `DEFAULT_PLATFORM_CONFIG.subscriptionModel` defaults to `'ai_enterprise'`
- Existing saved wizard state (localStorage) that has no `subscriptionModel` field
  should be treated as `'ai_enterprise'` via `?? 'ai_enterprise'` fallback
- Existing smoke test fixture updated with `subscriptionModel: 'ai_enterprise'`
- Excel generator gracefully falls back to AI Enterprise if `subscriptionModel` is
  missing from payload

## Files touched

| File | Change |
|---|---|
| `data/subscription-skus.json` | **New** — SKU catalog reference data |
| `lib/wizard/types.ts` | Add `subscriptionModel` + `ocpLicensingModel` to `PlatformConfig` |
| `lib/wizard/componentData.ts` | Export SKU catalog type + data |
| `lib/wizard/sizingCalculator.ts` | New `calculateSubscriptions()`, richer `SizingResult.subscriptions` |
| `app/wizard/step4/page.tsx` | Add subscription model selector card |
| `app/wizard/step5/page.tsx` | Multi-SKU display in headline and subscriptions card |
| `excel-service/generator.py` | Rewrite `build_subscriptions_sheet` for multi-model |
| `excel-service/test_generator_smoke.py` | Assert correct SKUs per model in fixture |
| `contexts/WizardContext.tsx` | No structural change (subscriptionModel flows via PlatformConfig) |
| `data/reference-constants.json` | Optional: add typical GPU server vCPU defaults |

## Estimated effort

| Phase | Items | Estimate |
|---|---|---|
| Data + types | Todos 1-2 | Small (reference JSON + 2 fields) |
| Calculator | Todo 3 | Medium (new function + SubscriptionEstimate type) |
| Step 4 UI | Todo 4 | Small (radio selector + conditional OCP licensing dropdown) |
| Step 5 UI | Todo 5 | Small (table replaces stat card) |
| Excel generator | Todo 6 | Medium-Large (multi-model branching, formula-driven per-SKU rows) |
| Checks | Todo 7 | Small (3 conditionals) |
| Compat + tests | Todo 8 | Small |
| **Total** | | **~1 focused session** |

## Open questions

1. **Exact SKU codes**: The guide uses product names but not actual SKU part numbers for
   AI Inference, OpenShift AI, and RHEL AI. Need to confirm with Red Hat pricing team
   or the official price list (MCT4990 is known; others TBD).
2. **GPU worker node vCPU**: For OpenShift AI core-pair counting, we need the aggregate
   vCPU across GPU worker nodes, which we don't currently track. Sensible default +
   optional override is the pragmatic path.
3. **NVL72 special case**: The guide calls out NVIDIA NVL72 needing 18 subscriptions
   (one per CPU tray). Should the tool detect NVL72 hardware and handle this, or is a
   manual note sufficient?
4. **Standard vs. Premium SLA**: Each model offers Standard (8×5) or Premium (24×7)
   support. Currently the tool assumes Premium. Should we add an SLA toggle that
   changes the SKU suffix?
