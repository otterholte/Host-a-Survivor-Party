// Local server for the Survivor Host Kit (localhost + your Wi-Fi).
// Also stores the host's own photos and videos for each game-plan step in assets/media/<step>/.
import http from 'http'; import fs from 'fs'; import path from 'path'; import os from 'os'; import { fileURLToPath } from 'url';
const root = path.dirname(fileURLToPath(import.meta.url));
const mediaRoot = path.join(root, 'assets', 'media');
const types = {'.html':'text/html; charset=utf-8','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.heic':'image/heic','.svg':'image/svg+xml','.pdf':'application/pdf','.json':'application/json','.mp3':'audio/mpeg','.m4a':'audio/mp4','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.m4v':'video/mp4'};
const MEDIA_EXT = {'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif','image/heic':'.heic','video/mp4':'.mp4','video/quicktime':'.mov','video/webm':'.webm'};
const MAX_UPLOAD = 300 * 1024 * 1024;
const okKey = k => /^[a-z0-9-]{1,40}$/i.test(k);
const json = (res, code, body) => { res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); };

function listMedia(){
  const out = {};
  if (!fs.existsSync(mediaRoot)) return out;
  for (const key of fs.readdirSync(mediaRoot)) {
    const dir = path.join(mediaRoot, key);
    if (!okKey(key) || !fs.statSync(dir).isDirectory()) continue;
    out[key] = fs.readdirSync(dir).filter(f => types[path.extname(f).toLowerCase()]).sort()
      .map(name => ({ key, name, url: `assets/media/${key}/${encodeURIComponent(name)}`, type: (types[path.extname(name).toLowerCase()]||'').startsWith('video') ? 'video' : 'image' }));
  }
  return out;
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // ---- media API ----
  if (url === '/api/media' && req.method === 'GET') return json(res, 200, listMedia());
  const m = url.match(/^\/api\/media\/([^/]+)(?:\/([^/]+))?$/);
  if (m) {
    const [, key, file] = m;
    if (!okKey(key)) return json(res, 400, {error:'bad step'});
    if (req.method === 'POST' && !file) {
      const ct = (req.headers['content-type']||'').split(';')[0].toLowerCase();
      const ext = MEDIA_EXT[ct];
      if (!ext) { res.writeHead(415); return res.end('Only photos and videos can be added.'); }
      const q = new URL(req.url, 'http://x').searchParams.get('name') || 'media';
      const base = path.basename(q, path.extname(q)).replace(/[^a-z0-9 _-]/gi, '').trim().slice(0, 40) || 'media';
      const dir = path.join(mediaRoot, key); fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `${Date.now()}-${base}${ext}`);
      let size = 0; const out = fs.createWriteStream(dest);
      req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { req.destroy(); out.destroy(); fs.rm(dest, () => {}); } });
      req.pipe(out);
      out.on('finish', () => json(res, 200, { ok: true }));
      out.on('error', () => { res.writeHead(500); res.end('Save failed'); });
      return;
    }
    if (req.method === 'DELETE' && file) {
      const target = path.join(mediaRoot, key, path.basename(file));
      if (!target.startsWith(mediaRoot)) return json(res, 400, {error:'bad path'});
      fs.rm(target, err => json(res, err ? 404 : 200, { ok: !err }));
      return;
    }
    return json(res, 405, {error:'not allowed'});
  }
  // ---- static files ----
  const file = path.join(root, url.endsWith('/') ? url + 'index.html' : url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = types[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && /^video|^audio/.test(type)) {           // let phones scrub through videos
      const [a, b] = range.replace('bytes=', '').split('-'); const start = +a, end = b ? +b : st.size - 1;
      res.writeHead(206, {'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1});
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': st.size});
    fs.createReadStream(file).pipe(res);
  });
}).listen(8790, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('Survivor Host Kit running:');
  console.log('  This PC:    http://localhost:8790');
  ips.forEach(ip => console.log(`  Your Wi-Fi: http://${ip}:8790`));
});
