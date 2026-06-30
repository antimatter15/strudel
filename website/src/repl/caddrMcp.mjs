import { $settings, defaultSettings, settingsMap } from '../settings.mjs';
import { atom } from 'nanostores';
import jsdocJson from '../../../doc.json';

const docPageModules = import.meta.glob('../pages/**/*.mdx', {
  eager: true,
  import: 'default',
  query: '?raw',
});

const CADDR_MCP_API_URL = 'https://caddr-origin.github.io/examples/mcp/api.js';
const STRUDEL_MCP_VERSION = '1.0.0';
const playbackStartTimeoutMs = 5000;
const defaultValidationTimeoutMs = 3000;
const maxValidationTimeoutMs = 10000;
const defaultSearchLimit = 10;
const maxSearchLimit = 50;
const defaultPageChars = 8000;
const maxPageChars = 50000;

const settingKeysThatNeedReload = new Set([
  'audioDeviceName',
  'audioEngineTarget',
  'isSyncEnabled',
  'multiChannelOrbits',
]);

const extraSettingKeys = ['audioDeviceName', 'patternAutoStart'];

const referenceEntries = createReferenceEntries();
const docPages = createDocPages();

let registrationPromise;
let authorizationFrame;

export const $caddrMcpStatus = atom({
  state: 'idle',
  label: 'caddr offline',
  error: undefined,
});

export function registerStrudelMCP(getEditor) {
  if (typeof window === 'undefined') {
    return;
  }
  if (registrationPromise) {
    return registrationPromise;
  }

  setCaddrMCPStatus('connecting');
  registrationPromise = loadCaddrMCP()
    .then((registerMCPServer) => {
      authorizationFrame = createAuthorizationFrame();
      const tools = createStrudelTools(getEditor);

      return registerMCPServer({
        insertFrame: (frame) => {
          frame.style.width = '100%';
          frame.style.height = '80px';
          frame.style.border = '0';
          authorizationFrame.content.appendChild(frame);
        },
        showAuthorizationFrame: () => {
          setCaddrMCPStatus('authorization');
          authorizationFrame.modal.style.display = 'flex';
        },
        hideAuthorizationFrame: () => {
          setCaddrMCPStatus('connected');
          authorizationFrame.modal.style.display = 'none';
        },
        name: 'Strudel REPL',
        version: STRUDEL_MCP_VERSION,
        tools,
      });
    })
    .catch((error) => {
      registrationPromise = undefined;
      setCaddrMCPStatus('error', error.message);
      console.warn('[caddr-mcp] Failed to register Strudel MCP server:', error);
    });

  return registrationPromise;
}

export function showCaddrMCPAuthorization() {
  authorizationFrame ??= createAuthorizationFrame();
  authorizationFrame.modal.style.display = 'flex';
  if ($caddrMcpStatus.get().state !== 'connected') {
    setCaddrMCPStatus('authorization');
  }
}

function setCaddrMCPStatus(state, error) {
  const labels = {
    idle: 'caddr offline',
    connecting: 'caddr connecting',
    authorization: 'caddr authorize',
    connected: 'caddr connected',
    error: 'caddr error',
  };

  $caddrMcpStatus.set({
    state,
    label: labels[state] ?? 'caddr',
    error,
  });
}

function loadCaddrMCP() {
  if (typeof window.registerMCPServer === 'function') {
    return Promise.resolve(window.registerMCPServer);
  }

  window.__strudelCaddrMCPScriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CADDR_MCP_API_URL;
    script.async = true;
    script.onload = () => {
      if (typeof window.registerMCPServer === 'function') {
        resolve(window.registerMCPServer);
      } else {
        reject(new Error('Caddr-MCP API loaded without registerMCPServer'));
      }
    };
    script.onerror = () => reject(new Error(`Could not load ${CADDR_MCP_API_URL}`));
    document.head.appendChild(script);
  });

  return window.__strudelCaddrMCPScriptPromise;
}

