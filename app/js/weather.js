/* Zerg Desk - weather via Open-Meteo (free, no API key).
 * ES5 + XHR on purpose for the old Tizen WebKit on Gear Fit 2.
 * WMO weather codes mapped to a label + a hand-drawn canvas icon.
 */
var Weather = (function () {
    "use strict";

    var iconCtx = null;
    var OK = false;

    function setText(id, v) {
        var el = document.getElementById(id);
        if (el) el.textContent = v;
    }

    function label(code) {
        if (code === 0) return "Clear";
        if (code === 1) return "Mostly clear";
        if (code === 2) return "Partly cloudy";
        if (code === 3) return "Overcast";
        if (code === 45 || code === 48) return "Fog";
        if (code >= 51 && code <= 57) return "Drizzle";
        if (code >= 61 && code <= 67) return "Rain";
        if (code >= 71 && code <= 77) return "Snow";
        if (code >= 80 && code <= 82) return "Showers";
        if (code === 85 || code === 86) return "Snow showers";
        if (code >= 95) return "Storm";
        return "Weather";
    }

    function drawSun(c, x, y, r) {
        c.strokeStyle = "#ffd75e";
        c.fillStyle = "#ffd75e";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x, y, r, 0, 6.28);
        c.fill();
        for (var i = 0; i < 8; i++) {
            var a = (i / 8) * 6.28;
            c.beginPath();
            c.moveTo(x + Math.cos(a) * (r + 2), y + Math.sin(a) * (r + 2));
            c.lineTo(x + Math.cos(a) * (r + 5), y + Math.sin(a) * (r + 5));
            c.stroke();
        }
    }

    function drawCloud(c, x, y, k) {
        c.fillStyle = "#cfd6e4";
        c.beginPath();
        c.arc(x, y, k * 6, 0, 6.28);
        c.arc(x + k * 5, y - k * 1.5, k * 4.5, 0, 6.28);
        c.arc(x - k * 5, y - k, k * 4, 0, 6.28);
        c.arc(x + k * 1.5, y - k * 2.5, k * 4.8, 0, 6.28);
        c.fill();
    }

    function drawIcon(code) {
        if (!iconCtx) return;
        var c = iconCtx;
        c.clearRect(0, 0, 41, 41);
        c.scale(1.2, 1.2);   /* icon drawn on a 34-unit grid, shown 20% larger */
        c.lineCap = "round";
        c.lineJoin = "round";

        var sun = code === 0 || code === 1;
        var cloud = code >= 2;
        var rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
        var snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
        var storm = code >= 95;
        var fog = code === 45 || code === 48;

        if (fog) {
            drawCloud(c, 17, 20, 0.8);
            c.strokeStyle = "#b9c2d6";
            c.lineWidth = 1.6;
            for (var f = 0; f < 3; f++) {
                c.beginPath();
                c.moveTo(8, 26 + f * 3);
                c.lineTo(26, 26 + f * 3);
                c.stroke();
            }
        } else if (storm) {
            drawCloud(c, 17, 15, 0.8);
            c.fillStyle = "#ffd75e";
            c.beginPath();
            c.moveTo(19, 19);
            c.lineTo(14, 27);
            c.lineTo(18, 27);
            c.lineTo(15, 33);
            c.lineTo(23, 23);
            c.lineTo(19, 23);
            c.closePath();
            c.fill();
        } else if (snow) {
            drawCloud(c, 17, 13, 0.8);
            c.fillStyle = "#ffffff";
            for (var n = 0; n < 4; n++) {
                c.beginPath();
                c.arc(9 + n * 5.5, 26 + (n % 2) * 3, 1.4, 0, 6.28);
                c.fill();
            }
        } else if (rain) {
            drawCloud(c, 17, 13, 0.8);
            c.strokeStyle = "#7cc7ff";
            c.lineWidth = 1.8;
            for (var r = 0; r < 3; r++) {
                c.beginPath();
                c.moveTo(11 + r * 6, 24);
                c.lineTo(9 + r * 6, 29);
                c.stroke();
            }
        } else if (cloud) {
            drawCloud(c, 18, 18, 0.9);
            if (code === 2) drawSun(c, 8, 8, 4);
        } else if (sun) {
            drawSun(c, 17, 17, 7);
        } else {
            /* code 3-ish generic cloud */
            drawCloud(c, 17, 17, 0.9);
        }
    }

    function offlineIcon() {
        if (!iconCtx) return;
        var c = iconCtx;
        c.clearRect(0, 0, 41, 41);
        c.scale(1.2, 1.2);
        c.strokeStyle = "#5b5277";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(17, 16, 8, 0, 6.28);
        c.stroke();
        c.beginPath();
        c.moveTo(8, 26);
        c.lineTo(26, 8);
        c.stroke();
    }

    function offline() {
        OK = false;
        setText("w-temp", "--\u00B0");
        setText("w-label", "no network");
        offlineIcon();
    }

    var lastWallMs = 0;
    var lastReceivedAt = 0;

    /* "2026-09-09T17:45" -> ms whose UTC fields equal that wall time
     * (same trick TimeSync uses, so both sources stay consistent) */
    function parseWall(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
        if (!m) return 0;
        return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    }

    /* Old Tizen WebKit can't do modern TLS -> HTTPS first, plain HTTP fallback */
    var attempts = ["https://", "http://"];

    function tryFetch(i) {
        if (i >= attempts.length) { offline(); return; }
        var url = attempts[i] + "api.open-meteo.com/v1/forecast" +
            "?latitude=" + SETTINGS.lat + "&longitude=" + SETTINGS.lon +
            "&current=temperature_2m,weather_code,relative_humidity_2m" +
            "&timezone=auto";
        var xhr = new XMLHttpRequest();
        try {
            xhr.open("GET", url, true);
        } catch (e) {
            tryFetch(i + 1);
            return;
        }
        xhr.timeout = 8000;
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200) {
                try {
                    var d = JSON.parse(xhr.responseText);
                    var cur = d.current;
                    setText("w-temp", Math.round(cur.temperature_2m) + "\u00B0");
                    setText("w-label", label(cur.weather_code));
                    drawIcon(cur.weather_code);
                    var wall = parseWall(cur.time);
                    if (wall) { lastWallMs = wall; lastReceivedAt = Date.now(); }
                    OK = true;
                } catch (e) {
                    offline();
                }
            } else {
                tryFetch(i + 1);
            }
        };
        xhr.onerror = function () { tryFetch(i + 1); };
        xhr.ontimeout = function () { tryFetch(i + 1); };
        try {
            xhr.send();
        } catch (e) {
            tryFetch(i + 1);
        }
    }

    function refresh() {
        tryFetch(0);
    }

    /* internet time derived from the weather reply (worldtimeapi fallback) */
    function lastTime() {
        if (!lastWallMs) return null;
        return new Date(lastWallMs + (Date.now() - lastReceivedAt));
    }

    function init() {
        var iconCanvas = document.getElementById("w-icon");
        if (iconCanvas && iconCanvas.getContext) {
            iconCanvas.width = 41;
            iconCanvas.height = 41;
            iconCtx = iconCanvas.getContext("2d");
        }
        refresh();
        setInterval(refresh, 30 * 60 * 1000);
    }

    return { init: init, refresh: refresh, ok: function () { return OK; }, lastTime: lastTime };
})();

