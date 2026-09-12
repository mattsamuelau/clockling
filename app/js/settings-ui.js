/* Clockling - Settings UI controller.
 * Handles building the settings panel, saving/reverting, and persistence.
 */

var SettingsUI = (function () {
    "use strict";

    var STORAGE_KEY = "clocklingSettings";
    var STORAGE_TUNING_KEY = "clocklingTuning";

    /* Load settings from localStorage, merge with defaults. */
    function loadSettings() {
        var stored = {};
        try {
            var json = localStorage.getItem(STORAGE_KEY);
            if (json) stored = JSON.parse(json);
        } catch (e) {}
        
        /* Merge SETTINGS defaults (from settings.js) with stored values. */
        var merged = {};
        if (TUNING_META && TUNING_META.settings) {
            for (var key in TUNING_META.settings) {
                merged[key] = stored[key] !== undefined ? stored[key] : TUNING_META.settings[key].default;
            }
        }
        if (SETTINGS) {
            for (var k in SETTINGS) {
                if (merged[k] === undefined) merged[k] = SETTINGS[k];
            }
        }
        return merged;
    }

    /* Load TUNING from localStorage, merge with defaults. */
    function loadTuning() {
        var stored = {};
        try {
            var json = localStorage.getItem(STORAGE_TUNING_KEY);
            if (json) stored = JSON.parse(json);
        } catch (e) {}
        
        /* Merge TUNING defaults (from tuning-meta.js) with stored values. */
        var merged = {};
        if (TUNING_META && TUNING_META.tuning) {
            for (var key in TUNING_META.tuning) {
                merged[key] = stored[key] !== undefined ? stored[key] : TUNING_META.tuning[key].default;
            }
        }
        if (TUNING) {
            for (var k in TUNING) {
                if (merged[k] === undefined) merged[k] = TUNING[k];
            }
        }
        return merged;
    }

    /* Save settings to localStorage and update the global SETTINGS object. */
    function saveSettings(settingsObj) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settingsObj));
            /* Update global SETTINGS object. */
            if (SETTINGS) {
                for (var key in settingsObj) {
                    SETTINGS[key] = settingsObj[key];
                }
            }
        } catch (e) {
            console.error("Failed to save settings:", e);
        }
    }

    /* Save TUNING to localStorage and update the global TUNING object. */
    function saveTuning(tuningObj) {
        try {
            localStorage.setItem(STORAGE_TUNING_KEY, JSON.stringify(tuningObj));
            /* Update global TUNING object. */
            if (TUNING) {
                for (var key in tuningObj) {
                    TUNING[key] = tuningObj[key];
                }
            }
        } catch (e) {
            console.error("Failed to save tuning:", e);
        }
    }

    /* Revert a single setting to its default. */
    function revertSetting(key) {
        if (!TUNING_META.settings[key]) return;
        var current = loadSettings();
        current[key] = TUNING_META.settings[key].default;
        saveSettings(current);
    }

    /* Revert a single tuning value to its default. */
    function revertTuning(key) {
        if (!TUNING_META.tuning[key]) return;
        var current = loadTuning();
        current[key] = TUNING_META.tuning[key].default;
        saveTuning(current);
    }

    /* Reset all settings to defaults. */
    function resetAllSettings() {
        var defaults = {};
        if (TUNING_META.settings) {
            for (var key in TUNING_META.settings) {
                defaults[key] = TUNING_META.settings[key].default;
            }
        }
        saveSettings(defaults);
    }

    /* Reset all tuning to defaults. */
    function resetAllTuning() {
        var defaults = {};
        if (TUNING_META.tuning) {
            for (var key in TUNING_META.tuning) {
                defaults[key] = TUNING_META.tuning[key].default;
            }
        }
        saveTuning(defaults);
    }

    return {
        loadSettings: loadSettings,
        loadTuning: loadTuning,
        saveSettings: saveSettings,
        saveTuning: saveTuning,
        revertSetting: revertSetting,
        revertTuning: revertTuning,
        resetAllSettings: resetAllSettings,
        resetAllTuning: resetAllTuning
    };
})();
