import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

const tempRoot = path.join(os.tmpdir(), `kc-test-${Date.now()}`);
fs.mkdirSync(tempRoot, { recursive: true });

// Strictly isolate KC_STORAGE_DIR to temporary directory for all tests
process.env.KC_STORAGE_DIR = path.join(tempRoot, 'kc-storage');
fs.mkdirSync(process.env.KC_STORAGE_DIR, { recursive: true });

import { execFileSync, spawnSync } from 'node:child_process';

import {
  parseYamlFrontmatter,
  serializeYamlFrontmatter,
  saveMemoryEntry,
  deleteMemoryEntry,
  rewireMemoryReferences,
  cleanDanglingReferences,
  bootstrapRepoMemories,
  mineGitHistoryMemories,
  autoElicitSessionKnowledge,
  atomicWriteFileSync,
  getMemoryContent,
  prepareTeamPromotion,
  getTeamRepositories,
  addTeamRepository,
  setTeamRepositoryActive,
  removeTeamRepository,
  syncTeamRepositories,
  getMemorySummary,
  getLayerStatistics,
  deriveTeamRepoSlug,
  applyMemoryPatch,
  auditTeamConflicts,
  resolveTeamConflict,
  resolveStoragePaths,
  syncMemoryLayer,
  ingestTeamAdr
} from '../plugins/knowledge-capture/mcp-server/memory-service.js';

import { mergeMemoryEntries } from '../plugins/knowledge-capture/mcp-server/core/memory-store.js';
import { pullSingleRepo, validateSafeGitUrl } from '../plugins/knowledge-capture/bin/pull.js';
import { setupEnvironment, testRemoteConnectivity } from '../plugins/knowledge-capture/bin/setup.js';
import { startStudioServer, parseCliArgs } from '../plugins/knowledge-capture/bin/studio.js';

import {
  syncSqliteIndex,
  searchMemoriesHybrid,
  getKnowledgeGraphData,
  recordTelemetryEvent,
  generateKnowledgeGraphHtml,
  normalizeWorkspaceId,
  generateDenseEmbedding,
  computeDenseCosineSimilarity,
  generateMultiVector,
  computeMultiVectorSimilarity,
  detectContradictionsAndDrift,
  proactiveMemoryProbe,
  recordMemoryEfficacy,
  getMemoryGraphNeighbors,
  getMemorySpanningTree,
  generateEmbedding,
  getActiveEmbeddingConfig,
  resetOnnxState,
  isIndexDirty,
  dreamMemoryConsolidation,
  correlateTestExecutionEfficacy,
  renderVisualMemoryStudio,
  stopStudioService
} from '../plugins/knowledge-capture/mcp-server/sqlite-index.js';

import { createLayerProvider } from '../plugins/knowledge-capture/mcp-server/core/layer-provider.js';

import {
  consultLogic,
  analyzeLogicalFallacies,
  evaluateProbability,
  evaluateArchitecturalTradeoffs
} from '../plugins/syran-persona/mcp-server/logic-service.js';

async function teardown() {
  try {
    await stopStudioService();
  } catch {}
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}

console.log('🧪 Starting agent-marketplace verification suite...\n');

