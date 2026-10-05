"""Quick manual smoke test for generator.generate_workbook — not a pytest suite,
just a script to validate the output opens cleanly with openpyxl and that the
formula-driven sheets emit real Excel formula strings (not precomputed numbers).

Run: .venv/bin/python test_generator_smoke.py
"""
from generator import generate_workbook, EXTERNAL_MODEL_SENTINEL
from openpyxl import load_workbook
from io import BytesIO

# ─── Full-mode payload ───────────────────────────────────────────────────────
# Note the simplified payload shape: { wizardState, mode } — the Excel service
# computes everything itself via formulas now, so no precomputed sizingResult
# is sent from the Next.js app.

full_payload = {
    "mode": "full",
    "wizardState": {
        "customer": {
            "name": "Acme Financial Services",
            "project": "Internal Audit AI",
            "deploymentType": "production",
            "openshiftVersion": "4.20",
            "connectivity": "connected_proxy",
            "target": "on_prem_bare_metal",
            "existingHardware": [{"id": "e1", "gpu": "H200 NVL", "count": 8, "formFactor": "PCIe NVL2", "servers": 2}],
            "plannedHardware": [{"id": "p1", "gpu": "B200", "count": 24, "formFactor": "HGX SXM 8-GPU", "servers": 3}],
            "growthHorizonYears": 3,
            "annualGrowthRate": 0.25,
            "environments": {"production": True, "disasterRecovery": False, "test": True, "development": True},
        },
        "sizedModels": [
            {
                "id": "sm1", "model": "RedHatAI/Qwen3.6-35B-A3B-FP8", "paramsB": 35, "activeParamsB": 3,
                "precision": "FP8", "gpu": "B200", "gpusPerReplica": 1, "tensorParallelSize": 1,
                "replicasNeeded": 2, "gpusNeeded": 2, "weightsGb": 43.1, "kvCacheGb": 10.2,
                "maxConcurrentPerReplica": 32, "ttftEstimateMs": 330, "tpotMs": 9.5,
                "tokensPerSecond": 105.6, "tokensPerSecondPerUser": 50, "mode": "agg",
                "source": "recommend", "capturedAt": "2026-10-02T00:00:00Z",
            },
            # maxConcurrentPerReplica left at 1 (Step 2 "Target concurrency" default) while
            # mapped to high demand — should trigger the low-concurrency-vs-demand check.
            {
                "id": "sm2", "model": "RedHatAI/LowConcurrencyModel", "paramsB": 7, "activeParamsB": 7,
                "precision": "FP8", "gpu": "B200", "gpusPerReplica": 1, "tensorParallelSize": 1,
                "replicasNeeded": 1, "gpusNeeded": 1, "weightsGb": 8.0, "kvCacheGb": 2.0,
                "maxConcurrentPerReplica": 1, "ttftEstimateMs": 90, "tpotMs": 10,
                "tokensPerSecond": 60, "tokensPerSecondPerUser": 60, "mode": "agg",
                "source": "recommend", "capturedAt": "2026-10-02T00:00:00Z",
            },
        ],
        "useCases": [
            {
                "id": "uc1", "name": "Coding assistant", "sizedModelId": "sm1",
                "concurrentUsersLow": 40, "concurrentUsersHigh": 50, "shareInFlight": 0.5,
                "inputTokens": 200000, "outputTokens": 1000, "prefixCacheHitRate": 0.9,
                "ttftTargetS": 10, "tokensPerSecondTarget": 50, "screenedByGuard": True,
                "guardCallsPerRequest": 2, "notes": "Agentic coding, repo context reused.",
            },
            {
                "id": "uc2", "name": "High-demand chatbot", "sizedModelId": "sm2",
                "concurrentUsersLow": 60, "concurrentUsersHigh": 80, "shareInFlight": 0.3,
                "inputTokens": 8000, "outputTokens": 400, "prefixCacheHitRate": 0.2,
                "ttftTargetS": 2.5, "tokensPerSecondTarget": 90, "screenedByGuard": False,
                "guardCallsPerRequest": 2, "notes": "Deliberately low Target concurrency to exercise the check.",
            },
            {
                "id": "uc3", "name": "Orphan use case", "sizedModelId": None,
                "concurrentUsersLow": 10, "concurrentUsersHigh": 20, "shareInFlight": 0.3,
                "inputTokens": 4000, "outputTokens": 500, "prefixCacheHitRate": 0.2,
                "ttftTargetS": 3, "tokensPerSecondTarget": 50, "screenedByGuard": False,
                "guardCallsPerRequest": 2, "notes": "Not mapped to any sized model.",
            },
            # Intentionally external — must NOT trigger the "unmapped" warning.
            {
                "id": "uc4", "name": "Third-party translation API", "sizedModelId": EXTERNAL_MODEL_SENTINEL,
                "concurrentUsersLow": 5, "concurrentUsersHigh": 10, "shareInFlight": 0.3,
                "inputTokens": 1000, "outputTokens": 200, "prefixCacheHitRate": 0.0,
                "ttftTargetS": 2, "tokensPerSecondTarget": 30, "screenedByGuard": False,
                "guardCallsPerRequest": 1, "notes": "Served by an external vendor API, not sized here.",
            },
        ],
        "platform": {
            "enabledComponents": {
                "dashboard": True, "workbenches": True, "aipipelines": True, "kserve": True,
                "kueue": True, "modelregistry": True, "trustyai": True, "mlflowoperator": True,
                "maas": False, "ray": False, "trainer": False, "trainingoperator": False,
                "feastoperator": False, "ogx": False, "mcplifecycleoperator": False,
            },
            "enabledPerProjectInstances": {"pipeline_server": True, "mlflow_server": True},
            "numProjects": 5, "concurrentWorkbenches": 5, "workbenchPvcSizeGb": 50,
            "concurrentTrainingJobs": 0, "concurrentEvalJobs": 1, "vectorDbInstances": 1,
            "concurrentPipelineRuns": 2, "infraNodesPerCluster": 3, "maxCpuWorkerUtilization": 0.8,
            "modelVersionsKept": 2, "prometheusRetentionDays": 15, "lokiRetentionDays": 90,
        },
    },
}

