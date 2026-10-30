import fs from 'node:fs';
import {newEntity,doc,type Entity} from '../shared/domain.js';
import {createProject} from './projects.js';
export function experienceProject(){
 const es:Entity[]=[];
 function add(kind:Entity['kind'],title:string,fields:Entity['fields']={},refs:string[]=[],body='',audience:Entity['audience']='author'){
 const e=newEntity(kind,title);e.fields=fields;e.refs=refs;e.body=doc(body);e.audience=audience;e.order=es.filter(x=>x.kind===kind).length;es.push(e);return e;
 }
 const origin=add('source','新编体验本 · 创作说明',{origin:'V0.5《末班信箱》独立创作',purpose:'事实依据'},[], '本作品为新编双人三幕情感本，非历史对话中恢复的定稿。文字初稿供完整流程体验，预计60—90分钟，尚未经过真人试跑。正文由模型辅助起草、按固定事实审校；作者可自由修订。');origin.locked=true;
 const premise=add('concept','当年没有寄到的话',{conflict:'旧公交站改造前，林晚和陈屿来核对十一年前投入信箱的两封信。他们都以为自己的决定已被对方知道，却一直没有问过答案。',experience:'扮演各自有前途与牵挂的成年人，重读少年时的决定，选择这次怎样表达。',genre:'现代 · 情感',players:2,minutes:75,tone:'克制、温暖、允许遗憾',ending:'两封信因保管交接遗漏而没有投递。林晚与陈屿各自决定是否接受新的外地邀请，再分别决定旧信去向；去留没有标准答案。'},[origin.id]);
 const a=add('character','林晚',{role:'玩家',identity:'28岁，文献修复师',desire:'决定是否接受一年的外地修复驻留邀请',secret:'当年因母亲生病决定留下，在信中如实写给陈屿；后来母亲康复，自己拿到奖学金离城。',knowledge:'以为陈屿收到信，后来各自很少讨论去留。',involvement:'亲手投信，没有操控别人的信件',arc:'不再只等对方猜到，把此刻的意愿说清楚。'},[premise.id]);
 const b=add('character','陈屿',{role:'玩家',identity:'29岁，公交调度员',desire:'决定是否接受半年的外地培训',secret:'当年因父亲受伤留下工作，信却写自己去外地学交通工程，希望林晚放心申请学校。',knowledge:'以为林晚收到自己的信，不知道她当时曾决定留下。',involvement:'自行隐瞒个人决定，没有资助或替林晚放弃机会',arc:'把照顾别人和替别人作决定分开。'},[premise.id]);
 const du=add('character','老杜',{role:'NPC',identity:'退休邮递员，主持兼演',desire:'完成信件核对与移交，承担自己的工作遗漏',secret:'周四17:20因信箱漏水提前收件；接到医院急召后交接遗漏，信未转运。',knowledge:'第二幕才出示收件簿与交接页',involvement:'保管遗漏，不恶意截信'},[premise.id]);
 add('relationship','林晚与陈屿',{attraction:'少年邻居，熟悉彼此的工作愿望',evidence:'曾在同一站等车，以信约定讲清自己的打算。',conflict:'把自己的沉默当成对方已经懂得；没有核实对方的选择。',repair:'自主交换旧信与现在的计划；不要求公开全部隐私或确立爱情。'},[a.id,b.id]);
 const rule=add('constraint','信息释放与玩家决定',{rule:'第一幕只认信封笔迹，不知未投递事实；第二幕记录揭露后只发给本人旧信；第三幕去留、信件去向由玩家各自决定。禁止强迫道歉、关系绑定或悲剧。',scope:'全文与演绎',origin:'新编体验本事实表'},[premise.id]);rule.locked=true;
 add('event','两封信没有投递',{time:'十一年前周四17:20',place:'旧白沙站及保管室',actor:'老杜',truth:'周三两人分别投信；周四暴雨提前收取两封，老杜临时赴医院，交接遗漏未转运。',result:'双方以为信息已传达。母亲后来康复，林晚获奖学金离城；陈屿仍在白沙工作。'},[a.id,b.id,du.id]);
 const names=['认得的笔迹','没有抵达的决定','下一站由你填写'];
 const goals=['认出自己的信封，谈一个当年共同熟悉的细节。','核对记录，按个人意愿决定如何讲述自己的旧信。','讨论新的邀请，分别决定去留及旧信归属。'];
 const chapters=names.map((name,i)=>add('act',`第${i+1}幕 · ${name}`,{goal:goals[i],entry:i?'上一幕分享结束':'18:00抵达旧站',exit:i===0?'笔迹核对，尚未知道信未投递':i===1?'客观遗漏已知，私人信件内容可自主分享':'玩家作出个人选择，留下未答问题亦可',emotion:[2,4,3][i]},[premise.id]));
 const cards=[
 ['水损信封','两个信封边缘都有水痕，只展示封面与笔迹。尚不能判断其是否投递过。',0,a],
 ['水损信封','两个信封边缘都有水痕，只展示封面与笔迹。尚不能判断其是否投递过。',0,b],
 ['收件簿','周四17:20，旧白沙站，提前收取信件两封。备注：信箱漏水，转入保管室。',1,a],
 ['收件簿','周四17:20，旧白沙站，提前收取信件两封。备注：信箱漏水，转入保管室。',1,b],
 ['保管交接页','两封信：未转运。收取后保管；临时交接无签收人。今日核对后由寄信人自行处理。',1,a],
 ['保管交接页','两封信：未转运。收取后保管；临时交接无签收人。今日核对后由寄信人自行处理。',1,b],
 ['林晚旧信','陈屿：我不走了。我妈病着，家里离不开人，你不用管我这边。你安心去申请外地的学校，你的分数够，别浪费在我身上。白沙的公交站以后坐不到了，你到了那边，替我多坐几次。就这样。林晚。',1,a],
 ['陈屿旧信','林晚，我去外地学交通工程了。你放心申请修复学校，别犹豫。以后可以告诉我你修好的第一件东西。陈屿。',1,b],
 ['候车亭施工图','旧站改为公共候车亭；信箱送档案馆保存。信件归属由寄信人决定，不随信箱强制移交。',2,a],
 ['候车亭施工图','旧站改为公共候车亭；信箱送档案馆保存。信件归属由寄信人决定，不随信箱强制移交。',2,b]
 ] as const;
 for(const [title,text,i,owner] of cards)add('clue',`${owner.title} · ${title}`,{acquire:'由主持在对应幕发给本人',revealAt:i+1},[owner.id,chapters[i].id],text,'player');
 for(const who of [a,b])for(let i=0;i<3;i++){
 const body=fs.readFileSync(new URL(`./fixtures/new-story/${who.title}-${i+1}.txt`,import.meta.url),'utf8');
 add('document',`${who.title} · 第${i+1}幕`,{pov:'第二人称',minChars:1500,maxChars:2100,authorNote:'新编初稿；未线下试跑。'},[who.id,chapters[i].id,rule.id,origin.id],body,'player');
 }
 chapters.forEach((act,i)=>{
 const script=[
 '老杜带来保管袋，展示两封水损信封外观：“先看一看笔迹。哪一封是你写的？先别拆，记录还要核对。”不能说未送达。请玩家各分享一个等车的记忆，5分钟后进入第二幕。',
 '老杜出示收件簿、交接页：“周四我怕信泡坏，提前收了。临时去了医院，交接少了这一项，两封都没有转运。这是我的遗漏，不该让你们来替我解释。”依寄信人发回旧信：“你可以读给对方，也可以只说愿意说的部分。”不替玩家念私人信。',
 '老杜展开施工图：“箱子19:15接走，信不一定跟它走。你们各自决定。”分别问是否接受现在的邀请，再问信交档案馆、带回或销毁。将玩家原话写在记录表，无正确答案，不擅自宣布团圆或决裂。'
 ][i];
 add('performance',`老杜 · 第${i+1}幕`,{start:i*25,duration:25,performers:'老杜',place:'候车亭一桌两椅',entry:i?'上幕自愿分享告一段落':'说明暂停手势及隐私边界，分别发第一幕',goal:goals[i],cooperate:script,silent:'给两分钟独立思考；允许以写字、只回答一题或跳过分享继续。',refuse:'承认可以不拆信、不公开内容；只提供双方可见记录，仍能推进下一幕。',unexpected:'只回答本幕已揭露的客观事实；不代另一位玩家回答，超出资料则说明暂无依据。',exit:i===2?'收回道具，询问出戏及试跑反馈，不评价选择。':'确认两人均读完，再分别发下一幕与对应线索。',props:'两份角色本、信封、收件簿、交接页、施工图、笔；无需音效'},[act.id,du.id],script,'npc');
 });
 add('performance','主持全流程',{start:0,duration:75,performers:'主持兼老杜',entry:'分配角色，允许不定义爱情；确认暂停手势。',goal:'0—25分钟认信；25—50分钟核对记录；50—75分钟作个人决定。',cooperate:'每幕两人各自阅读约7—10分钟，分享与演绎约15分钟。每次只发本幕；线索分角色装袋。正文未读完则顺延，不用计时催促情绪。',silent:'用具体问题替代评价：你愿意让对方知道哪一句？也可不答。',refuse:'允许跳过私密分享，仍保留独立决策。',unexpected:'超时缩短主持发言，不删玩家自主选择。',exit:'询问阅读耗时、卡点、角色边缘感，标记未验证项。',props:'主持流程、两份独立玩家包、10张线索卡（共用证据各复制一份）、两支笔、两个旧信封。'},chapters.map(x=>x.id),'此本无凶案和淘汰机制；不以投票决定谁对谁错。','dm');
 add('object','物料核对表',{owner:'主持',gesture:'按角色和幕分袋',payoff:'归还私人信件或经玩家允许处理'},[], '林晚本3幕；陈屿本3幕；每人5张卡；老杜演绎3场；主持流程1份；试跑表1份。候车亭施工图可黑白打印。两张空纸用于玩家写当下决定。','dm');
 add('playtest','试跑观察表 · 尚未试跑',{version:'初稿',friction:'待记录：各幕阅读分钟、首次困惑位置、错误推断及澄清方式。',participation:'待记录：两名玩家的发言、决定、沉默是否出于主动选择。',load:'待记录：主持兼演是否有切换负荷、线索是否提前发出。'},chapters.map(x=>x.id),'实际开始：____；结束：____；参与人：____；修改建议与原文位置：____；下次验证：____','dm');
 return createProject('末班信箱 · 新编体验本','两位少年邻居在旧公交站重逢，核对当年投入信箱的信件，并决定各自的下一站。双人三幕，预计60—90分钟；新编文字初稿，未试跑。',es);
}
export function archiveProject(){
 const es:Entity[]=[];
 for(const [folder,name] of [['first','剧本杀.md'],['second','剧本杀2.md']]){
 // 本仓库不随附这两份个人聊天导出；缺失时跳过，其余示例照常可用。
 let records:Array<{id:string;line_start:number;line_end:number;prompt:string;following_export_text:string}>=[];
 try{
  records=fs.readFileSync(new URL(`./fixtures/archive/${folder}/turns.jsonl`,import.meta.url),'utf8').trim().split('\n').map(x=>JSON.parse(x));
 }catch{continue;}
 for(const r of records){
  for(const [type,text] of [['用户要求',r.prompt],['后续导出原文 · 未判定采用',r.following_export_text]]){
   const e=newEntity('source',`${name} · ${r.id} · ${type}`);e.order=es.length;e.fields={origin:`${name}:${r.line_start}—${r.line_end}`,purpose:'历史讨论'};e.body=doc(text);e.locked=true;es.push(e);
  }
 }
 }
 const notice=newEntity('source','档案说明与附件缺口');notice.fields={origin:'两份聊天原文及轮次校验',purpose:'待整理'};notice.body=doc('共182轮；分别保留用户要求与后续导出原文，不能自动把助手候选或历史要求当成当前事实。原文引用的角色本附件尚未全部取得，提及已发送不等于附件已恢复。江家长子、圣子、巫女等人物线按原文各自查看，不拼接成一部定稿；修订先后以原始轮次和行号追踪。');notice.locked=true;es.unshift(notice);
 return createProject('历史创作档案','两份聊天逐轮原文与修改顺序；附件及各人物线最终采用版本仍需对照确认。',es);
}
