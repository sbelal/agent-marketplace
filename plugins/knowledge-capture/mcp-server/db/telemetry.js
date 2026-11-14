import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './connection.js';
import { getTelemetryJsonPath, normalizeWorkspaceId } from '../core/storage-paths.js';

export function readTelemetryJson() {
  const p = getTelemetryJsonPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch {
    return {};
  }
}

export function writeTelemetryJson(data) {
  const p = getTelemetryJsonPath();
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tempPath = path.join(dir, `.${path.basename(p)}.tmp.${process.pid}.${Date.now()}`);
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tempPath, p);
  } catch {}
}

function makeScopedJsonKey(workspaceId, layer, teamSlug, canonSlug) {
  if (workspaceId === 'global' && !layer && !teamSlug) {
    return canonSlug;
  }
  return `${workspaceId}::${layer || ''}::${teamSlug || ''}::${canonSlug}`;
}

/**
 * Resolves the canonical telemetry partition key `(workspaceId, layer, teamSlug)` for a memory slug.
 */
export function resolveTelemetryPartition(slug, details = {}, db = null) {
  const canonSlug = String(slug || '').trim().toLowerCase();
  const safeDetails = (details && typeof details === 'object' && !Array.isArray(details)) ? details : {};
  const workspaceRoot = safeDetails.workspaceRoot;
  const explicitlyScopedLayer = typeof safeDetails.layer === 'string' ? safeDetails.layer.toLowerCase() : '';
  const explicitTeamSlug = typeof safeDetails.teamSlug === 'string' ? safeDetails.teamSlug : '';

  if (typeof safeDetails.workspaceId === 'string' && typeof safeDetails.layer === 'string') {
    return {
      workspaceId: safeDetails.workspaceId || 'global',
      layer: explicitlyScopedLayer,
      teamSlug: explicitTeamSlug
    };
  }

  if (explicitlyScopedLayer === 'workspace') {
    return {
      workspaceId: normalizeWorkspaceId(workspaceRoot || process.cwd()),
      layer: 'workspace',
      teamSlug: ''
    };
  }
  if (explicitlyScopedLayer === 'private') {
    return { workspaceId: 'global', layer: 'private', teamSlug: '' };
  }
  if (explicitlyScopedLayer === 'team') {
    return { workspaceId: 'global', layer: 'team', teamSlug: explicitTeamSlug };
  }

  if (workspaceRoot) {
    const wsId = normalizeWorkspaceId(workspaceRoot);
    if (db) {
      try {
        const memRow = db.prepare(`
          SELECT workspace_id, layer, team_slug
          FROM memories
          WHERE (workspace_id = ? OR workspace_id = 'global') AND LOWER(slug) = ?
          ORDER BY CASE layer WHEN 'workspace' THEN 3 WHEN 'private' THEN 2 WHEN 'team' THEN 1 ELSE 0 END DESC
          LIMIT 1
        `).get(wsId, canonSlug);
        if (memRow) {
          return {
            workspaceId: memRow.workspace_id || wsId,
            layer: memRow.layer || '',
            teamSlug: memRow.team_slug || ''
          };
        }
      } catch {}
    }
    const wsMemFile = path.join(workspaceRoot, '.agents', 'rules', 'memory', `${canonSlug}.md`);
    if (fs.existsSync(wsMemFile)) {
      return { workspaceId: wsId, layer: 'workspace', teamSlug: '' };
    }
    return { workspaceId: wsId, layer: '', teamSlug: '' };
  }

  return { workspaceId: 'global', layer: '', teamSlug: '' };
}

/**
 * Loads telemetry lookup map for a workspace (own workspace rows + shared 'global' rows).
 */
