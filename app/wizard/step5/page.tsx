'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PageSection } from '@patternfly/react-core';
import { useWizard } from '@/contexts/WizardContext';
import { WizardStepHeader } from '@/components/wizard/WizardStepHeader';
import { calculateSizing, type SizingResult } from '@/lib/wizard/sizingCalculator';
import { enabledComponentLabels } from '@/lib/wizard/sizingCalculator';
import styles from '@/components/wizard/wizard.module.css';

function StatCard({ label, value, unit }: { label: string; value: string | number; unit?: string }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}{unit && <span style={{ fontSize: 14, fontWeight: 500, marginLeft: 4 }}>{unit}</span>}</div>
    </div>
  );
}

export default function Step5Page() {
  const router = useRouter();
  const { state, reset } = useWizard();
  const llmOnly = state.wizardMode === 'llm-only';
  const [generating, setGenerating] = React.useState(false);
  const [genError, setGenError] = React.useState<string | null>(null);
  const [generated, setGenerated] = React.useState(false);

  const result: SizingResult = React.useMemo(
    () => calculateSizing(state.customer, state.sizedModels, state.useCases, state.platform),
    [state],
  );

  const componentLabels = enabledComponentLabels(state.platform);

  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
    try {
      // Payload is just the raw wizard state + a mode flag — the Excel service
      // computes everything itself via formulas now, so no precomputed
      // sizingResult is sent (see excel-service/generator.py).
      const res = await fetch('/api/generate-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wizardState: state, mode: llmOnly ? 'llm-only' : 'full' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Excel service returned HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = (state.customer.name || 'rhoai-sizing').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      a.download = `${safeName}-sizing.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setGenerated(true);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Failed to generate the Excel workbook.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <PageSection padding={{ default: 'noPadding' }} style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <div className={styles.page} style={{ maxWidth: 1400 }}>
        <WizardStepHeader
          currentKey="step5"
          title="Review & generate"
          subtitle={llmOnly
            ? 'GPU demand by model and the final Excel workbook.'
            : 'Headline numbers, checks, and the final Excel workbook.'}
          prevHref={llmOnly ? '/recommend' : '/wizard/step4'}
        />

        <div className={styles.card}>
          <div className={styles.cardTitle}>Headline numbers — {state.customer.name || 'Untitled customer'}</div>
          {!llmOnly && (
            <div className={styles.cardSubtitle}>{state.customer.project || 'No project name set'} · {state.customer.deploymentType} · OpenShift {state.customer.openshiftVersion}</div>
          )}
          <div className={styles.grid4}>
            {llmOnly ? (
              <>
                <StatCard label="Models sized" value={state.sizedModels.length} />
                <StatCard label="GPU types" value={result.gpuTypeTotals.length} />
                <StatCard label="Total GPUs (High)" value={result.gpuTypeTotals.reduce((s, g) => s + g.gpusRequired.high, 0)} />
                <StatCard label="Total GPUs (Stress)" value={result.gpuTypeTotals.reduce((s, g) => s + g.gpusRequired.stress, 0)} />
              </>
            ) : (
              <>
                <StatCard label="Total nodes (High)" value={result.totalNodes.high} />
                <StatCard label="CPU worker nodes" value={result.cpuWorkerNodes} />
                <StatCard label="Red Hat AI Enterprise subs (High)" value={result.redHatSubscriptionNodes.high} unit="nodes" />
                <StatCard label="Object storage" value={(result.storage.objectStorageGiB / 1024).toFixed(2)} unit="TiB" />
              </>
            )}
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>GPU demand by type</div>
          {result.gpuTypeTotals.length === 0 ? (
            <div className={styles.emptyState}>No sized models yet — go back to Step 2 and size at least one model.</div>
          ) : (
            <>
              <div className={styles.tableRow} style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr' }}>
                <span className={styles.tableRowHead}>GPU</span>
                <span className={styles.tableRowHead}>GPUs — Low</span>
                <span className={styles.tableRowHead}>GPUs — High</span>
                <span className={styles.tableRowHead}>GPUs — Stress</span>
                <span className={styles.tableRowHead}>Nodes (High)</span>
              </div>
              {result.gpuTypeTotals.map(g => (
                <div key={g.gpu} className={styles.tableRow} style={{ gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr' }}>
                  <strong>{g.gpu}</strong>
                  <span>{g.gpusRequired.low}</span>
                  <span>{g.gpusRequired.high}</span>
                  <span>{g.gpusRequired.stress}</span>
                  <span>{g.nodesRequired.high} ({g.gpusPerNode}/node)</span>
                </div>
              ))}
            </>
          )}
        </div>

        <div className={styles.card}>
          <div className={styles.cardTitle}>Model deployments{!llmOnly && ' and use cases'}</div>
          {!llmOnly && (
            <div className={styles.cardSubtitle}>
              Stress assumes every High-estimate user has a request in flight at once (ignores Share in flight,
              used only for Low/High) — see Step 3 for the full explanation.
            </div>
          )}
          {result.modelDemand.map(md => {
            const mappedUseCases = state.useCases.filter(u => u.sizedModelId === md.sizedModelId);
            return (
              <div key={md.sizedModelId} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--gc-border, #d2d2d2)' }}>
                <div style={{ fontWeight: 700 }}>{md.model} <span style={{ fontWeight: 400, color: '#54585c' }}>· {md.gpu} · {md.gpusPerReplica} GPU/replica</span></div>
                <div style={{ fontSize: 13, color: '#3c3f42', marginTop: 2 }}>
                  Replicas: Low {md.replicas.low} · High {md.replicas.high} · Stress {md.replicas.stress}
                  {' — '}GPUs: Low {md.gpus.low} · High {md.gpus.high} · Stress {md.gpus.stress}
                </div>
                {!llmOnly && mappedUseCases.length > 0 && (
                  <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 13 }}>
                    {mappedUseCases.map(uc => (
                      <li key={uc.id}>{uc.name || '(unnamed use case)'} — {uc.concurrentUsersLow}-{uc.concurrentUsersHigh} users, TTFT target {uc.ttftTargetS}s</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {!llmOnly && (
          <>
            <div className={styles.card}>
              <div className={styles.cardTitle}>Node tiers</div>
              <div className={styles.tableRow} style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr' }}>
                <span className={styles.tableRowHead}>Role</span>
                <span className={styles.tableRowHead}>Count</span>
                <span className={styles.tableRowHead}>vCPU/node</span>
                <span className={styles.tableRowHead}>RAM/node (GB)</span>
              </div>
              {result.nodeTiers.map((t, i) => (
                <div key={i} className={styles.tableRow} style={{ gridTemplateColumns: '1.5fr 1fr 1fr 1fr' }}>
                  <span>{t.role}</span>
                  <span>{t.count}</span>
                  <span>{t.vcpuPerNode || '—'}</span>
                  <span>{t.ramGBPerNode || '—'}</span>
                </div>
              ))}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Enabled RHOAI components</div>
              <div style={{ fontSize: 14 }}>{componentLabels.length > 0 ? componentLabels.join(', ') : 'None selected'}</div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Non-GPU platform overhead</div>
              <div className={styles.cardSubtitle}>
                Itemized CPU-worker demand from the controllers and operators your enabled components require —
                matches the reference workbook&apos;s &quot;Cluster Architecture&quot; non-GPU demand build-up table.
              </div>
              {result.platformOverheadLineItems.length === 0 ? (
                <div className={styles.emptyState}>No platform overhead line items apply to the current configuration.</div>
              ) : (
                <>
                  <div className={styles.tableRow} style={{ gridTemplateColumns: '3fr 1fr 1fr' }}>
                    <span className={styles.tableRowHead}>Component</span>
                    <span className={styles.tableRowHead}>vCPU</span>
                    <span className={styles.tableRowHead}>RAM (GiB)</span>
                  </div>
                  {result.platformOverheadLineItems.map((item, i) => (
                    <div key={i} className={styles.tableRow} style={{ gridTemplateColumns: '3fr 1fr 1fr' }}>
                      <span>{item.label}</span>
                      <span>{item.vcpu.toFixed(2)}</span>
                      <span>{item.ramGiB.toFixed(2)}</span>
                    </div>
                  ))}
                  <div className={styles.tableRow} style={{ gridTemplateColumns: '3fr 1fr 1fr', fontWeight: 700 }}>
                    <span>Subtotal (platform overhead only)</span>
                    <span>{result.platformOverheadLineItems.reduce((s, i) => s + i.vcpu, 0).toFixed(2)}</span>
                    <span>{result.platformOverheadLineItems.reduce((s, i) => s + i.ramGiB, 0).toFixed(2)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#54585c', marginTop: 8 }}>
                    Total CPU worker demand ({result.cpuWorkerVcpuDemand.toFixed(1)} vCPU / {result.cpuWorkerRamGiBDemand.toFixed(1)} GiB)
                    also includes workbenches, training/eval jobs, vector DBs, and per-project instances configured on Step 4.
                  </div>
                </>
              )}
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Checks before you quote</div>
              {result.checks.map((c, i) => (
                <div key={i} className={c.status === 'OK' ? undefined : styles.alertAmber} style={c.status === 'OK' ? { padding: '6px 0', fontSize: 13 } : undefined}>
                  <span className={`${styles.badge} ${c.status === 'OK' ? styles.badgeGA : styles.badgeTP}`} style={{ marginRight: 8 }}>{c.status}</span>
                  <strong>{c.label}:</strong> {c.detail}
                </div>
              ))}
            </div>
          </>
        )}

        <div className={styles.card} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Generate the Excel workbook</div>
            <div style={{ fontSize: 13, color: '#54585c', marginTop: 2 }}>
              {llmOnly
                ? 'Produces a lightweight workbook: Disclaimer, Model Catalog, and GPU Performance only.'
                : 'Produces a full, formula-driven sizing workbook — open it in Excel to audit or tweak any assumption.'}
            </div>
          </div>
          <button type="button" className={styles.btnPrimary} onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate Excel workbook'}
          </button>
        </div>
        {genError && <div className={styles.alertRed}>{genError}</div>}

        {generated && (
          <div className={styles.card} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, borderColor: '#3d7317', background: '#f6fbf4' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#3d7317' }}>Workbook generated successfully</div>
              <div style={{ fontSize: 13, color: '#54585c', marginTop: 2 }}>
                Ready to start a new sizing for a different customer? This clears all current data.
              </div>
            </div>
            <button
              type="button"
              className={styles.btnSecondary}
              onClick={() => {
                if (window.confirm('Clear all current data (customer, models, use cases, platform) and start a new sizing?')) {
                  reset();
                  router.push('/wizard');
                }
              }}
            >
              Start new sizing
            </button>
          </div>
        )}
      </div>
    </PageSection>
  );
}
