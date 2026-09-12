/* Clockling - clock and widget glue.
 * ES5-compatible so the shared core runs in any widget host. */
(function () {
    "use strict";

    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var elTime, elSec, elDate;
    var clockTimer = null;

    function pad(n) { return n < 10 ? "0" + n : String(n); }

    function tick() {
        var now = new Date();
        var h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
        var wd = now.getDay(), d = now.getDate(), mo = now.getMonth();
        var hh = SETTINGS.hour24 ? h : (h % 12 === 0 ? 12 : h % 12);
        if (elTime) elTime.textContent = pad(hh) + ":" + pad(m);
        if (elSec) elSec.textContent = SETTINGS.showSeconds ? ":" + pad(s) : "";
        if (elDate) elDate.textContent = DAYS[wd] + " " + d + " " + MONTHS[mo];
    }

    function onScreenState(prev, cur) {
        /* dimmed/off = park the animation to save battery */
        if (cur === "SCREEN_OFF") Swarm.stop();
        else Swarm.start();
    }

    function onVisibility() {
        if (document.hidden || document.webkitHidden) Swarm.stop();
        else Swarm.start();
    }

    function onTap(e) {
        /* kill only units near where the face was tapped */
        var x = 108, y = 216;
        if (e && typeof e.clientX === "number") {
            var c = document.getElementById("swarm");
            if (c && c.getBoundingClientRect) {
                var r = c.getBoundingClientRect();
                x = e.clientX - r.left;
                y = e.clientY - r.top;
            }
        }
        Swarm.killNear(x, y, 60);
    }

    function init() {
        elTime = document.getElementById("time");
        elSec = document.getElementById("sec");
        elDate = document.getElementById("date");

        /* Set canvas size from TUNING (allows responsive widget sizing). */
        var canvas = document.getElementById("swarm");
        if (canvas) {
            canvas.width = TUNING.mapW;
            canvas.height = TUNING.mapH;
        }

        Swarm.init();
        tick();
        clockTimer = setInterval(tick, 500);

        document.addEventListener("visibilitychange", onVisibility);
        document.addEventListener("webkitvisibilitychange", onVisibility);

        /* tap the face to splat units near the tap point */
        document.body.addEventListener("click", onTap);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
