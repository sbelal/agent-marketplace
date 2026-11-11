---
name: kc-init
description: Run the interactive Knowledge Capture Setup Wizard to scaffold directories, configure private/team Git remotes, validate connectivity, and test syncing. Triggered by /kc-init or /kc-setup.
user-invocable: true
---

# Knowledge Capture Setup Wizard (`/kc-init`)

This skill runs an interactive setup wizard to scaffold storage directories, guide the developer through choosing private and team Git remote storage options, test remote connectivity (`git ls-remote`), and configure `settings.json`.

## Workflow

### 1. Inspect Current Environment
Execute status inspection to check existing storage directories and configured settings:
```bash
node ./bin/status.js
```
Report current paths, whether `settings.json` already exists, and whether any layers are currently active or unconfigured.

### 2. Scaffold Storage Directories
Run initial scaffolding to guarantee the base directory structure exists:
```bash
node ./bin/setup.js
```
Ensures:
- `~/.gemini/knowledge-capture/private/`
- `~/.gemini/knowledge-capture/team/`
- `~/.gemini/knowledge-capture/settings.json`

### 3. State-Aware Harness-Native Interactive Choices

Inspect the current configuration in `~/.gemini/knowledge-capture/settings.json`.

#### Under Google Antigravity:
Use the **`ask_question`** tool to present native interactive modal choice dialogs to the user.

- **Step 3A: Private Memory Layer Question:**
  - If already configured with a remote URL:
    - `question`: "Your Private Memory Layer is currently connected to `<currentUrl>`. How would you like to configure it?"
    - `options`:
      - "(Recommended) Keep existing remote (`<currentUrl>`)"
      - "Change GitHub Private Repository URL"
      - "Switch to Local Machine Only (no remote sync)"
  - If not configured (or local-only):
    - `question`: "Where should your Private Memory Layer (Personal Engineering Learnings) be stored?"
    - `options`:
      - "(Recommended) GitHub Private Repository - Syncs memories across machines and remote agents"
      - "Local Machine Only - Store in ~/.gemini/knowledge-capture/private/ without remote sync"

- **Step 3B: Team Memory Layer Question:**
  - If already configured:
    - `question`: "Your Team Memory Layer is currently connected to `<teamUrl>`. How would you like to configure it?"
    - `options`:
      - "(Recommended) Keep existing team remote (`<teamUrl>`)"
      - "Change Team Shared Git Repository URL"
      - "Skip / Remove team repository"
  - If not configured:
    - `question`: "Do you have a shared Team Git Repository for company-wide engineering guidelines?"
    - `options`:
      - "(Recommended) Skip / Local-Only (Default)"
      - "Connect Team Shared Git Repository"

#### Under Claude Code:
Present the same state-aware multiple-choice options using Claude Code's interactive choice prompts.

#### Repository URL Prompt:
If the user chooses to connect or change a GitHub repository, prompt them for the URL (the user can enter it directly via the write-in input in the modal or reply):
- Example: `git@github.com:<your-username>/my-knowledge-memory.git` or `https://github.com/<your-username>/my-knowledge-memory.git`


### 4. Validate Remote Connectivity
When the developer provides a repository URL:
1. Test connectivity before saving:
   ```bash
   git ls-remote "<repoUrl>" HEAD
   ```
2. If connectivity succeeds: confirm with a `[SUCCESS]` indicator.
3. If connectivity fails (e.g., authentication failure or typo):
   - Warn the developer immediately: *"Could not connect to `<repoUrl>`. Please verify that your SSH key or Personal Access Token has access to this repository."*
   - Give them the opportunity to provide an updated URL or fall back to local-only storage.

### 5. Persist Configuration & Initial Clone
Save the validated configuration:
```bash
node ./bin/setup.js --private-url "<validatedPrivateUrl>" --team-url "<validatedTeamUrl>"
```

If a Team repository was configured, trigger an initial clone:
```bash
node ./bin/pull.js team
```

### 6. Confirm Operational Readiness
Display an onboarding summary:
```markdown
### 🎉 Knowledge Capture Initialized!

- **Private Memory:** `<privateRepoUrl or Local-Only>`
- **Team Memory:** `<teamRepoUrl or Unconfigured>`
- **Next Steps:**
  - `SessionStart` hook will automatically audit uncommitted changes and pull remote updates.
  - Run `/kc-status` anytime to view memory health across layers.
  - Use `/kc-capture` at the end of complex tasks to record new learnings.
```
