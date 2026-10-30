import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import {
  moduleFor,
  type Project,
  type Entity,
  type Change,
  type Conversation,
  type Operation,
  type ModelConnection,
  type ModuleId,
} from "../shared/domain";
export async function api<T = any>(
  url: string,
  body?: any,
  method?: string,
): Promise<T> {
  const response = await fetch("/api" + url, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求未完成");
  return data;
}
function read<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export const useWorkspace = defineStore("workspace", () => {
  const projects = ref<Project[]>([]),
    projectId = ref(read("projectId", "")),
    moduleId = ref<ModuleId>(read("moduleId", "concept")),
    selected = ref<Record<string, string>>(read("selected", {}));
  const conversations = ref<Conversation[]>([]),
    globalChat = ref(read("globalChat", true)),
    conversationSelection = ref<Record<string, string>>(
      read("conversationSelection", {}),
    ),
    changes = ref<Change[]>([]),
    jobs = ref<any[]>([]),
    connections = ref<ModelConnection[]>([]),
    releases = ref<any[]>([]),
    guidelines = ref<any[]>([]),
    settings = ref<any>({}),
    error = ref(""),
    notice = ref("");
  const project = computed(() =>
    projects.value.find((p) => p.id === projectId.value),
  );
  const entities = computed(() => project.value?.data.entities || []);
  const selectionKey = computed(() => projectId.value + ":" + moduleId.value);
  const entity = computed(() =>
    entities.value.find((e) => e.id === selected.value[selectionKey.value]),
  );
  const scopeKey = computed(() =>
    globalChat.value
      ? projectId.value + ":all:project"
      : selectionKey.value + ":" + (entity.value?.id || "module"),
  );
  const currentConversations = computed(() =>
    conversations.value.filter(
      (c) =>
        c.module === (globalChat.value ? "all" : moduleId.value) &&
        c.entityId === (globalChat.value ? null : entity.value?.id || null),
    ),
  );
  const currentConversation = computed(
    () =>
      currentConversations.value.find(
        (c) => c.id === conversationSelection.value[scopeKey.value],
      ) || currentConversations.value[0],
  );
  const composeIntent = ref("");
  const mentionIntent = ref<string[]>([]);
  const surface = ref(read("surface:"+projectId.value,"overview"));
  const readMode = ref<"read"|"edit">("read");
  const streams = ref<Record<string,string>>({});
  const steps = ref<Record<string,string>>({});
  const activityVersion=ref(0);
  const changedIds=ref<string[]>([]), pendingAnchor=ref("");
  let highlightTimer:ReturnType<typeof setTimeout>;
  function markChange(change?:Change){
    if(!change || change.status!=="applied")return;
    changedIds.value=[...new Set(change.operations.map((op:any)=>op.documentId||op.entityId||op.entity?.id).filter(Boolean))] as string[];
    clearTimeout(highlightTimer);highlightTimer=setTimeout(()=>changedIds.value=[],8000);
  }
  function locateChange(change:Change){
    const op:any=change.operations.find((o:any)=>o.documentId||o.entityId||o.entity?.id);
    const target=entities.value.find(e=>e.id===(op?.documentId||op?.entityId||op?.entity?.id));
    if(!target)return;
    selectModule(moduleFor(target.kind));selectEntity(target);readMode.value="read";
    pendingAnchor.value=op.blockId ? "block-"+op.blockId : "read-"+target.id;
    markChange(change);
  }
  watch(surface,v=>localStorage.setItem("surface:"+projectId.value,JSON.stringify(v)));

  const running = computed(() =>
    jobs.value.filter((j) => j.status === "running" || j.status === "queued"),
  );
  function persist() {
    localStorage.setItem("projectId", JSON.stringify(projectId.value));
    localStorage.setItem("moduleId", JSON.stringify(moduleId.value));
    localStorage.setItem("selected", JSON.stringify(selected.value));
    localStorage.setItem("globalChat", JSON.stringify(globalChat.value));
    localStorage.setItem(
      "conversationSelection",
      JSON.stringify(conversationSelection.value),
    );
  }
  watch(globalChat, persist);
  function setProject(p: Project) {
    const i = projects.value.findIndex((x) => x.id === p.id);
    if (i < 0) projects.value.unshift(p);
    else projects.value[i] = p;
  }
  async function refresh() {
    projects.value = await api("/projects");
    if (!project.value && projects.value.length)
      projectId.value = projects.value.find((p) => !p.archived)?.id || "";
    await Promise.all([refreshJobs(), loadConnections(), refreshDetails()]);
    persist();
  }
  async function refreshDetails() {
    if (!projectId.value) return;
    const pid = projectId.value;
    const [cs, ch, rs] = await Promise.all([
      api<Conversation[]>("/projects/" + pid + "/conversations"),
      api<Change[]>("/projects/" + pid + "/changes"),
      api<any[]>("/projects/" + pid + "/releases"),
    ]);
    if (pid !== projectId.value) return;
    conversations.value = cs;
    changes.value = ch;
    releases.value = rs;
  }
  async function refreshJobs() {
    jobs.value = await api("/jobs");
  }
  async function loadConnections() {
    connections.value = await api("/connections");
    settings.value = await api("/settings");
    guidelines.value = await api("/guidelines");
  }
  async function openProject(pid: string) {
    projectId.value = pid;
    surface.value=read("surface:"+pid,"overview");
    readMode.value="read";
    persist();
    await refreshDetails();
  }
  function selectModule(mid: ModuleId) {
    moduleId.value = mid;
    surface.value=mid==="delivery"?"delivery":mid==="writing"||mid==="structure"?"story":mid==="performance"?"rehearsal":"materials";
    readMode.value="read";
    persist();
  }
  function selectEntity(e?: Entity) {
    if (e) selected.value[selectionKey.value] = e.id;
    else delete selected.value[selectionKey.value];
    persist();
  }
  async function apply(
    operations: Operation[],
    summary: string,
    baseRevision?: number,
    scope?: any,
  ) {
    if (!project.value) throw new Error("请先选择项目");
    const result = await api<{ project: Project; change: Change }>(
      "/projects/" + projectId.value + "/changes",
      {
        requestId: crypto.randomUUID(),
        baseRevision: baseRevision ?? project.value.revision,
        operations,
        scope: scope || { module: moduleId.value, projectWide: true },
        summary,
      },
    );
    setProject(result.project);
    markChange(result.change);
    await refreshDetails();
    return result;
  }
  async function ensureConversation(title?: string, branch = false) {
    if (currentConversation.value && !branch) return currentConversation.value;
    const c = await api<Conversation>(
      "/projects/" + projectId.value + "/conversations",
      {
        module: globalChat.value ? "all" : moduleId.value,
        entityId: globalChat.value ? undefined : entity.value?.id,
        title: title || "新的讨论",
        copyFrom: branch ? currentConversation.value?.id : undefined,
      },
    );
    conversations.value.unshift(c);
    conversationSelection.value[scopeKey.value] = c.id;
    persist();
    return c;
  }
  async function newChat() {
    const c = await api<Conversation>(
      "/projects/" + projectId.value + "/conversations",
      {
        module: globalChat.value ? "all" : moduleId.value,
        entityId: globalChat.value ? undefined : entity.value?.id,
        title: "新的讨论",
      },
    );
    conversations.value.unshift(c);
    conversationSelection.value[scopeKey.value] = c.id;
    persist();
  }
  function chooseChat(cid: string) {
    conversationSelection.value[scopeKey.value] = cid;
    persist();
  }
  async function send(
    prompt: string,
    options: {
      discussOnly: boolean;
      projectWide: boolean;
      modelId?: string;
      entityIds?: string[];
      selection?: any;
    },
  ) {
    const c = await ensureConversation(prompt.slice(0, 18));
    const scopedIds = [
      ...new Set([
        ...(!globalChat.value && entity.value ? [entity.value.id] : []),
        ...(options.entityIds || []),
      ]),
    ];
    const wholeProject =
      options.projectWide || (globalChat.value && scopedIds.length === 0);
    const job = await api("/projects/"+projectId.value+"/turns", {
      requestId:crypto.randomUUID(),conversationId:c.id,message:prompt,mode:"auto",
      discussOnly:options.discussOnly,expectedRevision:project.value?.revision,
      references:scopedIds.map(entityId=>({entityId})),
      module:globalChat.value?"all":moduleId.value,
      selection:options.selection,modelId:options.modelId||undefined,
    });
    if(job.mode==="navigate"){if(job.moduleId)selectModule(job.moduleId);const e=entities.value.find(e=>e.id===job.entityId);if(e){selectModule(moduleFor(e.kind));selectEntity(e);readMode.value="read";}pendingAnchor.value=job.blockId?"block-"+job.blockId:"read-"+(job.entityId||job.moduleId);}
    await Promise.all([refreshDetails(), refreshJobs()]);
    return job;
  }
  async function create(title: string, demo = false) {
    const p = await api<Project>(
      demo ? "/projects/demo" : "/projects",
      demo ? {} : { title },
    );
    setProject(p);
    await openProject(p.id);
    moduleId.value = demo ? "writing" : "concept";
    if (demo) {
      const d = p.data.entities.find((e) => e.kind === "document");
      if (d) selectEntity(d);
    }
    persist();
    return p;
  }
  async function resolve(c: Change, action: "apply" | "reject") {
    const r = await api("/changes/" + c.id + "/resolve", {
      action,
      baseRevision: project.value?.revision,
      operations: c.operations,
    });
    setProject(r.project);
    await refreshDetails();
  }
  async function undo(cid: string) {
    const p = await api<Project>("/changes/" + cid + "/undo", {});
    setProject(p);
    await refreshDetails();
  }
  async function updateMeta(changes: any) {
    const p = await api<Project>(
      "/projects/" + projectId.value,
      changes,
      "PATCH",
    );
    setProject(p);
  }
  function fail(e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  }
  let events: EventSource | null = null;
  function connectEvents() {
    events?.close();
    events=new EventSource("/api/activity");
    let chain=Promise.resolve();
    events.onmessage=(event)=>{
      const data=JSON.parse(event.data);
      if(data.type==="answer_start"){streams.value[data.job_id]="";return;}
      if(data.type==="answer_delta"){streams.value[data.job_id]=(streams.value[data.job_id]||"")+data.payload.delta;return;}
      if(data.type==="step"){steps.value[data.job_id]=data.payload.label;return;}
      chain=chain.then(async()=>{
        if(data.type==="sync"){for(const s of data.streams||[]){streams.value[s.id]=s.text;steps.value[s.id]=s.label;}await Promise.all([refreshJobs(),refreshDetails()]);return;}
        if(data.type==="job"){
          const job=await api("/jobs/"+data.job_id);
          const i=jobs.value.findIndex(j=>j.id===job.id);
          if(i<0)jobs.value.unshift(job);else jobs.value[i]=job;
          if(["completed","failed","paused","cancelled"].includes(job.status)){await refreshDetails();if(job.status==="completed")markChange(changes.value.find(c=>c.id===job.result?.changeId));}
        }
        if(data.type==="message" && data.project_id===projectId.value)await refreshDetails();
        if(data.type==="revision"){
          setProject(await api("/projects/"+data.project_id));
          if(data.project_id===projectId.value)await refreshDetails();
        }
        activityVersion.value++;
      }).catch(fail);
    };
  }

  return {
    composeIntent, mentionIntent, surface,readMode,streams,steps,activityVersion,changedIds,pendingAnchor,locateChange,
    globalChat,
    projects,
    projectId,
    moduleId,
    selected,
    project,
    entities,
    entity,
    scopeKey,
    currentConversations,
    currentConversation,
    conversations,
    changes,
    jobs,
    connections,
    releases,
    guidelines,
    settings,
    error,
    notice,
    running,
    refresh,
    refreshJobs,
    refreshDetails,
    loadConnections,
    setProject,
    openProject,
    selectModule,
    selectEntity,
    apply,
    ensureConversation,
    newChat,
    chooseChat,
    send,
    create,
    resolve,
    undo,
    updateMeta,
    fail,
    connectEvents,
  };
});
