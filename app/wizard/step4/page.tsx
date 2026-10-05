'use client';

import * as React from 'react';
import { PageSection } from '@patternfly/react-core';
import { useWizard } from '@/contexts/WizardContext';
import { WizardStepHeader } from '@/components/wizard/WizardStepHeader';
import { ComponentRow } from '@/components/wizard/ComponentRow';
import { DSC_COMPONENTS, PER_PROJECT_INSTANCES, resolveDependencies } from '@/lib/wizard/componentData';
import type { PlatformConfig } from '@/lib/wizard/types';
import styles from '@/components/wizard/wizard.module.css';

export default function Step4Page() {
  const { state, setPlatform } = useWizard();
  const [local, setLocal] = React.useState<PlatformConfig>(state.platform);

  React.useEffect(() => { setLocal(state.platform); }, [state.platform]);

  const commit = (patch: Partial<PlatformConfig>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    setPlatform(next);
  };

  const toggleComponent = (key: string, enabled: boolean) => {
    commit({ enabledComponents: { ...local.enabledComponents, [key]: enabled } });
  };

  const togglePerProject = (key: string, enabled: boolean) => {
    commit({ enabledPerProjectInstances: { ...local.enabledPerProjectInstances, [key]: enabled } });
  };

  const enabledKeySet = new Set(Object.entries(local.enabledComponents).filter(([, v]) => v).map(([k]) => k));
  const llmdEnabled = local.enabledComponents.kserve; // llm-d rides on kserve in this model; toggle is implicit
  const requiredOperators = resolveDependencies(enabledKeySet, !!llmdEnabled);

  return (
    <PageSection padding={{ default: 'noPadding' }} style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <div className={styles.page}>
        <WizardStepHeader
          currentKey="step4"
          title="RHOAI platform sizing"
          subtitle="Select components, configure non-GPU workloads, and review lifecycle guardrails."
          prevHref="/wizard/step3"
          nextHref="/wizard/step5"
          nextLabel="Continue to review →"
        />

        <div className={styles.card}>
          <div className={styles.cardTitle}>DataScienceCluster components</div>
          <div className={styles.cardSubtitle}>
            Toggle what the customer will use. Expand &quot;Details&quot; for version history, source conflicts,
            and planned 3.6 breaking changes sourced from the RHOAI Version Tracker.
          </div>
          {DSC_COMPONENTS.map(c => (
            <ComponentRow
              key={c.key}
              component={c}
              enabled={!!local.enabledComponents[c.key]}
              onToggle={v => toggleComponent(c.key, v)}
            />
          ))}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Dependent operators (auto-resolved)</div>
          <div className={styles.cardSubtitle}>Installed separately; required by the components you&apos;ve enabled above.</div>
          {requiredOperators.length === 0 ? (
            <div className={styles.emptyState}>No additional operators required for the current selection.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              {requiredOperators.map(op => <li key={op}>{op}</li>)}
            </ul>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Per-project instances</div>
          <div className={styles.cardSubtitle}>Multiplied by the number of data science projects below.</div>
          {PER_PROJECT_INSTANCES.map(p => (
            <div key={p.key} className={styles.checkRow}>
              <input
                type="checkbox"
                id={`pp-${p.key}`}
                checked={!!local.enabledPerProjectInstances[p.key]}
                onChange={e => togglePerProject(p.key, e.target.checked)}
              />
              <label htmlFor={`pp-${p.key}`}><strong>{p.label}</strong> — {p.notes}</label>
            </div>
          ))}
          <div className={styles.fieldWrap} style={{ marginTop: 16, maxWidth: 220 }}>
            <label className={styles.fieldLabel}>Number of data science projects</label>
            <input type="number" min={1} className={styles.input} value={local.numProjects}
              onChange={e => commit({ numProjects: parseInt(e.target.value, 10) || 1 })} />
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Non-GPU workloads</div>
          <div className={styles.grid4}>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Concurrent workbenches</label>
              <input type="number" min={0} className={styles.input} value={local.concurrentWorkbenches}
                onChange={e => commit({ concurrentWorkbenches: parseInt(e.target.value, 10) || 0 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Workbench PVC size (GB)</label>
              <input type="number" min={1} className={styles.input} value={local.workbenchPvcSizeGb}
                onChange={e => commit({ workbenchPvcSizeGb: parseInt(e.target.value, 10) || 1 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Concurrent training jobs</label>
              <input type="number" min={0} className={styles.input} value={local.concurrentTrainingJobs}
                onChange={e => commit({ concurrentTrainingJobs: parseInt(e.target.value, 10) || 0 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Concurrent eval jobs</label>
              <input type="number" min={0} className={styles.input} value={local.concurrentEvalJobs}
                onChange={e => commit({ concurrentEvalJobs: parseInt(e.target.value, 10) || 0 })} />
            </div>
          </div>
          <div className={styles.grid4}>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Vector DB instances</label>
              <input type="number" min={0} className={styles.input} value={local.vectorDbInstances}
                onChange={e => commit({ vectorDbInstances: parseInt(e.target.value, 10) || 0 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Concurrent pipeline runs</label>
              <input type="number" min={0} className={styles.input} value={local.concurrentPipelineRuns}
                onChange={e => commit({ concurrentPipelineRuns: parseInt(e.target.value, 10) || 0 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Infra nodes per cluster</label>
              <input type="number" min={0} className={styles.input} value={local.infraNodesPerCluster}
                onChange={e => commit({ infraNodesPerCluster: parseInt(e.target.value, 10) || 0 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Max CPU worker utilization (%)</label>
              <input type="number" min={10} max={100} className={styles.input} value={Math.round(local.maxCpuWorkerUtilization * 100)}
                onChange={e => commit({ maxCpuWorkerUtilization: (parseFloat(e.target.value) || 10) / 100 })} />
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Storage & retention</div>
          <div className={styles.grid3}>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Model versions kept</label>
              <input type="number" min={1} className={styles.input} value={local.modelVersionsKept}
                onChange={e => commit({ modelVersionsKept: parseInt(e.target.value, 10) || 1 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Prometheus retention (days)</label>
              <input type="number" min={1} className={styles.input} value={local.prometheusRetentionDays}
                onChange={e => commit({ prometheusRetentionDays: parseInt(e.target.value, 10) || 1 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Loki retention (days)</label>
              <input type="number" min={1} className={styles.input} value={local.lokiRetentionDays}
                onChange={e => commit({ lokiRetentionDays: parseInt(e.target.value, 10) || 1 })} />
            </div>
          </div>
        </div>
      </div>
    </PageSection>
  );
}
