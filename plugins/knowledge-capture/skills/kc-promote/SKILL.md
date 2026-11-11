---
name: kc-promote
description: Promote verified personal memories to the shared Team Global layer via an isolated promotion branch and GitHub Pull Request. Triggered by /kc-promote.
user-invocable: true
---

# Promote Memory to Team (`/kc-promote`)

> **Plugin script location (`<plugin-root>`):** Bundled scripts live in this plugin's `bin/` directory. In Claude Code, `<plugin-root>` is `${CLAUDE_PLUGIN_ROOT}` (Claude Code substitutes the absolute install path). If that variable appears literally (unsubstituted, e.g. in Antigravity), `<plugin-root>` is the plugin directory itself: run the scripts as `./bin/...` from it. Always quote the path.

This skill promotes personal memories from `~/.gemini/knowledge-capture/private/` into `~/.gemini/knowledge-capture/team/`.

> [!IMPORTANT]
> This skill creates an isolated promotion branch in the team clone, rewrites memory files to strip personal identifiers, and presents the diff to the user. It **NEVER** commits, pushes, or opens a pull request without explicit user authorization.

## Workflow

### 1. Select Candidates
Identify the memory file to promote:
- If specified by command argument (`/kc-promote <slug>`), load `~/.gemini/knowledge-capture/private/<slug>.md`.
- Otherwise, call `get_memory_summary` with `layer: "private"` and ask the user which entry to promote.

Confirm before proceeding:
- Is this guideline broadly true for the entire team, not just machine-local?
- Has it been verified against production reality?
- Does the user want it published organization-wide?

### 2. Prepare the Team Clone
Inspect `~/.gemini/knowledge-capture/team/`:
- If `.git` is missing: alert user that team repository must be configured with a remote via `/kc-init`.
- Check out `main` and ensure the working copy is clean:
  ```bash
  git -C ~/.gemini/knowledge-capture/team checkout main
  git -C ~/.gemini/knowledge-capture/team pull --ff-only
  ```
- Create a dedicated promotion branch:
  ```bash
  git -C ~/.gemini/knowledge-capture/team checkout -b promote/$(date +%Y-%m-%d)-<slug>
  ```

### 3. Generalize & Scrub Memory File
Write `~/.gemini/knowledge-capture/team/<slug>.md` complying with the standardized schema in `AGENTS.md`.

**Mandatory Scrub List:**
- Remove personal usernames and machine-specific paths (e.g. `C:\Users\...`, `/home/...`).
- Remove ticket/incident numbers unless the memory is explicitly about that artefact.
- Strip the `overrides:` field.
- Rewrite first-person phrasing ("I", "my") in neutral, third-person engineering tone.
- If a team file with the same slug already exists, update its content, bump the `verified:` date, and retain history.

### 4. Stop and Hand Over for Developer Inspection
**Do not commit or push.** Run:
```bash
git -C ~/.gemini/knowledge-capture/team status --short
```

Present an inspection hand-off block in chat:
```markdown
---
### 🚀 Team Memory Promotion Branch Ready for Inspection

* **Clone Path:** `~/.gemini/knowledge-capture/team/`
* **Branch:** `promote/<date>-<slug>`
* **Files:** `<slug>.md`

Inspect the diff yourself before anything leaves this machine:
```bash
cd ~/.gemini/knowledge-capture/team && git status --short && git diff
```

Nothing has been committed or pushed. When you are satisfied, confirm and I will execute:
```bash
git -C ~/.gemini/knowledge-capture/team add <slug>.md
git -C ~/.gemini/knowledge-capture/team commit -m "memory: promote <slug>"
git -C ~/.gemini/knowledge-capture/team push -u origin <branch>
gh pr create --base main --head <branch> --fill
```
---
```

**Halt the turn.** The user's manual review of the diff at that path is the critical security control preventing private information from leaking into organizational repositories.

### 5. Finalize Pull Request
If the user approves in a subsequent turn:
1. Stage, commit, and push the branch.
2. Open the GitHub PR with `gh pr create`.
3. Provide the PR URL and remind the user to check out `main` once the PR is merged:
   `git -C ~/.gemini/knowledge-capture/team checkout main && node "<plugin-root>/bin/pull.js"`
