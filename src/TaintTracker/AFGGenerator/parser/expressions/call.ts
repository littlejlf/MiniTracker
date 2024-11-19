import { negateTruthiness } from './negator';
import { stringify } from './stringifier';

import { Config } from '../../../../utils/config';
import * as ESTree from '../../estree';
import { Completion, FlowNode, ParsingContext } from '../../flow';
import { parseExpression } from '../statements/expression';
import { IdRecorder } from '../../util/idGenerator';
import {
  createAssignmentExpression,
  createCallExpression,
  createIdentifier,
  createMemberExpression,
  createPageDataMemberExpression,
  createPageParamIdentifier,
} from '../../estreeFactory';
import {
  checkBackwardInclusion,
  checkForwardInclusion,
  convertStringToMemberExpr,
} from '../../../util/stringManip';
import { ExpressionParser } from './interface';
import { getIdentifier } from '../../util/identifierCreator';
import {isIdentifier, isMemberExpression, NodeType} from '../../estree';
import { logger } from '../../../../utils/logHelper';
import {pagefun2caller, now_func, now_page, temp_page2url, v_bind_map, selfurl2navurl} from "../../../../shared";

export { parseCallExpression };
const parseCallExpression: ExpressionParser = function (
  callExpression: ESTree.CallExpression,
  currentNode: FlowNode,
  context: ParsingContext,
  idLookUpTable: IdRecorder
): FlowNode {
  /**
   * Design:
   * A call expression consists of a callee and its arguments.
   * For each argument that is neither an identifier nor a literal,
   * we evaluate its value (using parseExpression()) and replace it with a temp var.
   *
   * If the callee is not an identifer or literal,
   * we parse it using a similar idea.
   *
   * The function call will be re-written into an assignment to temp var.
   *
   * Goal:
   * In:  f2(f1(), a);
   *
   * Out: temp1 = f1();
   *      temp2 = f(temp1, a);
   */
  if (
    checkBackwardInclusion(stringify(callExpression.callee), 'setData') &&
    callExpression.arguments.length > 0
  ) {
    let a=v_bind_map
    return parseSetData(callExpression, currentNode, context, idLookUpTable);
  }

  if (stringify(callExpression.callee) === 'Page') {
    idLookUpTable.isPageParam = true;
  }
  if (stringify(callExpression.callee) === 'App') {
    idLookUpTable.isApp = true;
  }
  if (stringify(callExpression.callee) === 'Component') {
    idLookUpTable.isComponentParam = true;
  }
  let url
  let scope
  // parse arguments and replace current expr label
  for (let i = 0; i < callExpression.arguments.length; ++i) {
    let sf=false
    let nf=false
    let fn=stringify(callExpression)
    if (fn.includes('wx.navigateTo')){

      // @ts-ignore
      url= callExpression.arguments[i].properties.find((item)=>item.key.name==='url').value
      url=idLookUpTable.calculate(url)
      if (url)
        nf=true
    }

    if (fn.includes('wx.authorize')){
      // @ts-ignore
      scope= callExpression.arguments[i].properties.find((item)=>item.key.name==='scope')?.value.value
      if (scope)
      sf=true
    }
    currentNode = parseExpression(
      callExpression.arguments[i],
      currentNode,
      context,
      idLookUpTable
    );
    callExpression.arguments[i] = getIdentifier(
      callExpression.arguments[i],
      idLookUpTable
    );
    if (sf){
      // @ts-ignore
      callExpression.arguments[i].scope=scope
    }
    if (nf){
      // @ts-ignore
      callExpression.arguments[i].url=url
      selfurl2navurl.push([now_page,url])
    }
    if (fn.includes('wx.navigateTo')) {
      // @ts-ignore
      //temp_page2url.set([now_page, callExpression.arguments[i].name], url)
      temp_page2url.set(callExpression.arguments[i].name, url)
      //selfurl2navurl.push([now_page,url])
    }}
  //temp_page2url.set([now_page,],url)

  // parse callee and replace current expr label
  let currentObjExpr = callExpression.callee;
  let currentPropExpr: ESTree.Expression;
  if (callExpression.callee.type === ESTree.NodeType.MemberExpression) {
    currentObjExpr = (callExpression.callee as ESTree.MemberExpression).object;
    currentPropExpr = (callExpression.callee as ESTree.MemberExpression)
      .property;
    while (currentObjExpr.type === ESTree.NodeType.MemberExpression) {
      currentPropExpr = createMemberExpression(
        (currentObjExpr as ESTree.MemberExpression).property,
        currentPropExpr
      );
      currentObjExpr = (currentObjExpr as ESTree.MemberExpression).object;
    }
  }
  currentNode = parseExpression(
    currentObjExpr,
    currentNode,
    context,
    idLookUpTable
  );
  currentObjExpr = getIdentifier(currentObjExpr, idLookUpTable);
  callExpression.callee = currentPropExpr
    ? createMemberExpression(currentObjExpr, currentPropExpr)
    : currentObjExpr;
  let funcname=stringify(callExpression)
  let value=pagefun2caller.get([now_page,funcname])
  if (!value){//todo navi 去拿到真正的值
  pagefun2caller.set([now_page,funcname],now_func)
  }
  else {
    value.push(now_func)
  }
  if (
    isMemberExpression(callExpression.callee) &&
    (isIdentifier(callExpression.callee.property, { name: 'then' }) ||
      isIdentifier(callExpression.callee.property, { name: 'catch' }))
  ) {
    if (callExpression.arguments.length) {
      return parseThenOrCatch(
        callExpression,
        currentNode,
        context,
        idLookUpTable
      );
    }
  }
  // store the updated expression into lookup table
  const currentExprLabel = stringify(callExpression);
  idLookUpTable.store(currentExprLabel);
  // create an assignment for current node
  const tempVarAssignmentExpr = createAssignmentExpression({
    left: createIdentifier(idLookUpTable.lookup(currentExprLabel)),
    right: callExpression,
  });

  return context
    .createNode()
    .appendTo(
      currentNode,
      stringify(tempVarAssignmentExpr),
      tempVarAssignmentExpr,
      callExpression.loc
    );
};

