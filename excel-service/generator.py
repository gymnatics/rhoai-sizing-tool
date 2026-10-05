"""
Builds the RHOAI sizing Excel workbook from the wizard's raw state
(see lib/wizard/types.ts on the Next.js side for the JSON shape).

Formula-driven rewrite (V2): literal values live only on the Inputs, Reference
and Models sheets (yellow fill = editable input, no fill = sourced constant).
Every other sheet is built from Excel *formula strings* that reference those
cells, so an SE can open the workbook, change an assumption on Inputs/Reference,
and watch every downstream sheet recalculate — instead of staring at numbers
baked in by this Python service.

Mirrors the sheet structure of the reference RHOAI sizing workbook:
Disclaimer, Inputs, Reference, Models, Sizing Summary, Workload Sizing,
GPU Performance, Cluster Architecture, Cluster Requirements,
Red Hat Subscriptions, Hardware BOM, Backup and DR, Model Catalog.

In 'llm-only' mode (wizard skipped Steps 1/3/4) the workbook is reduced to
Disclaimer + Model Catalog + GPU Performance, driven off the Models sheet only.

Input is treated defensively (plain dicts, .get() with fallbacks) since the
TypeScript wizard types may evolve independently of this service.
"""

from __future__ import annotations

import json
from datetime import date
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet

# data/ lives one directory up from excel-service/ in the rhoai-sizing-app repo.
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Sentinel stored in a UseCase's sizedModelId to mean "intentionally served by a model
# outside this wizard" — must match lib/wizard/types.ts's EXTERNAL_MODEL_SENTINEL exactly.
EXTERNAL_MODEL_SENTINEL = "__external__"


@lru_cache(maxsize=None)
def _load_data_file(name: str) -> dict:
    path = DATA_DIR / name
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)

# ─── Styling constants (color legend) ───────────────────────────────────────
# Yellow  = Inputs sheet, editable literal values entered in the wizard.
# No fill = Reference/Models sheet, sourced constants / ConfigIQ-captured data.
# Green font = cross-sheet formula link (pure passthrough from another sheet).
# Black font (default) = computed formula.
# OK/WARN fill = pass/fail checks.

TITLE_FILL = PatternFill("solid", fgColor="CC0000")
HEADER_FILL = PatternFill("solid", fgColor="151515")
SUBHEADER_FILL = PatternFill("solid", fgColor="F0F0F0")
YELLOW_INPUT_FILL = PatternFill("solid", fgColor="FFF9DB")
INPUT_FILL = YELLOW_INPUT_FILL  # backwards-compatible alias
WARN_FILL = PatternFill("solid", fgColor="FDF2E0")
OK_FILL = PatternFill("solid", fgColor="E7F5E9")

TITLE_FONT = Font(bold=True, size=14, color="FFFFFF")
HEADER_FONT = Font(bold=True, size=11, color="FFFFFF")
SUBHEADER_FONT = Font(bold=True, size=10)
BOLD = Font(bold=True)
ITALIC_NOTE = Font(italic=True, size=9, color="808080")
GREEN_FONT = Font(color="1E7B34")
THIN_BORDER = Border(*([Side(style="thin", color="D2D2D2")] * 4))

# Fixed CPU worker node shape (vCPU/RAM per node), matches the RHOAI install minimum tier used elsewhere.
CPU_WORKER_VCPU = 16
CPU_WORKER_RAM_GIB = 64


def _title_row(ws: Worksheet, text: str, row: int = 1, span: int = 8) -> None:
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=span)
    cell = ws.cell(row=row, column=1, value=text)
    cell.font = TITLE_FONT
    cell.fill = TITLE_FILL
    cell.alignment = Alignment(vertical="center", horizontal="left", indent=1)
    ws.row_dimensions[row].height = 24


def _header_row(ws: Worksheet, headers: list[str], row: int, start_col: int = 1) -> None:
    for i, h in enumerate(headers):
        cell = ws.cell(row=row, column=start_col + i, value=h)
        cell.font = HEADER_FONT
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(vertical="center")
        cell.border = THIN_BORDER


def _data_row(
    ws: Worksheet, values: list[Any], row: int, start_col: int = 1,
    fill: PatternFill | None = None, font: Font | None = None,
) -> None:
    for i, v in enumerate(values):
        cell = ws.cell(row=row, column=start_col + i, value=v)
        cell.border = THIN_BORDER
        if fill:
            cell.fill = fill
        if font:
            cell.font = font


def _autosize(ws: Worksheet, widths: dict[int, int]) -> None:
    for col, width in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = width


def _addr(col: int, row: int) -> str:
    return f"{get_column_letter(col)}{row}"


def _sref(sheet: str, col: int, row: int) -> str:
    """Cross-sheet cell reference, quoting the sheet name (handles spaces)."""
    return f"'{sheet}'!{_addr(col, row)}"


def _gpu_names_loosely_match(a: str, b: str) -> bool:
    """Hardware inventory often uses short codes ("B300", "H200 NVL") while ConfigIQ
    returns full descriptive names ("NVIDIA B300 SXM6 AC"). An exact string match would
    silently ignore a customer's hardware inventory (and its "servers" field) whenever the
    two naming conventions differ, which is the common case."""
    if not a or not b:
        return False
    la, lb = a.strip().lower(), b.strip().lower()
    if la == lb:
        return True
    shorter, longer = (la, lb) if len(la) <= len(lb) else (lb, la)
    first_token = shorter.split(" ")[0]
    return len(first_token) > 1 and first_token in longer


def _gpus_per_node_for(gpu_name: str, hardware: list[dict]) -> int:
    for h in hardware:
        servers = h.get("servers")
        if servers and _gpu_names_loosely_match(h.get("gpu", ""), gpu_name):
            return max(1, round((h.get("count") or 0) / servers))
    lower = (gpu_name or "").lower()
    if "nvl" in lower or "pcie" in lower:
        return 4
    return 8


def _closest_gpu_spec_row(gpu_name: str, gpu_spec_rows: dict[str, int]) -> int | None:
    if gpu_name in gpu_spec_rows:
        return gpu_spec_rows[gpu_name]
    lower = (gpu_name or "").lower()
    for name, row in gpu_spec_rows.items():
        token = name.lower().split(" ")[0]
        if token and token in lower:
            return row
    return None


# ─── Fixed column layouts for one-row-per-item tables ───────────────────────
# Keeping these as module constants (rather than re-deriving per sheet) means
# every builder function can address "the GPU column on Models" etc. without
# re-reading a header row.

HW_COL = {"type": 1, "gpu": 2, "count": 3, "form_factor": 4, "servers": 5}

USECASE_COL = {
    "name": 1, "served_by": 2, "users_low": 3, "users_high": 4, "share_in_flight": 5,
    "input_tokens": 6, "output_tokens": 7, "prefix_cache_hit_rate": 8, "ttft_target_s": 9,
    "tokens_per_s_target": 10, "screened_by_guard": 11, "guard_calls_per_request": 12, "notes": 13,
}

MODEL_COL = {
    "model": 1, "params_b": 2, "active_params_b": 3, "precision": 4, "gpu": 5,
    "gpus_per_replica": 6, "tensor_parallel_size": 7, "replicas_needed": 8, "gpus_needed": 9,
    "weights_gb": 10, "kv_cache_gb": 11, "max_concurrent_per_replica": 12, "ttft_estimate_ms": 13,
    "tpot_ms": 14, "tokens_per_second": 15, "tokens_per_second_per_user": 16, "mode": 17,
    "source": 18, "captured_at": 19,
}

GPU_SPEC_COL = {"gpu": 1, "memory_gb": 2, "hbm_bw": 3, "fp4": 4, "fp8": 5, "bf16": 6, "power_w": 7, "form_factor": 8}
TIER_COL = {"workers_up_to": 1, "cpu_cores": 2, "memory_gb": 3, "cpu_cores_ovnk": 4, "memory_gb_ovnk": 5}
OVERHEAD_COL = {"key": 1, "label": 2, "vcpu": 3, "ram_gib": 4, "gated_by": 5}

WORKLOAD_C_COL = {
    "model": 1, "rif_low": 2, "rif_high": 3, "rif_stress": 4,
    "rep_low": 5, "rep_high": 6, "rep_stress": 7,
    "gpu_low": 8, "gpu_high": 9, "gpu_stress": 10,
}

GPU_PERF_COL = {
    "gpu": 1, "memory_gb": 2, "gpus_per_node": 3,
    "req_low": 4, "req_high": 5, "req_stress": 6,
    "nodes_low": 7, "nodes_high": 8, "nodes_stress": 9,
}

ARCH_OVERHEAD_COL = {"label": 1, "applies": 2, "vcpu": 3, "ram_gib": 4}
ARCH_DYNAMIC_COL = {"label": 1, "vcpu": 2, "ram_gib": 3, "basis": 4}


# ─── Data sheets (literal values) ───────────────────────────────────────────

