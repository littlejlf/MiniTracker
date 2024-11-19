import { HtmlIfStmt } from "./ifStmt";
import { HtmlUserInputs } from "./htmlUserInput";

export class HtmlFileInfo {
    inputs: HtmlUserInputs;
    ifStmts: Array<HtmlIfStmt>;
    hinderVariables: Map<any, any>;
    navinfo: { url: string, ifCondition: string | null }[];
    constructor() {
        this.inputs = new HtmlUserInputs();
        this.ifStmts = new Array<HtmlIfStmt>();

        //this.hinderVariables = new Array<string>();
    }
}
