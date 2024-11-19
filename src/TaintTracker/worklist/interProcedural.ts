import * as Styx from '../AFGGenerator/generator';
import * as ESTree from '../AFGGenerator/estree';
import * as Flow from '../AFGGenerator/flow';
import {stringify} from '../AFGGenerator/parser/expressions/stringifier';
import * as flatted from 'flatted';

import {
    Taint,
    TaintedAssignment,
    TaintFlow,
    TaintType,
} from '../interfaces/taint';
import {FuncCallAndAssignment, Helper} from './helper';
import {copyPropertyStack} from '../util/utils';
import {AliasMap} from '../functionAliasSearch/functionAliasMap';
import {
    checkBackwardInclusion,
    splitStringIntoIdentifiers,
} from '../util/stringManip';
import {Config} from '../../utils/config';
import {logger} from '../../utils/logHelper';
import {FlowEdge, FlowFunction, FlowNode} from "../AFGGenerator/generator";
import {BasicJs} from "../../utils/interface/miniProgram";
import * as buffer from "buffer";
import {now_page, page2nav_edge, sources} from "../../shared";
import {createIdentifier} from "../AFGGenerator/estreeFactory";
import {tempVarIdRecorder} from "../AFGGenerator/parser/statements/statement";
import {getSourceAndSink} from "../util/sourceAndSinkHelper";
// 定义并导出一个变量
export let cfg_filealise = {cfg: null, aliasMap: null};
export let pathList = new Array()
let table = tempVarIdRecorder

// 定义并导出一个函数来修改变量
class path {
    funct: any;
    stmt: any;

    constructor(stmt, funct) {
        this.stmt = stmt;
        this.funct = funct;

    }
}

export function taintCallReturnVal(
    cfg: Styx.FlowProgram,
    calleeAliases: string[],
    taintedAssignment: TaintedAssignment,
    helper: Helper,
    taintFrom: Taint
): boolean {
    // the first element of calleeAliases is funcName
    helper.callQueue.push(calleeAliases[0], taintedAssignment.edge, taintFrom.currentFunction);

    let returnValFound = false;
    for (const func of cfg.functions) {
        if (calleeAliases.includes(func.name)) {
            for (const edge of func.flowGraph.edges) {
                if (edge.data?.type === ESTree.NodeType.ReturnStatement) {
                    // find callee's return statement
                    const returnStmt = <ESTree.ReturnStatement>edge.data;
                    // Assert: return statement will return either a literal or an identifier
                    // only mark identifers
                    if (
                        ESTree.isIdentifier(returnStmt.argument) &&
                        returnStmt.argument.name !== 'undefined'
                    ) {
                        returnValFound = true;
                        const identifierTaint = new Taint(
                            returnStmt.argument,
                            TaintType.call,
                            edge.source,
                            edge,
                            func,
                            copyPropertyStack(taintedAssignment.propertyStack)
                        );
                        helper.worklist.push(identifierTaint);
                        taintFrom.nextTaints.push(identifierTaint);
                        helper.dep.push(
                            new TaintFlow(
                                taintFrom,
                                identifierTaint,
                                identifierTaint.currentFunction.name,
                                edge.label
                            )
                        );
                    }
                }
            }
        }
    }
    return returnValFound;
}

