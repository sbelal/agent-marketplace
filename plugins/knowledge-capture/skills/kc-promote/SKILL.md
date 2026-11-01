---
name: kc-promote
description: Scan private memories, generalize team-relevant knowledge, and move or split files into the Team Global layer. Triggered by /kc-promote.
---

# Promote Memory to Team (`/kc-promote`)

This skill evaluates memories in `~/.gemini/knowledge-capture/private/`, generalizes them for organizational use, and transitions them into `~/.gemini/knowledge-capture/team/`.

## Workflow

1. **Scan Private Memory Layer:**
   Inspect all `.md` files in `~/.gemini/knowledge-capture/private/`.
   If empty: inform the user: *"No private memories are currently recorded."*

2. **Evaluate & Generalize Candidates:**
   Analyze each private memory for team relevance (architectural standards, library quirks, CI/CD procedures, code review patterns).
   For elected candidates:
   * **Strip Personal Context:** Remove machine-specific absolute paths (e.g., `C:\Users\<user>\...`), personal credentials, or local environment URLs.
   * **Generalize Guidance:** Ensure phrasing applies across team environments.
   * **Determine Operation (Move vs. Split):**
     * **Move:** If the memory consists solely of shared team knowledge. The file will be moved to `team/` and deleted from `private/`.
     * **Split:** If the memory contains personal developer notes intertwined with team principles. The team portion will be written to `team/<slug>.md`, while the personal portion is retained in `private/<slug>.md`.

3. **Present Promotion Plan to User:**
   Output an overview table of proposed promotions:
   ```markdown
   ### 🚀 Memory Promotion Candidates

   | Slug | Operation | Generalization Summary |
   | :--- | :---: | :--- |
   | `cqs-standard-naming` | **Move** | Replaces local repo references with universal naming rules |
   | `postgres-connection-pool` | **Split** | Moves pool sizing guidelines to Team; retains personal dev port in Private |
   ```
   Display the exact diff or proposed content for each file.

4. **Await User Authorization:**
   Prompt: *"Captain, do you approve executing these promotions (Move / Split) into the Team layer?"*
   Wait for explicit confirmation.

5. **Execute Filesystem & Git Operations:**
   Upon approval:
   * Write generalized files to `~/.gemini/knowledge-capture/team/<slug>.md`.
   * For **Move**: delete original file from `~/.gemini/knowledge-capture/private/<slug>.md`.
   * For **Split**: update `~/.gemini/knowledge-capture/private/<slug>.md` with the separated personal content.
   * If `team/` is a Git repository, stage changes: `git add <slug>.md`.

6. **Post-Promotion Notice:**
   Remind the user:
   > *Promotion complete. Run `/kc-commit` to record and push the corresponding removals/updates in your Private layer.*