function createAuthorizationFrame() {
  const existing = document.getElementById('strudel-caddr-authorization');
  if (existing) {
    return {
      modal: existing,
      content: existing.querySelector('[data-caddr-frame-container]'),
    };
  }

  const modal = document.createElement('div');
  modal.id = 'strudel-caddr-authorization';
  Object.assign(modal.style, {
    alignItems: 'center',
    background: 'rgba(0, 0, 0, 0.45)',
    bottom: '0',
    display: 'none',
    justifyContent: 'center',
    left: '0',
    padding: '16px',
    position: 'fixed',
    right: '0',
    top: '0',
    zIndex: '9999',
  });

  const dialog = document.createElement('div');
  Object.assign(dialog.style, {
    background: 'var(--background, #111)',
    border: '1px solid var(--muted, #555)',
    color: 'var(--foreground, #fff)',
    fontFamily: 'system-ui, sans-serif',
    maxWidth: '460px',
    padding: '20px',
    width: '100%',
  });

  const title = document.createElement('h2');
  title.textContent = 'Authorize Caddr-MCP';
  Object.assign(title.style, {
    fontSize: '18px',
    fontWeight: '600',
    margin: '0 0 8px',
  });

  const description = document.createElement('p');
  description.textContent = 'Authorize this Caddr-MCP client to control the Strudel REPL.';
  Object.assign(description.style, {
    fontSize: '14px',
    lineHeight: '1.4',
    margin: '0 0 16px',
  });

  const content = document.createElement('div');
  content.setAttribute('data-caddr-frame-container', '');

  dialog.append(title, description, content);
  modal.appendChild(dialog);
  document.body.appendChild(modal);

  return { modal, content };
}

