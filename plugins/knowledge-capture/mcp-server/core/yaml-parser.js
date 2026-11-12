export function stripQuotes(str) {
  const s = String(str || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).trim();
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

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmedLine = rawLine.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const indent = rawLine.search(/\S/);

    if (indent === 0) {
      currentSubKey = null;
      isSubMap = false;
      const colonIndex = rawLine.indexOf(':');
      if (colonIndex > 0) {
        const key = rawLine.slice(0, colonIndex).trim();
        let value = rawLine.slice(colonIndex + 1).trim();

        if (value === '' || value === '>' || value === '|') {
          frontmatter[key] = (value === '>' || value === '|') ? '' : null;
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
      if (colonIndex > 0 && !trimmedLine.startsWith('-')) {
        const subKey = trimmedLine.slice(0, colonIndex).trim();
        let subVal = trimmedLine.slice(colonIndex + 1).trim();

        if (frontmatter[currentKey] === null || typeof frontmatter[currentKey] !== 'object' || Array.isArray(frontmatter[currentKey])) {
          frontmatter[currentKey] = {};
        }
        isSubMap = true;
        currentSubKey = subKey;

        if (subVal.startsWith('[') && subVal.endsWith(']')) {
          frontmatter[currentKey][subKey] = parseInlineArrayOrList(subVal);
        } else if (subVal === '' || subVal === '>' || subVal === '|') {
          frontmatter[currentKey][subKey] = (subVal === '>' || subVal === '|') ? '' : [];
        } else {
          frontmatter[currentKey][subKey] = stripQuotes(subVal);
        }
      } else if (trimmedLine.startsWith('-')) {
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
            const sep = frontmatter[currentKey][currentSubKey] ? ' ' : '';
            frontmatter[currentKey][currentSubKey] += sep + trimmedLine;
          }
        } else {
          if (typeof frontmatter[currentKey] === 'string') {
            const sep = frontmatter[currentKey] ? ' ' : '';
            frontmatter[currentKey] += sep + trimmedLine;
          } else if (frontmatter[currentKey] === null) {
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
          lines.push(`${k}: [${val.map(v => String(v).trim()).join(', ')}]`);
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
        lines.push(`${k}: ${val}`);
      }
    }
  }

  for (const [k, v] of Object.entries(frontmatter)) {
    if (!keys.includes(k) && v !== undefined && v !== null) {
      if (typeof v === 'object') {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(body ? body.trimStart() : '');
  return lines.join('\n') + '\n';
}
