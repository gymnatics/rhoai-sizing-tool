'use client';

import * as React from 'react';
import { PageSection } from '@patternfly/react-core';
import { useWizard } from '@/contexts/WizardContext';
import { WizardStepHeader } from '@/components/wizard/WizardStepHeader';
import { EXTERNAL_MODEL_SENTINEL, type UseCase } from '@/lib/wizard/types';
import styles from '@/components/wizard/wizard.module.css';

function UseCaseCard({ uc, modelOptions }: {
  uc: UseCase;
  modelOptions: { id: string; label: string }[];
}) {
  const { state, updateUseCase, removeUseCase } = useWizard();
  const set = (patch: Partial<UseCase>) => updateUseCase(uc.id, patch);
  const isExternal = uc.sizedModelId === EXTERNAL_MODEL_SENTINEL;
  const isUnmapped = !isExternal && !uc.sizedModelId;
  const selectedModel = state.sizedModels.find(m => m.id === uc.sizedModelId);
  const totalDemandHigh = Math.round(uc.concurrentUsersHigh * uc.shareInFlight);
  const cap = selectedModel?.maxConcurrentPerReplica ?? null;
  const capacityLooksLow = cap !== null && cap <= 2 && totalDemandHigh >= 5;

  return (
    <div className={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ flex: 1, marginRight: 16 }}>
          <label className={styles.fieldLabel}>Use case name</label>
          <input
            className={styles.input}
            placeholder="e.g. Coding assistant, Customer chatbot, Audit document review…"
            value={uc.name}
            onChange={e => set({ name: e.target.value })}
          />
        </div>
        <button type="button" className={styles.btnDanger} style={{ marginTop: 22 }} onClick={() => removeUseCase(uc.id)}>Remove</button>
      </div>

      <div className={styles.fieldWrap}>
        <label className={styles.fieldLabel}>Served by (model sized in Step 2)</label>
        <select
          className={styles.select}
          value={uc.sizedModelId ?? ''}
          onChange={e => set({ sizedModelId: e.target.value || null })}
        >
          <option value="">— Select a sized model —</option>
          {modelOptions.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          <option value={EXTERNAL_MODEL_SENTINEL}>External model (not sized in this wizard)</option>
        </select>
        {modelOptions.length === 0 && (
          <div className={styles.alertAmber}>
            No sized models yet. Go to <strong>Step 2 (Model sizing)</strong>, run a Recommend Sizing analysis for
            each model you plan to deploy, and click &quot;Add to sizing wizard&quot;. Or pick{' '}
            <strong>&quot;External model&quot;</strong> above if this use case is intentionally served by a model
            outside this wizard.
          </div>
        )}
        {isUnmapped && (
          <div className={styles.alertAmber}>
            This use case isn&apos;t mapped to a model yet, so it <strong>won&apos;t be counted</strong> in the GPU
            sizing below or in the generated Excel. Pick a sized model above, or choose{' '}
            <strong>&quot;External model&quot;</strong> if that&apos;s intentional.
          </div>
        )}
        {isExternal && (
          <div style={{ fontSize: 12, color: '#54585c', marginTop: 6 }}>
            Marked as served by a model outside this wizard — intentionally excluded from GPU sizing. Demand
            fields below are kept for your own notes/record only.
          </div>
        )}
        {selectedModel && (
          <div className={capacityLooksLow ? styles.alertAmber : undefined} style={capacityLooksLow ? undefined : { fontSize: 12, color: '#54585c', marginTop: 6 }}>
            This model&apos;s captured capacity: <strong>{cap ?? 1} concurrent request{(cap ?? 1) === 1 ? '' : 's'}/replica</strong>{' '}
            (from Step 2&apos;s &quot;Target concurrency&quot;). Replicas needed ≈ your users-in-flight ÷ this number.
            {capacityLooksLow && (
              <> This looks low next to the {uc.concurrentUsersHigh} users you&apos;ve entered below — if one replica
                can realistically serve more than {cap} request(s) at once, go back to Step 2 and raise Target
                concurrency for this model instead of letting the wizard infer a huge replica count.</>
            )}
          </div>
        )}
      </div>

      <div className={styles.grid4}>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel}>Concurrent users — Low</label>
          <input type="number" min={0} className={styles.input} value={uc.concurrentUsersLow}
            onChange={e => set({ concurrentUsersLow: parseInt(e.target.value, 10) || 0 })} />
        </div>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel}>Concurrent users — High</label>
          <input type="number" min={0} className={styles.input} value={uc.concurrentUsersHigh}
            onChange={e => set({ concurrentUsersHigh: parseInt(e.target.value, 10) || 0 })} />
        </div>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel}>Share with request in flight</label>
          <input type="number" min={0} max={1} step={0.05} className={styles.input} value={uc.shareInFlight}
            onChange={e => set({ shareInFlight: parseFloat(e.target.value) || 0 })} />
        </div>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel}>Prefix cache hit rate</label>
          <input type="number" min={0} max={1} step={0.05} className={styles.input} value={uc.prefixCacheHitRate}
            onChange={e => set({ prefixCacheHitRate: parseFloat(e.target.value) || 0 })} />
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#54585c', background: '#f5f5f5', borderRadius: 4, padding: '8px 10px', marginBottom: 16 }}>
        <strong>Stress methodology:</strong> Stress assumes every High-estimate user has a request in flight at
        once (ignores Share in flight — that factor is used only for the Low/High scenarios). This keeps Stress
        a true worst case, visible as a distinct formula in the generated Excel&apos;s Workload Sizing sheet.
      </div>

      <div className={styles.grid4}>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel}>Input tokens / request</label>
          <input type="number" min={1} className={styles.input} value={uc.inputTokens}
            onChange={e => set({ inputTokens: parseInt(e.target.value, 10) || 1 })} />
        </div>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel}>Output tokens / request</label>
          <input type="number" min={1} className={styles.input} value={uc.outputTokens}
            onChange={e => set({ outputTokens: parseInt(e.target.value, 10) || 1 })} />
        </div>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel}>TTFT target (s)</label>
          <input type="number" min={0.1} step={0.1} className={styles.input} value={uc.ttftTargetS}
            onChange={e => set({ ttftTargetS: parseFloat(e.target.value) || 0.1 })} />
        </div>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel}>Output tokens/s target</label>
          <input type="number" min={0} className={styles.input} value={uc.tokensPerSecondTarget}
            onChange={e => set({ tokensPerSecondTarget: parseFloat(e.target.value) || 0 })} />
        </div>
      </div>

      <div className={styles.grid2}>
        <div className={styles.checkRow}>
          <input type="checkbox" id={`guard-${uc.id}`} checked={uc.screenedByGuard}
            onChange={e => set({ screenedByGuard: e.target.checked })} />
          <label htmlFor={`guard-${uc.id}`}>Screened by a guard/safety model</label>
        </div>
        {uc.screenedByGuard && (
          <div className={styles.fieldWrap}>
            <label className={styles.fieldLabel}>Guard calls per request</label>
            <input type="number" min={1} className={styles.input} value={uc.guardCallsPerRequest}
              onChange={e => set({ guardCallsPerRequest: parseInt(e.target.value, 10) || 1 })} />
          </div>
        )}
      </div>

      <div className={styles.fieldWrap}>
        <label className={styles.fieldLabel}>Notes (basis / assumptions)</label>
        <textarea className={styles.textarea} value={uc.notes} onChange={e => set({ notes: e.target.value })}
          placeholder="e.g. 40-50 concurrent devs, 90% prefix reuse because agentic coding resends repo context" />
      </div>
    </div>
  );
}

