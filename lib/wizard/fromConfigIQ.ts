import type { RecommendResult } from '@/lib/api/recommend';
import type { SizedModel } from '@/lib/wizard/types';

/** Converts a completed ConfigIQ Recommend Sizing result into a SizedModel for the wizard. */
export function sizedModelFromRecommendResult(
  result: RecommendResult,
  opts: { model: string; gpu: string; paramsB?: number | null; activeParamsB?: number | null; precision?: string | null },
): SizedModel {
  return {
    id: `sized_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    model: opts.model,
    paramsB: opts.paramsB ?? null,
    activeParamsB: opts.activeParamsB ?? null,
    precision: opts.precision ?? null,
    gpu: opts.gpu,
    gpusPerReplica: result.recommendation.gpusPerReplica,
    tensorParallelSize: result.recommendation.tensorParallelSize,
    replicasNeeded: result.recommendation.replicasNeeded,
    gpusNeeded: result.recommendation.gpusNeeded,
    weightsGb: result.memory.breakdown?.weightsGb ?? null,
    kvCacheGb: result.memory.breakdown?.kvCacheGb ?? null,
    maxConcurrentPerReplica: result.performance.concurrency > 0
      ? Math.max(1, Math.round(result.performance.concurrency / Math.max(1, result.recommendation.replicasNeeded)))
      : null,
    ttftEstimateMs: result.performance.ttftLatencyMs,
    tpotMs: result.performance.tpotMs,
    tokensPerSecond: result.throughput.tokensPerSecond,
    tokensPerSecondPerUser: result.throughput.tokensPerSecondPerUser,
    mode: result.mode,
    source: 'recommend',
    capturedAt: new Date().toISOString(),
  };
}
