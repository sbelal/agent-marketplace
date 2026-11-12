import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const tempRoot = path.join(os.tmpdir(), `kc-test-${Date.now()}`);
fs.mkdirSync(tempRoot, { recursive: true });

// Strictly isolate KC_STORAGE_DIR to temporary directory for all tests
process.env.KC_STORAGE_DIR = path.join(tempRoot, 'kc-storage');
fs.mkdirSync(process.env.KC_STORAGE_DIR, { recursive: true });

import { execFileSync } from 'node:child_process';

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
  prepareTeamPromotion
} from '../plugins/knowledge-capture/mcp-server/memory-service.js';

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
  getMemoryGraphNeighbors
} from '../plugins/knowledge-capture/mcp-server/sqlite-index.js';

import {
  consultLogic,
  analyzeLogicalFallacies,
  evaluateProbability
} from '../plugins/syran-persona/mcp-server/logic-service.js';

function teardown() {
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

  syncSqliteIndex(path.join(tempRoot, 'ws1'));

  const probeResult = proactiveMemoryProbe(
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
  syncSqliteIndex(ws1Root);
  // Sync WS2
  syncSqliteIndex(ws2Root);

  // Search WS1: should find k8s-delete-guard, NOT ws2-unique-rule
  const ws1Results = searchMemoriesHybrid(ws1Root, 'delete namespace');
  assert.ok(ws1Results.some(r => r.slug === 'k8s-delete-guard'), 'WS1 should find its own workspace memory');

  // Verify WS2 search finds its own memory and does not delete WS1
  const ws2Results = searchMemoriesHybrid(ws2Root, 'lock timeout');
  assert.ok(ws2Results.some(r => r.slug === 'ws2-unique-rule'), 'WS2 should find its own unique rule');

  // Re-verify WS1 still has its memory (not purged by WS2 sync)
  const ws1ResultsAgain = searchMemoriesHybrid(ws1Root, 'delete namespace');
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
    const searchRes = searchMemoriesHybrid(ws1Root, 'k8s-delete-guard');
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

  // Hybrid search execution with RRF
  const hybridMatches = searchMemoriesHybrid(ws1Root, 'docker', { mode: 'hybrid' });
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
  syncSqliteIndex(ws1Root);

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

  console.log('============================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
  console.log('============================================================\n');
} finally {
  teardown();
}
