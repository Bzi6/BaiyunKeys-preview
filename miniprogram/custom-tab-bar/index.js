Component({
  data: {
    selected: 0,
    selectedPath: '/pages/index/index',
    tabs: [
      {
        key: 'home',
        pagePath: '/pages/index/index',
        text: '首页',
        iconPath: '/images/house.png',
        selectedIconPath: '/images/house1.png'
      },
      {
        key: 'config',
        pagePath: '/pages/config/index',
        text: '配置',
        iconPath: '/images/Icon1.png',
        selectedIconPath: '/images/Icon2.png'
      },
      {
        key: 'guide',
        pagePath: '/pages/guide/index',
        text: '帮助',
        iconPath: '/images/Icon3.png',
        selectedIconPath: '/images/Icon4.png'
      }
    ]
  },
  lifetimes: {
    attached() {
      this.syncSelected()
      setTimeout(() => this.syncSelected(), 80)
      setTimeout(() => this.syncSelected(), 240)
    }
  },
  pageLifetimes: {
    show() {
      this.syncSelected()
    }
  },
  methods: {
    getCurrentPath() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      return current && current.route ? `/${current.route}` : ''
    },
    syncSelected() {
      const route = this.getCurrentPath()
      const selected = this.data.tabs.findIndex((item) => item.pagePath === route)
      if (selected >= 0) {
        const nextPath = this.data.tabs[selected].pagePath
        if (selected !== this.data.selected || nextPath !== this.data.selectedPath) {
          this.setData({ selected, selectedPath: nextPath })
        }
      }
    },
    setSelected(index) {
      const selected = Number(index)
      if (!Number.isFinite(selected) || selected < 0 || selected >= this.data.tabs.length) {
        this.syncSelected()
        return
      }
      this.setData({
        selected,
        selectedPath: this.data.tabs[selected].pagePath
      })
    },
    onTabTap(event) {
      const { path } = event.currentTarget.dataset || {}
      const currentPath = this.getCurrentPath()
      if (!path) {
        return
      }
      if (currentPath === path) {
        const pages = getCurrentPages()
        const current = pages[pages.length - 1]
        if (current && typeof current.onTabReselect === 'function') {
          current.onTabReselect()
          return
        }
        if (typeof wx.pageScrollTo === 'function') {
          wx.pageScrollTo({
            scrollTop: 0,
            duration: 220
          })
        }
        return
      }
      wx.switchTab({
        url: path,
        fail: () => {
          this.syncSelected()
        }
      })
    }
  }
})