function createStrudelTools(getEditor) {
  const withEditor = (fn) => {
    const editor = getEditor?.();
    if (!editor) {
      return { success: false, error: 'Strudel editor is not ready yet.' };
    }
    return fn(editor);
  };

  const getSourceCode = () => withEditor((editor) => getCode(editor));
  const setSourceCode = (params) =>
    withEditor(async (editor) => {
      if (typeof params?.source !== 'string') {
        return { success: false, error: 'source must be a string.' };
      }
      editor.setCode(params.source);
      settingsMap.setKey('latestCode', params.source);
      return withCodeValidation(editor, params, {
        success: true,
        code_updated: true,
        code: getCode(editor),
      });
    });

  return [
    {
      name: 'get_source_code',
      description: 'Get the current Strudel source code.',
      input_schema: emptyObjectSchema(),
      async execute(sender) {
        void sender;
        return getSourceCode();
      },
    },
    {
      name: 'set_source_code',
      description: 'Replace the current Strudel source code.',
      input_schema: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'The complete Strudel source code to set in the editor.',
          },
          validate: {
            type: 'boolean',
            description: 'Whether to evaluate the code without starting playback and report errors. Defaults to true.',
          },
          validation_timeout_ms: {
            type: 'number',
            description: `Maximum time to wait for validation feedback. Defaults to ${defaultValidationTimeoutMs}.`,
          },
        },
        required: ['source'],
      },
      async execute(sender, params = {}) {
        void sender;
        return setSourceCode(params);
      },
    },
    {
      name: 'replace_source_range',
      description: 'Replace a range of the current Strudel source code using zero-based character offsets.',
      input_schema: {
        type: 'object',
        properties: {
          from: {
            type: 'number',
            description: 'Start character offset, inclusive.',
          },
          to: {
            type: 'number',
            description: 'End character offset, exclusive.',
          },
          insert: {
            type: 'string',
            description: 'Text to insert in place of the selected range.',
          },
          validate: {
            type: 'boolean',
            description: 'Whether to evaluate the code without starting playback and report errors. Defaults to true.',
          },
          validation_timeout_ms: {
            type: 'number',
            description: `Maximum time to wait for validation feedback. Defaults to ${defaultValidationTimeoutMs}.`,
          },
        },
        required: ['from', 'to', 'insert'],
      },
      async execute(sender, params = {}) {
        void sender;
        return withEditor((editor) => replaceSourceRange(editor, params));
      },
    },
    {
      name: 'get_settings',
      description: 'Get the current effective Strudel REPL settings.',
      input_schema: {
        type: 'object',
        properties: {
          keys: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional list of setting keys to return.',
          },
        },
        required: [],
      },
      async execute(sender, params = {}) {
        void sender;
        return getSettings(params.keys);
      },
    },
    {
      name: 'update_settings',
      description: 'Update one or more Strudel REPL settings by key.',
      input_schema: {
        type: 'object',
        properties: {
          settings: {
            type: 'object',
            description: 'Object whose keys are Strudel setting names and values are the new values.',
          },
        },
        required: ['settings'],
      },
      async execute(sender, params = {}) {
        void sender;
        return updateSettings(params.settings);
      },
    },
    {
      name: 'get_playback_state',
      description: 'Get the current Strudel playback state.',
      input_schema: emptyObjectSchema(),
      async execute(sender) {
        void sender;
        return withEditor(getPlaybackState);
      },
    },
    {
      name: 'list_strudel_reference',
      description: 'List Strudel API reference entries, optionally filtered by tag or query.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional case-insensitive text to match against names, descriptions, tags, and examples.',
          },
          tag: {
            type: 'string',
            description: 'Optional reference tag to filter by, such as samples, tonal, pattern, or effects.',
          },
          limit: {
            type: 'number',
            description: `Maximum number of entries to return. Defaults to ${defaultSearchLimit}.`,
          },
          offset: {
            type: 'number',
            description: 'Zero-based offset for paging through results.',
          },
        },
        required: [],
      },
      async execute(sender, params = {}) {
        void sender;
        return listReferenceEntries(params);
      },
    },
    {
      name: 'get_strudel_reference',
      description: 'Read one Strudel API reference entry by name or synonym.',
      input_schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Function or method name to read, such as s, note, Pattern#fast, or sound.',
          },
        },
        required: ['name'],
      },
      async execute(sender, params = {}) {
        void sender;
        return getReferenceEntry(params.name);
      },
    },
    {
      name: 'list_strudel_doc_pages',
      description: 'List Strudel documentation pages available from the local website docs.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional case-insensitive text to match against page ids, titles, headings, and content.',
          },
          limit: {
            type: 'number',
            description: `Maximum number of pages to return. Defaults to ${defaultSearchLimit}.`,
          },
          offset: {
            type: 'number',
            description: 'Zero-based offset for paging through results.',
          },
        },
        required: [],
      },
      async execute(sender, params = {}) {
        void sender;
        return listDocPages(params);
      },
    },
    {
      name: 'get_strudel_doc_page',
      description: 'Read a Strudel documentation page by page id.',
      input_schema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Documentation page id, such as learn/getting-started or technical-manual/repl.',
          },
          offset: {
            type: 'number',
            description: 'Zero-based character offset for reading a long page in chunks.',
          },
          max_chars: {
            type: 'number',
            description: `Maximum number of characters to return. Defaults to ${defaultPageChars}.`,
          },
        },
        required: ['id'],
      },
      async execute(sender, params = {}) {
        void sender;
        return getDocPage(params);
      },
    },
    {
      name: 'search_strudel_docs',
      description: 'Search across Strudel API reference entries and local documentation pages.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Case-insensitive search text.',
          },
          scope: {
            type: 'string',
            enum: ['all', 'reference', 'docs'],
            description: 'Where to search. Defaults to all.',
          },
          limit: {
            type: 'number',
            description: `Maximum number of matches to return. Defaults to ${defaultSearchLimit}.`,
          },
        },
        required: ['query'],
      },
      async execute(sender, params = {}) {
        void sender;
        return searchStrudelDocs(params);
      },
    },
    {
      name: 'play',
      description: 'Evaluate the current Strudel code and start playback.',
      input_schema: emptyObjectSchema(),
      async execute(sender) {
        void sender;
        return withEditor((editor) => requestPlaybackStart(editor, 'play'));
      },
    },
    {
      name: 'pause',
      description: 'Pause Strudel playback without changing the editor code.',
      input_schema: emptyObjectSchema(),
      async execute(sender) {
        void sender;
        return withEditor((editor) => {
          pauseEditor(editor);
          return {
            success: true,
            requested: 'pause',
            state: getPlaybackState(editor),
          };
        });
      },
    },
    {
      name: 'toggle_play',
      description: 'Toggle Strudel playback. If stopped, evaluate the current code and start playback.',
      input_schema: emptyObjectSchema(),
      async execute(sender) {
        void sender;
        return withEditor((editor) => {
          if (!isPlaybackStarted(editor)) {
            return requestPlaybackStart(editor, 'toggle_play');
          }
          editor.stop();
          return {
            success: true,
            requested: 'toggle_play',
            action: 'stop',
            state: getPlaybackState(editor),
          };
        });
      },
    },
  ];
}