def build_disclaimer_sheet(wb: Workbook, customer_name: str, mode: str) -> None:
    ws = wb["Disclaimer"]
    _title_row(ws, f"{customer_name or 'Customer'} – RHAIE Sizing Approximation", span=6)
    ws["A3"] = (
        "This is a sizing approximation for Red Hat AI Enterprise on OpenShift. Numbers and suggestions here "
        "are based on approximation and estimates provided through the RHOAI Sizing Wizard app. For an actual "
        "sizing, a separate sizing workshop with Red Hat is recommended."
    )
    ws["A3"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells("A3:F6")
    if mode == "llm-only":
        ws["A8"] = (
            "Generated in LLM-only mode: this workbook covers model/GPU sizing only (Model Catalog + GPU "
            "Performance). Run the full RHOAI Sizing Wizard for platform overhead, storage, and subscriptions."
        )
    else:
        ws["A8"] = (
            "This workbook is formula-driven: the Inputs, Reference and Models sheets hold literal values "
            "(yellow fill = editable); every other sheet computes from those cells with real Excel formulas. "
            "The live Step 5 dashboard in the wizard app uses the same assumptions for a quick preview, but "
            "this workbook — not the dashboard — is the canonical, auditable deliverable."
        )
    ws["A8"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells("A8:F11")
    ws["A13"] = f"Generated: {date.today().isoformat()}"
    ws["A13"].font = ITALIC_NOTE
    _autosize(ws, {1: 100})


def build_inputs_sheet(wb: Workbook, wizard_state: dict, components_ref: dict) -> dict:
    ws = wb["Inputs"]
    customer = wizard_state.get("customer", {}) or {}
    platform = wizard_state.get("platform", {}) or {}
    use_cases = wizard_state.get("useCases", []) or []
    sized_models = wizard_state.get("sizedModels", []) or []

    _title_row(ws, "Inputs — literal values entered in the wizard (yellow = editable)", span=13)
    layout: dict = {"customer": {}, "env": {}, "platform": {}, "components": {}, "per_project": {}}

    row = 3
    ws.cell(row=row, column=1, value="A. Customer & deployment").font = BOLD
    row += 1
    for key, label, value in [
        ("name", "Customer name", customer.get("name", "")),
        ("project", "Project name", customer.get("project", "")),
        ("deploymentType", "Deployment type", customer.get("deploymentType", "")),
        ("openshiftVersion", "OpenShift version", customer.get("openshiftVersion", "")),
        ("connectivity", "Network connectivity", customer.get("connectivity", "")),
        ("target", "Deployment target", customer.get("target", "")),
        ("growthHorizonYears", "Planning horizon (years)", customer.get("growthHorizonYears", 0)),
        ("annualGrowthRate", "Annual growth rate", customer.get("annualGrowthRate", 0)),
    ]:
        ws.cell(row=row, column=1, value=label)
        ws.cell(row=row, column=2, value=value).fill = YELLOW_INPUT_FILL
        layout["customer"][key] = row
        row += 1

    environments = customer.get("environments", {}) or {}
    for key, label in [
        ("production", "Env: Production"), ("disasterRecovery", "Env: Disaster recovery"),
        ("test", "Env: Test / UAT"), ("development", "Env: Development"),
    ]:
        ws.cell(row=row, column=1, value=label)
        ws.cell(row=row, column=2, value=bool(environments.get(key, False))).fill = YELLOW_INPUT_FILL
        layout["env"][key] = row
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="B. Hardware inventory").font = BOLD
    row += 1
    _header_row(ws, ["Type", "GPU", "Count", "Form factor", "Servers"], row)
    row += 1
    hw_first = row
    hardware_rows: list[int] = []
    for h in customer.get("existingHardware", []) or []:
        _data_row(ws, ["Existing", h.get("gpu"), h.get("count", 0), h.get("formFactor", ""), h.get("servers", "")], row, fill=YELLOW_INPUT_FILL)
        hardware_rows.append(row)
        row += 1
    for h in customer.get("plannedHardware", []) or []:
        _data_row(ws, ["Planned", h.get("gpu"), h.get("count", 0), h.get("formFactor", ""), h.get("servers", "")], row, fill=YELLOW_INPUT_FILL)
        hardware_rows.append(row)
        row += 1
    layout["hardware_rows"] = hardware_rows
    layout["hardware_first_row"] = hw_first
    layout["hardware_last_row"] = row - 1 if hardware_rows else hw_first
    if not hardware_rows:
        row += 1  # keep an empty data row under the header for a non-degenerate range

    row += 1
    ws.cell(row=row, column=1, value="C. Platform configuration").font = BOLD
    row += 1
    for key, label in [
        ("numProjects", "Number of data science projects"),
        ("concurrentWorkbenches", "Concurrent workbenches"),
        ("workbenchPvcSizeGb", "Workbench PVC size (GB)"),
        ("concurrentTrainingJobs", "Concurrent training jobs"),
        ("concurrentEvalJobs", "Concurrent eval jobs"),
        ("vectorDbInstances", "Vector DB instances"),
        ("concurrentPipelineRuns", "Concurrent pipeline runs"),
        ("infraNodesPerCluster", "Infra nodes per cluster"),
        ("maxCpuWorkerUtilization", "Max CPU worker utilization (0-1)"),
        ("modelVersionsKept", "Model versions kept"),
        ("prometheusRetentionDays", "Prometheus retention (days)"),
        ("lokiRetentionDays", "Loki retention (days)"),
    ]:
        ws.cell(row=row, column=1, value=label)
        ws.cell(row=row, column=2, value=platform.get(key, 0)).fill = YELLOW_INPUT_FILL
        layout["platform"][key] = row
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="D. Enabled DataScienceCluster components").font = BOLD
    row += 1
    _header_row(ws, ["Component", "Enabled"], row)
    row += 1
    enabled_components = platform.get("enabledComponents", {}) or {}
    for c in components_ref.get("dscComponents", []):
        key = c.get("key")
        ws.cell(row=row, column=1, value=c.get("label", key))
        ws.cell(row=row, column=2, value=bool(enabled_components.get(key, False))).fill = YELLOW_INPUT_FILL
        layout["components"][key] = row
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="E. Enabled per-project instances").font = BOLD
    row += 1
    _header_row(ws, ["Per-project instance", "Enabled"], row)
    row += 1
    enabled_pp = platform.get("enabledPerProjectInstances", {}) or {}
    for p in components_ref.get("perProjectInstances", []):
        key = p.get("key")
        ws.cell(row=row, column=1, value=p.get("label", key))
        ws.cell(row=row, column=2, value=bool(enabled_pp.get(key, False))).fill = YELLOW_INPUT_FILL
        layout["per_project"][key] = row
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="F. Use cases (freeform, mapped to a sized model)").font = BOLD
    row += 1
    _header_row(ws, [
        "Use case", "Served by model", "Users — Low", "Users — High", "Share in flight",
        "Input tokens", "Output tokens", "Prefix cache hit rate", "TTFT target (s)",
        "Tokens/s target", "Screened by guard", "Guard calls/request", "Notes",
    ], row)
    row += 1
    use_case_row_by_id: dict[str, int] = {}
    for uc in use_cases:
        if uc.get("sizedModelId") == EXTERNAL_MODEL_SENTINEL:
            model_label = "External (not sized in wizard)"
        else:
            model_label = next((m.get("model") for m in sized_models if m.get("id") == uc.get("sizedModelId")), "")
        _data_row(ws, [
            uc.get("name"), model_label, uc.get("concurrentUsersLow", 0), uc.get("concurrentUsersHigh", 0),
            uc.get("shareInFlight", 0), uc.get("inputTokens", 0), uc.get("outputTokens", 0),
            uc.get("prefixCacheHitRate", 0), uc.get("ttftTargetS", 0), uc.get("tokensPerSecondTarget", 0),
            bool(uc.get("screenedByGuard", False)), uc.get("guardCallsPerRequest", 0), uc.get("notes", ""),
        ], row, fill=YELLOW_INPUT_FILL)
        use_case_row_by_id[uc.get("id")] = row
        row += 1
    layout["use_case_row_by_id"] = use_case_row_by_id

    _autosize(ws, {1: 42, 2: 22, 3: 14, 4: 14, 5: 14, 6: 14, 7: 14, 8: 16, 9: 14, 10: 14, 11: 14, 12: 16, 13: 40})
    return layout


