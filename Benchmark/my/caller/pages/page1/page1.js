// pages/page1/page1.js

/**
 * caller: positive example
 *
 * @description The sensitive information is stored in an object which is sent.
 * @dataflow source -> info1 -> a.b -> sink
 * @number_of_leaks 1
 */


Page({
    data: {},
    onshow: function() {
        this.fun1();
    },
    fun1: function() {
        console.log("fun1");
    }
})