xlsx_bytes = generate_workbook(full_payload)
print(f"Full mode: generated {len(xlsx_bytes)} bytes")

wb = load_workbook(BytesIO(xlsx_bytes))
print("Sheets:", wb.sheetnames)
assert wb.sheetnames == [
    "Disclaimer", "Inputs", "Reference", "Models", "Sizing Summary", "Workload Sizing",
    "GPU Performance", "Cluster Architecture", "Cluster Requirements",
    "Red Hat Subscriptions", "Hardware BOM", "Backup and DR", "Model Catalog",
], "Sheet list mismatch"

# ─── Formula-string assertions ───────────────────────────────────────────────
# openpyxl can't evaluate formulas, so these assert the *formula text* of key
# cells — proving the workbook is formula-driven, not a dump of Python numbers,
# and that the Stress scenario's methodology (no share-in-flight multiplication)
# is visibly different from Low/High in the cell contents themselves.

inputs_ws = wb["Inputs"]
# Use case row: name, served-by, usersLow, usersHigh, shareInFlight are literal inputs.
uc_row = next(r for r in range(1, inputs_ws.max_row + 1) if inputs_ws.cell(row=r, column=1).value == "Coding assistant")
assert inputs_ws.cell(row=uc_row, column=3).value == 40, "Users-low literal mismatch on Inputs sheet"
assert inputs_ws.cell(row=uc_row, column=4).value == 50, "Users-high literal mismatch on Inputs sheet"
assert inputs_ws.cell(row=uc_row, column=5).value == 0.5, "Share-in-flight literal mismatch on Inputs sheet"

