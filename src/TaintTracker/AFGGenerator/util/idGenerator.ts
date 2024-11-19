import {NodeType} from "../estree";
import * as ESTree from "../estree";
import {stringify} from "../parser/expressions/stringifier";

export interface IdGenerator {
  generateId: () => number;
}

let idGeneratorFactory = {
  create(): IdGenerator {
    let id = 0;

    return {
      generateId: () => ++id,
    };
  },
};

interface IdRecorder {
  isPageParam: boolean;
  isPageData: boolean;
  isComponentParam: boolean;
  isApp: boolean;
  lookup: (expr: string) => string;
  store: (expr: string) => void;
  storeSpecific: (expr: string, tempVarName: string) => void;
  overwrite: (original: string, current: string) => void;
  add: (original: string, current: string) => void;
  findKeyByValue?:any
  table?:{ [key: string]: string }
  calculate?:any
}

let IdRecorderComplex = {
  create(): IdRecorder {
    let id = 0;
    let idLookUpTable: { [key: string]: string } = {};

    function _lookup(expr: string): string {
      if (idLookUpTable.hasOwnProperty(expr)) {
        return idLookUpTable[expr];
      } else {
        return '';
      }
    }

    function _store(expr: string): void {
      ++id;
      idLookUpTable[expr] = `temp${id}`;
      valuegen(expr)
    }

    function _storeSpecific(expr: string, tempVarName: string): void {
      idLookUpTable[expr] = tempVarName;
    }

    function _overwrite(original: string, current: string): void {
      if (idLookUpTable.hasOwnProperty(original)) {
        idLookUpTable[current] = idLookUpTable[original];
        idLookUpTable[original] = '';
      } else {
        _store(current);
      }
    }

    function _add(original: string, current: string): void {
      if (idLookUpTable.hasOwnProperty(original)) {
        idLookUpTable[current] = idLookUpTable[original];
      } else {
        _store(current);
      }
    }
    function findKeyByValue( value: string): string | undefined {

      for (const key in idLookUpTable) {
        if (idLookUpTable[key] === value) {
          return key; // 找到对应键，返回
        }
      }
      return undefined; // 如果没有匹配的值，返回 undefined
    }
    function valuegen(key:string){
      let parts=key?.trim().split("=")
      if (parts.length>=2){
      idLookUpTable[parts[1].trim()]=parts[0].trim()}
    }

    function calculate(expr){
      let table= idLookUpTable
      let value
      let objv
      if (expr.type===NodeType.MemberExpression){
        let member=expr.object as ESTree.MemberExpression
        let mstr=stringify(member)
        mstr=stringify(expr)
        let propname=expr.property.name
        value=expr.property.value
        if (value)
          return value
        value=findKeyByValue(mstr)
        if (!value){
          if (member)
          objv=calculate(member)
          let jsonString = objv.replace(/\n/g, "").trim();

          let obj = eval('(' + jsonString + ')');

          value=obj[propname]

        }
        else {
          return value
        }


      }
      else if (expr.type===NodeType.Identifier){
        let idname=expr.name

        value=findKeyByValue(idname)
      }
      else if (expr.type===NodeType.Literal){
        value=expr.value
      }
      return value

    }

    return {
      isPageParam: false,
      isPageData: false,
      isComponentParam: false,
      isApp: false,
      lookup: _lookup,
      store: _store,
      storeSpecific: _storeSpecific,
      overwrite: _overwrite,
      add: _add,
      findKeyByValue: findKeyByValue,
        table: idLookUpTable,
      calculate: calculate
    };
  },
};

export default idGeneratorFactory;
export { IdRecorder };
export { IdRecorderComplex };
