# ADR: Keep GPU formulas isolated in AISimulators

**Date**: 2026-05-12
**Status**: Accepted

## Decision

GPU sizing and performance formulas live in AISimulators. React components never
contain sizing formulas directly; they call the service through the Next.js API
routes and `lib/api/` adapters.

## Reasons

- Formulas are testable without rendering components
- The same logic can be shared across multiple pages
- The web application and other clients can use one service implementation
- Prevents formula drift between pages

## Consequences

- Components call lib functions and render results — never compute inline
- New sizing formulas go to AISimulators, then are exposed through a typed
  `lib/api/` adapter when the frontend needs them
