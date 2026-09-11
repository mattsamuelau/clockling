/* Zerg Desk - clock, Tizen power/battery glue. ES5 for old Tizen WebKit. */
(function () {
    "use strict";

    var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var elTime, elSec, elDate, elCity, elBatt;
    var clockTimer = null;

    function pad(n) { return n < 10 ? "0" + n : String(n); }

    function tick() {
        var now = new Date();
        var net = TimeSync.now();
        var h, m, s, wd, d, mo;
        if (net) {
            /* internet-synced wall clock (watch system clock is intentionally 2021) */
            h = net.getUTCHours(); m = net.getUTCMinutes(); s = net.getUTCSeconds();
            wd = net.getUTCDay(); d = net.getUTCDate(); mo = net.getUTCMonth();
        } else {
            h = now.getHours(); m = now.getMinutes(); s = now.getSeconds();
            wd = now.getDay(); d = now.getDate(); mo = now.getMonth();
        }
        var hh = SETTINGS.hour24 ? h : (h % 12 === 0 ? 12 : h % 12);
        if (elTime) elTime.textContent = pad(hh) + ":" + pad(m);
        if (elSec) elSec.textContent = SETTINGS.showSeconds ? ":" + pad(s) : "";
        if (elDate) elDate.textContent = DAYS[wd] + " " + d + " " + MONTHS[mo];
    }

    function onBatteryChange(b) {
        if (!elBatt || !b) return;
        elBatt.textContent = "battery " + (b.isCharging ? "+ " : "") + Math.round(b.level * 100) + "%";
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
        elCity = document.getElementById("city");
        elBatt = document.getElementById("battery");
        if (elCity) elCity.textContent = SETTINGS.city || "";

        Swarm.init();
        Weather.init();
        TimeSync.init();
        tick();
        clockTimer = setInterval(tick, 500);

        if (window.tizen) {
            /* keep the screen on while the watch sits in its dock */
            try { tizen.power.request("SCREEN", "SCREEN_NORMAL"); } catch (e) {}
            try { tizen.power.setScreenStateChangeListener(onScreenState); } catch (e) {}
            try {
                tizen.systeminfo.getPropertyValue("BATTERY", onBatteryChange);
                tizen.systeminfo.addPropertyValueChangeListener("BATTERY", onBatteryChange);
            } catch (e) {
                if (elBatt) elBatt.textContent = "";
            }
        } else if (elBatt) {
            elBatt.textContent = "docked";
        }

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
