---
name: kc-promote
description: Promote verified personal memories to the shared Team Global layer via an isolated promotion branch and GitHub Pull Request. Triggered by /kc-promote.
user-invocable: true
---

# Promote Memory to Team (`/kc-promote`)

> **Plugin script location (`<plugin-root>`):** Bundled scripts live in this plugin's `bin/` directory. In Claude Code, `<plugin-root>` is `${CLAUDE_PLUGIN_ROOT}` (Claude Code substitutes the absolute install path). If that variable appears literally (unsubstituted, e.g. in Antigravity), `<plugin-root>` is the plugin directory itself: run the scripts as `./bin/...` from it. Always quote the path.

This skill promotes personal memories from Private storage (`get_layer_statistics().paths.privateDir`) into an active Team repository (`manage_team_repositories({ action: 'list' })` -> `<team-repo-dir>`).

> [!IMPORTANT]
> This skill creates an isolated promotion branch in the target team repository clone, rewrites memory files to strip personal identifiers, and presents the diff to the user. It **NEVER** commits, pushes, or opens a pull request without explicit user authorization.

## Workflow

### 1. Select Candidate & Retrieve Private Memory
Identify the memory file to promote (and optional target `teamSlug` via `manage_team_repositories({ action: 'list' })` when multiple active team repos exist):
- If specified by command argument (`/kc-promote <slug>`), call **`get_memory_content(layer="private", slug="<slug>")`**.
- Otherwise, call **`get_memory_summary(layer="private")`** and ask the developer which entry to promote.

Confirm before proceeding:
- Is this guideline broadly applicable to the entire team, not just machine-local?
- Has it been verified against production reality?

### 2. Semantic Transformation & Sanitization (Agent LLM)
Transform the raw private memory into an organization-wide standard:
1. **PII & Secrets Scrubbing:** Remove personal usernames, coworker names, email addresses, internal IP/hostnames, credentials, and ticket/incident numbers.
2. **Generalization:** Convert machine-specific paths (e.g., `/Users/dan/...`, `/home/sbelal/...`, `C:\Users\...`) into universal conventions (e.g., `~`, `<project-root>`, `<config-dir>`).
3. **Voice Neutralization:** Rewrite first-person phrasing ("I fixed", "on my machine") into neutral, imperative third-person engineering tone ("When configuring...", "Ensure that...").
4. **Trigger Optimization:** Refine the `description:` frontmatter trigger condition so teammates' agents will easily recall it during relevant tasks.
5. **Strip `overrides:`:** Remove the `overrides:` field (team-tier rules establish baseline standards).

### 3. Developer Preview & Confirmation
Present the proposed sanitized memory (frontmatter and body) to the developer in chat:
```markdown
### 📋 Proposed Team Guideline Sanitization
**Slug:** `<slug>`
**Domain:** `<domain>`
**Trigger:** `<updated-description>`

---
<sanitized-markdown-preview>
---
```
Ask for developer confirmation before staging to Git.

### 4. Stage to Isolated Promotion Branch (`prepare_team_promotion`)
Upon developer confirmation, invoke the MCP tool (passing `teamSlug` if selecting among multiple team repositories):
```json
prepare_team_promotion({
  "slug": "<slug>",
  "teamSlug": "<optional-team-slug>",
  "content": "<sanitized-markdown-body>",
  "frontmatter": {
    "domain": "<domain>",
    "type": "<convention|platform-fact|tool-gotcha>",
    "description": "<refined-description>",
    "related": ["<related-slug-1>"]
  }
})
```
The MCP server deterministically:
- Resolves `<team-repo-dir>` (`<storage-dir>/team/<teamSlug>/`), checks out its default branch, and pulls latest changes.
- Creates an isolated Git branch: `promote/<date>-<slug>`.
- Atomically writes the sanitized file to `<stagedFile>` (`<team-repo-dir>/<slug>.md`).
- Returns `{ teamSlug, branch, stagedFile, prCommand }`.

### 5. Stop and Hand Over for Final Developer Inspection
Let `<team-repo-dir>` be `dirname(stagedFile)`. **Do not commit or push automatically.** Run:
```bash
git -C "<team-repo-dir>" status --short
```

Present an inspection hand-off block in chat:
```markdown
---
### 🚀 Team Memory Promotion Branch Ready for Inspection

* **Clone Path:** `<team-repo-dir>`
* **Branch:** `promote/<date>-<slug>`
* **Files:** `<slug>.md`

Inspect the diff yourself before anything leaves this machine:
```bash
git -C "<team-repo-dir>" status --short && git -C "<team-repo-dir>" diff
```

Nothing has been committed or pushed. When you are satisfied, confirm and I will execute:
```bash
git -C "<team-repo-dir>" add "<slug>.md"
git -C "<team-repo-dir>" commit -m "memory: promote <slug>"
git -C "<team-repo-dir>" push -u origin "<branch>"
# From <team-repo-dir>, run the returned prCommand (e.g. gh pr create ...)
```
---
```

**Halt the turn.** The user's manual review of the diff at that path is the critical security control preventing private information from leaking into organizational repositories.

### 6. Finalize Pull Request
If the user approves in a subsequent turn:
1. Stage, commit, and push the branch inside `<team-repo-dir>`.
2. Execute the returned `prCommand` inside `<team-repo-dir>` (`gh pr create ...`).
3. Provide the PR URL and remind the user to check out `main` (or the default branch) once the PR is merged:
   `git -C "<team-repo-dir>" checkout main && node "<plugin-root>/bin/pull.js"`