export function taintCallParameter(
    cfg: Styx.FlowProgram,
    taintedFunc: Styx.FlowFunction,
    taintedAssignment: TaintedAssignment,
    paramId: number,
    taintFrom: Taint,
    helper: Helper,
    funcAliasMap: AliasMap
) {
    /**
     * some parameters of a function are tainted
     * taint the arguments corresponding to parameters and
     * adds them to worklist.
     */
    const taintedFuncAlias = taintedFunc.name;
    const taintedFuncName = funcAliasMap.getNameByAlias(taintedFuncAlias);

    if (helper.callQueue.exist(taintedFuncName)) {
        const funcCallAndAssignment = helper.callQueue.pop(taintedFuncName);
        taintParameter(funcCallAndAssignment.edge, funcCallAndAssignment.func);
    } else {
        for (const func of cfg.functions) {
            for (const edge of func.flowGraph.edges) {
                if (edge.type === Flow.EdgeType.Epsilon) {
                    continue;
                }
                taintParameter(edge, func);
            }
        }
    }

    function taintParameter(edge: FlowEdge, func: Styx.FlowFunction) {
        const data = edge.data;
        if (data.type === ESTree.NodeType.AssignmentExpression) {
            // Assert: currently all edges we find by bfs are assignments
            const callExpr = <ESTree.AssignmentExpression>edge.data;
            if (callExpr.right.type === ESTree.NodeType.CallExpression) {
                // locate calls to current tainted function
                const currentCallExpr = <ESTree.CallExpression>callExpr.right;
                let currentCallName = funcAliasMap.getNameByAlias(
                    currentCallExpr.callee
                );
                if (stringify(currentCallExpr.callee).startsWith('this')) {
                    // this.xxx(), replace this with what this refers to,
                    // by checking the alias objects of the context function.
                    const contextFuncName = func.name;
                    const contextFuncAliases =
                        funcAliasMap.getAllAliases(contextFuncName);
                    const taintedFuncAliases =
                        funcAliasMap.getAllAliases(taintedFuncName);

                    for (const contextAlias of contextFuncAliases) {
                        const contextObject = contextAlias.split('.', 1)[0];
                        const temp = stringify(currentCallExpr.callee).replace(
                            'this',
                            contextObject
                        );
                        if (taintedFuncAliases.includes(temp)) {
                            currentCallName = funcAliasMap.getNameByAlias(temp);
                        }
                    }
                }
                if (currentCallName === taintedFuncName) {
                    // Assert: all arguments of all call exprs are literals or identifers
                    if (currentCallExpr.arguments.length <= paramId) {
                        return;
                    }
                    const taintedArgument = <ESTree.Identifier>(
                        currentCallExpr.arguments[paramId]
                    );
                    const taintedIdentifer = new Taint(
                        taintedArgument,
                        TaintType.call,
                        edge.source,
                        edge,
                        func,
                        copyPropertyStack(taintedAssignment.propertyStack)
                    );
                    helper.worklist.push(taintedIdentifer);
                    taintFrom.nextTaints.push(taintedIdentifer);
                    helper.dep.push(
                        new TaintFlow(taintFrom, taintedIdentifer, func.name, edge.label)
                    );
                }
            }
        }
    }
}

export function taintSinkArguments(
    func: Styx.FlowFunction,
    edge: Styx.FlowEdge,
    funcArguments: ESTree.Expression[],
    helper: Helper,
    sourceTaint: Taint
) {
    /**
     * This function marks the arguments of a function call as tainted
     * and adds them to worklist.
     */
    for (const argument of funcArguments) {
        // Assert: All arguments are identifiers or literals.
        if (argument.type === ESTree.NodeType.Literal) continue;
        const argIdentifer = <ESTree.Identifier>argument;
        const targetTaint = new Taint(
            argIdentifer,
            TaintType.normal,
            edge.source,
            edge,
            func,
            new Array<ESTree.Identifier>()
        );
        helper.worklist.push(targetTaint);
        sourceTaint?.nextTaints.push(targetTaint);
        helper.dep.push(
            new TaintFlow(sourceTaint, targetTaint, func.name, edge.label)
        );
        logger.debug(
            `[WorkList] Tainted function call argument: ${argIdentifer.name} at ${edge.label}`
        );
    }
}

