---
name: kc-studio
description: Launch the interactive standalone Knowledge Capture Studio in your local browser with direct browser-to-disk auto-save persistence. Triggered by /kc-studio, /studio, or requests like "launch memory studio", "open memory studio", or "start studio".
user-invocable: true
---

# Skill: Knowledge Capture Studio (`/kc-studio`)

> **Plugin script location (`<plugin-root>`):** Bundled scripts live in this plugin's `bin/` directory. In Claude Code, `<plugin-root>` is `${CLAUDE_PLUGIN_ROOT}`. If that variable appears literally (unsubstituted, e.g. in Antigravity), `<plugin-root>` is the plugin directory itself: run the scripts as `./bin/...` from it. Always quote the path.

This skill launches the interactive Knowledge Capture Studio, allowing developers to visually explore, connect, and modify memory nodes with direct browser-to-disk auto-save persistence (`POST /api/patch`) or Generative UI widgets.

## Workflow

### 1. Launch via `render_visual_memory_studio` (Recommended)
Call the MCP tool **`render_visual_memory_studio`** (`mode: "auto"` by default):
- In **Antigravity**: Generates an interactive Generative UI artifact / inline `<agent-embed>` widget. Pass `mode: "browser"` if you also want the local HTTP persistence server started.
- In **Claude Code** (or CLI fallback): Launches the standalone HTTP server on `http://127.0.0.1:4242` with direct browser-to-disk saving via `POST /api/patch`.

### 2. Standalone CLI Fallback
If running outside MCP or launching manually from a terminal, start the server using `run_command` with `IsDaemon: true`:
```bash
node "<plugin-root>/bin/studio.js" --port 4242 --no-open
```

Default flags:
- `--port 4242`: Port to listen on (auto-increments if in use).
- `--host 127.0.0.1`: Binds to local loopback interface.
- `--workspace <path>`: Workspace root directory (defaults to current working directory).
- `--no-open`: Prevents popping a browser window in automated / headless runs.

### 3. Direct Browser-to-Disk Capabilities
- **Direct 1-Click Save:** Modifying nodes in the Quick Edit Drawer or drawing edges in Connect Mode enables the **"💾 Save to Disk"** button. Clicking it sends an authenticated `POST /api/patch` request (`X-Studio-Token`) to atomically update `.md` files via POSIX temp-and-rename and re-index SQLite FTS5.
- **D3 Force Physics:** Interactive graph canvas with draggable nodes, cluster pills, and staleness alerts.
- **Bidirectional Links:** Visual Connect Mode lets you link nodes as `related:` or `overrides:` directly on the canvas.

### 4. Surface Studio URL or Artifact
Display the server URL (e.g. `http://127.0.0.1:4242`) or artifact link in chat for the developer to open.