/* Internet time: lets the watch face show the REAL time even though the
 * watch's own clock must stay in 2021 (keeps the expired certs installable).
 * Primary: worldtimeapi.org. Fallback: the clock inside the Open-Meteo reply
 * (works over plain HTTP, which the old watch TLS stack can handle). */
var TimeSync = (function () {
    "use strict";

    var unixtime = null;
    var utcOffset = 0;
    var receivedAt = 0;
    var OK = false;
    var fromWeather = false;

    /* worldtimeapi unreachable -> reuse the weather reply's clock */
    function useWeather() {
        var wt = Weather.lastTime();
        if (wt) {
            unixtime = wt.getTime(); /* UTC fields already equal wall clock */
            utcOffset = 0;
            receivedAt = Date.now();
            fromWeather = true;
            OK = true;
        } else {
            OK = false;
        }
    }

    function refresh() {
        var xhr = new XMLHttpRequest();
        try {
            xhr.open("GET", "https://worldtimeapi.org/api/ip", true);
        } catch (e) {
            useWeather();
            return;
        }
        xhr.timeout = 8000;
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;
            if (xhr.status === 200) {
                try {
                    var d = JSON.parse(xhr.responseText);
                    unixtime = d.unixtime;
                    utcOffset = parseInt(d.utc_offset, 10) || 0;
                    receivedAt = Date.now();
                    fromWeather = false;
                    OK = true;
                } catch (e) {
                    useWeather();
                }
            } else {
                useWeather();
            }
        };
        xhr.onerror = function () { useWeather(); };
        xhr.ontimeout = function () { useWeather(); };
        try { xhr.send(); } catch (e) { useWeather(); }
    }

    /* Returns a Date whose UTC fields are the correct wall-clock time */
    function now() {
        if (!OK) return null;
        return new Date(unixtime + utcOffset * 1000 + (Date.now() - receivedAt));
    }

    function init() {
        refresh();
        setInterval(refresh, 15 * 60 * 1000);
    }

    return {
        init: init, now: now,
        ok: function () { return OK; },
        fromWeather: function () { return fromWeather; }
    };
})();
