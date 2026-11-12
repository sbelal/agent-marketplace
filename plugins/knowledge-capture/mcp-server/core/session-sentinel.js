import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { resolveStoragePaths } from './storage-paths.js';
import { searchMemoriesHybrid } from '../retrieval/hybrid-search.js';

/**
 * Zero-Turn Proactive Recall Probe.
 * Evaluates natural language input or working context against indexed memory triggers in < 5ms.
 */
export async function proactiveMemoryProbe(workspaceRoot = process.cwd(), queryOrContext = '', options = {}) {
  if (!queryOrContext || typeof queryOrContext !== 'string' || !queryOrContext.trim()) {
    return { triggered: false, count: 0, matches: [], advisoryMessage: '' };
  }

  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.55;
  const limit = options.limit || 3;
  const matches = await searchMemoriesHybrid(workspaceRoot, queryOrContext, {
    limit,
    mode: 'hybrid'
  });

  const highConfidence = matches.filter(m => (m.confidenceDecimal || m.confidence / 100) >= threshold);

  if (highConfidence.length === 0) {
    return { triggered: false, count: 0, matches: [], advisoryMessage: '' };
  }

  const bullets = highConfidence.map(m => {
    return `- **[${m.layer}] ${m.slug}** (${m.confidence}% match): ${m.description}`;
  });

  const advisoryMessage = `> [!NOTE]\n> 🧠 **Proactive Knowledge Advisory (${highConfidence.length} relevant convention(s) detected):**\n` +
    bullets.join('\n') +
    `\n> Recall full guidance anytime via \`get_memory_content(slug="...")\`.\n`;

  return {
    triggered: true,
    count: highConfidence.length,
    matches: highConfidence,
    advisoryMessage
  };
}

function toTextArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input.map(item => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') {
        return item.content || item.text || item.message || (item.systemMessage?.systemMessage) || JSON.stringify(item);
      }
      return String(item);
    }).filter(Boolean);
  }
  if (typeof input === 'string') return [input];
  if (typeof input === 'object') {
    return [input.content || input.text || input.message || (input.systemMessage?.systemMessage) || JSON.stringify(input)].filter(Boolean);
  }
  return [];
}

/**
 * Pure query: Audits current workspace git diffs, modified files, user feedback/preferences,
 * and trajectory debugging breakthrough signals to automatically detect and propose
 * session-end memory candidates before closing a session or compacting context.
 */