def build_reference_sheet(wb: Workbook, reference_constants: dict, components_ref: dict) -> dict:
    ws = wb["Reference"]
    _title_row(ws, "Reference — sourced constants (RHOAI 3.5 sizing workbook, OpenShift docs)", span=8)
    layout: dict = {"gpu_specs": {}, "constants": {}, "control_plane_tiers": [], "infra_tiers": [], "overhead_items": {}}

    row = 3
    ws.cell(row=row, column=1, value="A. GPU specifications").font = BOLD
    row += 1
    _header_row(ws, ["GPU", "Memory (GB)", "HBM BW (TB/s)", "Dense FP4 PFLOPS", "Dense FP8 PFLOPS",
                     "Dense BF16 PFLOPS", "Power (W)", "Form factor"], row)
    row += 1
    for g in reference_constants.get("gpuSpecifications", []):
        _data_row(ws, [g.get("gpu"), g.get("memoryGB"), g.get("hbmBandwidthTBs"), g.get("denseFp4Pflops"),
                       g.get("denseFp8Pflops"), g.get("denseBf16Pflops"), g.get("powerW"), g.get("formFactor")], row)
        layout["gpu_specs"][g.get("gpu")] = row
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="B. Control plane sizing tiers (by total worker node count, High scenario)").font = BOLD
    row += 1
    _header_row(ws, ["Workers up to", "CPU cores", "Memory (GB)", "CPU cores (OVN-K)", "Memory GB (OVN-K)"], row)
    row += 1
    for t in reference_constants.get("controlPlaneSizingTiers", []):
        _data_row(ws, [t.get("workersUpTo"), t.get("cpuCores"), t.get("memoryGB"), t.get("cpuCoresOvnK"), t.get("memoryGBOvnK")], row)
        layout["control_plane_tiers"].append(row)
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="C. Infra node sizing tiers (by total worker node count, High scenario)").font = BOLD
    row += 1
    _header_row(ws, ["Workers up to", "CPU cores", "Memory (GB)"], row)
    row += 1
    for t in reference_constants.get("infraNodeSizingTiers", []):
        _data_row(ws, [t.get("workersUpTo"), t.get("cpuCores"), t.get("memoryGB")], row)
        layout["infra_tiers"].append(row)
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="D. Non-GPU platform overhead line items (Cluster Architecture Table D)").font = BOLD
    row += 1
    _header_row(ws, ["Key", "Label", "vCPU", "RAM (GiB)", "Gated by"], row)
    row += 1
    for item in components_ref.get("platformOverheadLineItems", []):
        gated_by = item.get("gatedBy")
        gated_label = gated_by if isinstance(gated_by, str) else " OR ".join(gated_by)
        _data_row(ws, [item.get("key"), item.get("label"), item.get("vcpu"), item.get("ramGiB"), gated_label], row)
        layout["overhead_items"][item.get("key")] = {
            "row": row, "gated_by": gated_by,
            "scales_with_runs": bool(item.get("scalesWithConcurrentPipelineRuns")),
        }
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="E. Platform constants").font = BOLD
    row += 1
    for key, value in (reference_constants.get("platformConstants", {}) or {}).items():
        ws.cell(row=row, column=1, value=key)
        ws.cell(row=row, column=2, value=value)
        layout["constants"][key] = row
        row += 1

    _autosize(ws, {1: 22, 2: 48, 3: 16, 4: 16, 5: 18, 6: 18, 7: 12, 8: 32})
    return layout


def build_models_sheet(wb: Workbook, sized_models: list) -> dict:
    ws = wb["Models"]
    _title_row(ws, "Models — captured from ConfigIQ (Step 2 Recommend/Predict results)", span=10)
    layout: dict = {"row_by_id": {}}
    header_row = 3
    headers = [
        "Model", "Params (B)", "Active params (B)", "Precision", "GPU", "GPUs/replica",
        "TP size", "Replicas (ConfigIQ)", "GPUs (ConfigIQ)", "Weights (GB)", "KV cache/1K tok (GB)",
        "Max concurrent/replica", "TTFT est. (ms)", "TPOT (ms)", "Tokens/s", "Tokens/s/user",
        "Mode", "Source", "Captured at",
    ]
    _header_row(ws, headers, header_row)
    row = header_row + 1
    for m in sized_models:
        _data_row(ws, [
            m.get("model"), m.get("paramsB"), m.get("activeParamsB"), m.get("precision"), m.get("gpu"),
            m.get("gpusPerReplica"), m.get("tensorParallelSize"), m.get("replicasNeeded"), m.get("gpusNeeded"),
            m.get("weightsGb"), m.get("kvCacheGb"), m.get("maxConcurrentPerReplica"), m.get("ttftEstimateMs"),
            m.get("tpotMs"), m.get("tokensPerSecond"), m.get("tokensPerSecondPerUser"), m.get("mode"),
            m.get("source"), m.get("capturedAt"),
        ], row, fill=YELLOW_INPUT_FILL)
        layout["row_by_id"][m.get("id")] = row
        row += 1
    layout["header_row"] = header_row
    layout["last_row"] = row - 1 if sized_models else header_row
    _autosize(ws, {1: 36, 11: 20, 19: 22})
    return layout


# ─── Formula-driven sheets ───────────────────────────────────────────────────

def build_workload_sizing_sheet(wb: Workbook, wizard_state: dict, inputs_layout: dict, models_layout: dict) -> dict:
    ws = wb["Workload Sizing"]
    customer = wizard_state.get("customer", {}) or {}
    sized_models = wizard_state.get("sizedModels", []) or []
    use_cases = wizard_state.get("useCases", []) or []

    _title_row(ws, f"{customer.get('name') or 'Customer'} — use cases, models and GPU demand", span=10)

    row = 3
    ws.cell(row=row, column=1, value="A. Model deployments (from ConfigIQ Step 2 — see Models sheet)").font = BOLD
    row += 1
    _header_row(ws, ["Model", "GPU", "GPUs/replica", "TP size", "Weights (GB)", "KV cache/1K tok (GB)",
                     "Max concurrent/replica", "TTFT est. (ms)", "Tokens/s", "Precision"], row)
    row += 1
    for m in sized_models:
        mrow = models_layout["row_by_id"][m.get("id")]
        _data_row(ws, [
            f"={_sref('Models', MODEL_COL['model'], mrow)}", f"={_sref('Models', MODEL_COL['gpu'], mrow)}",
            f"={_sref('Models', MODEL_COL['gpus_per_replica'], mrow)}", f"={_sref('Models', MODEL_COL['tensor_parallel_size'], mrow)}",
            f"={_sref('Models', MODEL_COL['weights_gb'], mrow)}", f"={_sref('Models', MODEL_COL['kv_cache_gb'], mrow)}",
            f"={_sref('Models', MODEL_COL['max_concurrent_per_replica'], mrow)}", f"={_sref('Models', MODEL_COL['ttft_estimate_ms'], mrow)}",
            f"={_sref('Models', MODEL_COL['tokens_per_second'], mrow)}", f"={_sref('Models', MODEL_COL['precision'], mrow)}",
        ], row, font=GREEN_FONT)
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="B. Use cases — edit values on the Inputs sheet, section F").font = BOLD
    row += 1
    _header_row(ws, ["Use case", "Served by model", "Users — Low", "Users — High", "Share in flight",
                     "Input tokens", "Output tokens", "Prefix cache hit rate", "TTFT target (s)",
                     "Tokens/s target", "Guard screened", "Notes"], row)
    row += 1
    for uc in use_cases:
        urow = inputs_layout["use_case_row_by_id"][uc.get("id")]
        _data_row(ws, [
            f"={_sref('Inputs', USECASE_COL['name'], urow)}", f"={_sref('Inputs', USECASE_COL['served_by'], urow)}",
            f"={_sref('Inputs', USECASE_COL['users_low'], urow)}", f"={_sref('Inputs', USECASE_COL['users_high'], urow)}",
            f"={_sref('Inputs', USECASE_COL['share_in_flight'], urow)}", f"={_sref('Inputs', USECASE_COL['input_tokens'], urow)}",
            f"={_sref('Inputs', USECASE_COL['output_tokens'], urow)}", f"={_sref('Inputs', USECASE_COL['prefix_cache_hit_rate'], urow)}",
            f"={_sref('Inputs', USECASE_COL['ttft_target_s'], urow)}", f"={_sref('Inputs', USECASE_COL['tokens_per_s_target'], urow)}",
            f"={_sref('Inputs', USECASE_COL['screened_by_guard'], urow)}", f"={_sref('Inputs', USECASE_COL['notes'], urow)}",
        ], row, font=GREEN_FONT)
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="C. Load per model deployment (Low / High / Stress)").font = BOLD
    row += 1
    ws.cell(row=row, column=1, value=(
        "Stress methodology: every High-estimate user is treated as having a request in flight at once "
        "(ignores Share in flight — that factor is used only for the Low/High columns). Click a Stress cell "
        "below vs. a Low/High cell in the same row to see the formula difference."
    ))
    ws.cell(row=row, column=1).font = ITALIC_NOTE
    ws.cell(row=row, column=1).alignment = Alignment(wrap_text=True, vertical="top")
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=10)
    ws.row_dimensions[row].height = 30
    row += 1
    _header_row(ws, ["Model", "Requests in flight — Low", "Requests in flight — High", "Requests in flight — Stress",
                     "Replicas — Low", "Replicas — High", "Replicas — Stress",
                     "GPUs — Low", "GPUs — High", "GPUs — Stress"], row)
    row += 1

    model_demand_row_by_id: dict[str, int] = {}
    for m in sized_models:
        mid = m.get("id")
        mrow = models_layout["row_by_id"][mid]
        mapped = [uc for uc in use_cases if uc.get("sizedModelId") == mid]
        model_cell = f"={_sref('Models', MODEL_COL['model'], mrow)}"
        replicas_ref = _sref("Models", MODEL_COL["replicas_needed"], mrow)
        concurrency_ref = _sref("Models", MODEL_COL["max_concurrent_per_replica"], mrow)
        gpus_per_replica_ref = _sref("Models", MODEL_COL["gpus_per_replica"], mrow)
        gpus_needed_ref = _sref("Models", MODEL_COL["gpus_needed"], mrow)

        if mapped:
            low_terms, high_terms, stress_terms = [], [], []
            for uc in mapped:
                urow = inputs_layout["use_case_row_by_id"][uc.get("id")]
                low_ref = _sref("Inputs", USECASE_COL["users_low"], urow)
                high_ref = _sref("Inputs", USECASE_COL["users_high"], urow)
                share_ref = _sref("Inputs", USECASE_COL["share_in_flight"], urow)
                low_terms.append(f"{low_ref}*{share_ref}")
                high_terms.append(f"{high_ref}*{share_ref}")
                stress_terms.append(high_ref)  # Stress: no share-in-flight multiplication — the visible difference
            rif_low = "=" + "+".join(low_terms)
            rif_high = "=" + "+".join(high_terms)
            rif_stress = "=" + "+".join(stress_terms)
        else:
            rif_low, rif_high, rif_stress = 0, 0, 0

        rif_low_addr = _addr(WORKLOAD_C_COL["rif_low"], row)
        rif_high_addr = _addr(WORKLOAD_C_COL["rif_high"], row)
        rif_stress_addr = _addr(WORKLOAD_C_COL["rif_stress"], row)
        rep_low_addr = _addr(WORKLOAD_C_COL["rep_low"], row)
        rep_high_addr = _addr(WORKLOAD_C_COL["rep_high"], row)
        rep_stress_addr = _addr(WORKLOAD_C_COL["rep_stress"], row)

        if mapped:
            rep_low = f"=MAX({replicas_ref},ROUNDUP({rif_low_addr}/MAX(1,{concurrency_ref}),0))"
            rep_high = f"=MAX({replicas_ref},ROUNDUP({rif_high_addr}/MAX(1,{concurrency_ref}),0))"
            rep_stress = f"=MAX({replicas_ref},ROUNDUP({rif_stress_addr}/MAX(1,{concurrency_ref}),0))"
            gpu_low = f"={rep_low_addr}*{gpus_per_replica_ref}"
            gpu_high = f"={rep_high_addr}*{gpus_per_replica_ref}"
            gpu_stress = f"={rep_stress_addr}*{gpus_per_replica_ref}"
        else:
            rep_low = f"={replicas_ref}"
            rep_high = f"={replicas_ref}"
            rep_stress = f"={replicas_ref}"
            gpu_low = f"={gpus_needed_ref}"
            gpu_high = f"={gpus_needed_ref}"
            gpu_stress = f"={gpus_needed_ref}"

        _data_row(ws, [model_cell, rif_low, rif_high, rif_stress, rep_low, rep_high, rep_stress, gpu_low, gpu_high, gpu_stress], row)
        model_demand_row_by_id[mid] = row
        row += 1

    _autosize(ws, {1: 28, 2: 22, 3: 22, 4: 22, 5: 14, 6: 14, 7: 14, 8: 12, 9: 12, 10: 12})
    return {"model_demand_row_by_id": model_demand_row_by_id}


