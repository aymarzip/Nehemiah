## Problem and approach

<!-- Explain the user/operational problem, the invariant, and the smallest justified change. -->

## Validation

- [ ] `pnpm validate`
- [ ] Clean PostgreSQL migration and second idempotent run when persistence is affected
- [ ] Container build when runtime/dependencies/container files are affected
- [ ] Documentation and `.env.example` match the implementation
- [ ] No secrets, private payloads, or personal data are present
- [ ] External content remains untrusted and authorization is deterministic

## Compatibility and operations

<!-- Describe migration, rollback, deployment, security, observability, and known limitations. -->
