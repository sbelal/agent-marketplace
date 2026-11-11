---
name: kc-drift
description: Run the Semantic Contradiction & Codebase Drift Detection Engine across Workspace, Private, and Team memory layers to detect conflicting directives, missing referenced files, runtime engine mismatches, and staleness. Triggered by /kc-drift or requests like "check memory drift" or "detect contradictory rules".
user-invocable: true
---

# Skill: Semantic Contradiction & Drift Detection (`/kc-drift`)

This skill programmatically audits your active memory rules against each other and against your active repository filesystem to discover:
1. **Semantic Contradictions:** Pairs of memories firing on identical triggers or domains with conflicting or opposing directives without explicit `overrides:`.
2. **Codebase Drift:** Memories prescribing rules for deleted configuration files, obsolete runtime engines, dangling overrides, or stale verification timestamps (>180 days).

---

## Workflow

### 1. Execute Drift & Contradiction Audit (`detect_contradictions_and_drift`)
Call the MCP tool **`detect_contradictions_and_drift()`**:
- Optionally pass `domain` (e.g. `domain="kubernetes"`) to scope the analysis.
- Computes multi-vector semantic intent similarities between pairs of memory entries.
- Evaluates polarity opposition (mandatory vs prohibited directives, incompatible package managers, or conflicting frameworks).
- Scans `package.json` engines and referenced configuration files in the workspace.

### 2. Present Findings to Developer
Format the audit results clearly:

```markdown
### 🔍 Memory Contradiction & Codebase Drift Audit Report

**Status:** `DRIFT_DETECTED` (Found 1 contradiction, 2 codebase drifts across 8 memories)

#### ⚠️ Semantic Contradictions
| Severity | Memory A | Layer A | Memory B | Layer B | Conflict Details | Remediation |
| :---: | :--- | :---: | :--- | :---: | :--- | :--- |
| `HIGH` | `pnpm-workspace-governance` | `workspace` | `npm-package-conventions` | `team` | Opposing toolchain recommendations: mandates 'pnpm' vs 'npm' | Declare `overrides: npm-package-conventions` in workspace memory |

#### 📉 Codebase Drifts
| Severity | Target Slug | Layer | Drift Type | Detail | Remediation |
| :---: | :--- | :---: | :--- | :--- | :--- |
| `HIGH` | `node-version-standards` | `workspace` | `runtime_engine_drift` | Stated Node 18, but package.json enforces '>=26.0.0' | Update memory to target current Node requirement |
| `MEDIUM` | `eslint-formatting-rules` | `workspace` | `referenced_file_missing` | References `.eslintrc.json` which does not exist | Migrate to Biome/modern linter rule or delete obsolete entry |
```

### 3. Guide Remediation
Offer to resolve the detected issues interactively:
- **For Contradictions:** Ask whether the higher-tier memory should override the lower-tier memory (via `overrides:` frontmatter), or if both should be merged using `/kc-consolidate`.
- **For Drifts:** Update or deprecate obsolete memories using `save_memory_entry` or `delete_memory_entry`.
