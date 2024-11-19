import {Taint, TaintType} from './TaintTracker/interfaces/taint';
import {
    cfg_filealise,
    getNestControlEdge,
    locateSinkCalls as initializeWorklist
} from './TaintTracker/worklist/interProcedural';
import {taintImplicitFlow} from './TaintTracker/worklist/interProcedural';

import {Helper} from './TaintTracker/worklist/helper';
import {runWorklist} from './TaintTracker/worklist/taintedAssignments/taintedAssignments';
import {initConfig} from './utils/config';
import {performAliasSearch} from './TaintTracker/functionAliasSearch/functionAliasMap';
import {extraPasses} from './TaintTracker/asyncFlow/callbackPass';
import {
    multiPageOutput,
    singlePageOutput,
} from './TaintTracker/util/leakage/leakagePrinter';
import {MiniProgram, Page} from './utils/interface/miniProgram';
import {processAndParsePage} from './TaintTracker/util/frontEnd';
import {loadEntireApp, loadSinglePage} from './utils/miniProgramLoader';
import {commander} from './utils/cli';
import {initLogger, logger} from './utils/logHelper';
import {dealUtilJs} from './UtilAnalyzer/exportAnalysis/utilsTracker';
import {initSourceAndSink} from './TaintTracker/util/sourceAndSinkHelper';
import {shutdown as logShutdown} from 'log4js';
import {
    convertToCompactGlobalFlowTable,
    generateDataFlow,
    generateGlobalDataFlow,
} from './TaintTracker/util/leakage/leakageGenerator';
import {
    AppAnalysisResult,
    DataLeakage,
    GlobalDataLeakage,
    GlobalDataLeakageCompact,
    PageAnalysisResult,
} from './TaintTracker/util/leakage/interface';
import {dealGetApp} from './UtilAnalyzer/getAppAnalysis/getAppAnalysis';
import * as fs from 'fs';
import {pagefun2caller, now_page, page_handler_map, temp_page2url, getNavUrl} from "./shared";

// export let utilFuncNameToActualFuncName: Map<string, string>;
let blockNodes = []
//hinder selfurl bindfun
let blockWidge = []
export class TrackingManager {
    pageResults: Array<PageAnalysisResult>;
    globalFlow: Map<string, Array<GlobalDataLeakageCompact>>;
    rootdir: string;
    moduleAnalysis: {
        utilLibToPath: Map<string, string>;
        utilNameToAPIName: Map<string, string>;
        utilAnalysisMode: boolean;
        getAppAnalysisMode: boolean;
        utilLocalFlows: Array<PageAnalysisResult>;
    };

    constructor() {
        this.pageResults = new Array();
        this.globalFlow = new Map();
        this.moduleAnalysis = {
            utilLibToPath: new Map(),
            utilNameToAPIName: new Map(),
            utilAnalysisMode: false,
            getAppAnalysisMode: false,
            utilLocalFlows: new Array(),
        };
        this.rootdir = '';
    }

    public getActualName(name: string) {
        let actualName = this.moduleAnalysis.utilNameToAPIName.get(name);
        while (this.moduleAnalysis.utilNameToAPIName.has(actualName)) {
            actualName = this.moduleAnalysis.utilNameToAPIName.get(actualName);
        }

        return actualName;
    }
}

export function multiPagesWorklist(
    miniapp: MiniProgram,
    manager: TrackingManager
): AppAnalysisResult {
    logger.info(`Analyzing app.js`);
    dealGetApp(miniapp.app, manager);
    const result = singlePageWorklist(miniapp.app, manager);
    if (result.localDataLeaks) {
        manager.pageResults.push(result);
    }
    if (result.globalDataFlows) {
        convertToCompactGlobalFlowTable(
            result.globalDataFlows,
            result.page.name,
            miniapp.app.dir,
            manager.globalFlow
        );
    }
    //遍历各个page
    for (const page of miniapp.pages) {
        const result = singlePageWorklist(page, manager);
        if (!result || !result.localDataLeaks) {
            continue;
        }
        manager.pageResults.push(result);
        convertToCompactGlobalFlowTable(
            result.globalDataFlows,
            result.page.name,
            page.dir,
            manager.globalFlow
        );
    }
    //开始了
    let init=blockNodes
    let node2neibor = getAllblockNodes(init)
    let findresult={r1:node2neibor,r2:blockWidge}
    return {
        pageResults: manager.pageResults.concat(
            manager.moduleAnalysis.utilLocalFlows
        ),
        flowTable: manager.globalFlow,
    };
}

