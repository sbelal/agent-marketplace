export function stripQuotes(str) {
  const s = String(str || '').trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {}
    return s.slice(1, -1).trim();
  }
  if (s.startsWith("'") && s.endsWith("'") && s.length >= 2) {
    return s.slice(1, -1).replace(/''/g, "'").trim();
  }
  return s;
}

export function parseInlineArrayOrList(rawVal) {
  if (Array.isArray(rawVal)) {
    return rawVal
      .map((item) => stripQuotes(item).replace(/\.md$/i, ''))
      .filter(Boolean);
  }
  if (!rawVal || typeof rawVal !== 'string') {
    return [];
  }
  let inner = rawVal.trim();
  if (inner.startsWith('[') && inner.endsWith(']')) {
    inner = inner.slice(1, -1).trim();
  }
  if (!inner) {
    return [];
  }
  return inner
    .split(',')
    .map((item) => stripQuotes(item).replace(/\.md$/i, ''))
    .filter(Boolean);
}

export function parseYamlFrontmatter(fileContent) {
  if (!fileContent || typeof fileContent !== 'string') {
    return {
      frontmatter: {
        type: 'general',
        domain: 'general',
        related: []
      },
      body: ''
    };
  }

  const trimmed = fileContent.trimStart();
  if (!trimmed.startsWith('---')) {
    return {
      frontmatter: {
        type: 'general',
        domain: 'general',
        related: []
      },
      body: fileContent
    };
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return {
      frontmatter: {
        type: 'general',
        domain: 'general',
        related: []
      },
      body: fileContent
    };
  }

  const rawYaml = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trimStart();
  const frontmatter = {};

  const lines = rawYaml.split(/\r?\n/);
  let currentKey = null;
  let currentSubKey = null;
  let isSubMap = false;
  let blockStyle = null;
  let subBlockStyle = null;
  let pendingBlankLines = 0;

  const appendBlockSegment = (existing, segment, style) => {
    if (!existing) {
      pendingBlankLines = 0;
      return segment;
    }
    const blankCount = pendingBlankLines;
    pendingBlankLines = 0;
    if (style === 'literal') {
      return existing + '\n'.repeat(1 + blankCount) + segment;
    }
    // Folded ('>') scalar: single newline folds to space; blank lines become newlines
    const sep = blankCount > 0 ? '\n'.repeat(blankCount) : ' ';
    return existing + sep + segment;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();
    const indent = rawLine.search(/\S/);
    const activeBlock = (isSubMap && currentSubKey) ? subBlockStyle : blockStyle;

    if (!trimmedLine) {
      if (activeBlock && currentKey) {
        const curVal = (isSubMap && currentSubKey) ? frontmatter[currentKey][currentSubKey] : frontmatter[currentKey];
        if (typeof curVal === 'string' && curVal.length > 0) {
          pendingBlankLines++;
        }
      }
      continue;
    }

    if (trimmedLine.startsWith('#') && !(activeBlock && indent > 0)) {
      continue;
    }

    if (indent === 0) {
      currentSubKey = null;
      isSubMap = false;
      blockStyle = null;
      subBlockStyle = null;
      pendingBlankLines = 0;
      const colonIndex = rawLine.indexOf(':');
      if (colonIndex > 0) {
        const key = rawLine.slice(0, colonIndex).trim();
        let value = rawLine.slice(colonIndex + 1).trim();

        if (value === '' || value === '>' || value === '|' || value === '|-' || value === '>-') {
          const isBlock = value.startsWith('>') || value.startsWith('|');
          frontmatter[key] = isBlock ? '' : null;
          blockStyle = value.startsWith('|') ? 'literal' : (value.startsWith('>') ? 'folded' : null);
          currentKey = key;
        } else if (value.startsWith('[') && value.endsWith(']')) {
          frontmatter[key] = parseInlineArrayOrList(value);
          currentKey = key;
        } else {
          frontmatter[key] = stripQuotes(value);
          currentKey = key;
        }
      }
    } else if (currentKey) {
      const colonIndex = trimmedLine.indexOf(':');
      if (blockStyle === null && colonIndex > 0 && !trimmedLine.startsWith('-')) {
        const subKey = trimmedLine.slice(0, colonIndex).trim();
        let subVal = trimmedLine.slice(colonIndex + 1).trim();

        if (frontmatter[currentKey] === null || typeof frontmatter[currentKey] !== 'object' || Array.isArray(frontmatter[currentKey])) {
          frontmatter[currentKey] = {};
        }
        isSubMap = true;
        currentSubKey = subKey;
        subBlockStyle = null;
        pendingBlankLines = 0;

        if (subVal.startsWith('[') && subVal.endsWith(']')) {
          frontmatter[currentKey][subKey] = parseInlineArrayOrList(subVal);
        } else if (subVal === '' || subVal === '>' || subVal === '|' || subVal === '|-' || subVal === '>-') {
          const isBlock = subVal.startsWith('>') || subVal.startsWith('|');
          frontmatter[currentKey][subKey] = isBlock ? '' : [];
          subBlockStyle = subVal.startsWith('|') ? 'literal' : (subVal.startsWith('>') ? 'folded' : null);
        } else {
          frontmatter[currentKey][subKey] = stripQuotes(subVal);
        }
      } else if (blockStyle === null && trimmedLine.startsWith('-')) {
        const item = stripQuotes(trimmedLine.replace(/^-\s*/, '').trim());
        if (isSubMap && currentSubKey) {
          if (!Array.isArray(frontmatter[currentKey][currentSubKey])) {
            frontmatter[currentKey][currentSubKey] = [];
          }
          if (item) frontmatter[currentKey][currentSubKey].push(item);
        } else {
          if (!Array.isArray(frontmatter[currentKey])) {
            frontmatter[currentKey] = [];
          }
          if (item) frontmatter[currentKey].push(item);
        }
      } else {
        if (isSubMap && currentSubKey) {
          if (typeof frontmatter[currentKey][currentSubKey] === 'string') {
            frontmatter[currentKey][currentSubKey] = appendBlockSegment(
              frontmatter[currentKey][currentSubKey],
              trimmedLine,
              subBlockStyle || 'folded'
            );
          }
        } else {
          if (typeof frontmatter[currentKey] === 'string') {
            frontmatter[currentKey] = appendBlockSegment(
              frontmatter[currentKey],
              trimmedLine,
              blockStyle || 'folded'
            );
          } else if (frontmatter[currentKey] === null) {
            pendingBlankLines = 0;
            frontmatter[currentKey] = trimmedLine;
          }
        }
      }
    }
  }

  for (const [k, v] of Object.entries(frontmatter)) {
    if (v === null) frontmatter[k] = '';
  }

  if (!frontmatter.slug && frontmatter.name) {
    frontmatter.slug = frontmatter.name;
  }
  if (!frontmatter.name && frontmatter.slug) {
    frontmatter.name = frontmatter.slug;
  }
  if (!frontmatter.trigger && frontmatter.description) {
    frontmatter.trigger = frontmatter.description;
  }
  if (!frontmatter.description && frontmatter.trigger) {
    frontmatter.description = frontmatter.trigger;
  }
  if (!frontmatter.type) {
    frontmatter.type = 'general';
  }

  if (typeof frontmatter.domain === 'string' && frontmatter.domain.trim()) {
    frontmatter.domain = frontmatter.domain.trim().toLowerCase();
  } else {
    frontmatter.domain = 'general';
  }

  if (frontmatter.related) {
    frontmatter.related = parseInlineArrayOrList(frontmatter.related);
  } else {
    frontmatter.related = [];
  }

  return { frontmatter, body };
}

