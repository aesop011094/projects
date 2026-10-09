import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// A completely self-contained HTML file: no server, installation or external assets.
const project = resolve(import.meta.dirname, '..');
const dist = join(project, 'dist');
const releases = join(project, 'releases');
let html = await readFile(join(dist, 'index.html'), 'utf8');
const scriptMatch = html.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/);
const styleMatch = html.match(/<link\b[^>]*\bhref="([^"]+\.css)"[^>]*>/);
if (!scriptMatch || !styleMatch) throw new Error('Run npm run build first; expected one Vite JS and CSS bundle.');
let script = await readFile(join(dist, scriptMatch[1]), 'utf8');
const style = await readFile(join(dist, styleMatch[1]), 'utf8');
const imageDir = join(dist, 'images');
for (const file of await readdir(imageDir)) {
  const mime = /\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : /\.svg$/i.test(file) ? 'image/svg+xml' : null;
  if (!mime) continue;
  const data = `data:${mime};base64,${(await readFile(join(imageDir, file))).toString('base64')}`;
  script = script.replaceAll(`/images/${file}`, data);
}
if (/\/images\/[a-zA-Z0-9_-]+\.(?:jpg|png|webp|svg)/.test(script)) throw new Error('An image asset was not embedded.');
const favicon = (await readFile(join(dist, 'favicon.svg'))).toString('base64');
// Use a callback so literal $& / $` / $' in the JS bundle are not replacement tokens.
html = html.replace(scriptMatch[0], () => `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(styleMatch[0], () => `<style>${style}</style>`);
html = html.replace('href="/favicon.svg"', `href="data:image/svg+xml;base64,${favicon}"`);
await mkdir(releases, { recursive: true });
const output = join(releases, '我的食譜庫.html');
await writeFile(output, html);
console.log(`Standalone cookbook: ${output} (${Buffer.byteLength(html)} bytes)`);
