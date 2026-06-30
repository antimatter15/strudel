import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = new URL('../dist/', import.meta.url);
const basePath = normalizeBasePath(process.argv[2] || process.env.BASE_PATH || '');

if (!basePath) {
  console.error('Usage: node website/scripts/rewrite-relative-pages.mjs /base-path');
  process.exit(1);
}

const htmlFiles = await findHtmlFiles(distDir);

for (const fileUrl of htmlFiles) {
  const html = await readFile(fileUrl, 'utf8');
  const relative = path.posix.relative(fileURLToPosixPath(distDir), fileURLToPosixPath(fileUrl));
  const fromPageToRoot = path.posix.relative(path.posix.dirname(relative), '.') || '.';
  const rewritten = rewriteHtml(html, basePath, fromPageToRoot);

  if (rewritten !== html) {
    await writeFile(fileUrl, rewritten);
  }
}

await rewriteManifest();
await rewriteAstroWorkerUrls();

function rewriteHtml(html, basePath, fromPageToRoot) {
  const basePattern = new RegExp(`<base href=["']${escapeRegExp(basePath)}["']\\s*/?>`, 'g');
  return html
    .replace(basePattern, '<base href="./">')
    .replace(
      new RegExp(`(["'=])${escapeRegExp(basePath)}(?=([#?]|["']))`, 'g'),
      `$1${withTrailingSlash(fromPageToRoot)}`,
    )
    .replace(new RegExp(`(["'=])${escapeRegExp(basePath)}/([^"'\\s<>]*)`, 'g'), (_match, prefix, target) => {
      return `${prefix}${relativeTarget(fromPageToRoot, target)}`;
    })
    .replace(/(["'=])\/(?!\/)([^"'\s<>]*)/g, (_match, prefix, target) => {
      return `${prefix}${relativeTarget(fromPageToRoot, target)}`;
    })
    .replace(new RegExp(`url\\((["']?)${escapeRegExp(basePath)}/([^)"'\\s]*)\\1\\)`, 'g'), (_match, quote, target) => {
      return `url(${quote}${relativeTarget(fromPageToRoot, target)}${quote})`;
    })
    .replace(/url\((["']?)\/(?!\/)([^)"'\s]*)\1\)/g, (_match, quote, target) => {
      return `url(${quote}${relativeTarget(fromPageToRoot, target)}${quote})`;
    });
}

async function rewriteManifest() {
  const manifestUrl = new URL('manifest.webmanifest', distDir);
  try {
    const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
    const baseWithTrailingSlash = withTrailingSlash(basePath);

    if (manifest.start_url === basePath || manifest.start_url === baseWithTrailingSlash) {
      manifest.start_url = './';
    }

    if (manifest.scope === basePath || manifest.scope === baseWithTrailingSlash) {
      manifest.scope = './';
    }

    await writeFile(manifestUrl, `${JSON.stringify(manifest)}\n`);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function rewriteAstroWorkerUrls() {
  const astroDir = new URL('_astro/', distDir);
  const jsFiles = await findJsFiles(astroDir).catch((error) => {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  });
  const workerPattern = new RegExp(
    `new URL\\((["'\`])${escapeRegExp(basePath)}/_astro/([^"'\`]+)\\1\\s*,\\s*import\\.meta\\.url\\)`,
    'g',
  );

  for (const fileUrl of jsFiles) {
    const js = await readFile(fileUrl, 'utf8');
    const rewritten = js.replace(workerPattern, (_match, quote, target) => {
      return `new URL(${quote}./${target}${quote},import.meta.url)`;
    });

    if (rewritten !== js) {
      await writeFile(fileUrl, rewritten);
    }
  }
}

function relativeTarget(fromPageToRoot, target) {
  if (!target) {
    return withTrailingSlash(fromPageToRoot);
  }
  const normalized = path.posix.normalize(path.posix.join(fromPageToRoot, target));
  return normalized.startsWith('.') ? normalized : `./${normalized}`;
}

function withTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

async function findHtmlFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childUrl = new URL(entry.name, dirUrl);
    if (entry.isDirectory()) {
      files.push(...(await findHtmlFiles(new URL(`${entry.name}/`, dirUrl))));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(childUrl);
    }
  }

  return files;
}

async function findJsFiles(dirUrl) {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const childUrl = new URL(entry.name, dirUrl);
    if (entry.isDirectory()) {
      files.push(...(await findJsFiles(new URL(`${entry.name}/`, dirUrl))));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(childUrl);
    }
  }

  return files;
}

function normalizeBasePath(value) {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}

function fileURLToPosixPath(url) {
  return url.pathname;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
