'use client';

import * as React from 'react';
import type { GpuGroup } from '@/lib/wizard/types';
import styles from './wizard.module.css';

const COMMON_GPUS = ['B300', 'B200', 'H200 NVL', 'H200 SXM', 'H100 NVL', 'H100 SXM', 'A100-80', 'A100-40', 'L40S', 'L4', 'MI300X'];

interface Props {
  groups: GpuGroup[];
  onChange: (groups: GpuGroup[]) => void;
  label: string;
}

export function GpuGroupEditor({ groups, onChange, label }: Props) {
  const addRow = () => {
    onChange([...groups, { id: `gpu_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, gpu: 'H200 NVL', count: 8, formFactor: '', servers: undefined }]);
  };
  const updateRow = (id: string, patch: Partial<GpuGroup>) => {
    onChange(groups.map(g => g.id === id ? { ...g, ...patch } : g));
  };
  const removeRow = (id: string) => {
    onChange(groups.filter(g => g.id !== id));
  };

  return (
    <div>
      <label className={styles.fieldLabel}>{label}</label>
      {groups.length > 0 && (
        <div className={styles.tableRow} style={{ gridTemplateColumns: '1.5fr 0.8fr 1.3fr 0.8fr auto' }}>
          <span className={styles.tableRowHead}>GPU</span>
          <span className={styles.tableRowHead}>Count</span>
          <span className={styles.tableRowHead}>Form factor (optional)</span>
          <span className={styles.tableRowHead}>Servers (optional)</span>
          <span />
        </div>
      )}
      {groups.map(g => (
        <div key={g.id} className={styles.tableRow} style={{ gridTemplateColumns: '1.5fr 0.8fr 1.3fr 0.8fr auto' }}>
          <input
            list="gpu-options"
            className={styles.input}
            value={g.gpu}
            onChange={e => updateRow(g.id, { gpu: e.target.value })}
          />
          <input
            type="number"
            className={styles.input}
            value={g.count}
            min={0}
            onChange={e => updateRow(g.id, { count: parseInt(e.target.value, 10) || 0 })}
          />
          <input
            className={styles.input}
            placeholder="optional, e.g. HGX SXM 8-GPU"
            value={g.formFactor ?? ''}
            onChange={e => updateRow(g.id, { formFactor: e.target.value })}
          />
          <input
            type="number"
            className={styles.input}
            placeholder="optional"
            value={g.servers ?? ''}
            min={0}
            onChange={e => updateRow(g.id, { servers: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })}
          />
          <button type="button" className={styles.btnDanger} onClick={() => removeRow(g.id)}>Remove</button>
        </div>
      ))}
      <datalist id="gpu-options">
        {COMMON_GPUS.map(g => <option key={g} value={g} />)}
      </datalist>
      {groups.length > 0 && (
        <div style={{ fontSize: 11, color: '#787878', margin: '4px 0 8px' }}>
          Form factor and servers are optional — if servers is left blank, node density is estimated from the GPU
          name (e.g. NVL/PCIe form factors assume 4/node, SXM-class assume 8/node).
        </div>
      )}
      <div className={styles.btnRow}>
        <button type="button" className={styles.btnSecondary} onClick={addRow}>+ Add GPU group</button>
      </div>
    </div>
  );
}
