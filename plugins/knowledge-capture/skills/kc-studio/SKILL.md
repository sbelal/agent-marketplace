---
name: kc-studio
description: Launch the interactive standalone Knowledge Capture Studio in your local browser with direct browser-to-disk auto-save persistence. Triggered by /kc-studio, /studio, or requests like "launch memory studio", "open memory studio", or "start studio".
user-invocable: true
---

# Skill: Knowledge Capture Studio (`/kc-studio`)

This skill launches the dedicated, interactive Knowledge Capture Studio web server, allowing developers to visually explore, connect, and modify memory nodes with direct 1-click browser-to-disk persistence.

## Workflow

### 1. Launch the Standalone Studio Server
Launch the standalone studio server using `run_command` with `IsDaemon: true`:
```bash
node ./plugins/knowledge-capture/bin/studio.js [--port 4242] [--no-open]
```

Default flags:
- `--port 4242`: Port to listen on (auto-increments if in use).
- `--host 127.0.0.1`: Binds to local loopback interface.
- `--no-open`: Prevents popping a browser window in automated / headless runs.

### 2. Direct Browser-to-Disk Capabilities
- **Direct 1-Click Save:** Modifying nodes in the Quick Edit Drawer or drawing edges in Connect Mode enables the **"💾 Save to Disk"** button. Clicking it fires a `POST /api/patch` request directly to the server, atomically updating `.md` files on disk via POSIX temp-and-rename and re-indexing SQLite FTS5 instantly.
- **D3 Force Physics:** Interactive graph canvas with draggable nodes, cluster pills, and staleness alerts.
- **Bidirectional Links:** Visual Connect Mode lets you link nodes as `related:` or `overrides:` directly on the canvas.

### 3. Surface Studio URL
Display the URL (e.g. `http://127.0.0.1:4242`) in chat for the developer to open in their browser or IDE preview.
