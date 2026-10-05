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
  const { setWizardMode } = useWizard();

  const choose = (card: ModeCard) => {
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {CARDS.map(card => (
            <div
              key={card.mode}
              className={styles.card}
              role="button"
              tabIndex={0}
              onClick={() => choose(card)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(card); } }}
              style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', minHeight: 320, transition: 'box-shadow 0.15s, border-color 0.15s' }}
            >
              <div className={styles.cardTitle} style={{ fontSize: 20 }}>{card.title}</div>
              <p style={{ fontSize: 14, color: '#3c3f42', lineHeight: 1.6, marginTop: 8 }}>{card.description}</p>
              <ul style={{ margin: '12px 0 0', paddingLeft: 18, fontSize: 13.5, color: '#54585c', lineHeight: 1.8, flexGrow: 1 }}>
                {card.bullets.map(b => <li key={b}>{b}</li>)}
              </ul>
              <button type="button" className={styles.btnPrimary} style={{ marginTop: 20, alignSelf: 'flex-start' }}>
                {card.cta}
              </button>
            </div>
          ))}
        </div>
      </div>
    </PageSection>
  );
}
