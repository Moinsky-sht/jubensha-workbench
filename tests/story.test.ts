import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
process.env.WORKBENCH_DATA=fs.mkdtempSync(path.join(os.tmpdir(),'story-v05-'));
const {experienceProject}=await import('../server/experience.js');
const {coverage,readingEntries,players,acts}=await import('../shared/story.js');
const {previewHTML}=await import('../server/exports.js');
const {plain,newEntity}=await import('../shared/domain.js');
const {turnMode}=await import('../server/dialogue.js');
test('新编体验本六份独立正文9000—12000字，覆盖按归属和篇幅计算',()=>{
 const p=experienceProject(),documents=p.data.entities.filter(e=>e.kind==='document');
 assert.equal(documents.length,6);const chars=documents.reduce((n,e)=>n+plain(e.body).replace(/\s/g,'').length,0);
 assert.ok(chars>=9000&&chars<=12000,String(chars));assert.equal(coverage(p).completed,6);assert.equal(coverage(p).total,6);
 documents[0].refs.push(players(p)[1].id);assert.equal(coverage(p).completed,5);
 documents[1].body={type:'doc',content:[]};assert.equal(coverage(p).completed,4);
});
test('阅读与打印按角色、幕次隔离；作者备注不进入玩家输出',()=>{
 const p=experienceProject(),characterId=players(p)[0].id;
 const entries=readingEntries(p,{characterId,audience:'player',throughAct:1,includeDraft:true});
 assert.ok(entries.length>0);assert.ok(entries.every(e=>e.refs.includes(characterId)&&e.refs.includes(acts(p)[0].id)));
 const html=previewHTML(p,{revision:0,audience:'player',characterId,throughAct:1,preview:true,format:'pdf'});
 assert.ok(html.includes('林晚 · 第1幕'));assert.ok(!html.includes('陈屿 · 第1幕'));assert.ok(!html.includes('林晚旧信'));assert.ok(!html.includes('作者备注'));
 assert.throws(()=>readingEntries(p,{audience:'player'}),/选择/);assert.throws(()=>previewHTML(p,{revision:0,audience:'player',format:'pdf'}),/选择/);
});
test('提问与含糊建议保守只读，明确改写才写入',()=>{
 for(const q of ['剧本讲了啥','为什么他没有离开','能否修改结局？','我担心删掉这段会不会不好？','采用第二种好吗','不要采用第二种','你觉得这次修改怎么样'])assert.equal(turnMode(q),'answer');
 assert.equal(turnMode('把这段扩写至三倍'),'modify');assert.equal(turnMode('继续生产'),'produce');assert.equal(turnMode('修改这里',true),'answer');
});

test('已有但超篇幅的正文留给修订，不在继续生产时重复建立',async()=>{
 const {creativeTools,workItems,canReuseWorkItem}=await import('../server/agent-tools.js');
 const p=experienceProject();const d=p.data.entities.find(e=>e.kind==='document')!;d.fields.maxChars=100;
 assert.equal(coverage(p).completed,5);
 const tool=creativeTools.find(t=>t.id==='writing.role-draft')!;
 const item=workItems(tool,p).find(i=>i.targetIds?.every(id=>d.refs.includes(id)))!;
 assert.ok(canReuseWorkItem(tool,item,p));
});
test('模型审校保存为待审，不能把剧情推断直接标成确定阻断',async()=>{
 const {creativeTools,workItems,validateToolOperations}=await import('../server/agent-tools.js');
 const p=experienceProject(),tool=creativeTools.find(t=>t.id==='review.continuity')!,item=workItems(tool,p)[0];
 const issue=newEntity('issue','需要核对角色认知');issue.fields={severity:'阻断',evidence:'模型推断',resolution:'未处理'};
 const ops=validateToolOperations(tool,item,p,[{type:'create_entity',entity:issue}]);
 assert.equal((ops[0] as any).entity.fields.severity,'待审');
});