export function autoElicitSessionKnowledge(workspaceRoot = process.cwd(), options = {}) {
  const result = {
    workspace: workspaceRoot,
    has_uncommitted_changes: false,
    modified_files: [],
    recent_memory_captures: 0,
    elicitation_needed: false,
    suggested_candidates: [],
    session_summary: ''
  };

  const gitDir = path.join(workspaceRoot, '.git');
  if (fs.existsSync(gitDir)) {
    try {
      const statusOutput = execSync('git status --porcelain', {
        cwd: workspaceRoot,
        encoding: 'utf8',
        timeout: 3000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();

      if (statusOutput) {
        result.has_uncommitted_changes = true;
        const lines = statusOutput.split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 2) {
            result.modified_files.push({
              status: parts[0],
              file: parts.slice(1).join(' ')
            });
          }
        }
      }
    } catch {}
  }

  const paths = resolveStoragePaths(workspaceRoot);
  const now = Date.now();
  const threeHoursAgo = now - (3 * 3600 * 1000);

  const checkRecentFiles = (dir) => {
    let count = 0;
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (!f.endsWith('.md') || f.toUpperCase() === 'README.MD') continue;
          const stat = fs.statSync(path.join(dir, f));
          if (stat.mtimeMs >= threeHoursAgo) {
            count++;
          }
        }
      } catch {}
    }
    return count;
  };

  result.recent_memory_captures = checkRecentFiles(paths.workspaceDir) + checkRecentFiles(paths.privateDir);

  // 1. Audit Git code changes
  if (result.modified_files.length > 0) {
    const filePaths = result.modified_files.map(m => m.file);
    const hasDeps = filePaths.some(f => /package\.json|go\.mod|requirements\.txt|Cargo\.toml|pom\.xml|build\.gradle/i.test(f));
    const hasTests = filePaths.some(f => /test|spec|__tests__/i.test(f));
    const codeFiles = filePaths.filter(f => /\.(js|mjs|ts|go|py|rs|java|cpp|c|rb|php)$/i.test(f));

    if (hasDeps) {
      result.suggested_candidates.push({
        slug: 'session-dependency-updates',
        title: 'Dependency and Package Upgrades',
        domain: 'architecture',
        type: 'convention',
        layer: 'workspace',
        description: 'When updating project package dependencies or runtime toolchains',
        suggested_body: `# Dependency and Package Upgrades\n\n## Why It Matters\nDependencies were updated or modified during this session.\n\n## How to Apply\n- Verify all package locks are committed synchronously.\n- Confirm runtime test suite passes under target engine version.`
      });
    }

    if (hasTests) {
      result.suggested_candidates.push({
        slug: 'session-test-regression-rules',
        title: 'Test Verification and Regression Rules',
        domain: 'testing',
        type: 'tool-gotcha',
        layer: 'workspace',
        description: 'When running or writing test suites for recently modified modules',
        suggested_body: `# Test Verification and Regression Rules\n\n## Why It Matters\nNew test fixtures or assertions were established in this session.\n\n## How to Apply\n- Ensure tests run deterministically without background task hanging.\n- Maintain separation between mock environments and real storage.`
      });
    }

    if (codeFiles.length > 0 && result.suggested_candidates.length < 3) {
      const primaryFile = codeFiles[0];
      const moduleName = path.basename(primaryFile, path.extname(primaryFile));
      result.suggested_candidates.push({
        slug: `${moduleName}-session-patterns`,
        title: `${moduleName} Architecture & Implementation Decisions`,
        domain: 'architecture',
        type: 'convention',
        layer: 'workspace',
        description: `When modifying or extending the ${moduleName} module`,
        suggested_body: `# ${moduleName} Architecture & Implementation Decisions\n\n## Why It Matters\nCore architectural logic was updated in ${primaryFile}.\n\n## How to Apply\n- Maintain separation between core domain logic and platform adapters.\n- Verify cross-platform path resolution.`
      });
    }
  }

  // 2. Trajectory-Based User Feedback, Corrections & Preference / "Ways of Working" Elicitation
  const feedbackTexts = [
    ...toTextArray(options.userFeedback),
    ...toTextArray(options.feedback)
  ];

  if (Array.isArray(options.transcript)) {
    for (const item of options.transcript) {
      if (item && typeof item === 'object') {
        const isUser = item.role === 'user' || item.type === 'USER_INPUT' || item.source === 'USER_EXPLICIT';
        if (isUser && item.content) {
          feedbackTexts.push(typeof item.content === 'string' ? item.content : JSON.stringify(item.content));
        }
      }
    }
  } else if (typeof options.transcript === 'string') {
    feedbackTexts.push(options.transcript);
  }

  let userPrefSignals = 0;
  for (const text of feedbackTexts) {
    if (!text || typeof text !== 'string') continue;

    // Detect prose rewrite / verbosity / conclusion preference
    const isProseRewrite = /rewrite that prose|less verbose|be concise|more concise|too verbose|too wordy|conclusions? instead of detailed analysis|document(?:ing)? the conclusions|documenting conclusions|focus on conclusions|just the conclusions|conclusions first|brief prose|summary instead of analysis/i.test(text);
    if (isProseRewrite) {
      userPrefSignals++;
      if (!result.suggested_candidates.some(c => c.slug === 'user-preference-concise-conclusions')) {
        result.suggested_candidates.push({
          slug: 'user-preference-concise-conclusions',
          title: 'User Preference: Concise Conclusions Over Verbose Analysis',
          domain: 'workflow',
          type: 'convention',
          layer: 'private',
          description: 'When presenting solutions, architectural summaries, or prose explanations for the user',
          suggested_body: `# User Preference: Concise Conclusions Over Verbose Analysis\n\n## Preferred Way of Working\n- State conclusions, decisions, and outcomes upfront without lengthy narrative analysis.\n- The user prefers succinct conclusions rather than detailed step-by-step recitation.\n- Focus on actionable insights, key findings, and final recommendations.\n\n## Contrast / Anti-Pattern\n- Avoid verbose multi-paragraph analytical justifications when a direct conclusion or bulleted summary suffices.\n\n## How to Apply\n- Put key findings and conclusions first.\n- Reserve exhaustive technical deep dives or line-by-line analyses for when explicitly requested.`,
          elicited_from: 'user_feedback'
        });
      }
    }

    // Detect explicit "prefer X over Y" or "always/never do X" rules
    const preferMatch = text.match(/prefer\s+([^,.;\n]+?)\s+(?:over|instead of)\s+([^,.;\n]+)/i);
    if (preferMatch) {
      userPrefSignals++;
      const preferred = preferMatch[1].trim();
      const avoided = preferMatch[2].trim();
      const slug = `user-preference-${preferred.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}`.replace(/--+/g, '-').slice(0, 40);
      if (!result.suggested_candidates.some(c => c.slug === slug)) {
        result.suggested_candidates.push({
          slug,
          title: `User Preference: Prefer ${preferred} over ${avoided}`,
          domain: 'workflow',
          type: 'convention',
          layer: 'private',
          description: `When deciding between ${preferred} and ${avoided} in project implementation or workflows`,
          suggested_body: `# User Preference: Prefer ${preferred} over ${avoided}\n\n## Preferred Way of Working\n- Always adopt \`${preferred}\` as the standard approach.\n\n## Contrast / Anti-Pattern\n- Avoid using or proposing \`${avoided}\`.\n\n## How to Apply\n- Consistently follow this convention unless explicitly instructed otherwise.`,
          elicited_from: 'user_feedback'
        });
      }
    }
  }

  // 3. Trajectory-Based Zero-Code Debugging Capture
  const errorTexts = [
    ...toTextArray(options.errorLogs),
    ...toTextArray(options.recentCommands)
  ];

  if (Array.isArray(options.transcript)) {
    for (const item of options.transcript) {
      if (item && typeof item === 'object' && item.content) {
        const textContent = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
        const errorMatches = textContent.match(/(?:Error:|Exception:|failed with exit code \d+|ENOENT|ECONNREFUSED|TypeError:|AssertionError:)[^\n]+/gi);
        if (errorMatches) {
          errorTexts.push(...errorMatches.slice(0, 2));
        }
      }
    }
  } else if (typeof options.transcript === 'string') {
    const errorMatches = options.transcript.match(/(?:Error:|Exception:|failed with exit code \d+|ENOENT|ECONNREFUSED|TypeError:|AssertionError:)[^\n]+/gi);
    if (errorMatches) {
      errorTexts.push(...errorMatches.slice(0, 3));
    }
  }

  let debugSignals = 0;
  for (const errText of errorTexts) {
    if (!errText || typeof errText !== 'string') continue;
    const errorMatch = errText.match(/(?:Error:\s*|Exception:\s*|TypeError:\s*|AssertionError:\s*|^)([a-zA-Z0-9_\-\.\/]+(?:[:\s][^\n,]+)?)/i);
    if (errorMatch) {
      debugSignals++;
      const errSnippet = errorMatch[0].trim().slice(0, 60);
      const errSlugPart = errSnippet.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().replace(/--+/g, '-').slice(0, 30);
      const slug = `debug-gotcha-${errSlugPart || 'runtime-issue'}`;
      if (!result.suggested_candidates.some(c => c.slug === slug)) {
        result.suggested_candidates.push({
          slug,
          title: `Zero-Code Debugging: ${errSnippet}`,
          domain: 'testing',
          type: 'tool-gotcha',
          layer: 'workspace',
          description: `When troubleshooting ${errSnippet} in runtime commands or tests`,
          suggested_body: `# Zero-Code Debugging: ${errSnippet}\n\n## Symptoms & Root Cause\n- Runtime error encountered during session trajectory: \`${errSnippet}\`.\n- Root cause investigated and resolved through environment configuration or parameter alignment without application code changes.\n\n## Resolution / Workaround\n- Verify environment variables, test isolation, and required dependencies.\n- Ensure non-blocking execution and proper error handling.`,
          elicited_from: 'zero_code_debugging'
        });
      }
      break; // One debugging breakthrough candidate is sufficient per session
    }
  }

  const hasExplicitContext = Boolean(options.transcript || options.userFeedback || options.feedback || options.errorLogs || options.force);
  result.elicitation_needed = (result.has_uncommitted_changes || result.suggested_candidates.length > 0) && (hasExplicitContext || result.recent_memory_captures === 0);

  if (result.suggested_candidates.length > 0) {
    result.session_summary = `Audited session context. Identified ${result.modified_files.length} modified file(s), ${userPrefSignals} user preference signal(s), and ${debugSignals} debugging insight(s). Proposed ${result.suggested_candidates.length} memory candidate(s).`;
  } else if (result.modified_files.length === 0) {
    result.session_summary = 'Clean working tree and no elicitation signals detected.';
  } else {
    result.session_summary = `Audited ${result.modified_files.length} modified file(s). Proposed 0 memory candidate(s).`;
  }

  return result;
}
