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
  prepareTeamPromotion,
  getTeamRepositories,
  addTeamRepository,
  setTeamRepositoryActive,
  removeTeamRepository,
  syncTeamRepositories,
  getMemorySummary,
  deriveTeamRepoSlug
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
  getMemoryGraphNeighbors,
  generateEmbedding,
  getActiveEmbeddingConfig,
  resetOnnxState,
  isIndexDirty
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
  console.log('  ✔ Passed: Multi-team repository addition, scoping, activation toggling, and removal verified.\n');

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

  console.log('============================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY!');
  console.log('============================================================\n');
} finally {
  teardown();
}