function emptyObjectSchema() {
  return {
    type: 'object',
    properties: {},
    required: [],
  };
}

function createReferenceEntries() {
  const seen = new Set();
  const entries = [];

  for (const doc of jsdocJson.docs || []) {
    const tags = normalizeTags(doc.tags);
    if (!isReferenceEntry(doc, tags) || seen.has(doc.name)) {
      continue;
    }

    const synonyms = (doc.synonyms || [])
      .map((name) => String(name || '').trim())
      .filter((name) => name && !seen.has(name));
    const names = [doc.name, ...synonyms];
    names.forEach((name) => seen.add(name));

    entries.push({
      name: doc.name,
      longname: doc.longname,
      synonyms,
      allNames: names.join(' '),
      tags,
      description: stripHtml(doc.description || ''),
      descriptionHtml: doc.description || '',
      params: (doc.params || []).map((param) => ({
        name: param.name,
        type: param.type?.names || [],
        description: stripHtml(param.description || ''),
      })),
      examples: doc.examples || [],
      returns: (doc.returns || []).map((item) => ({
        type: item.type?.names || [],
        description: stripHtml(item.description || ''),
      })),
      source: getReferenceSource(doc),
    });
  }

  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function isReferenceEntry(doc, tags) {
  if (!doc.name || doc.name.startsWith('_') || !doc.description || doc.kind === 'package') {
    return false;
  }
  const isSupradoughOnly = tags.includes('supradough') && !tags.includes('superdough');
  const isSuperdirtOnly = tags.includes('superdirt') && !tags.includes('superdough');
  return !isSupradoughOnly && !isSuperdirtOnly;
}

function normalizeTags(tags = []) {
  const normalized = tags
    .map((tag) => {
      if (typeof tag === 'string') {
        return tag;
      }
      if (typeof tag?.text === 'string') {
        return tag.text;
      }
      if (typeof tag?.value === 'string') {
        return tag.value;
      }
      return '';
    })
    .flatMap((tag) => tag.split(','))
    .map((tag) => tag.trim())
    .filter(Boolean);

  return normalized.length ? normalized : ['untagged'];
}

function getReferenceSource(doc) {
  const path = doc.meta?.path || '';
  const packageMatch = path.match(/packages\/([^/]+)$/);
  return {
    package: packageMatch?.[1],
    file: doc.meta?.filename,
    line: doc.meta?.lineno,
  };
}

function createDocPages() {
  return Object.entries(docPageModules)
    .map(([path, raw]) => {
      const id = docPagePathToId(path);
      const content = cleanDocPageContent(String(raw || ''));
      const headings = extractHeadings(content);
      const title = headings[0]?.text || titleFromId(id);
      const referencedFunctions = extractReferencedFunctions(String(raw || ''));

      return {
        id,
        path,
        url: `/${id}/`,
        title,
        headings,
        referencedFunctions,
        content,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function docPagePathToId(path) {
  return path
    .replace(/^\.\.\/pages\//, '')
    .replace(/\.mdx$/, '')
    .replace(/\/index$/, '');
}

function normalizeDocPageId(id) {
  return String(id || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.mdx$/, '')
    .replace(/\/index$/, '');
}

function titleFromId(id) {
  return id
    .split('/')
    .pop()
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanDocPageContent(raw) {
  return raw
    .replace(/^import\s.+$/gm, '')
    .replace(/^export\s.+$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<JsDoc\b[^>]*name=["']([^"']+)["'][^>]*\/>/g, '[API reference: $1]')
    .replace(/<MiniRepl\b[^>]*\/>/g, '[Mini REPL example]')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractHeadings(content) {
  return content
    .split('\n')
    .map((line) => line.match(/^(#{1,3})\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      level: match[1].length,
      text: match[2].trim(),
    }));
}

function extractReferencedFunctions(raw) {
  return Array.from(raw.matchAll(/<JsDoc\b[^>]*name=["']([^"']+)["'][^>]*\/>/g), (match) => match[1]).filter(unique);
}

function listReferenceEntries({ query = '', tag = '', limit, offset } = {}) {
  const q = normalizeQuery(query);
  const normalizedTag = normalizeQuery(tag);
  const start = toOffset(offset);
  const max = clampLimit(limit);
  const filtered = referenceEntries.filter((entry) => {
    if (normalizedTag && !entry.tags.some((entryTag) => normalizeQuery(entryTag) === normalizedTag)) {
      return false;
    }
    return !q || referenceSearchText(entry).includes(q);
  });

  return {
    total: filtered.length,
    offset: start,
    limit: max,
    tags: getReferenceTagCounts(),
    entries: filtered.slice(start, start + max).map(referenceSummary),
  };
}

function getReferenceEntry(name) {
  const entry = findReferenceEntry(name);
  if (!entry) {
    return {
      success: false,
      error: `No Strudel reference entry found for '${name}'.`,
      suggestions: searchReferenceEntries(String(name || ''), 5).map(referenceSummary),
    };
  }

  return {
    success: true,
    entry,
  };
}

function findReferenceEntry(name) {
  const q = normalizeQuery(name);
  return referenceEntries.find(
    (entry) => normalizeQuery(entry.name) === q || entry.synonyms.some((synonym) => normalizeQuery(synonym) === q),
  );
}

function listDocPages({ query = '', limit, offset } = {}) {
  const q = normalizeQuery(query);
  const start = toOffset(offset);
  const max = clampLimit(limit);
  const filtered = docPages.filter((page) => !q || docPageSearchText(page).includes(q));

  return {
    total: filtered.length,
    offset: start,
    limit: max,
    pages: filtered.slice(start, start + max).map(docPageSummary),
  };
}

function getDocPage({ id, offset, max_chars: maxChars } = {}) {
  const normalizedId = normalizeDocPageId(id);
  const page = docPages.find((item) => item.id === normalizedId);
  if (!page) {
    return {
      success: false,
      error: `No Strudel documentation page found for '${id}'.`,
      suggestions: searchDocPages(String(id || ''), 5).map(docPageSummary),
    };
  }

  const start = toOffset(offset);
  const max = clampPageChars(maxChars);
  const content = page.content.slice(start, start + max);

  return {
    success: true,
    page: {
      ...docPageSummary(page),
      referencedFunctions: page.referencedFunctions,
      content,
      offset: start,
      max_chars: max,
      total_chars: page.content.length,
      has_more: start + max < page.content.length,
    },
  };
}

function searchStrudelDocs({ query = '', scope = 'all', limit } = {}) {
  const q = normalizeQuery(query);
  if (!q) {
    return { success: false, error: 'query must be a non-empty string.' };
  }
  if (!['all', 'reference', 'docs'].includes(scope)) {
    return { success: false, error: "scope must be one of 'all', 'reference', or 'docs'." };
  }

  const max = clampLimit(limit);
  const results = [];

  if (scope === 'all' || scope === 'reference') {
    searchReferenceEntries(q, max).forEach((entry) => {
      results.push({
        type: 'reference',
        ...referenceSummary(entry),
        snippet: makeSnippet(referenceSearchText(entry), q),
      });
    });
  }

  if (scope === 'all' || scope === 'docs') {
    searchDocPages(q, max).forEach((page) => {
      results.push({
        type: 'doc_page',
        ...docPageSummary(page),
        snippet: makeSnippet(page.content, q),
      });
    });
  }

  return {
    success: true,
    query,
    scope,
    total: results.length,
    results: results.sort((a, b) => scoreSearchResult(b, q) - scoreSearchResult(a, q)).slice(0, max),
  };
}

function searchReferenceEntries(query, limit) {
  const q = normalizeQuery(query);
  return referenceEntries
    .filter((entry) => referenceSearchText(entry).includes(q))
    .sort((a, b) => scoreReferenceEntry(b, q) - scoreReferenceEntry(a, q))
    .slice(0, limit);
}

function searchDocPages(query, limit) {
  const q = normalizeQuery(query);
  return docPages
    .filter((page) => docPageSearchText(page).includes(q))
    .sort((a, b) => scoreDocPage(b, q) - scoreDocPage(a, q))
    .slice(0, limit);
}

function referenceSummary(entry) {
  return {
    name: entry.name,
    synonyms: entry.synonyms,
    tags: entry.tags,
    description: entry.description,
    source: entry.source,
  };
}

function docPageSummary(page) {
  return {
    id: page.id,
    title: page.title,
    url: page.url,
    headings: page.headings,
  };
}

function getReferenceTagCounts() {
  const counts = {};
  referenceEntries.forEach((entry) => {
    entry.tags.forEach((tag) => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return counts;
}

function referenceSearchText(entry) {
  return normalizeQuery(
    [
      entry.name,
      entry.longname,
      entry.allNames,
      entry.tags.join(' '),
      entry.description,
      entry.params.map((param) => `${param.name} ${param.type.join(' ')} ${param.description}`).join(' '),
      entry.examples.join(' '),
    ].join(' '),
  );
}

function docPageSearchText(page) {
  return normalizeQuery(
    [page.id, page.title, page.headings.map((heading) => heading.text).join(' '), page.content].join(' '),
  );
}

function scoreSearchResult(result, query) {
  if (result.type === 'reference') {
    return scoreText(result.name, query) + scoreText(result.description, query);
  }
  return scoreText(result.id, query) + scoreText(result.title, query) + scoreText(result.snippet, query);
}

function scoreReferenceEntry(entry, query) {
  return (
    scoreText(entry.name, query) * 4 +
    Math.max(...entry.synonyms.map((synonym) => scoreText(synonym, query)), 0) * 3 +
    scoreText(entry.description, query) +
    scoreText(entry.tags.join(' '), query)
  );
}

function scoreDocPage(page, query) {
  return scoreText(page.id, query) * 3 + scoreText(page.title, query) * 3 + scoreText(page.content, query);
}

function scoreText(text, query) {
  const normalized = normalizeQuery(text);
  if (!normalized.includes(query)) {
    return 0;
  }
  if (normalized === query) {
    return 100;
  }
  if (normalized.startsWith(query)) {
    return 50;
  }
  return 10;
}

function makeSnippet(text, query, maxLength = 320) {
  const normalizedText = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  const index = normalizeQuery(normalizedText).indexOf(normalizeQuery(query));
  if (index === -1) {
    return normalizedText.slice(0, maxLength);
  }

  const start = Math.max(0, index - 80);
  const end = Math.min(normalizedText.length, start + maxLength);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedText.length ? '...' : '';
  return `${prefix}${normalizedText.slice(start, end)}${suffix}`;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeQuery(value) {
  return String(value || '')
    .toLowerCase()
    .trim();
}

function clampLimit(limit) {
  const number = Number(limit);
  if (!Number.isFinite(number) || number <= 0) {
    return defaultSearchLimit;
  }
  return Math.min(Math.floor(number), maxSearchLimit);
}

function clampPageChars(maxChars) {
  const number = Number(maxChars);
  if (!Number.isFinite(number) || number <= 0) {
    return defaultPageChars;
  }
  return Math.min(Math.floor(number), maxPageChars);
}

function clampValidationTimeout(timeoutMs) {
  const number = Number(timeoutMs);
  if (!Number.isFinite(number) || number <= 0) {
    return defaultValidationTimeoutMs;
  }
  return Math.min(Math.floor(number), maxValidationTimeoutMs);
}

function toOffset(offset) {
  const number = Number(offset);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function unique(value, index, array) {
  return array.indexOf(value) === index;
}

function getCode(editor) {
  return editor.code ?? editor.editor?.state.doc.toString() ?? '';
}

async function replaceSourceRange(editor, params) {
  const code = getCode(editor);
  const from = Number(params?.from);
  const to = Number(params?.to);
  const insert = params?.insert;

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > code.length) {
    return {
      success: false,
      error: `Invalid range. Expected integer offsets where 0 <= from <= to <= ${code.length}.`,
    };
  }
  if (typeof insert !== 'string') {
    return { success: false, error: 'insert must be a string.' };
  }

  editor.replaceCode(insert, from, to);
  settingsMap.setKey('latestCode', getCode(editor));
  return withCodeValidation(editor, params, {
    success: true,
    code_updated: true,
    code: getCode(editor),
  });
}

async function withCodeValidation(editor, params, response) {
  if (params?.validate === false) {
    return {
      ...response,
      validation: {
        requested: false,
      },
      state: getPlaybackState(editor),
    };
  }

  const validation = await validateCurrentCode(editor, params?.validation_timeout_ms);

  return {
    ...response,
    success: validation.success,
    error: validation.error,
    validation,
    state: getPlaybackState(editor),
  };
}

async function validateCurrentCode(editor, timeoutMs) {
  const timeout = clampValidationTimeout(timeoutMs);
  const evaluation = Promise.resolve().then(() => editor.repl.evaluate(getCode(editor), false));
  const validationResult = await settleWithTimeout(evaluation, timeout);

  if (validationResult.timedOut) {
    return {
      success: false,
      requested: true,
      timed_out: true,
      timeout_ms: timeout,
      error: `Code was set, but validation did not finish within ${timeout}ms. Browser audio startup may still be waiting for tab focus or a user gesture.`,
    };
  }

  if (validationResult.error) {
    return {
      success: false,
      requested: true,
      error: formatErrorMessage(validationResult.error),
      error_details: serializeError(validationResult.error),
    };
  }

  const replError = getReplError(editor);
  if (replError) {
    return {
      success: false,
      requested: true,
      error: formatErrorMessage(replError),
      error_details: serializeError(replError),
    };
  }

  return {
    success: true,
    requested: true,
    error: undefined,
  };
}

function settleWithTimeout(promise, timeoutMs) {
  return Promise.race([
    Promise.resolve(promise).then(
      (value) => ({ value }),
      (error) => ({ error }),
    ),
    new Promise((resolve) => {
      window.setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    }),
  ]);
}

function getSettings(keys) {
  const settings = $settings.get();
  if (!Array.isArray(keys) || keys.length === 0) {
    return settings;
  }

  return Object.fromEntries(keys.map((key) => [key, settings[key]]));
}

function updateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { success: false, error: 'settings must be an object.' };
  }

  const allowedKeys = new Set([
    ...Object.keys(defaultSettings),
    ...Object.keys(settingsMap.get()),
    ...extraSettingKeys,
  ]);
  const unknownKeys = [];
  const updatedKeys = [];
  const reloadRequired = [];

  Object.entries(settings).forEach(([key, value]) => {
    if (!allowedKeys.has(key)) {
      unknownKeys.push(key);
      return;
    }

    settingsMap.setKey(key, normalizeSettingValue(key, value));
    updatedKeys.push(key);
    if (settingKeysThatNeedReload.has(key)) {
      reloadRequired.push(key);
    }
  });

  return {
    success: unknownKeys.length === 0,
    updatedKeys,
    unknownKeys,
    reloadRequired,
    settings: getSettings(updatedKeys),
  };
}

function normalizeSettingValue(key, value) {
  if (key === 'userPatterns' && typeof value !== 'string') {
    return JSON.stringify(value);
  }
  return value;
}

function getPlaybackState(editor) {
  return {
    activeCode: editor.repl?.state?.activeCode,
    code: getCode(editor),
    error: formatErrorMessage(getReplError(editor)),
    isDirty: Boolean(editor.repl?.state?.isDirty),
    pending: Boolean(editor.repl?.state?.pending),
    started: isPlaybackStarted(editor),
    visibilityState: typeof document === 'undefined' ? undefined : document.visibilityState,
  };
}

function getReplError(editor) {
  return editor.repl?.state?.error ?? editor.repl?.state?.evalError ?? editor.repl?.state?.schedulerError;
}

function formatErrorMessage(error) {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'string') {
    return error;
  }

  const message = String(error);
  if (message && message !== '[object Object]') {
    return message;
  }
  return error.message || 'Unknown Strudel error';
}

function serializeError(error) {
  if (!error || typeof error === 'string') {
    return error;
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

async function requestPlaybackStart(editor, requested) {
  const evaluation = editor.evaluate();
  const result = await waitForPlaybackStart(editor, evaluation, playbackStartTimeoutMs);
  const state = getPlaybackState(editor);

  return {
    success: result.started,
    requested,
    action: 'start',
    error: result.started ? undefined : getPlaybackStartFailureMessage(state, result),
    state,
  };
}

async function waitForPlaybackStart(editor, evaluation, timeoutMs) {
  let evaluateSettled = false;

  evaluation
    ?.catch(() => undefined)
    .finally(() => {
      evaluateSettled = true;
    });

  const started = await waitUntil(() => isPlaybackStarted(editor), timeoutMs);
  if (started) {
    return { started: true, evaluateSettled };
  }

  return {
    started: false,
    evaluateSettled,
    timedOut: !evaluateSettled || Boolean(editor.repl?.state?.pending),
  };
}

function waitUntil(predicate, timeoutMs, intervalMs = 50) {
  return new Promise((resolve) => {
    if (predicate()) {
      resolve(true);
      return;
    }

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (predicate()) {
        window.clearInterval(interval);
        resolve(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(interval);
        resolve(false);
      }
    }, intervalMs);
  });
}

function isPlaybackStarted(editor) {
  return Boolean(editor.repl?.scheduler?.started ?? editor.repl?.state?.started);
}

function getPlaybackStartFailureMessage(state, result) {
  if (state.error) {
    return `Playback did not start: ${state.error}`;
  }
  if (state.visibilityState === 'hidden') {
    return 'Playback did not start within 5 seconds. The Strudel tab is in the background, so browser audio startup may be blocked until the tab is visible.';
  }
  if (result.timedOut) {
    return 'Playback did not start within 5 seconds.';
  }
  return 'Playback did not start.';
}

function pauseEditor(editor) {
  if (typeof editor.repl?.pause === 'function') {
    editor.repl.pause();
  } else {
    editor.stop();
  }
}
