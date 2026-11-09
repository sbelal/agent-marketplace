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

### 3. Present the Interactive Setup Wizard in Chat
Present the developer with this structured, step-by-step options menu:

```markdown
### 🧠 Knowledge Capture Setup Wizard

I will guide you through configuring your persistent memory layers.

---

#### Step 1: Private Memory Layer (Personal Engineering Learnings)
Where should personal preferences, debugging solutions, and custom gotchas be stored?

1. **GitHub Private Repository (Recommended)**
   - Syncs your personal memories across all laptops and Antigravity remote agents.
   - Example URLs:
     - SSH: `git@github.com:<your-username>/my-knowledge-memory.git`
     - HTTPS: `https://github.com/<your-username>/my-knowledge-memory.git`
2. **Local Machine Only**
   - Keeps memories strictly in `~/.gemini/knowledge-capture/private/` without remote syncing.

---

#### Step 2: Team Memory Layer (Shared Standards & Conventions)
Do you have a shared team repository for company-wide engineering guidelines?

1. **Team Shared Git Repository**
   - Automatically fast-forwards verified team standards on startup and enables `/kc-promote` PRs.
   - Example URL: `git@github.com:<your-org>/shared-team-memory.git`
2. **Skip / Local-Only (Default)**
   - Keep team memory unconfigured for now.

---
👉 **Reply with your choice:**
- E.g., *"Option 1 for Private (`git@github.com:user/repo.git`) and Option 2 for Team"*, OR
- *"Local only for both"*
```

**Halt the turn and await the developer's reply.**

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
