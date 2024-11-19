import { Config, Platform } from '../../utils/config';
import {hander_page2widget, now_page} from "../../shared";


function CheckInputTag(input: HTMLElement): boolean {

  // 
  function checkKeywords(s: string): boolean {
    for (const keyword of Config["keywords"]) {
      if (s.includes(keyword)) {
        return true;
      }
    }
    return false;
  }

  // self placeholder
  let placeholder = input.getAttribute("placeholder");
  if (placeholder !== null && checkKeywords(placeholder)) {
    return true;
  }

  // parent 
  let parent = input.parentElement;

  for (let i = 0; i < parent.children.length; i++) {
    let innerHTML = parent.children.item(i).innerHTML;
    if (innerHTML !== null && checkKeywords(innerHTML)) {
      return true;
    }
  }
  
  return false;
}


export function getBiBindData(body: HTMLElement): string[] {
  const inputTags = body.getElementsByTagName('input');
  const inputs = [];

  if (Config.platform === Platform.wechat) {
    for (let i = 0; i < inputTags.length; i++) {
      let value = inputTags[i].getAttribute('model:value');
      if (value !== null && CheckInputTag(inputTags[i])) {
        value = value.replace('{{', '');
        value = value.replace('}}', '').trim();
        inputs.push(value);
      }
    }
  } else if (Config.platform === Platform.baidu) {
    for (let i = 0; i < inputTags.length; i++) {
      let value = inputTags[i].getAttribute('model:value');
      if (value !== null && CheckInputTag(inputTags[i])) {
        value = value.replace('{=', '');
        value = value.replace('=}', '').trim();
        inputs.push(value);
      }
    }
  }
  return inputs;
}

export function getInputEventHandlers(body: HTMLElement): string[] {
  const inputTags = body.getElementsByTagName('input');
  const inputEventHandlers:string[] = [];
  for (let i = 0; i < inputTags.length; i++) {
    getHandlers(inputTags[i]);
  }

  getOpenTypeButton(body, inputEventHandlers);
  return inputEventHandlers;

  function getHandlers(inputTag: HTMLElement) {
    for (const event of Config.input_events) {
      let handler = inputTag.getAttribute(event);
      if (handler !== null && CheckInputTag(inputTag)) {
        if (handler.charAt(0) === '\'' && handler.charAt(handler.length-1) === '\''){
          handler = handler.substring(1,handler.length-1);
        }
        inputEventHandlers.push(handler);
        hander_page2widget.set({"page":now_page,"handler":handler},inputTag.outerHTML)
      }
    }
  }
}

function getOpenTypeButton(body: HTMLElement, inputEventHandlers:string[]){
  const buttonTags = body.getElementsByTagName('button');
  for (let i = 0; i < buttonTags.length; i++) {
    const opentype = buttonTags[i].getAttribute('open-type');
    if (opentype !== null && opentype === 'getPhoneNumber') {
      let handler = buttonTags[i].getAttribute('bindgetphonenumber')
      if (handler.charAt(0) === '\'' && handler.charAt(handler.length-1) === '\''){
        handler = handler.substring(1,handler.length-1);
      }
      inputEventHandlers.push(handler);
    }
  }
}
export function getNonClickableBindings(body: HTMLElement) {
  const allElements = body.getElementsByTagName('*'); // 获取所有元素
  //key 是绑定的变量，value 事件处理函数
  const bindings =  new Map();


  for (let i = 0; i < allElements.length; i++) {
    const element = allElements[i];

    // 检查 disabled 属性
    let disabledBinding = element.getAttribute('disabled');
    if (disabledBinding && disabledBinding.includes('{{')) {
    let key= extractBindings(disabledBinding)[0];
    let value= element.getAttribute('bindtap');
    if (value!==null&&key!==null){
      bindings.set(key,value);}
    }

    // 检查 hidden 属性
    let hiddenBinding = element.getAttribute('hidden');
    let key= extractBindings(disabledBinding)[0];
    let value= element.getAttribute('bindtap');
    if (value!==null&&key!==null){
      bindings.set(key,value);}
  }

    // // 检查 style 属性中的 pointer-events
    // let styleBinding = element.getAttribute('style');
    // if (styleBinding && styleBinding.includes('{{') && styleBinding.includes('pointer-events')) {
    //   bindings.push(...extractBindings(styleBinding));
    // }
    //
    // // 检查 class 属性是否包含可能使控件不可点击的类名
    // let classBinding = element.getAttribute('class');
    // if (classBinding && classBinding.includes('{{')) {
    //   bindings.push(...extractBindings(classBinding));
    // }


  return  bindings// 去重并返回绑定的变量
}

// 提取 `{{}}` 中的变量名
function extractBindings(expression: string): string[] {
  const regex = /{{(.*?)}}/g;
  const matches = [];
  let match;
  while ((match = regex.exec(expression)) !== null) {
    matches.push(match[1].trim());
  }
  return matches;
}