def build_gpu_performance_sheet(
    wb: Workbook, sized_models: list, hardware: list[dict],
    reference_layout: dict | None, workload_layout: dict | None, models_layout: dict,
    llm_only: bool = False,
) -> dict:
    """GPU demand and node counts by GPU type. In full mode this sums the
    Low/High/Stress GPU columns from the Workload Sizing sheet per GPU type;
    in llm-only mode (no use cases / Workload Sizing sheet) it reads the GPUs
    needed directly off each model's own Models-sheet row (ConfigIQ default),
    using the same value for Low/High/Stress since there is no demand model."""
    ws = wb["GPU Performance"]
    _title_row(ws, "GPU performance and node demand by GPU type", span=9)
    row = 3
    _header_row(ws, ["GPU", "GPU memory (GB)", "GPUs/node", "GPUs required — Low", "GPUs required — High",
                     "GPUs required — Stress", "Nodes required — Low", "Nodes required — High", "Nodes required — Stress"], row)
    row += 1
    table_first = row  # first data row, right after the header — tracked for downstream SUM ranges

    gpu_model_ids: dict[str, list[str]] = {}
    for m in sized_models:
        gpu_model_ids.setdefault(m.get("gpu"), []).append(m.get("id"))

    gpu_row_by_name: dict[str, int] = {}
    for gpu_name, model_ids in gpu_model_ids.items():
        if llm_only:
            terms = [_sref("Models", MODEL_COL["gpus_needed"], models_layout["row_by_id"][mid]) for mid in model_ids]
            req_low = "=" + "+".join(terms)
            req_high = req_low
            req_stress = req_low
        else:
            demand_rows = workload_layout["model_demand_row_by_id"]
            req_low = "=" + "+".join(_sref("Workload Sizing", WORKLOAD_C_COL["gpu_low"], demand_rows[mid]) for mid in model_ids)
            req_high = "=" + "+".join(_sref("Workload Sizing", WORKLOAD_C_COL["gpu_high"], demand_rows[mid]) for mid in model_ids)
            req_stress = "=" + "+".join(_sref("Workload Sizing", WORKLOAD_C_COL["gpu_stress"], demand_rows[mid]) for mid in model_ids)

        gpus_per_node = _gpus_per_node_for(gpu_name, hardware)

        if reference_layout is not None:
            spec_row = _closest_gpu_spec_row(gpu_name, reference_layout["gpu_specs"])
            memory_cell = f"={_sref('Reference', GPU_SPEC_COL['memory_gb'], spec_row)}" if spec_row else 0
        else:
            spec = next((g for g in _load_data_file("reference-constants.json").get("gpuSpecifications", [])
                         if g.get("gpu", "").lower() in gpu_name.lower() or gpu_name.lower() in g.get("gpu", "").lower()), None)
            memory_cell = spec.get("memoryGB") if spec else 0

        req_low_addr = _addr(GPU_PERF_COL["req_low"], row)
        req_high_addr = _addr(GPU_PERF_COL["req_high"], row)
        req_stress_addr = _addr(GPU_PERF_COL["req_stress"], row)
        gpn_addr = _addr(GPU_PERF_COL["gpus_per_node"], row)

        nodes_low = f"=IF({req_low_addr}=0,0,MAX(2,ROUNDUP({req_low_addr}/{gpn_addr},0)))"
        nodes_high = f"=IF({req_high_addr}=0,0,MAX(2,ROUNDUP({req_high_addr}/{gpn_addr},0)))"
        nodes_stress = f"=IF({req_stress_addr}=0,0,MAX(2,ROUNDUP({req_stress_addr}/{gpn_addr},0)))"

        _data_row(ws, [gpu_name, memory_cell, gpus_per_node, req_low, req_high, req_stress, nodes_low, nodes_high, nodes_stress], row)
        gpu_row_by_name[gpu_name] = row
        row += 1

    if not gpu_model_ids:
        # Keep downstream SUM ranges valid (non-degenerate) even with zero GPU types.
        _data_row(ws, ["(none)", 0, 0, 0, 0, 0, 0, 0, 0], row)
        row += 1
    table_last = row - 1

    _autosize(ws, {i: 20 for i in range(1, 10)})
    return {"gpu_row_by_name": gpu_row_by_name, "table_first_row": table_first, "table_last_row": table_last}

