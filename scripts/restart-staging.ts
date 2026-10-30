import {DatabaseSync} from 'node:sqlite';import {execFileSync} from 'node:child_process';
const db=new DatabaseSync('output/v05-staging/workbench.sqlite');const count=(db.prepare("SELECT count(*) n FROM jobs WHERE status='running'").get() as any).n;if(count)throw Error('验收任务仍在执行');
const pid=execFileSync('lsof',['-ti','tcp:4315','-sTCP:LISTEN'],{encoding:'utf8'}).trim();for(const p of pid.split('\n'))if(p)process.kill(Number(p),'SIGTERM');db.close();
