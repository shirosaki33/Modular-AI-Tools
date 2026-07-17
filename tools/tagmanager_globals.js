/* =========================================================================
   GLOBAL STATE & VARIABLES
   Centralizes state to be shared across multiple modules.
========================================================================= */

var showGhostTagsInList = false;

var _hiddenImagesStoreMap = new Map();
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
var sub1Handles = new Map();
var sub2Handles = new Map();
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

var showDanbooruCounts = false;
var danbooruCache = {};

var showE621 = false;
var showE621Sfw = false;

window.formatDbCount = function(num) {
    if(num >= 1000) return (num / 1000).toFixed(1).replace('.0', '') + 'k';
    return num;
};