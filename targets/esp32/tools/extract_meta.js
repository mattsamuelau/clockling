/* Evaluate the web app's settings.js / tuning-meta.js / swarm.js in a stubbed
 * sandbox and print {tuning, settings, meta} as JSON, so the ESP32 build takes
 * its defaults straight from the web preview (single source of truth). */
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const root = path.resolve(__dirname, "../../..");
const ctx = {
    window: { location: { search: "" } },
    localStorage: { getItem: () => null, setItem() {} },
    document: {},
    setTimeout, clearTimeout, console
};
vm.createContext(ctx);
for (const f of ["app/js/settings.js", "app/js/tuning-meta.js", "app/js/swarm.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, f), "utf8"), ctx, { filename: f });
}
process.stdout.write(JSON.stringify({
    tuning: ctx.Swarm.TUNING,
    settings: ctx.SETTINGS,
    meta: ctx.TUNING_META
}));
