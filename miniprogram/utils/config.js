"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONFIG = exports.AUTO_RETRY_UNLOCK_TIMEOUT_DEFAULT = exports.AUTO_RETRY_UNLOCK_TIMEOUT_MAX = exports.AUTO_RETRY_UNLOCK_TIMEOUT_MIN = exports.AUTO_RETRY_UNLOCK_COUNT_DEFAULT = exports.AUTO_RETRY_UNLOCK_COUNT_MAX = exports.AUTO_RETRY_UNLOCK_COUNT_MIN = void 0;
exports.createEmptyDoorConfig = createEmptyDoorConfig;
exports.readDoorConfigList = readDoorConfigList;
exports.readDoorConfig = readDoorConfig;
exports.saveDoorConfig = saveDoorConfig;
exports.deleteDoorConfig = deleteDoorConfig;
exports.setActiveDoorConfig = setActiveDoorConfig;
exports.readLogPreference = readLogPreference;
exports.saveLogPreference = saveLogPreference;
exports.readQuickUnlockPreference = readQuickUnlockPreference;
exports.saveQuickUnlockPreference = saveQuickUnlockPreference;
exports.readAndroidCompatPreference = readAndroidCompatPreference;
exports.saveAndroidCompatPreference = saveAndroidCompatPreference;
exports.normalizeAutoRetryUnlockCount = normalizeAutoRetryUnlockCount;
exports.normalizeAutoRetryUnlockTimeout = normalizeAutoRetryUnlockTimeout;
exports.readAutoRetryUnlockPreference = readAutoRetryUnlockPreference;
exports.saveAutoRetryUnlockPreference = saveAutoRetryUnlockPreference;
exports.readAutoRetryUnlockCountPreference = readAutoRetryUnlockCountPreference;
exports.readAutoRetryUnlockTimeoutPreference = readAutoRetryUnlockTimeoutPreference;
exports.saveAutoRetryUnlockCountPreference = saveAutoRetryUnlockCountPreference;
exports.saveAutoRetryUnlockTimeoutPreference = saveAutoRetryUnlockTimeoutPreference;
const CONFIG_STORAGE_KEY = 'doorConfig';
const LOG_PREF_STORAGE_KEY = 'doorLogEnabled';
const QUICK_UNLOCK_PREF_STORAGE_KEY = 'quickUnlockEnabled';
const AUTO_RETRY_UNLOCK_PREF_STORAGE_KEY = 'autoRetryUnlockEnabled';
const AUTO_RETRY_UNLOCK_COUNT_STORAGE_KEY = 'autoRetryUnlockCount';
const AUTO_RETRY_UNLOCK_TIMEOUT_STORAGE_KEY = 'autoRetryUnlockTimeout';
const ANDROID_COMPAT_PREF_STORAGE_KEY = 'androidCompatModeEnabled';
const MAC_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
const KEY_PATTERN = /^[0-9A-F]+$/;
exports.AUTO_RETRY_UNLOCK_COUNT_MIN = 1;
exports.AUTO_RETRY_UNLOCK_COUNT_MAX = 99;
exports.AUTO_RETRY_UNLOCK_COUNT_DEFAULT = 8;
exports.AUTO_RETRY_UNLOCK_TIMEOUT_MIN = 3;
exports.AUTO_RETRY_UNLOCK_TIMEOUT_MAX = 60;
exports.AUTO_RETRY_UNLOCK_TIMEOUT_DEFAULT = 10;
const DEFAULT_STATE = {
    version: 2,
    currentId: null,
    items: []
};
function createEmptyDoorConfig(partial = {}) {
    return {
        id: partial.id,
        doorName: (partial.doorName || '').trim(),
        mac: (partial.mac || '').toUpperCase(),
        key: (partial.key || '').toUpperCase(),
        bluetoothName: (partial.bluetoothName || '').toUpperCase(),
        logEnabled: typeof partial.logEnabled === 'boolean' ? partial.logEnabled : false
    };
}
exports.DEFAULT_CONFIG = createEmptyDoorConfig();
function generateId() {
    return `door_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function sanitizeStoredConfig(input) {
    const base = createEmptyDoorConfig(input);
    return {
        ...base,
        id: input.id && typeof input.id === 'string' ? input.id : generateId()
    };
}
function isUsableStoredConfig(config) {
    const mac = (config.mac || '').trim().toUpperCase();
    const key = (config.key || '').trim().toUpperCase();
    return (MAC_PATTERN.test(mac) &&
        key.length >= 16 &&
        key.length <= 32 &&
        key.length % 2 === 0 &&
        KEY_PATTERN.test(key));
}
function migrateState(raw) {
    if (!raw) {
        return { ...DEFAULT_STATE };
    }
    if (typeof raw === 'object' && raw.version === 2 && Array.isArray(raw.items)) {
        const items = raw.items
            .map((item) => sanitizeStoredConfig(item))
            .filter((item) => isUsableStoredConfig(item));
        const currentId = typeof raw.currentId === 'string' && items.some((item) => item.id === raw.currentId)
            ? raw.currentId
            : items.length ? items[0].id : null;
        return {
            version: 2,
            currentId,
            items
        };
    }
    if (typeof raw === 'object') {
        const legacy = sanitizeStoredConfig(raw);
        if (!isUsableStoredConfig(legacy)) {
            return { ...DEFAULT_STATE };
        }
        return {
            version: 2,
            currentId: legacy.id,
            items: [legacy]
        };
    }
    return { ...DEFAULT_STATE };
}
function readState() {
    try {
        const raw = wx.getStorageSync(CONFIG_STORAGE_KEY);
        const state = migrateState(raw);
        if (state !== raw) {
            writeState(state);
        }
        return state;
    }
    catch (err) {
        console.warn('[config] 读取配置失败，将返回默认状态', err);
        return { ...DEFAULT_STATE };
    }
}
function writeState(state) {
    wx.setStorageSync(CONFIG_STORAGE_KEY, state);
}
function ensureActive(state) {
    if (state.items.length === 0) {
        return { ...state, currentId: null };
    }
    if (state.currentId && state.items.some((item) => item.id === state.currentId)) {
        return state;
    }
    return { ...state, currentId: state.items[0].id };
}
function readDoorConfigList() {
    const state = readState();
    return state.items.slice();
}
function readDoorConfig() {
    const state = ensureActive(readState());
    if (!state.currentId) {
        return createEmptyDoorConfig();
    }
    const active = state.items.find((item) => item.id === state.currentId);
    return active ? { ...active } : createEmptyDoorConfig();
}
function saveDoorConfig(config) {
    const state = readState();
    const normalized = sanitizeStoredConfig(config);
    const index = state.items.findIndex((item) => item.id === normalized.id);
    if (index >= 0) {
        state.items[index] = normalized;
    }
    else {
        state.items.push(normalized);
    }
    state.currentId = normalized.id;
    writeState(ensureActive(state));
    return normalized;
}
function deleteDoorConfig(id) {
    const state = readState();
    const filtered = state.items.filter((item) => item.id !== id);
    if (filtered.length === state.items.length) {
        return;
    }
    const nextState = ensureActive({
        version: 2,
        currentId: state.currentId === id ? null : state.currentId,
        items: filtered
    });
    writeState(nextState);
}
function setActiveDoorConfig(id) {
    const state = readState();
    if (!state.items.some((item) => item.id === id)) {
        return readDoorConfig();
    }
    state.currentId = id;
    writeState(state);
    const active = state.items.find((item) => item.id === id);
    return active ? { ...active } : createEmptyDoorConfig();
}
function readLogPreference() {
    try {
        const stored = wx.getStorageSync(LOG_PREF_STORAGE_KEY);
        if (typeof stored === 'boolean') {
            return stored;
        }
    }
    catch (err) {
        console.warn('[config] 读取日志偏好失败', err);
    }
    try {
        const active = readDoorConfig();
        return active.logEnabled === true;
    }
    catch (err) {
        return false;
    }
}
function saveLogPreference(enabled) {
    try {
        wx.setStorageSync(LOG_PREF_STORAGE_KEY, !!enabled);
    }
    catch (err) {
        console.warn('[config] 保存日志偏好失败', err);
    }
}
function readQuickUnlockPreference() {
    try {
        const stored = wx.getStorageSync(QUICK_UNLOCK_PREF_STORAGE_KEY);
        if (typeof stored === 'boolean') {
            return stored;
        }
    }
    catch (err) {
        console.warn('[config] 读取快速开锁偏好失败', err);
    }
    return false;
}
function saveQuickUnlockPreference(enabled) {
    try {
        wx.setStorageSync(QUICK_UNLOCK_PREF_STORAGE_KEY, !!enabled);
    }
    catch (err) {
        console.warn('[config] 保存快速开锁偏好失败', err);
    }
}
function readAndroidCompatPreference() {
    try {
        const stored = wx.getStorageSync(ANDROID_COMPAT_PREF_STORAGE_KEY);
        if (typeof stored === 'boolean') {
            return stored;
        }
    }
    catch (err) {
        console.warn('[config] 读取安卓兼容模式偏好失败', err);
    }
    return false;
}
function saveAndroidCompatPreference(enabled) {
    try {
        wx.setStorageSync(ANDROID_COMPAT_PREF_STORAGE_KEY, !!enabled);
    }
    catch (err) {
        console.warn('[config] 保存安卓兼容模式偏好失败', err);
    }
}
function normalizeAutoRetryUnlockCount(count) {
    if (count === null || typeof count === 'undefined') {
        return exports.AUTO_RETRY_UNLOCK_COUNT_DEFAULT;
    }
    if (typeof count === 'string' && !count.trim()) {
        return exports.AUTO_RETRY_UNLOCK_COUNT_DEFAULT;
    }
    const value = typeof count === 'number' ? count : Number(count);
    if (!Number.isFinite(value)) {
        return exports.AUTO_RETRY_UNLOCK_COUNT_DEFAULT;
    }
    const intCount = Math.floor(value);
    if (intCount < exports.AUTO_RETRY_UNLOCK_COUNT_MIN) {
        return exports.AUTO_RETRY_UNLOCK_COUNT_MIN;
    }
    if (intCount > exports.AUTO_RETRY_UNLOCK_COUNT_MAX) {
        return exports.AUTO_RETRY_UNLOCK_COUNT_MAX;
    }
    return intCount;
}
function normalizeAutoRetryUnlockTimeout(timeout) {
    if (timeout === null || typeof timeout === 'undefined') {
        return exports.AUTO_RETRY_UNLOCK_TIMEOUT_DEFAULT;
    }
    if (typeof timeout === 'string' && !timeout.trim()) {
        return exports.AUTO_RETRY_UNLOCK_TIMEOUT_DEFAULT;
    }
    const value = typeof timeout === 'number' ? timeout : Number(timeout);
    if (!Number.isFinite(value)) {
        return exports.AUTO_RETRY_UNLOCK_TIMEOUT_DEFAULT;
    }
    const intValue = Math.floor(value);
    if (intValue < exports.AUTO_RETRY_UNLOCK_TIMEOUT_MIN) {
        return exports.AUTO_RETRY_UNLOCK_TIMEOUT_MIN;
    }
    if (intValue > exports.AUTO_RETRY_UNLOCK_TIMEOUT_MAX) {
        return exports.AUTO_RETRY_UNLOCK_TIMEOUT_MAX;
    }
    return intValue;
}
function readAutoRetryUnlockPreference() {
    try {
        const stored = wx.getStorageSync(AUTO_RETRY_UNLOCK_PREF_STORAGE_KEY);
        if (typeof stored === 'boolean') {
            return stored;
        }
    }
    catch (err) {
        console.warn('[config] 读取自动重发偏好失败', err);
    }
    return false;
}
function saveAutoRetryUnlockPreference(enabled) {
    try {
        wx.setStorageSync(AUTO_RETRY_UNLOCK_PREF_STORAGE_KEY, !!enabled);
    }
    catch (err) {
        console.warn('[config] 保存自动重发偏好失败', err);
    }
}
function readAutoRetryUnlockCountPreference() {
    try {
        const stored = wx.getStorageSync(AUTO_RETRY_UNLOCK_COUNT_STORAGE_KEY);
        return normalizeAutoRetryUnlockCount(stored);
    }
    catch (err) {
        console.warn('[config] 读取自动重发次数失败', err);
        return exports.AUTO_RETRY_UNLOCK_COUNT_DEFAULT;
    }
}
function readAutoRetryUnlockTimeoutPreference() {
    try {
        const stored = wx.getStorageSync(AUTO_RETRY_UNLOCK_TIMEOUT_STORAGE_KEY);
        return normalizeAutoRetryUnlockTimeout(stored);
    }
    catch (err) {
        console.warn('[config] 读取自动重发超时失败', err);
        return exports.AUTO_RETRY_UNLOCK_TIMEOUT_DEFAULT;
    }
}
function saveAutoRetryUnlockCountPreference(count) {
    const normalized = normalizeAutoRetryUnlockCount(count);
    try {
        wx.setStorageSync(AUTO_RETRY_UNLOCK_COUNT_STORAGE_KEY, normalized);
    }
    catch (err) {
        console.warn('[config] 保存自动重发次数失败', err);
    }
    return normalized;
}
function saveAutoRetryUnlockTimeoutPreference(timeout) {
    const normalized = normalizeAutoRetryUnlockTimeout(timeout);
    try {
        wx.setStorageSync(AUTO_RETRY_UNLOCK_TIMEOUT_STORAGE_KEY, normalized);
    }
    catch (err) {
        console.warn('[config] 保存自动重发超时失败', err);
    }
    return normalized;
}