export function loadScopedTelemetryMap(workspaceRoot = process.cwd(), dbInstance = null) {
  const db = dbInstance || getDatabase();
  const wsId = normalizeWorkspaceId(workspaceRoot);
  const byFullKey = new Map();

  if (db) {
    try {
      const rows = db.prepare(`
        SELECT * FROM telemetry
        WHERE workspace_id = ? OR workspace_id = 'global'
      `).all(wsId);
      for (const row of rows) {
        if (!row || !row.slug) continue;
        const key = `${row.workspace_id || 'global'}::${row.layer || ''}::${row.team_slug || ''}::${String(row.slug).toLowerCase()}`;
        byFullKey.set(key, row);
      }
      return byFullKey;
    } catch {}
  }

  const jsonData = readTelemetryJson();
  for (const [k, v] of Object.entries(jsonData)) {
    if (!v || typeof v !== 'object') continue;
    if (k.includes('::')) {
      const parts = k.split('::');
      if (parts.length >= 4) {
        const rowWs = parts[0];
        if (rowWs === wsId || rowWs === 'global') {
          byFullKey.set(k.toLowerCase(), { slug: parts.slice(3).join('::'), ...v });
        }
      }
    } else {
      byFullKey.set(`global::::::${k.toLowerCase()}`, { slug: k, ...v });
    }
  }
  return byFullKey;
}

/**
 * Picks the best matching telemetry record for a specific memory partition, preventing cross-repo bleed.
 */
export function pickTelemetryEntry(teleLookup, workspaceId, layer, teamSlug, slug) {
  if (!teleLookup || !slug) return null;
  const sLower = String(slug).trim().toLowerCase();
  const ws = workspaceId || 'global';
  const l = layer || '';
  const ts = teamSlug || '';

  return (
    teleLookup.get(`${ws}::${l}::${ts}::${sLower}`) ||
    teleLookup.get(`${ws}::${l}::::${sLower}`) ||
    teleLookup.get(`${ws}::::::${sLower}`) ||
    (ws !== 'global' ? teleLookup.get(`global::::::${sLower}`) : teleLookup.get(`global::${l}::${ts}::${sLower}`)) ||
    teleLookup.get(`global::::::${sLower}`) ||
    null
  );
}

/**
 * Records telemetry events and verification feedback for memory utility and efficacy scoring.
 */