def build_cluster_architecture_sheet(
    wb: Workbook, wizard_state: dict, inputs_layout: dict, reference_layout: dict,
    gpu_perf_layout: dict, models_layout: dict, components_ref: dict, sized_models_count: int,
) -> dict:
    ws = wb["Cluster Architecture"]
    customer = wizard_state.get("customer", {}) or {}

    _title_row(ws, f"{customer.get('name') or 'Customer'} — target cluster architecture", span=5)

    const_rows = reference_layout["constants"]
    plat_rows = inputs_layout["platform"]
    comp_rows = inputs_layout["components"]
    pp_rows = inputs_layout["per_project"]

    def const_ref(key: str) -> str:
        return _sref("Reference", 2, const_rows[key])

    def plat_ref(key: str) -> str:
        return _sref("Inputs", 2, plat_rows[key])

    def comp_ref(key: str) -> str:
        return _sref("Inputs", 2, comp_rows[key])

    row = 3
    ws.cell(row=row, column=1, value="A. Non-GPU platform overhead build-up (Table D)").font = BOLD
    row += 1
    ws.cell(row=row, column=1, value=(
        "Each row is gated on whether its parent component is enabled on the Inputs sheet (section D) — "
        "toggle a component there and this table recalculates."
    )).font = ITALIC_NOTE
    row += 1
    _header_row(ws, ["Line item", "Applies?", "vCPU", "RAM (GiB)"], row)
    row += 1

    hw_first = inputs_layout["hardware_first_row"]
    hw_last = inputs_layout["hardware_last_row"]
    hw_sum_expr = f"SUM(Inputs!{_addr(HW_COL['count'], hw_first)}:{_addr(HW_COL['count'], hw_last)})"

    overhead_items = reference_layout["overhead_items"]
    overhead_value_rows: list[int] = []
    for key, meta in overhead_items.items():
        ref_row = meta["row"]
        gated_by = meta["gated_by"]
        label_cell = f"={_sref('Reference', OVERHEAD_COL['label'], ref_row)}"
        applies_addr = _addr(ARCH_OVERHEAD_COL["applies"], row)

        if gated_by == "always":
            applies_formula = "=TRUE"
        elif gated_by == "anyGpu":
            applies_formula = f"=OR({hw_sum_expr}>0,{sized_models_count}>0)"
        else:
            gate_cells = [comp_ref(k) for k in gated_by if k in comp_rows]
            applies_formula = "=OR(" + ",".join(gate_cells) + ")" if gate_cells else "=FALSE"

        vcpu_base = _sref("Reference", OVERHEAD_COL["vcpu"], ref_row)
        ram_base = _sref("Reference", OVERHEAD_COL["ram_gib"], ref_row)

        if meta.get("scales_with_runs"):
            runs_ref = plat_ref("concurrentPipelineRuns")
            vcpu_formula = f"=ROUND(IF({applies_addr},{vcpu_base}+MAX(0,{runs_ref}-1)*1,0),2)"
            ram_formula = f"=ROUND(IF({applies_addr},{ram_base}+MAX(0,{runs_ref}-1)*3,0),2)"
        else:
            vcpu_formula = f"=IF({applies_addr},{vcpu_base},0)"
            ram_formula = f"=IF({applies_addr},{ram_base},0)"

        _data_row(ws, [label_cell, applies_formula, vcpu_formula, ram_formula], row)
        overhead_value_rows.append(row)
        row += 1

    overhead_first = overhead_value_rows[0] if overhead_value_rows else row
    overhead_last = overhead_value_rows[-1] if overhead_value_rows else row
    _data_row(ws, [
        "Subtotal — platform overhead line items", "",
        f"=ROUND(SUM(C{overhead_first}:C{overhead_last}),2)", f"=ROUND(SUM(D{overhead_first}:D{overhead_last}),2)",
    ], row, font=BOLD)
    overhead_subtotal_row = row
    row += 2

    ws.cell(row=row, column=1, value="B. Dynamic non-GPU demand (scales with wizard inputs)").font = BOLD
    row += 1
    _header_row(ws, ["Item", "vCPU", "RAM (GiB)", "Basis"], row)
    row += 1

    dynamic_rows: list[int] = []

    distributed_keys = [k for k in ("kueue", "ray", "trainer") if k in comp_rows]
    distributed_or = "OR(" + ",".join(comp_ref(k) for k in distributed_keys) + ")" if distributed_keys else "FALSE"
    _data_row(ws, [
        "Distributed workloads controllers (Kueue/Ray/Trainer)",
        f"=IF({distributed_or},{const_ref('distributedWorkloadsControllersVcpu')},0)",
        f"=IF({distributed_or},{const_ref('distributedWorkloadsControllersRamGiB')},0)",
        "On if Kueue, Ray, or Trainer is enabled",
    ], row)
    dynamic_rows.append(row); row += 1

    _data_row(ws, [
        "Workbenches (Medium profile, 8 vCPU / 16 GiB each)",
        f"={plat_ref('concurrentWorkbenches')}*8", f"={plat_ref('concurrentWorkbenches')}*16",
        "Concurrent workbenches × Medium profile",
    ], row)
    dynamic_rows.append(row); row += 1

    _data_row(ws, [
        "Training jobs (CPU-side footprint only; GPUs counted separately)",
        f"={plat_ref('concurrentTrainingJobs')}*8", f"={plat_ref('concurrentTrainingJobs')}*64",
        "Concurrent training jobs × LoRA-class footprint",
    ], row)
    dynamic_rows.append(row); row += 1

    _data_row(ws, [
        "Evaluation jobs", f"={plat_ref('concurrentEvalJobs')}*4", f"={plat_ref('concurrentEvalJobs')}*16",
        "Concurrent eval jobs",
    ], row)
    dynamic_rows.append(row); row += 1

    _data_row(ws, [
        "Vector DB instances", f"={plat_ref('vectorDbInstances')}*4", f"={plat_ref('vectorDbInstances')}*16",
        "Vector DB instances",
    ], row)
    dynamic_rows.append(row); row += 1

    for pp in components_ref.get("perProjectInstances", []):
        key = pp.get("key")
        if key not in pp_rows:
            continue
        cpu_per = pp.get("cpuPerInstance", 0.5)
        ram_per = pp.get("ramPerInstanceGiB", 1)
        instances_per_project = pp.get("instancesPerProject", 1)
        enabled_ref = _sref("Inputs", 2, pp_rows[key])
        num_projects_ref = plat_ref("numProjects")
        vcpu_formula = f"=ROUND(IF({enabled_ref},{instances_per_project}*{num_projects_ref}*{cpu_per},0),2)"
        ram_formula = f"=ROUND(IF({enabled_ref},{instances_per_project}*{num_projects_ref}*{ram_per},0),2)"
        _data_row(ws, [f"Per-project: {pp.get('label', key)}", vcpu_formula, ram_formula,
                       f"{instances_per_project}/project × projects, if enabled"], row)
        dynamic_rows.append(row); row += 1

    _data_row(ws, [
        "Sized-model sidecars (oauth-proxy etc.)",
        f"=ROUND({sized_models_count}*{const_ref('oauthProxySidecarVcpu')},2)",
        f"=ROUND({sized_models_count}*{const_ref('oauthProxySidecarRamGiB')},2)",
        f"{sized_models_count} sized model(s) × per-model sidecar",
    ], row)
    dynamic_rows.append(row); row += 1

    dyn_first, dyn_last = dynamic_rows[0], dynamic_rows[-1]
    _data_row(ws, [
        "Subtotal — dynamic non-GPU demand",
        f"=ROUND(SUM(B{dyn_first}:B{dyn_last}),2)", f"=ROUND(SUM(C{dyn_first}:C{dyn_last}),2)", "",
    ], row, font=BOLD)
    dynamic_subtotal_row = row
    row += 2

    ws.cell(row=row, column=1, value="C. Total non-GPU (CPU worker) demand").font = BOLD
    row += 1
    _header_row(ws, ["Metric", "Value", "Unit"], row)
    row += 1
    _data_row(ws, ["CPU worker vCPU demand", f"=ROUND(C{overhead_subtotal_row}+B{dynamic_subtotal_row},2)", "vCPU"], row)
    total_vcpu_row = row; row += 1
    _data_row(ws, ["CPU worker RAM demand", f"=ROUND(D{overhead_subtotal_row}+C{dynamic_subtotal_row},2)", "GiB"], row)
    total_ram_row = row; row += 1

    util_ref = plat_ref("maxCpuWorkerUtilization")
    min_workers_ref = const_ref("rhoaiInstallMinWorkerNodes")
    nodes_formula = (
        f"=MAX({min_workers_ref},"
        f"ROUNDUP(B{total_vcpu_row}/({CPU_WORKER_VCPU}*{util_ref}),0),"
        f"ROUNDUP(B{total_ram_row}/({CPU_WORKER_RAM_GIB}*{util_ref}),0))"
    )
    _data_row(ws, ["CPU worker nodes (computed)", nodes_formula, "nodes"], row)
    cpu_worker_nodes_row = row; row += 2

    gpu_first, gpu_last = gpu_perf_layout["table_first_row"], gpu_perf_layout["table_last_row"]
    total_gpu_nodes_high = f"SUM({_sref('GPU Performance', GPU_PERF_COL['nodes_high'], gpu_first)}:{_sref('GPU Performance', GPU_PERF_COL['nodes_high'], gpu_last)})"
    ws.cell(row=row, column=1, value="Total worker nodes (High) — used to pick control-plane/infra tiers")
    ws.cell(row=row, column=2, value=f"=B{cpu_worker_nodes_row}+{total_gpu_nodes_high}")
    total_workers_row = row
    row += 2

    ws.cell(row=row, column=1, value="D. Node pools").font = BOLD
    row += 1
    _header_row(ws, ["Role", "Count", "vCPU/node", "RAM (GB)/node"], row)
    row += 1

    tw_ref = f"B{total_workers_row}"

    def tier_ifs(tier_rows: list[int], value_col: int) -> str:
        parts = []
        for i, tr in enumerate(tier_rows):
            value = _sref("Reference", value_col, tr)
            if i == len(tier_rows) - 1:
                parts.append(f"TRUE,{value}")
            else:
                threshold = _sref("Reference", TIER_COL["workers_up_to"], tr)
                parts.append(f"{tw_ref}<={threshold},{value}")
        return "=IFS(" + ",".join(parts) + ")"

    cp_tiers = reference_layout["control_plane_tiers"]
    _data_row(ws, [
        "Control plane", f"={const_ref('controlPlaneNodesPerCluster')}",
        tier_ifs(cp_tiers, TIER_COL["cpu_cores"]), tier_ifs(cp_tiers, TIER_COL["memory_gb"]),
    ], row)
    row += 1

    infra_tiers = reference_layout["infra_tiers"]
    _data_row(ws, [
        "Infra", f"={plat_ref('infraNodesPerCluster')}",
        tier_ifs(infra_tiers, TIER_COL["cpu_cores"]), tier_ifs(infra_tiers, TIER_COL["memory_gb"]),
    ], row)
    row += 1

    _data_row(ws, ["CPU worker", f"=B{cpu_worker_nodes_row}", CPU_WORKER_VCPU, CPU_WORKER_RAM_GIB], row)
    row += 1

    for gpu_name, gpu_row in gpu_perf_layout["gpu_row_by_name"].items():
        _data_row(ws, [
            f"GPU worker ({gpu_name})", f"={_sref('GPU Performance', GPU_PERF_COL['nodes_high'], gpu_row)}", "—", "—",
        ], row, font=GREEN_FONT)
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="E. Storage").font = BOLD
    row += 1
    _header_row(ws, ["Item", "Value", "Unit", "Basis"], row)
    row += 1

    sized_models = wizard_state.get("sizedModels", []) or []
    weight_refs = [_sref("Models", MODEL_COL["weights_gb"], models_layout["row_by_id"][m.get("id")]) for m in sized_models]
    weights_sum_expr = "(" + "+".join(weight_refs) + ")" if weight_refs else "0"
    versions_ref = plat_ref("modelVersionsKept")
    internal_registry_ref = const_ref("internalImageRegistryMinStorageGiB")

    object_storage_formula = f"=ROUNDUP({internal_registry_ref}+{weights_sum_expr}*{versions_ref},0)"
    _data_row(ws, ["Object storage", object_storage_formula, "GiB", "Internal registry minimum + model weights × versions kept"], row)
    object_storage_row = row; row += 1

    connectivity_ref = _sref("Inputs", 2, inputs_layout["customer"]["connectivity"])
    mirror_term = f'IF({connectivity_ref}="disconnected",400+{weights_sum_expr}*{versions_ref},0)'
    workbench_term = f"{plat_ref('concurrentWorkbenches')}*{plat_ref('workbenchPvcSizeGb')}"
    vectordb_term = f"{plat_ref('vectorDbInstances')}*100"
    pp_vol_terms = []
    for pp in components_ref.get("perProjectInstances", []):
        key = pp.get("key")
        vol = pp.get("volumePerInstanceGiB")
        if key not in pp_rows or not vol:
            continue
        enabled_ref = _sref("Inputs", 2, pp_rows[key])
        pp_vol_terms.append(f"IF({enabled_ref},{vol}*{pp.get('instancesPerProject', 1)}*{plat_ref('numProjects')},0)")
    block_storage_formula = "=ROUNDUP(" + "+".join([mirror_term, workbench_term, vectordb_term] + pp_vol_terms) + ",0)"
    _data_row(ws, ["Block storage", block_storage_formula, "GiB",
                   "Mirror registry (if disconnected) + workbenches + vector DB + per-project volumes"], row)
    block_storage_row = row; row += 1

    largest_model_expr = f"MAX(0,{','.join(weight_refs)})" if weight_refs else "0"
    nvme_mult_ref = const_ref("localNvmeMultiplierOfLargestModelArtifact")
    nvme_formula = f"=ROUNDUP({largest_model_expr}*{nvme_mult_ref}*1,0)"
    _data_row(ws, ["GPU-node local NVMe", nvme_formula, "GB", "2× largest model artifact per GPU node"], row)
    local_nvme_row = row; row += 1

    _autosize(ws, {1: 46, 2: 18, 3: 16, 4: 42})
    return {
        "cpu_worker_nodes_row": cpu_worker_nodes_row,
        "total_vcpu_row": total_vcpu_row,
        "total_ram_row": total_ram_row,
        "overhead_subtotal_row": overhead_subtotal_row,
        "dynamic_subtotal_row": dynamic_subtotal_row,
        "object_storage_row": object_storage_row,
        "block_storage_row": block_storage_row,
        "local_nvme_row": local_nvme_row,
    }


