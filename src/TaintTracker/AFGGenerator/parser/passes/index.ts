import { rewriteConstantConditionalEdges } from "./constantConditionalEdgeRewriting";
import { collectNodesAndEdges } from "./nodeAndEdgeCollecting";
import { removeTransitNodes } from "./transitNodeRemoval";
import { removeUnreachableNodes } from "./unreachableNodeRemoval";

import { ControlFlowGraph, ParserOptions } from "../../flow";

export { runOptimizationPasses };
// 如果 options.passes.rewriteConstantConditionalEdges 为真，执行这一优化。
// 该函数会分析控制流图中的条件边（即决定条件跳转的边）。如果条件是常量（如 true 或 false），可以提前确定路径。通过重写条件边，将条件确定性处理并移除无效路径，减少后续节点的遍历次数。
// removeUnreachableNodes(graph)：
//
// 移除所有无法从起点节点（入口节点）访问到的节点。
// 此步骤可以精简图的结构，提高后续代码优化和分析的效率，因为这些不可达节点不影响程序的执行结果。
// removeTransitNodes(graph)：
//
// 如果 options.passes.removeTransitNodes 为真，则移除图中所有传递节点。
// 传递节点一般是那些对程序逻辑无实际影响的节点，例如仅连接其他节点而无其他操作的节点。去除这类节点可以简化图的结构。
// collectNodesAndEdges(graph)：
//
// 重新收集和整理图中的节点和边，确保图结构在执行以上优化步骤后保持一致。
// 这一步可以帮助后续步骤和分析工具更好地处理修改后的图结构。
function runOptimizationPasses(
  graphs: ControlFlowGraph[],
  options: ParserOptions
) {
  for (let graph of graphs) {
    if (options.passes.rewriteConstantConditionalEdges) {
      rewriteConstantConditionalEdges(graph);
    }

    removeUnreachableNodes(graph);

    if (options.passes.removeTransitNodes) {
      removeTransitNodes(graph);
    }

    collectNodesAndEdges(graph);
  }
}
