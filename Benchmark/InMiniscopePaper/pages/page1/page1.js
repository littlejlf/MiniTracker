// pages/page1/page1.js

/**

 * Callback 1: simple callback
 *
 * @description The sensitive data is directly passed to a callback function.
 * @dataflow onShow: source -> res -> sink
 * @number_of_leaks 1
 */

Page({
    data: {
        l:1,
        m:2
    },
    onShow:function () {
        let that = this;
        let flag=false
        new Promise((resolve, reject) => {
            wx.getLocation({ // source
                type: 'wgs84',
                success (res) {
                    var t=1
                    resolve(res);
                },
                fail (err) {
                    reject(err);
                }
            })
        }).then(function (data) {
            flag=true
        }).catch(function (err) {
            console.log(err);
        })
        that.wapper(flag)
    },
    wapper:function (f) {
        let urlc="/pages/getSetting/getSetting"
        if (f) {
            //let b=1
            wx.navigateTo({url:urlc})
           // let a = 1;
        }
    }
})
