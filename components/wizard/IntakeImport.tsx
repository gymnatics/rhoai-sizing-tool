'use client';

import * as React from 'react';
import type { SizingIntake } from '@/lib/wizard/types';
import { useWizard } from '@/contexts/WizardContext';
import styles from './wizard.module.css';

/** Loads a sizing-intake.json file produced by the rhoai-sizing-intake agent skill. */
export function IntakeImport() {
  const { importIntake } = useWizard();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [status, setStatus] = React.useState<'idle' | 'ok' | 'error'>('idle');
  const [message, setMessage] = React.useState('');
  const [confidence, setConfidence] = React.useState<SizingIntake['extraction_confidence'] | null>(null);

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as SizingIntake;
      if (!parsed.customer || !Array.isArray(parsed.use_cases)) {
        throw new Error('File does not match the sizing-intake.json schema (missing customer or use_cases).');
      }
      importIntake(parsed);
      setConfidence(parsed.extraction_confidence ?? null);
      setStatus('ok');
      setMessage(`Imported "${parsed.customer.name}" with ${parsed.use_cases.length} use case(s). Review and edit the fields below.`);
    } catch (err) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : 'Could not parse this file as sizing-intake.json.');
    }
  };

  return (
    <div className={styles.card} style={{ borderStyle: 'dashed' }}>
      <div className={styles.cardTitle}>Import from intake</div>
      <div className={styles.cardSubtitle}>
        Generated the <code>sizing-intake.json</code> file with the <code>rhoai-sizing-intake</code> Cursor
        agent skill from customer emails, meeting notes, or an RFP? Load it here to pre-fill this form.
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
      />
      <button type="button" className={styles.btnSecondary} onClick={() => fileRef.current?.click()}>
        Choose sizing-intake.json…
      </button>

      {status === 'ok' && (
        <div className={styles.alertAmber} style={{ background: '#e7f5e9', borderColor: '#9fd49f', color: '#245c24', marginTop: 12 }}>
          {message}
          {confidence?.missing_fields?.length ? (
            <>
              <div style={{ fontWeight: 700, marginTop: 8 }}>Verify with the customer before finalizing:</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {confidence.missing_fields.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </>
          ) : null}
        </div>
      )}
      {status === 'error' && (
        <div className={styles.alertRed} style={{ marginTop: 12 }}>{message}</div>
      )}
    </div>
  );
}
