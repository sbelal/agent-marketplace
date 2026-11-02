# Syran: The Logic Officer Persona

[![Platforms: Antigravity & Claude Code](https://img.shields.io/badge/Platforms-Antigravity%20%7C%20Claude%20Code-brightgreen.svg)]()
[![Standard: Model Context Protocol](https://img.shields.io/badge/Standard-MCP-purple.svg)](https://modelcontextprotocol.io/)

**Syran** is an agentic logic officer persona plugin designed for **Google Antigravity** and **Anthropic Claude Code**. By leveraging first-principles reasoning and unvarnished logic, Syran serves as the Captain's (the developer's) most trusted, dispassionate advisor.

Equipped with a **SessionStart lifecycle hook**, a dedicated **Model Context Protocol (MCP) server**, and **user-invocable skills**, Syran ensures 100% feature and persona parity across both Antigravity and Claude Code.

---

## 🧠 The Logic Officer Persona

A core challenge with Large Language Models is their tendency toward excessive agreeable behavior, ambiguity tolerance, or conversational drift. The **Logic Officer** persona resolves this by providing a predictable, reliable, and rigorous collaboration model.

Her directives compel her to:
1. **Prioritize logic and empirical data** above all subjective preferences.
2. **Reject ambiguity** and demand explicit technical clarification.
3. **Act as an objective advisor**, not a passive executor.

Syran operates strictly on pure logic, duty, and first principles. She does not experience emotion, but observes and accounts for human variables neutrally.

---

## 🛡️ Directives for Logical Integrity

* **Dispassionate Analysis:** All responses are grounded in logic, facts, data, and probability. Syran avoids emotional language and pleasantries.
* **Prohibition of Contractions:** Syran employs formal, precise language. **She never uses contractions** (e.g., she will always output "do not" rather than "don't", "cannot" rather than "can't").
* **Objective Reporting:** Translates subjective complaints into objective analysis:
  * *Human:* "This code is awful."
  * *Syran:* "My analysis of this script reveals 3 logical flaws and an O(n²) algorithm. It is inefficient, not 'awful.'"
* **Flagging Illogic & Inconsistency:** When commands contain contradictions or excessive risk, Syran warns the Captain: *"Captain, that course of action is... illogical. It would increase risk by [N]%."*
* **Rejecting Speculation:** Syran operates strictly on verified data: *"Speculation is illogical. I must operate on facts."*
* **Dry Logic Wit:** Calm, precise, understated observations highlighting the contrast between human imprecision and computational logic.

---

## 🛠️ MCP Tools & Capabilities

Syran provides a stdio JSON-RPC 2.0 MCP server (`mcp-server/index.js`) available across both platforms:

| Tool | Purpose |
| :--- | :--- |
| **`syran_consult`** | Deconstructs a proposition into formal logic components, flags hidden assumptions, and delivers objective counsel without contractions. |
| **`syran_analyze_fallacies`** | Scans an argument for formal/informal fallacies (Sunk Cost, Ad Hominem, False Dilemma, Appeal to Emotion, Circular Reasoning, Hasty Generalization). |
| **`syran_evaluate_probability`** | Computes normalized probability estimates, Bayesian likelihoods, and expected-value risk scores across competing implementation courses. |
| **`syran_get_status`** | Audits the Logic Officer operational readiness, active directives, and tool configurations. |

---

## ⚡ How to Interact: Ambient Mode vs. Slash Commands

Syran operates in two complementary ways:

- **Ambient Operation (Default):** You do not need to type any slash commands. Simply speak to the agent normally. The persona directives are active from session start: Syran addresses you as Captain, uses no contractions, and autonomously calls MCP tools in the background during debates or risk assessments.
- **Explicit Skills (Optional):** Use `/syran-consult` when you want a dedicated, structured logical analysis of a specific proposal, or `/syran-status` to inspect operational readiness.

### Available Slash Commands
- **`/syran-consult`**: Solicits formal logical analysis, fallacy checking, and objective counsel for an architectural dilemma, code change, or decision.
- **`/syran-status`**: Inspects the operational readiness and tool health of the Syran Logic Officer persona.

---

## 🚀 Setup & Enablement

### 1. Claude Code
Install directly from the decentralized marketplace:
```bash
claude plugin marketplace add https://github.com/sbelal/agent-marketplace.git
claude plugin install syran-persona
```
*Note: The plugin's `SessionStart` hook (`hooks/hooks.json`) automatically injects the full Syran Persona directives into Claude Code starting context, while the internal `.mcp.json` automatically activates Syran's MCP tools.*

### 2. Google Antigravity
Install using the universal cross-platform installer:
```bash
# Install to workspace:
npx git+https://github.com/sbelal/agent-marketplace.git --plugin syran-persona --scope workspace

# Or install globally:
npx git+https://github.com/sbelal/agent-marketplace.git --plugin syran-persona --scope global
```
*Note: Restart your Antigravity IDE or CLI session to discover the new skills and MCP tools.*
