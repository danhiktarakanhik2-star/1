// Минимальный статический сервер без зависимостей.
// Все игры в этом репо раздаются с корня, поэтому пути в HTML — относительные.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.exe': 'application/octet-stream',
  '.bat': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    // корень ведёт на игру — удобно для превью
    if (pathname === '/' || pathname === '') {
      res.writeHead(302, { Location: '/tf2/' });
      res.end();
      return;
    }
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Защита от выхода за пределы корня
    const filePath = path.normalize(path.join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        // Дружелюбная "страница не найдена" со ссылкой на игру
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<meta charset="utf-8"><body style="font-family:system-ui;background:#14161c;color:#dfe3ea;padding:40px">' +
            '<h1>404</h1><p>Файл не найден: <code>' +
            pathname.replace(/[<>&"]/g, '') +
            '</code></p><p><a style="color:#e8a33d" href="/tf2/">→ Открыть игру «Fortress Arena»</a></p></body>'
        );
        return;
      }

      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  } catch (e) {
    res.writeHead(500).end('Internal Server Error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Fortress Arena — сервер запущен на http://0.0.0.0:${PORT}`);
  console.log(`Игра: http://0.0.0.0:${PORT}/tf2/`);
});