def build_cluster_requirements_sheet(
    wb: Workbook, wizard_state: dict, inputs_layout: dict, reference_layout: dict,
    gpu_perf_layout: dict, arch_layout: dict, components_ref: dict,
) -> dict:
    ws = wb["Cluster Requirements"]
    _title_row(ws, "Minimum cluster requirements and component dependencies", span=5)

    row = 3
    ws.cell(row=row, column=1, value="A. Platform inputs").font = BOLD
    row += 1
    cust_rows = inputs_layout["customer"]
    plat_rows = inputs_layout["platform"]
    for label, ref_row_tuple in [
        ("OpenShift version", cust_rows["openshiftVersion"]),
        ("Target cluster type", cust_rows["target"]),
        ("Network connectivity", cust_rows["connectivity"]),
        ("Number of data science projects", plat_rows["numProjects"]),
        ("Concurrent workbenches", plat_rows["concurrentWorkbenches"]),
        ("Infra nodes per cluster", plat_rows["infraNodesPerCluster"]),
    ]:
        ws.cell(row=row, column=1, value=label).font = SUBHEADER_FONT
        cell = ws.cell(row=row, column=2, value=f"={_sref('Inputs', 2, ref_row_tuple)}")
        cell.font = GREEN_FONT
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="B. DataScienceCluster components").font = BOLD
    row += 1
    _header_row(ws, ["Component", "Enabled", "Status", "Database", "Prerequisites"], row)
    row += 1
    comp_rows = inputs_layout["components"]
    for c in components_ref.get("dscComponents", []):
        key = c.get("key")
        if key not in comp_rows:
            continue
        db = c.get("database")
        db_label = db.get("type") if isinstance(db, dict) else ""
        _data_row(ws, [
            c.get("label"), f"={_sref('Inputs', 2, comp_rows[key])}", c.get("status"), db_label,
            ", ".join(c.get("prerequisites", []) or []),
        ], row)
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="C. Node count summary").font = BOLD
    row += 1
    _header_row(ws, ["Scenario", "Total nodes"], row)
    row += 1

    cp_const_ref = _sref("Reference", 2, reference_layout["constants"]["controlPlaneNodesPerCluster"])
    infra_ref = _sref("Inputs", 2, inputs_layout["platform"]["infraNodesPerCluster"])
    cpu_worker_ref = _sref("Cluster Architecture", 2, arch_layout["cpu_worker_nodes_row"])
    gpu_first, gpu_last = gpu_perf_layout["table_first_row"], gpu_perf_layout["table_last_row"]

    scenario_total_rows: dict[str, int] = {}
    for scenario, col in [("low", GPU_PERF_COL["nodes_low"]), ("high", GPU_PERF_COL["nodes_high"]), ("stress", GPU_PERF_COL["nodes_stress"])]:
        gpu_sum = f"SUM({_sref('GPU Performance', col, gpu_first)}:{_sref('GPU Performance', col, gpu_last)})"
        formula = f"={cp_const_ref}+{infra_ref}+{cpu_worker_ref}+{gpu_sum}"
        _data_row(ws, [scenario.capitalize(), formula], row)
        scenario_total_rows[scenario] = row
        row += 1

    _autosize(ws, {1: 34, 2: 20, 3: 20, 4: 30, 5: 50})
    return {"scenario_total_rows": scenario_total_rows}