export function recordTelemetryEvent(slug, eventType = 'recall', details = {}) {
  if (!slug) return;
  const canonSlug = String(slug).trim().toLowerCase();
  if (!canonSlug) return;
  const safeDetails = (details && typeof details === 'object' && !Array.isArray(details)) ? details : {};
  const db = getDatabase();
  const partition = resolveTelemetryPartition(canonSlug, safeDetails, db);
  const nowIso = new Date().toISOString();

  if (db) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO telemetry (
          workspace_id, layer, team_slug, slug,
          recalled_count, applied_count, test_pass_count, test_fail_count, efficacy_score
        )
        VALUES (?, ?, ?, ?, 0, 0, 0, 0, 1.0)
      `).run(partition.workspaceId, partition.layer, partition.teamSlug, canonSlug);

      if (eventType === 'apply' || eventType === 'applied') {
        db.prepare(`
          UPDATE telemetry
          SET applied_count = applied_count + 1, last_applied = ?
          WHERE workspace_id = ? AND layer = ? AND team_slug = ? AND slug = ?
        `).run(nowIso, partition.workspaceId, partition.layer, partition.teamSlug, canonSlug);
      } else if (eventType === 'test_pass') {
        db.prepare(`
          UPDATE telemetry
          SET test_pass_count = test_pass_count + 1,
              efficacy_score = MIN(1.0, efficacy_score + 0.05),
              last_feedback = ?
          WHERE workspace_id = ? AND layer = ? AND team_slug = ? AND slug = ?
        `).run(safeDetails.message || 'test_passed', partition.workspaceId, partition.layer, partition.teamSlug, canonSlug);
      } else if (eventType === 'test_fail') {
        db.prepare(`
          UPDATE telemetry
          SET test_fail_count = test_fail_count + 1,
              efficacy_score = MAX(0.1, efficacy_score - 0.20),
              last_feedback = ?
          WHERE workspace_id = ? AND layer = ? AND team_slug = ? AND slug = ?
        `).run(safeDetails.message || 'test_failed', partition.workspaceId, partition.layer, partition.teamSlug, canonSlug);
      } else {
        db.prepare(`
          UPDATE telemetry
          SET recalled_count = recalled_count + 1, last_recalled = ?
          WHERE workspace_id = ? AND layer = ? AND team_slug = ? AND slug = ?
        `).run(nowIso, partition.workspaceId, partition.layer, partition.teamSlug, canonSlug);
      }
      return;
    } catch {}
  }

  // Fallback to telemetry.json
  const data = readTelemetryJson();
  const jsonKey = makeScopedJsonKey(partition.workspaceId, partition.layer, partition.teamSlug, canonSlug);
  if (!data[jsonKey]) {
    data[jsonKey] = {
      workspace_id: partition.workspaceId,
      layer: partition.layer,
      team_slug: partition.teamSlug,
      slug: canonSlug,
      recalled_count: 0,
      applied_count: 0,
      test_pass_count: 0,
      test_fail_count: 0,
      efficacy_score: 1.0,
      last_recalled: null,
      last_applied: null,
      last_feedback: null
    };
  }
  if (eventType === 'apply' || eventType === 'applied') {
    data[jsonKey].applied_count = (data[jsonKey].applied_count || 0) + 1;
    data[jsonKey].last_applied = nowIso;
  } else if (eventType === 'test_pass') {
    data[jsonKey].test_pass_count = (data[jsonKey].test_pass_count || 0) + 1;
    data[jsonKey].efficacy_score = Math.min(1.0, (data[jsonKey].efficacy_score || 1.0) + 0.05);
    data[jsonKey].last_feedback = safeDetails.message || 'test_passed';
  } else if (eventType === 'test_fail') {
    data[jsonKey].test_fail_count = (data[jsonKey].test_fail_count || 0) + 1;
    data[jsonKey].efficacy_score = Math.max(0.1, (data[jsonKey].efficacy_score || 1.0) - 0.20);
    data[jsonKey].last_feedback = safeDetails.message || 'test_failed';
  } else {
    data[jsonKey].recalled_count = (data[jsonKey].recalled_count || 0) + 1;
    data[jsonKey].last_recalled = nowIso;
  }
  writeTelemetryJson(data);
}

/**
 * Asynchronous, non-blocking telemetry event emitter.
 * Dispatches recording on next event loop tick without blocking CQS read queries.
 */
export function emitTelemetryEvent(slug, eventType = 'recall', details = {}) {
  if (!slug) return;
  const canonSlug = String(slug).trim().toLowerCase();
  if (!canonSlug) return;
  setImmediate(() => {
    try {
      recordTelemetryEvent(canonSlug, eventType, details);
    } catch {}
  });
}

/**
 * Public command: Explicitly records memory efficacy feedback (test_pass, test_fail, applied).
 */
export function recordMemoryEfficacy(slug, feedbackType, details = {}) {
  const canonSlug = String(slug || '').trim().toLowerCase();
  const safeDetails = (details && typeof details === 'object' && !Array.isArray(details)) ? details : {};
  recordTelemetryEvent(canonSlug, feedbackType, safeDetails);
  const db = getDatabase();
  const partition = resolveTelemetryPartition(canonSlug, safeDetails, db);

  if (db) {
    try {
      const row = db.prepare(`
        SELECT * FROM telemetry
        WHERE workspace_id = ? AND layer = ? AND team_slug = ? AND LOWER(slug) = ?
      `).get(partition.workspaceId, partition.layer, partition.teamSlug, canonSlug);
      if (row) return row;
    } catch {}
  }
  const data = readTelemetryJson();
  const jsonKey = makeScopedJsonKey(partition.workspaceId, partition.layer, partition.teamSlug, canonSlug);
  return data[jsonKey]
    ? { slug: canonSlug, ...data[jsonKey] }
    : { slug: canonSlug, efficacy_score: 1.0 };
}

/**
 * Closed-Loop Execution-Driven Efficacy Hook.
 * Correlates test suite executions (command, exitCode, stdout, stderr) with memory rules.
 */
export function correlateTestExecutionEfficacy(workspaceRoot = process.cwd(), options = {}) {
  const { command = '', exitCode = 0, stdout = '', stderr = '', slugs = [] } = options;
  const db = getDatabase();
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  const explicitSlugsProvided = Array.isArray(slugs) && slugs.length > 0;
  let targetTargets = explicitSlugsProvided
    ? slugs.map(s => ({ slug: s, partition: null }))
    : [];

  if (targetTargets.length === 0) {
    if (db) {
      try {
        const rows = db.prepare(`
          SELECT workspace_id, layer, team_slug, slug FROM telemetry
          WHERE (workspace_id = ? OR workspace_id = 'global')
            AND (last_applied IS NOT NULL OR last_recalled IS NOT NULL)
          ORDER BY COALESCE(last_applied, last_recalled) DESC
          LIMIT 5
        `).all(currentWsId);
        const seen = new Set();
        for (const r of rows) {
          if (!r || !r.slug) continue;
          const partKey = `${r.workspace_id || 'global'}::${r.layer || ''}::${r.team_slug || ''}::${String(r.slug).toLowerCase()}`;
          if (!seen.has(partKey)) {
            seen.add(partKey);
            targetTargets.push({
              slug: r.slug,
              partition: {
                workspaceId: r.workspace_id || 'global',
                layer: r.layer || '',
                teamSlug: r.team_slug || ''
              }
            });
          }
        }
      } catch {}
    } else {
      const data = readTelemetryJson();
      const entries = Object.entries(data)
        .filter(([k, entry]) => {
          if (!entry || (!entry.last_applied && !entry.last_recalled)) return false;
          if (k.includes('::')) {
            const ws = k.split('::')[0];
            return ws === currentWsId || ws === 'global';
          }
          return true;
        })
        .sort(([, a], [, b]) => String(b.last_applied || b.last_recalled).localeCompare(String(a.last_applied || a.last_recalled)))
        .slice(0, 5);
      for (const [k, entry] of entries) {
        if (k.includes('::')) {
          const parts = k.split('::');
          targetTargets.push({
            slug: entry.slug || parts.slice(3).join('::'),
            partition: {
              workspaceId: parts[0] || 'global',
              layer: parts[1] || '',
              teamSlug: parts[2] || ''
            }
          });
        } else {
          targetTargets.push({
            slug: entry.slug || k,
            partition: {
              workspaceId: 'global',
              layer: '',
              teamSlug: ''
            }
          });
        }
      }
    }
  }

  const results = {
    command,
    exitCode,
    outcome: exitCode === 0 ? 'PASSED' : 'FAILED',
    correlatedSlugs: [],
    updatedScores: {},
    penalized: 0,
    correlated: false
  };

  if (exitCode === 0) {
    for (const target of targetTargets) {
      const s = target.slug;
      const details = {
        workspaceRoot,
        command,
        message: 'Verified by automated test pass',
        ...(target.partition || {})
      };
      const updated = recordMemoryEfficacy(s, 'test_pass', details);
      results.correlatedSlugs.push(s);
      results.updatedScores[s] = updated.efficacy_score;
    }
    results.correlated = results.correlatedSlugs.length > 0;
  } else {
    const failureText = `${stdout ?? ''}\n${stderr ?? ''}`.toLowerCase();
    for (const target of targetTargets) {
      const s = target.slug;
      const slugKey = s.replace(/-/g, ' ');
      const slugTokens = s.split('-').filter(t => t.length > 2);

      const textCorrelates = failureText.includes(s.toLowerCase()) ||
        failureText.includes(slugKey.toLowerCase()) ||
        (slugTokens.length >= 2 && slugTokens.filter(t => failureText.includes(t.toLowerCase())).length >= 2);

      // Avoid false-negative penalties: only penalize if error text correlates,
      // or if targetTargets <= 2 and explicit attribution was intended.
      const isCorrelated = textCorrelates || (explicitSlugsProvided && targetTargets.length <= 2 && options.explicitAttribution !== false);

      if (isCorrelated) {
        const rawSnippet = stderr !== undefined && stderr !== null && stderr !== '' ? stderr : (stdout ?? '');
        const details = {
          workspaceRoot,
          command,
          message: `Correlated with test failure: ${String(rawSnippet).slice(0, 200)}`,
          ...(target.partition || {})
        };
        const updated = recordMemoryEfficacy(s, 'test_fail', details);
        results.correlatedSlugs.push(s);
        results.updatedScores[s] = updated.efficacy_score;
      }
    }
    results.penalized = results.correlatedSlugs.length;
    results.correlated = results.correlatedSlugs.length > 0;
  }

  return results;
}
