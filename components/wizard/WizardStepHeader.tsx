'use client';

import * as React from 'react';
import Link from 'next/link';
import { ProgressStepper, ProgressStep, Tooltip } from '@patternfly/react-core';
import { Button } from '@patternfly/react-core';

export interface WizardStepDef {
  key: string;
  label: string;
  href: string;
}

export const WIZARD_STEPS: WizardStepDef[] = [
  { key: 'step1', label: 'Customer & hardware', href: '/wizard/step1' },
  { key: 'step2', label: 'Model sizing', href: '/recommend' },
  { key: 'step3', label: 'Use case mapping', href: '/wizard/step3' },
  { key: 'step4', label: 'Platform sizing', href: '/wizard/step4' },
  { key: 'step5', label: 'Review & generate', href: '/wizard/step5' },
];

interface Props {
  currentKey: string;
  title: string;
  subtitle: string;
  prevHref?: string;
  nextHref?: string;
  nextLabel?: string;
  /** When true, the "next" button renders disabled with nextDisabledReason as a tooltip
   * instead of linking to nextHref — e.g. "Add a model first." on Step 2. */
  nextDisabled?: boolean;
  nextDisabledReason?: string;
}

export function WizardStepHeader({
  currentKey, title, subtitle, prevHref, nextHref, nextLabel, nextDisabled, nextDisabledReason,
}: Props) {
  const currentIndex = WIZARD_STEPS.findIndex(s => s.key === currentKey);

  return (
    <div style={{ marginBottom: 24 }}>
      <ProgressStepper aria-label="RHOAI sizing wizard steps" isCenterAligned={false}>
        {WIZARD_STEPS.map((s, i) => (
          <ProgressStep
            key={s.key}
            variant={i < currentIndex ? 'success' : i === currentIndex ? 'info' : 'pending'}
            isCurrent={i === currentIndex}
            id={`step-${s.key}`}
            titleId={`step-${s.key}-title`}
            aria-label={`${s.label} ${i < currentIndex ? 'completed' : i === currentIndex ? 'current step' : 'not started'}`}
          >
            <Link href={s.href} style={{ color: 'inherit', textDecoration: 'none' }}>{s.label}</Link>
          </ProgressStep>
        ))}
      </ProgressStepper>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em', margin: '0 0 4px' }}>
            {title}
          </h1>
          <p style={{ fontSize: 15, color: '#3c3f42', margin: 0 }}>{subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {prevHref && (
            <Link href={prevHref}><Button variant="secondary">Back</Button></Link>
          )}
          {nextHref && nextDisabled && (
            <Tooltip content={nextDisabledReason ?? 'Complete this step first.'}>
              <span>
                <Button variant="primary" isAriaDisabled>{nextLabel ?? 'Continue'}</Button>
              </span>
            </Tooltip>
          )}
          {nextHref && !nextDisabled && (
            <Link href={nextHref}><Button variant="primary">{nextLabel ?? 'Continue'}</Button></Link>
          )}
        </div>
      </div>
    </div>
  );
}
