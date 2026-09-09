/* Zero-dependency local preview server.
 * Usage: node server.js  ->  http://127.0.0.1:8080/preview.html
 * (Alternative: python -m http.server)
 */
var http = require("http");
var fs = require("fs");
var path = require("path");

var PORT = 8080;
var ROOT = __dirname;
var TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".json": "application/json"
};

http.createServer(function (req, res) {
    var pathname = decodeURIComponent(req.url.split("?")[0]);
    if (pathname === "/") pathname = "/preview.html";
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
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(data);
    });
}).listen(PORT, function () {
    console.log("Zerg Desk preview: http://127.0.0.1:" + PORT + "/preview.html");
});
