import fs from 'node:fs';
import {getSetting,setSetting,db,id,now,transaction} from '../server/db.js';
import {experienceProject,archiveProject} from '../server/experience.js';
import {listProjects,updateProjectMeta} from '../server/projects.js';
import {plain} from '../shared/domain.js';
if(!getSetting('v05ExperienceId','')){const p=experienceProject();setSetting('v05ExperienceId',p.id);console.log('新编体验本已建立',p.id);}
if(!getSetting('v05ArchiveId','')){const p=archiveProject();setSetting('v05ArchiveId',p.id);console.log('历史创作档案已建立',p.id);}
for(const p of listProjects())if(p.title==='西弦古树 · 完整示范' && p.revision===0 && p.data.entities.filter(e=>e.kind==='document').every(e=>plain(e.body).length<500))updateProjectMeta(p.id,{title:'西弦古树 · 流程梗概示例'});

if(!getSetting('v05GuidelineId',''))transaction(()=>{
 const active=db.prepare("SELECT * FROM guidelines WHERE status='active' ORDER BY created_at DESC LIMIT 1").get() as any;
 const base=active?.content || fs.readFileSync(new URL('../server/default-guidelines.md',import.meta.url),'utf8');
 const gid=id();db.prepare("UPDATE guidelines SET status='archived' WHERE status='active'").run();
 db.prepare("INSERT INTO guidelines VALUES(?,?,?,?,?)").run(gid,'剧本杀写作 · V0.5',base+fs.readFileSync(new URL('../server/v05-guidelines.md',import.meta.url),'utf8'),'active',now());setSetting('v05GuidelineId',gid);
 console.log('V0.5 创作规范已启用');
});