function parseSetData(
  setDataExpr: ESTree.CallExpression,
  currentNode: FlowNode,
  context: ParsingContext,
  idLookUpTable: IdRecorder
): FlowNode {
  // convert setData into assignments to members of __PageData__
  let arg0 = setDataExpr.arguments[0];
  if (
    arg0.type === ESTree.NodeType.Literal &&
    setDataExpr.arguments.length >= 2
  ) {
    if (!Config['ignore_warnings']) {
      console.warn(
        `args[0] of setData is a literal: ${stringify(
          setDataExpr
        )}. May be some user-defined setData()`
      );
    }
    return parseUserDefinedSetData(
      setDataExpr,
      currentNode,
      context,
      idLookUpTable
    );
  }
  if (arg0.type === ESTree.NodeType.ObjectExpression) {
    let map= v_bind_map
    let dataObject = <ESTree.ObjectExpression>arg0;
    let i = 0;
    for (let data of dataObject.properties) {
      currentNode = parseExpression(
        data.value,
        currentNode,
        context,
        idLookUpTable
      );
      if (idLookUpTable.lookup(stringify(data.value)) !== '') {
        dataObject.properties[i].value = createIdentifier(
          idLookUpTable.lookup(stringify(data.value))
        );
      }
      let dataMember: ESTree.MemberExpression | ESTree.Identifier;
      if (data.key.type === ESTree.NodeType.Literal) {
        let propertyName: string;
        propertyName =
          '__PageParameter__.data.' +
          (<ESTree.Literal>data.key).value
            .toString()
            .replace('[', '.')
            .replace(']', '.');
        dataMember = convertStringToMemberExpr(propertyName);
      } else {
        dataMember = createMemberExpression(
          createPageDataMemberExpression(),
          data.key
        );
      }
      let dataAssignment = createAssignmentExpression({
        left: dataMember,
        right: data.value,
      });
      let hinderData=null
      // @ts-ignore
      if(map.get(data.key.name)){
        // @ts-ignore
           hinderData=[data.key.name,map.get(data.key.name)]
      }
      currentNode = context
        .createNode()
        .appendTo(currentNode, stringify(dataAssignment), dataAssignment,setDataExpr.loc,undefined,hinderData);
//todo

      ++i;
    }
  } else {
    //todo 什么情况
    logger.warn(`args[0] of setData is not an object: ${stringify(arg0)}`);
    for (let i = 0; i < setDataExpr.arguments.length; ++i) {
      currentNode = parseExpression(
        setDataExpr.arguments[i],
        currentNode,
        context,
        idLookUpTable
      );
      let argumentExprLabel = stringify(setDataExpr.arguments[i]);
      let currentTempVar = idLookUpTable.lookup(argumentExprLabel);
      if (currentTempVar !== '') {
        setDataExpr.arguments[i] = createIdentifier(currentTempVar);
      }
    }
    let dataAssignment = createAssignmentExpression({
      left: createPageDataMemberExpression(),
      right: setDataExpr.arguments[0],
    });
    currentNode = context
      .createNode()
      .appendTo(currentNode, stringify(dataAssignment), dataAssignment,setDataExpr.loc);
  }

  // handle callback, if exists.
  if (setDataExpr.arguments.length > 1) {
    let callbackExpr = setDataExpr.arguments[1];
    currentNode = parseExpression(
      callbackExpr,
      currentNode,
      context,
      idLookUpTable
    );
    if (idLookUpTable.lookup(stringify(callbackExpr)) !== '') {
      setDataExpr.arguments[1] = createIdentifier(
        idLookUpTable.lookup(stringify(callbackExpr))
      );
    }
    let callbackFuncCall = createCallExpression(setDataExpr.arguments[1]);
    currentNode = parseExpression(
      callbackFuncCall,
      currentNode,
      context,
      idLookUpTable
    );
  }

  return currentNode;
}

