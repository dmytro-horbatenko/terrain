# <PROJECT> — Global Constraints & Project Facts (binding) — TEMPLATE

> Copy this to your session scratchpad (e.g. `_constraints.md`), fill it in from the plan's
> "Global Constraints" section + the project facts, and point every brief's `constraintsPath` at it.
> Both the implementer and the reviewer read this file; it is their shared attention lens.

You are implementing one task of **<PHASE/FEATURE>** in **<PROJECT>** at `<REPO_DIR>`.
<One or two sentences: what the project is, what's already complete, what this phase adds.>

## Hard constraints (the attention lens — copy exact values verbatim from the plan/spec)

- **Language/module system & import style:** <e.g. CommonJS Nest app; extensionless relative imports; workspace imports via @scope/*; hand-written files use double quotes — match, don't reformat>.
- **Datastore / ports / env:** <e.g. Postgres on host port 5433 (already up); .env has DATABASE_URL; use the pinned `yarn workspace … exec prisma …` binary — never npx/dlx (pulls an incompatible major)>.
- **Domain invariants:** <the binding rules with exact values — "store facts, derive the rest", state machines, formats, "X always present regardless of mode", etc.>.
- **Error/HTTP contract (if any):** <exact status codes and when each fires>.
- **Commit policy:** <e.g. work is left UNCOMMITTED in the working tree (user preference) — do NOT run git commit/add or any git mutation>.

## Reuse / existing surface

- <Shared helpers/modules the task should reuse instead of duplicating, with their exact signatures.>
- <Global providers / singletons available without re-importing.>

## Toolchain facts

- Unit tests (filtered): `<test command> <filter>`.
- Build: `<build command>` (must exit 0).
- Run the app for smoke tests: `<start command>` — background it, wait for boot via `curl --retry-connrefused --retry 40 --retry-delay 1` (NOT a foreground sleep), then **stop it properly** (know which process actually holds the port — the launcher's child often differs; kill via `lsof -ti:<port>` if a wrapper-name pkill misses it).

## TDD discipline (required)

Red→green: write the test first, run it and SEE it fail for the right reason, then implement, then SEE it pass. Report ACTUAL command output (counts) — never fabricate. YAGNI: nothing beyond the brief. Obey the commit policy above.
