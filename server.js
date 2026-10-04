/* Zero-dependency local dev server for clockling.html.
 * Usage: node server.js  ->  http://127.0.0.1:8080/clockling.html
 * Another port: PORT=8090 node server.js   (alternative: python -m http.server)
 */
var http = require("http");
var fs = require("fs");
var path = require("path");

var PORT = +process.env.PORT || 8080;
var ROOT = __dirname;
var TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg"
};

http.createServer(function (req, res) {
    var pathname = decodeURIComponent(req.url.split("?")[0]);
    if (pathname === "/") pathname = "/clockling.html";
    var file = path.normalize(path.join(ROOT, pathname));
    if (file.indexOf(ROOT + path.sep) !== 0 && file !== ROOT) {
        res.writeHead(403);
        res.end("403");
        return;
    }
    fs.readFile(file, function (err, data) {
        if (err) {
            res.writeHead(404);
            res.end("404 - not found: " + pathname);
            return;
        }
        /* no-store: a re-trimmed / rebuilt sound or edited js shows up on the next reload */
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
        res.end(data);
    });
}).listen(PORT, function () {
    console.log("Clockling: http://127.0.0.1:" + PORT + "/clockling.html");
});
