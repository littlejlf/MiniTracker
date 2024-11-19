import * as Styx from '../AFGGenerator/generator';
import * as ESTree from '../AFGGenerator/estree';
import { stringify } from '../AFGGenerator/parser/expressions/stringifier';
import { Taint, TaintedAssignment } from '../interfaces/taint';
import {
  checkForwardInclusion,
  splitStringIntoIdentifiers,
} from '../util/stringManip';
import { copyPropertyStack, matchProperty } from '../util/utils';
import { logger } from '../../utils/logHelper';
import * as Flow from '../AFGGenerator/flow';
import { BasicJs } from '../../utils/interface/miniProgram';

interface TaintAssignmentHelper {
  taintedAssignments: Array<TaintedAssignment>;
  bfsQueue: Array<Styx.FlowNode>;
  nodeVisited: Set<Styx.FlowNode>;
  funcVisited: Set<string>;
}
var ebasicJs
//向上找，找到待选污点的赋值语句
export function findTaintAssignment(
  taint: Taint,
  basicJs: BasicJs
): Array<TaintedAssignment> {
  ebasicJs = basicJs
  const taintAssignmentHelper: TaintAssignmentHelper = {
    taintedAssignments: new Array<TaintedAssignment>(),
    bfsQueue: new Array<Styx.FlowNode>(),
    nodeVisited: new Set<Styx.FlowNode>(),
    funcVisited: new Set<string>(),
  };
//调用 findTaintFromNode 方法，查找从污点源节点开始的污点赋值。这个方法会遍历控制流图并记录污点赋值。
  //todo 有点问题 只是单纯去考虑了赋值语句 对于call语句应当深入 因为存在闭包的变量
  findTaintFromNode(
    taint,
    taint.controlFlowSourceNode,
    taint.currentFunction,
    taintAssignmentHelper
  );
  //如果没有找到任何污点赋值，则通过别名映射获取当前函数的别名，并调用 findScopeTaintFromFuncCall 方法查找该函数调用的污点。可能是跨越函数的污点传播。
  if (taintAssignmentHelper.taintedAssignments.length === 0) {
    const funcName = basicJs.funcAliasMap.getNameByAlias(
      taint.currentFunction.name
    );
    findScopeTaintFromFuncCall(taint, funcName, basicJs, taintAssignmentHelper);
  }
  return taintAssignmentHelper.taintedAssignments;
}
//todo 怎么看一个函数是否是闭包
function findTaintFromNode(
  taint: Taint,
  node: Styx.FlowNode,
  currentFunction: Styx.FlowFunction,
  taintAssignmentHelper: TaintAssignmentHelper
) {
  if (ESTree.isAssignmentExpression(taint.controlFlowEdge.data)) {
    const startingEdgeExpr = taint.controlFlowEdge.data;
    if (stringify(startingEdgeExpr.left) === taint.name) {
      taintAssignmentHelper.taintedAssignments.push(
        new TaintedAssignment(
          taint.controlFlowEdge,
          taint.propertyStack,
          currentFunction
        )
      );
      logger.trace(
        `Assignment to: ${stringify(startingEdgeExpr.left)}, at: ${
          taint.controlFlowEdge.label
        }`
      );
    }
  }

  taintAssignmentHelper.bfsQueue.push(node);
  while (taintAssignmentHelper.bfsQueue.length !== 0) {
    const currentNode = taintAssignmentHelper.bfsQueue.shift();
    if (!taintAssignmentHelper.nodeVisited.has(currentNode)) {
      taintAssignmentHelper.nodeVisited.add(currentNode);
      for (const incomingEdge of currentNode.incomingEdges) {
        if (incomingEdge.type === Styx.EdgeType.Epsilon) continue;

        if (ESTree.isAssignmentExpression(incomingEdge.data)) {
          //对于call应该进到里面看有没有赋值
          const assignmentExpr = incomingEdge.data;
          const assignmentExprLeft = stringify(assignmentExpr.left);
          if (assignmentExprLeft === taint.name) {
            lhsEqualTaint(
              taint,
              incomingEdge,
              currentFunction,
              taintAssignmentHelper
            );
            continue; //Forward mode: a.b.c includes a.b 这里应该直接被剔除掉 在计算值的过程中
          } else if (checkForwardInclusion(assignmentExprLeft, taint.name)) {
            lhsIncludeTaint(
              taint,
              incomingEdge,
              currentFunction,
              taintAssignmentHelper
            );
          } else if (checkForwardInclusion(taint.name, assignmentExprLeft)) {
            taintIncludeLhs(
              taint,
              incomingEdge,
              currentFunction,
              taintAssignmentHelper
            );
          }
          else if (incomingEdge.data.right.type === ESTree.NodeType.CallExpression){
            // @ts-ignore
            let name= incomingEdge.data.right.callee.name;
            if (name) {
              let fg = ebasicJs.cfg.functions.find((func) => func.name === name);
              //拿到graphFlow
              //if (name === '$$func5') {
              let se=fg?.flowGraph?.successExit
              if (se){
              //todo 参数有问题 第二个参数有问题 应该是 fg entry 还是exit 怎么看一个函数是不是闭包
              findTaintFromNode(taint, se, fg, taintAssignmentHelper)}
            } }
          //}
          else{
            let i=incomingEdge
          }
        }

        taintAssignmentHelper.bfsQueue.push(incomingEdge.source);
      }
    }
  }
}

function lhsEqualTaint(
  taint: Taint,
  incomingEdge: Styx.FlowEdge,
  currentFunction: Styx.FlowFunction,
  taintAssignmentHelper: TaintAssignmentHelper
) {
  // LHS of assignment === taint.name
  const assignmentExpr = incomingEdge.data as ESTree.AssignmentExpression;
  taintAssignmentHelper.taintedAssignments.push(
    new TaintedAssignment(incomingEdge, taint.propertyStack, currentFunction)
  );
  logger.trace(
    `Assignment to: ${stringify(assignmentExpr.left)}, at: ${
      incomingEdge.label
    }`
  );
}

