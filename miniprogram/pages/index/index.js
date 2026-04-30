"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lockBiz_1 = require("../../utils/lockBiz");
const bleProtocol_1 = require("../../utils/bleProtocol");
const config_1 = require("../../utils/config");
const configView_1 = require("../../utils/configView");
const SERVICE_CANDIDATES = [
    '0734594a-a8e7-4b1a-a6b1-cd5243059a57',
    '14839ac4-7d7e-415c-9a42-167340cf2339'
];
const DISCOVERY_TIMEOUT = 10000;
const READ_TIMEOUT = 5000;
const USER_ACK_TIMEOUT = 3500;
const FLOW_TIMEOUT = 45000;
const PREWARM_SCAN_DURATION = 600;
const LAST_DEVICE_STORAGE_KEY = 'lastDoorDeviceMap';
const PARAMS_HIDDEN_STORAGE_KEY = 'indexParamsHidden';
const LOG_MAX_LINES = 80;
const LOG_PREVIEW_HEX_LENGTH = 64;
const LOG_EMPTY_VIEWPORT_HEIGHT = 150;
const LOG_MIN_VIEWPORT_HEIGHT = 176;
const LOG_VIEWPORT_VERTICAL_PADDING = 74;
const LOG_LINE_VIEWPORT_HEIGHT = 39;
const LOG_MAX_VIEWPORT_HEIGHT = 320;
const LOG_STATUS_MAX_LENGTH = 16;
const FLOW_ABORT_MESSAGE = 'flow aborted';
const FLOW_ABORT_DISPLAY_MESSAGE = '已中断当前开锁流程';
const MASK_CHAR = '＊';
const MASK_PAIR = `${MASK_CHAR}${MASK_CHAR}`;
let quickUnlockSessionUsed = false;
function callWx(fn, options = {}) {
    return new Promise((resolve, reject) => {
        try {
            fn({
                ...options,
                success: (res) => resolve(res),
                fail: (err) => reject(err)
            });
        }
        catch (error) {
            reject(error);
        }
    });
}
function pad(num) {
    return num.toString().padStart(2, '0');
}
function padMs(num) {
    return num.toString().padStart(3, '0');
}
function previewHex(hex, maxLength = LOG_PREVIEW_HEX_LENGTH) {
    if (!hex) {
        return '';
    }
    return hex.length > maxLength ? `${hex.slice(0, maxLength)}...` : hex;
}
function readSystemInfo() {
    const wxAny = wx;
    try {
        if (typeof wxAny.getSystemInfoSync === 'function') {
            return wxAny.getSystemInfoSync() || {};
        }
    }
    catch (err) {
        console.warn('[debug] 读取系统信息失败', err);
    }
    return {};
}
function readDeviceInfo() {
    const wxAny = wx;
    try {
        if (typeof wxAny.getDeviceInfo === 'function') {
            return wxAny.getDeviceInfo() || {};
        }
    }
    catch (err) {
        console.warn('[debug] 读取设备信息失败', err);
    }
    return {};
}
function readAppBaseInfo() {
    const wxAny = wx;
    try {
        if (typeof wxAny.getAppBaseInfo === 'function') {
            return wxAny.getAppBaseInfo() || {};
        }
    }
    catch (err) {
        console.warn('[debug] 读取小程序信息失败', err);
    }
    return {};
}
function formatError(err) {
    if (!err) {
        return 'unknown';
    }
    if (typeof err === 'string') {
        return err;
    }
    const obj = err;
    const code = typeof obj.errCode !== 'undefined' ? `code=${obj.errCode}` : '';
    const msg = typeof obj.errMsg === 'string' ? `msg=${obj.errMsg}` : '';
    const message = typeof obj.message === 'string' ? `message=${obj.message}` : '';
    const merged = [code, msg, message].filter(Boolean).join(' ');
    if (merged) {
        return merged;
    }
    try {
        return JSON.stringify(err);
    }
    catch (_jsonErr) {
        return String(err);
    }
}
function normalizeMacForCompare(mac) {
    return mac.replace(/[^0-9A-F]/g, '').toUpperCase();
}
function readDeviceCache() {
    try {
        const raw = wx.getStorageSync(LAST_DEVICE_STORAGE_KEY);
        if (raw && typeof raw === 'object') {
            return { ...raw };
        }
    }
    catch (err) {
        console.warn('[BLE] 读取缓存设备信息失败', err);
    }
    return {};
}
function writeDeviceCache(map) {
    try {
        wx.setStorageSync(LAST_DEVICE_STORAGE_KEY, map);
    }
    catch (err) {
        console.warn('[BLE] 写入缓存设备信息失败', err);
    }
}
function readParamsHiddenPreference() {
    try {
        return !!wx.getStorageSync(PARAMS_HIDDEN_STORAGE_KEY);
    }
    catch (err) {
        console.warn('[index] failed to read params hidden preference', err);
        return false;
    }
}
function writeParamsHiddenPreference(hidden) {
    try {
        wx.setStorageSync(PARAMS_HIDDEN_STORAGE_KEY, !!hidden);
    }
    catch (err) {
        console.warn('[index] failed to save params hidden preference', err);
    }
}
function getDoorCacheKey(config) {
    if (config && config.id) {
        return `id:${config.id}`;
    }
    const mac = config && typeof config.mac === 'string' ? config.mac.trim() : '';
    if (mac) {
        return `mac:${normalizeMacForCompare(mac)}`;
    }
    return '';
}
function readCachedDeviceId(config) {
    const key = getDoorCacheKey(config);
    if (!key) {
        return null;
    }
    const map = readDeviceCache();
    return typeof map[key] === 'string' ? map[key] : null;
}
function cacheDeviceId(config, deviceId) {
    const key = getDoorCacheKey(config);
    if (!key || !deviceId) {
        return;
    }
    const map = readDeviceCache();
    map[key] = deviceId;
    writeDeviceCache(map);
}
function removeCachedDeviceId(config) {
    const key = getDoorCacheKey(config);
    if (!key) {
        return;
    }
    const map = readDeviceCache();
    if (map[key]) {
        delete map[key];
        writeDeviceCache(map);
    }
}
function deriveHeaderFromMac(mac) {
    const segments = mac.toUpperCase().split(':').filter(Boolean);
    if (segments.length === 6) {
        return segments.slice(2).map((segment) => parseInt(segment, 16));
    }
    const compact = mac.replace(/[^0-9A-F]/gi, '').toUpperCase();
    if (compact.length === 12) {
        const bytes = [];
        for (let i = 0; i < 12; i += 2) {
            bytes.push(parseInt(compact.substr(i, 2), 16));
        }
        return bytes.slice(2);
    }
    throw new Error('MAC 地址格式不合法，无法生成握手标识');
}
function reverseMacHex(mac) {
    const pairs = [];
    for (let i = mac.length; i > 0; i -= 2) {
        pairs.push(mac.substring(i - 2, i));
    }
    return pairs.join('');
}
function asciiToHex(text) {
    return Array.from(text)
        .map((char) => char.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}
function createBleState() {
    return {
        handshakeSent: false,
        handshakeOk: false,
        randomSeedHex: '',
        commKeyRequested: false,
        communicateBuffer: '',
        timeSyncBuffer: '',
        cardSyncBuffer: '',
        tempCommKey: '',
        openAckHandled: false
    };
}
function createLogStatusState(text = '等待日志', tone = 'idle', pulse = false) {
    return { text, tone, pulse };
}
function buildLogStatusPatch(status) {
    return {
        logStatusText: status.text,
        logStatusTone: status.tone,
        logStatusPulse: status.pulse
    };
}
function updateBleState(page, patch) {
    const current = page && page.data && page.data.ble ? page.data.ble : (createBleState());
    const next = { ...current, ...patch };
    page.setData({ ble: next });
    return next;
}
function resolvePlatformInfo() {
    const wxAny = wx;
    const readers = [
        () => (typeof wxAny.getAppBaseInfo === 'function' ? wxAny.getAppBaseInfo() : null),
        () => (typeof wxAny.getDeviceInfo === 'function' ? wxAny.getDeviceInfo() : null),
        () => (typeof wxAny.getWindowInfo === 'function' ? wxAny.getWindowInfo() : null)
    ];
    for (const reader of readers) {
        try {
            const info = reader();
            const platform = info && typeof info.platform === 'string' ? info.platform.trim() : '';
            if (platform) {
                const lower = platform.toLowerCase();
                return { platform: lower, isDevtools: lower === 'devtools' };
            }
        }
        catch (err) {
            console.debug('[index] 读取平台信息失败', err);
        }
    }
    return { platform: '', isDevtools: false };
}
Page({
    data: {
        form: (0, configView_1.normalizeConfigForForm)(config_1.DEFAULT_CONFIG),
        state: {
            loading: false,
            message: '',
            previewMessage: '',
            statusTone: 'normal'
        },
        canSubmit: false,
        logs: [],
        consoleSync: false,
        logViewportHeight: LOG_EMPTY_VIEWPORT_HEIGHT,
        logScrollTop: 0,
        logStatusText: '等待日志',
        logStatusTone: 'idle',
        logStatusPulse: false,
        configs: [],
        configNames: [],
        configOptions: [],
        selectedConfigIndex: 0,
        selectorOpen: false,
        ble: createBleState(),
        isIOS: false,
        paramsHidden: false,
        androidCompatEnabled: false,
        displayDoorName: '未命名门禁',
        displayMac: '未填写',
        displayKey: '未填写',
        displayBluetoothName: '未填写',
        quickUnlockEnabled: false,
        autoRetryUnlockEnabled: false,
        autoRetryUnlockCount: 8,
        autoRetryUnlockTimeout: 10,
        autoRetrying: false,
        disclaimerVisible: false,
        disclaimerCountdown: 0
    },
    onShow() {
        const self = this;
        self._quickUnlockTriggered = quickUnlockSessionUsed;
        const tabBar = self.getTabBar?.();
        if (tabBar && typeof tabBar.setSelected === 'function') {
            tabBar.setSelected(0);
        }
        else if (tabBar && typeof tabBar.setData === 'function') {
            tabBar.setData({ selected: 0, selectedPath: '/pages/index/index' });
        }
        this.refreshConfig();
        if (this.data.disclaimerVisible && this.data.disclaimerCountdown > 0 && !this._disclaimerTimer) {
            this.startDisclaimerCountdown();
        }
    },
    onTabReselect() {
        this.setData({ selectorOpen: false });
        this.refreshConfig();
        if (typeof wx.pageScrollTo === 'function') {
            wx.pageScrollTo({
                scrollTop: 0,
                duration: 220
            });
        }
    },
    showDisclaimer() {
        this.clearDisclaimerTimer();
        this.setData({ disclaimerVisible: true, disclaimerCountdown: 10 });
        this.startDisclaimerCountdown();
    },
    startDisclaimerCountdown() {
        const tick = () => {
            const current = this.data.disclaimerCountdown;
            if (current <= 1) {
                this.setData({ disclaimerCountdown: 0 });
                this.clearDisclaimerTimer();
                return;
            }
            this.setData({ disclaimerCountdown: current - 1 });
        };
        const timer = setInterval(tick, 1000);
        this._disclaimerTimer = timer;
    },
    clearDisclaimerTimer() {
        const timer = this._disclaimerTimer;
        if (typeof timer === 'number') {
            clearInterval(timer);
            this._disclaimerTimer = undefined;
        }
    },
    onDisclaimerConfirm() {
        if (this.data.disclaimerCountdown > 0) {
            return;
        }
        this.clearDisclaimerTimer();
        wx.setStorageSync('globalDisclaimerAccepted', true);
        wx.setStorageSync('guideDisclaimerAccepted', true);
        this.setData({ disclaimerVisible: false }, () => {
            wx.switchTab?.({
                url: '/pages/guide/index',
                fail: () => {
                    wx.navigateTo({
                        url: '/pages/guide/index',
                        fail: () => {
                            wx.showToast({ title: '请从菜单进入帮助页', icon: 'none' });
                        }
                    });
                }
            });
        });
    },
    noop() { },
    onHide() {
        this.clearDisclaimerTimer();
    },
    async processBleNotification(hex, buffer) {
        const self = this;
        const bleState = (this.data.ble || createBleState());
        const header = hex.slice(0, 2).toUpperCase();
        const command = hex.length >= 6 ? hex.substr(4, 2).toUpperCase() : '';
        const tail = hex.slice(-2).toUpperCase();
        const type = hex.length >= 20 ? hex.substr(18, 2).toUpperCase() : '';
        this.addLog(`[通知解析] len=${Math.floor(hex.length / 2)}B header=${header || '--'} cmd=${command || '--'} type=${type || '--'} tail=${tail || '--'}`);
        const resolveAck = (payload = buffer) => {
            if (self._ackResolve) {
                const resolver = self._ackResolve;
                self._ackResolve = null;
                self._stage = 'idle';
                resolver(payload);
            }
        };
        if (header !== 'A5') {
            return;
        }
        if (command === '04') {
            this.clearAckTimer();
            const payloadLength = hex.length;
            const statusField = hex.substr(14, 4);
            const statusWord = `${statusField.substr(2, 2)}${statusField.substr(0, 2)}`.toUpperCase();
            const isHandshakeSuccess = payloadLength > 24;
            if (!isHandshakeSuccess) {
                const hint = statusWord === '000B' ? '（密钥或 SN 可能不匹配，设备拒绝握手）' : '';
                resolveAck(null);
                this.finalizeBleFlow(false, `握手失败，设备返回码 0x${statusWord}${hint}`);
                return;
            }
            updateBleState(this, { handshakeOk: true, handshakeSent: false });
            this.addLog('握手成功，已发送开锁指令');
            resolveAck(buffer);
            this.finalizeBleFlow(true, '握手成功，等待门锁执行');
            return;
        }
        if (command === '08') {
            resolveAck(null);
            const codeWord = hex.slice(-6, -2).toUpperCase();
            const hint = codeWord === 'E36F' ? '（门锁拒绝协商，通常是密钥或授权信息不匹配）' : '';
            this.finalizeBleFlow(false, `通讯密钥协商失败，设备返回码 0x${codeWord}${hint}`);
            return;
        }
        if (type === '87' && tail === '5A') {
            const result = (0, bleProtocol_1.decodeOpenResult)(hex, this.data.form.key);
            resolveAck(buffer);
            const success = result.code === '00' || result.code === '02';
            this.finalizeBleFlow(success, result.message);
            return;
        }
        if (!bleState.handshakeOk) {
            if (command === '04' && tail === '5A') {
                const codeHigh = hex.slice(-4, -2);
                const codeLow = hex.slice(-6, -4);
                const codeWord = `${codeHigh}${codeLow}`;
                this.finalizeBleFlow(false, `握手失败，设备返回码 0x${codeWord}`);
                return;
            }
            return;
        }
        if (type === '89') {
            updateBleState(this, { communicateBuffer: hex });
            this.addLog('设备开始下发通讯密钥片段');
            return;
        }
        if (type === '86') {
            updateBleState(this, { timeSyncBuffer: hex });
            this.addLog('设备返回时间同步片段');
            return;
        }
        if (type === '82') {
            updateBleState(this, { cardSyncBuffer: hex });
            this.addLog('设备返回黑名单同步片段');
            return;
        }
        if (tail === '5A' && bleState.communicateBuffer) {
            const concatBuffer = `${bleState.communicateBuffer}${hex}`;
            const bodyHex = concatBuffer.substr(24, 32);
            const tempKey = (0, bleProtocol_1.decryptCommKey)(bodyHex, this.data.form.key);
            if (tempKey) {
                updateBleState(this, {
                    tempCommKey: tempKey,
                    communicateBuffer: ''
                });
                this.addLog('通讯密钥协商成功');
            }
            else {
                updateBleState(this, { communicateBuffer: concatBuffer });
            }
            return;
        }
        if (tail === '5A' && bleState.timeSyncBuffer && bleState.tempCommKey) {
            const concatBuffer = `${bleState.timeSyncBuffer}${hex}`;
            const bodyHex = concatBuffer.substr(24, 16);
            const resultHex = (0, bleProtocol_1.decryptWithSessionKey)(bodyHex, bleState.tempCommKey);
            if (resultHex === '0000000000000000') {
                this.addLog('门锁时间同步成功');
                updateBleState(this, { timeSyncBuffer: '' });
                this.startAckTimer('时间同步完成，等待门锁最终回执...');
            }
            else {
                updateBleState(this, { timeSyncBuffer: concatBuffer });
            }
            return;
        }
    },
    onLoad() {
        const self = this;
        self._stage = 'idle';
        self._valueChangeHandler = this.handleValueChange.bind(this);
        wx.onBLECharacteristicValueChange(self._valueChangeHandler);
        const platformInfo = resolvePlatformInfo();
        self._isDevtools = platformInfo.isDevtools;
        if (platformInfo.platform) {
            this.setData({ isIOS: platformInfo.platform === 'ios' });
        }
        else {
            this.setData({ isIOS: false });
        }
        const paramsHidden = readParamsHiddenPreference();
        this.setData({
            paramsHidden,
            canSubmit: this.canSubmitForm(),
            ...this.buildSensitiveDisplayValues(this.data.form, paramsHidden)
        });
        const wxAny = wx;
        if (typeof wxAny.onStorageChange === 'function') {
            const handler = (event) => {
                if (event && event.key === 'doorConfig') {
                    this.refreshConfig();
                }
            };
            wxAny.onStorageChange(handler);
            self._storageChangeHandler = handler;
        }
        wx.showShareMenu({
            menus: ['shareAppMessage', 'shareTimeline']
        });
        const acceptedDisclaimer = wx.getStorageSync('globalDisclaimerAccepted') || wx.getStorageSync('guideDisclaimerAccepted');
        if (!acceptedDisclaimer) {
            this.showDisclaimer();
        }
        else {
            this.setData({ disclaimerVisible: false, disclaimerCountdown: 0 });
        }
    },
    onShareAppMessage() {
        return {
            title: 'BaiyunKeys',
            path: '/pages/index/index'
        };
    },
    onShareTimeline() {
        return {
            title: 'BaiyunKeys'
        };
    },
    switchToTab(url) {
        wx.switchTab({
            url,
            fail: () => {
                wx.showToast({ title: '页面跳转失败', icon: 'none', duration: 1400 });
            }
        });
    },
    onNavMoreTap() {
        wx.showActionSheet({
            itemList: ['前往配置页', '前往帮助页'],
            success: (res) => {
                if (res.tapIndex === 0) {
                    this.switchToTab('/pages/config/index');
                    return;
                }
                if (res.tapIndex === 1) {
                    this.switchToTab('/pages/guide/index');
                }
            }
        });
    },
    onNavProfileTap() {
        wx.showToast({ title: 'BaiyunKeys', icon: 'none', duration: 1200 });
    },
    onCopyField(event) {
        const field = event.currentTarget.dataset.field;
        const form = this.data.form;
        const value = field && typeof form[field] === 'string' ? form[field].trim() : '';
        if (!value) {
            wx.showToast({ title: '暂无可复制内容', icon: 'none', duration: 1200 });
            return;
        }
        wx.setClipboardData({
            data: value,
            success: () => {
                wx.showToast({ title: '已复制', icon: 'success', duration: 1200 });
            }
        });
    },
    async onUnload() {
        const self = this;
        this.clearDisclaimerTimer();
        if (self._valueChangeHandler) {
            wx.offBLECharacteristicValueChange();
            self._valueChangeHandler = null;
        }
        const wxAny = wx;
        if (self._storageChangeHandler && typeof wxAny.offStorageChange === 'function') {
            wxAny.offStorageChange(self._storageChangeHandler);
            self._storageChangeHandler = null;
        }
        this.clearQuickUnlockTimer();
        await this.cleanupBluetooth();
    },
    onMacInput(event) {
        const value = (0, lockBiz_1.sanitizeMacInput)(event.detail.value || '');
        const nextForm = { ...this.data.form, mac: value };
        this.setData({
            'form.mac': value,
            canSubmit: this.canSubmitForm(nextForm),
            ...this.buildSensitiveDisplayValues(nextForm, !!this.data.paramsHidden)
        });
    },
    onKeyInput(event) {
        const value = (0, lockBiz_1.sanitizeKey)(event.detail.value || '');
        const nextForm = { ...this.data.form, key: value };
        this.setData({
            'form.key': value,
            canSubmit: this.canSubmitForm(nextForm),
            ...this.buildSensitiveDisplayValues(nextForm, !!this.data.paramsHidden)
        });
    },
    onBluetoothNameInput(event) {
        const value = (event.detail.value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
        const nextForm = { ...this.data.form, bluetoothName: value };
        this.setData({
            'form.bluetoothName': value,
            canSubmit: this.canSubmitForm(nextForm),
            ...this.buildSensitiveDisplayValues(nextForm, !!this.data.paramsHidden)
        });
    },
    maskMiddleValue(rawValue, prefixCount, suffixCount) {
        const raw = (rawValue || '').trim();
        if (!raw) {
            return '未填写';
        }
        if (raw.length <= prefixCount + suffixCount) {
            return MASK_CHAR.repeat(Math.max(4, raw.length));
        }
        const remain = raw.length - prefixCount - suffixCount;
        const middleStars = MASK_CHAR.repeat(Math.max(4, Math.min(8, remain)));
        return `${raw.slice(0, prefixCount)}${middleStars}${raw.slice(-suffixCount)}`;
    },
    maskMacValue(rawMac) {
        const normalized = (rawMac || '').trim().toUpperCase();
        if (!normalized) {
            return '未填写';
        }
        const segments = normalized.split(':').filter(Boolean);
        if (segments.length === 6) {
            return `${segments[0]}:${MASK_PAIR}:${MASK_PAIR}:${MASK_PAIR}:${MASK_PAIR}:${segments[5]}`;
        }
        const compact = normalized.replace(/[^0-9A-F]/g, '');
        if (compact.length === 12) {
            return `${compact.slice(0, 2)}:${MASK_PAIR}:${MASK_PAIR}:${MASK_PAIR}:${MASK_PAIR}:${compact.slice(10, 12)}`;
        }
        return this.maskMiddleValue(normalized, 2, 2);
    },
    maskDoorName(rawName) {
        const normalized = (rawName || '').trim().replace(/\s+/g, ' ');
        if (!normalized) {
            return '未命名门禁';
        }
        const length = normalized.length;
        let prefixCount = 2;
        let suffixCount = 2;
        if (length <= 4) {
            prefixCount = 1;
            suffixCount = 1;
        }
        else if (length <= 8) {
            prefixCount = 2;
            suffixCount = 2;
        }
        else if (length <= 12) {
            prefixCount = 3;
            suffixCount = 2;
        }
        else {
            prefixCount = 4;
            suffixCount = 3;
        }
        const tailMatch = normalized.match(/([A-Za-z0-9]+(?:号|栋|座|室|层|单元|幢|期|区|巷|弄))$/);
        if (tailMatch && tailMatch[1]) {
            const tail = tailMatch[1];
            if (tail.length >= 2) {
                suffixCount = Math.max(suffixCount, Math.min(tail.length, 6));
            }
        }
        if (length <= prefixCount + suffixCount) {
            if (length <= 2) {
                return `${normalized.charAt(0)}${MASK_CHAR}`;
            }
            return `${normalized.charAt(0)}${MASK_CHAR.repeat(Math.max(1, length - 2))}${normalized.charAt(length - 1)}`;
        }
        const middleLength = length - prefixCount - suffixCount;
        const middleStars = MASK_CHAR.repeat(Math.max(4, Math.min(8, middleLength)));
        return `${normalized.slice(0, prefixCount)}${middleStars}${normalized.slice(-suffixCount)}`;
    },
    buildSensitiveDisplayValues(targetForm, hidden) {
        const doorName = (targetForm.doorName || '').trim();
        const mac = (targetForm.mac || '').trim();
        const key = (targetForm.key || '').trim();
        const bluetoothName = (targetForm.bluetoothName || '').trim();
        const displayDoorName = doorName
            ? hidden
                ? this.maskDoorName(doorName)
                : doorName
            : '未命名门禁';
        const displayMac = !mac ? '未填写' : hidden ? this.maskMacValue(mac) : mac;
        const displayKey = !key ? '未填写' : hidden ? this.maskMiddleValue(key, 4, 4) : key;
        const displayBluetoothName = !bluetoothName ? '未填写' : hidden ? this.maskMiddleValue(bluetoothName, 1, 1) : bluetoothName;
        return {
            displayDoorName,
            displayMac,
            displayKey,
            displayBluetoothName
        };
    },
    resolveEffectiveForm(baseForm) {
        const current = (0, configView_1.normalizeConfigForForm)(baseForm || this.data.form);
        if (current.mac && current.key) {
            return current;
        }
        const list = (this.data.configs || []);
        if (!list.length) {
            return current;
        }
        const selected = Number(this.data.selectedConfigIndex);
        const index = Number.isFinite(selected) && selected >= 0 && selected < list.length ? selected : 0;
        return (0, configView_1.normalizeConfigForForm)(list[index]);
    },
    onToggleParamsHidden() {
        const nextHidden = !this.data.paramsHidden;
        const form = this.resolveEffectiveForm(this.data.form);
        writeParamsHiddenPreference(nextHidden);
        this.setData({
            form,
            canSubmit: this.canSubmitForm(form),
            paramsHidden: nextHidden,
            ...this.buildSensitiveDisplayValues(form, nextHidden)
        });
    },
    toggleConfigSelector() {
        const list = this.data.configs;
        if (!list.length) {
            wx.showToast({ title: '请先在配置页新增门禁', icon: 'none' });
            return;
        }
        this.setData({ selectorOpen: !this.data.selectorOpen });
    },
    onSelectConfig(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) {
            this.setData({ selectorOpen: false });
            return;
        }
        const active = (0, config_1.setActiveDoorConfig)(id);
        const list = (0, config_1.readDoorConfigList)();
        this.applyConfigState(active, list);
    },
    canSubmitForm(targetForm) {
        const form = targetForm || this.data.form;
        const { mac, key, bluetoothName } = form;
        if (!(0, lockBiz_1.isValidMac)(mac) || !(0, lockBiz_1.isValidKey)(key)) {
            return false;
        }
        if (this.data.isIOS) {
            return !!bluetoothName;
        }
        return true;
    },
    applyConfigState(active, list) {
        const form = (0, configView_1.normalizeConfigForForm)(active);
        const logEnabled = (0, config_1.readLogPreference)();
        const quickUnlockEnabled = (0, config_1.readQuickUnlockPreference)();
        const androidCompatEnabled = (0, config_1.readAndroidCompatPreference)();
        const autoRetryUnlockEnabled = (0, config_1.readAutoRetryUnlockPreference)();
        const autoRetryUnlockCount = (0, config_1.readAutoRetryUnlockCountPreference)();
        const autoRetryUnlockTimeout = (0, config_1.readAutoRetryUnlockTimeoutPreference)();
        const nextForm = { ...form, logEnabled };
        const { configs, configNames, configOptions, selectedConfigIndex } = (0, configView_1.buildConfigCollections)(list, nextForm.id || null);
        const displayConfigOptions = configOptions.map((option) => ({
            ...option,
            maskedName: this.maskDoorName(option.name)
        }));
        const currentLogs = logEnabled && Array.isArray(this.data.logs) ? this.data.logs : [];
        const payload = {
            configs,
            configNames,
            configOptions: displayConfigOptions,
            selectedConfigIndex,
            selectorOpen: false,
            form: nextForm,
            canSubmit: this.canSubmitForm(nextForm),
            consoleSync: logEnabled,
            logViewportHeight: this.resolveLogViewportHeight(currentLogs),
            quickUnlockEnabled,
            androidCompatEnabled,
            autoRetryUnlockEnabled,
            autoRetryUnlockCount,
            autoRetryUnlockTimeout,
            ...buildLogStatusPatch(this.resolveLogStatusFromLogs(currentLogs)),
            ...this.buildSensitiveDisplayValues(nextForm, !!this.data.paramsHidden)
        };
        if (!logEnabled) {
            payload.logs = [];
            payload.logViewportHeight = this.resolveLogViewportHeight([]);
            payload.logScrollTop = 0;
            this._logScrollTick = 0;
            Object.assign(payload, buildLogStatusPatch(createLogStatusState('等待日志', 'idle', false)));
            payload['state.message'] = '';
            payload['state.previewMessage'] = '';
            payload['state.statusTone'] = 'normal';
        }
        const wasLogging = this.data.consoleSync;
        this.setData(payload, () => {
            if (logEnabled && !wasLogging) {
                this.setLogStatus(createLogStatusState('调试已开启', 'info', true));
                this.logDebugSnapshot('调试模式已开启');
            }
        });
        this.scheduleQuickUnlock();
    },
    refreshConfig() {
        const list = (0, config_1.readDoorConfigList)();
        let stored = (0, config_1.readDoorConfig)();
        if ((!stored.mac || !stored.key) && list.length) {
            stored = (0, config_1.setActiveDoorConfig)(list[0].id);
        }
        this.applyConfigState(stored, list);
    },
    scheduleQuickUnlock() {
        const self = this;
        if (!this.data.quickUnlockEnabled) {
            this.clearQuickUnlockTimer();
            return;
        }
        if (quickUnlockSessionUsed || self._quickUnlockTriggered) {
            return;
        }
        this.clearQuickUnlockTimer();
        this.tryPrewarmQuickUnlock().catch(() => undefined);
        self._quickUnlockTimer = setTimeout(() => {
            self._quickUnlockTimer = null;
            this.triggerQuickUnlock();
        }, 400);
    },
    async tryPrewarmQuickUnlock() {
        const self = this;
        if (self._prewarmPromise || !this.data.quickUnlockEnabled || quickUnlockSessionUsed || self._quickUnlockTriggered) {
            return self._prewarmPromise;
        }
        self._prewarmPromise = (async () => {
            try {
                await callWx(wx.openBluetoothAdapter, {});
                await callWx(wx.startBluetoothDevicesDiscovery, {
                    allowDuplicatesKey: false,
                    interval: 0,
                    powerLevel: 'low',
                    services: SERVICE_CANDIDATES
                });
                await new Promise((resolve) => setTimeout(resolve, PREWARM_SCAN_DURATION));
            }
            catch (error) {
                const message = error && typeof error.errMsg === 'string' ? error.errMsg : error;
                console.debug('[BLE] 预热快速开锁失败', message);
            }
            finally {
                await callWx(wx.stopBluetoothDevicesDiscovery, {}).catch(() => undefined);
            }
        })().finally(() => {
            self._prewarmPromise = null;
        });
        return self._prewarmPromise;
    },
    clearQuickUnlockTimer() {
        const self = this;
        if (self._quickUnlockTimer) {
            clearTimeout(self._quickUnlockTimer);
            self._quickUnlockTimer = null;
        }
    },
    triggerQuickUnlock() {
        const self = this;
        if (!this.data.quickUnlockEnabled || self._quickUnlockTriggered || quickUnlockSessionUsed) {
            return;
        }
        if (this.data.state.loading) {
            return;
        }
        const form = this.data.form;
        if (!this.canSubmitForm(form)) {
            return;
        }
        self._quickUnlockTriggered = true;
        quickUnlockSessionUsed = true;
        this.setStateMessage('正在执行快速开锁...');
        wx.showToast({ title: '快速开锁执行中', icon: 'none', duration: 800 });
        this.onSubmit();
    },
    resetBleRuntime() {
        const self = this;
        if (self._ackTimeoutHandle) {
            clearTimeout(self._ackTimeoutHandle);
            self._ackTimeoutHandle = null;
        }
        self._bleFinalized = false;
        self._randomSeed = null;
        this.setData({
            ble: createBleState()
        });
    },
    finalizeBleFlow(success, message) {
        const self = this;
        if (self._bleFinalized) {
            return;
        }
        self._bleFinalized = true;
        if (success) {
            try {
                const form = this.data.form;
                if (form && self._currentDeviceId) {
                    cacheDeviceId(form, self._currentDeviceId);
                }
            }
            catch (err) {
                console.debug('[BLE] 缓存设备信息失败', err);
            }
        }
        this.clearAckTimer();
        if (self._ackResolve) {
            const resolver = self._ackResolve;
            self._ackResolve = null;
            self._stage = 'idle';
            resolver(null);
        }
        const duration = typeof self._flowStartAt === 'number' ? Date.now() - self._flowStartAt : null;
        this.addLog(duration !== null ? (message + '（总耗时 ' + duration + 'ms）') : message);
        this.setLogStatus(this.resolveFinalLogStatus(success, message));
        this.setStateMessage(message, success ? 'normal' : 'error');
        wx.showToast({
            title: message,
            icon: success ? 'success' : 'none',
            duration: 3000
        });
        this.setData({ 'state.loading': false, autoRetrying: false });
        this.cleanupBluetooth().catch(() => undefined);
    },
    startAckTimer(message) {
        const self = this;
        if (self._ackTimeoutHandle) {
            clearTimeout(self._ackTimeoutHandle);
        }
        if (message) {
            this.setStateMessage(message);
        }
        self._ackTimeoutHandle = setTimeout(() => {
            self._ackTimeoutHandle = null;
            this.addLog('超时：在限定时间内未收到门锁响应');
            this.setLogStatus(this.resolveFinalLogStatus(false, '未收到门锁响应'));
            this.setStateMessage('未收到门锁响应，请确认门锁状态后再次尝试');
        }, USER_ACK_TIMEOUT);
    },
    clearAckTimer() {
        const self = this;
        if (self._ackTimeoutHandle) {
            clearTimeout(self._ackTimeoutHandle);
            self._ackTimeoutHandle = null;
        }
    },
    isFlowAbortedReason(reason) {
        if (!reason) {
            return false;
        }
        return reason.includes(FLOW_ABORT_MESSAGE) || reason.includes(FLOW_ABORT_DISPLAY_MESSAGE);
    },
    throwIfFlowAborted() {
        const self = this;
        if (self._interruptRequested) {
            throw new Error(FLOW_ABORT_MESSAGE);
        }
    },
    async onAbortUnlock() {
        if (!this.data.state.loading) {
            return;
        }
        const self = this;
        if (self._abortingUnlock) {
            return;
        }
        self._abortingUnlock = true;
        self._interruptRequested = true;
        this.addLog('[中断] 用户请求中断当前开锁流程');
        this.setLogStatus(createLogStatusState('已中断', 'warn', true));
        this.setStateMessage('正在中断当前开锁流程...');
        this.setData({ 'state.loading': false, autoRetrying: false });
        try {
            if (typeof self._activeScanCancel === 'function') {
                const cancelScan = self._activeScanCancel;
                self._activeScanCancel = null;
                cancelScan();
            }
            if (self._seedReject) {
                const seedReject = self._seedReject;
                self._seedResolve = null;
                self._seedReject = null;
                self._stage = 'idle';
                seedReject(new Error(FLOW_ABORT_MESSAGE));
            }
            if (self._ackResolve) {
                const ackResolve = self._ackResolve;
                self._ackResolve = null;
                self._stage = 'idle';
                ackResolve(null);
            }
            await this.cleanupBluetooth();
            this.setStateMessage(FLOW_ABORT_DISPLAY_MESSAGE);
            wx.showToast({ title: FLOW_ABORT_DISPLAY_MESSAGE, icon: 'none', duration: 1200 });
        }
        finally {
            self._abortingUnlock = false;
        }
    },
    shouldAutoRetryUnlock(reason, retryRemaining) {
        const self = this;
        return (!self._interruptRequested &&
            this.data.autoRetryUnlockEnabled &&
            retryRemaining > 0 &&
            typeof reason === 'string' &&
            reason.includes('扫描蓝牙设备超时'));
    },
    getReadableErrorMessage(reason) {
        const text = typeof reason === 'string' ? reason : '';
        const lower = text.toLowerCase();
        if (lower.includes('scanning too frequently')) {
            return '蓝牙扫描触发过于频繁，请稍候 1-2 秒后重试';
        }
        return text || '操作失败';
    },
    async onSubmit() {
        if (this.data.state.loading || !this.data.canSubmit) {
            return;
        }
        const self = this;
        self._interruptRequested = false;
        self._activeScanCancel = null;
        const form = this.data.form;
        const mac = (form.mac || '').trim().toUpperCase();
        let retryRemaining = this.data.autoRetryUnlockEnabled
            ? Math.max(0, Number(this.data.autoRetryUnlockCount) || 0)
            : 0;
        let attempt = 0;
        while (true) {
            attempt += 1;
            self._flowStartAt = Date.now();
            this.resetBleRuntime();
            const statePayload = {
                'state.loading': true,
                'state.statusTone': 'normal',
                'state.message': attempt === 1 ? '正在检查权限...' : ('正在自动重发（第 ' + attempt + ' 次）...'),
                'state.previewMessage': attempt === 1 ? '开锁中' : '自动重试中'
            };
            statePayload.autoRetrying = attempt > 1;
            Object.assign(statePayload, buildLogStatusPatch(createLogStatusState(attempt === 1 ? '开锁中' : '自动重试中', attempt === 1 ? 'info' : 'warn', true)));
            if (attempt === 1) {
                statePayload.logs = [];
                statePayload.logViewportHeight = this.resolveLogViewportHeight([]);
                statePayload.logScrollTop = 0;
                this._logScrollTick = 0;
            }
            this.setData(statePayload);
            if (attempt === 1) {
                this.logDebugSnapshot('开锁流程开始');
                this.addLog('开始蓝牙开锁流程 [platform=' + (this.data.isIOS ? 'ios' : 'android/other') + ']');
                this.addLog('门禁配置已载入，开始执行蓝牙流程');
            }
            else {
                this.addLog('[自动重发] 开始第 ' + attempt + ' 次尝试，剩余可重发 ' + retryRemaining + ' 次');
            }
            try {
                const systemSetting = await this.ensurePermissions({ checkAndroidCompatLocation: false });
                this.throwIfFlowAborted();
                this.setStateMessage('正在初始化蓝牙...');
                await this.ensureBluetoothReady();
                this.throwIfFlowAborted();
                this.addLog('蓝牙适配器已就绪');
                let deviceId = null;
                let deviceLabel = '';
                const cachedDeviceId = readCachedDeviceId(form);
                if (cachedDeviceId) {
                    this.addLog('尝试使用缓存设备：' + cachedDeviceId);
                    this.setStateMessage('正在连接门锁...');
                    try {
                        await this.connectDevice(cachedDeviceId, 6000);
                        this.throwIfFlowAborted();
                        deviceId = cachedDeviceId;
                        deviceLabel = cachedDeviceId;
                        this.addLog('已直接连接缓存设备');
                    }
                    catch (error) {
                        const reason = formatError(error);
                        this.addLog('缓存设备连接失败：' + reason);
                        removeCachedDeviceId(form);
                        await callWx(wx.closeBLEConnection, {
                            deviceId: cachedDeviceId
                        }).catch(() => undefined);
                    }
                }
                if (!deviceId) {
                    await this.ensureAndroidCompatLocation(systemSetting);
                    this.throwIfFlowAborted();
                    this.setStateMessage('正在扫描门锁...');
                    const device = await this.discoverDevice(mac);
                    this.throwIfFlowAborted();
                    deviceId = device.deviceId;
                    const aliasName = device && device && typeof device.localName === 'string'
                        ? device.localName
                        : undefined;
                    deviceLabel = device.name || aliasName || device.deviceId;
                    this.addLog('找到设备：' + deviceLabel);
                    this.setStateMessage('正在连接门锁...');
                    await this.connectDevice(device.deviceId);
                    this.throwIfFlowAborted();
                }
                else if (deviceLabel) {
                    this.addLog('继续使用缓存设备：' + deviceLabel);
                }
                if (!deviceId) {
                    throw new Error('未找到可用的门锁设备');
                }
                this.addLog('蓝牙连接成功');
                this.setStateMessage('正在初始化蓝牙服务...');
                const channel = await this.prepareChannel(deviceId);
                this.addLog('读取蓝牙特征成功');
                await this.enableNotifications(deviceId, channel.serviceId, channel.notifyIds);
                this.throwIfFlowAborted();
                const seed = await this.readSeed(deviceId, channel.serviceId, channel.readId);
                this.throwIfFlowAborted();
                const seedHex = (0, lockBiz_1.bufferToHex)(seed);
                this.addLog(`随机数：${seedHex}`);
                self._randomSeed = seed;
                updateBleState(this, { randomSeedHex: seedHex });
                const headerBytes = deriveHeaderFromMac(form.mac);
                const keyHex = (0, lockBiz_1.sanitizeKey)(form.key || '');
                if (!keyHex) {
                    throw new Error('缺少可用的开锁 Key');
                }
                const handshake = (0, bleProtocol_1.buildHandshakeCommandWithHeader)(seed, headerBytes, keyHex);
                this.addLog('握手指令：' + (0, lockBiz_1.bytesToHex)(handshake));
                await this.writeCommand(deviceId, channel.serviceId, channel.writeId, handshake);
                updateBleState(this, { handshakeSent: true });
                this.startAckTimer('握手指令已发送，等待门锁响应...');
                await this.waitForAck();
                this.throwIfFlowAborted();
                return;
            }
            catch (err) {
                const reason = typeof err === 'string' ? err : formatError(err);
                if (self._interruptRequested || this.isFlowAbortedReason(reason)) {
                    this.addLog('[中断] 开锁流程已停止');
                    this.setLogStatus(createLogStatusState('已中断', 'warn', true));
                    this.setStateMessage(FLOW_ABORT_DISPLAY_MESSAGE);
                    this.setData({ 'state.loading': false, autoRetrying: false });
                    return;
                }
                if (this.shouldAutoRetryUnlock(reason, retryRemaining)) {
                    retryRemaining -= 1;
                    this.addLog('[自动重发] 扫描超时，立即重试，剩余 ' + retryRemaining + ' 次');
                    this.setLogStatus(createLogStatusState('自动重试中', 'warn', true));
                    this.setStateMessage('扫描超时，正在自动重发（剩余 ' + retryRemaining + ' 次）...', 'normal');
                    continue;
                }
                const displayReason = this.getReadableErrorMessage(reason);
                this.setData({ 'state.loading': false, autoRetrying: false });
                this.addLog('错误：' + displayReason + (displayReason !== reason ? (' | 原因=' + reason) : ''));
                this.setLogStatus(this.resolveFinalLogStatus(false, displayReason));
                this.setStateMessage(displayReason);
                return;
            }
            finally {
                self._flowStartAt = null;
                if (self._bleFinalized) {
                    self._bleFinalized = false;
                }
                else {
                    await this.cleanupBluetooth();
                    this.setData({ 'state.loading': false, autoRetrying: false });
                }
            }
        }
    },
    logDebugSnapshot(reason) {
        if (!this.data.consoleSync) {
            return;
        }
        const self = this;
        const now = Date.now();
        if (self._debugSnapshotAt && now - self._debugSnapshotAt < 1500) {
            return;
        }
        self._debugSnapshotAt = now;
        const systemInfo = readSystemInfo();
        const deviceInfo = readDeviceInfo();
        const appBaseInfo = readAppBaseInfo();
        const model = (deviceInfo.model || systemInfo.model || '').toString().trim();
        const brand = (deviceInfo.brand || systemInfo.brand || '').toString().trim();
        const platform = (systemInfo.platform || deviceInfo.platform || '').toString().trim();
        const system = (systemInfo.system || deviceInfo.system || '').toString().trim();
        const wechatVersion = (systemInfo.version || appBaseInfo.version || '').toString().trim();
        const sdkVersion = (systemInfo.SDKVersion || appBaseInfo.SDKVersion || '').toString().trim();
        const bluetoothVersion = (systemInfo.bluetoothVersion || deviceInfo.bluetoothVersion || '').toString().trim();
        const deviceLabel = [brand, model].filter(Boolean).join(' ');
        this.addLog(`[调试] ${reason}`);
        this.addLog(`[调试] 设备: ${deviceLabel || 'unknown'} platform=${platform || 'unknown'}`);
        this.addLog(`[调试] 系统: ${system || 'unknown'} 微信版本=${wechatVersion || 'unknown'} 基础库=${sdkVersion || 'unknown'}`);
        if (bluetoothVersion) {
            this.addLog(`[调试] 蓝牙版本=${bluetoothVersion}`);
        }
        if (typeof systemInfo.bluetoothEnabled === 'boolean') {
            this.addLog(`[调试] 蓝牙开关=${systemInfo.bluetoothEnabled ? '开' : '关'}`);
        }
    },
    resolveLogLevel(message) {
        const text = (message || '').toString();
        const upper = text.toUpperCase();
        if (upper.includes('[ERROR]'))
            return 'ERROR';
        if (upper.includes('[WARN]'))
            return 'WARN';
        if (upper.includes('[DEBUG]'))
            return 'DEBUG';
        if (upper.includes('[INFO]'))
            return 'INFO';
        if (text.includes('错误') ||
            text.includes('失败') ||
            text.includes('异常') ||
            text.includes('不支持') ||
            text.includes('未收到') ||
            text.includes('未匹配')) {
            return 'ERROR';
        }
        if (text.includes('超时') ||
            text.includes('未发现') ||
            text.includes('频繁') ||
            text.includes('重试') ||
            text.includes('中断') ||
            text.includes('取消')) {
            return 'WARN';
        }
        if (upper.includes('[DEBUG]') || text.includes('调试'))
            return 'DEBUG';
        return 'INFO';
    },
    resolveLogTone(message, levelOverride) {
        const level = levelOverride || this.resolveLogLevel(message);
        if (level === 'ERROR')
            return 'log-tone-error';
        if (level === 'WARN')
            return 'log-tone-warn';
        if (level === 'DEBUG')
            return 'log-tone-debug';
        return 'log-tone-info';
    },
    normalizeLogMessage(message) {
        const tagMap = {
            通知解析: 'PARSE',
            中断: 'ABORT',
            自动重发: 'RETRY',
            调试: 'DEBUG',
            权限: 'PERM',
            蓝牙: 'BLE',
            扫描: 'SCAN',
            连接: 'CONN',
            服务: 'SERVICE',
            特征: 'CHAR',
            通知: 'NOTIFY',
            写入: 'WRITE',
            等待: 'WAIT',
            清理: 'CLEAN',
            随机数: 'SEED'
        };
        const raw = (message || '').toString();
        return raw.replace(/\[([^\]]+)\]/g, (match, tag) => (tagMap[tag] ? `[${tagMap[tag]}]` : match));
    },
    stripLeadingTag(message) {
        return (message || '').toString().replace(/^\[(DEBUG|INFO|WARN|ERROR|PERM|BLE|SCAN|CONN|SERVICE|CHAR|NOTIFY|WRITE|WAIT|CLEAN|SEED|PARSE|RETRY|ABORT)\]\s*/i, '');
    },
    buildLogLine(message, stamp) {
        const normalized = this.normalizeLogMessage(message);
        const level = this.resolveLogLevel(normalized);
        const display = this.stripLeadingTag(normalized);
        const prefix = stamp ? `${stamp} ` : '';
        return `${prefix}[${level}] ${display}`;
    },
    resolveLogViewportHeight(logsInput) {
        const logs = Array.isArray(logsInput) ? logsInput : Array.isArray(this.data.logs) ? this.data.logs : [];
        if (!logs.length) {
            return LOG_EMPTY_VIEWPORT_HEIGHT;
        }
        const visibleLines = Math.min(logs.length, 7);
        const contentHeight = LOG_VIEWPORT_VERTICAL_PADDING + visibleLines * LOG_LINE_VIEWPORT_HEIGHT;
        return Math.min(LOG_MAX_VIEWPORT_HEIGHT, Math.max(LOG_MIN_VIEWPORT_HEIGHT, contentHeight));
    },
    normalizeLogLine(rawText) {
        const raw = (rawText || '').toString();
        const match = raw.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})\s+(.*)$/);
        const stamp = match ? match[1] : '';
        const body = match ? match[2] : raw;
        return this.buildLogLine(body, stamp || undefined);
    },
    extractLogStatusText(rawText) {
        const raw = (rawText || '').toString();
        const withoutStamp = raw.replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s+/, '');
        const withoutLevel = withoutStamp.replace(/^\[(DEBUG|INFO|WARN|ERROR)\]\s*/i, '');
        return this.stripLeadingTag(withoutLevel)
            .replace(/^错误[：:]\s*/, '')
            .replace(/^openBluetoothAdapter\s+失败[：:]\s*/i, '蓝牙初始化失败：')
            .trim();
    },
    compactLogStatusText(text, fallback) {
        const normalized = (text || '').trim();
        if (!normalized) {
            return fallback;
        }
        return normalized.length > LOG_STATUS_MAX_LENGTH ? `${normalized.slice(0, LOG_STATUS_MAX_LENGTH)}...` : normalized;
    },
    setLogStatus(status) {
        this.setData(buildLogStatusPatch(status));
    },
    resolveActionableErrorStatusText(message) {
        const text = (message || '').toString().trim();
        const lower = text.toLowerCase();
        if (!text) {
            return '开锁失败';
        }
        if (text.includes('扫描触发过于频繁') || text.includes('扫描过于频繁') || lower.includes('scanning too frequently')) {
            return '扫描太频繁，稍后重试';
        }
        if (text.includes('扫描蓝牙设备超时') ||
            text.includes('未匹配到目标设备') ||
            text.includes('未发现设备') ||
            text.includes('未找到可用的门锁设备')) {
            return '靠近门锁后重试';
        }
        if (text.includes('当前环境不支持蓝牙') ||
            text.includes('不支持蓝牙调试') ||
            text.includes('环境不支持蓝牙') ||
            lower.includes('not support')) {
            return '请用真机调试';
        }
        if (text.includes('开启蓝牙') || text.includes('蓝牙功能') || text.includes('bluetooth adapter is not available')) {
            return '请先开启蓝牙';
        }
        if (text.includes('定位权限') || text.includes('系统定位') || text.includes('location')) {
            return '请开启定位权限';
        }
        if (text.includes('未收到门锁响应') || text.includes('未收到最终回执') || text.includes('随机数超时') || text.includes('门锁响应')) {
            return '门锁无响应，重试';
        }
        if (text.includes('握手失败') ||
            text.includes('通讯密钥协商失败') ||
            text.includes('密钥') ||
            text.includes('Key') ||
            text.includes('SN')) {
            return '密钥不匹配或被拒';
        }
        if (text.includes('未找到目标蓝牙服务') || text.includes('未找到可读写的蓝牙特征') || text.includes('蓝牙服务')) {
            return '门锁服务异常';
        }
        if (text.includes('连接失败') || lower.includes('connect')) {
            return '连接失败，靠近重试';
        }
        return this.compactLogStatusText(text, '开锁失败');
    },
    resolveFinalLogStatus(success, message) {
        if (success) {
            return createLogStatusState('开锁成功', 'success', true);
        }
        const text = (message || '').toString();
        if (text.includes('中断') || text.includes('取消')) {
            return createLogStatusState('已中断', 'warn', true);
        }
        return createLogStatusState(this.resolveActionableErrorStatusText(text), 'error', true);
    },
    resolveLogStatus(rawText, levelOverride) {
        const level = levelOverride || this.resolveLogLevel(rawText);
        const text = this.extractLogStatusText(rawText);
        if (text.includes('开始释放蓝牙资源') ||
            text.includes('蓝牙资源释放完成') ||
            text.includes('停止扫描') ||
            text.includes('处理通知异常')) {
            return null;
        }
        if (text.includes('中断') || text.includes('取消')) {
            return createLogStatusState('已中断', 'warn', true);
        }
        if (text.includes('握手成功') || text.includes('开锁成功')) {
            return createLogStatusState('开锁成功', 'success', true);
        }
        if (level === 'ERROR') {
            return createLogStatusState(this.resolveActionableErrorStatusText(text), 'error', true);
        }
        if (text.includes('自动重发') || text.includes('重试')) {
            return createLogStatusState('自动重试中', 'warn', true);
        }
        if (level === 'WARN') {
            return createLogStatusState('开锁异常', 'warn', true);
        }
        if (level === 'DEBUG') {
            if (text.includes('调试模式已开启')) {
                return createLogStatusState('调试已开启', 'info', true);
            }
            return null;
        }
        if (text.includes('开始蓝牙开锁流程') ||
            text.includes('门禁配置已载入') ||
            text.includes('检查系统权限状态') ||
            text.includes('系统蓝牙状态正常') ||
            text.includes('定位权限已授权') ||
            text.includes('系统定位已开启') ||
            text.includes('调用 openBluetoothAdapter') ||
            text.includes('蓝牙适配器已就绪') ||
            text.includes('找到设备') ||
            text.includes('蓝牙连接成功') ||
            text.includes('读取蓝牙特征成功') ||
            text.includes('通道准备完成') ||
            text.includes('等待门锁回执') ||
            text.includes('握手指令已发送')) {
            return createLogStatusState('开锁中', 'info', true);
        }
        if (level === 'INFO') {
            return null;
        }
        return null;
    },
    resolveLogStatusFromLogs(logsInput) {
        const logs = Array.isArray(logsInput) ? logsInput : [];
        if (!logs.length) {
            return createLogStatusState();
        }
        for (let index = logs.length - 1; index >= 0; index -= 1) {
            const item = logs[index];
            const rawText = typeof item === 'string' ? item : item && item.text;
            const status = this.resolveLogStatus(rawText || '');
            if (status) {
                return status;
            }
        }
        return createLogStatusState();
    },
    addLog(message, consoleOverride) {
        const recordEnabled = consoleOverride !== undefined ? consoleOverride : this.data.consoleSync;
        if (!recordEnabled) {
            return;
        }
        const now = new Date();
        const stamp = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${padMs(now.getMilliseconds())}`;
        const normalizedMessage = this.normalizeLogMessage(message);
        const level = this.resolveLogLevel(normalizedMessage);
        const line = this.buildLogLine(normalizedMessage, stamp);
        const tone = this.resolveLogTone(normalizedMessage, level);
        const syncToConsole = consoleOverride !== undefined ? consoleOverride : this.data.consoleSync;
        if (syncToConsole) {
            console.log(`[BLE] ${line}`);
        }
        const existingRaw = Array.isArray(this.data.logs) ? this.data.logs : [];
        const existing = existingRaw.map((item) => {
            const rawText = typeof item === 'string' ? item : item.text;
            const normalizedText = this.normalizeLogLine(rawText);
            return { text: normalizedText, tone: this.resolveLogTone(normalizedText) };
        });
        const logs = [...existing, { text: line, tone }].slice(-LOG_MAX_LINES);
        const self = this;
        self._logScrollTick = (self._logScrollTick || 0) + 1;
        const nextLogScrollTop = self._logScrollTick * 100000;
        const payload = {
            logs,
            logViewportHeight: this.resolveLogViewportHeight(logs)
        };
        this.setData(payload, () => {
            this.setData({ logScrollTop: nextLogScrollTop });
        });
    },
    onClearLogs() {
        const logs = Array.isArray(this.data.logs) ? this.data.logs : [];
        if (!logs.length) {
            wx.showToast({ title: '暂无可清空日志', icon: 'none', duration: 1500 });
            return;
        }
        ;
        this._logScrollTick = 0;
        this.setData({
            logs: [],
            logViewportHeight: this.resolveLogViewportHeight([]),
            logScrollTop: 0,
            ...buildLogStatusPatch(createLogStatusState())
        });
        wx.showToast({ title: '日志已清空', icon: 'none', duration: 1500 });
    },
    onCopyLogs() {
        const logs = Array.isArray(this.data.logs) ? this.data.logs : [];
        if (!logs.length) {
            wx.showToast({ title: '暂无可复制的日志', icon: 'none', duration: 1500 });
            return;
        }
        const text = logs
            .map((item) => (typeof item === 'string' ? item : item.text))
            .join('\n');
        wx.setClipboardData({
            data: text,
            fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none', duration: 1500 })
        });
    },
    resolveStatusTone(message) {
        const text = (message || '').toString();
        if (!text) {
            return 'normal';
        }
        if (text.includes('失败') ||
            text.includes('错误') ||
            text.includes('异常') ||
            text.includes('超时') ||
            text.includes('未收到') ||
            text.includes('不支持') ||
            text.includes('未匹配') ||
            text.includes('未发现') ||
            text.includes('频繁')) {
            return 'error';
        }
        return 'normal';
    },
    resolveStatusPreviewMessage(message, tone) {
        const text = (message || '').toString().trim();
        if (!text) {
            return '';
        }
        if (text.includes('自动重发') || text.includes('自动重试')) {
            return '自动重试中';
        }
        if (text.includes('中断') || text.includes('取消')) {
            return '已中断';
        }
        if (tone === 'error') {
            return this.resolveActionableErrorStatusText(text);
        }
        if (text.includes('握手成功') || text.includes('开锁成功') || text.includes('成功')) {
            return '开锁成功';
        }
        if (text.includes('正在')) {
            return '开锁中';
        }
        return text;
    },
    setStateMessage(message, toneOverride) {
        const raw = (message || '').toString().trim();
        const cleaned = raw.replace(/^message=/, '').replace(/^msg=/, '');
        const tone = toneOverride || this.resolveStatusTone(cleaned);
        this.setData({
            'state.message': cleaned,
            'state.previewMessage': this.resolveStatusPreviewMessage(cleaned, tone),
            'state.statusTone': tone
        });
    },
    async ensurePermissions(options) {
        this.addLog('检查系统权限状态');
        const wxAny = wx;
        let systemSetting = null;
        if (typeof wxAny.getSystemSetting === 'function') {
            try {
                systemSetting = wxAny.getSystemSetting();
                this.addLog('[权限] getSystemSetting 成功：' + JSON.stringify(systemSetting));
            }
            catch (err) {
                const errMsg = err && typeof err.errMsg === 'string' ? err.errMsg : String(err);
                this.addLog('[权限] getSystemSetting 失败：' + errMsg);
            }
        }
        else {
            this.addLog('[权限] 当前基础库不支持 getSystemSetting，跳过系统状态检查');
        }
        if (systemSetting && systemSetting.bluetoothEnabled === false) {
            throw new Error('请先在手机系统设置中开启蓝牙功能后再试');
        }
        if (options?.checkAndroidCompatLocation !== false) {
            await this.ensureAndroidCompatLocation(systemSetting);
        }
        this.addLog('系统蓝牙状态正常');
        return systemSetting;
    },
    async ensureAndroidCompatLocation(systemSetting) {
        if (this.data.isIOS || !this.data.androidCompatEnabled) {
            return;
        }
        const wxAny = wx;
        let locationEnabled = null;
        if (systemSetting && typeof systemSetting.locationEnabled === 'boolean') {
            locationEnabled = systemSetting.locationEnabled;
        }
        else if (typeof wxAny.getSystemSetting === 'function') {
            try {
                const fallback = wxAny.getSystemSetting();
                if (fallback && typeof fallback.locationEnabled === 'boolean') {
                    locationEnabled = fallback.locationEnabled;
                }
            }
            catch (err) {
                this.addLog('[权限] 兼容模式：读取定位开关失败：' + formatError(err));
            }
        }
        if (locationEnabled === true) {
            this.addLog('[权限] 兼容模式：系统定位已开启');
        }
        else if (locationEnabled === false) {
            this.addLog('[权限] 兼容模式：系统定位未开启');
            wx.showToast({
                title: '兼容模式需要开启系统定位服务',
                icon: 'none',
                duration: 2200
            });
            throw new Error('兼容模式需要开启系统定位服务');
        }
        try {
            const setting = await callWx(wx.getSetting, {});
            const authSetting = setting && setting.authSetting ? setting.authSetting : {};
            const granted = typeof authSetting['scope.userLocation'] === 'boolean' ? authSetting['scope.userLocation'] : null;
            if (granted === true) {
                this.addLog('[权限] 兼容模式：定位权限已授权');
                return;
            }
            if (granted === false) {
                this.addLog('[权限] 兼容模式：定位权限未授权');
            }
            try {
                await callWx(wx.authorize, { scope: 'scope.userLocation' });
                this.addLog('[权限] 兼容模式：定位授权成功');
                return;
            }
            catch (err) {
                this.addLog('[权限] 兼容模式：定位授权失败：' + formatError(err));
                wx.showModal({
                    title: '需要定位权限',
                    content: '为提高蓝牙扫描成功率，请在设置中开启定位权限（不会记录位置信息）',
                    confirmText: '去设置',
                    success: (res) => {
                        if (res.confirm) {
                            if (typeof wx.openSetting === 'function') {
                                wx.openSetting({});
                            }
                        }
                    }
                });
                throw new Error('兼容模式需要开启定位权限');
            }
        }
        catch (err) {
            this.addLog('[权限] 兼容模式：读取授权状态失败：' + formatError(err));
            throw new Error('兼容模式需要开启定位权限');
        }
    },
    async ensureBluetoothReady() {
        const start = Date.now();
        this.addLog('[蓝牙] 调用 openBluetoothAdapter');
        try {
            await callWx(wx.openBluetoothAdapter, {});
            this.addLog('[蓝牙] openBluetoothAdapter 成功，耗时 ' + (Date.now() - start) + 'ms');
        }
        catch (err) {
            const code = err && err && typeof err.errCode !== 'undefined' ? err.errCode : undefined;
            const msg = err && typeof err.errMsg === 'string' ? err.errMsg : '';
            this.addLog('[蓝牙] openBluetoothAdapter 失败：' + formatError(err));
            if (msg.includes('暂不支持') || msg.includes('not support')) {
                throw new Error('当前环境不支持蓝牙调试，请使用 Mac 开发者工具或真机测试');
            }
            if (code === 10001) {
                throw new Error('请先在手机系统设置中开启蓝牙功能');
            }
            throw err;
        }
    },
    async discoverDevice(mac) {
        const self = this;
        this.throwIfFlowAborted();
        const page = this;
        const target = normalizeMacForCompare(mac);
        const reversed = reverseMacHex(target);
        const targetName = (this.data.form.bluetoothName || '').toUpperCase();
        const targetNameHex = targetName ? asciiToHex(targetName) : '';
        const discoveryTimeout = this.data.autoRetryUnlockEnabled
            ? (0, config_1.normalizeAutoRetryUnlockTimeout)(this.data.autoRetryUnlockTimeout) * 1000
            : DISCOVERY_TIMEOUT;
        const scanStartedAt = Date.now();
        const startScan = async (useServices) => {
            const options = {
                allowDuplicatesKey: false,
                interval: 0,
                powerLevel: 'high'
            };
            if (useServices) {
                options.services = SERVICE_CANDIDATES;
                page.addLog('[扫描] 使用服务过滤');
            }
            else {
                page.addLog('[扫描] 全量扫描：不带 services 过滤');
            }
            await callWx(wx.startBluetoothDevicesDiscovery, options);
        };
        this.addLog('[扫描] 开始，timeout=' + discoveryTimeout + 'ms');
        await callWx(wx.stopBluetoothDevicesDiscovery, {}).catch(() => undefined);
        await startScan(true);
        return new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                page.addLog('[扫描] 超时，已发现设备 ' + discovered.length + ' 个，耗时 ' + (Date.now() - scanStartedAt) + 'ms，未匹配到目标设备');
                cleanup();
                reject(new Error('扫描蓝牙设备超时，请靠近门锁后重试'));
            }, discoveryTimeout);
            const fallbackDelay = Math.max(500, Math.min(2500, discoveryTimeout - 500));
            let fallbackTimer = null;
            let fallbackTried = false;
            let seenAny = false;
            const debugSeen = new Set();
            const discovered = [];
            const triggerFallback = async () => {
                if (settled || fallbackTried || seenAny) {
                    return;
                }
                fallbackTried = true;
                page.addLog('[扫描] 未发现设备，尝试全量扫描（不带 services 过滤）');
                await callWx(wx.stopBluetoothDevicesDiscovery, {}).catch(() => undefined);
                await new Promise((resolve) => setTimeout(resolve, 200));
                try {
                    await startScan(false);
                }
                catch (err) {
                    page.addLog('[扫描] 全量扫描启动失败：' + formatError(err));
                }
            };
            const logDevice = (device) => {
                if (!device)
                    return;
                const cacheKey = device.deviceId || `${device.name || ''}-${discovered.length}`;
                if (debugSeen.has(cacheKey))
                    return;
                debugSeen.add(cacheKey);
                const localName = device && device && typeof device.localName === 'string'
                    ? device.localName
                    : undefined;
                const advertisData = device && device && device.advertisData;
                const advertisPreview = advertisData ? previewHex((0, lockBiz_1.bufferToHex)(advertisData), 40) : '无广播';
                const rssi = typeof device.RSSI === 'number' ? device.RSSI : 'NA';
                const advLen = advertisData && typeof advertisData.byteLength === 'number'
                    ? advertisData.byteLength
                    : 0;
                page.addLog(`发现设备: ${device.name || localName || '未知'} | ${device.deviceId} | RSSI=${rssi} | advLen=${advLen} | adv=${advertisPreview}`);
            };
            const listener = (res) => {
                if (!res.devices)
                    return;
                if (!seenAny && res.devices.length) {
                    seenAny = true;
                }
                for (const device of res.devices) {
                    logDevice(device);
                    discovered.push(device);
                    if (matchDevice(device)) {
                        cleanup();
                        resolve(device);
                        break;
                    }
                }
            };
            const matchDevice = (device) => {
                if (!device)
                    return false;
                const deviceId = device.deviceId ? normalizeMacForCompare(device.deviceId) : '';
                if (deviceId && deviceId === target) {
                    return true;
                }
                const altName = device && device && typeof device.localName === 'string'
                    ? device.localName
                    : '';
                const name = ((device && device.name) || altName || '').toUpperCase();
                if (name && targetName && name === targetName) {
                    page.addLog(`匹配成功: 蓝牙名称=${name} deviceId=${device.deviceId}`);
                    return true;
                }
                const advertisData = device && device && device.advertisData;
                if (advertisData) {
                    const advertisHex = (0, lockBiz_1.bufferToHex)(advertisData);
                    if (target && advertisHex.includes(target)) {
                        page.addLog(`匹配成功: 广播包含目标 MAC deviceId=${device.deviceId}`);
                        return true;
                    }
                    if (reversed && advertisHex.includes(reversed)) {
                        page.addLog(`匹配成功: 广播包含反序 MAC deviceId=${device.deviceId}`);
                        return true;
                    }
                    if (targetNameHex && advertisHex.includes(targetNameHex)) {
                        page.addLog(`匹配成功: 广播包含蓝牙名称 ASCII deviceId=${device.deviceId}`);
                        return true;
                    }
                }
                return false;
            };
            const cleanup = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                if (fallbackTimer) {
                    clearTimeout(fallbackTimer);
                    fallbackTimer = null;
                }
                wx.offBluetoothDeviceFound();
                if (self._activeScanCancel === cancelScan) {
                    self._activeScanCancel = null;
                }
                self._deviceFoundListener = null;
                self._lastScanDevices = discovered;
                page.addLog(`停止扫描，共发现设备 ${discovered.length} 个，耗时 ${Date.now() - scanStartedAt}ms`);
                callWx(wx.stopBluetoothDevicesDiscovery, {}).catch(() => undefined);
            };
            const cancelScan = () => {
                if (settled) {
                    return;
                }
                page.addLog('[扫描] 已中断');
                cleanup();
                reject(new Error(FLOW_ABORT_MESSAGE));
            };
            self._activeScanCancel = cancelScan;
            self._deviceFoundListener = listener;
            wx.onBluetoothDeviceFound(listener);
            fallbackTimer = setTimeout(() => {
                triggerFallback().catch((err) => {
                    page.addLog('[扫描] 全量扫描异常：' + formatError(err));
                });
            }, fallbackDelay);
        });
    },
    async connectDevice(deviceId, timeout = 8000) {
        const self = this;
        const start = Date.now();
        this.addLog(`[连接] 发起连接 deviceId=${deviceId} timeout=${timeout}ms`);
        await callWx(wx.createBLEConnection, {
            deviceId,
            timeout
        });
        self._currentDeviceId = deviceId;
        this.addLog(`[连接] 连接成功 deviceId=${deviceId} 耗时 ${Date.now() - start}ms`);
    },
    async prepareChannel(deviceId) {
        const start = Date.now();
        const servicesRes = await callWx(wx.getBLEDeviceServices, {
            deviceId
        });
        const services = servicesRes.services || [];
        this.addLog(`[服务] 查询完成，服务数=${services.length}`);
        const service = services.find((item) => SERVICE_CANDIDATES.includes(item.uuid.toLowerCase()));
        if (!service) {
            throw new Error('未找到目标蓝牙服务，请确认门锁已开启蓝牙广播');
        }
        this.addLog(`[服务] 命中服务 serviceId=${service.uuid}`);
        const characteristicsRes = await callWx(wx.getBLEDeviceCharacteristics, {
            deviceId,
            serviceId: service.uuid
        });
        const characteristics = characteristicsRes.characteristics || [];
        const readable = characteristics.find((item) => item.properties.read);
        const writable = characteristics.find((item) => item.properties.write || item.properties.writeNoResponse);
        const notifyIds = characteristics
            .filter((item) => item.properties.notify || item.properties.indicate)
            .map((item) => item.uuid);
        this.addLog(`[特征] 总数=${characteristics.length} read=${readable ? readable.uuid : '-'} write=${writable ? writable.uuid : '-'} notifyCount=${notifyIds.length}`);
        if (!readable || !writable) {
            throw new Error('未找到可读写的蓝牙特征');
        }
        const self = this;
        self._serviceId = service.uuid;
        self._readId = readable.uuid;
        self._writeId = writable.uuid;
        self._notifyIds = notifyIds;
        this.addLog(`[特征] 通道准备完成，耗时 ${Date.now() - start}ms`);
        return {
            serviceId: service.uuid,
            readId: readable.uuid,
            writeId: writable.uuid,
            notifyIds
        };
    },
    async enableNotifications(deviceId, serviceId, notifyIds) {
        this.addLog(`[通知] 开始订阅 notify 特征，数量=${notifyIds.length}`);
        for (const characteristicId of notifyIds) {
            try {
                await callWx(wx.notifyBLECharacteristicValueChange, {
                    deviceId,
                    serviceId,
                    characteristicId,
                    state: true
                });
                this.addLog(`[通知] 已订阅 characteristicId=${characteristicId}`);
            }
            catch (err) {
                this.addLog(`[通知] 订阅失败 characteristicId=${characteristicId} ${formatError(err)}`);
            }
        }
    },
    async readSeed(deviceId, serviceId, characteristicId) {
        const self = this;
        this.addLog(`[随机数] 开始读取 characteristicId=${characteristicId}`);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                if (self._stage === 'waitingSeed') {
                    self._stage = 'idle';
                    self._seedResolve = null;
                    self._seedReject = null;
                    reject(new Error('读取蓝牙随机数超时'));
                }
            }, READ_TIMEOUT);
            self._stage = 'waitingSeed';
            self._seedResolve = (buffer) => {
                clearTimeout(timer);
                self._seedResolve = null;
                self._seedReject = null;
                resolve(buffer);
            };
            self._seedReject = (error) => {
                clearTimeout(timer);
                self._seedResolve = null;
                self._seedReject = null;
                self._stage = 'idle';
                if (error instanceof Error) {
                    reject(error);
                }
                else {
                    const message = error && error && typeof error.errMsg === 'string'
                        ? error.errMsg
                        : '读取失败';
                    reject(new Error(message));
                }
            };
            callWx(wx.readBLECharacteristicValue, {
                deviceId,
                serviceId,
                characteristicId
            }).catch((err) => self._seedReject && self._seedReject(err));
        });
    },
    async writeCommand(deviceId, serviceId, characteristicId, command) {
        this.addLog(`[写入] characteristicId=${characteristicId} bytes=${command.length}`);
        await callWx(wx.writeBLECharacteristicValue, {
            deviceId,
            serviceId,
            characteristicId,
            value: (0, lockBiz_1.sliceBuffer)(command)
        });
        this.addLog(`[写入] 完成 characteristicId=${characteristicId}`);
    },
    waitForAck() {
        const self = this;
        this.addLog(`[等待] 开始等待门锁回执，timeout=${FLOW_TIMEOUT}ms`);
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.clearAckTimer();
                if (self._stage === 'waitingAck') {
                    self._ackResolve = null;
                    self._stage = 'idle';
                    this.addLog('[等待] 超时，未收到最终回执');
                    resolve(null);
                }
            }, FLOW_TIMEOUT);
            self._stage = 'waitingAck';
            self._ackResolve = (buffer) => {
                clearTimeout(timer);
                this.clearAckTimer();
                self._ackResolve = null;
                self._stage = 'idle';
                resolve(buffer);
            };
        });
    },
    handleValueChange(res) {
        const self = this;
        if (!res.value)
            return;
        const hex = (0, lockBiz_1.bufferToHex)(res.value).toUpperCase();
        if (self._stage === 'waitingSeed' && self._seedResolve) {
            const resolver = self._seedResolve;
            self._seedResolve = null;
            self._stage = 'idle';
            this.addLog(`[随机数] 读取成功 len=${res.value.byteLength}B value=${previewHex(hex)}`);
            resolver(res.value);
            return;
        }
        this.addLog(`收到通知：[stage=${self._stage || 'idle'} len=${res.value.byteLength}B] ${previewHex(hex)}`);
        this.processBleNotification(hex, res.value).catch((err) => {
            const message = err instanceof Error ? err.message : formatError(err);
            this.addLog('处理通知异常：' + message);
        });
    },
    async cleanupBluetooth() {
        const self = this;
        const now = Date.now();
        const suppressLog = self._cleanupLoggedAt && now - self._cleanupLoggedAt < 800;
        if (!suppressLog) {
            self._cleanupLoggedAt = now;
            this.addLog('[清理] 开始释放蓝牙资源');
        }
        this.clearAckTimer();
        self._activeScanCancel = null;
        if (self._deviceFoundListener) {
            wx.offBluetoothDeviceFound();
            self._deviceFoundListener = null;
        }
        await callWx(wx.stopBluetoothDevicesDiscovery, {}).catch(() => undefined);
        if (self._currentDeviceId) {
            await callWx(wx.closeBLEConnection, {
                deviceId: self._currentDeviceId
            }).catch(() => undefined);
            self._currentDeviceId = undefined;
        }
        await callWx(wx.closeBluetoothAdapter, {}).catch(() => undefined);
        self._stage = 'idle';
        self._seedResolve = null;
        self._seedReject = null;
        self._ackResolve = null;
        self._randomSeed = null;
        if (!suppressLog) {
            this.addLog('[清理] 蓝牙资源释放完成');
        }
    }
});
