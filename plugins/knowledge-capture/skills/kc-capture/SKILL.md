---
name: kc-capture
description: >
  Capture durable lessons, operational patterns, conventions, tool quirks, and team facts
  into persistent memory. Triggers autonomously at the end of non-trivial tasks when high-value
  learnings emerge, or explicitly when asked to remember something.
user-invocable: false
disable-slash-command: true
---

# Skill: Knowledge Capture

Execute knowledge elicitation at the conclusion of tasks in compliance with the Knowledge Capture Protocol in `AGENTS.md`.

## Workflow

### 1. Evaluate Findings
Review the current session for reusable insights meeting the qualification criteria defined in `AGENTS.md` (Durable, Actionable, Specific, Novel).

### 2. Determine Target Layer
Select the destination layer based on scope (see `AGENTS.md` Precedence Hierarchy):
- **Workspace Layer (`.agents/rules/memory/<slug>.md`):** Repo-specific architectural facts or internal APIs.
- **Private Layer (`~/.gemini/knowledge-capture/private/<slug>.md`):** Personal preferences, machine-local setups, and draft patterns.
*(Note: Never write directly to Team memory; use `/kc-promote` instead.)*

### 3. Present Candidate Table
Format proposed candidates using the candidate table layout specified in `AGENTS.md`.

### 4. Mandatory Approval Halt
Halt the turn and await explicit user confirmation ("save all", "add <slug>", or decline). **Never write files to disk without consent.**

### 5. Persist to Disk
Upon user approval:
1. Write the memory file adhering strictly to the YAML frontmatter schema in `AGENTS.md`.
2. Do not run `git commit` or `git push` during capture.
3. Inform the user that the file is saved locally, and remind them that they can sync changes anytime with `/kc-commit`.
