const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const filePath = path.resolve(root, pathname === "/" ? "index.html" : pathname.slice(1));
  if (!filePath.startsWith(root + path.sep)) return response.writeHead(403).end("Forbidden");
  fs.readFile(filePath, (error, content) => {
    if (error) return response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Not found");
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(content);
  });
}).listen(port, "127.0.0.1", () => console.log(`Question bank: http://127.0.0.1:${port}`));
