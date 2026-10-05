'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PageSection } from '@patternfly/react-core';
import { useWizard } from '@/contexts/WizardContext';
import styles from '@/components/wizard/wizard.module.css';

interface ModeCard {
  mode: 'full' | 'llm-only';
  title: string;
  description: string;
  bullets: string[];
  cta: string;
  href: string;
}

const CARDS: ModeCard[] = [
  {
    mode: 'full',
    title: 'Full RHOAI platform sizing',
    description:
      'Size an entire OpenShift AI deployment: customer hardware, every model you plan to serve, ' +
      'use-case demand, platform components, storage, and subscriptions — exported as a complete, ' +
      'formula-driven Excel workbook.',
    bullets: [
      'Customer profile & GPU hardware inventory',
      'Model sizing (via ConfigIQ Recommend Sizing)',
      'Use case mapping with Low/High/Stress demand',
      'Platform components, storage & subscriptions',
    ],
    cta: 'Start full sizing →',
    href: '/wizard/step1',
  },
  {
    mode: 'llm-only',
    title: 'LLM sizing only',
    description:
      'Just need GPU sizing for one or more models — no platform overhead, storage, or subscriptions? ' +
      'Jump straight to model sizing and export a lightweight Model Catalog + GPU Performance workbook.',
    bullets: [
      'Skips customer hardware & platform steps',
      'Model sizing (via ConfigIQ Recommend Sizing)',
      'Simplified Excel: Disclaimer + Model Catalog + GPU Performance',
      'Fastest path to a GPU count',
    ],
    cta: 'Start LLM-only sizing →',
    href: '/recommend',
  },
];

export default function WizardLandingPage() {
  const router = useRouter();
  const { hydrated, state, setWizardMode, reset } = useWizard();

  const hasExistingData =
    state.sizedModels.length > 0 || state.useCases.length > 0 || !!state.customer.name;

  const choose = (card: ModeCard) => {
    setWizardMode(card.mode);
    router.push(card.href);
  };

  const startFresh = (card: ModeCard) => {
    reset();
    setWizardMode(card.mode);
    router.push(card.href);
  };

  return (
    <PageSection padding={{ default: 'noPadding' }} style={{ backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <div className={styles.page} style={{ maxWidth: 1100 }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 6px' }}>
            RHOAI Sizing Wizard
          </h1>
          <p style={{ fontSize: 15, color: '#3c3f42', margin: 0 }}>
            Choose how much of the deployment you need to size — you can always come back and do the rest later.
          </p>
        </div>

        {/* ─── Resume existing session ─── */}
        {hydrated && hasExistingData && (
          <div className={styles.card} style={{ borderColor: '#0066cc', background: '#f0f7ff', marginBottom: 24 }}>
            <div className={styles.cardTitle}>Continue previous sizing?</div>
            <div className={styles.cardSubtitle} style={{ marginBottom: 0 }}>
              You have an in-progress sizing
              {state.customer.name ? <> for <strong>{state.customer.name}</strong></> : null}
              {' '}with {state.sizedModels.length} model{state.sizedModels.length !== 1 ? 's' : ''}
              {state.useCases.length > 0 ? ` and ${state.useCases.length} use case${state.useCases.length !== 1 ? 's' : ''}` : ''}.
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button type="button" className={styles.btnPrimary} onClick={() => {
                const href = state.wizardMode === 'llm-only' ? '/recommend' : '/wizard/step1';
                setWizardMode(state.wizardMode ?? 'full');
                router.push(href);
              }}>
                Continue →
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => {
                if (window.confirm('This will clear all customer info, sized models, use cases, and platform settings. Continue?')) {
                  reset();
                }
              }}>
                Clear and start new
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {CARDS.map(card => (
            <div
              key={card.mode}
              className={styles.card}
              style={{ display: 'flex', flexDirection: 'column', minHeight: 320 }}
            >
              <div className={styles.cardTitle} style={{ fontSize: 20 }}>{card.title}</div>
              <p style={{ fontSize: 14, color: '#3c3f42', lineHeight: 1.6, marginTop: 8 }}>{card.description}</p>
              <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13.5, color: '#54585c', lineHeight: 1.8, flexGrow: 1 }}>
                {card.bullets.map(b => <li key={b}>{b}</li>)}
              </ul>
              <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
                {hasExistingData ? (
                  <button type="button" className={styles.btnPrimary} onClick={() => startFresh(card)}>
                    Start fresh →
                  </button>
                ) : (
                  <button type="button" className={styles.btnPrimary} onClick={() => choose(card)}>
                    {card.cta}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PageSection>
  );
}
