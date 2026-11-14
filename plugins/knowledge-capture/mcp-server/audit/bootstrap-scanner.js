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
  const resolvedAdrPath = path.isAbsolute(adrFilePath)
    ? adrFilePath
    : path.resolve(workspaceRoot || process.cwd(), adrFilePath);
  if (!fs.existsSync(resolvedAdrPath)) {
    throw new Error(`ADR file not found at ${resolvedAdrPath}`);
  }

  const targetLayer = String(options.targetLayer || 'workspace').trim().toLowerCase();
  const isTeamLayer = targetLayer === 'team' || targetLayer.startsWith('team/');
  if (targetLayer !== 'workspace' && targetLayer !== 'private' && !isTeamLayer) {
    throw new Error(`Invalid targetLayer "${options.targetLayer}". Expected 'workspace', 'private', 'team', or 'team/<slug>'.`);
  }
  const content = fs.readFileSync(resolvedAdrPath, 'utf8');
  const baseName = path.basename(resolvedAdrPath, path.extname(resolvedAdrPath));
  let slug = `adr-${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/--+/g, '-').replace(/^-|-$/g, '') || 'adr-entry';
  if (slug === 'adr') slug = 'adr-entry';

  const paths = resolveStoragePaths(workspaceRoot);
  let targetDir = paths.workspaceDir;
  if (targetLayer === 'private') {
    targetDir = paths.privateDir;
  } else if (isTeamLayer) {
    const specifiedSlug = options.teamSlug || (targetLayer.startsWith('team/') ? targetLayer.slice(5) : null);
    if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
      const match = specifiedSlug
        ? paths.activeTeamDirs.find(r => r.slug.toLowerCase() === specifiedSlug.toLowerCase())
        : paths.activeTeamDirs[0];
      if (!match) {
        throw new Error(`Team repository '${specifiedSlug}' was not found in settings or is not active.`);
      }
      targetDir = match.dir;
    } else if (paths.settings?.teamRepos && paths.settings.teamRepos.length > 0) {
      throw new Error('No active team repositories are configured in settings.');
    } else if (specifiedSlug && specifiedSlug.toLowerCase() !== 'default') {
      throw new Error(`Team repository '${specifiedSlug}' was not found in settings or is not active.`);
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
    const dirtyOut = execFileSync('git', ['status', '--porcelain'], {
      cwd: targetDir,
      env: GIT_EXEC_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    if (dirtyOut) {
      throw new Error(`Team repository at '${targetDir}' has uncommitted changes. Commit or stash before ingesting ADR.`);
    }

    const desiredBranch = `adr/${slug}`;
    let baseBranch = null;
    try {
      const sym = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
        cwd: targetDir,
        env: GIT_EXEC_ENV,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      if (sym) baseBranch = sym.replace(/^origin\//, '');
    } catch {}
    if (!baseBranch) {
      for (const cand of ['main', 'master']) {
        try {
          execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${cand}`], {
            cwd: targetDir,
            env: GIT_EXEC_ENV,
            stdio: 'ignore'
          });
          baseBranch = cand;
          break;
        } catch {}
      }
    }
    if (baseBranch) {
      execFileSync('git', ['checkout', baseBranch], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
    }

    try {
      execFileSync('git', ['checkout', '-b', desiredBranch], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
      branchName = desiredBranch;
    } catch {
      execFileSync('git', ['checkout', desiredBranch], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
      branchName = desiredBranch;
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
          const slug = `adr-${base.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/--+/g, '-').replace(/^-|-$/g, '') || 'adr-entry';
          const normalizedSlug = slug === 'adr' ? 'adr-entry' : slug;
          addCandidate({
            slug: normalizedSlug,
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
  const gitlabCiPath = path.join(workspaceRoot, '.gitlab-ci.yml');
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
  if (!seenSlugs.has('ci-pipeline-conventions') && fs.existsSync(gitlabCiPath)) {
    addCandidate({
      slug: 'ci-pipeline-conventions',
      title: 'GitLab CI/CD Pipeline Validation & Testing Standards',
      domain: 'ci-cd',
      type: 'convention',
      description: 'When running tests, opening merge requests, or modifying automated GitLab CI pipelines',
      why: 'Repository enforces automated CI checks defined in .gitlab-ci.yml.',
      howToApply: 'Ensure all pipeline stages, tests, and lint jobs pass before merging.',
      sourceFile: '.gitlab-ci.yml'
    });
  }

  // 3. Scan Linters, Formatters & Runtime / Language Tooling
  const linterMap = [
    { file: '.golangci.yml', slug: 'go-linter-standards', domain: 'go', title: 'GolangCI Linting & Code Hygiene Standards' },
    { file: '.golangci.yaml', slug: 'go-linter-standards', domain: 'go', title: 'GolangCI Linting & Code Hygiene Standards' },
    { file: 'go.mod', slug: 'go-module-toolchain', domain: 'go', title: 'Go Module & Toolchain Standards' },
    { file: 'ruff.toml', slug: 'python-ruff-standards', domain: 'python', title: 'Python Ruff Formatting & Linting Governance' },
    { file: 'pyproject.toml', slug: 'python-project-standards', domain: 'python', title: 'Python Project Configuration & Packaging Standards' },
    { file: 'Cargo.toml', slug: 'rust-cargo-standards', domain: 'rust', title: 'Rust Cargo Workspace & Build Standards' },
    { file: 'tsconfig.json', slug: 'typescript-compiler-standards', domain: 'typescript', title: 'TypeScript Compiler Strictness & Module Standards' },
    { file: '.eslintrc.json', slug: 'eslint-code-standards', domain: 'typescript', title: 'ESLint Coding Standards & Best Practices' },
    { file: '.eslintrc.js', slug: 'eslint-code-standards', domain: 'typescript', title: 'ESLint Coding Standards & Best Practices' },
    { file: '.eslintrc.yml', slug: 'eslint-code-standards', domain: 'typescript', title: 'ESLint Coding Standards & Best Practices' },
    { file: 'eslint.config.js', slug: 'eslint-code-standards', domain: 'javascript', title: 'ESLint Flat Config Standards & Best Practices' },
    { file: 'eslint.config.mjs', slug: 'eslint-code-standards', domain: 'javascript', title: 'ESLint Flat Config Standards & Best Practices' },
    { file: 'eslint.config.cjs', slug: 'eslint-code-standards', domain: 'javascript', title: 'ESLint Flat Config Standards & Best Practices' },
    { file: 'biome.json', slug: 'biome-formatting-governance', domain: 'typescript', title: 'Biome Formatting & Linting Governance' },
    { file: '.nvmrc', slug: 'node-runtime-version-pin', domain: 'javascript', title: 'Pinned Node.js Runtime Version Standard' },
    { file: '.node-version', slug: 'node-runtime-version-pin', domain: 'javascript', title: 'Pinned Node.js Runtime Version Standard' }
  ];

  for (const lint of linterMap) {
    if (fs.existsSync(path.join(workspaceRoot, lint.file))) {
      addCandidate({
        slug: lint.slug,
        title: lint.title,
        domain: lint.domain,
        type: 'convention',
        description: `When configuring, formatting, or linting ${lint.domain} codebase files`,
        why: `Repository enforces strict tooling configuration via ${lint.file}.`,
        howToApply: `Verify clean execution against ${lint.file} before committing changes.`,
        sourceFile: lint.file
      });
    }
  }

  // 4. Scan Container & Infrastructure
  const containerFiles = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  const foundContainer = containerFiles.find(cf => fs.existsSync(path.join(workspaceRoot, cf)));
  if (foundContainer) {
    addCandidate({
      slug: 'docker-container-build-governance',
      title: 'Docker Container Build & Packaging Guidelines',
      domain: 'devops',
      type: 'platform-fact',
      description: 'When creating, building, or modifying container images, Dockerfiles, or Compose services',
      why: `Repository standardizes container execution via ${foundContainer}.`,
      howToApply: 'Use multi-stage builds, pin minimal base images, and do not run processes as root.',
      sourceFile: foundContainer
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
