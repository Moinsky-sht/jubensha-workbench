import { plain, type Project, type Entity } from "./domain";
export function players(p: Project) {
  return p.data.entities.filter(e => e.kind === "character" && e.fields.role !== "NPC");
}
export function acts(p: Project) {
  return p.data.entities.filter(e => e.kind === "act").sort((a,b)=>a.order-b.order);
}
export function ownership(p: Project, e: Entity) {
  return { characters: players(p).filter(c=>e.refs.includes(c.id)), acts: acts(p).filter(a=>e.refs.includes(a.id)) };
}
export function coverage(p: Project) {
  const cells = players(p).flatMap(character => acts(p).map(act => {
    const documents = p.data.entities.filter(e=>e.kind === "document" && e.refs.includes(character.id) && e.refs.includes(act.id));
    const document = documents.find(e=> {
      const owner=ownership(p,e);
      return owner.characters.length===1 && owner.acts.length===1 && plain(e.body).replace(/\s/g,"").length >= Math.max(300,Number(e.fields.minChars)||300) && (!Number(e.fields.maxChars)||plain(e.body).replace(/\s/g,"").length<=Number(e.fields.maxChars)) && !e.stale;
    });
    return { characterId:character.id,actId:act.id,documentId:document?.id,complete:!!document };
  }));
  return { cells, completed:cells.filter(c=>c.complete).length,total:cells.length };
}
export type ReadingOptions = {characterId?:string; actId?:string; throughAct?:number; audience?:string; includeDraft?:boolean};
export function readingEntries(p: Project,o: ReadingOptions={}) {
  const allActs=acts(p), allPlayers=players(p);
  if(o.audience==="player" && (!o.characterId || !allPlayers.some(c=>c.id===o.characterId))) throw new Error("请选择玩家角色");
  if(o.characterId && !allPlayers.some(c=>c.id===o.characterId)) throw new Error("角色不存在");
  return p.data.entities.filter(e=> {
    if(!["document","performance","clue","memory","object","task"].includes(e.kind))return false;
    if(o.includeDraft===false && e.status!=="ready")return false;
    const owner=ownership(p,e);
    if(o.audience && o.audience!=="author" && e.audience!==o.audience)return false;
    if(o.characterId && (!e.refs.includes(o.characterId) || (o.audience==="player" && owner.characters.length!==1)))return false;
    if(o.audience==="player" && e.kind==="document" && owner.acts.length!==1)return false;
    if(o.actId && !e.refs.includes(o.actId))return false;
    if(o.throughAct!==undefined) {
      const positions=owner.acts.map(a=>allActs.findIndex(x=>x.id===a.id)+1);
      const reveal=Number(e.fields.revealAt);
      if(e.kind!=="document" && !positions.length && !reveal)return false;
      if(positions.some(n=>n>o.throughAct!) || reveal>o.throughAct)return false;
    }
    return true;
  }).sort((a,b)=> {
    const position=(e:Entity)=>allActs.findIndex(act=>e.refs.includes(act.id));
    return position(a)-position(b)||a.order-b.order;
  });
}
