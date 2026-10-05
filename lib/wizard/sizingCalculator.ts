// Platform sizing calculator — ports the node/storage/subscription formulas from
// the reference RHOAI sizing workbooks into TypeScript, driven by ConfigIQ
// per-model results (Step 2) + use-case demand
// (Step 3) + platform configuration (Step 4).

import { EXTERNAL_MODEL_SENTINEL, type CustomerProfile, type SizedModel, type UseCase, type PlatformConfig, type GpuGroup } from './types';
import referenceConstants from '@/data/reference-constants.json';
import { DSC_COMPONENTS, PER_PROJECT_INSTANCES, PLATFORM_OVERHEAD_LINE_ITEMS, type PlatformOverheadLineItem } from './componentData';

export type Scenario = 'low' | 'high' | 'stress';
export const SCENARIOS: Scenario[] = ['low', 'high', 'stress'];

export interface ModelDemand {
  sizedModelId: string;
  model: string;
  gpu: string;
  gpusPerReplica: number;
  replicas: Record<Scenario, number>;
  gpus: Record<Scenario, number>;
  requestsInFlight: Record<Scenario, number>;
}

export interface GpuTypeTotals {
  gpu: string;
  gpusRequired: Record<Scenario, number>;
  gpusPerNode: number;
  nodesRequired: Record<Scenario, number>;
  gpuMemoryGB: number;
}

export interface NodeTier { role: string; count: number; vcpuPerNode: number; ramGBPerNode: number; }

export interface StorageTotals {
  objectStorageGiB: number;
  blockStorageGiB: number;
  localNvmeGB: number;
}

export interface Checks {
  label: string;
  status: 'OK' | 'WARN' | 'FAIL';
  detail: string;
}

export interface SizingResult {
  modelDemand: ModelDemand[];
  gpuTypeTotals: GpuTypeTotals[];
  nodeTiers: NodeTier[];
  totalNodes: Record<Scenario, number>;
  cpuWorkerVcpuDemand: number;
  cpuWorkerRamGiBDemand: number;
  cpuWorkerNodes: number;
  /** Itemized non-GPU RHOAI platform overhead (Cluster Architecture Table D equivalent) —
   * the gated line items that sum into cpuWorkerVcpuDemand/cpuWorkerRamGiBDemand below. */
  platformOverheadLineItems: Array<{ label: string; vcpu: number; ramGiB: number }>;
  storage: StorageTotals;
  redHatSubscriptionNodes: Record<Scenario, number>;
  checks: Checks[];
}

const CPU_WORKER_VCPU = 16;
const CPU_WORKER_RAM_GIB = 64;

/** Loose GPU name match: hardware inventory often uses short codes ("B300", "H200 NVL")
 * while ConfigIQ returns full descriptive names ("NVIDIA B300 SXM6 AC"). An exact string
 * match would silently ignore a customer's hardware inventory (and its "servers" field)
 * whenever the two naming conventions differ, which is the common case. */
function gpuNamesLooselyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const la = a.trim().toLowerCase();
  const lb = b.trim().toLowerCase();
  if (la === lb) return true;
  const [shorter, longer] = la.length <= lb.length ? [la, lb] : [lb, la];
  const firstToken = shorter.split(' ')[0];
  return firstToken.length > 1 && longer.includes(firstToken);
}

function gpusPerNodeFor(gpuName: string, hardware: GpuGroup[]): number {
  const match = hardware.find(h => gpuNamesLooselyMatch(h.gpu, gpuName) && h.servers && h.servers > 0);
  if (match && match.servers) return Math.max(1, Math.round(match.count / match.servers));
  const lower = gpuName.toLowerCase();
  if (lower.includes('nvl') || lower.includes('pcie')) return 4;
  return 8;
}

function gpuSpec(gpuName: string) {
  return referenceConstants.gpuSpecifications.find(g => g.gpu === gpuName)
    ?? referenceConstants.gpuSpecifications.find(g => gpuName.toLowerCase().includes(g.gpu.toLowerCase().split(' ')[0]));
}

/** Requests-in-flight for a use case at a given scenario, per the reference method:
 * Low/High use the configured concurrent users x share in flight; Stress uses
 * every (High) concurrent user in flight at once. */
function inFlightForScenario(uc: UseCase, scenario: Scenario): number {
  if (scenario === 'low') return uc.concurrentUsersLow * uc.shareInFlight;
  if (scenario === 'high') return uc.concurrentUsersHigh * uc.shareInFlight;
  return uc.concurrentUsersHigh; // stress: everyone in flight
}

