// 解析 navigator 组件，提取 wx:if 和 url
import {now_page, selfurl2navurl} from "../../shared";

export function getNavigatorData(body: HTMLElement): { url: string, ifCondition: string | null }[] {
    const navigatorTags = body.getElementsByTagName('navigator'); // 获取所有 navigator 标签
    const navigatorData: { url: string, ifCondition: string | null }[] = [];
    let n=now_page
    for (let i = 0; i < navigatorTags.length; i++) {
        const navigatorTag = navigatorTags[i];

        // 提取 url 属性
        const url = navigatorTag.getAttribute('url');

        // 提取 wx:if 条件
        const wxIfCondition = navigatorTag.getAttribute('wx:if');

        // 处理 wx:if 中的变量，去掉 {{}} 包裹
        let processedIfCondition = null;
        if (wxIfCondition) {
            processedIfCondition = wxIfCondition.replace(/^{{(.*)}}$/, '$1').trim(); // 去掉 {{}} 的包裹
        }

        // 确保有 url 属性才处理
        if (url) {
            navigatorData.push({
                url: url.trim(),
                ifCondition: processedIfCondition, // 使用处理后的 wx:if 条件
            });

            selfurl2navurl.push([now_page,url.trim()])
        }
    }

    return navigatorData;
}