workload_ws = wb["Workload Sizing"]
# Section C ("Load per model deployment") — find the row whose column A is a
# formula referencing the Models sheet (the one model-demand row in this fixture).
demand_row = next(
    r for r in range(1, workload_ws.max_row + 1)
    if isinstance(workload_ws.cell(row=r, column=5).value, str)
    and workload_ws.cell(row=r, column=5).value.startswith("=MAX(")
)
rif_low_formula = workload_ws.cell(row=demand_row, column=2).value
rif_high_formula = workload_ws.cell(row=demand_row, column=3).value
rif_stress_formula = workload_ws.cell(row=demand_row, column=4).value

assert rif_low_formula.startswith("="), "Requests-in-flight (Low) must be a formula, not a number"
assert "*" in rif_low_formula, f"Low formula should multiply by share-in-flight, got: {rif_low_formula}"
assert "*" in rif_high_formula, f"High formula should multiply by share-in-flight, got: {rif_high_formula}"
assert "*" not in rif_stress_formula, (
    f"Stress formula must NOT multiply by share-in-flight (every High user is in flight at once), "
    f"got: {rif_stress_formula}"
)
assert rif_high_formula != rif_stress_formula, "High and Stress requests-in-flight formulas must differ"
print(f"Stress methodology verified: High={rif_high_formula!r} vs Stress={rif_stress_formula!r}")

gpu_perf_ws = wb["GPU Performance"]
gpu_row = next(r for r in range(1, gpu_perf_ws.max_row + 1) if gpu_perf_ws.cell(row=r, column=1).value == "B200")
nodes_high_formula = gpu_perf_ws.cell(row=gpu_row, column=8).value
assert isinstance(nodes_high_formula, str) and nodes_high_formula.startswith("="), "Nodes-required must be a formula"
assert "ROUNDUP" in nodes_high_formula, f"Nodes-required should use ROUNDUP, got: {nodes_high_formula}"

arch_ws = wb["Cluster Architecture"]
cpu_worker_row = next(
    r for r in range(1, arch_ws.max_row + 1)
    if arch_ws.cell(row=r, column=1).value == "CPU worker nodes (computed)"
)
cpu_worker_formula = arch_ws.cell(row=cpu_worker_row, column=2).value
assert cpu_worker_formula.startswith("=MAX("), f"CPU worker nodes should be a MAX() formula, got: {cpu_worker_formula}"
assert "Reference" in cpu_worker_formula, "CPU worker nodes formula should reference the Reference sheet minimum"

reference_ws = wb["Reference"]
assert reference_ws.cell(row=5, column=1).value == "B200" or any(
    reference_ws.cell(row=r, column=1).value == "B200" for r in range(1, reference_ws.max_row + 1)
), "Reference sheet should contain literal GPU specification rows"

# ─── Rounding ─────────────────────────────────────────────────────────────────
# Aggregate vCPU/RAM/storage cells must be wrapped in ROUND/ROUNDUP so SEs see a sane
# number of decimal places instead of raw floating-point accumulation (e.g. 207.8675).

object_storage_row = next(r for r in range(1, arch_ws.max_row + 1) if arch_ws.cell(row=r, column=1).value == "Object storage")
object_storage_formula = arch_ws.cell(row=object_storage_row, column=2).value
assert "ROUNDUP" in object_storage_formula, f"Object storage should round up to whole GiB, got: {object_storage_formula}"

overhead_subtotal_row = next(
    r for r in range(1, arch_ws.max_row + 1)
    if arch_ws.cell(row=r, column=1).value == "Subtotal — platform overhead line items"
)
overhead_vcpu_formula = arch_ws.cell(row=overhead_subtotal_row, column=3).value
assert overhead_vcpu_formula.startswith("=ROUND("), f"Overhead subtotal vCPU should be ROUND()'d, got: {overhead_vcpu_formula}"

