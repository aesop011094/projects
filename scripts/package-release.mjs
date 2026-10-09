import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// A completely self-contained HTML file: no server, installation or external assets.
const project = resolve(import.meta.dirname, '..');
const dist = join(project, 'dist');
const releases = join(project, 'releases');
const downloads = join(project, 'downloads');
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

// A stable, complete desktop download is rebuilt with every release. Python is
// provided by the cloud development environment; end users do not need it.
await mkdir(downloads, { recursive: true });
const zipOutput = join(downloads, 'cookbook.zip');
const packaged = spawnSync('python3', ['-c', `
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import codecs
import sys

html_path, readme_path, zip_path = map(Path, sys.argv[1:])
temporary_zip = zip_path.with_name(zip_path.name + '.tmp')
entries = [
    ('cookbook.html', html_path.read_bytes()),
    ('README.txt', codecs.BOM_UTF8 + readme_path.read_text(encoding='utf-8').lstrip('\\ufeff').encode('utf-8')),
]
with ZipFile(temporary_zip, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for name, content in entries:
        entry = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        entry.create_system = 3
        entry.external_attr = 0o100644 << 16
        archive.writestr(entry, content, compress_type=ZIP_DEFLATED, compresslevel=9)
with ZipFile(temporary_zip) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Desktop ZIP failed its integrity check.')
    for name, content in entries:
        if archive.read(name) != content:
            raise RuntimeError(f'Desktop ZIP does not match its source: {name}')
temporary_zip.replace(zip_path)
print(f'Desktop download: {zip_path} ({zip_path.stat().st_size} bytes)')
`, output, join(downloads, 'README.md'), zipOutput], { encoding: 'utf8' });
if (packaged.error) throw new Error(`Unable to create desktop ZIP; Python 3 is required: ${packaged.error.message}`);
if (packaged.status !== 0) throw new Error(`Unable to create desktop ZIP: ${packaged.stderr.trim() || 'packaging failed'}`);
console.log(packaged.stdout.trim());
