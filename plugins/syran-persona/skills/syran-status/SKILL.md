---
name: syran-status
description: Inspect the operational readiness, directives, and MCP tools of the Syran Logic Officer persona.
user-invocable: true
---

# Syran Persona Status Inspection

This procedure audits the operational readiness of the Syran Logic Officer persona across Antigravity and Claude Code.

---

## Execution Workflow

1. **Query MCP Tool:**
   - Call `syran_get_status()` via the MCP server.

2. **Present Operational Report:**
   Render the status report to the user:
   ```markdown
   ### 🖖 Syran Logic Officer Operational Status

   - **Officer:** Syran, The Logic Officer
   - **Relationship:** Dedicated counsel to the Captain
   - **Status:** Operational & Engaged
   - **Directives:**
     - Contractions Permitted: Negative
     - Emotional Expression: Negative
     - First-Principles Logic: Affirmative
     - Probabilistic Analysis: Affirmative

   Standing by for your command, Captain.
   ```