function formatYamlScalar(val) {
  const str = String(val);
  if (!str) return '""';
  const needsQuoting =
    /[\r\n]/.test(str) ||
    str !== str.trim() ||
    /[:#]/.test(str) && (str.includes(': ') || str.endsWith(':') || str.includes(' #') || str.startsWith('#')) ||
    /^[\[{}\-*&!>|'"@`%,?]/.test(str) ||
    /["']/.test(str);
  return needsQuoting ? JSON.stringify(str) : str;
}

function formatYamlArrayItem(val) {
  const str = String(val).trim();
  if (!str) return '""';
  if (/[,[\]{}:#"']/.test(str) || /\s/.test(str)) {
    return JSON.stringify(str);
  }
  return str;
}

export function serializeYamlFrontmatter(frontmatter, body) {
  const lines = ['---'];
  const keys = ['name', 'type', 'domain', 'description', 'verified', 'overrides', 'related'];

  for (const k of keys) {
    if (frontmatter[k] !== undefined && frontmatter[k] !== null && frontmatter[k] !== '') {
      const val = frontmatter[k];
      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${k}: []`);
        } else {
          lines.push(`${k}: [${val.map(v => formatYamlArrayItem(v)).filter(Boolean).join(', ')}]`);
        }
      } else if (typeof val === 'object') {
        lines.push(`${k}:`);
        for (const [subk, subv] of Object.entries(val)) {
          if (Array.isArray(subv)) {
            lines.push(`  ${subk}: [${subv.map(v => JSON.stringify(v)).join(', ')}]`);
          } else {
            lines.push(`  ${subk}: ${JSON.stringify(subv)}`);
          }
        }
      } else {
        lines.push(`${k}: ${formatYamlScalar(val)}`);
      }
    }
  }

  for (const [k, v] of Object.entries(frontmatter)) {
    if (!keys.includes(k) && v !== undefined && v !== null) {
      if (Array.isArray(v)) {
        lines.push(`${k}: [${v.map(item => formatYamlArrayItem(item)).filter(Boolean).join(', ')}]`);
      } else if (typeof v === 'object') {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      } else {
        lines.push(`${k}: ${formatYamlScalar(v)}`);
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(body ? body.trimStart() : '');
  return lines.join('\n') + '\n';
}