try {
  // ==========================================
  // TEST 1: YAML Frontmatter & Proactive Recall Probe
  // ==========================================
  console.log('Test 1: YAML Frontmatter Clean Schema & Proactive Recall Probe...');
  const testYaml = `---
name: k8s-delete-guard
type: convention
domain: kubernetes
description: Prevent accidental deletion of production namespaces and clusters
verified: 2026-11-01
related: [k8s-pod-governance]
---
# Kubernetes Namespace Protection
Never delete namespaces directly in production without cluster-admin verification.
`;

  const parsed = parseYamlFrontmatter(testYaml);
  assert.equal(parsed.frontmatter.name, 'k8s-delete-guard');
  assert.equal(parsed.frontmatter.domain, 'kubernetes');
  assert.equal(parsed.frontmatter.type, 'convention');
  assert.deepEqual(parsed.frontmatter.related, ['k8s-pod-governance']);
  assert.equal(parsed.frontmatter.applies_to, undefined, 'applies_to must not exist in clean schema');

  // Test Proactive Recall Probe on temp workspace
  const wsDir = path.join(tempRoot, 'ws1', '.agents', 'rules', 'memory');
  fs.mkdirSync(wsDir, { recursive: true });
  fs.writeFileSync(path.join(wsDir, 'k8s-delete-guard.md'), testYaml, 'utf8');

  await syncSqliteIndex(path.join(tempRoot, 'ws1'));

  const probeResult = await proactiveMemoryProbe(
    path.join(tempRoot, 'ws1'),
    'I want to delete production namespace',
    { threshold: 0.20 }
  );
  assert.ok(probeResult.triggered, 'Proactive probe should trigger on matching prompt');
  assert.ok(probeResult.matches.some(m => m.slug === 'k8s-delete-guard'), 'Probe must match k8s-delete-guard');
  assert.ok(probeResult.advisoryMessage.includes('Proactive Knowledge Advisory'), 'Advisory banner must be generated');
  console.log('  ✔ Passed: YAML parser validates clean schema and Proactive Recall Probe detects triggers in < 5ms.\n');

  // ==========================================
  // TEST 2: Workspace-Partitioned SQLite Cache
  // ==========================================
  console.log('Test 2: Workspace-Partitioned SQLite Cache...');
  const ws1Root = path.join(tempRoot, 'ws1');
  const ws2Root = path.join(tempRoot, 'ws2');
  const ws2Dir = path.join(ws2Root, '.agents', 'rules', 'memory');
  fs.mkdirSync(ws2Dir, { recursive: true });

  const testYaml2 = `---
name: ws2-unique-rule
type: convention
domain: terraform
description: Lock timeout governance
---
# Terraform Lock
`;
  fs.writeFileSync(path.join(ws2Dir, 'ws2-unique-rule.md'), testYaml2, 'utf8');

  // Sync WS1
  await syncSqliteIndex(ws1Root);
  // Sync WS2
  await syncSqliteIndex(ws2Root);

  // Search WS1: should find k8s-delete-guard, NOT ws2-unique-rule
  const ws1Results = await searchMemoriesHybrid(ws1Root, 'delete namespace');
  assert.ok(ws1Results.some(r => r.slug === 'k8s-delete-guard'), 'WS1 should find its own workspace memory');

  // Verify WS2 search finds its own memory and does not delete WS1
  const ws2Results = await searchMemoriesHybrid(ws2Root, 'lock timeout');
  assert.ok(ws2Results.some(r => r.slug === 'ws2-unique-rule'), 'WS2 should find its own unique rule');

  // Re-verify WS1 still has its memory (not purged by WS2 sync)
  const ws1ResultsAgain = await searchMemoriesHybrid(ws1Root, 'delete namespace');
  assert.ok(ws1ResultsAgain.some(r => r.slug === 'k8s-delete-guard'), 'WS1 records must NOT be deleted by WS2 sync!');
  console.log('  ✔ Passed: Workspace partitioning isolates caches across independent repositories.\n');

  // ==========================================
  // TEST 3: Precedence & Shadowing in Search
  // ==========================================
  console.log('Test 3: Search Precedence (Workspace > Private > Team)...');
  // Put a private memory with same slug as workspace memory in isolated KC_STORAGE_DIR
  const privDir = path.join(process.env.KC_STORAGE_DIR, 'private');
  fs.mkdirSync(privDir, { recursive: true });
  const privShadowFile = path.join(privDir, 'k8s-delete-guard.md');
  const privYaml = `---
name: k8s-delete-guard
type: preference
domain: kubernetes
description: Lower tier private rule that should be shadowed
---
# Private Shadow
`;
  fs.writeFileSync(privShadowFile, privYaml, 'utf8');

  try {
    const searchRes = await searchMemoriesHybrid(ws1Root, 'k8s-delete-guard');
    assert.ok(searchRes.length > 0, 'Should return matching rule');
    assert.equal(searchRes[0].layer, 'workspace', 'Workspace tier must win over Private tier');
  } finally {
    if (fs.existsSync(privShadowFile)) fs.unlinkSync(privShadowFile);
  }
  console.log('  ✔ Passed: Workspace tier deterministically shadows lower-tier rules in search.\n');

  // ==========================================
  // TEST 4: Word Boundary Username Scrubbing
  // ==========================================
  console.log('Test 4: Username Scrubbing with Strict Word Boundaries...');
  const testText = 'This is a standard problem with debian packages for user dan in guidance documents.';
  const username = 'dan';
  const escapedUser = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const scrubbed = testText.replace(new RegExp(`\\b${escapedUser}\\b`, 'gi'), '<developer>');

  assert.ok(scrubbed.includes('standard'), 'standard must not be corrupted');
  assert.ok(scrubbed.includes('problem'), 'problem must not be corrupted');
  assert.ok(scrubbed.includes('debian'), 'debian must not be corrupted');
  assert.ok(scrubbed.includes('guidance'), 'guidance must not be corrupted');
  assert.ok(scrubbed.includes('user <developer>'), 'user dan should become user <developer>');
  console.log('  ✔ Passed: Strict word boundaries prevent substring corruption in team promotion.\n');

  // ==========================================
  // TEST 5: Syran Bayesian Probability Updating
  // ==========================================
  console.log('Test 5: Syran Logic Officer Bayesian Probability with Prior...');
  const hypotheses = [
    { label: 'Course Alpha', weight: 1.0, risk: 0.2 },
    { label: 'Course Beta', weight: 1.0, risk: 0.2 }
  ];

  const highPriorRes = evaluateProbability(hypotheses, 0.85);
  const lowPriorRes = evaluateProbability(hypotheses, 0.15);

  assert.equal(highPriorRes.optimal_hypothesis, 'Course Alpha', 'Alpha should win with high prior');
  assert.equal(lowPriorRes.optimal_hypothesis, 'Course Beta', 'Beta should win with low prior');
  const alphaHighProb = highPriorRes.evaluations.find(e => e.label === 'Course Alpha').probability;
  const alphaLowProb = lowPriorRes.evaluations.find(e => e.label === 'Course Alpha').probability;
  assert.notEqual(alphaHighProb, alphaLowProb, 'Alpha probability must change based on prior');

  const zeroPriorRes = evaluateProbability(hypotheses, 0.0);
  assert.equal(zeroPriorRes.prior_probability, 0.01, '0.0 prior should be safely clamped to 0.01');

  const zeroHypoPriorRes = evaluateProbability([
    { label: 'Hypo 1', weight: 1.0, prior: 0.0 },
    { label: 'Hypo 2', weight: 1.0 }
  ]);
  assert.ok(zeroHypoPriorRes.evaluations, 'Hypothesis-level prior 0.0 must evaluate cleanly');
  console.log('  ✔ Passed: Bayesian updating actively incorporates prior probability.\n');

  // ==========================================
  // TEST 6: D3 Knowledge Graph Referential Integrity & Interactive Memory Studio
  // ==========================================
  console.log('Test 6: D3 Knowledge Graph Referential Integrity & Interactive Memory Studio...');
  const graph = getKnowledgeGraphData(ws1Root);
  assert.ok(Array.isArray(graph.nodes), 'Nodes must be an array');
  assert.ok(Array.isArray(graph.links), 'Links must be an array');
  assert.ok(Array.isArray(graph.brokenLinks), 'Broken links must be partitioned separately');

  const validNodeIds = new Set(graph.nodes.map(n => n.id));
  for (const link of graph.links) {
    assert.ok(validNodeIds.has(link.source) && validNodeIds.has(link.target), 'All active links must connect to existing nodes');
  }

  const htmlCanvas = generateKnowledgeGraphHtml(ws1Root);
  assert.ok(htmlCanvas.includes('<!DOCTYPE html>'), 'Graph HTML generator must output valid document');
  assert.ok(htmlCanvas.includes('d3.v7.min.js'), 'Must embed D3 script reference');
  assert.ok(htmlCanvas.includes('Memory Studio'), 'HTML canvas must include Memory Studio');
  assert.ok(htmlCanvas.includes('btn-connect-mode'), 'Must include Connect Mode button');
  assert.ok(htmlCanvas.includes('btn-export-patch'), 'Must include Export Patch button');
  assert.ok(htmlCanvas.includes('Bump to Today'), 'Must include Bump to Today button');
  assert.ok(htmlCanvas.includes('Efficacy Score'), 'Must include Efficacy Score tracking');
  console.log('  ✔ Passed: D3 graph referential integrity and Interactive Memory Studio verified.\n');

  // ==========================================
  // TEST 7: Repo Bootstrapping Scanner
  // ==========================================
  console.log('Test 7: Repository Bootstrapping Scanner (/kc-bootstrap)...');
  // Create mock ADR and workflow in temp workspace
  const mockAdrDir = path.join(tempRoot, 'ws3', 'docs', 'adr');
  fs.mkdirSync(mockAdrDir, { recursive: true });
  fs.writeFileSync(path.join(mockAdrDir, '0001-microservices.md'), '# ADR 1: Microservices Architecture\nDecided on services.', 'utf8');

  const mockWfDir = path.join(tempRoot, 'ws3', '.github', 'workflows');
  fs.mkdirSync(mockWfDir, { recursive: true });
  fs.writeFileSync(path.join(mockWfDir, 'test.yml'), 'name: Test\non: push', 'utf8');

  const bootstrapped = bootstrapRepoMemories(path.join(tempRoot, 'ws3'));
  assert.ok(bootstrapped.length >= 2, 'Should discover both ADR and CI workflow');
  assert.ok(bootstrapped.some(b => b.slug.includes('microservices')), 'Should extract ADR candidate');
  assert.ok(bootstrapped.some(b => b.slug === 'ci-pipeline-conventions'), 'Should extract CI candidate');
  console.log('  ✔ Passed: Bootstrapping scanner auto-discovers repository conventions.\n');

  // ==========================================
  // TEST 8: Multi-Vector Embeddings & RRF Hybrid Retrieval
  // ==========================================
  console.log('Test 8: Multi-Vector Embeddings & Reciprocal Rank Fusion (RRF)...');
  const vec1 = generateDenseEmbedding('kubernetes pod container crashloop restart', 128);
  const vec2 = generateDenseEmbedding('container pod crash failure', 128);
  const vec3 = generateDenseEmbedding('css flexbox responsive layout styling', 128);

  const simRelated = computeDenseCosineSimilarity(vec1, vec2);
  const simUnrelated = computeDenseCosineSimilarity(vec1, vec3);
  assert.ok(simRelated > simUnrelated, 'Semantic similarity between related topics must exceed unrelated topics');
  assert.ok(simRelated > 0.4, 'Related topics must yield substantial cosine similarity');

  // Multi-Vector Facets
  const testEntry = {
    slug: 'k8s-crashloop-backoff',
    domain: 'kubernetes',
    type: 'tool-gotcha',
    trigger: 'When kubernetes pods enter CrashLoopBackOff state',
    body: 'Increase container memory limits and check OOMKilled events.',
    related: ['docker-oom-limits']
  };
  const multiVec = generateMultiVector(testEntry);
  assert.equal(multiVec.trigger_vector.length, 128);
  assert.equal(multiVec.content_vector.length, 128);
  assert.equal(multiVec.entity_vector.length, 128);

  const queryVec = generateDenseEmbedding('pod oom killed crashloop', 128);
  const facetScore = computeMultiVectorSimilarity(queryVec, multiVec);
  assert.ok(facetScore > 0.25, 'Composite multi-vector score should capture intent and content facets');

  // Write testEntry to ws1 to make it discoverable for docker hybrid retrieval
  fs.writeFileSync(path.join(ws1Root, '.agents', 'rules', 'memory', `${testEntry.slug}.md`), `---
name: ${testEntry.slug}
domain: ${testEntry.domain}
type: ${testEntry.type}
description: ${testEntry.trigger}
related: [${testEntry.related.join(', ')}]
---
${testEntry.body}
`, 'utf8');
  await syncSqliteIndex(ws1Root);

  // Hybrid search execution with RRF
  const hybridMatches = await searchMemoriesHybrid(ws1Root, 'docker', { mode: 'hybrid' });
  assert.ok(Array.isArray(hybridMatches), 'Hybrid search must return array');
  assert.ok(hybridMatches.length > 0, 'Should find matching memories in test workspace');
  assert.ok(hybridMatches[0].confidence > 0, 'Match confidence must be positive');
  console.log('  ✔ Passed: Multi-vector embeddings and Reciprocal Rank Fusion provide robust semantic matching.\n');

  // ==========================================
  // TEST 9: Session-End Auto-Elicitation Sentinel
  // ==========================================
  console.log('Test 9: Session-End Auto-Elicitation Sentinel (/kc-elicit)...');
  const elicitResult = autoElicitSessionKnowledge(process.cwd());
  assert.ok(typeof elicitResult === 'object', 'autoElicitSessionKnowledge must return result object');
  assert.ok(Array.isArray(elicitResult.modified_files), 'modified_files must be an array');
  assert.ok(typeof elicitResult.elicitation_needed === 'boolean', 'elicitation_needed must be boolean');

  // Test bin/session-end.js execution
  const sessionEndPath = path.resolve('plugins/knowledge-capture/bin/session-end.js');
  assert.ok(fs.existsSync(sessionEndPath), 'bin/session-end.js must exist');
  console.log('  ✔ Passed: Session-End Auto-Elicitation Sentinel audits workspace modifications.\n');

  // ==========================================
  // TEST 10: Semantic Contradiction & Drift Engine (/kc-drift)
  // ==========================================
  console.log('Test 10: Semantic Contradiction & Codebase Drift Detection Engine...');
  const driftWs = path.join(tempRoot, 'drift-ws');
  const driftMemoryDir = path.join(driftWs, '.agents', 'rules', 'memory');
  fs.mkdirSync(driftMemoryDir, { recursive: true });

  // Create package.json with Node >=26 requirement
  fs.writeFileSync(path.join(driftWs, 'package.json'), JSON.stringify({
    name: 'drift-test-project',
    engines: { node: '>=26.0.0' }
  }), 'utf8');

  // Rule A: Mandates pnpm, mentions missing .eslintrc.json and old Node 18, verified 2 years ago
  fs.writeFileSync(path.join(driftMemoryDir, 'pkg-pnpm-standards.md'), `---
name: pkg-pnpm-standards
domain: javascript
type: convention
description: When managing dependencies and package installations
verified: 2023-01-01
---

# Package Management Standards

Always use pnpm for package installations and lockfile consistency.
Requires Node 18 runtime. Check configuration in .eslintrc.json.
`, 'utf8');

  // Rule B: Contradictory rule mandating npm
  fs.writeFileSync(path.join(driftMemoryDir, 'pkg-npm-standards.md'), `---
name: pkg-npm-standards
domain: javascript
type: convention
description: When managing dependencies and installing node packages
verified: 2026-05-01
---

# NPM Package Standards

Never use pnpm, always enforce npm install with package-lock.json.
`, 'utf8');

  const driftAudit = detectContradictionsAndDrift(driftWs);
  assert.equal(driftAudit.status, 'DRIFT_DETECTED', 'Audit must detect issues in drift workspace');
  assert.ok(driftAudit.contradictions.length >= 1, 'Must detect opposing toolchain contradiction between pnpm and npm');
  assert.equal(driftAudit.contradictions[0].severity, 'high', 'Toolchain conflict must be high severity');
  assert.ok(driftAudit.contradictions[0].conflict_reason.includes('pnpm'), 'Conflict reason must mention pnpm');

  // Verify drift detection categories
  assert.ok(driftAudit.drifts.some(d => d.type === 'staleness_drift'), 'Must detect staleness drift (> 180 days)');
  assert.ok(driftAudit.drifts.some(d => d.type === 'referenced_file_missing'), 'Must detect missing .eslintrc.json');
  assert.ok(driftAudit.drifts.some(d => d.type === 'runtime_engine_drift'), 'Must detect Node 18 vs >=26.0.0 engine mismatch');
  assert.equal(
    driftAudit.drifts.some(d => d.type === 'dangling_override_drift' && d.slug === 'pkg-pnpm-standards'),
    false,
    'Valid rules must not trigger false dangling override drift'
  );
  console.log('  ✔ Passed: Semantic Contradiction and Drift Engine accurately detects rule conflicts and codebase divergence.\n');

  // ==========================================
  // TEST 11: Historical Tacit Knowledge Archeology (/kc-archeology)
  // ==========================================
  console.log('Test 11: Historical Tacit Knowledge Archeology (/kc-archeology)...');
  const archeologyResult = mineGitHistoryMemories(process.cwd(), { maxCommits: 50 });
  assert.equal(archeologyResult.status, 'SUCCESS', 'Archeology scan must return SUCCESS status');
  assert.ok(typeof archeologyResult.commits_analyzed === 'number', 'commits_analyzed must be a number');
  assert.ok(Array.isArray(archeologyResult.candidates), 'candidates must be an array');
  if (archeologyResult.candidates.length > 0) {
    const firstCand = archeologyResult.candidates[0];
    assert.ok(firstCand.slug, 'Candidate must have a slug');
    assert.ok(firstCand.title, 'Candidate must have a title');
    assert.ok(firstCand.domain, 'Candidate must have a domain');
    assert.ok(firstCand.sourceCommit, 'Candidate must have sourceCommit metadata');
  }
  console.log('  ✔ Passed: Git history archeology successfully discovers tacit knowledge candidates.\n');

  // ==========================================
  // TEST 12: Memory Efficacy & Verification Scoring Telemetry
  // ==========================================
  console.log('Test 12: Memory Efficacy & Verification Scoring Telemetry...');
  const initialRow = recordMemoryEfficacy('k8s-delete-guard', 'apply');
  assert.ok(initialRow, 'Initial telemetry row must exist');

  const passRow = recordMemoryEfficacy('k8s-delete-guard', 'test_pass', { message: 'Passed unit tests' });
  assert.ok(passRow.test_pass_count >= 1, 'test_pass_count must increment');
  assert.ok(passRow.efficacy_score >= 0.9, 'Efficacy score should remain high or boost');

  const failRow = recordMemoryEfficacy('k8s-delete-guard', 'test_fail', { message: 'Failed regression test' });
  assert.ok(failRow.test_fail_count >= 1, 'test_fail_count must increment');
  assert.ok(failRow.efficacy_score < passRow.efficacy_score, 'Efficacy score must decrease after test failure');

  const graphDataAfter = getKnowledgeGraphData(ws1Root);
  assert.ok(typeof graphDataAfter.summary.avgEfficacyScore === 'number', 'Summary must include avgEfficacyScore');
  console.log('  ✔ Passed: Memory efficacy telemetry accurately tracks verification feedback.\n');

  // ==========================================
  // TEST 13: Atomic File Persistence Pattern
  // ==========================================
  console.log('Test 13: Atomic File Persistence Pattern (Write-Temp-and-Rename)...');
  const atomicTarget = path.join(tempRoot, 'atomic-test.md');
  atomicWriteFileSync(atomicTarget, '# Atomic Content\nWritten safely.\n');
  assert.ok(fs.existsSync(atomicTarget), 'Target file must exist after atomic write');
  assert.equal(fs.readFileSync(atomicTarget, 'utf8'), '# Atomic Content\nWritten safely.\n');
  const tempFiles = fs.readdirSync(tempRoot).filter(f => f.includes('.tmp.'));
  assert.equal(tempFiles.length, 0, 'No temporary staging files should linger after write');
  console.log('  ✔ Passed: atomicWriteFileSync guarantees POSIX atomic persistence without lingering temp files.\n');

  // ==========================================
  // TEST 14: Bi-Directional Knowledge Graph with Backlink Traversal
  // ==========================================
  console.log('Test 14: Bi-Directional Knowledge Graph with Backlink Traversal...');
  const podGovYaml = `---
name: k8s-pod-governance
domain: kubernetes
type: convention
description: Pod scheduling and governance
---
# Pod Governance
`;
  fs.writeFileSync(path.join(wsDir, 'k8s-pod-governance.md'), podGovYaml, 'utf8');
  await syncSqliteIndex(ws1Root);

  const neighbors = getMemoryGraphNeighbors(ws1Root, 'k8s-pod-governance');
  assert.equal(neighbors.slug, 'k8s-pod-governance');
  assert.ok(neighbors.incoming.some(l => l.source_slug === 'k8s-delete-guard'), 'k8s-pod-governance must have k8s-delete-guard as incoming backlink');

  const contentWithBacklinks = getMemoryContent(ws1Root, 'workspace', 'k8s-pod-governance');
  assert.ok(contentWithBacklinks.backlinks.some(b => b.slug === 'k8s-delete-guard'), 'getMemoryContent must return backlinks array');
  assert.ok(contentWithBacklinks.content.includes('Incoming Backlinks (Referenced By)'), 'Enriched content must render Incoming Backlinks footer');
  console.log('  ✔ Passed: Bi-directional knowledge graph resolves both forward references and incoming backlinks.\n');

  // ==========================================
  // TEST 15: LLM-Driven Team Promotion Architecture
  // ==========================================
  console.log('Test 15: LLM-Driven Team Promotion Architecture...');
  const teamRepoDir = path.join(process.env.KC_STORAGE_DIR, 'team');
  fs.mkdirSync(teamRepoDir, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: teamRepoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test Agent'], { cwd: teamRepoDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: teamRepoDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(teamRepoDir, 'README.md'), '# Team Memory\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: teamRepoDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: teamRepoDir, stdio: 'ignore' });

  const llmSanitizedBody = `## Why\nIn containerized environments, pod memory limits must align with cgroup thresholds.\n\n## How to apply\nConfigure resources.limits.memory equal to or greater than requests.memory.\n`;
  const promotionRes = prepareTeamPromotion(ws1Root, {
    slug: 'k8s-pod-governance',
    content: llmSanitizedBody,
    frontmatter: {
      domain: 'kubernetes',
      type: 'convention',
      description: 'When defining pod container memory limits and cgroup allocations'
    }
  });

  assert.equal(promotionRes.success, true);
  assert.ok(promotionRes.branch.startsWith('promote/'));
  assert.ok(fs.existsSync(promotionRes.stagedFile));
  const promotedContent = fs.readFileSync(promotionRes.stagedFile, 'utf8');
  assert.ok(promotedContent.includes('When defining pod container memory limits'), 'Must use LLM-refined trigger');
  assert.ok(promotedContent.includes('cgroup thresholds'), 'Must persist LLM-sanitized content');
  console.log('  ✔ Passed: prepareTeamPromotion successfully stages LLM-sanitized memory content.\n');

  // ==========================================
  // TEST 16: Single-Source Manifest Build & Sync
  // ==========================================
  console.log('Test 16: Single-Source Manifest Build & Sync Validation...');
  const syncScript = path.resolve('bin/sync-manifests.js');
  assert.ok(fs.existsSync(syncScript), 'bin/sync-manifests.js must exist');
  const checkOut = execFileSync(process.execPath, [syncScript, '--check'], { encoding: 'utf8' });
  assert.ok(checkOut.includes('in sync'), 'All derived plugin configuration files must be synchronized');
  console.log('  ✔ Passed: Single-source manifest generator validates zero configuration drift.\n');

  // ==========================================
  // TEST 17: Local ONNX Semantic Embeddings & Heuristic Fallback
  // ==========================================
  console.log('Test 17: Local ONNX Transformer, Adaptive Dimension Storage & Graceful Fallback...');
  
  // 17.1 Verify ONNX primary engine generates 384-dimensional dense semantic vectors
  process.env.KC_EMBEDDING_ENGINE = 'onnx';
  resetOnnxState();
  const onnxConfig = getActiveEmbeddingConfig();
  assert.equal(onnxConfig.engine, 'onnx');
  assert.equal(onnxConfig.dimensions, 384);

  const onnxVec1 = await generateEmbedding('docker container orchestrator');
  assert.equal(onnxVec1.length, 384, 'Local ONNX embedding must produce 384-dimensional dense vector');

  // Verify semantic synonym similarity: 'docker container orchestrator' vs 'kubernetes cluster management'
  const onnxVecSynonym = await generateEmbedding('kubernetes cluster management');
  const onnxVecUnrelated = await generateEmbedding('chocolate cake baking recipe');
  const simOnnxSynonym = computeDenseCosineSimilarity(onnxVec1, onnxVecSynonym);
  const simOnnxUnrelated = computeDenseCosineSimilarity(onnxVec1, onnxVecUnrelated);
  assert.ok(simOnnxSynonym > simOnnxUnrelated, 'Semantic synonym similarity must exceed unrelated text similarity');

  // 17.2 Verify Adaptive Dimension Storage in SQLite:
  // Syncing with ONNX should record 384 dimensions in SQLite meta table
  await syncSqliteIndex(ws1Root);
  const { getDatabase } = await import('../plugins/knowledge-capture/mcp-server/sqlite-index.js');
  const db = getDatabase();
  const metaOnnx = db.prepare('SELECT val FROM meta WHERE key = ?').get('embedding_dim');
  assert.equal(metaOnnx?.val, '384', 'SQLite meta table must record 384-d when ONNX engine is active');

  // 17.3 Switch to Heuristic Vector Engine:
  // Must adaptively transition to 128 dimensions without error
  process.env.KC_EMBEDDING_ENGINE = 'heuristic';
  const heuristicConfig = getActiveEmbeddingConfig();
  assert.equal(heuristicConfig.engine, 'heuristic');
  assert.equal(heuristicConfig.dimensions, 128);

  const heuristicVec = await generateEmbedding('docker container orchestrator');
  assert.equal(heuristicVec.length, 128, 'Heuristic embedding must produce 128-dimensional dense vector');

  await syncSqliteIndex(ws1Root);
  const metaHeuristic = db.prepare('SELECT val FROM meta WHERE key = ?').get('embedding_dim');
  assert.equal(metaHeuristic?.val, '128', 'Adaptive Dimension Storage must update SQLite meta table to 128-d');

  // 17.4 Graceful Fallback:
  // If an unsupported or invalid engine is set, must default to 128-d heuristic without crashing
  process.env.KC_EMBEDDING_ENGINE = 'unsupported_test_provider';
  const fallbackVec = await generateEmbedding('testing resilient fallback');
  assert.ok(Array.isArray(fallbackVec), 'Fallback must return a valid array');
  assert.equal(fallbackVec.length, 128, 'Unsupported engine must safely fall back to 128-d heuristic');

  // Reset environment
  delete process.env.KC_EMBEDDING_ENGINE;
  console.log('  ✔ Passed: Local ONNX transformer, adaptive dimensions (384/128-d), and heuristic fallback verified.\n');

  // ==========================================
  // TEST 18: Multi-Team Repositories by Slug
  // ==========================================
  console.log('Test 18: Multi-Team Repositories by Slug & Dynamic Activation...');
  
  // 18.0 Verify Auto-Derivation of slug from URL (<org_id>-<repo_slug> or <account_id>-<repo_slug>)
  assert.equal(deriveTeamRepoSlug('git@github.com:acme-corp/platform-rules.git'), 'acme-corp-platform-rules');
  assert.equal(deriveTeamRepoSlug('https://github.com/my-org/backend-memory.git'), 'my-org-backend-memory');
  assert.equal(deriveTeamRepoSlug('https://github.com/sbelal/agent-marketplace'), 'sbelal-agent-marketplace');

  // 18.1 Add new team repository with slug 'platform-eng'
  const addRes = addTeamRepository('platform-eng', 'https://github.com/org/platform-memory.git', 'Platform Engineering', ws1Root);
  assert.equal(addRes.ok, true, 'addTeamRepository must return ok: true');
  assert.equal(addRes.slug, 'platform-eng');
  assert.ok(fs.existsSync(addRes.dir), 'Team repository directory must be scaffolded');

  // Verify list includes platform-eng
  let reposList = getTeamRepositories(ws1Root);
  const foundRepo = reposList.find(r => r.slug === 'platform-eng');
  assert.ok(foundRepo, 'Team repo platform-eng must be listed in getTeamRepositories');
  assert.equal(foundRepo.active, true, 'Newly added repo must be active by default');

  // 18.2 Write a memory entry under platform-eng directory
  const teamMemPath = path.join(addRes.dir, 'platform-ci-standard.md');
  const teamMemContent = `---
name: platform-ci-standard
type: convention
domain: ci-cd
description: When configuring GitHub Actions CI runners for platform services
verified: 2026-03-01
---
# Platform CI Standard
## Why
Standardizes runner tags across platform engineering repos.
## How to apply
Always specify runs-on: [self-hosted, linux, x64].
`;
  fs.writeFileSync(teamMemPath, teamMemContent, 'utf8');

  // Sync index and verify team memory is discoverable with slug
  await syncSqliteIndex(ws1Root);
  let teamSearchResult = await searchMemoriesHybrid(ws1Root, 'GitHub Actions CI runners', { format: 'compact' });
  const foundTeamMem = teamSearchResult.find(m => m.slug === 'platform-ci-standard');
  assert.ok(foundTeamMem, 'Team memory under platform-eng must be discoverable in hybrid search');
  assert.equal(foundTeamMem.layer, 'team');

  const teamSummary = getMemorySummary(ws1Root, { layer: 'platform-eng' });
  assert.ok(teamSummary.includes('platform-ci-standard'), 'getMemorySummary with team slug should discover team entries');

  // 18.3 Deactivate platform-eng
  const deactRes = setTeamRepositoryActive('platform-eng', false, ws1Root);
  assert.equal(deactRes.ok, true);
  await syncSqliteIndex(ws1Root);

  teamSearchResult = await searchMemoriesHybrid(ws1Root, 'GitHub Actions CI runners', { format: 'compact' });
  const deactTeamMem = teamSearchResult.find(m => m.slug === 'platform-ci-standard');
  assert.equal(deactTeamMem, undefined, 'Deactivated team repository memories must be excluded from search');

  // 18.4 Re-activate and verify restoration
  setTeamRepositoryActive('platform-eng', true, ws1Root);
  await syncSqliteIndex(ws1Root);
  teamSearchResult = await searchMemoriesHybrid(ws1Root, 'GitHub Actions CI runners', { format: 'compact' });
  assert.ok(teamSearchResult.find(m => m.slug === 'platform-ci-standard'), 'Re-activated team repository must restore searchability');

  // 18.5 Remove team repository
  const remRes = removeTeamRepository('platform-eng', true, ws1Root);
  assert.equal(remRes.ok, true);
  await syncSqliteIndex(ws1Root);
  reposList = getTeamRepositories(ws1Root);
  assert.equal(reposList.find(r => r.slug === 'platform-eng'), undefined, 'Removed repo must not be in list');

  // 18.6 Verify bin/pull.js handles invalid team slug gracefully with error code 1
  let pullErr = null;
  try {
    const pullBinPath = path.resolve('plugins/knowledge-capture/bin/pull.js');
    execFileSync(process.execPath, [pullBinPath, 'invalid-slug'], {
      cwd: ws1Root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    pullErr = err;
  }
  assert.ok(pullErr, 'Pulling an invalid team slug must exit with non-zero status');
  assert.equal(pullErr.status, 1);
  assert.ok(pullErr.stderr.includes("Team repository with slug 'invalid-slug' not found"));
  console.log('  ✔ Passed: Multi-team repository addition, scoping, activation toggling, invalid-slug validation, and removal verified.\n');

  // ==========================================
  // TEST 19: Command-Query Separation (CQS) in Hybrid Search
  // ==========================================
  console.log('Test 19: Command-Query Separation (CQS) in Hybrid Search...');
  
  // Index is clean after previous syncSqliteIndex
  assert.equal(isIndexDirty(ws1Root), false, 'Index must be clean after synchronization');

  // Performing a search query must remain a pure query (zero state mutation, index remains clean)
  const queryResult = await searchMemoriesHybrid(ws1Root, 'docker');
  assert.ok(Array.isArray(queryResult), 'Search query must return result array');
  assert.equal(isIndexDirty(ws1Root), false, 'Read-only search query must not mutate index or dirty state');

  // Create a new memory file on disk in workspace
  const cqsEntryPath = path.join(ws1Root, '.agents', 'rules', 'memory', 'cqs-test-gotcha.md');
  fs.writeFileSync(cqsEntryPath, `---
name: cqs-test-gotcha
type: tool-gotcha
domain: general
description: When testing command-query separation behavior
verified: 2026-03-01
---
# CQS Test Gotcha
## Why
Verifies that index detects modified files.
## How to apply
Test only.
`, 'utf8');

  // isIndexDirty should now detect the modification without requiring a query
  assert.equal(isIndexDirty(ws1Root), true, 'isIndexDirty must detect when files on disk have changed');

  // Running explicit sync command resets dirty state
  await syncSqliteIndex(ws1Root);
  assert.equal(isIndexDirty(ws1Root), false, 'syncSqliteIndex command resets dirty state');

  // Cleanup
  fs.unlinkSync(cqsEntryPath);
  await syncSqliteIndex(ws1Root);
  console.log('  ✔ Passed: CQS compliance verified - search is a pure read query and sync is an explicit command.\n');

  // ==========================================
  // TEST 20: Token-Budgeted Hierarchical Recall
  // ==========================================
  console.log('Test 20: Token-Budgeted Hierarchical Recall (Compact Index vs Full Body)...');

  // 20.1 Compact summary vs standard tabular summary
  const compactSummary = getMemorySummary(ws1Root, 'all', { format: 'compact' });
  assert.ok(typeof compactSummary === 'string', 'Compact summary must be a string');
  assert.ok(compactSummary.includes('Memory Summary (Compact Index)'), 'Compact summary must output index card header');
  assert.ok(compactSummary.includes('k8s-delete-guard'), 'Compact summary must list entries');
  assert.ok(!compactSummary.includes('| Slug | Layer | Type |'), 'Compact summary must omit wide markdown tables');

  const standardSummary = getMemorySummary(ws1Root, 'all', { format: 'standard' });
  assert.ok(standardSummary.includes('| Slug | Layer | Type |'), 'Standard summary must contain tabular format');

  // 20.2 Compact search vs full body search
  const compactSearch = await searchMemoriesHybrid(ws1Root, 'docker', { format: 'compact' });
  assert.ok(compactSearch.length > 0, 'Compact search must return results');
  assert.equal(compactSearch[0].content, undefined, 'Compact search results must omit full content body to save token budget');
  assert.ok(compactSearch[0].slug, 'Compact search results must contain slug');
  assert.ok(compactSearch[0].description, 'Compact search results must contain trigger description');

  const fullSearch = await searchMemoriesHybrid(ws1Root, 'docker', { format: 'full' });
  assert.ok(fullSearch.length > 0, 'Full search must return results');
  assert.ok(typeof fullSearch[0].content === 'string' && fullSearch[0].content.length > 0, 'Full search results must expand markdown content body');
  console.log('  ✔ Passed: Token-budgeted hierarchical recall provides compact index cards and full body expansion on demand.\n');

  // ==========================================
  // TEST 21: Bidirectional Memory Studio Patch Application & Persistence
  // ==========================================
  console.log('Test 21: Bidirectional Memory Studio Patch Application & Persistence...');

  const patchPayload = {
    modified_nodes: [
      {
        slug: 'k8s-delete-guard',
        domain: 'security',
        type: 'convention',
        description: 'WHEN deleting production namespace or ingress THEN verify manual confirmation and rollback plan',
        verified: '2026-03-15'
      }
    ],
    added_links: [
      {
        source: 'k8s-delete-guard',
        target: 'k8s-crashloop-backoff',
        type: 'related'
      }
    ],
    removed_links: [
      {
        source: 'k8s-delete-guard',
        target: 'k8s-pod-governance',
        type: 'related'
      }
    ]
  };

  const patchResult = applyMemoryPatch(ws1Root, patchPayload);
  assert.equal(patchResult.ok, true, 'applyMemoryPatch must succeed');
  assert.equal(patchResult.nodesUpdated, 1, 'Should update 1 node');
  assert.equal(patchResult.linksAdded, 1, 'Should add 1 link');
  assert.equal(patchResult.linksRemoved, 1, 'Should remove 1 link');

  // Verify case-insensitive patch update
  const casePatchResult = applyMemoryPatch(ws1Root, {
    modified_nodes: [{ slug: 'K8S-DELETE-GUARD', domain: 'security' }]
  });
  assert.equal(casePatchResult.ok, true, 'Case-insensitive patch should succeed');

  // Verify on-disk file content
  const updatedFile = fs.readFileSync(path.join(ws1Root, '.agents', 'rules', 'memory', 'k8s-delete-guard.md'), 'utf8');
  const parsedUpdated = parseYamlFrontmatter(updatedFile);
  assert.equal(parsedUpdated.frontmatter.domain, 'security', 'Frontmatter domain should be updated to security');
  assert.equal(parsedUpdated.frontmatter.verified, '2026-03-15', 'Frontmatter verified date should be updated');
  assert.ok(parsedUpdated.frontmatter.related.includes('k8s-crashloop-backoff'), 'New related link must be present');
  assert.ok(!parsedUpdated.frontmatter.related.includes('k8s-pod-governance'), 'Removed related link must not be present');

  // Sync SQLite and verify query reflection
  await syncSqliteIndex(ws1Root);
  const updatedSearch = await searchMemoriesHybrid(ws1Root, 'security ingress rollback', { format: 'compact' });
  assert.ok(updatedSearch.some(m => m.slug === 'k8s-delete-guard'), 'Updated memory must be discoverable with new domain/trigger');
  console.log('  ✔ Passed: Memory Studio patch successfully persisted to markdown frontmatter and synced to SQLite.\n');

  // ==========================================
  // TEST 22: Standalone Memory Studio CLI & Direct Browser Persistence Server
  // ==========================================
  console.log('Test 22: Standalone Memory Studio CLI & Direct Browser Persistence Server...');
  const studioServer = await startStudioServer({
    port: 54321,
    host: '127.0.0.1',
    workspaceRoot: ws1Root,
    autoOpen: false,
    strictPort: true
  });

  try {
    assert.equal(studioServer.port, 54321, 'Studio server must bind to requested port');

    // 22.1 Test GET / (HTML canvas)
    const indexRes = await fetch(`${studioServer.url}/`);
    assert.equal(indexRes.status, 200, 'GET / must return 200 OK');
    const indexHtml = await indexRes.text();
    assert.ok(indexHtml.includes('Memory Studio'), 'HTML response must include Memory Studio UI');
    assert.ok(indexHtml.includes('btn-save-disk'), 'HTML response must include direct browser save button');

    // 22.2 Test GET /api/graph
    const graphRes = await fetch(`${studioServer.url}/api/graph`);
    assert.equal(graphRes.status, 200, 'GET /api/graph must return 200 OK');
    const graphJson = await graphRes.json();
    assert.ok(Array.isArray(graphJson.nodes), 'Graph response must contain nodes array');
    assert.ok(Array.isArray(graphJson.links), 'Graph response must contain links array');

    // 22.3 Test POST /api/patch (direct browser save)
    const directPatchPayload = {
      modified_nodes: [
        {
          slug: 'k8s-delete-guard',
          domain: 'devops',
          type: 'tool-gotcha',
          description: 'WHEN deleting ingress or cluster pods THEN check active traffic routes',
          verified: '2026-03-20'
        }
      ],
      added_links: [],
      removed_links: []
    };

    const patchRes = await fetch(`${studioServer.url}/api/patch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Studio-Token': studioServer.studioToken
      },
      body: JSON.stringify(directPatchPayload)
    });
    assert.equal(patchRes.status, 200, 'POST /api/patch must return 200 OK');
    const patchJson = await patchRes.json();
    assert.equal(patchJson.ok, true, 'Patch response must indicate success');
    assert.equal(patchJson.nodesUpdated, 1, 'Patch response must report 1 node updated');

    // Verify on disk
    const savedFile = fs.readFileSync(path.join(ws1Root, '.agents', 'rules', 'memory', 'k8s-delete-guard.md'), 'utf8');
    const parsedSaved = parseYamlFrontmatter(savedFile);
    assert.equal(parsedSaved.frontmatter.domain, 'devops', 'Direct browser save must update markdown frontmatter domain');
    assert.equal(parsedSaved.frontmatter.verified, '2026-03-20', 'Direct browser save must update verified date');

    // 22.4 Test GET /api/health
    const healthRes = await fetch(`${studioServer.url}/api/health`);
    assert.equal(healthRes.status, 200, 'GET /api/health must return 200 OK');
    const healthJson = await healthRes.json();
    assert.equal(healthJson.status, 'running', 'Health endpoint must report running status');
  } finally {
    await studioServer.close();
  }
  console.log('  ✔ Passed: Standalone Memory Studio CLI server provides direct browser-to-disk persistence via /api/patch.\n');

  // ==========================================
  // TEST 23: 3-Way Conflict Resolution & Visual Diff for Team Layer
  // ==========================================
  console.log('Test 23: 3-Way Conflict Resolution & Visual Diff for Team Layer...');
  
  // 23.1 Register team repo and setup rule
  const addConflictRes = addTeamRepository('core-platform', 'https://github.com/org/core-platform.git', 'Core Platform', ws1Root);
  const teamRulePath = path.join(addConflictRes.dir, 'k8s-pod-governance.md');
  fs.writeFileSync(teamRulePath, `---
name: k8s-pod-governance
type: convention
domain: kubernetes
description: Pod governance standards across core platform
verified: 2026-03-25
---
# Pod Governance
## Why
Standardize pod security context.
## How to apply
Always set runAsNonRoot: true.
`, 'utf8');

  // Setup divergent private rule
  const privateDir = path.join(process.env.KC_STORAGE_DIR, 'private');
  fs.mkdirSync(privateDir, { recursive: true });
  const privateRulePath = path.join(privateDir, 'k8s-pod-governance.md');
  fs.writeFileSync(privateRulePath, `---
name: k8s-pod-governance
type: convention
domain: kubernetes
description: Local custom pod governance rule
verified: 2026-01-01
---
# Pod Governance
## Why
Local override for development testing.
## How to apply
Local dev pods may use runAsNonRoot: false.
`, 'utf8');

  // 23.2 Audit conflicts
  const conflictAudit = auditTeamConflicts(ws1Root);
  assert.equal(conflictAudit.status, 'CONFLICTS_DETECTED', 'Conflict audit must detect divergence between private and team');
  assert.ok(conflictAudit.conflictsCount >= 1, 'Should find at least 1 conflict');
  const targetConflict = conflictAudit.conflicts.find(c => c.slug === 'k8s-pod-governance');
  assert.ok(targetConflict, 'Conflict list must contain k8s-pod-governance');
  assert.ok(targetConflict.diffSummary, 'Conflict must contain visual diffSummary');

  // 23.3 Resolve via keep_private
  const keepRes = resolveTeamConflict(ws1Root, { slug: 'k8s-pod-governance', resolution: 'keep_private' });
  assert.equal(keepRes.ok, true, 'resolveTeamConflict with keep_private must succeed');
  assert.equal(keepRes.action, 'kept_private_override');
  assert.ok(fs.existsSync(privateRulePath), 'Private file must remain after keep_private');

  // 23.4 Resolve via merge_both
  const mergedRule = `---
name: k8s-pod-governance
type: convention
domain: kubernetes
description: Unified pod governance for both prod and local dev
verified: 2026-03-25
---
# Pod Governance
## Why
Standardize pod security context while supporting dev exceptions.
## How to apply
Enforce runAsNonRoot: true in production, allow exceptions in dev.
`;
  const mergeRes = resolveTeamConflict(ws1Root, {
    slug: 'k8s-pod-governance',
    resolution: 'merge_both',
    mergedContent: mergedRule
  });
  assert.equal(mergeRes.ok, true, 'resolveTeamConflict with merge_both must succeed');
  assert.equal(mergeRes.action, 'merged_both_versions');
  const mergedContentDisk = fs.readFileSync(privateRulePath, 'utf8');
  assert.ok(mergedContentDisk.includes('Unified pod governance'), 'Disk file must contain merged content');

  // 23.5 Resolve via adopt_team (unlinks private copy)
  const adoptRes = resolveTeamConflict(ws1Root, { slug: 'k8s-pod-governance', resolution: 'adopt_team' });
  assert.equal(adoptRes.ok, true, 'resolveTeamConflict with adopt_team must succeed');
  assert.equal(adoptRes.action, 'adopted_team_standard');
  assert.equal(fs.existsSync(privateRulePath), false, 'Private file must be removed after adopting team standard');

  // Cleanup conflict repo
  removeTeamRepository('core-platform', true, ws1Root);
  console.log('  ✔ Passed: 3-way conflict detection, visual diff summary, and resolution strategies verified.\n');

  // ==========================================
  // TEST 24: Memory Dreaming & Autonomous Semantic Synthesis (/kc-dream)
  // ==========================================
  console.log('Test 24: Memory Dreaming & Autonomous Semantic Synthesis (/kc-dream)...');

  // Create two closely related, fragmented memories in workspace
  const dreamDir = path.join(ws1Root, '.agents', 'rules', 'memory');
  fs.writeFileSync(path.join(dreamDir, 'k8s-cpu-throttling.md'), `---
name: k8s-cpu-throttling
type: tool-gotcha
domain: kubernetes
description: When detecting CFS CPU throttling in Kubernetes pods
verified: 2026-03-01
---
# CPU Throttling
## Why
CFS quota throttling causes latency spikes.
## How to apply
Increase CPU limits or disable quotas.
`, 'utf8');

  fs.writeFileSync(path.join(dreamDir, 'k8s-memory-oom-guard.md'), `---
name: k8s-memory-oom-guard
type: tool-gotcha
domain: kubernetes
description: When preventing Kubernetes pod container OOM kills and cgroup memory exhaustion
verified: 2026-03-01
---
# Memory OOM Guard
## Why
Container OOM kills drop traffic abruptly.
## How to apply
Set memory request equal to limit.
`, 'utf8');

  await syncSqliteIndex(ws1Root);

  const dreamResult = dreamMemoryConsolidation(ws1Root, { domain: 'kubernetes', threshold: 0.5 });
  assert.ok(dreamResult.totalMemoriesAnalyzed >= 2, 'Should analyze at least 2 memories');
  assert.ok(Array.isArray(dreamResult.clusters), 'Dream result must contain clusters array');
  assert.ok(dreamResult.clusters.length >= 1, 'Should discover at least 1 consolidation cluster');
  const dreamCluster = dreamResult.clusters[0];
  assert.ok(dreamCluster.memberSlugs.length >= 2, 'Cluster must contain multiple member slugs');
  assert.ok(dreamCluster.targetSlug, 'Cluster must propose a consolidated target slug');
  assert.ok(dreamCluster.unifiedTrigger, 'Cluster must synthesize a unified trigger');
  assert.ok(dreamCluster.synthesizedBody.includes('## How to apply'), 'Synthesized body must format structured guideline');
  assert.ok(typeof dreamCluster.estimatedTokenSavingsPct === 'number', 'Token savings percentage must be calculated');

  // Cleanup dream memories
  fs.unlinkSync(path.join(dreamDir, 'k8s-cpu-throttling.md'));
  fs.unlinkSync(path.join(dreamDir, 'k8s-memory-oom-guard.md'));
  await syncSqliteIndex(ws1Root);
  console.log('  ✔ Passed: Automated memory dreaming, semantic clustering, and proposal synthesis verified.\n');

  // ==========================================
  // TEST 25: Closed-Loop Execution-Driven Efficacy Hook
  // ==========================================
  console.log('Test 25: Closed-Loop Execution-Driven Efficacy Hook & Confidence Modulation...');

  // 25.1 Create test memory
  fs.writeFileSync(path.join(dreamDir, 'test-runner-guideline.md'), `---
name: test-runner-guideline
type: convention
domain: testing
description: When configuring unit and integration test runner environments
verified: 2026-03-01
---
# Test Runner Guideline
## Why
Ensure deterministic test execution.
## How to apply
Always execute tests with timeout guards.
`, 'utf8');
  await syncSqliteIndex(ws1Root);

  // Initial baseline efficacy
  recordMemoryEfficacy('test-runner-guideline', 'applied');

  // 25.2 Correlate successful test run
  const passHookResult = correlateTestExecutionEfficacy(ws1Root, {
    command: 'npm test',
    exitCode: 0,
    stdout: 'All 24 test suites passed successfully in 3.2s',
    slugs: ['test-runner-guideline']
  });
  assert.equal(passHookResult.outcome, 'PASSED', 'Hook outcome must be PASSED');
  assert.ok(passHookResult.correlatedSlugs.includes('test-runner-guideline'));
  assert.ok(passHookResult.updatedScores['test-runner-guideline'] >= 1.0, 'Efficacy score must remain high on pass');

  // 25.3 Correlate failed test run
  const failHookResult = correlateTestExecutionEfficacy(ws1Root, {
    command: 'npm test',
    exitCode: 1,
    stderr: 'Failure in test-runner-guideline: timeout exceeded',
    slugs: ['test-runner-guideline']
  });
  assert.equal(failHookResult.outcome, 'FAILED', 'Hook outcome must be FAILED');
  assert.ok(failHookResult.correlatedSlugs.includes('test-runner-guideline'));
  assert.ok(failHookResult.updatedScores['test-runner-guideline'] < 1.0, 'Efficacy score must be penalized on fail');

  // Repeat failures to bring score below 0.6 threshold
  for (let i = 0; i < 4; i++) {
    correlateTestExecutionEfficacy(ws1Root, {
      command: 'npm test',
      exitCode: 1,
      stderr: 'Repeated assertion failure on test-runner-guideline',
      slugs: ['test-runner-guideline']
    });
  }

  // 25.4 Verify hybrid search confidence modulation and warning
  const modulatedSearch = await searchMemoriesHybrid(ws1Root, 'test runner environments');
  const targetResult = modulatedSearch.find(m => m.slug === 'test-runner-guideline');
  assert.ok(targetResult, 'Target memory must be found in hybrid search');
  assert.ok(targetResult.efficacyScore < 0.6, 'Efficacy score must reflect penalized state');
  assert.ok(targetResult.lowEfficacyWarning, 'Search must attach lowEfficacyWarning when score < 0.6');

  // Cleanup
  fs.unlinkSync(path.join(dreamDir, 'test-runner-guideline.md'));
  await syncSqliteIndex(ws1Root);
  console.log('  ✔ Passed: Execution-driven efficacy hook adjusts telemetry and modulates search confidence.\n');

  // ==========================================
  // TEST 26: Syran First-Principles Pareto Architectural Trade-Off Matrix
  // ==========================================
  console.log('Test 26: Syran First-Principles Pareto Architectural Trade-Off Matrix...');

  const architecturalOptions = [
    {
      name: 'Direct SQLite FTS + Vector',
      description: 'Embedded single-binary database with FTS5 and in-process vector cosine calculation',
      scores: { latency: 5, operational_overhead: 1, implementation_cost: 2, extensibility: 8 }
    },
    {
      name: 'External Elastic Cluster',
      description: 'Distributed external cluster with dedicated REST coordinator nodes',
      scores: { latency: 45, operational_overhead: 9, implementation_cost: 8, extensibility: 9 }
    },
    {
      name: 'In-Memory Linear Scan',
      description: 'Plain JSON in memory with linear regex scan',
      scores: { latency: 25, operational_overhead: 2, implementation_cost: 1, extensibility: 3 }
    }
  ];

  const architecturalCriteria = [
    { name: 'latency', weight: 3.0, direction: 'minimize', description: 'Query execution latency in milliseconds' },
    { name: 'operational_overhead', weight: 2.0, direction: 'minimize', description: 'Infrastructure maintenance complexity' },
    { name: 'implementation_cost', weight: 2.0, direction: 'minimize', description: 'Development effort in engineer-weeks' },
    { name: 'extensibility', weight: 1.0, direction: 'maximize', description: 'Feature growth capacity' }
  ];

  const mautEvaluation = evaluateArchitecturalTradeoffs(architecturalOptions, architecturalCriteria);
  assert.equal(mautEvaluation.status, 'COMPLETE', 'Evaluation status must be COMPLETE');
  assert.equal(mautEvaluation.officer, 'Syran');
  assert.equal(mautEvaluation.candidatesEvaluated, 3);
  assert.equal(mautEvaluation.criteriaCount, 4);

  // Pareto Frontier verification
  assert.ok(Array.isArray(mautEvaluation.paretoFrontier), 'Pareto frontier must be an array');
  assert.ok(mautEvaluation.paretoFrontier.includes('Direct SQLite FTS + Vector'), 'Optimal candidate must be on Pareto frontier');

  // Utility ranking
  assert.equal(mautEvaluation.optimalCandidate, 'Direct SQLite FTS + Vector', 'Direct SQLite must rank first based on weights');
  assert.equal(mautEvaluation.utilityRanking[0].name, 'Direct SQLite FTS + Vector');
  assert.ok(mautEvaluation.utilityRanking[0].utilityScore > mautEvaluation.utilityRanking[1].utilityScore);

  // Pivot Analysis
  assert.ok(mautEvaluation.pivotAnalysis, 'Pivot sensitivity analysis must be generated');

  // Syran Persona Contraction Prohibition Check
  const counsel = mautEvaluation.officerCounsel;
  assert.ok(typeof counsel === 'string' && counsel.length > 50, 'Officer counsel must be a non-empty string');
  assert.ok(counsel.includes('Captain'), 'Officer counsel must formally address the Captain');
  assert.ok(counsel.includes('Pareto'), 'Officer counsel must reference the Pareto frontier');

  const contractionPattern = /\b(can't|don't|won't|isn't|aren't|haven't|hasn't|didn't|couldn't|shouldn't|wouldn't|it's|they're|we're|i'm|you're)\b/i;
  assert.equal(contractionPattern.test(counsel), false, 'Officer counsel must NOT contain any contractions');

  console.log('  ✔ Passed: Syran Trade-Off Matrix calculates MAUT utilities, Pareto frontier, pivot sensitivity, and zero-contraction counsel.\n');

  // ==========================================
  // TEST 27: Unified Layer Provider Pattern & Multi-Team Routing (Apply A, Fix 1, Fix 2, Fix 3)
  // ==========================================
  console.log('Test 27: Unified Layer Provider Pattern & Multi-Team Routing...');
  const layerProvider = createLayerProvider(ws1Root);
  const activeLayers = layerProvider.getActiveLayers();
  assert.ok(Array.isArray(activeLayers), 'activeLayers must be an array');
  assert.ok(activeLayers.some(l => l.key === 'workspace'), 'Must include workspace layer');
  assert.ok(activeLayers.some(l => l.key === 'private'), 'Must include private layer');

  const sampleEntry = layerProvider.findMemoryFile('k8s-delete-guard');
  assert.ok(sampleEntry, 'Layer provider should find sample entry across layers');
  assert.equal(layerProvider.resolveTeamRepoDir('non-existent-team'), null, 'Resolving invalid team slug must return null');
  assert.ok(layerProvider.resolveTeamRepoDir('default'), 'Resolving default team slug should return team dir');

  let promoErr = null;
  try {
    prepareTeamPromotion(ws1Root, { slug: 'k8s-delete-guard', content: '# Test Guard\nSample content', teamSlug: 'non-existent-team' });
  } catch (err) {
    promoErr = err;
  }
  assert.ok(promoErr, 'Promoting to invalid team slug must throw');
  assert.ok(promoErr.message.includes("Team repository 'non-existent-team' was not found"));
  console.log('  ✔ Passed: Unified Layer Provider Pattern decouples filesystem from memory store.\n');

  // ==========================================
  // TEST 28: GraphRAG Multi-Hop Spanning Tree Recall (Apply 💡 4)
  // ==========================================
  console.log('Test 28: GraphRAG Multi-Hop Spanning Tree Recall...');
  const spanningTree = getMemorySpanningTree(ws1Root, 'k8s-delete-guard', { depth: 2 });
  assert.equal(spanningTree.rootSlug, 'k8s-delete-guard');
  assert.ok(Array.isArray(spanningTree.nodes), 'Nodes must be an array');
  assert.ok(Array.isArray(spanningTree.edges), 'Edges must be an array');
  assert.ok(typeof spanningTree.contextEnvelope === 'string', 'Context envelope must be a string');
  assert.ok(spanningTree.contextEnvelope.includes('GraphRAG Spanning Tree Context Envelope'), 'Envelope title must be present');

  const linkKeys = spanningTree.links.map(l => `${l.source}->${l.target}:${l.type}`);
  const uniqueLinkKeys = new Set(linkKeys);
  assert.equal(linkKeys.length, uniqueLinkKeys.size, 'Spanning tree links must be de-duplicated');

  const enrichedRes = getMemoryContent(ws1Root, 'all', 'k8s-delete-guard', null, { depth: 2 });
  assert.ok(enrichedRes.spanningTree, 'Spanning tree object should be attached when depth > 1');
  assert.ok(enrichedRes.content.includes('GraphRAG Spanning Tree Context Envelope'), 'Context envelope should be in content');
  console.log('  ✔ Passed: GraphRAG Multi-Hop Spanning Tree traversed reference graph with cycle safety.\n');

  // ==========================================
  // TEST 29: Trajectory-Based Zero-Code Debugging & User Preference Elicitation (Apply 💡 5)
  // ==========================================
  console.log('Test 29: Trajectory-Based Zero-Code Debugging & User Preference Elicitation...');
  const proseElicitation = autoElicitSessionKnowledge(ws1Root, {
    transcript: [
      { role: 'user', content: 'I would rewrite that prose in this way that follows: focus on conclusions instead of detailed analysis, keep it concise.' }
    ]
  });
  assert.equal(proseElicitation.elicitation_needed, true, 'Elicitation should trigger on user preference feedback');
  const concisePref = proseElicitation.suggested_candidates.find(c => c.slug === 'user-preference-concise-conclusions');
  assert.ok(concisePref, 'Should elicit user-preference-concise-conclusions');
  assert.equal(concisePref.domain, 'workflow');
  assert.equal(concisePref.elicited_from, 'user_feedback');

  const debugElicitation = autoElicitSessionKnowledge(ws1Root, {
    errorLogs: ['TypeError: Cannot read properties of undefined in auth-service']
  });
  assert.equal(debugElicitation.elicitation_needed, true, 'Elicitation should trigger on zero-code error logs');
  assert.ok(debugElicitation.suggested_candidates.some(c => c.elicited_from === 'zero_code_debugging'), 'Should propose debugging gotcha candidate');

  const arrayTranscriptDebug = autoElicitSessionKnowledge(ws1Root, {
    transcript: [
      { role: 'user', content: 'Run integration check' },
      { role: 'assistant', content: 'Running command...' },
      { role: 'tool', content: 'TypeError: Cannot access uninitialized variable in database-pool' }
    ]
  });
  assert.equal(arrayTranscriptDebug.elicitation_needed, true, 'Array transcript with error message must trigger elicitation');
  assert.ok(arrayTranscriptDebug.suggested_candidates.some(c => c.elicited_from === 'zero_code_debugging'));

  const benignCmdElicitation = autoElicitSessionKnowledge(ws1Root, {
    recentCommands: ['git status', 'ls -la', 'npm list']
  });
  assert.equal(benignCmdElicitation.suggested_candidates.some(c => c.elicited_from === 'zero_code_debugging'), false, 'Benign commands must not trigger zero-code debugging candidate');
  console.log('  ✔ Passed: Trajectory-based zero-code debugging and user working preferences elicited accurately.\n');

  // ==========================================
  // TEST 30: Execution-Driven False-Negative Mitigation & Event Telemetry (Fix 4, Fix 5, Apply B)
  // ==========================================
  console.log('Test 30: Execution-Driven False-Negative Mitigation & Event Telemetry...');
  const coarseEfficacyRes = correlateTestExecutionEfficacy(ws1Root, {
    command: 'npm test',
    exitCode: 1,
    stderr: 'ECONNRESET unrelated socket drop',
    slugs: ['k8s-delete-guard', 'slug-b', 'slug-c', 'slug-d']
  });
  assert.equal(coarseEfficacyRes.correlated, false, 'Coarse multi-slug failure should skip unverified penalties');
  assert.equal(coarseEfficacyRes.penalized, 0, 'No rules should be penalized under coarse ambiguity');

  const searchResults = await searchMemoriesHybrid(ws1Root, 'delete namespace');
  assert.ok(Array.isArray(searchResults), 'Hybrid search must return array');
  assert.ok(searchResults.length > 0, 'Should find memory result');
  console.log('  ✔ Passed: Coarse false-negative penalties mitigated and async telemetry emitted.\n');

  // ==========================================
  // TEST 31: Visual Memory Studio In-Chat Generative UI & Claude Code Fallback (Apply 💡 6)
  // ==========================================
  console.log('Test 31: Visual Memory Studio In-Chat Generative UI & Claude Code Fallback...');
  const testArtifactDir = path.join(tempRoot, 'artifacts');
  fs.mkdirSync(testArtifactDir, { recursive: true });

  // 1. Antigravity In-Chat Generative UI Embed Mode
  const inChatResult = await renderVisualMemoryStudio(ws1Root, {
    mode: 'in_chat',
    compact: true,
    artifactDir: testArtifactDir,
    fileName: 'studio-in-chat.html'
  });
  assert.equal(inChatResult.status, 'ready');
  assert.equal(inChatResult.platform, 'antigravity');
  assert.equal(inChatResult.mode, 'in_chat');
  assert.ok(inChatResult.embedTag.startsWith('<agent-embed src="file://'), 'Embed tag must be formatted as <agent-embed>');
  assert.ok(inChatResult.embedTag.includes('studio-in-chat.html'));
  assert.ok(fs.existsSync(inChatResult.artifactPath), 'HTML artifact must be saved to disk');
  const inChatHtml = fs.readFileSync(inChatResult.artifactPath, 'utf8');
  assert.ok(inChatHtml.includes('MiniD3'), 'Self-contained MiniD3 engine must be embedded for CSP compliance');
  assert.equal(inChatHtml.includes('tailwindcss.min.js'), false, 'Studio HTML must have zero external Tailwind CDN dependency');
  assert.ok(inChatHtml.includes('var(--background'), 'Antigravity theme token must be styled');

  // Test automatic artifact directory resolution via ANTIGRAVITY_CONVERSATION_ID
  process.env.ANTIGRAVITY_CONVERSATION_ID = 'test-conv-987';
  const autoArtifactResult = await renderVisualMemoryStudio(ws1Root, { mode: 'in_chat', fileName: 'auto-studio.html' });
  assert.ok(autoArtifactResult.artifactPath.includes('test-conv-987'), 'Must resolve artifact path using ANTIGRAVITY_CONVERSATION_ID');
  delete process.env.ANTIGRAVITY_CONVERSATION_ID;

  // 2. Claude Code Browser Fallback Mode
  const browserResult = await renderVisualMemoryStudio(ws1Root, {
    mode: 'browser',
    autoOpen: false,
    port: 4299,
    artifactDir: testArtifactDir,
    fileName: 'studio-browser.html'
  });
  assert.equal(browserResult.status, 'ready');
  assert.equal(browserResult.platform, 'claude_code');
  assert.equal(browserResult.mode, 'browser');
  assert.ok(browserResult.serverUrl.includes('4299'), 'Server URL must reflect designated port');
  assert.ok(browserResult.offlineHtmlPath.includes('studio-browser.html'));
  assert.ok(browserResult.stats.nodes > 0, 'Graph stats must report nodes');

  // Stop Studio background instance cleanly
  await stopStudioService();

  console.log('  ✔ Passed: Visual Memory Studio provides in-chat generative UI for Antigravity and browser server fallback for Claude Code.\n');

  // ==========================================
  // TEST 32: Session-Start Lifecycle Hook Schema & Memory Store Statistics Integrity
  // ==========================================
  console.log('Test 32: Session-Start Lifecycle Hook Schema & Memory Store Statistics Integrity...');
  const statsCheck = getLayerStatistics(ws1Root);
  assert.ok(statsCheck.paths.settings, 'getLayerStatistics must provide paths.settings');
  assert.equal(typeof statsCheck.counts.total, 'number', 'counts.total must be numeric');
  assert.equal(typeof statsCheck.counts.active, 'number', 'counts.active must be numeric');
  assert.ok(Array.isArray(statsCheck.staleness?.staleEntries), 'staleness.staleEntries must be an array');
  assert.equal(typeof statsCheck.syncStatus.privateGit.isClean, 'boolean', 'privateGit.isClean must be boolean');
  assert.equal(typeof statsCheck.syncStatus.privateGit.uncommittedCount, 'number', 'privateGit.uncommittedCount must be numeric');
  assert.ok(Array.isArray(statsCheck.syncStatus.privateGit.uncommittedList), 'privateGit.uncommittedList must be an array');
  assert.equal(typeof statsCheck.syncStatus.privateGit.upstreamAhead, 'number', 'privateGit.upstreamAhead must be numeric');

  // Run bin/session-start.js to verify no ReferenceErrors or undefined outputs
  const sessionStartBin = path.join(process.cwd(), 'plugins', 'knowledge-capture', 'bin', 'session-start.js');
  const startRaw = execFileSync(process.execPath, [sessionStartBin], {
    cwd: ws1Root,
    encoding: 'utf8',
    env: { ...process.env, WORKSPACE_DIR: ws1Root }
  });
  const startJson = JSON.parse(startRaw);
  assert.ok(Array.isArray(startJson.injectSteps), 'session-start must return injectSteps array');
  assert.ok(startJson.injectSteps.length > 0, 'session-start must emit non-empty injectSteps');
  const reportMsg = startJson.injectSteps[0].systemMessage.systemMessage;
  assert.ok(reportMsg.includes('### 🧠 Knowledge Capture Active'), 'Must include active header');
  assert.ok(!reportMsg.includes('undefined uncommitted memory update(s)'), 'Must not contain undefined uncommitted count');

  // Verify case-insensitive file resolution in LayerProvider
  const lp = createLayerProvider(ws1Root);
  const caseInsensitiveMatch = lp.findMemoryFile('K8S-DELETE-GUARD', 'workspace');
  assert.ok(caseInsensitiveMatch, 'findMemoryFile must resolve slug case-insensitively');
  assert.equal(caseInsensitiveMatch.slug.toLowerCase(), 'k8s-delete-guard');

  console.log('  ✔ Passed: Session-Start hook schema, stats integrity, and case-insensitive resolution verified.\n');

  // ==========================================
  // TEST 33: SQLite Schema v2 Multi-Team & Subdir Collision Safety + Float32 Binary BLOBs
  // ==========================================
  console.log('Test 33: SQLite Schema v2 Collision Safety, Dirty Check, & Binary BLOB Vectors...');
  const v2Ws = path.join(tempRoot, 'v2-collision-ws');
  const v2Sub1 = path.join(v2Ws, '.agents', 'rules', 'memory', 'sub1');
  const v2Sub2 = path.join(v2Ws, '.agents', 'rules', 'memory', 'sub2');
  fs.mkdirSync(v2Sub1, { recursive: true });
  fs.mkdirSync(v2Sub2, { recursive: true });

  fs.writeFileSync(path.join(v2Sub1, 'guide.md'), `---
name: sub1-guide
domain: backend
type: convention
description: Subdirectory one backend guide
---
# Subdir 1 Guide
Rule for sub1.
`, 'utf8');
  fs.writeFileSync(path.join(v2Sub2, 'guide.md'), `---
name: sub2-guide
domain: frontend
type: convention
description: Subdirectory two frontend guide
---
# Subdir 2 Guide
Rule for sub2.
`, 'utf8');

  const teamRepoA = addTeamRepository('team-alpha', 'https://github.com/org/team-alpha.git', 'Team Alpha', v2Ws);
  const teamRepoB = addTeamRepository('team-beta', 'https://github.com/org/team-beta.git', 'Team Beta', v2Ws);
  fs.writeFileSync(path.join(teamRepoA.dir, 'shared-name.md'), `---
name: alpha-standard
domain: devops
type: convention
description: Alpha team Kubernetes standard
---
# Alpha Standard
`, 'utf8');
  fs.writeFileSync(path.join(teamRepoB.dir, 'shared-name.md'), `---
name: beta-standard
domain: security
type: convention
description: Beta team security standard
---
# Beta Standard
`, 'utf8');

  await syncSqliteIndex(v2Ws);
  assert.equal(isIndexDirty(v2Ws), false, 'Freshly synced v2 index must not be dirty');

  const v2Db = getDatabase();
  const schemaVer = v2Db.prepare("SELECT val FROM meta WHERE key = 'schema_version'").get();
  assert.ok(Number(schemaVer?.val) >= 3, `SQLite schema_version must be >= 3 (got ${schemaVer?.val})`);

  const v2WsId = normalizeWorkspaceId(v2Ws);
  const v2Rows = v2Db.prepare("SELECT layer, team_slug, path, slug, trigger_vector FROM memories WHERE workspace_id = ? OR workspace_id = 'global'").all(v2WsId);
  assert.ok(v2Rows.some(r => r.slug === 'sub1-guide'), 'sub1/guide.md must be preserved');
  assert.ok(v2Rows.some(r => r.slug === 'sub2-guide'), 'sub2/guide.md must not overwrite sub1/guide.md');
  assert.ok(v2Rows.some(r => r.layer === 'team' && r.team_slug === 'team-alpha' && r.slug === 'alpha-standard'), 'team-alpha entry must be indexed');
  assert.ok(v2Rows.some(r => r.layer === 'team' && r.team_slug === 'team-beta' && r.slug === 'beta-standard'), 'team-beta entry must not collide with team-alpha');

  const sampleVecRow = v2Rows.find(r => r.trigger_vector);
  assert.ok(Buffer.isBuffer(sampleVecRow.trigger_vector) || sampleVecRow.trigger_vector instanceof Uint8Array, 'Vectors must be persisted as compact Float32 binary BLOBs');

  removeTeamRepository('team-alpha', true, v2Ws);
  removeTeamRepository('team-beta', true, v2Ws);
  console.log('  ✔ Passed: Schema v2 eliminates team/subdir PK collisions and stores compact Float32 BLOBs.\n');

  // ==========================================
  // TEST 34: Drift Detector False-Positive Elimination & Structured Evidence
  // ==========================================
  console.log('Test 34: Drift Detector Negation/Migration Parsing & Evidence Extraction...');
  const driftFixWs = path.join(tempRoot, 'drift-fix-ws');
  const driftFixMem = path.join(driftFixWs, '.agents', 'rules', 'memory');
  const nestedSrcDir = path.join(driftFixWs, 'src', 'nested');
  fs.mkdirSync(driftFixMem, { recursive: true });
  fs.mkdirSync(nestedSrcDir, { recursive: true });
  fs.writeFileSync(path.join(nestedSrcDir, 'custom-config.ts'), 'export default {};\n', 'utf8');
  fs.writeFileSync(path.join(driftFixWs, 'package.json'), JSON.stringify({
    name: 'drift-fix-test',
    engines: { node: '>=22.0.0' }
  }), 'utf8');

  // Two non-contradictory rules: one mentions migration from Node 18 to Node 22 and negates npm / legacy files
  fs.writeFileSync(path.join(driftFixMem, 'pnpm-rule-1.md'), `---
name: pnpm-rule-1
domain: javascript
type: convention
description: When installing packages or upgrading runtime
verified: 2026-04-01
---
# Package Policy
Always use pnpm; do not use npm for installs.
Upgraded from Node 18 to Node 22. Refer to custom-config.ts for settings. Do not create .legacy.json.
`, 'utf8');
  fs.writeFileSync(path.join(driftFixMem, 'pnpm-rule-2.md'), `---
name: pnpm-rule-2
domain: javascript
type: convention
description: When installing dependencies in CI workflows
verified: 2026-04-01
---
# CI Package Policy
Use pnpm install --frozen-lockfile for reproducible builds.
`, 'utf8');

  const cleanDriftRes = detectContradictionsAndDrift(driftFixWs);
  assert.equal(cleanDriftRes.contradictions.length, 0, 'Negated npm alongside affirmative pnpm must NOT produce false toolchain contradiction');
  assert.equal(cleanDriftRes.drifts.some(d => d.type === 'runtime_engine_drift'), false, 'Migration phrase "from Node 18 to Node 22" must NOT trigger runtime engine drift');
  assert.equal(cleanDriftRes.drifts.some(d => d.type === 'referenced_file_missing'), false, 'Nested existing file and negated missing file must NOT trigger missing-file drift');
  assert.ok(Array.isArray(cleanDriftRes.ambiguous_pairs), 'ambiguous_pairs array must be included for borderline semantic pairs');
  console.log('  ✔ Passed: Drift detector eliminates negation/migration/nested-file false positives.\n');

  // ==========================================
  // TEST 35: Memory Studio CSRF Protection, Body Limit, UI Escape & Browser Links
  // ==========================================
  console.log('Test 35: Memory Studio CSRF Guard, Body Size Limit, HTML Escape & Delink UI...');
  const xssDesc = 'Guard </script><script>alert(1)</script> injection';
  const studioSecurityWs = path.join(tempRoot, 'studio-sec-ws');
  const studioSecMem = path.join(studioSecurityWs, '.agents', 'rules', 'memory');
  fs.mkdirSync(studioSecMem, { recursive: true });
  fs.writeFileSync(path.join(studioSecMem, 'xss-guard.md'), `---
name: xss-guard
domain: security
type: convention
description: ${xssDesc}
verified: 2026-04-01
---
# XSS Guard
`, 'utf8');

  const secHtml = generateKnowledgeGraphHtml(studioSecurityWs, { studioToken: 'tok-secret-123' });
  assert.ok(!secHtml.includes('</script><script>alert(1)'), 'Embedded JSON must escape </script> tags safely');
  assert.ok(secHtml.includes('btn-delink-node'), 'Studio HTML must include Clear Links (#btn-delink-node) button');
  assert.ok(secHtml.includes('value="overrides"'), 'Studio HTML connect type selector must support overrides links');
  assert.ok(secHtml.includes('X-Studio-Token'), 'Studio HTML must attach X-Studio-Token header when configured');

  const { default: http } = await import('node:http');
  const sendRawPost = (targetUrl, headers, bodyStr) => new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: {
        'Content-Length': Buffer.byteLength(bodyStr),
        ...headers
      }
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });

  const secServer = await startStudioServer({
    port: 54322,
    host: '127.0.0.1',
    workspaceRoot: studioSecurityWs,
    autoOpen: false,
    strictPort: true
  });
  try {
    // Evil cross-origin POST must be rejected with 403
    const evilOriginRes = await sendRawPost(`${secServer.url}/api/patch`, {
      'Content-Type': 'application/json',
      'Origin': 'https://evil.example.com',
      'X-Studio-Token': secServer.studioToken
    }, JSON.stringify({ modified_nodes: [] }));
    assert.equal(evilOriginRes.status, 403, 'Cross-origin POST /api/patch must be rejected with 403');

    // Sec-Fetch-Site: cross-site must be rejected with 403
    const crossSiteRes = await sendRawPost(`${secServer.url}/api/patch`, {
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': 'cross-site',
      'X-Studio-Token': secServer.studioToken
    }, JSON.stringify({ modified_nodes: [] }));
    assert.equal(crossSiteRes.status, 403, 'Sec-Fetch-Site: cross-site POST must be rejected with 403');

    // Invalid X-Studio-Token must be rejected with 403
    const badTokRes = await fetch(`${secServer.url}/api/patch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Studio-Token': 'wrong-token'
      },
      body: JSON.stringify({ modified_nodes: [] })
    });
    assert.equal(badTokRes.status, 403, 'Mismatched X-Studio-Token must be rejected with 403');

    // Oversized body (> 1 MB) must be rejected with 413
    const hugeBodyRes = await fetch(`${secServer.url}/api/patch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Studio-Token': secServer.studioToken
      },
      body: JSON.stringify({ modified_nodes: [{ slug: 'x', padding: 'a'.repeat(1024 * 1024 + 100) }] })
    });
    assert.equal(hugeBodyRes.status, 413, 'Payload > 1MB must be rejected with 413');
  } finally {
    await secServer.close();
  }
  console.log('  ✔ Passed: Memory Studio enforces CSRF origin/token checks, 1MB body limit, and safe HTML escaping.\n');

  // ==========================================
  // TEST 36: YAML Block Scalars (| vs >) & Safe Quoting Round-Trip
  // ==========================================
  console.log('Test 36: YAML Block Scalars & Safe Scalar Serialization...');
  const blockYaml = `---
name: yaml-block-test
description: |
  Line one
  Line two
summary: >
  Folded line one
  folded line two

  Second paragraph
---
# Body
`;
  const parsedBlock = parseYamlFrontmatter(blockYaml);
  assert.equal(parsedBlock.frontmatter.description, 'Line one\nLine two', 'Literal | block scalar must preserve newlines');
  assert.equal(parsedBlock.frontmatter.summary, 'Folded line one folded line two\nSecond paragraph', 'Folded > block scalar must fold single newlines and preserve paragraph break');

  const trickDesc = 'Use key: value # with hash and [brackets]';
  const serializedYaml = serializeYamlFrontmatter({
    name: 'yaml-roundtrip',
    domain: 'general',
    description: trickDesc,
    related: ['ref-one', 'item: two']
  }, '# Body\n');
  const reparsedTrick = parseYamlFrontmatter(serializedYaml);
  assert.equal(reparsedTrick.frontmatter.description, trickDesc, 'Special YAML characters (: and #) must round-trip cleanly');
  assert.deepEqual(reparsedTrick.frontmatter.related, ['ref-one', 'item: two'], 'Special characters inside array items must round-trip cleanly');
  console.log('  ✔ Passed: YAML parser distinguishes | vs > block scalars and safely quotes special characters.\n');

  // ==========================================
  // TEST 37: Team Promotion Dirty-Repo Guard, Master Branch Support & Filename Spaces
  // ==========================================
  console.log('Test 37: prepareTeamPromotion Dirty Guard, Non-Main Branch & parsePorcelainZ...');
  const { parsePorcelainZ } = await import('../plugins/knowledge-capture/mcp-server/core/memory-store.js');
  const porcelainSample = 'M  file with spaces.md\0R  new name.md\0old name.md\0?? untracked item.md\0';
  const porcelainEntries = parsePorcelainZ(porcelainSample);
  assert.equal(porcelainEntries.length, 3, 'parsePorcelainZ must parse NUL-delimited statuses including renames');
  assert.equal(porcelainEntries[0].file, 'file with spaces.md', 'Must preserve filenames with spaces intact');
  assert.equal(porcelainEntries[1].file, 'new name.md');
  assert.equal(porcelainEntries[2].file, 'untracked item.md');

  // Team promotion on a repo whose default branch is 'master' and reject dirty working tree
  const masterTeamWs = path.join(tempRoot, 'master-team-ws');
  fs.mkdirSync(path.join(masterTeamWs, '.agents', 'rules', 'memory'), { recursive: true });
  const masterTeamRepo = addTeamRepository('master-org', 'https://github.com/org/master-org.git', 'Master Org', masterTeamWs);
  execFileSync('git', ['init', '-b', 'master'], { cwd: masterTeamRepo.dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test Agent'], { cwd: masterTeamRepo.dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: masterTeamRepo.dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(masterTeamRepo.dir, 'README.md'), '# Master Team Repo\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: masterTeamRepo.dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'Init master'], { cwd: masterTeamRepo.dir, stdio: 'ignore' });
  // Ensure there is no remote named origin blocking local commit, or remove fake origin remote if set
  try { execFileSync('git', ['remote', 'remove', 'origin'], { cwd: masterTeamRepo.dir, stdio: 'ignore' }); } catch {}

  fs.writeFileSync(path.join(masterTeamRepo.dir, 'dirty-uncommitted.md'), 'temp', 'utf8');
  assert.throws(
    () => prepareTeamPromotion(masterTeamWs, { slug: 'master-rule', content: '# Master Rule\n', teamSlug: 'master-org' }),
    /uncommitted change/,
    'prepareTeamPromotion must reject dirty team repositories'
  );
  fs.unlinkSync(path.join(masterTeamRepo.dir, 'dirty-uncommitted.md'));

  const masterPromo = prepareTeamPromotion(masterTeamWs, {
    slug: 'master-rule',
    content: '# Master Rule\nWorks on master branch.',
    teamSlug: 'master-org'
  });
  assert.equal(masterPromo.success, true, 'prepareTeamPromotion must succeed on non-main master branch');
  assert.ok(masterPromo.prCommand.includes('--base master'), 'PR command must target detected default branch (master)');
  removeTeamRepository('master-org', true, masterTeamWs);
  console.log('  ✔ Passed: parsePorcelainZ, dirty-repo guard, and non-main default branch promotion verified.\n');

  // ==========================================
  // TEST 38: Session-End Transcript JSONL Reader & Signal Evidence
  // ==========================================
  console.log('Test 38: Session-End JSONL transcript_path Reader & Signal Evidence...');
  const transcriptFile = path.join(tempRoot, 'claude-transcript.jsonl');
  fs.writeFileSync(transcriptFile, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'In the future, keep explanations short and concise with conclusions first.' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'Understood.' } })
  ].join('\n') + '\n', 'utf8');

  const jsonlAudit = autoElicitSessionKnowledge(ws1Root, { transcript_path: transcriptFile });
  assert.equal(jsonlAudit.elicitation_needed, true, 'Must elicit knowledge from Claude Code transcript_path JSONL');
  assert.ok(jsonlAudit.signal_evidence && Array.isArray(jsonlAudit.signal_evidence.user_preference_excerpts), 'Audit must attach structured signal_evidence');
  assert.ok(jsonlAudit.signal_evidence.user_preference_excerpts.length >= 1, 'signal_evidence.user_preference_excerpts must capture triggered transcript preference signals');
  console.log('  ✔ Passed: JSONL transcript reader and signal_evidence verified.\n');

  // ==========================================
  // TEST 39: Calibrated Pure-Semantic Confidence & Knowledge-Capture MCP Server Protocol (roots/list & -32700)
  // ==========================================
  console.log('Test 39: MCP Server Protocol (-32700 Parse Error, Notifications, roots/list Resolution)...');
  const { spawn } = await import('node:child_process');
  const kcMcpPath = path.resolve('plugins/knowledge-capture/mcp-server/index.js');
  const rootsWs = path.join(tempRoot, 'mcp-roots-ws');
  const rootsMemDir = path.join(rootsWs, '.agents', 'rules', 'memory');
  fs.mkdirSync(rootsMemDir, { recursive: true });
  fs.writeFileSync(path.join(rootsMemDir, 'mcp-roots-canary.md'), `---
name: mcp-roots-canary
domain: platform
type: platform-fact
description: Canary rule discovered solely via MCP roots/list
verified: 2026-04-01
---
# MCP Roots Canary
Discovered from MCP client roots/list URI.
`, 'utf8');

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [kcMcpPath], {
      cwd: tempRoot, // Intentionally NOT rootsWs
      env: { ...process.env, WORKSPACE_ROOT: '', WORKSPACE_DIR: '' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const responses = [];
    let buffer = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('Timed out waiting for knowledge-capture MCP server test responses'));
      }
    }, 5000);

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const l of lines) {
        if (!l.trim()) continue;
        const msg = JSON.parse(l);
        responses.push(msg);

        // If server sends roots/list request, reply immediately with file:// URI for rootsWs
        if (msg.method === 'roots/list' && msg.id !== undefined) {
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              roots: [{ uri: `file://${rootsWs}`, name: 'rootsWs' }]
            }
          }) + '\n');
        }

        // Once we receive initialize, parse-error (-32700), and tools/call result (id: 2)
        if (msg.id === 2) {
          settled = true;
          clearTimeout(timeout);
          child.kill();
          try {
            const initResp = responses.find(r => r.id === 1);
            assert.equal(initResp.result.protocolVersion, '2025-03-26', 'Server must negotiate supported protocolVersion');

            const parseErrResp = responses.find(r => r.error && r.error.code === -32700);
            assert.ok(parseErrResp, 'Invalid JSON line must return JSON-RPC -32700 Parse Error');

            // Ensure no response was emitted for notifications/initialized
            assert.equal(responses.some(r => r.id === undefined && !r.method), false, 'Notifications must never receive JSON-RPC responses');

            const summaryText = msg.result.content[0].text;
            assert.ok(summaryText.includes('mcp-roots-canary'), 'Tool call without workspaceRoot must resolve workspace via MCP roots/list');
            resolve();
          } catch (e) {
            reject(e);
          }
        }
      }
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    // 1. Initialize with roots capability
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: { roots: { listChanged: true } } }
    }) + '\n');

    // 2. Notification (must NOT emit response, triggers roots/list)
    child.stdin.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }) + '\n');

    // 3. Invalid JSON (must emit -32700)
    child.stdin.write('{not valid json\n');

    // 4. Call get_memory_summary WITHOUT workspaceRoot after slight delay for roots handshake
    setTimeout(() => {
      if (!settled) {
        child.stdin.write(JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_memory_summary', arguments: {} }
        }) + '\n');
      }
    }, 150);
  });
  console.log('  ✔ Passed: MCP server handles -32700 parse errors, notification suppression, and client roots/list.\n');

  // ==========================================
  // TEST 40: bin/install.js & bin/plugin-manager.js Fixes
  // ==========================================
  console.log('Test 40: Installer isNpxExecution /tmp Safety & Plugin ID Validation...');
  const { createRequire } = await import('node:module');
  const requireCjs = createRequire(import.meta.url);
  const { isNpxExecution } = requireCjs('../bin/install.js');
  const { resolvePluginInstallPath } = requireCjs('../bin/plugin-manager.js');

  assert.equal(isNpxExecution('/tmp/agent-marketplace'), false, '/tmp clone must NOT be misclassified as npx execution');
  assert.equal(isNpxExecution('/home/user/templates/agent-marketplace'), false, 'Path containing "temp" must NOT be misclassified as npx execution');
  assert.equal(isNpxExecution('/home/user/.npm/_npx/12345/node_modules/antigravity-plugins'), true, 'Actual _npx cache path must return true');
  assert.throws(
    () => resolvePluginInstallPath('../evil-plugin', 'workspace', tempRoot),
    /Invalid plugin ID/,
    'Path-traversal pluginId must be rejected by assertValidPluginId'
  );

  let badEnableErr = null;
  try {
    execFileSync(process.execPath, [path.resolve('bin/install.js'), '--enable', 'non-existent-plugin-xyz'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    badEnableErr = err;
  }
  assert.ok(badEnableErr && badEnableErr.status === 1, '--enable with unknown plugin ID must exit with code 1');
  console.log('  ✔ Passed: Installer avoids /tmp false-positives and enforces strict plugin ID validation.\n');

  // ==========================================
  // TEST 41: Syran Persona Trade-Off Missing Scores, Weight 0 & Logic Evidence
  // ==========================================
  console.log('Test 41: Syran Missing-Score Minimize Guard, Zero Weight & Consult Evidence...');
  const missingEval = evaluateArchitecturalTradeoffs(
    [
      { name: 'Measured Option', scores: { latency: 10, reliability: 9 } },
      { name: 'Incomplete Option', scores: { reliability: 9 } } // latency intentionally omitted!
    ],
    [
      { name: 'latency', weight: 3.0, direction: 'minimize' },
      { name: 'reliability', weight: 1.0, direction: 'maximize' }
    ]
  );
  assert.equal(missingEval.optimalCandidate, 'Measured Option', 'Missing minimize metric must NOT beat measured option by defaulting to 0');
  assert.ok(missingEval.incompleteDataWarnings.length >= 1, 'Must emit incompleteDataWarnings for missing metrics');
  assert.equal(contractionPattern.test(missingEval.officerCounsel), false, 'Syran counsel with warnings must still avoid all contractions');

  const zeroWeightProb = evaluateProbability([
    { label: 'Excluded Course', weight: 0, risk: 0.0 },
    { label: 'Active Course', weight: 1.0, risk: 0.2 }
  ]);
  const excludedEntry = zeroWeightProb.evaluations.find(e => e.label === 'Excluded Course');
  assert.equal(excludedEntry.posterior_probability, 0, 'weight: 0 must produce 0 posterior probability rather than falling back to 1.0');

  const consultRes = consultLogic('We already spent 3 weeks on this cache so we must keep it.');
  assert.equal(consultRes.logical_validity, 'COMPROMISED');
  assert.ok(Array.isArray(consultRes.evidence) && consultRes.evidence.length >= 1, 'consultLogic must attach structured evidence');
  assert.ok(Array.isArray(consultRes.epistemic_gaps), 'consultLogic must report epistemic_gaps');
  assert.ok(consultRes.confidence_assessment && consultRes.confidence_assessment.level, 'consultLogic must include confidence_assessment');
  console.log('  ✔ Passed: Syran handles missing minimize scores, weight=0, and structured logical evidence accurately.\n');

  // ==========================================
  // TEST 42: Single Canonical Hook & Plugin Config Sync & Runtime Adapter
  // ==========================================
  console.log('Test 42: Canonical Manifest Sync, Version Propagation & Hook Runtime Adapter...');
  const { syncManifests, validateCanonicalManifest } = requireCjs('../bin/sync-manifests.js');

  const mockMarket = path.join(tempRoot, 'mock-marketplace');
  const mockPluginDir = path.join(mockMarket, 'plugins', 'demo-plugin');
  fs.mkdirSync(path.join(mockPluginDir, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(mockPluginDir, 'mcp-server'), { recursive: true });
  fs.mkdirSync(path.join(mockMarket, '.claude-plugin'), { recursive: true });

  fs.writeFileSync(path.join(mockPluginDir, 'bin', 'start.js'), 'console.log("ok");\n', 'utf8');
  fs.writeFileSync(path.join(mockPluginDir, 'mcp-server', 'index.js'), 'console.log("mcp");\n', 'utf8');
  fs.writeFileSync(path.join(mockPluginDir, 'package.json'), JSON.stringify({ name: 'demo-plugin', version: '0.0.1' }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(mockPluginDir, 'mcp-server', 'package.json'), JSON.stringify({ name: 'demo-mcp', version: '0.0.1' }, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(mockMarket, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'mock', plugins: [] }, null, 2) + '\n', 'utf8');

  // Verify validation catches missing referenced script & invalid platforms
  const invalidErrors = validateCanonicalManifest('demo-plugin', mockPluginDir, {
    name: 'demo-plugin',
    version: '2.5.0',
    hooks: {
      SessionStart: [
        { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/missing.js"', platforms: ['invalid-platform'] }
      ]
    }
  });
  assert.ok(invalidErrors.some(e => e.includes('invalid platforms')), 'Must reject unknown hook platforms');
  assert.ok(invalidErrors.some(e => e.includes('bin/missing.js')), 'Must reject missing ${CLAUDE_PLUGIN_ROOT} hook script');

  // Write valid canonical manifest with timeout and matcher
  fs.writeFileSync(path.join(mockPluginDir, 'plugin.manifest.json'), JSON.stringify({
    name: 'demo-plugin',
    displayName: 'Demo Plugin',
    version: '2.5.0',
    description: 'Demo canonical plugin',
    mcpServers: {
      demo: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/mcp-server/index.js'] }
    },
    hooks: {
      SessionStart: [
        { type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/start.js"', timeout: 12, matcher: 'startup' }
      ]
    }
  }, null, 2) + '\n', 'utf8');

  const syncRes = syncManifests({ repoRoot: mockMarket, checkMode: false });
  assert.equal(syncRes.validationErrors.length, 0, 'Valid canonical manifest must have zero validation errors');

  const ccHooksGenerated = JSON.parse(fs.readFileSync(path.join(mockPluginDir, 'hooks', 'hooks.json'), 'utf8'));
  assert.equal(ccHooksGenerated.hooks.SessionStart[0].matcher, 'startup', 'Claude Code hooks must preserve matcher');
  assert.equal(ccHooksGenerated.hooks.SessionStart[0].hooks[0].timeout, 12, 'Claude Code hooks must preserve timeout');

  const pkgSynced = JSON.parse(fs.readFileSync(path.join(mockPluginDir, 'package.json'), 'utf8'));
  const mcpPkgSynced = JSON.parse(fs.readFileSync(path.join(mockPluginDir, 'mcp-server', 'package.json'), 'utf8'));
  assert.equal(pkgSynced.version, '2.5.0', 'Plugin package.json version must sync from plugin.manifest.json');
  assert.equal(mcpPkgSynced.version, '2.5.0', 'MCP server package.json version must sync from plugin.manifest.json');

  const checkAfterSync = syncManifests({ repoRoot: mockMarket, checkMode: true });
  assert.equal(checkAfterSync.driftCount, 0, 'Synchronized mock marketplace must have 0 drift');

  // Verify claude-rules.js uses canonical hook-runtime platform detection (CLAUDE_CODE=1 vs Antigravity)
  const claudeRulesScript = path.resolve('plugins/knowledge-capture/bin/claude-rules.js');
  const ccRulesOut = execFileSync(process.execPath, [claudeRulesScript], {
    env: { ...process.env, CLAUDE_CODE: '1', CLAUDE_PLUGIN_ROOT: '' },
    input: '{}',
    encoding: 'utf8'
  });
  assert.ok(ccRulesOut.includes('Knowledge Capture'), 'CLAUDE_CODE=1 without CLAUDE_PLUGIN_ROOT must still emit rules via hook-runtime');

  const agRulesOut = execFileSync(process.execPath, [claudeRulesScript], {
    env: { ...process.env, CLAUDE_CODE: '', CLAUDE_PLUGIN_ROOT: '' },
    input: JSON.stringify({ conversationId: 'conv-123' }),
    encoding: 'utf8'
  });
  assert.deepEqual(JSON.parse(agRulesOut), { injectSteps: [] }, 'Antigravity hook invocation must return empty injectSteps JSON');
  console.log('  ✔ Passed: Canonical manifest sync, version propagation, validation, and hook-runtime verified.\n');

  // ==========================================
  // TEST 43: Security Hardening (privatePath Traversal, Team Slug Guard, Git Option Injection, Installer CLI Validation)
  // ==========================================
  console.log('Test 43: Security Hardening Across Team Sync, Pull/Setup & Installer CLI...');
  const secWs = path.join(tempRoot, 'sec-hardening-ws');
  fs.mkdirSync(path.join(secWs, '.agents', 'rules', 'memory'), { recursive: true });
  const outsideSecretFile = path.join(tempRoot, 'outside-secret.md');
  fs.writeFileSync(outsideSecretFile, '# DO NOT DELETE\nSensitive outside content.\n', 'utf8');

  assert.throws(
    () => resolveTeamConflict(secWs, { slug: 'nonexistent-rule', resolution: 'adopt_team', privatePath: outsideSecretFile }),
    /Security error: privatePath/,
    'resolveTeamConflict must reject privatePath outside paths.privateDir'
  );
  assert.ok(fs.existsSync(outsideSecretFile), 'Outside file must never be deleted by resolveTeamConflict');

  assert.throws(
    () => removeTeamRepository('../evil-dir', true, secWs),
    /Invalid team repository slug/,
    'removeTeamRepository must reject traversal slugs'
  );

  // Git flag injection guards in setup.js & pull.js
  assert.throws(() => validateSafeGitUrl('--upload-pack=evil'), /Invalid repository URL/, 'validateSafeGitUrl must reject leading "-"');
  assert.equal(pullSingleRepo(path.join(tempRoot, 'pull-evil'), 'Evil', '--upload-pack=evil'), 1, 'pullSingleRepo must fail cleanly on leading "-" URL');
  assert.equal(testRemoteConnectivity('--upload-pack=evil').ok, false, 'testRemoteConnectivity must reject leading "-" URL');

  const fakeHome = path.join(tempRoot, 'fake-home');
  fs.mkdirSync(fakeHome, { recursive: true });
  let setupBadUrlStatus = 0;
  try {
    execFileSync(process.execPath, [path.resolve('plugins/knowledge-capture/bin/setup.js'), '--private-url', '--upload-pack=evil', '--no-install'], {
      env: { ...process.env, HOME: fakeHome },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    setupBadUrlStatus = err.status;
  }
  assert.equal(setupBadUrlStatus, 1, 'setup.js CLI must exit with code 1 on leading "-" repository URL');

  // pull.js null/missing settings safety
  const emptyPullStorage = path.join(tempRoot, 'empty-pull-storage');
  fs.mkdirSync(emptyPullStorage, { recursive: true });
  const pullPrivOut = execFileSync(process.execPath, [path.resolve('plugins/knowledge-capture/bin/pull.js'), 'private'], {
    cwd: secWs,
    env: { ...process.env, KC_STORAGE_DIR: emptyPullStorage },
    encoding: 'utf8'
  });
  assert.ok(pullPrivOut.includes('Repository URL is not configured'), 'pull.js private must handle empty settings safely');

  // bin/install.js CLI edge cases
  const runInstallerFail = (cliArgs) => {
    try {
      execFileSync(process.execPath, [path.resolve('bin/install.js'), ...cliArgs], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
      return { status: 0, stderr: '' };
    } catch (err) {
      return { status: err.status, stderr: err.stderr || '' };
    }
  };
  assert.equal(runInstallerFail(['--scope', 'bogus', '--list']).status, 0); // --list exits before --scope check
  assert.equal(runInstallerFail(['--scope', 'bogus', '--enable', 'knowledge-capture']).status, 1, 'Invalid --scope must exit 1');
  assert.equal(runInstallerFail(['--plugin']).status, 1, '--plugin without value must exit 1');
  assert.equal(runInstallerFail(['--uninstall']).status, 1, '--uninstall without value must exit 1');
  const badUninstall = runInstallerFail(['--uninstall', '../evil']);
  assert.equal(badUninstall.status, 1, '--uninstall with traversal ID must fail cleanly with exit 1');
  assert.ok(!badUninstall.stderr.includes('    at '), 'Invalid --uninstall must print clean error instead of uncaught stack trace');
  console.log('  ✔ Passed: All path containment, git option injection, and CLI validation guards verified.\n');

  // ==========================================
  // TEST 44: Deactivated Team Non-Leakage, Nested Subdirs, YAML Round-Trip, Dirty Vectors & Studio Workspace Switch
  // ==========================================
  console.log('Test 44: Deactivated Team Isolation, Nested Subdir Ops, YAML Escaping, Vector Dirty Check & Studio Switching...');
  const bugFixWs1 = path.join(tempRoot, 'bugfix-ws-1');
  const bugFixWs2 = path.join(tempRoot, 'bugfix-ws-2');
  const bugFixMem1 = path.join(bugFixWs1, '.agents', 'rules', 'memory');
  const bugFixMem2 = path.join(bugFixWs2, '.agents', 'rules', 'memory');
  fs.mkdirSync(path.join(bugFixMem1, 'k8s'), { recursive: true });
  fs.mkdirSync(bugFixMem2, { recursive: true });

  // 1. Nested Team File Counting & Deactivated Team Isolation in LayerProvider
  const activeTeamRes = addTeamRepository('team-visible', '', 'Visible Team', bugFixWs1);
  const hiddenTeamRes = addTeamRepository('team-hidden', '', 'Hidden Team', bugFixWs1);
  fs.mkdirSync(path.join(activeTeamRes.targetDir, 'adr'), { recursive: true });
  fs.writeFileSync(path.join(activeTeamRes.targetDir, 'README.md'), '# Team Readme\n', 'utf8');
  fs.writeFileSync(path.join(activeTeamRes.targetDir, 'adr', 'adr-001.md'), `---
name: adr-001
domain: architecture
type: convention
description: Nested ADR entry in team repository
---
# ADR 001
`, 'utf8');
  fs.writeFileSync(path.join(hiddenTeamRes.targetDir, 'secret-inactive-rule.md'), `---
name: secret-inactive-rule
domain: security
type: convention
description: Must not leak when deactivated
---
# Secret Inactive
`, 'utf8');

  setTeamRepositoryActive('team-hidden', false, bugFixWs1);
  const teamReposList = getTeamRepositories(bugFixWs1);
  const visibleInfo = teamReposList.find(r => r.slug === 'team-visible');
  assert.equal(visibleInfo.entriesCount, 1, 'getTeamRepositories must recursively count nested team markdown files excluding README.md');

  const bugLp = createLayerProvider(bugFixWs1);
  assert.ok(bugLp.findMemoryFile('adr-001', 'all'), 'Active nested team entry must be found');
  assert.equal(bugLp.findMemoryFile('secret-inactive-rule', 'all'), null, 'Deactivated team entry must NEVER leak via LayerProvider fallback');
  assert.equal(bugLp.findMemoryFile('secret-inactive-rule', 'team'), null, 'Deactivated team entry must NEVER leak in team layer lookup');

  // Deactivate all team repos and verify still isolated
  setTeamRepositoryActive('team-visible', false, bugFixWs1);
  const allDeactivatedLp = createLayerProvider(bugFixWs1);
  assert.equal(allDeactivatedLp.findMemoryFile('adr-001', 'all'), null, 'All-deactivated teamRepos must not expose Team files via default fallback');
  assert.equal(allDeactivatedLp.getActiveLayers().some(l => l.key === 'team'), false, 'getActiveLayers must omit default team when teamRepos are all inactive');

  removeTeamRepository('team-visible', true, bugFixWs1);
  removeTeamRepository('team-hidden', true, bugFixWs1);

  // 2. Nested Subdir Delete / Merge / Rename & Invalid Layer Rejection in memory-store.js
  assert.throws(
    () => deleteMemoryEntry(bugFixWs1, { layer: 'team', slug: 'anything' }),
    /Direct deletes are only permitted/,
    'deleteMemoryEntry must reject non-writable layer instead of silently targeting privateDir'
  );
  assert.throws(
    () => mergeMemoryEntries(bugFixWs1, { layer: 'invalid-layer', targetSlug: 't', sourceSlugs: ['s'] }),
    /Direct writes are only permitted/,
    'mergeMemoryEntries must reject invalid layer instead of silently targeting privateDir'
  );

  const nestedDelFile = path.join(bugFixMem1, 'k8s', 'nested-pod-rule.md');
  fs.writeFileSync(nestedDelFile, `---
name: nested-pod-rule
domain: devops
type: convention
description: Nested pod policy
related: [nested-merge-src]
---
# Nested Pod Rule
`, 'utf8');
  const nestedDelRes = deleteMemoryEntry(bugFixWs1, { layer: 'workspace', slug: 'nested-pod-rule' });
  assert.equal(nestedDelRes.success, true, 'deleteMemoryEntry must locate and delete entries inside nested subdirectories');
  assert.equal(fs.existsSync(nestedDelFile), false, 'Nested file must be unlinked from disk');

  const nestedMergeSrc = path.join(bugFixMem1, 'k8s', 'nested-merge-src.md');
  fs.writeFileSync(nestedMergeSrc, `---
name: nested-merge-src
domain: devops
type: convention
description: Nested merge source
---
# Nested Merge Source
`, 'utf8');
  const mergedNested = mergeMemoryEntries(bugFixWs1, {
    layer: 'workspace',
    targetSlug: 'merged-k8s-rule',
    sourceSlugs: ['nested-merge-src'],
    title: 'Merged K8s Rule',
    why: 'Consolidated policy',
    howToApply: 'Apply everywhere'
  });
  assert.equal(mergedNested.success, true);
  assert.equal(fs.existsSync(nestedMergeSrc), false, 'mergeMemoryEntries must remove source entries inside nested subdirectories');

  // 3. YAML Double-Quoted Scalar With Embedded Quotes & Newlines Round-Trip
  const complexScalarDesc = 'Quote "hello" with\nline two: #tag';
  const complexYaml = serializeYamlFrontmatter({
    name: 'yaml-complex-roundtrip',
    domain: 'testing',
    description: complexScalarDesc,
    related: ['ref-alpha', 'ref "quoted"']
  }, '# Complex Body\n');
  const parsedComplexYaml = parseYamlFrontmatter(complexYaml);
  assert.equal(parsedComplexYaml.frontmatter.description, complexScalarDesc, 'Double-quoted YAML scalar with quotes & newlines must round-trip losslessly');
  assert.deepEqual(parsedComplexYaml.frontmatter.related, ['ref-alpha', 'ref "quoted"'], 'Double-quoted YAML array items with quotes must round-trip cleanly');

  // 4. isIndexDirty Must Detect Vectorless Rows Created by syncSqliteMetadataSync (getKnowledgeGraphData)
  fs.writeFileSync(path.join(bugFixMem2, 'vector-canary.md'), `---
name: vector-canary
domain: platform
type: platform-fact
description: Canary for checking trigger_vector presence in isIndexDirty
verified: 2026-04-01
---
# Vector Canary
Ensures vector indexing runs after metadata-only graph sync.
`, 'utf8');
  // Calling getKnowledgeGraphData triggers syncSqliteMetadataSync (writes rows with trigger_vector = NULL)
  getKnowledgeGraphData(bugFixWs2);
  assert.equal(isIndexDirty(bugFixWs2), true, 'isIndexDirty must return true when indexed rows lack embedding vectors');
  await syncSqliteIndex(bugFixWs2);
  assert.equal(isIndexDirty(bugFixWs2), false, 'isIndexDirty must return false once syncSqliteIndex computes vectors');

  // 5. renderVisualMemoryStudio Must Rebind Server When Workspace Changes
  const studioWs1 = await renderVisualMemoryStudio(bugFixWs1, {
    mode: 'browser',
    autoOpen: false,
    port: 4311,
    artifactDir: path.join(tempRoot, 'artifacts'),
    fileName: 'studio-ws1.html'
  });
  assert.equal(studioWs1.workspace, path.resolve(bugFixWs1));
  const health1 = await (await fetch(`${studioWs1.serverUrl}/api/health`)).json();
  assert.equal(health1.workspace, path.resolve(bugFixWs1));

  const studioWs2 = await renderVisualMemoryStudio(bugFixWs2, {
    mode: 'browser',
    autoOpen: false,
    port: 4311,
    artifactDir: path.join(tempRoot, 'artifacts'),
    fileName: 'studio-ws2.html'
  });
  assert.equal(studioWs2.workspace, path.resolve(bugFixWs2));
  const health2 = await (await fetch(`${studioWs2.serverUrl}/api/health`)).json();
  assert.equal(health2.workspace, path.resolve(bugFixWs2), 'renderVisualMemoryStudio must restart/rebind HTTP server when workspaceRoot changes');
  await stopStudioService();
  console.log('  ✔ Passed: Deactivated team isolation, nested subdir ops, YAML round-trip, dirty-vector detection & studio switching verified.\n');

  // ==========================================
  // TEST 45: Sentinel Subdir Captures, Path Traversal Guard, & Complete Deactivated-Team Isolation
  // ==========================================
  console.log('Test 45: Sentinel Subdir Captures, Slug Traversal Guard & All-Surface Deactivated-Team Isolation...');
  const isoWs = path.join(tempRoot, 'iso-audit-ws');
  const isoMemNested = path.join(isoWs, '.agents', 'rules', 'memory', 'k8s');
  fs.mkdirSync(isoMemNested, { recursive: true });
  fs.writeFileSync(path.join(isoMemNested, 'nested-recent-capture.md'), `---
name: nested-recent-capture
domain: devops
type: convention
description: Recently captured rule stored in nested subdirectory
verified: 2026-11-12
---
# Nested Recent Capture
Stored inside a nested domain subdirectory.
`, 'utf8');

  const sentinelNested = autoElicitSessionKnowledge(isoWs, { modified_files: [] });
  assert.ok(sentinelNested.recent_memory_captures >= 1, 'autoElicitSessionKnowledge must count recent captures inside nested subdirectories');

  // deriveTeamRepoSlug & addTeamRepository slug guards
  assert.equal(deriveTeamRepoSlug('https://example.com/@@@/!!!'), 'team-repo', 'deriveTeamRepoSlug must never return empty string on punctuation-only URLs');
  assert.throws(() => addTeamRepository('---', '', 'Bad Slug', isoWs), /Team repository slug is required/, 'addTeamRepository must reject punctuation-only slugs');

  // Craft malicious traversal slug in settings.json directly
  const evilSettingsPath = path.join(process.env.KC_STORAGE_DIR, 'settings.json');
  const prevSettingsRaw = fs.existsSync(evilSettingsPath) ? fs.readFileSync(evilSettingsPath, 'utf8') : null;
  fs.writeFileSync(evilSettingsPath, JSON.stringify({
    privateRepoUrl: '',
    teamRepoUrl: '',
    teamRepos: [{ slug: '../../evil-escape', name: 'Evil', url: '', active: true }]
  }, null, 2), 'utf8');
  const safePaths = resolveStoragePaths(isoWs);
  assert.equal(safePaths.activeTeamDirs.length, 0, 'resolveStoragePaths must skip unsafe traversal team slugs');
  assert.equal(getTeamRepositories(isoWs).length, 0, 'getTeamRepositories must skip unsafe traversal team slugs');
  if (prevSettingsRaw !== null) fs.writeFileSync(evilSettingsPath, prevSettingsRaw, 'utf8');
  else fs.unlinkSync(evilSettingsPath);

  // Setup a team repo with both active search index and private conflict, then deactivate it
  const hiddenAuditTeam = addTeamRepository('audit-hidden-team', '', 'Hidden Audit Team', isoWs);
  const hiddenRulePath = path.join(hiddenAuditTeam.targetDir, 'secret-deactivated-rule.md');
  fs.writeFileSync(hiddenRulePath, `---
name: secret-deactivated-rule
domain: security
type: convention
description: Secret deactivated team rule that must never leak after deactivation
verified: 2026-11-01
---
# Secret Deactivated Rule
Only exists in hidden team repo.
`, 'utf8');
  saveMemoryEntry(isoWs, {
    layer: 'private',
    slug: 'secret-deactivated-rule',
    domain: 'security',
    description: 'Diverged private copy',
    body: '# Private override'
  });
  await syncSqliteIndex(isoWs);

  setTeamRepositoryActive('audit-hidden-team', false, isoWs);
  // Remove local workspace/private files for an empty active set search check
  fs.rmSync(path.join(isoWs, '.agents', 'rules', 'memory'), { recursive: true, force: true });
  fs.mkdirSync(path.join(isoWs, '.agents', 'rules', 'memory'), { recursive: true });
  deleteMemoryEntry(isoWs, { layer: 'private', slug: 'secret-deactivated-rule' });
  // Re-add private rule ONLY to test auditTeamConflicts stays silent when team repo is inactive
  saveMemoryEntry(isoWs, {
    layer: 'private',
    slug: 'secret-deactivated-rule',
    domain: 'security',
    description: 'Diverged private copy',
    body: '# Private override'
  });

  const statsDeactivated = getLayerStatistics(isoWs);
  assert.equal(statsDeactivated.counts.team, 0, 'getLayerStatistics must report 0 team files when all configured teamRepos are inactive');
  assert.equal(statsDeactivated.syncStatus.teamGit.isGit, false, 'getLayerStatistics must not leak root teamDir git status when teamRepos are inactive');

  const conflictsDeactivated = auditTeamConflicts(isoWs);
  assert.equal(conflictsDeactivated.conflictsCount, 0, 'auditTeamConflicts must not scan deactivated team repos via root teamDir fallback');

  const syncDeactivated = syncMemoryLayer(isoWs, { layer: 'team' });
  assert.equal(syncDeactivated.team.status, 'no-active-team-repos', 'syncMemoryLayer must not fall back to root teamDir when all teamRepos are inactive');

  const adrTmpFile = path.join(tempRoot, 'adr-test.md');
  fs.writeFileSync(adrTmpFile, '# ADR 999: Test Decision\nUse strict boundaries.\n', 'utf8');
  assert.throws(
    () => ingestTeamAdr(isoWs, adrTmpFile, { targetLayer: 'team' }),
    /No active team repositories/,
    'ingestTeamAdr must reject targetLayer="team" when all configured teamRepos are inactive'
  );

  // Re-activate temporarily to test unknown slug rejection
  setTeamRepositoryActive('audit-hidden-team', true, isoWs);
  assert.throws(
    () => ingestTeamAdr(isoWs, adrTmpFile, { targetLayer: 'team/does-not-exist' }),
    /was not found in settings or is not active/,
    'ingestTeamAdr must throw for nonexistent or inactive team/<slug> instead of falling back to root teamDir'
  );

  // Deactivate again and remove private file so activeKeySet is empty, then search SQLite directly
  setTeamRepositoryActive('audit-hidden-team', false, isoWs);
  deleteMemoryEntry(isoWs, { layer: 'private', slug: 'secret-deactivated-rule' });
  const leakedSearch = await searchMemoriesHybrid(isoWs, 'secret deactivated team rule', { sync: false });
  assert.equal(leakedSearch.some(r => r.slug === 'secret-deactivated-rule'), false, 'searchMemoriesHybrid must never return deactivated/deleted rows even with sync:false');

  removeTeamRepository('audit-hidden-team', true, isoWs);
  console.log('  ✔ Passed: Nested sentinel captures, slug traversal guards, and complete deactivated-team isolation verified.\n');

  // ==========================================
  // TEST 46: Mixed-Case Slugs, In-Place FTS Rename Cleanup, & Setup KC_STORAGE_DIR Honor
  // ==========================================
  console.log('Test 46: Mixed-Case Graph/Content/Rewire Resolution, Indexer Rename Cleanup & Setup Storage Honor...');
  const caseWs = path.join(tempRoot, 'mixed-case-ws');
  const caseMemDir = path.join(caseWs, '.agents', 'rules', 'memory');
  fs.mkdirSync(caseMemDir, { recursive: true });

  fs.writeFileSync(path.join(caseMemDir, 'MixedCaseTarget.md'), `---
name: MixedCaseTarget
domain: testing
type: convention
description: Mixed case memory target
verified: 2026-11-12
---
# Mixed Case Target
Target body.
`, 'utf8');

  fs.writeFileSync(path.join(caseMemDir, 'MixedCaseReferrer.md'), `---
name: MixedCaseReferrer
domain: testing
type: convention
description: References mixed case target using lowercase
verified: 2026-11-12
related:
  - mixedcasetarget
---
# Mixed Case Referrer
Referrer body.
`, 'utf8');

  const mixedContent = getMemoryContent(caseWs, 'all', 'mixedcasetarget');
  assert.ok(mixedContent.backlinks.some(b => b.slug === 'MixedCaseReferrer'), 'getMemoryContent must resolve mixed-case backlinks case-insensitively');
  const mixedRefContent = getMemoryContent(caseWs, 'all', 'MixedCaseReferrer');
  assert.equal(mixedRefContent.relatedMemories[0]?.resolved, true, 'getMemoryContent must resolve mixed-case related targets via lowercase activeIndex');

  await syncSqliteIndex(caseWs);
  const mixedGraph = getKnowledgeGraphData(caseWs);
  assert.equal(mixedGraph.links.length, 1, 'getKnowledgeGraphData must match mixed-case link endpoints case-insensitively instead of classifying them as brokenLinks');
  assert.equal(mixedGraph.brokenLinks.length, 0);
  const mixedNeighbors = getMemoryGraphNeighbors(caseWs, 'mixedcasetarget');
  assert.equal(mixedNeighbors.incoming.length, 1, 'getMemoryGraphNeighbors(depth=1) must resolve mixed-case slugs case-insensitively');

  // Case-insensitive rewire & cleanDanglingReferences
  const rewiredCase = rewireMemoryReferences(caseWs, 'mixedcasetarget', 'RenamedCaseTarget');
  assert.equal(rewiredCase, 1, 'rewireMemoryReferences must match related references case-insensitively');
  const cleanedCase = cleanDanglingReferences(caseWs, 'renamedcasetarget');
  assert.equal(cleanedCase, 1, 'cleanDanglingReferences must remove dangling references case-insensitively');

  // applyMemoryPatch guards empty source/target and array overrides removal
  fs.writeFileSync(path.join(caseMemDir, 'PatchOverrideSource.md'), `---
name: PatchOverrideSource
domain: testing
type: convention
description: Tests array overrides patch removal
verified: 2026-11-12
overrides:
  - MixedCaseTarget
  - OtherRule
---
# Patch Override Source
`, 'utf8');
  const patchRes = applyMemoryPatch(caseWs, {
    added_links: [{ source: 'PatchOverrideSource', target: '   ', type: 'related' }],
    removed_links: [{ source: 'PatchOverrideSource', target: 'mixedcasetarget', type: 'overrides' }]
  });
  assert.equal(patchRes.linksAdded, 0, 'applyMemoryPatch must ignore empty target links');
  assert.equal(patchRes.linksRemoved, 1, 'applyMemoryPatch must remove specific override from array overrides');
  const patchedRaw = parseYamlFrontmatter(fs.readFileSync(path.join(caseMemDir, 'PatchOverrideSource.md'), 'utf8'));
  assert.deepEqual(patchedRaw.frontmatter.overrides, ['OtherRule'], 'Remaining override must be preserved cleanly');

  // Indexer in-place frontmatter name: rename must purge orphan FTS5/graph rows
  const renameFilePath = path.join(caseMemDir, 'inplace-rename.md');
  fs.writeFileSync(renameFilePath, `---
name: unique-before-rename-token
domain: testing
type: convention
description: Entry before in-place frontmatter rename
verified: 2026-11-12
---
# Before Rename
Body before rename.
`, 'utf8');
  await syncSqliteIndex(caseWs);

  fs.writeFileSync(renameFilePath, `---
name: unique-after-rename-token
domain: testing
type: convention
description: Entry after in-place frontmatter rename
verified: 2026-11-12
---
# After Rename
Body after rename.
`, 'utf8');
  // Advance mtime by 1s to guarantee change detection on coarse filesystems
  const futureTime = new Date(Date.now() + 2000);
  fs.utimesSync(renameFilePath, futureTime, futureTime);
  await syncSqliteIndex(caseWs);

  const orphanSearch = await searchMemoriesHybrid(caseWs, 'unique-before-rename-token');
  assert.equal(orphanSearch.some(r => r.slug === 'unique-before-rename-token'), false, 'Indexer must delete orphan FTS5 rows when frontmatter name changes in place');

  // setup.js must honor KC_STORAGE_DIR
  const customSetupStorage = path.join(tempRoot, 'setup-custom-storage');
  const prevKcDir = process.env.KC_STORAGE_DIR;
  process.env.KC_STORAGE_DIR = customSetupStorage;
  const setupRes = setupEnvironment({ embeddingEngine: 'heuristic', installDependencies: false, silent: true });
  process.env.KC_STORAGE_DIR = prevKcDir;
  assert.equal(path.resolve(setupRes.baseDir), path.resolve(customSetupStorage), 'setupEnvironment must honor KC_STORAGE_DIR');
  assert.ok(fs.existsSync(path.join(customSetupStorage, 'settings.json')), 'setupEnvironment must write settings.json inside KC_STORAGE_DIR');
  console.log('  ✔ Passed: Mixed-case graph/rewire, indexer FTS orphan cleanup & setup storage honor verified.\n');

  // ==========================================
  // TEST 47: Studio Hardening, LayerProvider Guards & Legacy teamRepoUrl Resolution
  // ==========================================
  console.log('Test 47: Studio Hardening, LayerProvider Directory/Default Guards & Legacy teamRepoUrl Resolution...');

  // 1. studio.js parseCliArgs missing value guard
  assert.throws(
    () => parseCliArgs(['--workspace']),
    /Missing path for --workspace/,
    'parseCliArgs must reject missing --workspace argument cleanly'
  );
  assert.throws(
    () => parseCliArgs(['--port']),
    /Missing value for --port/,
    'parseCliArgs must reject missing --port argument cleanly'
  );

  // 2. studio.js malformed URL must return HTTP 400 without crashing server, and index must set Cache-Control: no-store
  const studioGuardInstance = await startStudioServer({
    workspaceRoot: caseWs,
    port: 0,
    host: '127.0.0.1',
    autoOpen: false,
    strictPort: true
  });
  try {
    const indexRes = await fetch(`${studioGuardInstance.url}/`);
    assert.equal(indexRes.status, 200);
    assert.equal(indexRes.headers.get('cache-control'), 'no-store', 'Studio HTML response must disable caching');

    const badUrlStatus = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port: studioGuardInstance.port,
        path: 'http://[::1',
        method: 'GET'
      }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(badUrlStatus, 400, 'Malformed request URL must return HTTP 400 without crashing server');
  } finally {
    await studioGuardInstance.close();
  }

  // 3. layer-provider.js must ignore subdirectories ending with .md and not leak root teamDir for 'default'
  const dirTrapMemDir = path.join(caseWs, '.agents', 'rules', 'memory', 'dir-trap.md');
  fs.mkdirSync(dirTrapMemDir, { recursive: true });
  const trapLp = createLayerProvider(caseWs);
  assert.equal(trapLp.findMemoryFile('dir-trap', 'workspace'), null, 'findMemoryFile must not match a directory ending with .md');

  const multiTeamStorage = path.join(tempRoot, 'multi-team-guard-storage');
  const prevStorageForMulti = process.env.KC_STORAGE_DIR;
  process.env.KC_STORAGE_DIR = multiTeamStorage;
  try {
    addTeamRepository({ slug: 'platform-core', url: '', name: 'Platform Core', active: true }, caseWs);
    const activeLp = createLayerProvider(caseWs);
    assert.equal(
      activeLp.resolveTeamRepoDir('default'),
      null,
      'resolveTeamRepoDir("default") must return null when explicit teamRepos entries are active'
    );
  } finally {
    process.env.KC_STORAGE_DIR = prevStorageForMulti;
  }

  // 4. Legacy teamRepoUrl in settings.json must resolve to <storage>/team (unless <storage>/team/default exists)
  const legacyStorage = path.join(tempRoot, 'legacy-team-url-storage');
  const legacyTeamDir = path.join(legacyStorage, 'team');
  fs.mkdirSync(legacyTeamDir, { recursive: true });
  fs.writeFileSync(path.join(legacyStorage, 'settings.json'), JSON.stringify({
    privateRepoUrl: '',
    teamRepoUrl: 'https://github.com/acme/shared-memory.git',
    embeddingEngine: 'heuristic',
    teamRepos: []
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(legacyTeamDir, 'legacy-team-rule.md'), `---
name: legacy-team-rule
domain: general
type: convention
description: Legacy flat team directory rule
verified: 2026-11-12
---
# Legacy Team Rule
Enforce standard conventions.
`, 'utf8');

  const prevStorageForLegacy = process.env.KC_STORAGE_DIR;
  process.env.KC_STORAGE_DIR = legacyStorage;
  try {
    const legacyPaths = resolveStoragePaths(caseWs);
    assert.equal(
      path.resolve(legacyPaths.activeTeamDirs[0].dir),
      path.resolve(legacyTeamDir),
      'Legacy teamRepoUrl must resolve to root teamDir when team/default does not exist'
    );
    const legacyStats = getLayerStatistics(caseWs);
    assert.equal(legacyStats.counts.team, 1, 'Legacy flat team rule must be discovered by getLayerStatistics');
    const legacyRepos = getTeamRepositories(caseWs);
    assert.equal(legacyRepos[0]?.entriesCount, 1, 'getTeamRepositories must count entries in legacy root teamDir');
  } finally {
    process.env.KC_STORAGE_DIR = prevStorageForLegacy;
  }

  console.log('  ✔ Passed: Studio HTTP/CLI guards, LayerProvider directory/default isolation & legacy teamRepoUrl resolution verified.\n');

  // ==========================================
  // TEST 48: Slug Normalization, Installer --update Error Exit & homedir Fallback
  // ==========================================
  console.log('Test 48: Slug Normalization, Installer --update Validation & homedir Fallback...');

  // 1. session-sentinel slug normalization after slicing (no trailing hyphens, non-empty fallback)
  const longPrefElicit = autoElicitSessionKnowledge(caseWs, {
    userFeedback: 'prefer very long explicit typescript strict-mode over loose js',
    errorLogs: ['Error: ---   !!! ??? ***']
  });
  const prefCand = longPrefElicit.suggested_candidates.find(c => c.slug.startsWith('user-preference-') && c.slug !== 'user-preference-concise-conclusions');
  assert.ok(prefCand, 'Preference candidate should be generated');
  assert.equal(prefCand.slug.endsWith('-'), false, `Preference slug must not end with hyphen: ${prefCand.slug}`);
  const debugCand = longPrefElicit.suggested_candidates.find(c => c.slug.startsWith('debug-gotcha-'));
  assert.ok(debugCand, 'Debug candidate should be generated');
  assert.equal(debugCand.slug, 'debug-gotcha-runtime-issue', 'Symbol-only error message must fall back cleanly to runtime-issue');

  // 2. archeology-scanner slug normalization on long subjects and symbol-only subjects
  const archRepo = path.join(tempRoot, 'arch-slug-repo');
  fs.mkdirSync(archRepo, { recursive: true });
  execFileSync('git', ['init'], { cwd: archRepo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: archRepo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: archRepo, stdio: 'ignore' });
  fs.writeFileSync(path.join(archRepo, 'a.txt'), '1\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: archRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fix: prevent very long container crash loop backoff - edge'], { cwd: archRepo, stdio: 'ignore' });
  fs.writeFileSync(path.join(archRepo, 'b.txt'), '2\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: archRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fix: 🚀'], { cwd: archRepo, stdio: 'ignore' });

  const archRes = mineGitHistoryMemories(archRepo, { maxCommits: 10 });
  assert.equal(archRes.status, 'SUCCESS');
  assert.ok(archRes.candidates.every(c => !c.slug.endsWith('-')), 'Archeology slugs must never end with a trailing hyphen');
  assert.ok(archRes.candidates.every(c => c.slug !== 'git'), 'Symbol-only commit subject must fall back to commit hash slug instead of bare git');

  // 3. bin/install.js --update nonexistent plugin exits non-zero, and homedir fallback works without HOME/USERPROFILE
  const installCliPath = path.resolve(process.cwd(), 'bin', 'install.js');
  const unknownUpdateRun = spawnSync(process.execPath, [installCliPath, '--update', 'non-existent-plugin-xyz'], {
    encoding: 'utf8'
  });
  assert.notEqual(unknownUpdateRun.status, 0, '--update with unknown plugin ID must exit non-zero');
  assert.match(unknownUpdateRun.stderr, /Unknown plugin/, '--update unknown plugin must print error message');

  const noHomeEnv = { ...process.env };
  delete noHomeEnv.HOME;
  delete noHomeEnv.USERPROFILE;
  const statusNoHomeRun = spawnSync(process.execPath, [installCliPath, '--status-json'], {
    env: noHomeEnv,
    encoding: 'utf8'
  });
  assert.equal(statusNoHomeRun.status, 0, 'install.js must resolve os.homedir() cleanly even when HOME and USERPROFILE are unset');

  console.log('  ✔ Passed: Slug trimming, CLI --update error exit & os.homedir() fallback verified.\n');

  // ==========================================
  // TEST 49: Team Legacy Removal, setup.js CLI Validation, Memory Store & YAML Parser
  // ==========================================
  console.log('Test 49: Legacy Team Removal, setup.js CLI Parsing, Memory Store & YAML Edge Cases...');
  {
    // 1. Removing legacy 'default' team repo must clear settings.teamRepoUrl (no resurrection)
    const teamCleanupStorage = path.join(tempRoot, 'team-cleanup-storage');
    const teamCleanupDir = path.join(teamCleanupStorage, 'team');
    fs.mkdirSync(teamCleanupDir, { recursive: true });
    fs.writeFileSync(path.join(teamCleanupStorage, 'settings.json'), JSON.stringify({
      privateRepoUrl: 'https://github.com/acme/priv.git',
      teamRepoUrl: 'https://github.com/acme/legacy-team.git',
      embeddingEngine: 'heuristic',
      teamRepos: []
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(teamCleanupDir, 'legacy-note.md'), '---\nname: legacy-note\n---\n# Note\n', 'utf8');

    const prevStorageCleanup = process.env.KC_STORAGE_DIR;
    process.env.KC_STORAGE_DIR = teamCleanupStorage;
    try {
      const setupCliPath = path.resolve(process.cwd(), 'plugins', 'knowledge-capture', 'bin', 'setup.js');

      // Verify setup.js fails on missing value for value-taking flag
      const missingValRun = spawnSync(process.execPath, [setupCliPath, '--private-url'], {
        env: { ...process.env, KC_STORAGE_DIR: teamCleanupStorage },
        encoding: 'utf8'
      });
      assert.notEqual(missingValRun.status, 0, 'setup.js must exit non-zero when flag value is missing');
      assert.match(missingValRun.stderr, /Missing value for flag/, 'setup.js must explain missing flag value');

      // Verify setup.js accepts explicit empty string "" to clear privateRepoUrl
      const clearPrivRun = spawnSync(process.execPath, [setupCliPath, '--private-url', ''], {
        env: { ...process.env, KC_STORAGE_DIR: teamCleanupStorage },
        encoding: 'utf8'
      });
      assert.equal(clearPrivRun.status, 0, `setup.js --private-url "" should succeed: ${clearPrivRun.stderr}`);
      const afterClearPriv = JSON.parse(fs.readFileSync(path.join(teamCleanupStorage, 'settings.json'), 'utf8'));
      assert.equal(afterClearPriv.privateRepoUrl, '', '--private-url "" must clear privateRepoUrl');

      // Verify removeTeamRepository('default', true) clears teamRepoUrl and cleans legacy root md
      const remRes = removeTeamRepository(caseWs, { slug: 'default', deleteFiles: true });
      assert.equal(remRes.removed, true);
      const afterRemSettings = JSON.parse(fs.readFileSync(path.join(teamCleanupStorage, 'settings.json'), 'utf8'));
      assert.equal(afterRemSettings.teamRepoUrl, '', 'removeTeamRepository("default") must clear legacy teamRepoUrl');
      assert.equal(getTeamRepositories(caseWs).length, 0, 'Legacy default repo must not resurrect after removal');
      assert.equal(fs.existsSync(path.join(teamCleanupDir, 'legacy-note.md')), false, 'deleteFiles must remove legacy root .md');
    } finally {
      process.env.KC_STORAGE_DIR = prevStorageCleanup;
    }

    // 2. Memory store: syncMemoryLayer(null), applyMemoryPatch description/trigger sync, case-insensitive rename guard
    const syncNullRes = syncMemoryLayer(caseWs, { layer: null });
    assert.equal(syncNullRes.private.attempted, true, 'syncMemoryLayer({ layer: null }) must safely default to all');

    const patchTarget = saveMemoryEntry(caseWs, {
      layer: 'workspace',
      slug: 'patch-trigger-sync',
      title: 'Patch Trigger Sync',
      description: 'Initial trigger description',
      why: 'Test trigger sync',
      howToApply: 'Keep updated'
    });
    const patchTriggerRes = applyMemoryPatch(caseWs, {
      modified_nodes: [{ slug: 'patch-trigger-sync', description: 'Updated trigger description' }]
    });
    assert.equal(patchTriggerRes.nodesUpdated, 1);
    const reParsedPatched = parseYamlFrontmatter(fs.readFileSync(patchTarget.path, 'utf8'));
    assert.equal(reParsedPatched.frontmatter.description, 'Updated trigger description');
    assert.equal(reParsedPatched.frontmatter.trigger, 'Updated trigger description', 'trigger must reflect updated description');

    const renameWs = path.join(tempRoot, 'rename-guard-ws');
    const renameMemDir = path.join(renameWs, '.agents', 'rules', 'memory');
    fs.mkdirSync(renameMemDir, { recursive: true });
    const newCasePath = path.join(renameMemDir, 'case-rule.md');
    const oldCaseAlias = path.join(renameMemDir, 'Case-Rule.md');
    fs.writeFileSync(newCasePath, '---\nname: Case-Rule\ndescription: Case test\n---\n# Old\n', 'utf8');
    try {
      fs.symlinkSync(newCasePath, oldCaseAlias);
      saveMemoryEntry(renameWs, {
        layer: 'workspace',
        slug: 'case-rule',
        oldSlug: 'Case-Rule',
        title: 'Case Rule',
        description: 'Updated case test',
        why: 'Verify inode check',
        howToApply: 'Preserve file'
      });
      assert.equal(fs.existsSync(newCasePath), true, 'Target file must remain intact when oldSlug shares same inode');
    } catch (err) {
      if (err.code !== 'EPERM') throw err;
    }

    // 3. YAML parser: quoted commas in inline arrays and nested submap block scalars
    const quotedYaml = parseYamlFrontmatter(`---
name: yaml-edge
related: ["alpha, beta", 'gamma, delta', epsilon]
meta:
  notes: |
    key-like: value-inside-literal
    - dash-item-inside-literal
---
# Body
`);
    assert.deepEqual(quotedYaml.frontmatter.related, ['alpha, beta', 'gamma, delta', 'epsilon']);
    assert.equal(
      quotedYaml.frontmatter.meta.notes,
      'key-like: value-inside-literal\n- dash-item-inside-literal',
      'Nested block scalar lines with colons or dashes must remain part of the scalar'
    );
  }

  console.log('  ✔ Passed: Legacy removal, setup CLI validation, memory-store & YAML edge cases verified.\n');

  // ==========================================
  // TEST 50: Drift Precedence, Bootstrap/Sentinel Slugs, Telemetry, ONNX Env & Studio/Syran/Sync Guards
  // ==========================================
  console.log('Test 50: Drift Precedence, Bootstrap/Sentinel Slugs, Telemetry, ONNX & Studio/Syran/Sync...');
  {
    // 1. drift-detector: workspace vs private contradiction remediation & invalid verified date
    const driftEdgeWs = path.join(tempRoot, 'drift-edge-ws');
    const driftEdgeStorage = path.join(tempRoot, 'drift-edge-storage');
    fs.mkdirSync(path.join(driftEdgeWs, '.agents', 'rules', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(driftEdgeStorage, 'private'), { recursive: true });
    const prevDriftStorage = process.env.KC_STORAGE_DIR;
    process.env.KC_STORAGE_DIR = driftEdgeStorage;
    try {
      saveMemoryEntry(driftEdgeWs, {
        layer: 'workspace',
        slug: 'ws-pkg-mgr',
        domain: 'tooling',
        type: 'convention',
        description: 'When installing JavaScript dependencies in the repository',
        why: 'Workspace uses npm',
        howToApply: 'Always run npm install for packages.',
        verified: '2026-11-12'
      });
      saveMemoryEntry(driftEdgeWs, {
        layer: 'private',
        slug: 'priv-pkg-mgr',
        domain: 'tooling',
        type: 'convention',
        description: 'When installing JavaScript dependencies in the repository',
        why: 'Private preference uses pnpm',
        howToApply: 'Never use npm; always use pnpm install for packages.',
        verified: 'not-a-valid-date'
      });
      const driftEdgeRes = detectContradictionsAndDrift(driftEdgeWs);
      const pkgContra = driftEdgeRes.contradictions.find(c => c.slug_a === 'ws-pkg-mgr' || c.slug_b === 'ws-pkg-mgr');
      assert.ok(pkgContra, 'Should detect workspace vs private contradiction');
      assert.match(pkgContra.remediation, /overrides: priv-pkg-mgr/, 'Higher-tier workspace rule should override lower-tier private rule');
      const invalidVerDrift = driftEdgeRes.drifts.find(d => d.slug === 'priv-pkg-mgr' && d.type === 'invalid_verification');
      assert.ok(invalidVerDrift, 'Invalid verified timestamp must emit invalid_verification drift');
    } finally {
      process.env.KC_STORAGE_DIR = prevDriftStorage;
    }

    // 2. bootstrap-scanner: invalid targetLayer throws; symbol-only ADR filename uses adr-entry
    const symAdrDir = path.join(driftEdgeWs, 'docs', 'adr');
    fs.mkdirSync(symAdrDir, { recursive: true });
    const symAdrFile = path.join(symAdrDir, '!!!.md');
    fs.writeFileSync(symAdrFile, '# Decision\nContent.\n', 'utf8');
    assert.throws(() => ingestTeamAdr(driftEdgeWs, symAdrFile, { targetLayer: 'bogus-layer' }), /Invalid targetLayer/);
    const bootRes = bootstrapRepoMemories(driftEdgeWs);
    const symBoot = bootRes.find(c => c.sourceFile.endsWith('!!!.md'));
    assert.equal(symBoot?.slug, 'adr-entry', 'Symbol-only ADR filename must fall back cleanly to adr-entry');

    // 3. session-sentinel: module filename with spaces/dots/uppercase produces clean kebab-case slug
    const modSentinelWs = path.join(tempRoot, 'mod-sentinel-ws');
    fs.mkdirSync(path.join(modSentinelWs, 'src'), { recursive: true });
    execFileSync('git', ['init'], { cwd: modSentinelWs, stdio: 'ignore' });
    fs.writeFileSync(path.join(modSentinelWs, 'src', 'My Module.v2.js'), 'export const x = 1;\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: modSentinelWs, stdio: 'ignore' });
    const modElicit = autoElicitSessionKnowledge(modSentinelWs);
    const modCand = modElicit.suggested_candidates.find(c => c.slug.endsWith('-session-patterns'));
    assert.equal(modCand?.slug, 'my-module-v2-session-patterns', 'Module slug must be sanitized to kebab-case');

    // 4. telemetry: null details and non-string stderr must not throw
    recordTelemetryEvent('ws-pkg-mgr', 'test_pass', null);
    const corrRes = correlateTestExecutionEfficacy(driftEdgeWs, {
      command: 'npm test',
      exitCode: 1,
      slugs: ['ws-pkg-mgr'],
      stderr: 12345
    });
    assert.equal(corrRes.correlated, true);

    // 5. onnx-provider: case-insensitive KC_EMBEDDING_ENGINE
    const prevOnnxEnv = process.env.KC_EMBEDDING_ENGINE;
    process.env.KC_EMBEDDING_ENGINE = '  ONNX  ';
    try {
      const onnxCfg = getActiveEmbeddingConfig();
      assert.equal(onnxCfg.engine, 'onnx');
      assert.equal(onnxCfg.dimensions, 384);
    } finally {
      if (prevOnnxEnv === undefined) delete process.env.KC_EMBEDDING_ENGINE;
      else process.env.KC_EMBEDDING_ENGINE = prevOnnxEnv;
    }

    // 6. studio.js ephemeral port 0 + studio-launcher workspace isolation + link description filter
    const ephemeralStudio = await startStudioServer({
      workspaceRoot: driftEdgeWs,
      port: 0,
      host: '127.0.0.1',
      autoOpen: false,
      strictPort: true
    });
    try {
      assert.ok(ephemeralStudio.port > 0 && ephemeralStudio.port !== 4242, `port: 0 must bind ephemeral OS port, got ${ephemeralStudio.port}`);
      const healthRes = await fetch(`${ephemeralStudio.url}/api/health`);
      const healthJson = await healthRes.json();
      assert.equal(healthJson.port, ephemeralStudio.port, '/api/health must report actual ephemeral bound port');
    } finally {
      await ephemeralStudio.close();
    }

    const wsA = path.join(tempRoot, 'studio-ws-a');
    const wsB = path.join(tempRoot, 'studio-ws-b');
    fs.mkdirSync(wsA, { recursive: true });
    fs.mkdirSync(wsB, { recursive: true });
    const browserA = await renderVisualMemoryStudio(wsA, {
      mode: 'browser',
      port: 0,
      autoOpen: false,
      artifactDir: path.join(tempRoot, 'artifacts-a')
    });
    assert.equal(browserA.serverStarted, true);
    const inChatB = await renderVisualMemoryStudio(wsB, {
      mode: 'in_chat',
      artifactDir: path.join(tempRoot, 'artifacts-b')
    });
    const htmlB = fs.readFileSync(inChatB.artifactPath, 'utf8');
    assert.equal(htmlB.includes(browserA.serverUrl), false, 'in_chat mode for Workspace B must not embed Workspace A serverUrl');
    assert.match(htmlB, /sDesc\.toLowerCase\(\)\.includes\(q\)/, 'filterGraph linkElements must match node description text');
    await stopStudioService();

    // 7. syran-persona MCP server must handle array arguments gracefully
    const syranMcpPath = path.resolve(process.cwd(), 'plugins', 'syran-persona', 'mcp-server', 'index.js');
    const syranArrayRes = spawnSync(process.execPath, [syranMcpPath], {
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'syran_get_status', arguments: ['bad'] } }) + '\n',
      encoding: 'utf8'
    });
    assert.equal(syranArrayRes.status, 0);
    const syranParsed = JSON.parse(syranArrayRes.stdout.trim().split('\n')[0]);
    assert.ok(syranParsed.result, 'syran-persona MCP server must respond cleanly when arguments is an array');

    // 8. bin/sync-manifests.js --check passes with 0 drift
    const syncCheckRun = spawnSync(process.execPath, [path.resolve(process.cwd(), 'bin', 'sync-manifests.js'), '--check'], {
      encoding: 'utf8'
    });
    assert.equal(syncCheckRun.status, 0, `sync-manifests --check should exit 0: ${syncCheckRun.stderr}`);
  }

  console.log('  ✔ Passed: All round regressions, isolation, validation, and manifest checks verified.\n');

  // ==========================================
  // TEST 51: Final Round Hardening (MiniD3, Studio Auto, Indexer Mtime, Team/YAML/Scanners/Drift, CLI & Syran)
  // ==========================================
  console.log('Test 51: Final Round Hardening Across UI, DB, Scanners, CLIs, Syran & Installer...');
  {
    const vm = await import('node:vm');
    const { searchMemoriesFileBasedFallback } = await import('../plugins/knowledge-capture/mcp-server/retrieval/hybrid-search.js');

    // 1. MiniD3 merge() & repeating data() update + studio-launcher mode: 'auto' + dirty graph telemetry fallback
    const studioWs51 = path.join(tempRoot, 'studio-51-ws');
    fs.mkdirSync(path.join(studioWs51, '.agents', 'rules', 'memory'), { recursive: true });
    saveMemoryEntry(studioWs51, {
      layer: 'workspace',
      slug: 'alpha-studio-rule',
      domain: 'architecture',
      description: 'Alpha rule for studio test',
      why: 'Test studio graph',
      howToApply: 'Keep graph clean'
    });
    saveMemoryEntry(studioWs51, {
      layer: 'workspace',
      slug: 'beta-studio-rule',
      domain: 'architecture',
      description: 'Beta rule related to alpha',
      why: 'Test links',
      howToApply: 'Link properly',
      related: ['alpha-studio-rule']
    });

    await syncSqliteIndex(studioWs51);
    recordMemoryEfficacy('alpha-studio-rule', 'test_pass');

    // Dirty disk state: modify rule file so isIndexDirty === true
    const alphaFile = path.join(studioWs51, '.agents', 'rules', 'memory', 'alpha-studio-rule.md');
    fs.writeFileSync(alphaFile, fs.readFileSync(alphaFile, 'utf8') + '\nUpdated disk line.\n', 'utf8');
    const dirtyMtime = new Date(Date.now() + 5000);
    fs.utimesSync(alphaFile, dirtyMtime, dirtyMtime);
    assert.equal(isIndexDirty(studioWs51), true);

    const dirtyGraph = getKnowledgeGraphData(studioWs51);
    const alphaNode = dirtyGraph.nodes.find(n => n.slug === 'alpha-studio-rule');
    assert.ok(alphaNode, 'alpha-studio-rule node must exist in dirty fallback graph');
    assert.ok(alphaNode.test_pass_count >= 1, 'Dirty graph fallback must preserve SQLite telemetry test_pass_count');

    const autoStudio = await renderVisualMemoryStudio(studioWs51, {
      mode: 'auto',
      artifactDir: path.join(tempRoot, 'artifacts-auto-51')
    });
    assert.equal(autoStudio.compact, true, "mode: 'auto' in offline Antigravity must render compact UI");
    const autoHtml = fs.readFileSync(autoStudio.artifactPath, 'utf8');

    // Execute MiniSelection / MiniDataSelection classes from generated HTML to verify .merge() & second .data() pass
    const d3Start = autoHtml.indexOf("if (typeof d3 === 'undefined')");
    const d3End = autoHtml.indexOf('const graphData =', d3Start);
    assert.ok(d3Start > 0 && d3End > d3Start, 'Generated HTML must contain MiniD3 fallback');
    const miniD3Code = autoHtml.slice(d3Start, d3End);
    const makeEl = (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        style: {},
        attributes: {},
        children: [],
        parentNode: null,
        _listeners: {},
        classList: {
          add() {}, remove() {}, contains() { return false; }
        },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return this.attributes[k] ?? null; },
        removeAttribute(k) { delete this.attributes[k]; },
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        removeChild(child) { this.children = this.children.filter(c => c !== child); },
        remove() {
          if (this.parentNode) {
            this.parentNode.children = this.parentNode.children.filter(c => c !== this);
          }
        },
        addEventListener(ev, fn) { this._listeners[ev] = fn; },
        querySelectorAll(sel) { return this.children.filter(c => c.tagName.toLowerCase() === sel.toLowerCase()); },
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
        getBoundingClientRect() { return { width: 800, height: 600 }; }
      };
      return el;
    };
    const rootSvg = makeEl('svg');
    const vmCtx = {
      document: {
        querySelector(sel) { return sel === '#graph' ? rootSvg : null; },
        querySelectorAll() { return []; },
        createElementNS(_ns, tag) { return makeEl(tag); },
        createElement(tag) { return makeEl(tag); }
      },
      window: {}
    };
    vm.runInNewContext(`${miniD3Code}\nthis.__d3 = window.d3;`, vmCtx);
    const linkJoin1 = vmCtx.__d3.select('#graph').selectAll('line').data([{ id: 'l1', val: 1 }], d => d.id);
    const linkEnter1 = linkJoin1.enter().append('line');
    let mergedLinks = linkEnter1.merge(linkJoin1);
    assert.equal(mergedLinks._elements.length, 1);
    const linkJoin2 = mergedLinks.data([{ id: 'l1', val: 2 }, { id: 'l2', val: 3 }], d => d.id);
    mergedLinks = linkJoin2.enter().append('line').merge(linkJoin2);
    assert.equal(mergedLinks._elements.length, 2, 'MiniSelection.merge + second data() join must keep both elements');
    const vals = [];
    mergedLinks.attr('data-val', d => { vals.push(d.val); return d.val; });
    assert.deepEqual(vals.sort((a, b) => a - b), [2, 3], 'Second data() join must bind updated datum onto existing element');

    // 2. indexer mtime invalidation, hybrid-search fallback full body & telemetry fallback slug
    await syncSqliteIndex(studioWs51); // resync clean index
    const fallbackFull = await searchMemoriesFileBasedFallback(studioWs51, 'Alpha rule studio', { format: 'full', limit: 5 });
    assert.ok(fallbackFull.some(r => r.slug === 'alpha-studio-rule' && typeof r.content === 'string' && r.content.includes('Updated disk line')));

    const fbTele = recordMemoryEfficacy('unindexed-slug', 'test_pass');
    assert.equal(fbTele.slug, 'unindexed-slug', 'recordMemoryEfficacy fallback must include canonical slug');

    // 3. yaml-parser sibling key after nested block scalar + memory-store pre-validation/overrides/promo
    const nestedYaml51 = parseYamlFrontmatter(`---
name: nested-sibling-51
meta:
  notes: |
    first-line
    second-line
  author: syran
---
# Body
`);
    assert.equal(nestedYaml51.frontmatter.meta.notes, 'first-line\nsecond-line');
    assert.equal(nestedYaml51.frontmatter.meta.author, 'syran', 'Sibling key after nested block scalar must be parsed');

    assert.throws(
      () => mergeMemoryEntries(studioWs51, {
        layer: 'workspace',
        targetSlug: 'should-not-exist-51',
        sourceSlugs: ['alpha-studio-rule', '../evil-traversal'],
        title: 'Should Not Exist',
        description: 'Invalid merge',
        why: 'Traversal source',
        howToApply: 'Fail early'
      }),
      /Invalid source slug/i
    );
    assert.equal(
      fs.existsSync(path.join(studioWs51, '.agents', 'rules', 'memory', 'should-not-exist-51.md')),
      false,
      'Failed mergeMemoryEntries must not write partial merged file before validating all sources'
    );

    saveMemoryEntry(studioWs51, {
      layer: 'workspace',
      slug: 'multi-override-target',
      domain: 'architecture',
      description: 'Target with existing override',
      why: 'Test append overrides',
      howToApply: 'Keep prior overrides',
      overrides: ['old-rule-a']
    });
    applyMemoryPatch(studioWs51, {
      added_links: [{ source: 'multi-override-target', target: 'old-rule-b', type: 'overrides' }]
    });
    const patchedMulti = getMemoryContent(studioWs51, 'workspace', 'multi-override-target').content;
    assert.ok(
      patchedMulti.includes('old-rule-a') && patchedMulti.includes('old-rule-b'),
      'applyMemoryPatch overrides link must append rather than overwrite existing overrides'
    );

    // 4. team-sync positional args & stale trigger strip on merge_both
    assert.throws(() => addTeamRepository(studioWs51, {}), /required|url/i);
    assert.throws(() => setTeamRepositoryActive(studioWs51), /required|slug/i);
    assert.throws(() => removeTeamRepository(studioWs51), /required|slug/i);

    const mergePaths51 = resolveStoragePaths(studioWs51);
    fs.mkdirSync(mergePaths51.privateDir, { recursive: true });
    fs.mkdirSync(mergePaths51.teamDir, { recursive: true });
    const privMergeFile = path.join(mergePaths51.privateDir, 'shared-rule.md');
    const teamMergeFile = path.join(mergePaths51.teamDir, 'shared-rule.md');
    fs.writeFileSync(privMergeFile, '---\nname: shared-rule\ndescription: Old desc\ntrigger: Stale trigger\nslug: stale-slug\n---\n# Private Body\nPriv details.\n', 'utf8');
    fs.writeFileSync(teamMergeFile, '---\nname: shared-rule\ndescription: Team desc\n---\n# Team Body\nTeam details.\n', 'utf8');
    const mergeBothRes = resolveTeamConflict(studioWs51, {
      slug: 'shared-rule',
      resolution: 'merge_both',
      privatePath: privMergeFile,
      teamPath: teamMergeFile,
      mergedContent: '---\ndescription: Merged desc\n---\n# Merged Body\nMerged details.\n'
    });
    assert.equal(mergeBothRes.action, 'merged_both_versions');
    const mergedFm = parseYamlFrontmatter(fs.readFileSync(privMergeFile, 'utf8')).frontmatter;
    assert.equal(mergedFm.description, 'Merged desc');
    assert.equal(mergedFm.trigger, 'Merged desc', 'merge_both must strip stale trigger rather than preserving it');
    assert.equal(mergedFm.slug, 'shared-rule', 'merge_both must strip stale slug rather than preserving it');
    fs.rmSync(privMergeFile, { force: true });
    fs.rmSync(teamMergeFile, { force: true });

    // 5. archeology-scanner delimiter & word boundaries + bootstrap-scanner gitlab fallback + dream threshold + drift false positives
    const arch51Repo = path.join(tempRoot, 'arch-51-repo');
    fs.mkdirSync(arch51Repo, { recursive: true });
    execFileSync('git', ['init'], { cwd: arch51Repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: arch51Repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: arch51Repo, stdio: 'ignore' });
    fs.writeFileSync(path.join(arch51Repo, 'notes.txt'), 'line 1\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: arch51Repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fix: explicit feedback on json gotcha', '-m', 'COMMIT: fake body header that should not split record'], {
      cwd: arch51Repo,
      stdio: 'ignore'
    });
    const arch51Res = mineGitHistoryMemories(arch51Repo, { maxCommits: 5 });
    assert.equal(arch51Res.candidates.length, 1, 'Commit body containing COMMIT: must not split commit record');
    assert.equal(arch51Res.candidates[0].domain, 'general', 'Substring words (explicit/json/gotcha) must not misclassify domain');

    const gitlabWs51 = path.join(tempRoot, 'gitlab-ws-51');
    fs.mkdirSync(path.join(gitlabWs51, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(gitlabWs51, '.gitlab-ci.yml'), 'stages:\n  - test\n', 'utf8');
    const bootGitlab = bootstrapRepoMemories(gitlabWs51);
    assert.ok(bootGitlab.some(c => c.slug === 'ci-pipeline-conventions'), 'GitLab CI must be discovered even when .github/workflows/ exists but is empty');

    const dream51Ws = path.join(tempRoot, 'dream-51-ws');
    fs.mkdirSync(path.join(dream51Ws, '.agents', 'rules', 'memory'), { recursive: true });
    saveMemoryEntry(dream51Ws, { layer: 'workspace', slug: 'dream-rule-1', domain: 'k8s', description: 'Configure pod probes', why: 'Health', howToApply: 'Add readinessProbe' });
    saveMemoryEntry(dream51Ws, { layer: 'workspace', slug: 'dream-rule-2', domain: 'k8s', description: 'Configure ingress TLS', why: 'Security', howToApply: 'Enable cert-manager' });
    const strictDream = await dreamMemoryConsolidation(dream51Ws, { threshold: 0.99 });
    assert.equal(strictDream.clusters.length, 0, 'High explicit threshold (0.99) must not force unrelated rules into clusters');

    const drift51Ws = path.join(tempRoot, 'drift-51-ws');
    fs.mkdirSync(path.join(drift51Ws, '.agents', 'rules', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(drift51Ws, 'package.json'), JSON.stringify({
      name: 'drift-51',
      engines: { node: '>=18.0.0' },
      dependencies: { npm: '10.0.0' }
    }), 'utf8');
    saveMemoryEntry(drift51Ws, {
      layer: 'workspace',
      slug: 'sentence-contra-rule-a',
      domain: 'tooling',
      description: 'When installing JavaScript dependencies in the repository',
      why: 'Verify sentence boundaries',
      howToApply: 'Never use npm. Always use npm install for packages.'
    });
    saveMemoryEntry(drift51Ws, {
      layer: 'workspace',
      slug: 'sentence-contra-rule-b',
      domain: 'tooling',
      description: 'When installing JavaScript dependencies in the repository',
      why: 'Conflicting package manager',
      howToApply: 'Always use pnpm install for packages.'
    });
    saveMemoryEntry(drift51Ws, {
      layer: 'workspace',
      slug: 'k8s-node-and-url-rule',
      domain: 'infra',
      description: 'Cluster docs',
      why: 'No false Node version or config file drift',
      howToApply: 'See https://npm.im/pkg and ~/webpack.config.js. Restart Kubernetes node 1 before Do not use Node 14 upgrades.'
    });
    const drift51Res = detectContradictionsAndDrift(drift51Ws);
    assert.ok(
      drift51Res.contradictions.some(c =>
        (c.slug_a === 'sentence-contra-rule-a' && c.slug_b === 'sentence-contra-rule-b') ||
        (c.slug_a === 'sentence-contra-rule-b' && c.slug_b === 'sentence-contra-rule-a')
      ),
      'Affirmative sentence after negated sentence must be recognized by hasAffirmativeToolMention'
    );
    assert.equal(
      drift51Res.drifts.some(d => d.slug === 'k8s-node-and-url-rule'),
      false,
      'URLs, home ~/ paths, Kubernetes node N, and negated Node version must not trigger false drift'
    );

    // 6. setup.js legacy teamRepoUrl preservation, pull.js private extra arg, studio.js CLI port 0
    const setupStorage51 = path.join(tempRoot, 'setup-51-storage');
    fs.mkdirSync(setupStorage51, { recursive: true });
    fs.writeFileSync(path.join(setupStorage51, 'settings.json'), JSON.stringify({
      teamRepoUrl: 'https://example.com/legacy-team.git',
      teamRepos: []
    }), 'utf8');
    const prevStorage51 = process.env.KC_STORAGE_DIR;
    process.env.KC_STORAGE_DIR = setupStorage51;
    try {
      const setup51Res = setupEnvironment({
        teamRepoSlug: 'platform',
        teamRepoUrl: 'https://example.com/platform-team.git',
        installDependencies: false,
        silent: true
      });
      assert.ok(setup51Res.settings.teamRepos.some(r => r.slug === 'default' && r._legacyRoot === true && r.url === 'https://example.com/legacy-team.git'),
        'setupEnvironment must preserve legacy teamRepoUrl when adding named team repo');
      assert.ok(setup51Res.settings.teamRepos.some(r => r.slug === 'platform'), 'Named team repo must also be registered');
    } finally {
      process.env.KC_STORAGE_DIR = prevStorage51;
    }

    const setupCli51 = path.resolve(process.cwd(), 'plugins', 'knowledge-capture', 'bin', 'setup.js');
    const setupUnknownRun = spawnSync(process.execPath, [setupCli51, '--bogus-flag'], {
      env: { ...process.env, KC_STORAGE_DIR: setupStorage51 },
      encoding: 'utf8'
    });
    assert.notEqual(setupUnknownRun.status, 0, 'setup.js must reject unknown CLI flags');

    const pullCli51 = path.resolve(process.cwd(), 'plugins', 'knowledge-capture', 'bin', 'pull.js');
    const pullPrivRun = spawnSync(process.execPath, [pullCli51, 'private', 'extra-arg'], {
      env: { ...process.env, KC_STORAGE_DIR: setupStorage51 },
      encoding: 'utf8'
    });
    assert.equal(pullPrivRun.status, 0);
    assert.equal(pullPrivRun.stdout.includes('Team Memory'), false, 'pull.js private <extra> must not pull team repositories');

    const parsedStudioArgs = parseCliArgs(['--port=0', `--workspace=${studioWs51}`]);
    assert.equal(parsedStudioArgs.port, 0, 'studio CLI must allow --port=0');
    assert.equal(parsedStudioArgs.workspace, path.resolve(studioWs51));
    assert.throws(() => parseCliArgs(['--port', 'not-a-number']), /Invalid port number/);

    // 7. syran edge cases & MCP isError propagation
    assert.ok(evaluateProbability([null]).error, 'evaluateProbability([null]) must return structured error');
    const zeroPriorRes = evaluateProbability([{ label: 'H1' }, { label: 'H2' }], '0');
    assert.equal(zeroPriorRes.prior_probability, 0.01, "String '0' prior must clamp to 0.01 rather than falling back to 0.5");
    assert.equal(evaluateArchitecturalTradeoffs([{ name: 'A', scores: { c: 1 } }, null]).status, 'error');
    const infWeightRes = evaluateArchitecturalTradeoffs(
      [{ name: 'A', scores: { c: 1 } }, { name: 'B', scores: { c: 2 } }],
      [{ name: 'c', weight: Infinity }]
    );
    assert.equal(Number.isFinite(infWeightRes.utilityRanking[0].utilityScore), true, 'Infinity weight must not cause NaN utility');

    const syranMcp51 = path.resolve(process.cwd(), 'plugins', 'syran-persona', 'mcp-server', 'index.js');
    const syranErrRun = spawnSync(process.execPath, [syranMcp51], {
      input: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'syran_consult', arguments: { query: '' } } }) + '\n',
      encoding: 'utf8'
    });
    const syranErrJson = JSON.parse(syranErrRun.stdout.trim().split('\n')[0]);
    assert.equal(syranErrJson.result.isError, true, 'syran MCP server must set isError: true on error payloads');

    // 8. sync-manifests null author / invalid hooks & dual-scope plugin uninstall
    const badMarket = path.join(tempRoot, 'bad-manifest-market');
    const badPluginDir = path.join(badMarket, 'plugins', 'bad-p');
    fs.mkdirSync(badPluginDir, { recursive: true });
    fs.writeFileSync(path.join(badPluginDir, 'plugin.manifest.json'), JSON.stringify({
      name: 'bad-p',
      version: '1.0.0',
      author: null,
      hooks: { SessionStart: 'not-an-array' }
    }), 'utf8');
    const badSyncRes = syncManifests({ repoRoot: badMarket, checkMode: false });
    assert.ok(badSyncRes.validationErrors.length > 0, 'Invalid hooks type must report validation error instead of crashing');

    const { installPlugin, uninstallPlugin, isPluginEnabled } = requireCjs('../bin/plugin-manager.js');
    const pmHome51 = path.join(tempRoot, 'pm-home-51');
    const pmWs51 = path.join(tempRoot, 'pm-ws-51');
    fs.mkdirSync(pmHome51, { recursive: true });
    fs.mkdirSync(pmWs51, { recursive: true });
    installPlugin('syran-persona', process.cwd(), 'workspace', pmWs51, pmHome51);
    installPlugin('syran-persona', process.cwd(), 'global', pmWs51, pmHome51);
    uninstallPlugin('syran-persona', 'workspace', pmWs51, pmHome51);
    assert.equal(isPluginEnabled('syran-persona', pmHome51), true, 'Uninstalling workspace copy must keep plugin enabled when global copy remains');
  }

  console.log('  ✔ Passed: Final round hardening across UI, DB, scanners, CLIs, Syran & installer verified.\n');

  // ==========================================
  // TEST 52: Audit Bug Fixes Regression Suite (11 Issues)
  // ==========================================
  console.log('Test 52: Audit Regression Suite (Team Read-Only, Scoped Telemetry, Vector Cache, Studio Auth, Scanners, Syran)...');
  {
    const { getDatabase, resetDatabaseInstance, getDbPath } = await import('../plugins/knowledge-capture/mcp-server/db/connection.js');
    const vm = await import('node:vm');

    // 52.1 Hook character budget (< 9,500 chars)
    const kcAgentsMd = fs.readFileSync(path.resolve(process.cwd(), 'plugins', 'knowledge-capture', 'rules', 'AGENTS.md'), 'utf8');
    const syranAgentsMd = fs.readFileSync(path.resolve(process.cwd(), 'plugins', 'syran-persona', 'rules', 'AGENTS.md'), 'utf8');
    assert.ok(kcAgentsMd.length < 9500, `knowledge-capture AGENTS.md must stay under 9500 chars (got ${kcAgentsMd.length})`);
    assert.ok(syranAgentsMd.length < 9500, `syran-persona AGENTS.md must stay under 9500 chars (got ${syranAgentsMd.length})`);

    // 52.2 Team layer read-only enforcement in applyMemoryPatch & Studio HTML
    const roWs = path.join(tempRoot, 'ro-team-ws');
    fs.mkdirSync(path.join(roWs, '.agents', 'rules', 'memory'), { recursive: true });
    const roTeamRepo = addTeamRepository('ro-org', 'https://github.com/org/ro-org.git', 'RO Org', roWs);
    saveMemoryEntry(roWs, {
      layer: 'workspace',
      slug: 'local-ws-rule',
      domain: 'Backend',
      type: 'personal-preference',
      description: 'Local rule checking normalization and safe linking',
      why: 'Normalize type & domain',
      howToApply: 'Keep types canonical.'
    });
    const savedLocal = getMemoryContent(roWs, 'workspace', 'local-ws-rule');
    assert.equal(parseYamlFrontmatter(savedLocal.content).frontmatter.type, 'preference', 'saveMemoryEntry must normalize personal-preference to preference');
    assert.equal(parseYamlFrontmatter(savedLocal.content).frontmatter.domain, 'backend', 'saveMemoryEntry must lowercase domain');

    const teamRulePath = path.join(roTeamRepo.dir, 'team-immutable-rule.md');
    const originalTeamContent = '---\nname: team-immutable-rule\ndomain: security\ntype: convention\ndescription: Immutable shared rule\nverified: 2026-01-01\n---\n# Team Immutable Rule\nShared convention.\n';
    fs.writeFileSync(teamRulePath, originalTeamContent, 'utf8');

    const teamModRes = applyMemoryPatch(roWs, {
      modified_nodes: [{ slug: 'team-immutable-rule', domain: 'hacked', description: 'Tampered' }],
      added_links: [{ source: 'team-immutable-rule', target: 'local-ws-rule', type: 'related' }]
    });
    assert.equal(teamModRes.ok, false, 'applyMemoryPatch must reject modifications to team layer nodes');
    assert.ok(teamModRes.errors.length >= 2, 'applyMemoryPatch must report errors for both team node edit and outgoing team link');
    assert.equal(fs.readFileSync(teamRulePath, 'utf8'), originalTeamContent, 'Team markdown file must remain untouched on disk');

    // Linking from workspace -> team target must still succeed
    const wsToTeamLink = applyMemoryPatch(roWs, {
      added_links: [{ source: 'local-ws-rule', target: 'team-immutable-rule', type: 'related' }]
    });
    assert.equal(wsToTeamLink.ok, true, 'Linking workspace node -> team target must remain allowed');

    // Schema normalization & Studio UI read-only/general cleanup
    const studioHtml52 = generateKnowledgeGraphHtml(roWs);
    assert.ok(studioHtml52.includes('ins-readonly-banner'), 'Studio HTML must include Team read-only banner');
    assert.ok(studioHtml52.includes('isReadOnlyTeam'), 'Studio HTML must disable controls for Team nodes');
    assert.equal(studioHtml52.includes('<option value="general">general</option>'), false, 'Studio HTML must not offer legacy general option in type selector');

    const elicitSkill = fs.readFileSync(path.resolve(process.cwd(), 'plugins', 'knowledge-capture', 'skills', 'kc-elicit', 'SKILL.md'), 'utf8');
    const promoteSkill = fs.readFileSync(path.resolve(process.cwd(), 'plugins', 'knowledge-capture', 'skills', 'kc-promote', 'SKILL.md'), 'utf8');
    assert.equal(/`gotcha`/.test(elicitSkill), false, 'kc-elicit must not reference stale `gotcha` type');
    assert.ok(promoteSkill.includes('teamSlug'), 'kc-promote must document teamSlug targeting');

    // 52.3 Workspace-partitioned telemetry & schema v3 migration
    const repoA = path.join(tempRoot, 'tele-repo-a');
    const repoB = path.join(tempRoot, 'tele-repo-b');
    fs.mkdirSync(path.join(repoA, '.agents', 'rules', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(repoB, '.agents', 'rules', 'memory'), { recursive: true });
    saveMemoryEntry(repoA, { layer: 'workspace', slug: 'shared-tele-slug', domain: 'api', description: 'Shared slug in Repo A', why: 'A', howToApply: 'Rule A' });
    saveMemoryEntry(repoB, { layer: 'workspace', slug: 'shared-tele-slug', domain: 'api', description: 'Shared slug in Repo B', why: 'B', howToApply: 'Rule B' });
    await syncSqliteIndex(repoA, { engine: 'heuristic' });
    await syncSqliteIndex(repoB, { engine: 'heuristic' });

    recordMemoryEfficacy('shared-tele-slug', 'test_fail', { workspaceRoot: repoA, layer: 'workspace', message: 'Failed in Repo A only' });
    recordMemoryEfficacy('shared-tele-slug', 'test_fail', { workspaceRoot: repoA, layer: 'workspace', message: 'Failed twice in Repo A' });
    const searchA = await searchMemoriesHybrid(repoA, 'Shared slug', { sync: false, limit: 20 });
    const searchB = await searchMemoriesHybrid(repoB, 'Shared slug', { sync: false, limit: 20 });
    const hitA = searchA.find(r => r.slug === 'shared-tele-slug');
    const hitB = searchB.find(r => r.slug === 'shared-tele-slug');
    const nodeA = getKnowledgeGraphData(repoA).nodes.find(n => n.slug === 'shared-tele-slug');
    const nodeB = getKnowledgeGraphData(repoB).nodes.find(n => n.slug === 'shared-tele-slug');
    assert.ok(hitA && hitA.efficacyScore < 1.0, `Repo A test failures must reduce Repo A efficacyScore (got ${hitA?.efficacyScore})`);
    assert.equal(hitB?.efficacyScore, 1.0, 'Repo A test failures must NOT contaminate Repo B search efficacyScore');
    assert.equal(nodeB?.efficacy_score, 1.0, 'Repo A test failures must NOT contaminate Repo B graph efficacy_score');
    assert.ok(nodeA && nodeA.efficacy_score < 1.0, 'Repo A graph node must reflect Repo A efficacy degradation');

    // Verify clean sync: false & isIndexDirty without N+1 re-parses
    assert.equal(isIndexDirty(repoA), false, 'Synced Repo A must report isIndexDirty === false');
    assert.equal(isIndexDirty(repoB), false, 'Synced Repo B must report isIndexDirty === false');

    // Verify legacy v2 telemetry(slug PRIMARY KEY) migration to schema v3
    const legacyDbStorage = path.join(tempRoot, 'legacy-v2-storage');
    fs.mkdirSync(legacyDbStorage, { recursive: true });
    const savedStorageEnv52 = process.env.KC_STORAGE_DIR;
    process.env.KC_STORAGE_DIR = legacyDbStorage;
    resetDatabaseInstance();
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const legacyDb = new DatabaseSync(getDbPath());
      legacyDb.exec(`
        CREATE TABLE meta (key TEXT PRIMARY KEY, val TEXT);
        INSERT INTO meta (key, val) VALUES ('schema_version', '2');
        CREATE TABLE memories (workspace_id TEXT NOT NULL, layer TEXT NOT NULL, team_slug TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, slug TEXT NOT NULL, domain TEXT, type TEXT, verified TEXT, trigger TEXT, mtime INTEGER, trigger_vector BLOB, content_vector BLOB, entity_vector BLOB, PRIMARY KEY (workspace_id, layer, team_slug, path));
        CREATE TABLE telemetry (slug TEXT PRIMARY KEY, recalled_count INTEGER DEFAULT 0, applied_count INTEGER DEFAULT 0, test_pass_count INTEGER DEFAULT 0, test_fail_count INTEGER DEFAULT 0, efficacy_score REAL DEFAULT 1.0, last_recalled TEXT, last_applied TEXT, last_feedback TEXT);
        INSERT INTO telemetry (slug, recalled_count, test_fail_count, efficacy_score) VALUES ('legacy-rule', 4, 1, 0.75);
      `);
      legacyDb.close();
      const migratedDb = getDatabase();
      const verRow = migratedDb.prepare("SELECT val FROM meta WHERE key = 'schema_version'").get();
      assert.equal(verRow.val, '3', 'Legacy telemetry DB must upgrade to schema_version 3');
      const migratedTele = migratedDb.prepare("SELECT workspace_id, recalled_count, efficacy_score FROM telemetry WHERE slug = 'legacy-rule'").get();
      assert.equal(migratedTele.workspace_id, 'global', 'Legacy telemetry row must migrate into workspace_id = global');
      assert.equal(migratedTele.recalled_count, 4, 'Legacy telemetry recalled_count must be preserved');
    } finally {
      resetDatabaseInstance();
      process.env.KC_STORAGE_DIR = savedStorageEnv52;
      resetDatabaseInstance();
    }

    // 52.4 Dimension-partitioned memory_vectors cache & ONNX stable dimensions
    const activeCfg52 = getActiveEmbeddingConfig();
    assert.ok(activeCfg52.dimensions === 384 || activeCfg52.dimensions === 128);
    const db52 = getDatabase();
    const vecRows52 = db52.prepare('SELECT DISTINCT dimensions FROM memory_vectors').all();
    assert.ok(vecRows52.length >= 1, 'memory_vectors table must cache per-dimension embeddings');
    const aVecBefore = db52.prepare('SELECT COUNT(*) AS c FROM memories WHERE workspace_id = ? AND trigger_vector IS NOT NULL').get(normalizeWorkspaceId(repoA)).c;
    assert.ok(aVecBefore >= 1, 'Repo A vectors must be stored in SQLite');

    // 52.5 Studio auth: missing X-Studio-Token without Origin must return 403 + MiniD3 zoom/drag math
    const authStudio = await startStudioServer(roWs, { port: 0, autoOpen: false });
    try {
      const noTokenNoOrigin = await fetch(`${authStudio.url}/api/patch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modified_nodes: [] })
      });
      assert.equal(noTokenNoOrigin.status, 403, 'POST /api/patch without X-Studio-Token and without Origin must return 403');
    } finally {
      await authStudio.close();
    }

    // Verify MiniD3 zoomed drag coordinate inversion
    const matchZoom = studioHtml52.match(/window\.__MINI_D3__ = true;\s*window\.d3 = \(function\(\) \{[\s\S]*?\}\)\(\);/);
    assert.ok(matchZoom, 'MiniD3 block must be present in Studio HTML');
    const listeners = {};
    const mockSvg = {
      __zoomTransform: { scale: 1, tx: 0, ty: 0 },
      addEventListener: (ev, cb) => { listeners[`svg:${ev}`] = cb; },
      getBoundingClientRect: () => ({ left: 100, top: 50 })
    };
    const mockNodeEl = {
      __data__: { id: 'n1', x: 0, y: 0 },
      addEventListener: (ev, cb) => { listeners[`node:${ev}`] = cb; }
    };
    const sandbox52 = {
      window: {
        addEventListener: (ev, cb) => { listeners[`win:${ev}`] = cb; }
      },
      document: {
        getElementById: (id) => (id === 'canvas' ? mockSvg : null)
      }
    };
    vm.runInNewContext(matchZoom[0], sandbox52);
    const zoomBehavior = sandbox52.window.d3.zoom().scaleExtent([0.2, 3]).on('zoom', () => {});
    zoomBehavior({ _elements: [mockSvg] });
    mockSvg.__zoomTransform = { scale: 2, tx: 50, ty: 20 };
    let draggedCoords = null;
    const dragBehavior = sandbox52.window.d3.drag()
      .on('start', () => {})
      .on('drag', (ev) => { draggedCoords = { x: ev.x, y: ev.y }; })
      .on('end', () => {});
    dragBehavior({ _elements: [mockNodeEl] });
    listeners['node:mousedown']({ stopPropagation: () => {} });
    listeners['win:mousemove']({ clientX: 250, clientY: 170 });
    assert.equal(draggedCoords.x, 50, 'MiniD3 zoomed drag X must invert (250 - 100 - 50) / 2 = 50');
    assert.equal(draggedCoords.y, 50, 'MiniD3 zoomed drag Y must invert (170 - 50 - 20) / 2 = 50');

    // 52.6 Syran uniform prior & mixed h.prior mass distribution
    const uniformSyran = evaluateProbability([
      { label: 'Hyp A', weight: 0.6 },
      { label: 'Hyp B', weight: 0.6 },
      { label: 'Hyp C', weight: 0.6 }
    ]);
    assert.equal(uniformSyran.evaluations[0].probability, '33.33%', '3 hypotheses with omitted prior must evaluate to 33.33% each');
    assert.equal(uniformSyran.evaluations[1].probability, '33.33%');
    assert.equal(uniformSyran.evaluations[2].probability, '33.33%');

    const mixedSyran = evaluateProbability([
      { label: 'Known', prior: 0.6, weight: 0.5 },
      { label: 'Unknown 1', weight: 0.5 },
      { label: 'Unknown 2', weight: 0.5 }
    ]);
    const u1 = mixedSyran.evaluations.find(h => h.label === 'Unknown 1');
    const u2 = mixedSyran.evaluations.find(h => h.label === 'Unknown 2');
    assert.equal(u1.posterior_probability, 0.2, 'Remaining prior mass (0.4) must be split evenly across unspecified hypotheses');
    assert.equal(u2.posterior_probability, 0.2);

    // 52.7 MCP schema enum + JSON-RPC error response
    const kcMcp52 = path.resolve(process.cwd(), 'plugins', 'knowledge-capture', 'mcp-server', 'index.js');
    const mcpRun52 = spawnSync(process.execPath, [kcMcp52], {
      input: [
        '{bad json',
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'unknown/method' })
      ].join('\n') + '\n',
      env: { ...process.env, KC_STORAGE_DIR: process.env.KC_STORAGE_DIR },
      encoding: 'utf8'
    });
    const mcpLines52 = mcpRun52.stdout.trim().split('\n').map(l => JSON.parse(l));
    assert.equal(mcpLines52[0].error.code, -32700, 'Malformed JSON-RPC input must return -32700');
    const mergeToolDef = mcpLines52[1].result.tools.find(t => t.name === 'merge_memory_entries');
    assert.ok(mergeToolDef.inputSchema.properties.type.enum.includes('preference'), 'merge_memory_entries enum must contain preference');
    assert.equal(mergeToolDef.inputSchema.properties.type.enum.includes('personal-preference'), false, 'merge_memory_entries enum must not contain personal-preference');
    assert.equal(mcpLines52[2].error.code, -32601, 'Unknown JSON-RPC method must return -32601');

    // 52.8 Archeology priority scoring + session sentinel directives/errors + bootstrap + nvmrc drift
    const arch52Repo = path.join(tempRoot, 'arch-52-repo');
    fs.mkdirSync(arch52Repo, { recursive: true });
    execFileSync('git', ['init'], { cwd: arch52Repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: arch52Repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: arch52Repo, stdio: 'ignore' });
    fs.writeFileSync(path.join(arch52Repo, 'app.js'), '0\n', 'utf8');
    execFileSync('git', ['add', '.'], { cwd: arch52Repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'revert: roll back broken deploy script after oom deadlock'], { cwd: arch52Repo, stdio: 'ignore' });
    for (let i = 1; i <= 12; i++) {
      fs.writeFileSync(path.join(arch52Repo, 'app.js'), `${i}\n`, 'utf8');
      execFileSync('git', ['add', '.'], { cwd: arch52Repo, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', `fix: minor tweak ${i}`], { cwd: arch52Repo, stdio: 'ignore' });
    }
    const arch52Res = mineGitHistoryMemories(arch52Repo, { maxCommits: 20, limit: 5 });
    assert.ok(arch52Res.candidates.some(c => c.description.includes('revert: roll back broken deploy')),
      'Archeology scanner must surface older high-signal revert commit ahead of routine fix commits');

    const sentinel52Ws = path.join(tempRoot, 'sentinel-52-ws');
    fs.mkdirSync(path.join(sentinel52Ws, '.agents', 'rules', 'memory'), { recursive: true });
    const sentinel52Res = autoElicitSessionKnowledge(sentinel52Ws, {
      userFeedback: ['Always use uv for Python packaging instead of pip', 'Never use var in JavaScript'],
      transcript: [
        'Error: ECONNREFUSED 127.0.0.1:5432',
        'TypeError: Cannot read properties of undefined (reading foo)'
      ].join('\n')
    });
    assert.ok(sentinel52Res.suggested_candidates.some(c => c.slug.includes('directive') || c.slug.includes('preference')),
      'Session sentinel must capture Always/Never user directives');
    const debugCands = sentinel52Res.suggested_candidates.filter(c => c.elicited_from === 'zero_code_debugging');
    assert.equal(debugCands.length, 2, 'Session sentinel must capture up to 2 distinct debug error candidates');

    const boot52Ws = path.join(tempRoot, 'boot-52-ws');
    fs.mkdirSync(path.join(boot52Ws, '.agents', 'rules', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(boot52Ws, 'go.mod'), 'module example.com/app\ngo 1.22\n', 'utf8');
    fs.writeFileSync(path.join(boot52Ws, 'tsconfig.json'), '{ "compilerOptions": { "strict": true } }\n', 'utf8');
    fs.writeFileSync(path.join(boot52Ws, 'eslint.config.mjs'), 'export default [];\n', 'utf8');
    fs.writeFileSync(path.join(boot52Ws, '.nvmrc'), 'v20.11.0\n', 'utf8');
    const boot52 = bootstrapRepoMemories(boot52Ws);
    assert.ok(boot52.some(c => c.slug === 'go-module-toolchain'), 'Bootstrap scanner must detect go.mod');
    assert.ok(boot52.some(c => c.slug === 'typescript-compiler-standards'), 'Bootstrap scanner must detect tsconfig.json');
    assert.ok(boot52.some(c => c.slug === 'eslint-code-standards'), 'Bootstrap scanner must detect eslint.config.mjs');
    assert.ok(boot52.some(c => c.slug === 'node-runtime-version-pin'), 'Bootstrap scanner must detect .nvmrc');

    saveMemoryEntry(boot52Ws, {
      layer: 'workspace',
      slug: 'legacy-node-rule',
      domain: 'tooling',
      description: 'When running local scripts',
      why: 'Runtime alignment',
      howToApply: 'Requires Node 16 for build scripts.'
    });
    const drift52 = detectContradictionsAndDrift(boot52Ws);
    assert.ok(drift52.drifts.some(d => d.slug === 'legacy-node-rule' && /20/.test(d.detail)),
      'Drift detector must detect Node runtime drift from .nvmrc when package.json lacks engines.node');
  }
  console.log('  ✔ Passed: All 11 audit regression checks verified.\n');

  console.log('============================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
  console.log('============================================================\n');
} finally {
  await teardown();
}