export function calculateModelDemand(sizedModels: SizedModel[], useCases: UseCase[]): ModelDemand[] {
  return sizedModels.map(m => {
    const mappedUseCases = useCases.filter(u => u.sizedModelId === m.id);
    const concurrencyPerReplica = m.maxConcurrentPerReplica ?? 1;

    const requestsInFlight: Record<Scenario, number> = { low: 0, high: 0, stress: 0 };
    const replicas: Record<Scenario, number> = { low: m.replicasNeeded, high: m.replicasNeeded, stress: m.replicasNeeded };
    const gpus: Record<Scenario, number> = { low: m.gpusNeeded, high: m.gpusNeeded, stress: m.gpusNeeded };

    if (mappedUseCases.length > 0) {
      for (const scenario of SCENARIOS) {
        const totalInFlight = mappedUseCases.reduce((sum, uc) => sum + inFlightForScenario(uc, scenario), 0);
        requestsInFlight[scenario] = totalInFlight;
        const neededReplicas = Math.max(m.replicasNeeded, Math.ceil(totalInFlight / Math.max(1, concurrencyPerReplica)));
        replicas[scenario] = neededReplicas;
        gpus[scenario] = neededReplicas * m.gpusPerReplica;
      }
    }

    return {
      sizedModelId: m.id, model: m.model, gpu: m.gpu, gpusPerReplica: m.gpusPerReplica,
      replicas, gpus, requestsInFlight,
    };
  });
}

export function calculateGpuTypeTotals(modelDemand: ModelDemand[], hardware: GpuGroup[]): GpuTypeTotals[] {
  const byGpu = new Map<string, GpuTypeTotals>();
  for (const md of modelDemand) {
    const spec = gpuSpec(md.gpu);
    const entry = byGpu.get(md.gpu) ?? {
      gpu: md.gpu,
      gpusRequired: { low: 0, high: 0, stress: 0 },
      gpusPerNode: gpusPerNodeFor(md.gpu, hardware),
      nodesRequired: { low: 0, high: 0, stress: 0 },
      gpuMemoryGB: spec?.memoryGB ?? 0,
    };
    for (const s of SCENARIOS) entry.gpusRequired[s] += md.gpus[s];
    byGpu.set(md.gpu, entry);
  }
  for (const entry of byGpu.values()) {
    for (const s of SCENARIOS) {
      entry.nodesRequired[s] = Math.max(
        entry.gpusRequired[s] > 0 ? 2 : 0, // minimum two nodes for HA when the GPU type is used at all
        Math.ceil(entry.gpusRequired[s] / entry.gpusPerNode),
      );
    }
  }
  return Array.from(byGpu.values());
}

function controlPlaneTier(totalWorkers: number) {
  const tiers = referenceConstants.controlPlaneSizingTiers;
  return tiers.find(t => totalWorkers <= t.workersUpTo) ?? tiers[tiers.length - 1];
}
function infraTier(totalWorkers: number) {
  const tiers = referenceConstants.infraNodeSizingTiers;
  return tiers.find(t => totalWorkers <= t.workersUpTo) ?? tiers[tiers.length - 1];
}

/** Is a platformOverheadLineItem's gate satisfied by the current platform configuration? */
function isLineItemEnabled(item: PlatformOverheadLineItem, platform: PlatformConfig, hasAnyGpu: boolean): boolean {
  if (item.gatedBy === 'always') return true;
  if (item.gatedBy === 'anyGpu') return hasAnyGpu;
  return item.gatedBy.some(key => !!platform.enabledComponents[key]);
}

/** Sums the itemized, gated non-GPU platform overhead line items (data/components.json's
 * platformOverheadLineItems — the Cluster Architecture "Table D" equivalent), replacing the
 * old flat rhoaiPlatformServicesPlanningAllowance with a real per-component breakdown. */
export function calculatePlatformOverheadLineItems(
  platform: PlatformConfig, hasAnyGpu: boolean,
): Array<{ label: string; vcpu: number; ramGiB: number }> {
  const items: Array<{ label: string; vcpu: number; ramGiB: number }> = [];
  for (const item of PLATFORM_OVERHEAD_LINE_ITEMS) {
    if (!isLineItemEnabled(item, platform, hasAnyGpu)) continue;
    let vcpu = item.vcpu;
    let ramGiB = item.ramGiB;
    if (item.scalesWithConcurrentPipelineRuns) {
      const extraRuns = Math.max(0, platform.concurrentPipelineRuns - 1);
      vcpu += extraRuns * 1;
      ramGiB += extraRuns * 3;
    }
    items.push({ label: item.label, vcpu, ramGiB });
  }
  return items;
}

