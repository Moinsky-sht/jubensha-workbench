import fs from 'node:fs';import {PDFParse} from 'pdf-parse';
import {experienceProject} from '../server/experience.js';import {applyChange} from '../server/projects.js';import {printPreview,exportProject} from '../server/exports.js';import {players} from '../shared/story.js';import {db} from '../server/db.js';
const p=experienceProject();const ids=p.data.entities.filter(e=>!e.locked).map(e=>e.id);
const ready=applyChange({projectId:p.id,requestId:'print-'+p.id,baseRevision:0,source:'manual',scope:{module:'all',projectWide:true},summary:'验收环境文字清单定稿',operations:ids.map(entityId=>({type:'update_entity',entityId,changes:{status:'ready'}}))}).project;
const options={revision:ready.revision,audience:'player' as const,characterId:players(ready)[0].id,throughAct:2,template:'role' as const,format:'pdf' as const};
const preview=await printPreview(ready,options);fs.writeFileSync('output/v05-preview.pdf',preview);const release=await exportProject(ready.id,options);const row=db.prepare('SELECT path FROM releases WHERE id=?').get(release.id) as any;const exported=fs.readFileSync(row.path);
const a=new PDFParse({data:preview}),b=new PDFParse({data:exported});const ap=await a.getText(),bp=await b.getText();if(ap.total!==bp.total)throw Error('预览导出页数不一致');if(ap.text.includes('陈屿 · 第1幕')||ap.text.includes('林晚 · 第3幕'))throw Error('玩家信息隔离失败');
if(ap.text.replace(' · 草稿预览','')!==bp.text)throw Error('预览导出内容不同');
fs.writeFileSync('output/v05-print-verification.json',JSON.stringify({pages:ap.total,character:'林晚',throughAct:2,revision:ready.revision,matched:true}));console.log('分页与导出一致',ap.total);await a.destroy();await b.destroy();
