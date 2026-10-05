// Shared types for the RHOAI Sizing Wizard (Steps 1, 3, 4, 5).
// Step 2 is ConfigIQ itself — see SizedModel for what it exports into here.

export type DeploymentType = 'production' | 'poc' | 'development';
export type Connectivity = 'connected' | 'connected_proxy' | 'disconnected';
export type DeploymentTarget = 'on_prem_bare_metal' | 'on_prem_vm' | 'aws' | 'azure' | 'gcp';

export interface GpuGroup {
  id: string;
  gpu: string;
  count: number;
  formFactor?: string;
  servers?: number;
}

export interface CustomerProfile {
  name: string;
  project: string;
  deploymentType: DeploymentType;
  openshiftVersion: string;
  connectivity: Connectivity;
  target: DeploymentTarget;
  existingHardware: GpuGroup[];
  plannedHardware: GpuGroup[];
  growthHorizonYears: number;
  annualGrowthRate: number;
  environments: {
    production: boolean;
    disasterRecovery: boolean;
    test: boolean;
    development: boolean;
  };
}

export const DEFAULT_CUSTOMER_PROFILE: CustomerProfile = {
  name: '',
  project: '',
  deploymentType: 'production',
  openshiftVersion: '4.20',
  connectivity: 'connected',
  target: 'on_prem_bare_metal',
  existingHardware: [],
  plannedHardware: [],
  growthHorizonYears: 3,
  annualGrowthRate: 0.25,
  environments: { production: true, disasterRecovery: false, test: true, development: true },
};

/** Captured from a ConfigIQ Recommend Sizing or Predict Performance run. */
export interface SizedModel {
  id: string;
  model: string;
  paramsB: number | null;
  activeParamsB: number | null;
  precision: string | null;
  gpu: string;
  gpusPerReplica: number;
  tensorParallelSize: number;
  replicasNeeded: number;
  gpusNeeded: number;
  weightsGb: number | null;
  kvCacheGb: number | null;
  maxConcurrentPerReplica: number | null;
  ttftEstimateMs: number | null;
  tpotMs: number | null;
  tokensPerSecond: number | null;
  tokensPerSecondPerUser: number | null;
  mode: 'agg' | 'disagg';
  source: 'recommend' | 'predict';
  capturedAt: string;
}

/** Sentinel stored in UseCase.sizedModelId to mean "intentionally served by a model
 * outside this wizard" (e.g. a third-party API model) — distinct from `null`, which
 * means "not mapped yet" and should surface as a warning, not a quiet exclusion. */
export const EXTERNAL_MODEL_SENTINEL = '__external__';

/** Freeform use case, mapped to one sized model, with demand parameters. */
export interface UseCase {
  id: string;
  name: string;
  sizedModelId: string | null;
  concurrentUsersLow: number;
  concurrentUsersHigh: number;
  shareInFlight: number;
  inputTokens: number;
  outputTokens: number;
  prefixCacheHitRate: number;
  ttftTargetS: number;
  tokensPerSecondTarget: number;
  screenedByGuard: boolean;
  guardCallsPerRequest: number;
  notes: string;
}

export function createEmptyUseCase(id: string): UseCase {
  return {
    id,
    name: '',
    sizedModelId: null,
    concurrentUsersLow: 10,
    concurrentUsersHigh: 50,
    shareInFlight: 0.3,
    inputTokens: 4000,
    outputTokens: 500,
    prefixCacheHitRate: 0.2,
    ttftTargetS: 3,
    tokensPerSecondTarget: 50,
    screenedByGuard: false,
    guardCallsPerRequest: 2,
    notes: '',
  };
}

/** Component selection + platform configuration (Step 4). */
export interface PlatformConfig {
  enabledComponents: Record<string, boolean>;
  enabledPerProjectInstances: Record<string, boolean>;
  numProjects: number;
  concurrentWorkbenches: number;
  workbenchPvcSizeGb: number;
  concurrentTrainingJobs: number;
  concurrentEvalJobs: number;
  vectorDbInstances: number;
  concurrentPipelineRuns: number;
  infraNodesPerCluster: number;
  maxCpuWorkerUtilization: number;
  modelVersionsKept: number;
  prometheusRetentionDays: number;
  lokiRetentionDays: number;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  enabledComponents: {
    dashboard: true,
    workbenches: true,
    aipipelines: true,
    kserve: true,
    kueue: true,
    ray: false,
    trainer: false,
    trainingoperator: false,
    feastoperator: false,
    modelregistry: true,
    trustyai: true,
    mlflowoperator: true,
    ogx: false,
    mcplifecycleoperator: false,
  },
  enabledPerProjectInstances: {
    pipeline_server: true,
    mlflow_server: true,
    ogx_server: false,
    ogx_postgresql: false,
    modelregistry_instance: true,
    trustyai_guardrails: true,
    evalhub_tenant: false,
  },
  numProjects: 5,
  concurrentWorkbenches: 5,
  workbenchPvcSizeGb: 50,
  concurrentTrainingJobs: 0,
  concurrentEvalJobs: 1,
  vectorDbInstances: 1,
  concurrentPipelineRuns: 2,
  infraNodesPerCluster: 3,
  maxCpuWorkerUtilization: 0.8,
  modelVersionsKept: 2,
  prometheusRetentionDays: 15,
  lokiRetentionDays: 90,
};

/** Which path the user chose on the /wizard landing page. `null` means the
 * wizard hasn't been started yet, which drives whether wizard chrome (progress
 * header, "continue" CTAs) shows up at all on shared pages like /recommend. */
export type WizardMode = 'full' | 'llm-only' | null;

/** Full wizard state, persisted to localStorage and sent to the Excel service. */
export interface WizardState {
  wizardMode: WizardMode;
  customer: CustomerProfile;
  sizedModels: SizedModel[];
  useCases: UseCase[];
  platform: PlatformConfig;
}

export const DEFAULT_WIZARD_STATE: WizardState = {
  wizardMode: null,
  customer: DEFAULT_CUSTOMER_PROFILE,
  sizedModels: [],
  useCases: [],
  platform: DEFAULT_PLATFORM_CONFIG,
};

/** sizing-intake.json shape produced by the rhoai-sizing-intake agent skill. */
export interface SizingIntake {
  customer: {
    name: string;
    project?: string | null;
    deployment_type?: DeploymentType | null;
    openshift_version?: string | null;
    connectivity?: Connectivity | null;
    target?: DeploymentTarget | null;
  };
  hardware: {
    existing: Array<{ gpu: string; count: number | null; form_factor?: string | null; servers?: number | null }>;
    planned: Array<{ gpu: string; count: number | null; form_factor?: string | null; servers?: number | null }>;
  };
  growth: {
    horizon_years?: number | null;
    annual_growth_rate?: number | null;
  };
  use_cases: Array<{
    name: string;
    concurrent_users_low?: number | null;
    concurrent_users_high?: number | null;
    input_tokens?: number | null;
    output_tokens?: number | null;
    ttft_target_s?: number | null;
    tokens_per_s_target?: number | null;
    model_preference?: string | null;
    notes?: string | null;
  }>;
  extraction_confidence: {
    customer: 'high' | 'medium' | 'low';
    hardware: 'high' | 'medium' | 'low';
    use_cases: 'high' | 'medium' | 'low';
    missing_fields: string[];
  };
}