export function calculateCpuWorkerDemand(
  platform: PlatformConfig, sizedModelsCount: number, hasAnyGpu: boolean = false,
): { vcpu: number; ramGiB: number; lineItems: Array<{ label: string; vcpu: number; ramGiB: number }> } {
  const c = referenceConstants.platformConstants;
  const lineItems = calculatePlatformOverheadLineItems(platform, hasAnyGpu);
  let vcpu = lineItems.reduce((sum, i) => sum + i.vcpu, 0);
  let ramGiB = lineItems.reduce((sum, i) => sum + i.ramGiB, 0);

  const distributedWorkloadsEnabled = platform.enabledComponents.kueue || platform.enabledComponents.ray || platform.enabledComponents.trainer;
  if (distributedWorkloadsEnabled) {
    vcpu += c.distributedWorkloadsControllersVcpu;
    ramGiB += c.distributedWorkloadsControllersRamGiB;
  }

  // Workbenches — Medium profile assumption (8 vCPU / 16 GiB), matching the reference default.
  vcpu += platform.concurrentWorkbenches * 8;
  ramGiB += platform.concurrentWorkbenches * 16;

  // Training jobs — LoRA-class CPU-side footprint (GPUs counted separately, not here).
  vcpu += platform.concurrentTrainingJobs * 8;
  ramGiB += platform.concurrentTrainingJobs * 64;

  // Evaluation jobs
  vcpu += platform.concurrentEvalJobs * 4;
  ramGiB += platform.concurrentEvalJobs * 16;

  // Vector DB instances
  vcpu += platform.vectorDbInstances * 4;
  ramGiB += platform.vectorDbInstances * 16;

  // Per-project instances
  for (const pp of PER_PROJECT_INSTANCES) {
    if (!platform.enabledPerProjectInstances[pp.key]) continue;
    const instances = pp.instancesPerProject * platform.numProjects;
    vcpu += instances * (pp.cpuPerInstance ?? 0.5);
    ramGiB += instances * (pp.ramPerInstanceGiB ?? 1);
  }

  // Sized models add a small CPU-side sidecar footprint per model (oauth-proxy, etc.)
  vcpu += sizedModelsCount * c.oauthProxySidecarVcpu;
  ramGiB += sizedModelsCount * c.oauthProxySidecarRamGiB;

  return { vcpu, ramGiB, lineItems };
}

export function calculateStorage(
  customer: CustomerProfile, sizedModels: SizedModel[], platform: PlatformConfig,
): StorageTotals {
  const c = referenceConstants.platformConstants;
  let objectStorageGiB = c.internalImageRegistryMinStorageGiB;
  let blockStorageGiB = 0;
  let localNvmeGB = 0;

  // Model artifacts (object storage), versions kept
  const totalModelWeightsGb = sizedModels.reduce((sum, m) => sum + (m.weightsGb ?? 0), 0);
  objectStorageGiB += totalModelWeightsGb * platform.modelVersionsKept;

  // Mirror registry, only if disconnected
  if (customer.connectivity === 'disconnected') {
    blockStorageGiB += 400 + totalModelWeightsGb * platform.modelVersionsKept;
  }

  // Workbench volumes
  blockStorageGiB += platform.concurrentWorkbenches * platform.workbenchPvcSizeGb;

  // Vector DB
  blockStorageGiB += platform.vectorDbInstances * 100;

  // Per-project instance volumes
  for (const pp of PER_PROJECT_INSTANCES) {
    if (!platform.enabledPerProjectInstances[pp.key] || !pp.volumePerInstanceGiB) continue;
    blockStorageGiB += pp.volumePerInstanceGiB * pp.instancesPerProject * platform.numProjects;
  }

  // Pipeline + MLflow artifacts (object)
  if (platform.enabledPerProjectInstances.pipeline_server || platform.enabledPerProjectInstances.mlflow_server) {
    objectStorageGiB += 50 * platform.numProjects;
  }

  // Local NVMe for model cache on GPU nodes: 2x largest model artifact per node (NVIDIA AI Enterprise rule)
  const largestModelGb = Math.max(0, ...sizedModels.map(m => m.weightsGb ?? 0));
  const gpuNodeCount = 1; // caller may override; kept simple at this layer
  localNvmeGB += largestModelGb * c.localNvmeMultiplierOfLargestModelArtifact * gpuNodeCount;

  return { objectStorageGiB, blockStorageGiB, localNvmeGB };
}

