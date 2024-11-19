import { MultiMap } from 'mnemonist';
import {HtmlFileInfo} from "./PageAnalyzer/htmlParser/fileInfo/htmlFileInfo";
import {FlowEdge} from "./TaintTracker/AFGGenerator/flow";
import * as fs from 'fs';
import * as path from 'path';
let sources = [];
let loadPromise = null;
const filePath = path.join(__dirname, './config/WeChatSourcesAndSinks.json');
// 确保 loadSources 只执行一次

let v_bind_map
let page_handler_map={}
let now_page
let hander_page2widget=new Map()
let now_func=""
let last_func=""
let pagefun2caller =  new MultiMap();
const temp_page2url = new MultiMap();
const selfurl2navurl=[]
const page2htmlinfo=new Map<string,HtmlFileInfo>()
const  page2nav_edge=new Map<string,FlowEdge>()
function getNavUrl(selfurl){
    let result=[]
    for(let i=0;i<selfurl2navurl.length;i++){
        if(selfurl2navurl[i][0]==selfurl){
            result.push(selfurl2navurl[i][1])
        }
    }
    return result
}
function findurlcondition(){
    let nainfo=page2htmlinfo.get(now_page)?.navinfo.filter((item)=>{item.ifCondition!=null})
    return nainfo?nainfo:[]
}
export {page2nav_edge,v_bind_map,page_handler_map,now_page,hander_page2widget,now_func,pagefun2caller,last_func,temp_page2url,selfurl2navurl,getNavUrl,page2htmlinfo,findurlcondition,sources
}