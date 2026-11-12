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

/**
 * Pure query: Audits current workspace git diffs and modified files to automatically detect
 * and propose session-end memory candidates before closing a session or compacting context.
 */
export function autoElicitSessionKnowledge(workspaceRoot = process.cwd()) {
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
  result.elicitation_needed = result.has_uncommitted_changes && (result.recent_memory_captures === 0);

  if (result.modified_files.length === 0) {
    result.session_summary = 'Clean working tree. No active modifications requiring knowledge capture.';
    return result;
  }

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

  result.session_summary = `Audited ${result.modified_files.length} modified file(s). Proposed ${result.suggested_candidates.length} memory candidate(s).`;
  return result;
}
