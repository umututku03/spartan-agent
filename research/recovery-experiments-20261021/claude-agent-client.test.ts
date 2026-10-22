import {test, expect} from 'bun:test';
import {convertTools, withContinuation, buildPayload, parseAction, usageCost, reservation, MAX_INPUT_BYTES} from './claude-agent-client';
const tools = convertTools([{name:'finish',description:'Declare the result',parameters:{type:'object',properties:{status:{type:'string',enum:['completed','infeasible']}},required:['status'],additionalProperties:false}}]);
const response = {stop_reason:'tool_use',content:[{type:'tool_use',id:'test-call',name:'finish',input:{status:'infeasible'}}]};
test('tool result remains adjacent to its call and precedes continuation text, without mutating history', () => {
  const history:any[]=[{role:'assistant',content:response.content},{role:'user',content:[{type:'tool_result',tool_use_id:'test-call',content:'observed result'}]}];
  const messages=withContinuation(history,{rounds_remaining:2});
  expect(messages[1].content.map(x=>x.type)).toEqual(['tool_result','text']);
  expect(history[1].content.length).toBe(1);
  expect(messages[0].content[0].id).toBe(messages[1].content[0].tool_use_id);
});
test('native schema conversion and execution validation preserve names, arguments and termination enums',()=>{
  expect(tools[0].strict).toBe(true);
  expect(parseAction(response,tools).action).toEqual({tool:'finish',args:{status:'infeasible'}});
  for(const bad of [
    {...response,stop_reason:'max_tokens'},
    {...response,content:[]},
    {...response,content:[...response.content,...response.content]},
    {...response,content:[{...response.content[0],name:'reset_chain'}]},
    {...response,content:[{...response.content[0],input:{status:'completed',extra:'unauthorised'}}]},
    {...response,content:[{...response.content[0],input:{status:'unknown'}}]},
  ]) expect(()=>parseAction(bad,tools)).toThrow();
});
test('thinking is explicitly off, one tool required, no caching or sampling override',()=>{
  const p=buildPayload('same instructions',[{role:'user',content:[{type:'text',text:'task'}]}],tools);
  expect(p.thinking.type).toBe('disabled');
  expect(p.tool_choice).toEqual({type:'any',disable_parallel_tool_use:true});
  expect(p).not.toHaveProperty('temperature');
  expect(JSON.stringify(p)).not.toContain('cache_control');
});
test('known usage settles at documented rates; unknown or unexpected usage keeps its reservation',()=>{
  expect(usageCost({input_tokens:1000,output_tokens:100})).toBeCloseTo(.00015,12);
  expect(()=>usageCost({output_tokens:100})).toThrow();
  expect(()=>usageCost({input_tokens:1000,output_tokens:100,cache_creation_input_tokens:1000})).toThrow();
  expect(()=>reservation(MAX_INPUT_BYTES+1)).toThrow();
  expect(.0228431+64*reservation(MAX_INPUT_BYTES)).toBeLessThanOrEqual(.10);
});