function parseUserDefinedSetData(
  setDataExpr: ESTree.CallExpression,
  currentNode: FlowNode,
  context: ParsingContext,
  idLookUpTable: IdRecorder
): FlowNode {
  let pageDataStr = stringify(createPageDataMemberExpression());
  let dataToBeSet = convertStringToMemberExpr(
    pageDataStr + '.' + (<ESTree.Literal>setDataExpr.arguments[0]).value
  );
  currentNode = parseExpression(
    setDataExpr.arguments[1],
    currentNode,
    context,
    idLookUpTable
  );
  if (idLookUpTable.lookup(stringify(setDataExpr.arguments[1])) !== '') {
    setDataExpr.arguments[1] = createIdentifier(
      idLookUpTable.lookup(stringify(setDataExpr.arguments[1]))
    );
  }
  let dataAssignment = createAssignmentExpression({
    left: dataToBeSet,
    right: setDataExpr.arguments[1],
  });
  currentNode = parseExpression(
    dataAssignment,
    currentNode,
    context,
    idLookUpTable
  );

  // handle callback, if exists.
  if (setDataExpr.arguments.length > 2) {
    let callbackExpr = setDataExpr.arguments[2];
    currentNode = parseExpression(
      callbackExpr,
      currentNode,
      context,
      idLookUpTable
    );
    if (idLookUpTable.lookup(stringify(callbackExpr)) !== '') {
      setDataExpr.arguments[2] = createIdentifier(
        idLookUpTable.lookup(stringify(callbackExpr))
      );
    }
    let callbackFuncCall = createCallExpression(setDataExpr.arguments[2]);
    currentNode = parseExpression(
      callbackFuncCall,
      currentNode,
      context,
      idLookUpTable
    );
  }

  return currentNode;
}

function parseThenOrCatch(
  callExpression: ESTree.CallExpression,
  currentNode: FlowNode,
  context: ParsingContext,
  idLookUpTable: IdRecorder
): FlowNode {
  const currentExprLabel = stringify(callExpression);
  idLookUpTable.store(currentExprLabel);

  const objExpr = (callExpression.callee as ESTree.MemberExpression).object;
  const callExpr = createCallExpression(callExpression.arguments[0], [
    createIdentifier(stringify(objExpr)),
  ]);
  // Note: 这里的处理行为和一般的expression不一样，
  // currentExprLabel = new Promise($$func1).then($$func2)
  // callExpr = $$func2
  const tempVarAssignmentExpr = createAssignmentExpression({
    left: createIdentifier(idLookUpTable.lookup(currentExprLabel)),
    right: callExpr,
  });
  let promiseEdge=currentNode.incomingEdges.find((edge)=>edge.promise.cate==="promisefunc");
  if (promiseEdge===undefined){
    currentNode.incomingEdges[0].source.incomingEdges.find((edge)=>edge.promise.cate==="promisefunc");
  }
  return context
    .createNode()
    .appendTo(
      currentNode,
      stringify(tempVarAssignmentExpr),
      tempVarAssignmentExpr,
        callExpression.loc
    ,
        // @ts-ignore
        { cate:callExpression.callee.property.name,exp:callExpression,promiseEdge: promiseEdge});
}