function isSamePath(path1, path2) {
    if (path1.length !== path2.length) {
        return false
    }
    let p1_s = path1.source.uniqueName
    let p1_t = path1.sink.uniqueName
    let p2_s = path2.source.uniqueName
    let p2_t = path2.sink.uniqueName
    return p1_s === p2_s && p1_t === p2_t;

}

function isInputSourcePath(path) {
    let source = path.source
    let func = source.currentFunction
    let taintName = source.name
    let alises = cfg_filealise.aliasMap.getAllAliases(func.name)
    let funcName = cfg_filealise.aliasMap.getNameByAlias(func.name)
    let page_handlers = page_handler_map[now_page]
    if (taintName.includes('event')) {
        for (let handler of page_handlers) {
            for (let alis of alises) {
                if (alis.includes(handler)) {
                    return true
                }
            }
        }
    }
    return false
}

function isInputSourceTaint(taint) {
    let source = taint
    let func = source.currentFunction
    let taintName = source.name
    let alises = cfg_filealise.aliasMap.getAllAliases(func.name)
    let funcName = cfg_filealise.aliasMap.getNameByAlias(func.name)
    let page_handlers = page_handler_map[now_page]
    if (taintName.includes('event')) {
        for (let handler of page_handlers) {
            for (let alis of alises) {
                if (alis.includes(handler)) {
                    return true
                }
            }
        }
    }
    return false
}

function isSamePathInArray(path1, paths) {
    for (let path of paths) {
        if (isSamePath(path1, path)) {
            return true
        }
    }
    return false
}