export function calculateChecks(
  gpuTypeTotals: GpuTypeTotals[], cpuWorkerVcpu: number, cpuWorkerNodes: number,
  modelDemand: ModelDemand[], sizedModels: SizedModel[], useCases: UseCase[],
): Checks[] {
  const c = referenceConstants.platformConstants;
  const checks: Checks[] = [];

  // Use cases that aren't mapped to any currently-sized model contribute zero demand —
  // easy to miss, and silently under-sizes the cluster. Use cases explicitly marked
  // "External model" are an intentional exclusion, not a mistake, so they're exempt.
  const unmapped = useCases.filter(
    uc => uc.sizedModelId !== EXTERNAL_MODEL_SENTINEL && !sizedModels.some(m => m.id === uc.sizedModelId),
  );
  if (unmapped.length > 0) {
    checks.push({
      label: 'Use cases not mapped to a sized model',
      status: 'WARN',
      detail: `${unmapped.length} use case(s) are excluded from GPU sizing because they aren't mapped to a model in `
        + `Step 3: ${unmapped.map(u => u.name || '(unnamed)').join(', ')}. Map them to a sized model or they won't `
        + `be counted.`,
    });
  }

  // "Target concurrency" (Step 2) sets how many requests ONE replica should serve at once —
  // it is NOT the total user count from Step 3. It becomes maxConcurrentPerReplica, the
  // divisor in replicas = ceil(requestsInFlight / maxConcurrentPerReplica). Left at a low
  // default (e.g. 1) while Step 3 has real demand, it silently inflates the replica count.
  for (const md of modelDemand) {
    const model = sizedModels.find(m => m.id === md.sizedModelId);
    const cap = model?.maxConcurrentPerReplica ?? 1;
    if (cap <= 2 && md.replicas.high >= 5) {
      checks.push({
        label: `${md.model}: replica count may be inflated by a low "Target concurrency"`,
        status: 'WARN',
        detail: `This model's captured per-replica concurrency is only ${cap} (from Step 2's "Target concurrency"), `
          + `driving ${md.replicas.high} replicas at High demand. If one replica can realistically serve more than `
          + `${cap} request(s) at once, go back to Step 2, raise Target concurrency to that batch size, and re-add `
          + `the model — "Target concurrency" sizes one replica's capacity, not your total user count.`,
      });
    }
  }

  for (const g of gpuTypeTotals) {
    if (g.gpusRequired.high === 0) continue;
    const requiredHostRamGiB = c.hostRamMultiplierOfTotalGpuMemory * g.gpuMemoryGB * g.gpusPerNode;
    checks.push({
      label: `${g.gpu} host RAM rule (>= ${c.hostRamMultiplierOfTotalGpuMemory}x total GPU memory per node)`,
      status: 'OK',
      detail: `Plan for >= ${requiredHostRamGiB.toFixed(0)} GiB host RAM per ${g.gpu} node (${g.gpusPerNode} GPUs x ${g.gpuMemoryGB} GB x ${c.hostRamMultiplierOfTotalGpuMemory}).`,
    });
    checks.push({
      label: `${g.gpu} physical cores rule`,
      status: 'OK',
      detail: `Plan for >= ${c.physicalCoresPerGpuCertifiedFloor} physical cores per GPU (NVIDIA-Certified floor), >= ${c.physicalCoresPerGpuEnterpriseRA} recommended.`,
    });
  }

  checks.push({
    label: 'CPU worker node minimum (RHOAI install requirement)',
    status: cpuWorkerNodes >= 2 ? 'OK' : 'WARN',
    detail: `${cpuWorkerNodes} CPU worker node(s) planned; RHOAI requires >= ${c.rhoaiInstallMinWorkerNodes} workers at >= ${c.rhoaiInstallMinVcpuPerWorker} vCPU / ${c.rhoaiInstallMinRamPerWorkerGiB} GiB each.`,
  });

  checks.push({
    label: 'N-1 capacity (one CPU worker node can fail)',
    status: cpuWorkerNodes > 1 ? 'OK' : 'WARN',
    detail: cpuWorkerNodes > 1
      ? `${cpuWorkerNodes - 1} node(s) of capacity still covers ${cpuWorkerVcpu.toFixed(1)} vCPU demand if sized with headroom.`
      : 'Only one CPU worker node planned — no failure tolerance. Add a second node for production.',
  });

  return checks;
}

