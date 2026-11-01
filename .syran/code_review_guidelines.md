# Code Review Guidelines

## Priority Focus Areas

### 🔴 Critical (Must Address)
- Data loss or improper git overwrites in user memory repositories.
- Hardcoded absolute paths that do not expand cross-platform (`~` expansion on Windows vs Unix).
- Shell injection vulnerabilities in hook commands.
- CQS violations (e.g., query functions performing git pull or filesystem writes).

### 🟡 Important (Should Address)
- Missing unit or integration tests for MCP server tools and hook scripts.
- Unhandled missing directory/settings scenarios (graceful degradation).
- Missing docstrings and schema definitions.

### 🟢 Nice-to-Have (Suggestions)
- Clear logging and telemetry for memory sync status.
- Formatting refinements in table outputs.