function lhsIncludeTaint(
  taint: Taint,
  incomingEdge: Styx.FlowEdge,
  currentFunction: Styx.FlowFunction,
  taintAssignmentHelper: TaintAssignmentHelper
) {
  // LHS includes TGT
  const assignmentExpr = incomingEdge.data as ESTree.AssignmentExpression;
  if (!taint.propertyStack.length) {
    // stack empty, consider RHS tainted.
    taintAssignmentHelper.taintedAssignments.push(
      new TaintedAssignment(incomingEdge, taint.propertyStack, currentFunction)
    );
    logger.trace(
      `Assignment to: ${stringify(assignmentExpr.left)}, at: ${
        incomingEdge.label
      }`
    );
  } else {
    // stack non-empty, match elements
    const remainderList = splitStringIntoIdentifiers(
      stringify(assignmentExpr.left).replace(taint.name + '.', '')
    );
    let isPartialMatch = false;
    const stackCopy = copyPropertyStack(taint.propertyStack);
    while (matchProperty(remainderList, stackCopy)) {
      isPartialMatch = true;
    }
    if (isPartialMatch && !stackCopy.length) {
      // match found, consider RHS tainted.
      taintAssignmentHelper.taintedAssignments.push(
        new TaintedAssignment(incomingEdge, stackCopy, currentFunction)
      );
      logger.trace(
        `Assignment to: ${stringify(assignmentExpr.left)}, at: ${
          incomingEdge.label
        }`
      );
    }
  }
}

function taintIncludeLhs(
  taint: Taint,
  incomingEdge: Styx.FlowEdge,
  currentFunction: Styx.FlowFunction,
  taintAssignmentHelper: TaintAssignmentHelper
) {
  // TGT includes LHS, update stack and consider RHS tainted
  const assignmentExpr = incomingEdge.data as ESTree.AssignmentExpression;
  const stackCopy = copyPropertyStack(taint.propertyStack);
  const remainder = taint.name.replace(stringify(assignmentExpr.left), '');
  if (remainder !== '') {
    const remainingIds = splitStringIntoIdentifiers(remainder);
    for (const id of remainingIds) {
      stackCopy.push(id);
    }
  }
  taintAssignmentHelper.taintedAssignments.push(
    new TaintedAssignment(incomingEdge, stackCopy, currentFunction)
  );
  logger.trace(
    `Assignment to: ${stringify(assignmentExpr.left)}, at: ${
      incomingEdge.label
    }`
  );
}
//跨函数 1 arg-para 2 return 3 innerFun outersocpeValue
function findScopeTaintFromFuncCall(
  taint: Taint,
  targetFuncName: string,
  basicJs: BasicJs,
  taintAssignmentHelper: TaintAssignmentHelper
) {
  const funcNameMayCheck = new Array<string>();
  for (const func of basicJs.cfg.functions) {
    for (const edge of func.flowGraph.edges) {
      if (edge.type === Flow.EdgeType.Epsilon) {
        continue;
      }
      const data = edge.data;
      if (data.type === ESTree.NodeType.AssignmentExpression) {
        // Assert: currently all edges we find by bfs are assignments
        const callExpr = <ESTree.AssignmentExpression>edge.data;
        if (callExpr.right.type === ESTree.NodeType.CallExpression) {
          // locate calls to current tainted function
          const currentCallName = basicJs.funcAliasMap.getNameByAlias(
            (callExpr.right as ESTree.CallExpression).callee
          );
          //找到tainted存在方法的caller 即func;edge是func中的那条调用边
          if (currentCallName === targetFuncName) {
            findTaintFromNode(taint, edge.source, func, taintAssignmentHelper);
            if (taintAssignmentHelper.taintedAssignments.length === 0) {
              funcNameMayCheck.push(func.name);
            }
          }
        }
      }
    }
  }

  if (taintAssignmentHelper.taintedAssignments.length === 0) {
    funcNameMayCheck.forEach((funcName) => {
      if (!taintAssignmentHelper.funcVisited.has(funcName)) {
        taintAssignmentHelper.funcVisited.add(funcName);
        //再一次向外层caller存在的function去找 可能跨越多层
        findScopeTaintFromFuncCall(
          taint,
          funcName,
          basicJs,
          taintAssignmentHelper
        );
      }
    });
  }
}

export function ImplicitTaintSearch(taint: Taint) {
  const bfsQueue = new Array<Styx.FlowNode>();
  const visited = new Set<Styx.FlowNode>();
  const taintedEdges = new Array<TaintedAssignment>();

  bfsQueue.push(taint.controlFlowSourceNode);
  while (bfsQueue.length !== 0) {
    const currentNode = bfsQueue.shift();
    if (!visited.has(currentNode)) {
      visited.add(currentNode);
      for (const incomingEdge of currentNode.incomingEdges) {
        if (incomingEdge.type === Styx.EdgeType.Conditional) {
          const assignmentExpr = <ESTree.AssignmentExpression>(
            incomingEdge.source.incomingEdges[0].data
          );
          taintedEdges.push(
            new TaintedAssignment(
              incomingEdge.source.incomingEdges[0],
              taint.propertyStack,
              taint.currentFunction
            )
          );
          logger.trace(
            `Assignment to: ${stringify(assignmentExpr.left)}, at: ${
              incomingEdge.source.incomingEdges[0].label
            }`
          );
          continue;
        }
        bfsQueue.push(incomingEdge.source);
      }
    }
  }
  return taintedEdges;
}
