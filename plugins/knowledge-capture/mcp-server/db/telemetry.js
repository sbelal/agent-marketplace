import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './connection.js';
import { getTelemetryJsonPath } from '../core/storage-paths.js';

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

/**
 * Records telemetry events and verification feedback for memory utility and efficacy scoring.
 */
export function recordTelemetryEvent(slug, eventType = 'recall', details = {}) {
  if (!slug) return;
  const canonSlug = String(slug).trim().toLowerCase();
  if (!canonSlug) return;
  const db = getDatabase();
  const nowIso = new Date().toISOString();

  if (db) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO telemetry (slug, recalled_count, applied_count, test_pass_count, test_fail_count, efficacy_score)
        VALUES (?, 0, 0, 0, 0, 1.0)
      `).run(canonSlug);

      if (eventType === 'apply') {
        db.prepare(`
          UPDATE telemetry SET applied_count = applied_count + 1, last_applied = ? WHERE slug = ?
        `).run(nowIso, canonSlug);
      } else if (eventType === 'test_pass') {
        db.prepare(`
          UPDATE telemetry 
          SET test_pass_count = test_pass_count + 1,
              efficacy_score = MIN(1.0, efficacy_score + 0.05),
              last_feedback = ?
          WHERE slug = ?
        `).run(details?.message || 'test_passed', canonSlug);
      } else if (eventType === 'test_fail') {
        db.prepare(`
          UPDATE telemetry 
          SET test_fail_count = test_fail_count + 1,
              efficacy_score = MAX(0.1, efficacy_score - 0.20),
              last_feedback = ?
          WHERE slug = ?
        `).run(details?.message || 'test_failed', canonSlug);
      } else {
        db.prepare(`
          UPDATE telemetry SET recalled_count = recalled_count + 1, last_recalled = ? WHERE slug = ?
        `).run(nowIso, canonSlug);
      }
      return;
    } catch {}
  }

  // Fallback to telemetry.json
  const data = readTelemetryJson();
  if (!data[canonSlug]) {
    data[canonSlug] = {
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
  if (eventType === 'apply') {
    data[canonSlug].applied_count = (data[canonSlug].applied_count || 0) + 1;
    data[canonSlug].last_applied = nowIso;
  } else if (eventType === 'test_pass') {
    data[canonSlug].test_pass_count = (data[canonSlug].test_pass_count || 0) + 1;
    data[canonSlug].efficacy_score = Math.min(1.0, (data[canonSlug].efficacy_score || 1.0) + 0.05);
    data[canonSlug].last_feedback = details?.message || 'test_passed';
  } else if (eventType === 'test_fail') {
    data[canonSlug].test_fail_count = (data[canonSlug].test_fail_count || 0) + 1;
    data[canonSlug].efficacy_score = Math.max(0.1, (data[canonSlug].efficacy_score || 1.0) - 0.20);
    data[canonSlug].last_feedback = details?.message || 'test_failed';
  } else {
    data[canonSlug].recalled_count = (data[canonSlug].recalled_count || 0) + 1;
    data[canonSlug].last_recalled = nowIso;
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
  recordTelemetryEvent(canonSlug, feedbackType, details);
  const db = getDatabase();
  if (db) {
    try {
      const row = db.prepare('SELECT * FROM telemetry WHERE LOWER(slug) = ?').get(canonSlug);
      if (row) return row;
    } catch {}
  }
  const data = readTelemetryJson();
  return data[canonSlug] || { slug: canonSlug, efficacy_score: 1.0 };
}

/**
 * Closed-Loop Execution-Driven Efficacy Hook.
 * Correlates test suite executions (command, exitCode, stdout, stderr) with memory rules.
 */
export function correlateTestExecutionEfficacy(workspaceRoot = process.cwd(), options = {}) {
  const { command = '', exitCode = 0, stdout = '', stderr = '', slugs = [] } = options;
  const db = getDatabase();

  let targetSlugs = Array.isArray(slugs) && slugs.length > 0 ? slugs : [];
  const explicitSlugsProvided = Array.isArray(slugs) && slugs.length > 0;

  if (targetSlugs.length === 0) {
    if (db) {
      try {
        const rows = db.prepare(`
          SELECT slug FROM telemetry 
          WHERE last_applied IS NOT NULL OR last_recalled IS NOT NULL
          ORDER BY COALESCE(last_applied, last_recalled) DESC
          LIMIT 5
        `).all();
        targetSlugs = rows.map(r => r.slug);
      } catch {}
    } else {
      const data = readTelemetryJson();
      targetSlugs = Object.entries(data)
        .filter(([, entry]) => entry && (entry.last_applied || entry.last_recalled))
        .sort(([, a], [, b]) => String(b.last_applied || b.last_recalled).localeCompare(String(a.last_applied || a.last_recalled)))
        .slice(0, 5)
        .map(([slug]) => slug);
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
    for (const s of targetSlugs) {
      const updated = recordMemoryEfficacy(s, 'test_pass', { command, message: 'Verified by automated test pass' });
      results.correlatedSlugs.push(s);
      results.updatedScores[s] = updated.efficacy_score;
    }
    results.correlated = results.correlatedSlugs.length > 0;
  } else {
    const failureText = `${stdout ?? ''}\n${stderr ?? ''}`.toLowerCase();
    for (const s of targetSlugs) {
      const slugKey = s.replace(/-/g, ' ');
      const slugTokens = s.split('-').filter(t => t.length > 2);
      
      const textCorrelates = failureText.includes(s.toLowerCase()) ||
        failureText.includes(slugKey.toLowerCase()) ||
        (slugTokens.length >= 2 && slugTokens.filter(t => failureText.includes(t.toLowerCase())).length >= 2);

      // Avoid false-negative penalties: only penalize if error text correlates,
      // or if targetSlugs <= 2 and explicit attribution was intended.
      const isCorrelated = textCorrelates || (explicitSlugsProvided && targetSlugs.length <= 2 && options.explicitAttribution !== false);

      if (isCorrelated) {
        const rawSnippet = stderr !== undefined && stderr !== null && stderr !== '' ? stderr : (stdout ?? '');
        const updated = recordMemoryEfficacy(s, 'test_fail', {
          command,
          message: `Correlated with test failure: ${String(rawSnippet).slice(0, 200)}`
        });
        results.correlatedSlugs.push(s);
        results.updatedScores[s] = updated.efficacy_score;
      }
    }
    results.penalized = results.correlatedSlugs.length;
    results.correlated = results.correlatedSlugs.length > 0;
  }

  return results;
}