total_vcpu_row = next(r for r in range(1, arch_ws.max_row + 1) if arch_ws.cell(row=r, column=1).value == "CPU worker vCPU demand")
total_vcpu_formula = arch_ws.cell(row=total_vcpu_row, column=2).value
assert total_vcpu_formula.startswith("=ROUND("), f"Total CPU worker vCPU demand should be ROUND()'d, got: {total_vcpu_formula}"
print("Rounding assertions passed.")

# ─── New checks: unmapped use cases + low concurrency vs. demand ─────────────

sizing_summary_ws = wb["Sizing Summary"]
check_rows = [
    (r, sizing_summary_ws.cell(row=r, column=2).value)
    for r in range(1, sizing_summary_ws.max_row + 1)
    if isinstance(sizing_summary_ws.cell(row=r, column=2).value, str)
]

unmapped_row = next((r for r, label in check_rows if label == "Use cases not mapped to a sized model"), None)
assert unmapped_row is not None, "Expected an 'unmapped use case' check row in Sizing Summary"
assert sizing_summary_ws.cell(row=unmapped_row, column=1).value == "WARN"
unmapped_detail = sizing_summary_ws.cell(row=unmapped_row, column=3).value
assert "Orphan use case" in unmapped_detail, f"Unmapped-use-case detail should name it, got: {unmapped_detail}"
assert "Third-party translation API" not in unmapped_detail, (
    f"Use case marked EXTERNAL_MODEL_SENTINEL must NOT be flagged as unmapped, got: {unmapped_detail}"
)

inputs_ws = wb["Inputs"]
external_uc_row = next(r for r in range(1, inputs_ws.max_row + 1) if inputs_ws.cell(row=r, column=1).value == "Third-party translation API")
assert inputs_ws.cell(row=external_uc_row, column=2).value == "External (not sized in wizard)", (
    "External use case should resolve to a clear 'External (not sized in wizard)' label on the Inputs sheet"
)
print("External-model-sentinel assertions passed.")

low_concurrency_row = next(
    (r for r, label in check_rows if "replica count vs. captured per-replica concurrency" in label), None,
)
assert low_concurrency_row is not None, "Expected a low-concurrency-vs-demand check row in Sizing Summary"
low_concurrency_status_formula = sizing_summary_ws.cell(row=low_concurrency_row, column=1).value
assert isinstance(low_concurrency_status_formula, str) and low_concurrency_status_formula.startswith("=IF("), (
    f"Low-concurrency check status should be a live formula, got: {low_concurrency_status_formula}"
)
assert "Target concurrency" in sizing_summary_ws.cell(row=low_concurrency_row, column=3).value
print("New-check assertions passed (unmapped use cases, low concurrency vs. demand).")

print("Formula-string assertions passed.")

# ─── LLM-only mode ────────────────────────────────────────────────────────────

llm_only_payload = {
    "mode": "llm-only",
    "wizardState": {
        "customer": {"name": "Acme Financial Services"},
        "sizedModels": full_payload["wizardState"]["sizedModels"],
    },
}
llm_bytes = generate_workbook(llm_only_payload)
print(f"LLM-only mode: generated {len(llm_bytes)} bytes")
llm_wb = load_workbook(BytesIO(llm_bytes))
print("LLM-only sheets:", llm_wb.sheetnames)
assert llm_wb.sheetnames == ["Disclaimer", "Models", "Model Catalog", "GPU Performance"], "LLM-only sheet list mismatch"

llm_gpu_ws = llm_wb["GPU Performance"]
llm_gpu_row = next(r for r in range(1, llm_gpu_ws.max_row + 1) if llm_gpu_ws.cell(row=r, column=1).value == "B200")
llm_req_formula = llm_gpu_ws.cell(row=llm_gpu_row, column=4).value
assert isinstance(llm_req_formula, str) and llm_req_formula.startswith("='Models'!"), (
    f"LLM-only GPU Performance should pull straight from Models sheet, got: {llm_req_formula}"
)

print("Smoke test passed.")
