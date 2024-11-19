function checkAndAssign(value) {
    let result;

    // 如果传入的值大于 10，则赋值为 "大于 10"
    if (value > 10) {
        result = "大于 10";
    } else {
        result = "小于或等于 10";
    }

    return result;
}