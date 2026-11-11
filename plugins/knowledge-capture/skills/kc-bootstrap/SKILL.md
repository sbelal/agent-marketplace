---
name: kc-bootstrap
description: Scan repository ADRs, CI/CD workflows, linters, Docker/Kubernetes configs, and contribution guidelines to discover and bootstrap initial Workspace-scoped persistent memories. Triggered by /kc-bootstrap or requests like "bootstrap memories" or "scan repo for conventions".
user-invocable: true
---

# Skill: Repository Knowledge Bootstrapping (`/kc-bootstrap`)

This skill accelerates institutional memory adoption on day one by automatically scanning an existing codebase for architecture records, CI/CD test gates, linter configurations, and contribution guidelines, proposing draft candidate memories for the **Workspace** layer (`.agents/rules/memory/*.md`).

---

## Workflow

### 1. Execute Codebase Scan (`bootstrap_workspace_memories`)
Call the MCP tool **`bootstrap_workspace_memories()`** to inspect the repository root for institutional facts:
- **Architecture Decision Records:** Scans `docs/adr/`, `adr/`, and `doc/adr/` for design boundaries, architectural context, and rationale.
- **CI/CD Workflows:** Inspects `.github/workflows/` and `.gitlab-ci.yml` for automated test suites, lint gates, and deployment policies.
- **Linters & Formatters:** Detects static analysis conventions from `.golangci.yml`, `ruff.toml`, `.eslintrc*`, and `biome.json`.
- **Containers & Packaging:** Extracts containerization standards from `Dockerfile` or `compose.yml`.
- **Contribution Governance:** Extracts onboarding and development conventions from `CONTRIBUTING.md` and `ARCHITECTURE.md`.

### 2. Cross-Check Against Active Memories
Call **`get_memory_summary(layer="workspace")`** to ensure no duplicate workspace memories are proposed for patterns already documented in `.agents/rules/memory/`.

### 3. Present Candidate Approval Table
Present the discovered candidates to the developer in chat:

```markdown
### 🚀 Discovered Repository Conventions for Workspace Bootstrapping

| Action | Target Slug | Domain | Type | Trigger Description | Source Artifact |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `BOOTSTRAP-CREATE` | `ci-pipeline-conventions` | `ci-cd` | `convention` | When running tests, opening PRs, or modifying automated workflows | `.github/workflows/` |
| `BOOTSTRAP-CREATE` | `adr-event-driven-architecture` | `architecture` | `convention` | When architectural decisions relating to Event-Driven Architecture apply | `docs/adr/0002-events.md` |
| `BOOTSTRAP-CREATE` | `go-linter-standards` | `go` | `convention` | When formatting or linting Go codebase files | `.golangci.yml` |
```

**Mandatory Halt:** Ask the developer:
> *"Which conventions would you like to bootstrap into your Workspace memory (`.agents/rules/memory/`)?"*
> Wait for explicit developer authorization (e.g., "save all", "approve 1 and 3", or specific slugs). **Never write memory files to disk without explicit user approval.**

### 4. Persist Approved Candidates via MCP Tool
Upon developer confirmation:
1. For each approved candidate, call:
   ```text
   save_memory_entry(
     layer="workspace",
     slug=cand.slug,
     title=cand.title,
     domain=cand.domain,
     type=cand.type,
     description=cand.description,
     why=cand.why,
     howToApply=cand.howToApply
   )
   ```
2. Confirm the number of bootstrapped memories created in `.agents/rules/memory/`.
3. Inform the developer that team members will automatically receive these workspace conventions once committed to git (`git add .agents/rules/memory && git commit -m "docs(memory): bootstrap workspace rules"`).
