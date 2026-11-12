---
name: kc-graph
description: Generate an interactive visual knowledge graph artifact showing memory nodes, domain clusters, staleness health, and lateral link connections. Triggered by /kc-graph, /memory-graph, or requests like "show knowledge graph" or "visualize memories".
user-invocable: true
---

# Skill: Knowledge Graph Visualization (`/kc-graph`)

This skill generates a self-contained, interactive HTML visual canvas artifact allowing developers to explore their multi-tier persistent memory graph.

## Workflow

### 1. Fetch Graph Dataset & Generate Canvas
Call the MCP tool **`generate_knowledge_graph_html`** (or **`get_memory_graph`**) to produce the self-contained D3.js interactive canvas:
- `nodes`: List of memory nodes with `id`, `slug`, `layer`, `domain`, `type`, `stale` (boolean), `description`, and `applied_count`.
- `links`: Directed connections between nodes (`related` and `overrides`) with referential integrity guarantee.
- `summary`: Total node/link counts, broken link diagnostics, and active domains.

### 2. Output Interactive Canvas Artifact
Write the generated HTML to a standalone `.html` artifact in `<appDataDir>/brain/<conversation-id>/knowledge-graph.html` with `ArtifactMetadata` (`UserFacing: true`, `RequestFeedback: false`) featuring:
- **Client-Side Architecture:** The UI is 100% self-contained HTML/SVG/JavaScript executed entirely within the browser/webview alone. It requires zero HTTP server processes or daemons in the MCP server.
- **D3.js Force Simulation:** Interactive draggable nodes with collision detection and elastic edge links.
- **Visual Encoding:**
  - **Node Fill Color by Layer:** Workspace = `#a855f7` (Purple), Private = `#3b82f6` (Blue), Team = `#10b981` (Emerald).
  - **Node Size:** Proportional to `applied_count` (higher utility memories appear larger).
  - **Staleness Badge:** Red pulsing border on nodes where `stale: true` (>180 days or unverified).
  - **Edge Style:** Solid line for `overrides`, dashed line for `related`.
- **Interactive Controls & Memory Studio:**
  - **Connect Mode:** Toggle Connect Mode button to draw directed lateral edges (`related:` or `overrides:`) between memory nodes directly on the canvas.
  - **Quick Edit Inspector Drawer:** Clicking any node reveals its YAML metadata, trigger description, and 1-hop connections. Edit trigger conditions, switch domains, or click "Bump to Today" to refresh verification dates.
  - **Staged Patch Export:** Click "Export Patches" to copy or download all staged edge additions and metadata updates as a structured JSON patch payload.
  - **Search & Filter:** Live search bar highlighting matching nodes.
  - **Domain Filter Chips:** Clickable domain pills (Kubernetes, Terraform, Go, CI/CD) to isolate clusters.

### 3. Surface Graph Link in Chat
Display a summary card in chat with metrics (total nodes, active domains, stale alerts) and point the developer to the newly generated knowledge graph artifact.

### 4. Direct Browser Saving vs Staged Patch
- **Direct 1-Click Saving (`/kc-studio`):** To edit and save directly from your browser without copying patch JSONs, launch the standalone studio server via `/kc-studio` or `node ./plugins/knowledge-capture/bin/studio.js`.
- **Staged Patch Application (`apply_memory_patch`):** When viewing an offline HTML artifact or file, click "Export Patch" and pass the JSON payload to the MCP tool `apply_memory_patch(patch)`. The server atomically writes to disk and updates SQLite.
