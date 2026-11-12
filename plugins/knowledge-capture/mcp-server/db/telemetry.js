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
  const db = getDatabase();
  const nowIso = new Date().toISOString();

  if (db) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO telemetry (slug, recalled_count, applied_count, test_pass_count, test_fail_count, efficacy_score)
        VALUES (?, 0, 0, 0, 0, 1.0)
      `).run(slug);

      if (eventType === 'apply') {
        db.prepare(`
          UPDATE telemetry SET applied_count = applied_count + 1, last_applied = ? WHERE slug = ?
        `).run(nowIso, slug);
      } else if (eventType === 'test_pass') {
        db.prepare(`
          UPDATE telemetry 
          SET test_pass_count = test_pass_count + 1,
              efficacy_score = MIN(1.0, efficacy_score + 0.05),
              last_feedback = ?
          WHERE slug = ?
        `).run(details.message || 'test_passed', slug);
      } else if (eventType === 'test_fail') {
        db.prepare(`
          UPDATE telemetry 
          SET test_fail_count = test_fail_count + 1,
              efficacy_score = MAX(0.1, efficacy_score - 0.20),
              last_feedback = ?
          WHERE slug = ?
        `).run(details.message || 'test_failed', slug);
      } else {
        db.prepare(`
          UPDATE telemetry SET recalled_count = recalled_count + 1, last_recalled = ? WHERE slug = ?
        `).run(nowIso, slug);
      }
      return;
    } catch {}
  }

  // Fallback to telemetry.json
  const data = readTelemetryJson();
  if (!data[slug]) {
    data[slug] = {
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
    data[slug].applied_count = (data[slug].applied_count || 0) + 1;
    data[slug].last_applied = nowIso;
  } else if (eventType === 'test_pass') {
    data[slug].test_pass_count = (data[slug].test_pass_count || 0) + 1;
    data[slug].efficacy_score = Math.min(1.0, (data[slug].efficacy_score || 1.0) + 0.05);
    data[slug].last_feedback = details.message || 'test_passed';
  } else if (eventType === 'test_fail') {
    data[slug].test_fail_count = (data[slug].test_fail_count || 0) + 1;
    data[slug].efficacy_score = Math.max(0.1, (data[slug].efficacy_score || 1.0) - 0.20);
    data[slug].last_feedback = details.message || 'test_failed';
  } else {
    data[slug].recalled_count = (data[slug].recalled_count || 0) + 1;
    data[slug].last_recalled = nowIso;
  }
  writeTelemetryJson(data);
}

/**
 * Public command: Explicitly records memory efficacy feedback (test_pass, test_fail, applied).
 */
export function recordMemoryEfficacy(slug, feedbackType, details = {}) {
  recordTelemetryEvent(slug, feedbackType, details);
  const db = getDatabase();
  if (db) {
    try {
      const row = db.prepare('SELECT * FROM telemetry WHERE slug = ?').get(slug);
      if (row) return row;
    } catch {}
  }
  const data = readTelemetryJson();
  return data[slug] || { slug, efficacy_score: 1.0 };
}

/**
 * Closed-Loop Execution-Driven Efficacy Hook.
 * Correlates test suite executions (command, exitCode, stdout, stderr) with memory rules.
 */
export function correlateTestExecutionEfficacy(workspaceRoot = process.cwd(), options = {}) {
  const { command = '', exitCode = 0, stdout = '', stderr = '', slugs = [] } = options;
  const db = getDatabase();

  let targetSlugs = Array.isArray(slugs) && slugs.length > 0 ? slugs : [];

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
      targetSlugs = Object.keys(data).slice(0, 5);
    }
  }

  const results = {
    command,
    exitCode,
    outcome: exitCode === 0 ? 'PASSED' : 'FAILED',
    correlatedSlugs: [],
    updatedScores: {}
  };

  if (exitCode === 0) {
    for (const s of targetSlugs) {
      const updated = recordMemoryEfficacy(s, 'test_pass', { command, message: 'Verified by automated test pass' });
      results.correlatedSlugs.push(s);
      results.updatedScores[s] = updated.efficacy_score;
    }
  } else {
    const failureText = `${stdout}\n${stderr}`.toLowerCase();
    for (const s of targetSlugs) {
      const slugKey = s.replace(/-/g, ' ');
      const isCorrelated = failureText.includes(s) || failureText.includes(slugKey) || targetSlugs.length <= 2;
      if (isCorrelated) {
        const updated = recordMemoryEfficacy(s, 'test_fail', {
          command,
          message: `Correlated with test failure: ${(stderr || stdout).slice(0, 200)}`
        });
        results.correlatedSlugs.push(s);
        results.updatedScores[s] = updated.efficacy_score;
      }
    }
  }

  return results;
}
