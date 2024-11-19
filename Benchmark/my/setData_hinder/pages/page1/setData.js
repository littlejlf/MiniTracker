// pages/page1/page1.js

/**
 * General3: positive leakage with if statement
 *
 * @description Sync function positive leakage with if statement
 * @dataflow onshow: source -> info -> sink
 * @number_of_leaks 1
 */

Page({
    data: {canClick: true},
    onshow: function() {
        wx.getLocation({ // source
            type: 'wgs84',
            success: (res) =>{

            },
            fail: (err) =>{
              this.setData({
                canClick: false
              });
            }
        })
    },

    onButtonClick: function() {
                console.log('Button clicked and do something');
        }

})
