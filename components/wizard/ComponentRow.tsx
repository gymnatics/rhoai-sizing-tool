'use client';

import * as React from 'react';
import {
  DscComponent, statusBadgeClass, lifecycleForComponent, conflictsForComponent,
  breakingChangesForComponent, roadmapForComponent,
} from '@/lib/wizard/componentData';
import styles from './wizard.module.css';

interface Props {
  component: DscComponent;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function ComponentRow({ component, enabled, onToggle }: Props) {
  const [expanded, setExpanded] = React.useState(false);
  const lifecycle = lifecycleForComponent(component.key);
  const conflicts = conflictsForComponent(component.key);
  const breaking = breakingChangesForComponent(component.key);
  const roadmap = roadmapForComponent(component.key);
  const hasDetail = lifecycle.length > 0 || conflicts.length > 0 || breaking.length > 0 || roadmap.length > 0 || component.notes;

  const badgeClass = statusBadgeClass(component.status);

  return (
    <div style={{ borderBottom: '1px solid var(--gc-border, #d2d2d2)', padding: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={e => onToggle(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 14 }}>{component.label}</strong>
            <span className={`${styles.badge} ${styles[`badge${badgeClass}`]}`}>{component.status}</span>
            {breaking.length > 0 && <span className={`${styles.badge} ${styles.badgeDeprecated}`}>3.6 breaking change</span>}
            {conflicts.length > 0 && <span className={`${styles.badge} ${styles.badgeTP}`}>source conflict</span>}
          </div>
          <div style={{ fontSize: 13, color: '#54585c', marginTop: 2 }}>{component.capability}</div>
        </div>
        {hasDetail && (
          <button type="button" className={styles.btnSecondary} style={{ padding: '4px 10px', fontSize: 12 }}
            onClick={() => setExpanded(e => !e)}>
            {expanded ? 'Hide detail' : 'Details'}
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 10, marginLeft: 30, fontSize: 13 }}>
          {component.database && (
            <div style={{ marginBottom: 6 }}><strong>Database:</strong> {component.database.type}{component.database.note ? ` — ${component.database.note}` : ''}</div>
          )}
          {component.prerequisites.length > 0 && (
            <div style={{ marginBottom: 6 }}><strong>Prerequisites:</strong> {component.prerequisites.join(', ')}</div>
          )}
          {component.llmdPrerequisites && (
            <div style={{ marginBottom: 6 }}><strong>Additional prerequisites for llm-d:</strong> {component.llmdPrerequisites.join(', ')}</div>
          )}
          {component.notes && <div style={{ marginBottom: 6, color: '#3c3f42' }}>{component.notes}</div>}

          {breaking.map(b => (
            <div key={b.id} className={styles.alertRed}>
              <strong>Planned breaking change ({b.targetVersion}):</strong> {b.whatChanges}
              <div style={{ marginTop: 4 }}><em>Migration action:</em> {b.migrationAction}</div>
            </div>
          ))}

          {conflicts.map(c => (
            <div key={c.id} className={styles.alertAmber}>
              <strong>Source conflict:</strong> {c.title}
              <div style={{ marginTop: 4 }}>{c.claimA.source}: &quot;{c.claimA.text}&quot;</div>
              <div>{c.claimB.source}: &quot;{c.claimB.text}&quot;</div>
              <div style={{ marginTop: 4 }}><em>Resolution:</em> {c.resolution}</div>
            </div>
          ))}

          {lifecycle.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Version history:</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {lifecycle.flatMap(f => f.history).map((h, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{h.version}</span>
                    {' '}<span className={`${styles.badge} ${styles[`badge${statusBadgeClass(h.status)}`] ?? ''}`}>{h.status}</span>
                    {' '}— {h.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {roadmap.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong>Planned (3.6+):</strong>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {roadmap.map((r, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.window}</span> — {r.title}: {r.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