//找success边 fail边     edge就是navigate()的call flowFunction是callexpression所在的function
// 可能caller 是个innner 经过wapper 才到success 所以可能要递归
//还有就是variable的隐式流是再写一个方法吗
function getSuccessFailEdge(funcAliasMap: AliasMap, flowFunction: FlowFunction, edge: FlowEdge
) {
    let edge_need_if = null;
    let edge_need_su = null;
    let res = getNestCaller_method(flowFunction.name)
    if (res == null) {
        return {edge: null, cate: "no control 到顶了 到了entry"}
    }
    var func = res.func
    var cfg_to_search = res.func.flowGraph
    let calleredge = res.edge
    pathList.push({func: func, edge: calleredge})
    const aliases = funcAliasMap.getAllAliases(flowFunction.name);
    //遍历alias 看是否有success fail 通过把string用.分割看后一部分是否是”success“ 或者"fail"
    for (const alias of aliases) {
        const parts = alias.split('.');
        //没有outer
        if (parts[parts.length - 1] === 'success' || parts[parts.length - 1] === 'fail') {
            let obj_para = parts[0]
            //遍历flowFunction的边
            //todo 应该加入边的参数 然后去比较 不然不能说是最近的
            //success的调用边
            for (const edge of cfg_to_search.edges) {
                //找到success边
                if (edge.type === Styx.EdgeType.Epsilon) {
                    continue;
                }
                const data = edge.data;
                if (data.type === ESTree.NodeType.AssignmentExpression) {
                    const RHSExpr = (<ESTree.AssignmentExpression>data).right
                    if (RHSExpr.type === ESTree.NodeType.CallExpression) {
                        const callExpr = RHSExpr as ESTree.CallExpression;
                        const alias = stringify(callExpr.callee);
                        const name = funcAliasMap.getNameByAlias(alias);
                        //前缀是wx的call表达式且只有一个参数为带有success属性的obj_para
                        if (callExpr.arguments.length == 1 && name.split('.')[0] === 'wx') {
                            const arg = callExpr.arguments[0];
                            if (arg.type === ESTree.NodeType.Identifier) {
                                const id = arg as ESTree.Identifier;
                                if (id.name === obj_para) {
                                    //return edge;
                                    edge_need_su = edge
                                    pathList.push({func: func, edge: edge})
                                    break
                                }
                            }
                        }
                    }

                }

            }
            // if (edge_need_if!=null ){
            //     return {edge:edge_need_if,cate:'if'}
            // }
            if (edge_need_su != null) {
                return {edge: edge_need_su, cate: 'success'}
            }
            break
        }

    }
    //关于promise
    if (calleredge?.promise?.cate === 'then') {
        let p_edge = calleredge.promise.promiseEdge
        let funName = findFunfromEdge(p_edge)
        let func = cfg_filealise.cfg.functions.find((func) => func.name === funName);
        let flowGraph = func ? func.flowGraph : null;
        let asfun = fndAsyncallerInFunc(flowGraph)
        return {edge: asfun, cate: "then"}
    }
    //if的条件边
    edge_need_if = getNestConditionalEdgesincfg(calleredge.source, calleredge.source)
    if (edge_need_if != null) {
        return {edge: edge_need_if, cate: 'if'}
    }
    return getSuccessFailEdge(funcAliasMap, func, calleredge)
}

function isConected(ift_t: FlowNode, ifn_n: FlowNode, t_node: FlowNode) {
    //ift_n,ift_y向下遍历 到ifn_n 是否存在相同的结点
    let s1 = ift_t
    let s2 = ifn_n
    // let visited_1 = new Set<FlowNode>();
    // let visited_2 = new Set<FlowNode>();
    while (s1.outgoingEdges != null && s1.outgoingEdges.length != 0 && s1 != t_node) {
        s1 = s1.outgoingEdges[0].target
        //  visited_1.add(s1)
    }
    while (s2.outgoingEdges != null && s2.outgoingEdges.length != 0 && s2 != t_node) {
        s2 = s2.outgoingEdges[0].target
        //visited_2.add(s2)
    }
    return !(s1 == s2 && s1 == t_node)
}

//找条件边
function getNestConditionalEdgesincfg(currentNode, t_node) {
    if (currentNode.incomingEdges.length === 0) {
        return null;
    }
    // 首先检查当前节点的传入边
    for (const edge of currentNode.incomingEdges) {
        var branches = new Array()
        if (edge.type === Styx.EdgeType.Conditional) {
            //而且要是分叉 要在汇合点之前 否则应该返回null
            edge.source.outgoingEdges.forEach((e) => {
                branches.push(e.target)
            })
            let branch = branches.entries().next()
            if (isConected(branches.pop(), branches.pop(), t_node))
                return edge; // 找到条件边，直接返回
        }
    }
    // 如果没有找到条件边，检查所有传入边的源节点
    for (const edge of currentNode.incomingEdges) {
        const parentNode = edge.source; // 获取源节点
        const result = getNestConditionalEdgesincfg(parentNode, t_node); // 递归查找
        if (result) {
            return result; // 找到条件边则返回
        }
    }

    // 如果没有找到条件边，返回 null
    return null;
}

//func:wx.navigateTo在的那个function currentNode: navigateTo assign的source节点
export function getNestControlEdge(func, currentNode, edge) {
    pathList.push({func: func, edge: edge})
    //先在本函数检查if
    let edge_if = getNestConditionalEdgesincfg(currentNode, currentNode)
    if (edge_if != null) {
        pathList.push({func: func, edge: edge_if})
        return {edge: edge_if, cate: 'if'}
    }
    return getSuccessFailEdge(cfg_filealise.aliasMap, func, currentNode)

}