def build_sizing_summary_sheet(
    wb: Workbook, wizard_state: dict, inputs_layout: dict, reference_layout: dict,
    gpu_perf_layout: dict, arch_layout: dict, cluster_req_layout: dict,
    models_layout: dict, workload_layout: dict,
) -> None:
    ws = wb["Sizing Summary"]
    customer = wizard_state.get("customer", {}) or {}
    _title_row(ws, f"RHOAI sizing approximation — {customer.get('name') or 'Customer'}", span=5)
    ws["A2"] = ("Low: Low end of concurrent user range. High: High end of concurrent user range. "
                "Stress: Maximum concurrent users (see Workload Sizing sheet for the methodology).")
    ws["A2"].font = ITALIC_NOTE

    row = 4
    ws.cell(row=row, column=1, value="A. Headline numbers by scenario").font = BOLD
    row += 1
    _header_row(ws, ["Metric", "Low", "High", "Stress", "Unit"], row)
    row += 1

    gpu_first, gpu_last = gpu_perf_layout["table_first_row"], gpu_perf_layout["table_last_row"]
    total_gpus = {
        s: f"=SUM({_sref('GPU Performance', col, gpu_first)}:{_sref('GPU Performance', col, gpu_last)})"
        for s, col in [("low", GPU_PERF_COL["req_low"]), ("high", GPU_PERF_COL["req_high"]), ("stress", GPU_PERF_COL["req_stress"])]
    }
    _data_row(ws, ["Total GPUs required", total_gpus["low"], total_gpus["high"], total_gpus["stress"], "GPUs"], row)
    row += 1

    scenario_total_rows = cluster_req_layout["scenario_total_rows"]
    total_nodes_refs = {s: f"={_sref('Cluster Requirements', 2, scenario_total_rows[s])}" for s in ("low", "high", "stress")}
    _data_row(ws, ["Total cluster nodes", total_nodes_refs["low"], total_nodes_refs["high"], total_nodes_refs["stress"], "nodes"], row)
    row += 1

    cpu_worker_formula = f"={_sref('Cluster Architecture', 2, arch_layout['cpu_worker_nodes_row'])}"
    _data_row(ws, ["CPU worker nodes", cpu_worker_formula, cpu_worker_formula, cpu_worker_formula, "nodes"], row)
    row += 1

    cpu_worker_bare = _sref("Cluster Architecture", 2, arch_layout["cpu_worker_nodes_row"])
    sub_nodes = {}
    for scenario, col in [("low", GPU_PERF_COL["nodes_low"]), ("high", GPU_PERF_COL["nodes_high"]), ("stress", GPU_PERF_COL["nodes_stress"])]:
        gpu_sum = f"SUM({_sref('GPU Performance', col, gpu_first)}:{_sref('GPU Performance', col, gpu_last)})"
        sub_nodes[scenario] = f"={cpu_worker_bare}+{gpu_sum}"
    _data_row(ws, ["Red Hat AI Enterprise subscriptions", sub_nodes["low"], sub_nodes["high"], sub_nodes["stress"], "nodes"], row)
    row += 2

    ws.cell(row=row, column=1, value="B. Customer & deployment").font = BOLD
    row += 1
    cust_rows = inputs_layout["customer"]
    for label, key in [
        ("Customer", "name"), ("Project", "project"), ("Deployment type", "deploymentType"),
        ("OpenShift version", "openshiftVersion"), ("Connectivity", "connectivity"), ("Target", "target"),
        ("Planning horizon (years)", "growthHorizonYears"), ("Annual growth rate", "annualGrowthRate"),
    ]:
        ws.cell(row=row, column=1, value=label).font = SUBHEADER_FONT
        cell = ws.cell(row=row, column=2, value=f"={_sref('Inputs', 2, cust_rows[key])}")
        cell.font = GREEN_FONT
        row += 1
    row += 1

    ws.cell(row=row, column=1, value="C. Storage totals").font = BOLD
    row += 1
    for label, cell_row, unit in [
        ("Object storage", arch_layout["object_storage_row"], "GiB"),
        ("Block storage", arch_layout["block_storage_row"], "GiB"),
        ("GPU-node local NVMe", arch_layout["local_nvme_row"], "GB"),
    ]:
        ws.cell(row=row, column=1, value=label)
        cell = ws.cell(row=row, column=2, value=f"={_sref('Cluster Architecture', 2, cell_row)}")
        cell.font = GREEN_FONT
        ws.cell(row=row, column=3, value=unit)
        row += 1
    row += 1

    ws.cell(row=row, column=1, value="D. Checks before you quote").font = BOLD
    row += 1
    _header_row(ws, ["Status", "Check", "Detail"], row)
    row += 1

    # Use cases not mapped to any currently-sized model contribute zero demand — easy to
    # miss, and silently under-sizes the cluster. Which use cases are mapped is fixed by
    # the Inputs/Models data itself (not an editable toggle), so this is computed once at
    # generation time rather than as a live formula.
    sized_models_list = wizard_state.get("sizedModels", []) or []
    sized_model_ids = {m.get("id") for m in sized_models_list}
    use_cases_list = wizard_state.get("useCases", []) or []
    # Use cases explicitly marked "External model" (EXTERNAL_MODEL_SENTINEL) are an
    # intentional exclusion, not a mistake, so they're exempt from this warning.
    unmapped_use_cases = [
        uc for uc in use_cases_list
        if uc.get("sizedModelId") != EXTERNAL_MODEL_SENTINEL and uc.get("sizedModelId") not in sized_model_ids
    ]
    if unmapped_use_cases:
        names = ", ".join(uc.get("name") or "(unnamed)" for uc in unmapped_use_cases)
        _data_row(ws, [
            "WARN", "Use cases not mapped to a sized model",
            f"{len(unmapped_use_cases)} use case(s) are excluded from GPU sizing because they aren't mapped to a "
            f"model in Step 3: {names}. Map them to a sized model or they won't be counted.",
        ], row, fill=WARN_FILL)
        row += 1

    # "Target concurrency" (Step 2) sets how many requests ONE replica should serve at
    # once — it is NOT the total user count from Step 3. It becomes Models!maxConcurrentPerReplica,
    # the divisor in replicas = ceil(requestsInFlight / maxConcurrentPerReplica). Left at a low
    # default (e.g. 1) while Step 3 has real demand, it silently inflates the replica count —
    # this check is a live formula so it stays correct if Inputs sheet values change.
    for m in sized_models_list:
        mid = m.get("id")
        mapped = [uc for uc in use_cases_list if uc.get("sizedModelId") == mid]
        if not mapped or mid not in workload_layout["model_demand_row_by_id"]:
            continue
        demand_row = workload_layout["model_demand_row_by_id"][mid]
        mrow = models_layout["row_by_id"][mid]
        cap_ref = _sref("Models", MODEL_COL["max_concurrent_per_replica"], mrow)
        rep_high_ref = _sref("Workload Sizing", WORKLOAD_C_COL["rep_high"], demand_row)
        model_label = m.get("model") or "This model"
        status_formula = f'=IF(AND({cap_ref}<=2,{rep_high_ref}>=5),"WARN","OK")'
        detail_formula = (
            f'=IF(AND({cap_ref}<=2,{rep_high_ref}>=5),'
            f'"Captured per-replica concurrency is only "&{cap_ref}&" (from Step 2 Target concurrency), driving "&'
            f'{rep_high_ref}&" replicas at High demand. If one replica can realistically serve more than "&{cap_ref}&'
            f'" request(s) at once, raise Target concurrency in Step 2 to that batch size and re-add the model.",'
            f'"Replica count looks consistent with its captured per-replica concurrency.")'
        )
        _data_row(ws, [status_formula, f"{model_label}: replica count vs. captured per-replica concurrency", detail_formula], row)
        row += 1

    const_rows = reference_layout["constants"]
    for gpu_name, gpu_row in gpu_perf_layout["gpu_row_by_name"].items():
        mem_cell = _sref("GPU Performance", GPU_PERF_COL["memory_gb"], gpu_row)
        gpn_cell = _sref("GPU Performance", GPU_PERF_COL["gpus_per_node"], gpu_row)
        mult_ref = _sref("Reference", 2, const_rows["hostRamMultiplierOfTotalGpuMemory"])
        detail_formula = (
            f'="Plan for >= "&({mult_ref}*{mem_cell}*{gpn_cell})&" GiB host RAM per {gpu_name} node ("&'
            f'{gpn_cell}&" GPUs x "&{mem_cell}&" GB x "&{mult_ref}&")."'
        )
        _data_row(ws, ["OK", f"{gpu_name} host RAM rule (>= host RAM multiplier × total GPU memory per node)", detail_formula], row, fill=OK_FILL)
        row += 1

        floor_ref = _sref("Reference", 2, const_rows["physicalCoresPerGpuCertifiedFloor"])
        ra_ref = _sref("Reference", 2, const_rows["physicalCoresPerGpuEnterpriseRA"])
        detail2 = f'="Plan for >= "&{floor_ref}&" physical cores per GPU (NVIDIA-Certified floor), >= "&{ra_ref}&" recommended."'
        _data_row(ws, ["OK", f"{gpu_name} physical cores rule", detail2], row, fill=OK_FILL)
        row += 1

    cpu_worker_bare2 = _sref("Cluster Architecture", 2, arch_layout["cpu_worker_nodes_row"])
    min_workers_ref = _sref("Reference", 2, const_rows["rhoaiInstallMinWorkerNodes"])
    min_vcpu_ref = _sref("Reference", 2, const_rows["rhoaiInstallMinVcpuPerWorker"])
    min_ram_ref = _sref("Reference", 2, const_rows["rhoaiInstallMinRamPerWorkerGiB"])
    status1 = f'=IF({cpu_worker_bare2}>={min_workers_ref},"OK","WARN")'
    detail1 = (
        f'={cpu_worker_bare2}&" CPU worker node(s) planned; RHOAI requires >= "&{min_workers_ref}&'
        f'" workers at >= "&{min_vcpu_ref}&" vCPU / "&{min_ram_ref}&" GiB each."'
    )
    _data_row(ws, [status1, "CPU worker node minimum (RHOAI install requirement)", detail1], row)
    row += 1

    status2 = f'=IF({cpu_worker_bare2}>1,"OK","WARN")'
    detail2b = (
        f'=IF({cpu_worker_bare2}>1,({cpu_worker_bare2}-1)&" node(s) of capacity still covers CPU demand if sized with headroom.",'
        f'"Only one CPU worker node planned — no failure tolerance. Add a second node for production.")'
    )
    _data_row(ws, [status2, "N-1 capacity (one CPU worker node can fail)", detail2b], row)
    row += 1

    _autosize(ws, {1: 38, 2: 44, 3: 60, 4: 14, 5: 10})


def build_subscriptions_sheet(wb: Workbook, wizard_state: dict, arch_layout: dict, gpu_perf_layout: dict) -> None:
    ws = wb["Red Hat Subscriptions"]
    customer = wizard_state.get("customer", {}) or {}
    _title_row(ws, f"{customer.get('name') or 'Customer'} — Red Hat subscription bill of materials", span=6)
    ws["A2"] = ("Red Hat AI Enterprise is counted per node, physical or virtual, for GPU and CPU worker nodes "
                "alike, regardless of the number of GPUs in a node.")
    ws["A2"].font = ITALIC_NOTE
    ws["A2"].alignment = Alignment(wrap_text=True)
    ws.merge_cells("A2:F2")

    row = 4
    _header_row(ws, ["SKU", "Description", "Qty (Low)", "Qty (High)", "Qty (Stress)", "Remarks"], row)
    row += 1

    cpu_worker_ref = _sref("Cluster Architecture", 2, arch_layout["cpu_worker_nodes_row"])
    gpu_first, gpu_last = gpu_perf_layout["table_first_row"], gpu_perf_layout["table_last_row"]
    qty = {}
    for scenario, col in [("low", GPU_PERF_COL["nodes_low"]), ("high", GPU_PERF_COL["nodes_high"]), ("stress", GPU_PERF_COL["nodes_stress"])]:
        gpu_sum = f"SUM({_sref('GPU Performance', col, gpu_first)}:{_sref('GPU Performance', col, gpu_last)})"
        qty[scenario] = f"={cpu_worker_ref}+{gpu_sum}"

    _data_row(ws, [
        "MCT4990", "Red Hat AI Enterprise, Premium (1 Physical or Virtual Node)",
        qty["low"], qty["high"], qty["stress"],
        "Counts GPU worker nodes + CPU worker nodes across all enabled environments.",
    ], row)
    _autosize(ws, {1: 14, 2: 46, 3: 12, 4: 12, 5: 12, 6: 50})


