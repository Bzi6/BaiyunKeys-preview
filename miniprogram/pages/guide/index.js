"use strict";
Page({
    data: {
        manualExpanded: false,
        autoExpanded: false,
        captureExpanded: false
    },
    onLoad() {
        wx.showShareMenu({
            menus: ['shareAppMessage', 'shareTimeline']
        });
    },
    onShow() {
        const tabBar = this.getTabBar?.();
        if (tabBar && typeof tabBar.setSelected === 'function') {
            tabBar.setSelected(2);
        }
        else if (tabBar && typeof tabBar.setData === 'function') {
            tabBar.setData({ selected: 2, selectedPath: '/pages/guide/index' });
        }
    },
    onToggleManual() {
        this.setData({ manualExpanded: !this.data.manualExpanded });
    },
    onToggleAuto() {
        this.setData({ autoExpanded: !this.data.autoExpanded });
    },
    onToggleCapture() {
        this.setData({ captureExpanded: !this.data.captureExpanded });
    },
    onMailTap(event) {
        const mail = event.currentTarget.dataset.mail;
        if (!mail) {
            wx.showToast({ title: '无法识别邮箱地址', icon: 'none' });
            return;
        }
        wx.setClipboardData({
            data: mail,
            success: () => wx.showToast({ title: '邮箱已复制', icon: 'none' })
        });
    },
    onIssueTap(event) {
        const url = event.currentTarget.dataset.url;
        if (!url) {
            wx.showToast({ title: '链接不可用', icon: 'none' });
            return;
        }
        wx.setClipboardData({
            data: url,
            success: () => {
                wx.showModal({
                    title: '即将打开链接',
                    content: '链接已复制，请在浏览器中粘贴访问。',
                    showCancel: false,
                    confirmText: '知道了'
                });
            }
        });
    },
    onShareAppMessage() {
        return {
            title: 'BaiyunKeys',
            path: '/pages/guide/index'
        };
    },
    onShareTimeline() {
        return {
            title: 'BaiyunKeys'
        };
    }
});
