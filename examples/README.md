# Examples

Fictional test fixtures — no real customer data. Safe to use for demos and testing.

- **`sample-customer-email.md`** — a made-up SE call-recap email (the kind of unstructured input you'd paste into the `rhoai-sizing-intake` Cursor agent skill).
- **`sample-sizing-intake.json`** — the structured output the skill would produce from that email. Validated against `.cursor/skills/rhoai-sizing-intake/schema.json`.
- **`acme-bank-sizing.xlsx`** — a **V1** workbook (static numbers, no formulas, 10 sheets). Kept as a historical "before" reference; this is the file whose real-world test run surfaced the three V2 gaps (missing itemized platform overhead, no formulas, no wizard entry point).
- **`meridian-trust-bank-sizing.xlsx`** — a **V2** workbook (formula-driven, 13 sheets incl. `Inputs`/`Reference`/`Models`). Deliberately includes two "gotchas" to demonstrate the Sizing Summary's checks:
  - Two of its three use cases aren't mapped to a sized model → triggers the "Use cases not mapped to a sized model" WARN check.
  - One mapped model has `maxConcurrentPerReplica = 1` (i.e. Step 2's "Target concurrency" was left at a low default) against high use-case demand → triggers the "replica count vs. captured per-replica concurrency" WARN check, which explains that "Target concurrency" sizes *one replica's* batch capacity, not total users (see the README's "Target concurrency vs. concurrent users" section).

  Regenerate it after generator changes with:
  ```bash
  cd excel-service && .venv/bin/python -c "
  from generator import generate_workbook
  # ...build a wizardState dict matching the scenario above, then:
  open('../examples/meridian-trust-bank-sizing.xlsx', 'wb').write(generate_workbook({'mode': 'full', 'wizardState': wizard_state}))
  "
  ```

## Try it

1. Start the wizard: `npm run dev`, open http://localhost:3000/wizard/step1
2. Under "Import from intake," click **"Choose sizing-intake.json…"**
3. Select `examples/sample-sizing-intake.json`
4. Confirm the customer profile, hardware, and use cases (Step 3) pre-filled correctly, and review the "verify with the customer" checklist that appears.
