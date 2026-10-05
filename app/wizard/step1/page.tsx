'use client';

import * as React from 'react';
import { PageSection } from '@patternfly/react-core';
import { useWizard } from '@/contexts/WizardContext';
import { WizardStepHeader } from '@/components/wizard/WizardStepHeader';
import { IntakeImport } from '@/components/wizard/IntakeImport';
import { GpuGroupEditor } from '@/components/wizard/GpuGroupEditor';
import type { CustomerProfile, DeploymentType, Connectivity, DeploymentTarget } from '@/lib/wizard/types';
import styles from '@/components/wizard/wizard.module.css';

export default function Step1Page() {
  const { state, setCustomer } = useWizard();
  const [local, setLocal] = React.useState<CustomerProfile>(state.customer);

  // Resync whenever the context's customer object changes — on hydration from localStorage,
  // and crucially after an "Import from intake" JSON upload further down this same page
  // (previously this only resynced once on hydration, so an import after mount silently
  // updated context state but never refreshed the visible form fields).
  React.useEffect(() => { setLocal(state.customer); }, [state.customer]);

  const commit = (patch: Partial<CustomerProfile>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    setCustomer(next);
  };

  return (
    <PageSection padding={{ default: 'noPadding' }} style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <div className={styles.page}>
        <WizardStepHeader
          currentKey="step1"
          title="Customer profile & hardware"
          subtitle="Deployment context and GPU inventory that ConfigIQ doesn't capture."
          nextHref="/recommend"
          nextLabel="Continue to model sizing →"
        />

        <IntakeImport />

        <div className={styles.card}>
          <div className={styles.cardTitle}>Customer & project</div>
          <div className={styles.grid2}>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Customer name</label>
              <input className={styles.input} value={local.name} onChange={e => commit({ name: e.target.value })} placeholder="e.g. Acme Financial Services" />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Project name</label>
              <input className={styles.input} value={local.project} onChange={e => commit({ project: e.target.value })} placeholder="e.g. Internal Audit AI" />
            </div>
          </div>
          <div className={styles.grid3}>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Deployment type</label>
              <select className={styles.select} value={local.deploymentType} onChange={e => commit({ deploymentType: e.target.value as DeploymentType })}>
                <option value="production">Production</option>
                <option value="poc">Proof of concept</option>
                <option value="development">Development</option>
              </select>
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>OpenShift version</label>
              <select className={styles.select} value={local.openshiftVersion} onChange={e => commit({ openshiftVersion: e.target.value })}>
                {['4.22', '4.21', '4.20', '4.19'].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Network connectivity</label>
              <select className={styles.select} value={local.connectivity} onChange={e => commit({ connectivity: e.target.value as Connectivity })}>
                <option value="connected">Connected</option>
                <option value="connected_proxy">Connected via proxy</option>
                <option value="disconnected">Disconnected / air-gapped</option>
              </select>
            </div>
          </div>
          <div className={styles.grid2}>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Deployment target</label>
              <select className={styles.select} value={local.target} onChange={e => commit({ target: e.target.value as DeploymentTarget })}>
                <option value="on_prem_bare_metal">On-prem — bare metal</option>
                <option value="on_prem_vm">On-prem — virtualized</option>
                <option value="aws">AWS</option>
                <option value="azure">Azure</option>
                <option value="gcp">Google Cloud</option>
              </select>
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Hardware inventory</div>
          <div className={styles.cardSubtitle}>GPUs the customer already owns, and GPUs under evaluation for new capacity.</div>
          <div style={{ marginBottom: 20 }}>
            <GpuGroupEditor
              label="Existing hardware"
              groups={local.existingHardware}
              onChange={g => commit({ existingHardware: g })}
            />
          </div>
          <div>
            <GpuGroupEditor
              label="Planned / under evaluation"
              groups={local.plannedHardware}
              onChange={g => commit({ plannedHardware: g })}
            />
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Growth & environments</div>
          <div className={styles.grid2}>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Planning horizon (years)</label>
              <input type="number" min={1} className={styles.input} value={local.growthHorizonYears}
                onChange={e => commit({ growthHorizonYears: parseInt(e.target.value, 10) || 1 })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Annual growth rate (%)</label>
              <input type="number" min={0} step={1} className={styles.input} value={Math.round(local.annualGrowthRate * 100)}
                onChange={e => commit({ annualGrowthRate: (parseFloat(e.target.value) || 0) / 100 })} />
            </div>
          </div>
          <label className={styles.fieldLabel} style={{ marginTop: 8 }}>Environments to size</label>
          {([
            ['production', 'Production'],
            ['disasterRecovery', 'Disaster recovery'],
            ['test', 'Test / UAT'],
            ['development', 'Development'],
          ] as const).map(([key, label]) => (
            <div className={styles.checkRow} key={key}>
              <input
                type="checkbox"
                id={`env-${key}`}
                checked={local.environments[key]}
                onChange={e => commit({ environments: { ...local.environments, [key]: e.target.checked } })}
              />
              <label htmlFor={`env-${key}`}>{label}</label>
            </div>
          ))}
        </div>
      </div>
    </PageSection>
  );
}