export function calculateSizing(
  customer: CustomerProfile, sizedModels: SizedModel[], useCases: UseCase[], platform: PlatformConfig,
): SizingResult {
  const modelDemand = calculateModelDemand(sizedModels, useCases);
  const allHardware = [...customer.existingHardware, ...customer.plannedHardware];
  const gpuTypeTotals = calculateGpuTypeTotals(modelDemand, allHardware);

  const totalGpuNodes: Record<Scenario, number> = { low: 0, high: 0, stress: 0 };
  for (const g of gpuTypeTotals) for (const s of SCENARIOS) totalGpuNodes[s] += g.nodesRequired[s];

  const hasAnyGpu = allHardware.some(h => h.count > 0) || sizedModels.length > 0;
  const { vcpu: cpuWorkerVcpu, ramGiB: cpuWorkerRamGiB, lineItems: platformOverheadLineItems } =
    calculateCpuWorkerDemand(platform, sizedModels.length, hasAnyGpu);
  const usableVcpuPerWorker = CPU_WORKER_VCPU * platform.maxCpuWorkerUtilization;
  const usableRamPerWorker = CPU_WORKER_RAM_GIB * platform.maxCpuWorkerUtilization;
  const cpuWorkerNodes = Math.max(
    referenceConstants.platformConstants.rhoaiInstallMinWorkerNodes,
    Math.ceil(cpuWorkerVcpu / usableVcpuPerWorker),
    Math.ceil(cpuWorkerRamGiB / usableRamPerWorker),
  );

  const totalWorkersHigh = totalGpuNodes.high + cpuWorkerNodes;
  const cpTier = controlPlaneTier(totalWorkersHigh);
  const infTier = infraTier(totalWorkersHigh);

  const nodeTiers: NodeTier[] = [
    { role: 'Control plane', count: referenceConstants.platformConstants.controlPlaneNodesPerCluster, vcpuPerNode: cpTier.cpuCores, ramGBPerNode: cpTier.memoryGB },
    { role: 'Infra', count: platform.infraNodesPerCluster, vcpuPerNode: infTier.cpuCores, ramGBPerNode: infTier.memoryGB },
    { role: 'CPU worker', count: cpuWorkerNodes, vcpuPerNode: CPU_WORKER_VCPU, ramGBPerNode: CPU_WORKER_RAM_GIB },
    ...gpuTypeTotals.map(g => ({ role: `GPU worker (${g.gpu})`, count: g.nodesRequired.high, vcpuPerNode: 0, ramGBPerNode: 0 })),
  ];

  const totalNodes: Record<Scenario, number> = { low: 0, high: 0, stress: 0 };
  for (const s of SCENARIOS) {
    totalNodes[s] = referenceConstants.platformConstants.controlPlaneNodesPerCluster
      + platform.infraNodesPerCluster + cpuWorkerNodes + totalGpuNodes[s];
  }

  const storage = calculateStorage(customer, sizedModels, platform);
  const checks = calculateChecks(gpuTypeTotals, cpuWorkerVcpu, cpuWorkerNodes, modelDemand, sizedModels, useCases);

  // Red Hat AI Enterprise is licensed per GPU or CPU worker node (reference workbook convention).
  const redHatSubscriptionNodes: Record<Scenario, number> = { low: 0, high: 0, stress: 0 };
  for (const s of SCENARIOS) redHatSubscriptionNodes[s] = cpuWorkerNodes + totalGpuNodes[s];

  return {
    modelDemand, gpuTypeTotals, nodeTiers, totalNodes,
    cpuWorkerVcpuDemand: cpuWorkerVcpu, cpuWorkerRamGiBDemand: cpuWorkerRamGiB, cpuWorkerNodes,
    platformOverheadLineItems,
    storage, redHatSubscriptionNodes, checks,
  };
}

export function enabledComponentLabels(platform: PlatformConfig): string[] {
  return DSC_COMPONENTS.filter(c => platform.enabledComponents[c.key]).map(c => c.label);
}
