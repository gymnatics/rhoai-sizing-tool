'use client';

import { PageSection } from '@patternfly/react-core';
import { Settings } from './Settings';

export default function Page() {
  return (
    <PageSection
      padding={{ default: 'noPadding' }}
      style={{
        backgroundColor: 'var(--gc-bg-2, #f5f5f5)',
        minHeight: '100vh',
      }}
    >
      <Settings />
    </PageSection>
  );
}
