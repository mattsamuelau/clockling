/* Clockling - settings for the clock and widget display.
 * showClock: hide the clock block (battle only).
 * landscape: horizontal battlefield (wider than tall) instead of vertical.
 */
var SETTINGS = {
    hour24: true,
    showSeconds: true,
    showClock: true,
    landscape: false,
    showHealthBars: true,
    unitCount: 10,
    unitSpeed: 1.0
};

/* Read web/widget preferences before the other modules initialise. */
(function () {
    try {
        var stored = JSON.parse(localStorage.getItem("clocklingSettings") || "{}");
        for (var key in stored) {
            if (SETTINGS[key] !== undefined) SETTINGS[key] = stored[key];
        }
    } catch (e) {}
})();

/* Browser preview overrides, for example ?sec=0&hour24=0. */
(function () {
    if (!window.location || !window.location.search) return;
    var parts = window.location.search.replace(/^\?/, "").split("&");
    for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        if (!kv[0]) continue;
        var v = decodeURIComponent(kv[1] || "");
        if (kv[0] === "units") SETTINGS.unitCount = parseInt(v, 10) || SETTINGS.unitCount;
        else if (kv[0] === "speed") SETTINGS.unitSpeed = parseFloat(v) || SETTINGS.unitSpeed;
        else if (kv[0] === "hour24") SETTINGS.hour24 = v === "1" || v === "true";
        else if (kv[0] === "sec") SETTINGS.showSeconds = v !== "0";
        else if (kv[0] === "landscape") SETTINGS.landscape = v === "1" || v === "true";
    }
})();