export default function Step3Page() {
  const { state, addUseCase } = useWizard();
  const modelOptions = state.sizedModels.map(m => ({
    id: m.id,
    label: `${m.model} · ${m.gpu} · ${m.replicasNeeded} replica(s) · ${m.gpusNeeded} GPUs`,
  }));

  return (
    <PageSection padding={{ default: 'noPadding' }} style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <div className={styles.page}>
        <WizardStepHeader
          currentKey="step3"
          title="Use case mapping"
          subtitle="Describe each use case in your own words and set its demand parameters — no predefined categories."
          prevHref="/recommend"
          nextHref="/wizard/step4"
          nextLabel="Continue to platform sizing →"
        />

        {state.sizedModels.length === 0 && (
          <div className={styles.card}>
            <div className={styles.emptyState}>
              You haven&apos;t sized any models yet. Go to <strong>Step 2 (Model sizing)</strong> first, run
              Recommend Sizing for each model, then come back here to map them to use cases.
            </div>
          </div>
        )}

        {state.useCases.map(uc => (
          <UseCaseCard key={uc.id} uc={uc} modelOptions={modelOptions} />
        ))}

        <div className={styles.btnRow}>
          <button type="button" className={styles.btnPrimary} onClick={addUseCase}>+ Add use case</button>
        </div>
      </div>
    </PageSection>
  );
}
