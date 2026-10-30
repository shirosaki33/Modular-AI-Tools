/* =========================================================================
   GLOBAL STATE & VARIABLES
   Centralizes state to be shared across multiple modules.
========================================================================= */

var showGhostTagsInList = false;

var _hiddenImagesStoreMap = new WeakMap();
var _defaultHiddenSet = new Set();
function getHiddenSetForHandle(handle) {
    if (!handle) return _defaultHiddenSet;
    if (!_hiddenImagesStoreMap.has(handle)) _hiddenImagesStoreMap.set(handle, new Set());
    return _hiddenImagesStoreMap.get(handle);
}
Object.defineProperty(window, 'hiddenImagesStore', {
    get() { return getHiddenSetForHandle(window.currentImagesHandle); },
    configurable: true
});

var sortedActiveTags = [];
var rootHandle = null;
var rootHandleKey = null; // key under which rootHandle is saved in the "Saved directories" list (null = not saved)
var sub1Handles = new Map();
var sub2Handles = new Map();
var sub3Handles = new Map();
var currentImagesHandle = null;

var imageFiles = [];
var selectedIndices = new Set();

var masterTagSet = new Set();
var masterSelectedTags = new Set();
var masterSelectedGhostTags = new Set();
var activeSelectedTags = new Set();

var datasetConfig = {};
var pendingTagsStore = {};
var filterMode = 'NONE';

var imageNameFilter = '';
var tagNameFilter = '';
var presetTagNameFilter = '';

var activeSearchMode = true;
var masterSearchMode = true;
var presetSearchMode = true;
var imageFilterMode = 'ALL';

var presetSelectedTags = new Set();
var lastSelectedPresetIndex = 0;
var lastSelectedIndex = 0;
var replaceScope = 'active';
var _thumbSizeRAF = null;

// Selection / drag state used by the editor and the master list.
// They were implicit globals before (created on first assignment), which
// breaks in strict mode and made "typeof x" checks unreliable.
var draggedTagIndex = null;
var lastSelectedActiveTagIndex = null;
var lastSelectedMasterTagIndex = null;
var lastSelectedGhostTagIndex = null;

var showDanbooruCounts = true;
var danbooruCache = {};

// e621 suggestions toggle was removed from Settings; counts from e621 are
// still merged automatically (see pickBestTagCount in tagmanager_e621_core.js).
var showE621 = false;
var showE621Sfw = false;

// Same rule used by every module: served by server_max.py on this machine.
var MAT_IS_LOCAL = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
window.MAT_IS_LOCAL = MAT_IS_LOCAL;

window.formatDbCount = function(num) {
    if(num >= 1000) return (num / 1000).toFixed(1).replace('.0', '') + 'k';
    return num;
};

// HTML escaping helper (also defined in tagmanager_alert.js; whichever loads first wins).
if (typeof window.escHTML !== 'function') {
    window.escHTML = function (value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"'`]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[ch]));
    };
}
