import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getKnowledgeGraphData } from './graph-service.js';

function resolveKcPluginVersion() {
  try {
    const pluginJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugin.json');
    const data = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    if (data && data.version) return data.version;
  } catch {}
  return '2.2.0';
}
const KC_PLUGIN_VERSION = resolveKcPluginVersion();

function safeJsonForHtmlScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Generates a self-contained, interactive HTML canvas artifact
 * featuring D3 force simulation, domain clusters, staleness alerts, and bidirectional inspector drawer.
 */
export function generateKnowledgeGraphHtml(workspaceRoot = process.cwd(), options = {}) {
  const graphData = getKnowledgeGraphData(workspaceRoot);
  const dataJson = safeJsonForHtmlScript(graphData);
  const isCompact = Boolean(options.compact);
  const serverUrlJson = safeJsonForHtmlScript(options.serverUrl || '');
  const studioTokenJson = safeJsonForHtmlScript(options.studioToken || '');
  const versionJson = safeJsonForHtmlScript(KC_PLUGIN_VERSION);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knowledge Capture Graph Visualizer & Memory Studio</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    :root {
      --bg: var(--background, #0f172a);
      --card-bg: var(--card, #1e293b);
      --border: var(--border, #334155);
      --card-border: var(--card-border, #334155);
      --text: var(--foreground, #f8fafc);
      --text-muted: var(--muted-foreground, #94a3b8);
      --workspace-color: #a855f7;
      --private-color: #3b82f6;
      --team-color: #10b981;
      --stale-color: #ef4444;
      --accent: var(--primary, #38bdf8);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
      height: ${isCompact ? '420px' : '100vh'};
      max-height: ${isCompact ? '420px' : '100vh'};
      width: 100vw;
      display: flex;
    }

    #controls {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 10;
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      width: 340px;
      max-height: ${isCompact ? '388px' : 'calc(100vh - 32px)'};
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }

    h1 { font-size: 16px; font-weight: 600; display: flex; align-items: center; justify-content: space-between; }
    .studio-pill { font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #3b82f6; color: #fff; font-weight: normal; }
    .metrics { font-size: 11px; color: var(--text-muted); display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .metric-badge { background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); }
    .metric-badge strong { color: var(--text); }

    input#search {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
      width: 100%;
    }
    input#search:focus { border-color: var(--accent); }

    .domain-filters {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      max-height: 80px;
      overflow-y: auto;
    }
    .chip {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 12px;
      background: #334155;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
      transition: all 0.2s;
    }
    .chip.active {
      background: var(--accent);
      color: #0f172a;
      font-weight: 600;
    }

    .studio-bar {
      display: flex;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--border);
    }
    .studio-btn {
      flex: 1;
      font-size: 12px;
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: #1e293b;
      color: var(--text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .studio-btn:hover { background: #334155; }
    .studio-btn.active {
      background: #0284c7;
      border-color: #38bdf8;
      color: #fff;
    }
    .badge-count {
      background: #ef4444;
      color: #fff;
      font-size: 10px;
      border-radius: 10px;
      padding: 1px 5px;
      margin-left: 4px;
    }

    #legend {
      display: flex;
      gap: 12px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; }

    #graph-container {
      flex: 1;
      height: 100%;
      position: relative;
    }
    svg { width: 100%; height: 100%; }

    #inspector {
      position: absolute;
      top: 16px;
      right: -380px;
      z-index: 10;
      background: rgba(30, 41, 59, 0.95);
      backdrop-filter: blur(8px);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      width: 360px;
      max-height: ${isCompact ? '388px' : 'calc(100vh - 32px)'};
      overflow-y: auto;
      box-shadow: -10px 0 25px -5px rgba(0, 0, 0, 0.5);
      transition: right 0.3s ease;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    #inspector.open { right: 16px; }

    .drawer-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid var(--border);
      padding-bottom: 10px;
    }
    .close-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 18px;
    }
    .close-btn:hover { color: var(--text); }

    .inspector-field { display: flex; flex-direction: column; gap: 4px; }
    .inspector-label { font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
    .inspector-value { font-size: 13px; color: var(--text); }
    .inspector-input {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-family: inherit;
    }
    .inspector-textarea {
      background: #0f172a;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-family: monospace;
      resize: vertical;
      min-height: 60px;
    }

    .link { stroke-opacity: 0.6; stroke-width: 1.5px; }
    .link-related { stroke: #64748b; stroke-dasharray: 4,4; }
    .link-overrides { stroke: #f59e0b; }
    .link-staged { stroke: #38bdf8; stroke-width: 2.5px; stroke-dasharray: 6,3; }

    .node { cursor: pointer; stroke-width: 2px; }
    .node:hover { stroke: #fff; }
    .node-stale { stroke: var(--stale-color) !important; stroke-width: 3px !important; animation: pulse 2s infinite; }
    .node-selected { stroke: #38bdf8 !important; stroke-width: 4px !important; }
    .node-connect-source { stroke: #22c55e !important; stroke-width: 4px !important; }

    .node-label {
      font-size: 10px;
      fill: var(--text-muted);
      pointer-events: none;
      text-anchor: middle;
      font-family: monospace;
    }

    @keyframes pulse {
      0% { stroke-opacity: 1; stroke-width: 2px; }
      50% { stroke-opacity: 0.4; stroke-width: 5px; }
      100% { stroke-opacity: 1; stroke-width: 2px; }
    }

    #patch-modal {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.7);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    #patch-modal.open { display: flex; }
    .modal-box {
      background: #1e293b;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      width: 550px;
      max-width: 90vw;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    pre#patch-code {
      background: #0f172a;
      padding: 12px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 11px;
      color: #38bdf8;
      max-height: 250px;
      overflow: auto;
    }
  </style>
</head>
<body>
  <div id="controls">
    <h1>
      <span>🧠 Memory Studio</span>
      <span class="studio-pill">Interactive</span>
    </h1>
    <div class="metrics">
      <div class="metric-badge">Nodes: <strong id="m-nodes">0</strong></div>
      <div class="metric-badge">Links: <strong id="m-links">0</strong></div>
      <div class="metric-badge">Stale Rules: <strong id="m-stale" style="color:var(--stale-color);">0</strong></div>
      <div class="metric-badge">Efficacy Score: <strong id="m-efficacy" style="color:#10b981;">1.0</strong></div>
    </div>
    
    <input type="text" id="search" placeholder="Search slugs, triggers, rules...">
    <div class="domain-filters" id="domains"></div>

    <div class="studio-bar">
      <button class="studio-btn" id="btn-connect-mode" title="Toggle edge drawing mode: click source then target to link">
        <span>🔗 Connect Mode</span>
      </button>
      <select id="connect-type-select" class="inspector-input" style="flex:0 0 auto; width:86px; font-size:11px; padding:4px 6px;" title="Relationship type created in Connect Mode">
        <option value="related">related</option>
        <option value="overrides">overrides</option>
      </select>
      <button class="studio-btn" id="btn-save-disk" style="display:none; background:#0284c7; color:#fff; font-weight:600;" title="Save staged changes directly to disk via Standalone Studio">
        <span>💾 Save to Disk</span>
        <span class="badge-count" id="pending-count-save" style="display:none;">0</span>
      </button>
      <button class="studio-btn" id="btn-export-patch" title="Review and export staged modifications">
        <span id="export-btn-label">📋 Export Patch</span>
        <span class="badge-count" id="pending-count" style="display:none;">0</span>
      </button>
    </div>
    <div id="toast" style="display:none; padding:8px 12px; border-radius:6px; font-size:12px; margin-top:4px;"></div>

    <div id="legend">
      <div class="legend-item"><div class="dot" style="background:var(--workspace-color)"></div>Workspace</div>
      <div class="legend-item"><div class="dot" style="background:var(--private-color)"></div>Private</div>
      <div class="legend-item"><div class="dot" style="background:var(--team-color)"></div>Team</div>
    </div>
  </div>

  <div id="graph-container">
    <svg id="canvas"></svg>
  </div>

  <div id="inspector">
    <div class="drawer-header">
      <div>
        <h2 id="ins-slug" style="font-size:15px; font-weight:600;">Node Details</h2>
        <span id="ins-layer" style="font-size:11px; text-transform:uppercase; font-weight:600;"></span>
      </div>
      <button class="close-btn" id="ins-close">&times;</button>
    </div>

    <div class="inspector-field">
      <span class="inspector-label">Domain</span>
      <input type="text" id="edit-domain" class="inspector-input">
    </div>

    <div class="inspector-field">
      <span class="inspector-label">Type</span>
      <select id="edit-type" class="inspector-input">
        <option value="convention">convention</option>
        <option value="platform-fact">platform-fact</option>
        <option value="tool-gotcha">tool-gotcha</option>
        <option value="preference">preference</option>
        <option value="general">general</option>
      </select>
    </div>

    <div class="inspector-field">
      <span class="inspector-label">Trigger Condition (WHEN to recall)</span>
      <textarea id="edit-trigger" class="inspector-textarea"></textarea>
    </div>

    <div class="inspector-field">
      <span class="inspector-label">Verified Date</span>
      <div style="display:flex; gap:6px;">
        <input type="text" id="edit-verified" class="inspector-input" style="flex:1;">
        <button id="btn-bump-today" class="studio-btn" style="flex:none; padding:4px 8px; font-size:11px;">Bump to Today</button>
      </div>
    </div>

    <div class="inspector-field">
      <span class="inspector-label">Bi-Directional Graph Links</span>
      <div id="ins-links" style="font-size:12px; display:flex; flex-direction:column; gap:4px;"></div>
    </div>

    <div style="display:flex; gap:8px; margin-top:8px;">
      <button id="btn-save-node" class="studio-btn" style="background:#0284c7; color:#fff; font-weight:600;">Save Changes</button>
      <button id="btn-delink-node" class="studio-btn" style="color:#ef4444;">Clear Links</button>
    </div>
  </div>

  <div id="patch-modal">
    <div class="modal-box">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h3 style="font-size:16px;">Export Memory Studio Patch</h3>
        <button class="close-btn" id="modal-close">&times;</button>
      </div>
      <p style="font-size:12px; color:var(--text-muted);" id="modal-summary">Review your staged memory graph edits below.</p>
      <pre id="patch-code"></pre>
      <div style="display:flex; gap:8px; justify-content:flex-end;">
        <button class="studio-btn" id="btn-copy-patch">📋 Copy JSON</button>
        <button class="studio-btn" id="btn-download-patch">⬇️ Download Patch</button>
      </div>
    </div>
  </div>

  <script>
    // MiniD3: Resilient Fallback Engine for CSP-restricted or offline environments (Antigravity Generative UI)
    if (typeof d3 === 'undefined') {
      window.__MINI_D3__ = true;
      window.d3 = (function() {
        class MiniSelection {
          constructor(elements) {
            this._elements = Array.isArray(elements) ? elements : (elements ? [elements] : []);
          }
          select(sel) {
            const el = this._elements[0]?.querySelector(sel);
            return new MiniSelection(el ? [el] : []);
          }
          selectAll(sel) {
            const list = [];
            this._elements.forEach(el => list.push(...Array.from(el.querySelectorAll(sel))));
            return new MiniDataSelection(list, this);
          }
          append(tag) {
            const created = [];
            this._elements.forEach(parent => {
              const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
              parent.appendChild(el);
              created.push(el);
            });
            return new MiniSelection(created);
          }
          attr(name, val) {
            this._elements.forEach(el => {
              const v = typeof val === 'function' ? val(el.__data__) : val;
              if (v !== undefined) el.setAttribute(name, v);
            });
            return this;
          }
          style(prop, val) {
            this._elements.forEach(el => {
              const v = typeof val === 'function' ? val(el.__data__) : val;
              if (v !== undefined) el.style[prop] = v;
            });
            return this;
          }
          classed(cls, val) {
            this._elements.forEach(el => {
              const isAdd = typeof val === 'function' ? val(el.__data__) : Boolean(val);
              if (isAdd) el.classList.add(cls);
              else el.classList.remove(cls);
            });
            return this;
          }
          text(val) {
            this._elements.forEach(el => {
              const v = typeof val === 'function' ? val(el.__data__) : val;
              el.textContent = v;
            });
            return this;
          }
          on(event, fn) {
            this._elements.forEach(el => {
              el.addEventListener(event, (e) => fn(e, el.__data__));
            });
            return this;
          }
          call(fn) {
            if (typeof fn === 'function') fn(this);
            return this;
          }
          merge(other) {
            return new MiniDataSelection(
              [...this._elements, ...(other?._elements || [])],
              this._parent || other?._parent
            );
          }
        }

        class MiniDataSelection extends MiniSelection {
          constructor(elements, parent) {
            super(elements);
            this._parent = parent;
            this._enterItems = [];
            this._exitEls = [];
          }
          data(dataset, keyFn) {
            const key = keyFn || ((d, i) => i);
            const existingMap = new Map();
            this._elements.forEach((el, idx) => {
              if (el.__data__ !== undefined) existingMap.set(key(el.__data__, idx), el);
            });
            const matched = [];
            const enterItems = [];
            const usedKeys = new Set();
            dataset.forEach((d, idx) => {
              const k = key(d, idx);
              usedKeys.add(k);
              const existing = existingMap.get(k);
              if (existing) {
                existing.__data__ = d;
                matched.push(existing);
              } else {
                enterItems.push(d);
              }
            });
            const exitEls = [];
            this._elements.forEach((el, idx) => {
              if (el.__data__ !== undefined && !usedKeys.has(key(el.__data__, idx))) {
                exitEls.push(el);
              }
            });
            this._elements = matched;
            this._enterItems = enterItems;
            this._exitEls = exitEls;
            return this;
          }
          enter() {
            const parentEl = this._parent?._elements[0] || document.querySelector("#canvas g");
            const self = this;
            return {
              append: (tag) => {
                const created = [];
                self._enterItems.forEach(d => {
                  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
                  el.__data__ = d;
                  if (parentEl) parentEl.appendChild(el);
                  created.push(el);
                });
                return new MiniSelection(created);
              }
            };
          }
          exit() {
            const els = this._exitEls || [];
            return {
              remove: () => {
                els.forEach(el => el.parentNode?.removeChild(el));
              }
            };
          }
        }

        class MiniForceSimulation {
          constructor(nodes) {
            this._nodes = nodes;
            this._forces = new Map();
            this._alpha = 1.0;
            this._alphaTarget = 0;
            this._listeners = {};
            this._initPositions();
            this._startLoop();
          }
          _initPositions() {
            const cx = (window.innerWidth || 800) / 2;
            const cy = (window.innerHeight || 600) / 2;
            this._nodes.forEach((n, idx) => {
              if (n.x === undefined) n.x = cx + Math.sin(idx * 1.5) * 140 + (Math.random() - 0.5) * 50;
              if (n.y === undefined) n.y = cy + Math.cos(idx * 1.5) * 140 + (Math.random() - 0.5) * 50;
              n.vx = 0;
              n.vy = 0;
            });
          }
          force(name, f) {
            if (arguments.length === 1) return this._forces.get(name);
            this._forces.set(name, f);
            return this;
          }
          nodes(n) {
            if (!arguments.length) return this._nodes;
            this._nodes = n;
            this._initPositions();
            return this;
          }
          alpha(a) {
            if (!arguments.length) return this._alpha;
            this._alpha = a;
            return this;
          }
          alphaTarget(t) {
            if (!arguments.length) return this._alphaTarget;
            this._alphaTarget = t;
            return this;
          }
          restart() {
            this._alpha = Math.max(this._alpha, 0.3);
            return this;
          }
          on(event, cb) {
            this._listeners[event] = cb;
            return this;
          }
          _startLoop() {
            const tick = () => {
              if (this._alpha > 0.005 || this._alphaTarget > 0) {
                this._step();
                if (this._listeners["tick"]) this._listeners["tick"]();
                this._alpha += (this._alphaTarget - this._alpha) * 0.02;
              }
              requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
          _step() {
            const cx = (window.innerWidth || 800) / 2;
            const cy = (window.innerHeight || 600) / 2;
            for (let i = 0; i < this._nodes.length; i++) {
              const a = this._nodes[i];
              for (let j = i + 1; j < this._nodes.length; j++) {
                const b = this._nodes[j];
                let dx = b.x - a.x;
                let dy = b.y - a.y;
                let dist = Math.sqrt(dx * dx + dy * dy) || 1;
                if (dist > 350) continue;
                let force = (280 / (dist * dist)) * this._alpha;
                let fx = (dx / dist) * force;
                let fy = (dy / dist) * force;
                if (a.fx === undefined || a.fx === null) { a.vx -= fx; a.vy -= fy; }
                if (b.fx === undefined || b.fx === null) { b.vx += fx; b.vy += fy; }
              }
            }
            const linkForce = this._forces.get("link");
            const links = linkForce?._links || [];
            const idMap = new Map(this._nodes.map(n => [n.id, n]));
            links.forEach(l => {
              const s = typeof l.source === 'object' ? l.source : idMap.get(l.source);
              const t = typeof l.target === 'object' ? l.target : idMap.get(l.target);
              if (!s || !t) return;
              l.source = s;
              l.target = t;
              let dx = t.x - s.x;
              let dy = t.y - s.y;
              let dist = Math.sqrt(dx * dx + dy * dy) || 1;
              let displacement = dist - (linkForce?._dist || 100);
              let force = displacement * 0.04 * this._alpha;
              let fx = (dx / dist) * force;
              let fy = (dy / dist) * force;
              if (s.fx === undefined || s.fx === null) { s.vx += fx; s.vy += fy; }
              if (t.fx === undefined || t.fx === null) { t.vx -= fx; t.vy -= fy; }
            });
            this._nodes.forEach(n => {
              if (n.fx !== undefined && n.fx !== null) {
                n.x = n.fx;
                n.y = n.fy;
              } else {
                n.vx += (cx - n.x) * 0.015 * this._alpha;
                n.vy += (cy - n.y) * 0.015 * this._alpha;
                n.x += n.vx;
                n.y += n.vy;
                n.vx *= 0.85;
                n.vy *= 0.85;
              }
            });
          }
        }

        return {
          select: (sel) => new MiniSelection(typeof sel === 'string' ? document.querySelector(sel) : sel),
          forceSimulation: (nodes) => new MiniForceSimulation(nodes),
          forceLink: (links) => {
            const obj = {
              _links: links,
              _dist: 100,
              links: (l) => { obj._links = l; return obj; },
              id: () => obj,
              distance: (d) => { obj._dist = d; return obj; }
            };
            return obj;
          },
          forceManyBody: () => ({ strength: () => ({}) }),
          forceCenter: () => ({}),
          forceCollide: () => ({ radius: () => ({}) }),
          zoom: () => {
            let zoomHandler = () => {};
            const zoomObj = {
              scaleExtent: () => zoomObj,
              on: (ev, cb) => { zoomHandler = cb; return zoomObj; }
            };
            return (selection) => {
              const svg = selection._elements[0];
              if (!svg) return;
              let scale = 1, tx = 0, ty = 0;
              let isPanning = false, startX = 0, startY = 0;
              svg.addEventListener("wheel", (e) => {
                e.preventDefault();
                scale = Math.max(0.2, Math.min(3, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
                zoomHandler({ transform: "translate(" + tx + "," + ty + ") scale(" + scale + ")" });
              }, { passive: false });
              svg.addEventListener("mousedown", (e) => {
                if (e.target.tagName === 'circle' || e.target.closest('#controls') || e.target.closest('#inspector')) return;
                isPanning = true;
                startX = e.clientX - tx;
                startY = e.clientY - ty;
              });
              window.addEventListener("mousemove", (e) => {
                if (!isPanning) return;
                tx = e.clientX - startX;
                ty = e.clientY - startY;
                zoomHandler({ transform: "translate(" + tx + "," + ty + ") scale(" + scale + ")" });
              });
              window.addEventListener("mouseup", () => { isPanning = false; });
            };
          },
          drag: () => {
            let startCb = () => {}, dragCb = () => {}, endCb = () => {};
            const dragObj = {
              on: (ev, cb) => {
                if (ev === "start") startCb = cb;
                if (ev === "drag") dragCb = cb;
                if (ev === "end") endCb = cb;
                return dragObj;
              }
            };
            return (selection) => {
              selection._elements.forEach(el => {
                el.addEventListener("mousedown", (e) => {
                  e.stopPropagation();
                  const d = el.__data__;
                  if (!d) return;
                  startCb(e, d);
                  const onMove = (me) => {
                    const svg = document.getElementById("canvas");
                    const rect = svg.getBoundingClientRect();
                    dragCb({ x: me.clientX - rect.left, y: me.clientY - rect.top }, d);
                  };
                  const onUp = (ue) => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    endCb(ue, d);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                });
              });
            };
          }
        };
      })();
    }

    const graphData = ${dataJson};
    let activeNodes = [...graphData.nodes];
    let activeLinks = [...graphData.links];
    
    // Bidirectional State Tracking
    const stagedChanges = {
      modifiedNodes: new Map(),
      addedLinks: [],
      removedLinks: []
    };

    let connectMode = false;
    let connectSourceNode = null;
    let selectedNode = null;

    // Metrics setup
    document.getElementById('m-nodes').textContent = activeNodes.length;
    document.getElementById('m-links').textContent = activeLinks.length;
    document.getElementById('m-stale').textContent = graphData.summary.staleNodesCount || 0;
    document.getElementById('m-efficacy').textContent = (graphData.summary.avgEfficacyScore || 1.0).toFixed(2);

    // Setup domain filter chips
    const domainsContainer = document.getElementById('domains');
    graphData.summary.domains.forEach(d => {
      const chip = document.createElement('div');
      chip.className = 'chip';
      chip.textContent = d;
      chip.onclick = () => {
        chip.classList.toggle('active');
        filterGraph();
      };
      domainsContainer.appendChild(chip);
    });

    const svg = d3.select("#canvas");
    const width = window.innerWidth;
    const height = window.innerHeight;

    const g = svg.append("g");
    const zoom = d3.zoom().scaleExtent([0.1, 4]).on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom);

    const simulation = d3.forceSimulation(activeNodes)
      .force("link", d3.forceLink(activeLinks).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-280))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(25));

    let linkElements = g.append("g").attr("class", "links").selectAll("line");
    let nodeElements = g.append("g").attr("class", "nodes").selectAll("circle");
    let labelElements = g.append("g").attr("class", "labels").selectAll("text");

    function updateSimulation() {
      linkElements = linkElements.data(activeLinks, d => {
        const s = typeof d.source === 'object' ? (d.source.id || d.source.slug || '') : d.source;
        const t = typeof d.target === 'object' ? (d.target.id || d.target.slug || '') : d.target;
        return s + "-" + t + "-" + d.type;
      });
      linkElements.exit().remove();
      const linkEnter = linkElements.enter().append("line")
        .attr("class", d => d.staged ? "link link-staged" : (d.type === "overrides" ? "link link-overrides" : "link link-related"));
      linkElements = linkEnter.merge(linkElements);

      nodeElements = nodeElements.data(activeNodes, d => d.id);
      nodeElements.exit().remove();
      const nodeEnter = nodeElements.enter().append("circle")
        .attr("class", d => "node " + (d.stale ? "node-stale" : ""))
        .attr("r", d => Math.max(8, Math.min(22, 10 + (d.applied_count || 0) * 1.5)))
        .attr("fill", d => {
          if (d.layer === "workspace") return "var(--workspace-color)";
          if (d.layer === "private") return "var(--private-color)";
          return "var(--team-color)";
        })
        .call(d3.drag()
          .on("start", (e, d) => {
            if (!e.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
          .on("end", (e, d) => {
            if (!e.active) simulation.alphaTarget(0);
            d.fx = null; d.fy = null;
          }))
        .on("click", (e, d) => handleNodeClick(e, d));
      nodeElements = nodeEnter.merge(nodeElements);

      labelElements = labelElements.data(activeNodes, d => d.id);
      labelElements.exit().remove();
      const labelEnter = labelElements.enter().append("text")
        .attr("class", "node-label")
        .attr("dy", 20)
        .text(d => d.slug);
      labelElements = labelEnter.merge(labelElements);

      simulation.nodes(activeNodes);
      simulation.force("link").links(activeLinks);
      simulation.alpha(0.3).restart();
    }

    simulation.on("tick", () => {
      const nodeMap = new Map(activeNodes.map(n => [n.id, n]));
      linkElements
        .attr("x1", d => (typeof d.source === 'object' && d.source.x !== undefined) ? d.source.x : (nodeMap.get(d.source)?.x || 0))
        .attr("y1", d => (typeof d.source === 'object' && d.source.y !== undefined) ? d.source.y : (nodeMap.get(d.source)?.y || 0))
        .attr("x2", d => (typeof d.target === 'object' && d.target.x !== undefined) ? d.target.x : (nodeMap.get(d.target)?.x || 0))
        .attr("y2", d => (typeof d.target === 'object' && d.target.y !== undefined) ? d.target.y : (nodeMap.get(d.target)?.y || 0));

      nodeElements
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);

      labelElements
        .attr("x", d => d.x)
        .attr("y", d => d.y);
    });

    updateSimulation();

    function handleNodeClick(e, d) {
      e.stopPropagation();
      if (connectMode) {
        if (!connectSourceNode) {
          connectSourceNode = d;
          nodeElements.classed("node-connect-source", n => n.id === d.id);
        } else if (connectSourceNode.id === d.id) {
          connectSourceNode = null;
          nodeElements.classed("node-connect-source", false);
        } else {
          const linkTypeEl = document.getElementById('connect-type-select');
          const linkType = linkTypeEl ? linkTypeEl.value : 'related';
          // Connect connectSourceNode -> d
          activeLinks.push({
            source: connectSourceNode,
            target: d,
            type: linkType,
            staged: true
          });
          stagedChanges.addedLinks.push({
            source: connectSourceNode.id,
            target: d.id,
            type: linkType
          });
          updatePendingBadge();
          nodeElements.classed("node-connect-source", false);
          connectSourceNode = null;
          updateSimulation();
        }
        return;
      }

      selectedNode = d;
      nodeElements.classed("node-selected", n => n.id === d.id);
      openInspector(d);
    }

    function openInspector(node) {
      document.getElementById('ins-slug').textContent = node.slug;
      document.getElementById('ins-layer').textContent = node.layer;
      document.getElementById('edit-domain').value = node.domain;
      document.getElementById('edit-type').value = node.type || "convention";
      document.getElementById('edit-trigger').value = node.description || "";
      document.getElementById('edit-verified').value = node.verified || "";

      const linksDiv = document.getElementById('ins-links');
      linksDiv.textContent = '';

      const outgoing = activeLinks.filter(l => {
        const s = typeof l.source === 'object' ? (l.source.id || l.source.slug) : l.source;
        return s === node.id || s === node.slug;
      });
      const incoming = activeLinks.filter(l => {
        const t = typeof l.target === 'object' ? (l.target.id || l.target.slug) : l.target;
        return t === node.id || t === node.slug;
      });

      if (outgoing.length) {
        const header = document.createElement('div');
        header.style.color = 'var(--accent)';
        header.textContent = 'Outgoing:';
        linksDiv.appendChild(header);

        outgoing.forEach(l => {
          const tId = typeof l.target === 'object' ? (l.target.slug || l.target.id) : l.target;
          const row = document.createElement('div');
          row.style.paddingLeft = '8px';
          row.appendChild(document.createTextNode('↳ ' + tId + ' '));
          const typeSpan = document.createElement('span');
          typeSpan.style.color = 'var(--text-muted)';
          typeSpan.textContent = '(' + (l.type || 'related') + ')';
          row.appendChild(typeSpan);
          linksDiv.appendChild(row);
        });
      }
      if (incoming.length) {
        const header = document.createElement('div');
        header.style.color = '#22c55e';
        header.style.marginTop = '4px';
        header.textContent = 'Incoming (Backlinks):';
        linksDiv.appendChild(header);

        incoming.forEach(l => {
          const sId = typeof l.source === 'object' ? (l.source.slug || l.source.id) : l.source;
          const row = document.createElement('div');
          row.style.paddingLeft = '8px';
          row.textContent = '↰ ' + sId;
          linksDiv.appendChild(row);
        });
      }
      if (!outgoing.length && !incoming.length) {
        const emptySpan = document.createElement('span');
        emptySpan.style.color = 'var(--text-muted)';
        emptySpan.textContent = 'No lateral connections';
        linksDiv.appendChild(emptySpan);
      }

      document.getElementById('inspector').classList.add('open');
    }

    document.getElementById('ins-close').onclick = () => {
      document.getElementById('inspector').classList.remove('open');
      nodeElements.classed("node-selected", false);
    };

    document.getElementById('btn-bump-today').onclick = () => {
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('edit-verified').value = today;
    };

    document.getElementById('btn-delink-node').onclick = () => {
      if (!selectedNode) return;
      const nodeId = selectedNode.id;
      const nodeSlug = selectedNode.slug;
      let clearedCount = 0;

      const remaining = [];
      for (const l of activeLinks) {
        const s = typeof l.source === 'object' ? (l.source.id || l.source.slug) : l.source;
        const t = typeof l.target === 'object' ? (l.target.id || l.target.slug) : l.target;
        if (s === nodeId || s === nodeSlug) {
          clearedCount++;
          const linkType = l.type || 'related';
          const stagedIdx = stagedChanges.addedLinks.findIndex(
            al => (al.source === s || al.source === nodeSlug) && al.target === t && (al.type || 'related') === linkType
          );
          if (stagedIdx >= 0) {
            stagedChanges.addedLinks.splice(stagedIdx, 1);
          } else {
            stagedChanges.removedLinks.push({ source: nodeSlug, target: t, type: linkType });
          }
        } else {
          remaining.push(l);
        }
      }

      if (clearedCount === 0) {
        showToast("No outgoing links to clear on '" + nodeSlug + "'.");
        return;
      }

      activeLinks = remaining;
      updatePendingBadge();
      updateSimulation();
      openInspector(selectedNode);
      showToast("Staged removal of " + clearedCount + " outgoing link(s) from '" + nodeSlug + "'.");
    };

    document.getElementById('btn-save-node').onclick = () => {
      if (!selectedNode) return;
      selectedNode.domain = document.getElementById('edit-domain').value;
      selectedNode.type = document.getElementById('edit-type').value;
      selectedNode.description = document.getElementById('edit-trigger').value;
      selectedNode.verified = document.getElementById('edit-verified').value;
      selectedNode.stale = false;

      stagedChanges.modifiedNodes.set(selectedNode.id, {
        slug: selectedNode.slug,
        domain: selectedNode.domain,
        type: selectedNode.type,
        description: selectedNode.description,
        verified: selectedNode.verified
      });

      updatePendingBadge();
      updateSimulation();
      if (isHttpServer || configuredServerUrl) {
        showToast("Node '" + selectedNode.slug + "' staged! Click 'Save to Disk' to persist.");
      } else {
        alert("Node '" + selectedNode.slug + "' updated! Click Export Patch to apply.");
      }
    };

    // Connect mode toggle
    const connectBtn = document.getElementById('btn-connect-mode');
    connectBtn.onclick = () => {
      connectMode = !connectMode;
      connectBtn.classList.toggle('active', connectMode);
      if (!connectMode && connectSourceNode) {
        connectSourceNode = null;
        nodeElements.classed("node-connect-source", false);
      }
    };

    // HTTP Server Direct Persistence
    const isHttpServer = window.location.protocol.startsWith('http');
    const configuredServerUrl = ${serverUrlJson};
    const studioToken = ${studioTokenJson};
    const apiBase = isHttpServer ? '' : configuredServerUrl;
    const saveDiskBtn = document.getElementById('btn-save-disk');
    if ((isHttpServer || configuredServerUrl) && saveDiskBtn) {
      saveDiskBtn.style.display = 'flex';
      const exportLabel = document.getElementById('export-btn-label');
      if (exportLabel) exportLabel.textContent = 'Patch JSON';
    }

    function showToast(msg, isError = false) {
      const toast = document.getElementById('toast');
      if (!toast) return;
      toast.style.display = 'block';
      toast.style.background = isError ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
      toast.style.color = isError ? '#f87171' : '#34d399';
      toast.style.border = isError ? '1px solid #ef4444' : '1px solid #10b981';
      toast.textContent = msg;
      setTimeout(() => { toast.style.display = 'none'; }, 4500);
    }

    if (saveDiskBtn) {
      saveDiskBtn.onclick = async () => {
        const total = stagedChanges.modifiedNodes.size + stagedChanges.addedLinks.length + stagedChanges.removedLinks.length;
        if (total === 0) {
          showToast('No pending modifications to save.');
          return;
        }

        const staged = {
          modified_nodes: Array.from(stagedChanges.modifiedNodes.values()),
          added_links: stagedChanges.addedLinks,
          removed_links: stagedChanges.removedLinks
        };

        saveDiskBtn.disabled = true;
        saveDiskBtn.textContent = '⏳ Saving...';

        try {
          const targetUrl = (apiBase ? apiBase : '') + '/api/patch';
          const headers = { 'Content-Type': 'application/json' };
          if (studioToken) headers['X-Studio-Token'] = studioToken;
          const res = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(staged)
          });
          const data = await res.json();
          if (data.ok) {
            stagedChanges.modifiedNodes.clear();
            stagedChanges.addedLinks = [];
            stagedChanges.removedLinks = [];
            updatePendingBadge();
            showToast(\`✅ Saved \${data.nodesUpdated || 0} node(s) and \${data.linksAdded || 0} link(s) directly to disk!\`);
          } else {
            showToast('Failed to save: ' + (data.errors ? data.errors.join('; ') : 'Unknown error'), true);
          }
        } catch (err) {
          showToast('Network error saving to disk: ' + err.message, true);
        } finally {
          saveDiskBtn.disabled = false;
          saveDiskBtn.innerHTML = '<span>💾 Save to Disk</span><span class="badge-count" id="pending-count-save" style="display:none;">0</span>';
          updatePendingBadge();
        }
      };
    }

    function updatePendingBadge() {
      const total = stagedChanges.modifiedNodes.size + stagedChanges.addedLinks.length + stagedChanges.removedLinks.length;
      const badge = document.getElementById('pending-count');
      const badgeSave = document.getElementById('pending-count-save');
      if (total > 0) {
        if (badge) { badge.style.display = 'inline-block'; badge.textContent = total; }
        if (badgeSave) { badgeSave.style.display = 'inline-block'; badgeSave.textContent = total; }
      } else {
        if (badge) badge.style.display = 'none';
        if (badgeSave) badgeSave.style.display = 'none';
      }
    }

    // Export Patch Modal
    const patchModal = document.getElementById('patch-modal');
    document.getElementById('btn-export-patch').onclick = () => {
      const staged = {
        modified_nodes: Array.from(stagedChanges.modifiedNodes.values()),
        added_links: stagedChanges.addedLinks,
        removed_links: stagedChanges.removedLinks
      };

      const modCount = staged.modified_nodes.length;
      const addCount = staged.added_links.length;
      const remCount = staged.removed_links.length;

      document.getElementById('modal-summary').innerHTML = \`
        <strong>Staged Changes:</strong> \${modCount} node(s) modified, \${addCount} link(s) added, \${remCount} link(s) removed.<br>
        <span style="font-size:11px; color:#94a3b8; display:block; margin-top:4px;">To persist these changes to disk, copy the JSON below and pass it to the <code>apply_memory_patch</code> MCP tool, or paste it in chat for the assistant to apply.</span>
      \`;

      const patchData = {
        generated_at: new Date().toISOString(),
        version: ${versionJson},
        patch: staged
      };

      document.getElementById('patch-code').textContent = JSON.stringify(patchData, null, 2);
      patchModal.classList.add('open');
    };

    document.getElementById('modal-close').onclick = () => patchModal.classList.remove('open');
    document.getElementById('btn-copy-patch').onclick = () => {
      const text = document.getElementById('patch-code').textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => alert('Patch JSON copied to clipboard!')).catch(() => {
          fallbackCopy(text);
        });
      } else {
        fallbackCopy(text);
      }
      function fallbackCopy(val) {
        const ta = document.createElement('textarea');
        ta.value = val;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); alert('Patch JSON copied to clipboard!'); } catch {}
        document.body.removeChild(ta);
      }
    };

    document.getElementById('btn-download-patch').onclick = () => {
      const text = document.getElementById('patch-code').textContent;
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "memory-patch-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      URL.revokeObjectURL(url);
    };

    // Filter by search & domain chips
    function filterGraph() {
      const q = document.getElementById('search').value.toLowerCase();
      const activeChips = Array.from(document.querySelectorAll('.chip.active')).map(c => c.textContent);

      nodeElements.style("opacity", d => {
        const dSlug = d.slug || d.id || '';
        const matchesQuery = !q || dSlug.toLowerCase().includes(q) || (d.description && d.description.toLowerCase().includes(q));
        const matchesDomain = activeChips.length === 0 || activeChips.includes(d.domain);
        return (matchesQuery && matchesDomain) ? 1.0 : 0.15;
      });

      linkElements.style("opacity", d => {
        const s = d.source;
        const t = d.target;
        const sSlug = typeof s === 'object' ? (s.slug || s.id || '') : String(s || '');
        const sDesc = typeof s === 'object' ? (s.description || '') : '';
        const sDomain = typeof s === 'object' ? (s.domain || '') : '';
        const tSlug = typeof t === 'object' ? (t.slug || t.id || '') : String(t || '');
        const tDesc = typeof t === 'object' ? (t.description || '') : '';
        const tDomain = typeof t === 'object' ? (t.domain || '') : '';
        const sMatch = (!q || sSlug.toLowerCase().includes(q) || sDesc.toLowerCase().includes(q)) && (activeChips.length === 0 || activeChips.includes(sDomain));
        const tMatch = (!q || tSlug.toLowerCase().includes(q) || tDesc.toLowerCase().includes(q)) && (activeChips.length === 0 || activeChips.includes(tDomain));
        return (sMatch && tMatch) ? 0.8 : 0.05;
      });
    }

    document.getElementById('search').oninput = filterGraph;
  </script>
</body>
</html>`;
}