//查找当前节点的caller
function getNestCaller_method(targetFuncName: string) {
//todo 优化先判断是否在function中
    let functioins = cfg_filealise.cfg.functions
    for (const func of functioins) {
        for (const edge of func.flowGraph.edges) {
            if (edge.type === Flow.EdgeType.Epsilon) {
                continue;
            }
            const data = edge.data;
            if (data.type === ESTree.NodeType.AssignmentExpression) {
                // Assert: currently all edges we find by bfs are assignments
                const callExpr = <ESTree.AssignmentExpression>edge.data;
                if (callExpr.right.type === ESTree.NodeType.CallExpression) {
                    const currentCallName = cfg_filealise.aliasMap.getNameByAlias(
                        (callExpr.right as ESTree.CallExpression).callee
                    );
                    //找到tainted存在方法的caller 即func;edge是func中的那条调用边
                    if (currentCallName === targetFuncName) {
                        return {edge, func};
                    }
                }
            }

        }
    }
    return null
}

function fndAsyncallerInFunc(flowfunc) {
    let edge = flowfunc.edges.find((edge) => {
        return isTarget(edge)
    });
    return edge

    function isTarget(edge: FlowEdge) {
        if (edge.data.type === ESTree.NodeType.AssignmentExpression) {
            const RHSExpr = (<ESTree.AssignmentExpression>edge.data).right
            if (RHSExpr.type === ESTree.NodeType.CallExpression) {
                const callExpr = RHSExpr as ESTree.CallExpression;
                const alias = stringify(callExpr.callee);
                const name = cfg_filealise.aliasMap.getNameByAlias(alias);
                return name.startsWith("wx.")
            }
        }

    }
}

function findFunfromEdge(edge: FlowEdge) {
    if (edge.data.type === ESTree.NodeType.AssignmentExpression) {
        const RHSExpr = (<ESTree.AssignmentExpression>edge.data).right
        if (RHSExpr.type === ESTree.NodeType.CallExpression) {
            const callExpr = RHSExpr as ESTree.CallExpression;
            const alias = stringify(callExpr.callee);
            const name = cfg_filealise.aliasMap.getNameByAlias(alias);
            return name
        }
    }
    return null
}

function path_print(pathL) {
    for (let i = 0; i < pathL.length; i++) {
        let edge = pathL[i].edge
        let func = pathL[i].func
        console.log("path in is " + func.name + " " + edge.label)
    }
}

