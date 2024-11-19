import * as ESTree from '../AFGGenerator/estree';
import * as Styx from '../AFGGenerator/generator';
import {
  AliasMap,
  BFSAliasSearch,
} from '../functionAliasSearch/functionAliasMap';
import { createExtraPassContext, ExtraPassContext } from './extraPassContext';
import { appendCallExprTo } from './flowGraphModifier';
import { stringify } from '../AFGGenerator/parser/expressions/stringifier';
import { saveFunc } from '../util/frontEnd';
import { logger } from '../../utils/logHelper';
import { Alias, AliasHelper } from '../functionAliasSearch/interface/alias';

function isMember(member: string, obj: string): boolean {
  if (member.length < obj.length) {
    return false;
  }
  const members = member.split('.');
  return obj === members[0];
}

export function extraPasses(
  cfg: Styx.FlowProgram,
  funcAliasMap: AliasMap,
  filepath: string
  // perhaps we can pass functions as callbacks? like babel?
) {
  const done = new Array<Styx.FlowEdge>();
  const context: ExtraPassContext = createExtraPassContext();
  for (const func of cfg.functions) {
    for (const edge of func.flowGraph.edges) {
      if (edge.type === Styx.EdgeType.Epsilon) continue;
      if (edge.type === Styx.EdgeType.Normal) {
        //赋值语句 且RHS是函数调用  或者new表达式 new好像不行
        // TODO 那要是光是call 没有赋值呢 还是预处理会分配一个变量？
        if (edge.data.type === ESTree.NodeType.AssignmentExpression) {
          const assignmentExpr = edge.data as ESTree.AssignmentExpression;
          if (
            assignmentExpr.right.type === ESTree.NodeType.CallExpression ||
            assignmentExpr.right.type === ESTree.NodeType.NewExpression
          ) {
            const callExpr = assignmentExpr.right as ESTree.CallExpression;
            const calleeExpr = callExpr.callee;
            const calleeExprStr = stringify(calleeExpr);
            // TODO 这里应该不用判断吧？
            // if (funcAliasMap.getFunctionInfo(calleeExprStr) !== null) {
            if (!done.includes(edge)) {
              done.push(edge);
              const LHSIdentifier = assignmentExpr.left as ESTree.Identifier;
              for (const argument of callExpr.arguments) {
                let argstring = stringify(argument);
                //情况1 说明arg是一个函数
                if (
                  funcAliasMap.getFunctionInfo(argstring) !== null
                ) {
                  // case1 argument is function
                  appendCallExprTo(
                    edge,
                    funcAliasMap.getFunctionInfo(argstring),
                    context,
                    func,
                    null,
                    [LHSIdentifier]
                  );
                } else if (argstring !== 'wx' && argstring !== 'swan' && argstring !== '__PageParameter__') {
                  // argument's attributes are functions
                  //todo 为什么能得出上面的结论？ (isMember(alias, argstring))在这里判断了 这里可以不可以对success fail做特殊的处理
                  for (const alias in funcAliasMap.aliasToName) {
                    if (isMember(alias, argstring)) {
                      appendCallExprTo(
                        edge,
                        funcAliasMap.getFunctionInfo(alias),
                        context,
                        func,
                        null,
                        [LHSIdentifier]
                      );
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  saveFunc(filepath.replace('.js', ''), cfg.functions, 'modcfg', '-extraPass');
}
