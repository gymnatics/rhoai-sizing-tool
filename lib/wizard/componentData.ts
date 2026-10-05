import componentsData from '@/data/components.json';
import featureLifecycleData from '@/data/feature-lifecycle.json';
import migrationChecklistData from '@/data/migration-checklist.json';
import sourceConflictsData from '@/data/source-conflicts.json';
import roadmapData from '@/data/roadmap.json';

export interface DscComponent {
  key: string;
  label: string;
  capability: string;
  status: string;
  statusDetail?: string;
  defaultEnabled: boolean;
  scope: string;
  prerequisites: string[];
  llmdPrerequisites?: string[];
  database: { type: string; note?: string } | null;
  objectStorage?: boolean;
  notes: string | null;
  eusExceptionDate?: string;
}

export interface PerProjectInstance {
  key: string;
  label: string;
  createdBy: string;
  defaultEnabled: boolean;
  instancesPerProject: number;
  cpuPerInstance?: number;
  ramPerInstanceGiB?: number;
  volumePerInstanceGiB?: number;
  notes: string;
}

export interface DependentOperator {
  key: string;
  label?: string;
  neededWhen: string[];
  status: string;
  scope: string;
  notes?: string;
}

/** Itemized non-GPU RHOAI platform overhead line item (Cluster Architecture Table D equivalent). */
export interface PlatformOverheadLineItem {
  key: string;
  label: string;
  vcpu: number;
  ramGiB: number;
  /** "always" = unconditional; "anyGpu" = on when any GPU hardware is in use;
   * string[] = on when ANY of these DSC component keys is enabled. */
  gatedBy: 'always' | 'anyGpu' | string[];
  scalesWithConcurrentPipelineRuns?: boolean;
  notes: string | null;
}

export const DSC_COMPONENTS = componentsData.dscComponents as DscComponent[];
export const PER_PROJECT_INSTANCES = componentsData.perProjectInstances as PerProjectInstance[];
export const DEPENDENT_OPERATORS = componentsData.dependentOperators as DependentOperator[];
export const PLATFORM_OVERHEAD_LINE_ITEMS = componentsData.platformOverheadLineItems as PlatformOverheadLineItem[];

export const FEATURE_LIFECYCLE = featureLifecycleData.features;
export const MIGRATION_CHECKLIST = migrationChecklistData;
export const SOURCE_CONFLICTS = sourceConflictsData.conflicts;
export const ROADMAP_TARGETS = roadmapData.targets;

export function lifecycleForComponent(key: string) {
  return FEATURE_LIFECYCLE.filter(f => (f.componentKeys as string[]).includes(key));
}
export function conflictsForComponent(key: string) {
  return SOURCE_CONFLICTS.filter(c => (c.componentKeys as string[]).includes(key));
}
export function breakingChangesForComponent(key: string) {
  return MIGRATION_CHECKLIST.plannedBreakingChanges36.filter(b => (b.componentKeys as string[]).includes(key));
}
export function roadmapForComponent(key: string) {
  return ROADMAP_TARGETS.filter(r => (r.componentKeys as string[]).includes(key));
}

/** Badge CSS class suffix for a status string (GA / TP / DP / Deprecated / other). */
export function statusBadgeClass(status: string): 'GA' | 'TP' | 'DP' | 'Deprecated' {
  const s = status.toLowerCase();
  if (s.includes('deprecated')) return 'Deprecated';
  if (s.startsWith('ga')) return 'GA';
  if (s.includes('technology preview') || s === 'tp') return 'TP';
  return 'DP';
}

/** Resolve the full set of component keys that must be enabled given a selection,
 * by walking DSC component -> dependent operator "neededWhen" relationships. */
export function resolveDependencies(enabledKeys: Set<string>, llmdEnabled: boolean): string[] {
  const requiredOperators = new Set<string>();
  for (const op of DEPENDENT_OPERATORS) {
    const needed = op.neededWhen.some(w => enabledKeys.has(w) || (w === 'llm-d' && llmdEnabled));
    if (needed) requiredOperators.add(op.label ?? op.key);
  }
  return Array.from(requiredOperators);
}