export function taintImplicitFlow(
    func: Styx.FlowFunction,
    edge: Styx.FlowEdge,
    helper: Helper,
    tf_source = null,
    isNav=false,
    isVairable=false
) {
    /**
     * This function track the implicit taint flow such as:
     *    if (test)
     *    {
     *        sink();
     *    }
     *
     *  sink -> test
     */
    let fun =
        func
    const bfsQueue = new Array<Styx.FlowNode>();
    const visited = new Set<Styx.FlowNode>();
    const taintedEdges = new Array<TaintedAssignment>();
    let auth = null
    let navurl=""
    if (isNav){
        if (edge.data.type===ESTree.NodeType.AssignmentExpression){
            let data=edge.data as ESTree.AssignmentExpression
            if (data.right.type===ESTree.NodeType.CallExpression){
                let callExpr=data.right as ESTree.CallExpression
                if (callExpr.arguments.length>0){
                    let arg=callExpr.arguments[0]
                    if (arg.type===ESTree.NodeType.Identifier){
                        let id=arg as ESTree.Identifier
                        if (id.url){
                            navurl=id.url
                        }
                    }
                }
            }
        }
    }
    bfsQueue.push(edge.source);
    while (bfsQueue.length !== 0) {
        const currentNode = bfsQueue.shift();
        if (!visited.has(currentNode)) {
            visited.add(currentNode);
            //找到success fail边
            //const successEdge = getSuccessFailEdge(cfg_filealise.aliasMap, func,edge);
            let result_info = getNestControlEdge(fun, currentNode, edge)
            let incomingEdg
            let cate

            if (result_info?.edge != null) {
                incomingEdg = result_info.edge
                cate = result_info.cate
            } else {
                return "out";
            }
            //for (const incomingEdge of currentNode.incomingEdges) {
            if (incomingEdg) {
                const incomingEdge = incomingEdg

                incomingEdge.target = currentNode;
                //if系
                if (incomingEdge.type === Styx.EdgeType.Conditional) {
                    // get the test expr
                    var Id

                    if (incomingEdge.data.type === ESTree.NodeType.Identifier) {
                        Id = <ESTree.Identifier>incomingEdge.data;
                        //看是不是 res.authSetting.scope.userLocation类型
                        let getSettingScope = table.findKeyByValue(Id.name)
                        if (getSettingScope&& getSettingScope.includes('authSetting.scope')) {
                                let parts = getSettingScope.split('scope.')
                                auth = parts.length > 1 ? parts[1] : auth
                        }
                    } else if (
                        incomingEdge.data.type === ESTree.NodeType.UnaryExpression
                    ) {
                        const ue = <ESTree.UnaryExpression>incomingEdge.data;
                        Id = <ESTree.Identifier>ue.argument;
                        let getSettingScope = table.findKeyByValue(Id.name)
                        if (getSettingScope.label && getSettingScope.label.includes('authSetting.scope')) {
                                let parts = getSettingScope.split('scope.')
                                auth = parts.length > 1 ? parts[1] : auth
                        }
                    } else {
                        if (!Config['ignore_warnings']) {
                            console.warn(
                                `[Worklist] invalid test type at ${incomingEdge.label} in ${func.name}`
                            );
                        }
                        return;
                    }
                }
                //找到了success边
                else if (cate === 'success') {
                    let d = incomingEdge.data
                    let alias = stringify(d.right.callee)
                    let name = cfg_filealise.aliasMap.getNameByAlias(alias)
                    //todo 还不符合
                    if (incomingEdge.data.type === ESTree.NodeType.AssignmentExpression) {
                        const RHSExpr = (<ESTree.AssignmentExpression>incomingEdge.data).right
                        if (RHSExpr.type === ESTree.NodeType.CallExpression) {
                            const callExpr = RHSExpr as ESTree.CallExpression;
                            Id = callExpr.callee
                            var urlorauth=(callExpr.arguments&&callExpr.arguments.length>0)?callExpr.arguments[0]:null
                        }
                    } else {
                        console.error('error in taintImplicitFlow')
                    }
                }
                //then catch系
                else {
                    Id = incomingEdge.data
                    if (incomingEdge.data.type === ESTree.NodeType.AssignmentExpression) {
                        const RHSExpr = (<ESTree.AssignmentExpression>incomingEdge.data).right
                        if (RHSExpr.type === ESTree.NodeType.CallExpression) {
                            const callExpr = RHSExpr as ESTree.CallExpression;
                            Id = callExpr.callee
                            var urlorauth=(callExpr.arguments&&callExpr.arguments.length>0)?callExpr.arguments[0]:null
                        }
                    }
                }
                const copy = flatted.parse(flatted.stringify(pathList));
                let tain_f = pathList.pop().func
                copy.reverse()
                const taintTo = new Taint(
                    Id,
                    TaintType.implicit,
                    incomingEdge.source,
                    incomingEdge,
                    tain_f,
                    new Array<ESTree.Identifier>(),
                );//todo 这里还要加{{}}的判断
                if (cate != 'if') {
                    taintTo.endsAtSource = true;
                }
                if (auth != null) {
                    taintTo.endsAtSource = true
                    taintTo.auth = auth
                }
                //主要就是wx.auth的scope url的实际重复了
                if (urlorauth&&urlorauth.type === ESTree.NodeType.Identifier) {
                    let urlorauthId = urlorauth as ESTree.Identifier
                    if (urlorauthId.url){
                        taintTo.url=urlorauthId.url
                    }
                    if (urlorauthId.scope){
                        taintTo.auth=urlorauthId.scope
                    }
                }
                if (!taintTo.auth){
                    let sourceslist=getSourceAndSink().sourceFunctions
                    let e=false
                    for (let so of sourceslist){
                        let i1=so.trim()
                        let i2=taintTo?.name.trim()
                        if (i1==i2){
                        e=true
                            break
                        }
                    }
                    if (e){
                        taintTo.auth=taintTo.name
                    }
                }



                helper.worklist.push(taintTo);
                //改了
                if (tf_source == null) {
                    helper.dep.push(new TaintFlow(tf_source, taintTo, tain_f.name, edge.label, copy));
                } else {
                    helper.dep.push(new TaintFlow(tf_source, taintTo, tain_f.name, edge.label, copy));
                    tf_source.nextTaints.push(taintTo)
                }
                if (navurl){
                    taintTo.url=navurl
                }
                if (isVairable!=false){
                    taintTo.isVariable=isVairable
                }
                logger.debug(
                    '[WorkList] Tainted implicit flow:',
                    stringify(Id),
                    'at edge',
                    incomingEdge.label,
                    'in function',
                    func.name
                );
                console.log("隐式的路径")
                path_print(copy)
                pathList = []
            }
        }
    }
}

