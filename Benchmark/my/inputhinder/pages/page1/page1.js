Page({
    data: {
        phoneNumber: '' // 存储输入的手机号
    },
    onInput(event) {
        this.setData({
            phoneNumber: event.detail.value
        });
    },
    onNavigate() {
        // 检查手机号是否已输入
        if (this.data.phoneNumber === '') {
            wx.showToast({
                title: '请先输入手机号',
                icon: 'none',
                duration: 2000
            });
        } else {
            // 手机号已输入，进行跳转
            wx.navigateTo({
                url: '/pages/nextPage/nextPage' // 替换成实际的页面路径
            });
        }
    }
});
