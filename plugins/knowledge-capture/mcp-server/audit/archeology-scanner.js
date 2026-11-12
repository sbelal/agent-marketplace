import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scanLayerEntries } from '../retrieval/shadow-resolver.js';

const GIT_EXEC_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=3'
};

/**
 * Historical Tacit Knowledge Archeologist (/kc-archeology).
 * Scans git commit log for past bugs, hotfixes, reverts, and workarounds to extract tacit knowledge candidates.
 */
export function mineGitHistoryMemories(workspaceRoot = process.cwd(), options = {}) {
  const maxCommits = Math.max(1, Math.min(500, parseInt(options.maxCommits, 10) || 100));
  const gitDir = path.join(workspaceRoot, '.git');
  if (!fs.existsSync(gitDir)) {
    return {
      status: 'NOT_A_GIT_REPO',
      message: 'Workspace is not a Git repository.',
      candidates: []
    };
  }

  let logOutput = '';
  try {
    logOutput = execFileSync(
      'git',
      ['log', '-n', String(maxCommits), '--no-merges', '--format=COMMIT:%H|%an|%ad|%s%n%b%nEND_COMMIT', '--date=short'],
      { cwd: workspaceRoot, encoding: 'utf8', timeout: 5000, env: GIT_EXEC_ENV }
    );
  } catch (err) {
    return {
      status: 'GIT_ERROR',
      message: err.message,
      candidates: []
    };
  }

  const commitBlocks = logOutput.split(/^COMMIT:/m).filter(b => b.trim());
  const candidates = [];
  const seenSlugs = new Set();

  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  const existingSlugs = new Set(activeEntries.map(e => e.slug));

  const gotchaPatterns = [
    /\b(fix(?:ed|es)?|bug|hotfix|patch)\b/i,
    /\b(workaround|gotcha|caveat|quirk)\b/i,
    /\b(revert(?:ed|s)?|undo)\b/i,
    /\b(race condition|deadlock|memory leak|oom|timeout)\b/i,
    /\b(deprecat(?:ed|ion)|breaking change)\b/i
  ];

  for (const block of commitBlocks) {
    const lines = block.split(/\r?\n/);
    const header = lines[0] || '';
    const parts = header.split('|');
    if (parts.length < 4) continue;

    const hash = parts[0].trim();
    const author = parts[1].trim();
    const date = parts[2].trim();
    const subject = parts.slice(3).join('|').trim();
    const bodyLines = lines.slice(1).filter(l => l.trim() && l.trim() !== 'END_COMMIT');
    const fullMessage = `${subject}\n${bodyLines.join('\n')}`;

    const isMatch = gotchaPatterns.some(p => p.test(subject) || p.test(fullMessage));
    if (!isMatch) continue;

    let domain = 'general';
    const lowerMsg = fullMessage.toLowerCase();
    if (lowerMsg.includes('k8s') || lowerMsg.includes('kube') || lowerMsg.includes('pod') || lowerMsg.includes('helm')) domain = 'kubernetes';
    else if (lowerMsg.includes('terraform') || lowerMsg.includes('hcl')) domain = 'terraform';
    else if (lowerMsg.includes('docker') || lowerMsg.includes('container') || lowerMsg.includes('image')) domain = 'devops';
    else if (lowerMsg.includes('ci') || lowerMsg.includes('workflow') || lowerMsg.includes('action')) domain = 'ci-cd';
    else if (lowerMsg.includes('db') || lowerMsg.includes('postgres') || lowerMsg.includes('sql') || lowerMsg.includes('mongo')) domain = 'database';
    else if (lowerMsg.includes('test') || lowerMsg.includes('jest') || lowerMsg.includes('vitest')) domain = 'testing';
    else if (lowerMsg.includes('node') || lowerMsg.includes('npm') || lowerMsg.includes('typescript') || lowerMsg.includes('js')) domain = 'javascript';
    else if (lowerMsg.includes('python') || lowerMsg.includes('pip') || lowerMsg.includes('py')) domain = 'python';
    else if (lowerMsg.includes('go') || lowerMsg.includes('golang')) domain = 'go';

    const type = (lowerMsg.includes('revert') || lowerMsg.includes('workaround') || lowerMsg.includes('gotcha'))
      ? 'tool-gotcha'
      : 'convention';

    const cleanSubject = subject
      .toLowerCase()
      .replace(/^(fix|feat|chore|refactor|docs|test|style|perf)\s*(\([^)]+\))?:\s*/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 45);

    const slug = `git-${cleanSubject}`.replace(/^-|-$/g, '');
    if (!slug || seenSlugs.has(slug) || existingSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const title = subject.replace(/^(fix|feat|chore|refactor|docs|test|style|perf)\s*(\([^)]+\))?:\s*/i, '');
    const titleFormatted = title.charAt(0).toUpperCase() + title.slice(1);

    const why = `Uncovered from Git history (commit ${hash.slice(0, 8)} on ${date} by ${author}):\n${fullMessage.trim()}`;
    const howToApply = `Review the resolution in commit ${hash.slice(0, 8)} to avoid similar regressions or issues when working in the ${domain} domain.`;

    candidates.push({
      slug,
      title: titleFormatted,
      domain,
      type,
      description: `When handling ${domain} tasks or encountering issues related to ${title}`,
      verified: date,
      why,
      howToApply,
      sourceCommit: {
        hash: hash.slice(0, 8),
        author,
        date,
        subject
      }
    });

    if (candidates.length >= 10) break;
  }

  return {
    status: 'SUCCESS',
    commits_analyzed: commitBlocks.length,
    candidates_found: candidates.length,
    candidates
  };
}
