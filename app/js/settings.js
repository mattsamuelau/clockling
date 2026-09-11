/* Zerg Desk - edit me!
 * lat/lon: your town's coordinates (weather comes from Open-Meteo, no API key).
 * critterCount: how many bugs scurry around (watch is slow: keep it under ~14).
 */
var SETTINGS = {
    lat: 51.5074,        /* London */
    lon: -0.1278,
    city: "London",
    hour24: true,
    showSeconds: true,
    critterCount: 10,
    critterSpeed: 1.0
};

/* Browser-preview only: preview.html passes overrides via URL, e.g.
 * app/index.html?critters=25&speed=2&sec=0&hour24=0&city=Tokyo */
(function () {
    if (!window.location || !window.location.search) return;
    var parts = window.location.search.replace(/^\?/, "").split("&");
    for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        if (!kv[0]) continue;
        var v = decodeURIComponent(kv[1] || "");
        if (kv[0] === "critters") SETTINGS.critterCount = parseInt(v, 10) || SETTINGS.critterCount;
        else if (kv[0] === "speed") SETTINGS.critterSpeed = parseFloat(v) || SETTINGS.critterSpeed;
        else if (kv[0] === "lat") SETTINGS.lat = parseFloat(v) || SETTINGS.lat;
        else if (kv[0] === "lon") SETTINGS.lon = parseFloat(v) || SETTINGS.lon;
        else if (kv[0] === "city") SETTINGS.city = v;
        else if (kv[0] === "hour24") SETTINGS.hour24 = v === "1" || v === "true";
        else if (kv[0] === "sec") SETTINGS.showSeconds = v !== "0";
    }
})();