export function singlePageWorklist(
    page: Page,
    manager: TrackingManager
): PageAnalysisResult | null {
    logger.info(`Analyzing page: ${page.name}`);
    // @ts-ignore
    now_page = page.name
    if (!fs.existsSync(page.dir + '.js')) {
        logger.error(
            `Page or component directory ${page.dir + '.js'} does not exist.`
        );
        return <PageAnalysisResult>{
            page: page,
            localDataLeaks: null,
            globalDataFlows: null,
            componentAnalysisResult: null,
        };
    }
    try {
        const componentAnalysisResult = new Array<PageAnalysisResult>();
        if (!page.isComponent) {
            for (let component of page.components) {
                logger.info(`Analyzing component: ${component.name}`);
                componentAnalysisResult.push(singlePageWorklist(component, manager));
            }
        }

        // get cfg
        if (page.js === undefined || page.js === '') {
            logger.warn(`Empty page js ${page.name}. Skipping.`);
            return <PageAnalysisResult>{
                page: page,
                localDataLeaks: null,
                globalDataFlows: null,
                componentAnalysisResult: null,
            };
        }
        // parse page
        page.cfg = processAndParsePage(page);

        // first pass: alias search
        logger.info('Performing alias search.');
        performAliasSearch(page);

        // second pass: cfg minor modifications
        logger.info('Performing second pass.');
        extraPasses(page.cfg, page.funcAliasMap, page.filepath);

        // third pass: initialize worklist
        const helper = new Helper();
        if (manager) {
            helper.manager = manager;
        }
        logger.info('Initializing worklist.');
        initializeWorklist(page.cfg, helper, page.funcAliasMap);

        // analysis stage: worklist algorithm
        runWorklist(helper, page);
        logger.info('Done!');
        var truePath = []
        let globalDataFlows = new Array<GlobalDataLeakage>();
        let localDataLeaks = new Array<DataLeakage>();
        for (const taintFlow of helper.dep) {
            if (
                taintFlow.source === null ||
                taintFlow.source?.type === TaintType.global
            ) {
                globalDataFlows = globalDataFlows.concat(
                    generateGlobalDataFlow(taintFlow.source ?? taintFlow.target)
                );
            }
            if (taintFlow.source === null
            ) {
                if (taintFlow.target?.type === TaintType.implicit) {
                    let isChanged = false
                    //终结的 和out的
                    let init = 1
                    let finishPath = []
                    let concatPath = []
                    let concatPathList = []
                    while (isChanged || init === 1) {
                        isChanged = false
                        init = 0
                        let pathes = generateDataFlow(taintFlow.target, true)
                        for (let path of pathes) {
                            let isInputPath = isInputSourcePath(path);
                            let isSamePath = isSamePathInArray(path, finishPath);
                            let isSourceTaint = path.source.endsAtSource
                            if (!isInputPath && !isSamePath && !isSourceTaint) {
                                //参数优化 source加入连起来 不用null
                                taintImplicitFlow(path.source.currentFunction, path.source.controlFlowEdge, helper, path.source)
                                if (helper.worklist.length > 0) {
                                    //let taint = helper.worklist.pop()
                                    //taintImplicitFlow(path.source.currentFunction,path.source.controlFlowEdge,helper)
                                    //let sourceTaint = taint.endsAtSource
                                    //if (!sourceTaint&&!isInputSourceTaint(taint)) {
                                    runWorklist(helper, page)
                                    //有新增taint结点 得迭代
                                    //let is_new_gen = helper.worklist.length > 0
                                    //if (is_new_gen) {
                                    isChanged = true
                                }
                                //taintImplicitFlow后没有变化
                                else {
                                    //out 超过入口
                                    //todo 是否是用户输入之类
                                    finishPath.push(path)
                                    //truePath.push(path)
                                }
                            } else if (isSourceTaint || isInputPath) {
                                truePath.push(path)
                                finishPath.push(path)
                            }
                        }
                    }
                    //输出
                    //truePath.forEach((path) => {
                   // printTPath(truePath)
                    // })
                } else {
                    localDataLeaks = localDataLeaks.concat(
                        generateDataFlow(taintFlow.target)
                    );
                }
            }
        }
        printTPath(truePath)



        //todo 初始化blockNode
        for (let path of truePath) {
            //let hinder=path.source.name
            let pageurl=now_page
            //阻碍了nav还是控件
            let hinder=path.source.auth
            //如果是nav的话
            let navurl=path.sink.url
            let widgetinfo=path.sink.isVariable
            if (navurl){
                blockNodes.push([hinder,pageurl,navurl])
            }
            if (widgetinfo){
                blockWidge.push([hinder,pageurl,widgetinfo])
            }
        }
        let pf2call = pagefun2caller
        let queue = [...pagefun2caller.keys()]
        let effectList = ["wx.navigateTo", "wx.redirectTo", "wx.switchTab", "wx.navigateBack"]
        queue = queue.filter((func) => {
            for (let effect of effectList) {
                if (func[1].includes(effect)) {
                    return true
                }
            }
        })
        let nav2pagecallfunc = findTopLevelCallerForTargets(pf2call, queue)
        let tripletList = []
        nav2pagecallfunc.forEach((value, key) => {
            let regex = /\(([^)]+)\)/;

            let temp = key[1].match(regex)[1]
            let url = temp_page2url.get(temp)
            let t = temp_page2url
            tripletList.push([value, key[0], url])
        })
        let node2neibor = retrieveNeiborNodes(tripletList)
        return <PageAnalysisResult>{
            page: page,
            localDataLeaks: localDataLeaks,
            globalDataFlows: globalDataFlows,
            componentAnalysisResult: componentAnalysisResult,
        };
    } catch (e) {
        logger.error(`Page or component ${page.name} has error: ${e.stack}`);
        return <PageAnalysisResult>{
            page: page,
            localDataLeaks: null,
            globalDataFlows: null,
            componentAnalysisResult: null,
        };
    }
}

function retrieveNeiborNodes(tripletList) {
    let node2neibor = new Map<any, any[]>()
    for (let triplet of tripletList) {
        let selfurl = triplet[1]
        let navurl = triplet[2]
        let neibor = tripletList.filter((triplet) => {
            return triplet[1] === navurl
        })
        neibor = neibor.length > 0 ? neibor : ["", navurl, ""];
        if (!node2neibor.get(triplet)) {
            node2neibor.set(triplet, neibor)
        } else {
            let old = node2neibor.get(triplet)
            old.push(neibor)
        }

    }
    return node2neibor
}

function findTopLevelCallerForTargets(functionToCallerMap, targetFunctions) {
    const result = new Map(); // 使用 Map 存储每个目标函数和最外层调用者的二元组

    for (const pfunc of targetFunctions) {
        let currentCaller = functionToCallerMap.get(pfunc); // 获取直接调用者

        // 循环查找直到没有上层调用者
        while (currentCaller && functionToCallerMap.has(currentCaller)) {
            currentCaller = functionToCallerMap.get(currentCaller);
        }

        // 将 pfunc 和最外层调用者 (currentCaller) 加入 Map
        result.set(pfunc, currentCaller || null);
    }

    return result;
}