function checkGlobalDataAssignment(
    func: Styx.FlowFunction,
    edge: Styx.FlowEdge,
    expr: ESTree.Expression,
    helper: Helper
) {
    if (expr.type === ESTree.NodeType.MemberExpression) {
        const fields = splitStringIntoIdentifiers(stringify(expr));
        for (const field of fields) {
            if (field.name === 'globalData') {
                const globalDataTaint = new Taint(
                    <ESTree.MemberExpression>expr,
                    TaintType.global,
                    edge.source,
                    edge,
                    func,
                    new Array<ESTree.Identifier>()
                );
                logger.trace(`Tainted globalData ${stringify(expr)}`);
                helper.worklist.push(globalDataTaint);
            }
        }
    }
}

export function locateSinkCalls(
    cfg: Styx.FlowProgram,
    helper: Helper,
    funcAliasMap: AliasMap
) {
    /**
     * 1. locates all sink calls and marks their arguments as tainted.
     * 2. if LHS of a assignment contains 'global', make it as tainted.
     */
    cfg_filealise.cfg = cfg;
    cfg_filealise.aliasMap = funcAliasMap;
    for (const func of cfg.functions) {
        for (const edge of func.flowGraph.edges) {
            if (edge.type === Styx.EdgeType.Epsilon) {
                continue;
            }
            const data = edge.data;
            if (data.type === ESTree.NodeType.AssignmentExpression) {
                // Assert: all call expressions appear in RHS of assignments
                const RHSExpr = (<ESTree.AssignmentExpression>data).right;
                //是call表达式
                if (RHSExpr.type === ESTree.NodeType.CallExpression) {
                    //为什么还要别名一下
                    const callExpr = RHSExpr as ESTree.CallExpression;
                    const alias = stringify(callExpr.callee);
                    const name = funcAliasMap.getNameByAlias(alias);
                    let isSinkCall = false;
                    if (Config['strict_matching']) {
                        // in strict matching mode, we only check for exact matches
                        isSinkCall = helper.sinkFunctions.includes(name);
                    } else {
                        // or otherwise we also check inclusions
                        for (const sink of helper.sinkFunctions) {
                            const rawAPI = sink.replace(Config['api_prefix'], '');
                            if (checkBackwardInclusion(alias, rawAPI)) {
                                isSinkCall = true;
                                break;
                            }
                        }
                        isSinkCall = isSinkCall || helper.sinkFunctions.includes(name);
                    }
                    if (isSinkCall) {
                        // got a sink function call
                        logger.debug(`Added taint at sink: ${alias} (alias of ${name})`);
                        //todo 其实是要的 污点流要这个的 先注到
                        if (!name.includes('navigate')) {
                            taintSinkArguments(func, edge, callExpr.arguments, helper, null);
                        }
                        let a = Config['enable_implicit_flow']
                        // add implicit flow if required
                        if (Config['enable_implicit_flow']) {
                            console.log("支持隐式流");
                            if (edge.data.type === ESTree.NodeType.AssignmentExpression) {
                                let assignExp = edge.data as ESTree.AssignmentExpression
                                let RHSExpr = assignExp.right as ESTree.CallExpression
                                let alias = stringify(RHSExpr.callee)
                                if (alias === 'wx.navigateTo') {
                                    //pathList.push({func:func,edge:edge})
                                    taintImplicitFlow(func, edge, helper,null,true);

                                }
                            }
                            // taintImplicitFlow(func, edge, helper);
                        } else {
                            console.log("不支持隐式流");

                        }
                    }
                }
                const LHSExpr = (<ESTree.AssignmentExpression>data).left;
                checkGlobalDataAssignment(func, edge, LHSExpr, helper);
            }
            //this.setData
            if (edge.hinderData != null) {
                let t = edge.hinderData
                //pathList.push({func:func,edge:edge})
                taintImplicitFlow(func, edge, helper,null,false,t);
            }
        }
    }
    // if (page2nav_edge.get(now_page)!=null){
    //     let res=page2nav_edge.get(now_page)
    //     let edge=res
    //     let Id=createIdentifier('navigator')
    //     if (edge.data.type === ESTree.NodeType.AssignmentExpression) {
    //
    //     }
    //     const taintTo = new Taint(
    //         Id,
    //         TaintType.implicit,
    //         edge.source,
    //         edge,
    //         null,
    //         new Array<ESTree.Identifier>(),
    //     );//todo 这里还要加{{}}的判断
    //
    //
    // }

}

function near(edge_need_if: FlowEdge, edge_need_su: FlowEdge) {
    throw new Error('Function not implemented.');
}

