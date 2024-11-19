// pages/home/home.js
Page({
    data: {
        title: "Welcome to Mini Program", // 页面标题
        userInfo: null,                   // 用户信息
        hasUserInfo: false,               // 用户信息是否已获取
        canIUseGetUserProfile: false      // 是否可以使用 getUserProfile API
    },

    // 页面加载时的生命周期函数
    onLoad() {
        a=1;
        b=a;
        // 检查是否可以使用 getUserProfile
        if (wx.getUserProfile) {
            this.setData({
                canIUseGetUserProfile: true

            });
            this.navigateToSettings();
        }
    },

    // 获取用户信息的回调
    getUserProfile(e) {
        wx.getUserProfile({
            desc: "用于展示用户信息",
            success: (res) => {
                this.setData({
                    userInfo: res.userInfo,
                    hasUserInfo: true
                });
            },
            fail: (err) => {
                console.error("获取用户信息失败", err);
            }
        });
    },

    // 简单的事件处理函数
    navigateToSettings() {
        wx.navigateTo({
            url: '/pages/settings/settings'
        });
    }
});