function getAllblockNodes(blockNodes) {
    let done = []
    let init = JSON.parse(JSON.stringify(blockNodes))
    let len = init.length
    let node2effectnode = new Map()
    for (let i = 0; i < len; i++) {
        let worklist = []
        worklist.push(init[i][1])
        let effects =[]
        while (worklist.length > 0) {
            effects=[]
            let node = worklist.pop()
            if (!done.includes(node)) {
                let neibors = getNavUrl(node)
                if (neibors && neibors.length > 0) {
                    worklist.concat(neibors)
                    effects.concat(neibors)
                    done.push(neibors)
                }
            }
        }
        node2effectnode.set(init[i],effects)
    }
    return node2effectnode
}

function findAffectedPaths(graph, blockNodes) {
    const affectedPaths = [];           // 存储所有受阻路径
    const affectedNodes = new Set();     // 存储受影响的节点
    const visited = new Set();           // 防止重复遍历
    const disconnectedNodes = new Set(); // 存储所有无法连通的节点
    function dfs(node, path) {
        // 如果节点已访问过，或是阻碍节点，直接返回
        if (visited.has(node) || blockNodes.has(node)) return;

        // 标记节点为已访问
        visited.add(node);
        path.push(node);

        // 若当前节点的邻接节点为空，则结束路径并记录
        if (graph[node] === undefined || graph[node].length === 0) {
            affectedPaths.push([...path]);
            path.pop();
            return;
        }

        // 对每个邻接节点进行深度遍历
        for (let neighbor of graph[node]) {
            if (!blockNodes.has(neighbor)) {
                dfs(neighbor, path);
            } else {
                // 若邻接节点是阻碍节点，则记录当前路径并终止该分支
                affectedPaths.push([...path]);
                for (let p of path) affectedNodes.add(p); // 修正：逐个添加节点到affectedNodes
            }
        }
        path.pop();
    }

    // 从每个阻碍节点开始搜索，记录受阻路径和受阻节点
    for (let blockNode of blockNodes) {
        dfs(blockNode, []);
    }

    // 识别所有无法连通的节点
    for (let node in graph) {
        if (!visited.has(node) && !affectedNodes.has(node)) {
            disconnectedNodes.add(node);
        }
    }

    return {
        affectedPaths,
        affectedNodes: Array.from(affectedNodes),
        disconnectedNodes: Array.from(disconnectedNodes),
    };
}


function printTPath(path) {
    let str = ''
    for (let p of path) {
        str += p.source.uniqueName + '->'
        if (p.impath) {
            let pathL = p.impath
            for (let i = 0; i < pathL.length; i++) {
                let edge = pathL[i].edge
                let func = pathL[i].func
                str += "path in is " + func.name + " " + edge.label + "->"
            }
        }
        console.log("隐式路径是" + str)
        return str
    }
    console.log(str)

}

function run() {
    const commandOption = commander();
    initConfig(commandOption);
    initLogger(commandOption);
    initSourceAndSink();

    try {
        if (commandOption.fileType === 'single') {
            const page = loadSinglePage();
            const result = singlePageWorklist(page, null);
            singlePageOutput(result);
        } else if (commandOption.fileType === 'all') {
            const S_PER_NS = 1e-9;
            const NS_PER_SEC = 1e9;
            const time = process.hrtime();

            const app = loadEntireApp();
            const manager = new TrackingManager();
            manager.rootdir = app.dir;
            dealUtilJs(app, manager);
            const results = multiPagesWorklist(app, manager);
            multiPageOutput(results, manager);

            const diff = process.hrtime(time);
            const time_elapsed = (diff[0] * NS_PER_SEC + diff[1]) * S_PER_NS;
            const mins = Math.floor(time_elapsed / 60);
            const secs = (time_elapsed % 60).toFixed(2);
            logger.info(`Time Elapsed: ${mins} min ${secs} sec.`);
        }
    } catch (e) {
        logger.error(e);
    } finally {
        logShutdown();
    }
}

if (require.main === module) {
    run();
}
