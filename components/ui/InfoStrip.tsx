'use client'

import * as React from 'react'
import InfoCircleIcon from '@patternfly/react-icons/dist/esm/icons/info-circle-icon'
import styles from './InfoStrip.module.css'

interface InfoStripActionProps {
  onClick: () => void
  children: React.ReactNode
}

export function InfoStripAction({ onClick, children }: InfoStripActionProps) {
  return (
    <button type="button" className={styles.action} onClick={onClick}>
      {children}
    </button>
  )
}

interface InfoStripProps {
  children: React.ReactNode
  'data-tour'?: string
}

export function InfoStrip({ children, 'data-tour': dataTour }: InfoStripProps) {
  return (
    <div className={styles.strip} data-tour={dataTour}>
      <InfoCircleIcon className={styles.icon} />
      <span className={styles.content}>{children}</span>
    </div>
  )
}
