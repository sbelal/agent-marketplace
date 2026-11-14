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
      ['log', '-n', String(maxCommits), '--no-merges', '--format=%x1eCOMMIT:%H|%an|%ad|%s%n%b%nEND_COMMIT', '--date=short'],
      { cwd: workspaceRoot, encoding: 'utf8', timeout: 5000, env: GIT_EXEC_ENV }
    );
  } catch (err) {
    return {
      status: 'GIT_ERROR',
      message: err.message,
      candidates: []
    };
  }

  const commitBlocks = logOutput.split('\x1eCOMMIT:').filter(b => b.trim());
  const candidates = [];
  const seenSlugs = new Set();

  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  const existingSlugs = new Set(activeEntries.map(e => e.slug.toLowerCase()));

  const gotchaPatterns = [
    /\b(fix(?:ed|es)?|bug|hotfix|patch)\b/i,
    /\b(workaround|gotcha|caveat|quirk)\b/i,
    /\b(revert(?:ed|s)?|undo)\b/i,
    /\b(race condition|deadlock|memory leak|oom|timeout)\b/i,
    /\b(deprecat(?:ed|ion)|breaking change)\b/i
  ];

  const maxResults = Math.max(1, Math.min(50, parseInt(options.limit, 10) || 10));
  let orderIdx = 0;

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
    if (/\b(?:k8s|kubernetes|kube|kubectl|pod|pods|helm)\b/i.test(fullMessage)) domain = 'kubernetes';
    else if (/\b(?:terraform|hcl|tfvars)\b/i.test(fullMessage)) domain = 'terraform';
    else if (/\b(?:docker|dockerfile|container|containers|image|images)\b/i.test(fullMessage)) domain = 'devops';
    else if (/\b(?:ci|cd|ci\/cd|workflow|workflows|github\s+actions?)\b/i.test(fullMessage)) domain = 'ci-cd';
    else if (/\b(?:db|database|postgres|postgresql|sqlite|mysql|sql|mongo|mongodb)\b/i.test(fullMessage)) domain = 'database';
    else if (/\b(?:test|tests|testing|jest|vitest|mocha|pytest)\b/i.test(fullMessage)) domain = 'testing';
    else if (/\b(?:node|nodejs|node\.js|npm|pnpm|yarn|typescript|javascript|js|ts|esm)\b/i.test(fullMessage)) domain = 'javascript';
    else if (/\b(?:python|pip|pytest|py|venv|uv)\b/i.test(fullMessage)) domain = 'python';
    else if (/\b(?:go|golang)\b/i.test(fullMessage)) domain = 'go';

    const type = (/\b(revert|workaround|gotcha)\b/i.test(lowerMsg))
      ? 'tool-gotcha'
      : 'convention';

    let signalScore = 1;
    if (/\b(revert(?:ed|s)?|workaround|gotcha|caveat|quirk)\b/i.test(lowerMsg)) signalScore += 3;
    if (/\b(race condition|deadlock|memory leak|oom|breaking change)\b/i.test(lowerMsg)) signalScore += 3;
    if (/\b(deprecat(?:ed|ion)|timeout|hotfix)\b/i.test(lowerMsg)) signalScore += 2;
    if (bodyLines.length > 0) signalScore += 1;

    const cleanSubject = subject
      .toLowerCase()
      .replace(/^(fix|feat|chore|refactor|docs|test|style|perf)\s*(\([^)]+\))?:\s*/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 45)
      .replace(/-+$/g, '');

    const slug = cleanSubject ? `git-${cleanSubject}` : `git-${hash.slice(0, 8)}`;
    const slugLower = slug.toLowerCase();
    if (!slug || seenSlugs.has(slugLower) || existingSlugs.has(slugLower)) continue;
    seenSlugs.add(slugLower);

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
      },
      _signalScore: signalScore,
      _orderIdx: orderIdx++
    });
  }

  candidates.sort((a, b) => (b._signalScore - a._signalScore) || (a._orderIdx - b._orderIdx));
  const topCandidates = candidates.slice(0, maxResults).map(({ _signalScore, _orderIdx, ...rest }) => rest);

  return {
    status: 'SUCCESS',
    commits_analyzed: commitBlocks.length,
    candidates_found: topCandidates.length,
    candidates: topCandidates
  };
}
