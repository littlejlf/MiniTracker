import {HtmlFileInfo} from './fileInfo/htmlFileInfo'
import * as jsdom from "jsdom";
import { getBiBindData, getInputEventHandlers,getNonClickableBindings } from './userInputs';
import { getIfStmts } from './ifStmts';
import * as path from 'path';
import * as fs from 'fs';
import {now_page, page2htmlinfo, page_handler_map, v_bind_map} from "../../shared";
import {getNavigatorData} from "./navigator";

export function parseHtmlFile(htmlFile: string): HtmlFileInfo {
    const htmlFileInfo = new HtmlFileInfo();
    if (htmlFile === undefined || htmlFile === "") {
        return htmlFileInfo;
    }
    const html = new jsdom.JSDOM(htmlFile);
    const body = html.window.document.body;
    htmlFileInfo.hinderVariables = getNonClickableBindings(body);
    // @ts-ignore
    //v_b_map=htmlFileInfo.hinderVariables;
    v_bind_map=htmlFileInfo.hinderVariables;
    htmlFileInfo.navinfo= getNavigatorData(body);
    htmlFileInfo.inputs.userInputs = getBiBindData(body);
    htmlFileInfo.inputs.inputEventHandlers = getInputEventHandlers(body);
    page_handler_map[now_page] = htmlFileInfo.inputs.inputEventHandlers;
    htmlFileInfo.ifStmts = getIfStmts(body);
    page2htmlinfo.set(now_page,htmlFileInfo);
    return htmlFileInfo
}
//测试对于html的预处理
if (require.main === module) {
    const pagePath = path.join("D:\\Users\\Desktop\\MiniTracker\\MiniTracker\\Benchmark\\Specific\\PageAndGlobalData2\\pages\\page1\\page1.wxml"
    );
    let html=fs.readFileSync(pagePath).toString();
    console.log(html);
    const htmlFileInfo = parseHtmlFile(html);
    console.log(htmlFileInfo);
}

