import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveStoragePaths, GIT_EXEC_ENV } from '../core/storage-paths.js';
import { serializeYamlFrontmatter } from '../core/yaml-parser.js';
import { findMarkdownFiles } from '../retrieval/shadow-resolver.js';
import { atomicWriteFileSync } from '../core/memory-store.js';

/**
 * Ingests an Architectural Decision Record (ADR) file cleanly into memory.
 */
export function ingestTeamAdr(workspaceRoot, adrFilePath, options = {}) {
  if (!fs.existsSync(adrFilePath)) {
    throw new Error(`ADR file not found at ${adrFilePath}`);
  }

  const targetLayer = (options.targetLayer || 'workspace').toLowerCase();
  const content = fs.readFileSync(adrFilePath, 'utf8');
  const baseName = path.basename(adrFilePath, path.extname(adrFilePath));
  const slug = `adr-${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/^-|-$/g, '');

  const paths = resolveStoragePaths(workspaceRoot);
  let targetDir = paths.workspaceDir;
  if (targetLayer === 'private') {
    targetDir = paths.privateDir;
  } else if (targetLayer === 'team' || targetLayer.startsWith('team/')) {
    const specifiedSlug = options.teamSlug || (targetLayer.startsWith('team/') ? targetLayer.slice(5) : null);
    if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
      const match = specifiedSlug ? paths.activeTeamDirs.find(r => r.slug.toLowerCase() === specifiedSlug.toLowerCase()) : paths.activeTeamDirs[0];
      targetDir = match ? match.dir : paths.teamDir;
    } else {
      targetDir = paths.teamDir;
    }
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `ADR: ${baseName}`;

  const frontmatter = {
    name: slug,
    type: 'convention',
    domain: 'architecture',
    description: `When architectural decisions relating to ${title} apply`,
    verified: new Date().toISOString().slice(0, 10),
    related: []
  };

  const serialized = serializeYamlFrontmatter(frontmatter, content);
  const targetFile = path.join(targetDir, `${slug}.md`);

  let branchName = null;
  if ((targetLayer === 'team' || targetLayer.startsWith('team/')) && fs.existsSync(path.join(targetDir, '.git'))) {
    branchName = `adr/${slug}`;
    try {
      execFileSync('git', ['checkout', '-b', branchName], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
    } catch {
      try {
        execFileSync('git', ['checkout', branchName], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
      } catch {}
    }
  }

  atomicWriteFileSync(targetFile, serialized, 'utf8');

  return {
    success: true,
    slug,
    title,
    layer: targetLayer,
    branch: branchName,
    path: targetFile
  };
}

/**
 * Scans workspace codebase for existing patterns, ADRs, linters, and CI workflows
 * to bootstrap initial Workspace-scoped persistent memories.
 */
export function bootstrapRepoMemories(workspaceRoot = process.cwd()) {
  const candidates = [];
  const seenSlugs = new Set();

  function addCandidate(cand) {
    if (seenSlugs.has(cand.slug)) return;
    seenSlugs.add(cand.slug);
    candidates.push(cand);
  }

  // 1. Scan ADR files
  const adrDirs = ['docs/adr', 'docs/adrs', 'adr', 'doc/adr'];
  for (const adrDir of adrDirs) {
    const fullDir = path.join(workspaceRoot, adrDir);
    if (fs.existsSync(fullDir)) {
      const files = findMarkdownFiles(fullDir);
      for (const f of files) {
        const base = path.basename(f, '.md');
        if (base.toUpperCase() === 'README' || base.startsWith('template')) continue;
        try {
          const content = fs.readFileSync(f, 'utf8');
          const titleMatch = content.match(/^#\s+(.+)$/m);
          const title = titleMatch ? titleMatch[1].trim() : `ADR: ${base}`;
          const slug = `adr-${base.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/^-|-$/g, '');
          addCandidate({
            slug,
            title,
            domain: 'architecture',
            type: 'convention',
            description: `When architectural decisions from ${title} apply to development`,
            why: `Codifies architectural decision record from ${path.relative(workspaceRoot, f)}.`,
            howToApply: `Refer to ${path.relative(workspaceRoot, f)} for design boundaries and rationale.`,
            sourceFile: path.relative(workspaceRoot, f)
          });
        } catch {}
      }
    }
  }

  // 2. Scan CI/CD Workflows
  const githubWorkflowsDir = path.join(workspaceRoot, '.github', 'workflows');
  if (fs.existsSync(githubWorkflowsDir)) {
    try {
      const wfFiles = fs.readdirSync(githubWorkflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      if (wfFiles.length > 0) {
        addCandidate({
          slug: 'ci-pipeline-conventions',
          title: 'CI/CD Pipeline Validation & Testing Standards',
          domain: 'ci-cd',
          type: 'convention',
          description: 'When running tests, opening pull requests, or modifying automated workflows',
          why: `Repository enforces automated CI checks defined in .github/workflows/ (${wfFiles.join(', ')}).`,
          howToApply: 'Ensure all tests, formatting, and lint suites pass locally before submitting code to upstream branches.',
          sourceFile: '.github/workflows/'
        });
      }
    } catch {}
  }

  // 3. Scan Linters & Formatters
  const linterMap = [
    { file: '.golangci.yml', slug: 'go-linter-standards', domain: 'go', title: 'GolangCI Linting & Code Hygiene Standards' },
    { file: '.golangci.yaml', slug: 'go-linter-standards', domain: 'go', title: 'GolangCI Linting & Code Hygiene Standards' },
    { file: 'ruff.toml', slug: 'python-ruff-standards', domain: 'python', title: 'Python Ruff Formatting & Linting Governance' },
    { file: '.eslintrc.json', slug: 'eslint-code-standards', domain: 'typescript', title: 'ESLint Coding Standards & Best Practices' },
    { file: 'biome.json', slug: 'biome-formatting-governance', domain: 'typescript', title: 'Biome Formatting & Linting Governance' }
  ];

  for (const lint of linterMap) {
    if (fs.existsSync(path.join(workspaceRoot, lint.file))) {
      addCandidate({
        slug: lint.slug,
        title: lint.title,
        domain: lint.domain,
        type: 'convention',
        description: `When formatting or linting ${lint.domain} codebase files`,
        why: `Repository enforces strict static analysis via ${lint.file}.`,
        howToApply: `Verify clean execution with project linter before committing changes.`,
        sourceFile: lint.file
      });
    }
  }

  // 4. Scan Container & Infrastructure
  if (fs.existsSync(path.join(workspaceRoot, 'Dockerfile'))) {
    addCandidate({
      slug: 'docker-container-build-governance',
      title: 'Docker Container Build & Packaging Guidelines',
      domain: 'devops',
      type: 'platform-fact',
      description: 'When creating, building, or modifying container images and Dockerfiles',
      why: 'Repository standardizes container execution via Dockerfile.',
      howToApply: 'Use multi-stage builds, pin minimal base images, and do not run processes as root.',
      sourceFile: 'Dockerfile'
    });
  }

  // 5. Scan Contributing & Architecture Guidelines
  const guideFiles = ['CONTRIBUTING.md', 'ARCHITECTURE.md'];
  for (const gf of guideFiles) {
    if (fs.existsSync(path.join(workspaceRoot, gf))) {
      const base = path.basename(gf, '.md').toLowerCase();
      addCandidate({
        slug: `project-${base}-governance`,
        title: `Project ${gf} Conventions`,
        domain: 'general',
        type: 'convention',
        description: `When onboarding or contributing architectural changes to the project`,
        why: `Core development workflows and governance documented in ${gf}.`,
        howToApply: `Follow contribution and architecture patterns described in ${gf}.`,
        sourceFile: gf
      });
    }
  }

  return candidates;
}