def build_hardware_bom_sheet(
    wb: Workbook, wizard_state: dict, gpu_perf_layout: dict, arch_layout: dict,
    inputs_layout: dict, reference_layout: dict,
) -> None:
    ws = wb["Hardware BOM"]
    customer = wizard_state.get("customer", {}) or {}
    _title_row(ws, f"{customer.get('name') or 'Customer'} — hardware bill of materials", span=6)
    row = 3
    _header_row(ws, ["Node type", "GPU", "GPUs/node", "Nodes (Low)", "Nodes (High)", "Nodes (Stress)"], row)
    row += 1
    for gpu_name, gpu_row in gpu_perf_layout["gpu_row_by_name"].items():
        slug = f"gpu-{(gpu_name or '').lower().replace(' ', '-')}"
        _data_row(ws, [
            slug, f"={_sref('GPU Performance', GPU_PERF_COL['gpu'], gpu_row)}",
            f"={_sref('GPU Performance', GPU_PERF_COL['gpus_per_node'], gpu_row)}",
            f"={_sref('GPU Performance', GPU_PERF_COL['nodes_low'], gpu_row)}",
            f"={_sref('GPU Performance', GPU_PERF_COL['nodes_high'], gpu_row)}",
            f"={_sref('GPU Performance', GPU_PERF_COL['nodes_stress'], gpu_row)}",
        ], row, font=GREEN_FONT)
        row += 1

    cpu_worker_ref = f"={_sref('Cluster Architecture', 2, arch_layout['cpu_worker_nodes_row'])}"
    _data_row(ws, ["cpu-worker", "—", "—", cpu_worker_ref, cpu_worker_ref, cpu_worker_ref], row)
    row += 1
    cp_const_ref = f"={_sref('Reference', 2, reference_layout['constants']['controlPlaneNodesPerCluster'])}"
    _data_row(ws, ["control-plane", "—", "—", cp_const_ref, cp_const_ref, cp_const_ref], row)
    row += 1
    infra_ref = f"={_sref('Inputs', 2, inputs_layout['platform']['infraNodesPerCluster'])}"
    _data_row(ws, ["infra", "—", "—", infra_ref, infra_ref, infra_ref], row)

    _autosize(ws, {1: 18, 2: 16, 3: 12, 4: 12, 5: 12, 6: 12})


def build_backup_dr_sheet(wb: Workbook, wizard_state: dict, inputs_layout: dict) -> None:
    ws = wb["Backup and DR"]
    customer = wizard_state.get("customer", {}) or {}
    _title_row(ws, f"{customer.get('name') or 'Customer'} — backup and disaster recovery", span=5)
    row = 3
    ws.cell(row=row, column=1, value="Environments configured").font = BOLD
    row += 1
    _header_row(ws, ["Environment", "Included"], row)
    row += 1
    env_rows = inputs_layout["env"]
    for label, key in [("Production", "production"), ("Disaster recovery", "disasterRecovery"),
                        ("Test / UAT", "test"), ("Development", "development")]:
        env_ref = _sref("Inputs", 2, env_rows[key])
        _data_row(ws, [label, f'=IF({env_ref},"Yes","No")'], row)
        row += 1

    row += 1
    ws.cell(row=row, column=1, value="Recommended protection mechanisms").font = BOLD
    row += 1
    for mechanism in [
        "Model artifacts: object storage geo-replication (asynchronous) to the DR site.",
        "Model Registry, MLflow and pipelines metadata: PostgreSQL streaming replication to DR.",
        "Workbench PVs and shared datasets: storage-level snapshot/mirroring on a 5-minute schedule.",
        "Cluster and RHOAI configuration: GitOps (Argo CD) + OADP backup of RHOAI namespaces.",
        "etcd: scheduled snapshot to object storage.",
    ]:
        ws.cell(row=row, column=1, value=f"- {mechanism}")
        row += 1

    _autosize(ws, {1: 90, 2: 14})


def build_model_catalog_sheet(wb: Workbook, models_layout: dict, sized_models: list) -> None:
    ws = wb["Model Catalog"]
    _title_row(ws, "Selected models (sized via ConfigIQ) — see Models sheet for the literal captured values", span=10)
    row = 3
    headers = ["Model", "Params (B)", "Active params (B)", "Precision", "GPU", "GPUs/replica",
               "Replicas (ConfigIQ default)", "Weights (GB)", "KV cache/1K tok (GB)", "Captured at"]
    _header_row(ws, headers, row)
    row += 1
    for m in sized_models:
        mrow = models_layout["row_by_id"][m.get("id")]
        _data_row(ws, [
            f"={_sref('Models', MODEL_COL['model'], mrow)}", f"={_sref('Models', MODEL_COL['params_b'], mrow)}",
            f"={_sref('Models', MODEL_COL['active_params_b'], mrow)}", f"={_sref('Models', MODEL_COL['precision'], mrow)}",
            f"={_sref('Models', MODEL_COL['gpu'], mrow)}", f"={_sref('Models', MODEL_COL['gpus_per_replica'], mrow)}",
            f"={_sref('Models', MODEL_COL['replicas_needed'], mrow)}", f"={_sref('Models', MODEL_COL['weights_gb'], mrow)}",
            f"={_sref('Models', MODEL_COL['kv_cache_gb'], mrow)}", f"={_sref('Models', MODEL_COL['captured_at'], mrow)}",
        ], row, font=GREEN_FONT)
        row += 1

    _autosize(ws, {i: 18 for i in range(1, 11)} | {1: 36, 10: 24})


# ─── Entry point ────────────────────────────────────────────────────────────

FULL_SHEET_ORDER = [
    "Disclaimer", "Inputs", "Reference", "Models", "Sizing Summary", "Workload Sizing",
    "GPU Performance", "Cluster Architecture", "Cluster Requirements",
    "Red Hat Subscriptions", "Hardware BOM", "Backup and DR", "Model Catalog",
]
LLM_ONLY_SHEET_ORDER = ["Disclaimer", "Models", "Model Catalog", "GPU Performance"]


def generate_workbook(payload: dict) -> bytes:
    """payload shape: { wizardState: {...}, mode: 'full' | 'llm-only' } as sent by
    the Next.js app's /api/generate-excel route. Reference data (components, GPU
    specs, sizing constants) is loaded directly from data/ alongside this service
    so it stays in sync with the single source of truth used by the wizard.

    This is a *formula-driven* workbook: literal values live only on Inputs,
    Reference and Models; every other sheet computes with real Excel formulas
    referencing those cells, so an SE can audit or tweak an assumption in Excel
    and watch everything downstream recalculate."""

    wizard_state = payload.get("wizardState", {}) or {}
    mode = payload.get("mode") or ("llm-only" if not wizard_state.get("platform") else "full")

    components_ref = _load_data_file("components.json")
    reference_constants = _load_data_file("reference-constants.json")

    customer = wizard_state.get("customer", {}) or {}
    sized_models = wizard_state.get("sizedModels", []) or []

    wb = Workbook()
    default_sheet = wb.active
    wb.remove(default_sheet)

    if mode == "llm-only":
        for name in LLM_ONLY_SHEET_ORDER:
            wb.create_sheet(title=name)

        build_disclaimer_sheet(wb, customer.get("name", ""), mode)
        models_layout = build_models_sheet(wb, sized_models)
        build_model_catalog_sheet(wb, models_layout, sized_models)
        build_gpu_performance_sheet(
            wb, sized_models, hardware=[], reference_layout=None, workload_layout=None,
            models_layout=models_layout, llm_only=True,
        )
    else:
        for name in FULL_SHEET_ORDER:
            wb.create_sheet(title=name)

        hardware = (customer.get("existingHardware", []) or []) + (customer.get("plannedHardware", []) or [])

        build_disclaimer_sheet(wb, customer.get("name", ""), mode)
        inputs_layout = build_inputs_sheet(wb, wizard_state, components_ref)
        reference_layout = build_reference_sheet(wb, reference_constants, components_ref)
        models_layout = build_models_sheet(wb, sized_models)

        workload_layout = build_workload_sizing_sheet(wb, wizard_state, inputs_layout, models_layout)
        gpu_perf_layout = build_gpu_performance_sheet(
            wb, sized_models, hardware, reference_layout, workload_layout, models_layout, llm_only=False,
        )
        arch_layout = build_cluster_architecture_sheet(
            wb, wizard_state, inputs_layout, reference_layout, gpu_perf_layout, models_layout,
            components_ref, len(sized_models),
        )
        cluster_req_layout = build_cluster_requirements_sheet(
            wb, wizard_state, inputs_layout, reference_layout, gpu_perf_layout, arch_layout, components_ref,
        )
        build_sizing_summary_sheet(
            wb, wizard_state, inputs_layout, reference_layout, gpu_perf_layout, arch_layout,
            cluster_req_layout, models_layout, workload_layout,
        )
        build_subscriptions_sheet(wb, wizard_state, arch_layout, gpu_perf_layout)
        build_hardware_bom_sheet(wb, wizard_state, gpu_perf_layout, arch_layout, inputs_layout, reference_layout)
        build_backup_dr_sheet(wb, wizard_state, inputs_layout)
        build_model_catalog_sheet(wb, models_layout, sized_models)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
