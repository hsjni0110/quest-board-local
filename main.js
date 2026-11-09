"use strict";
const { Plugin, Modal, Notice, ItemView, Component, MarkdownRenderer } = require("obsidian");
// All paths are relative to the vault root. Management is a real folder
// INSIDE the vault, not the name of the vault. Never infer from vault name.
function resolvePaths() {
 const base="Management/";
 return Object.freeze({
  ROOT:`${base}02_Goals`,
  ACTIVE:`${base}02_Goals/Active`,
  CLEARED:`${base}02_Goals/Cleared`,
  INBOX:`${base}03_Lists/Inbox.md`,
  TASK_NOTES:`${base}04_TaskNotes`,
  DASHBOARD:`${base}00_Home/Dashboard.md`
 });
}
const OPEN="미달성",DONE="달성",START="<!-- QB:TASKS:START -->",END="<!-- QB:TASKS:END -->",VIEW_TYPE="quest-board-view";

function el(parent,tag,cls="",content) {const node=document.createElement(tag);if(cls)node.className=cls;if(content!==undefined)node.textContent=String(content);parent.appendChild(node);return node;}
function btn(parent,label,cls,fn) {const node=el(parent,"button",cls,label);node.type="button";node.addEventListener("click",async()=>{if(node.disabled)return;node.disabled=true;try{await fn();}catch(e){new Notice("대시보드: "+(e.message||e));console.error(e);}finally{node.disabled=false;}});return node;}
function today(d=new Date()) {return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");}
function relativeDay(n) {const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+n);return today(d);}
function dateValid(s) {if(!s)return true;if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const [y,m,d]=s.split("-").map(Number),x=new Date(y,m-1,d);return x.getFullYear()===y&&x.getMonth()===m-1&&x.getDate()===d;}
function titleClean(s) {return String(s??"").replace(/[\r\n]+/g," ").trim();}
function fileSafe(s) {return titleClean(s).replace(/[\\/:*?"<>|#^\[\]]/g,"-").replace(/\.+$/g,"").trim().slice(0,100);}
function uid() {return `qb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;}
function property(content,key) {const front=content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);if(!front)return "";const line=front[1].split(/\r?\n/).find(x=>x.trimStart().startsWith(key+":"));if(!line)return "";return line.slice(line.indexOf(":")+1).trim().replace(/^(?:'([^']*)'|"([^"]*)")$/,(_,a,b)=>a??b).trim();}
function parseTask(line,path,index) {const m=line.match(/^(\s*)([-*])\s+\[([ xX])\]\s+(.+?)\s*$/);if(!m)return null;let raw=m[4];const idM=raw.match(/\s+\^(qb-[\w-]+)\s*$/i);const id=idM?idM[1]:"";if(idM)raw=raw.slice(0,idM.index);const date=(mark)=>{const hit=raw.match(new RegExp(`${mark}\\s+(\\d{4}-\\d{2}-\\d{2})`));return hit?hit[1]:"";};return {id,path,index,rawLine:line,indent:m[1],bullet:m[2],completed:m[3].toLowerCase()==="x",scheduled:date("⏳"),due:date("📅"),doneDate:date("✅"),title:raw.replace(/\s*(?:⏳|📅|✅)\s+\d{4}-\d{2}-\d{2}/g," ").replace(/\s+/g," ").trim()};}
function formatTask(t) {let line=`${t.indent??""}${t.bullet??"-"} [${t.completed?"x":" "}] ${titleClean(t.title)}`;if(t.scheduled)line+=` ⏳ ${t.scheduled}`;if(t.due)line+=` 📅 ${t.due}`;if(t.completed&&t.doneDate)line+=` ✅ ${t.doneDate}`;return line+` ^${t.id||uid()}`;}
function validateTask(t) {if(!titleClean(t.title))throw Error("할 일 제목이 필요합니다.");if(!dateValid(t.scheduled)||!dateValid(t.due))throw Error("날짜는 YYYY-MM-DD 형식으로 입력하세요.");}
function taskIndex(lines,t) {if(t.id){const id=`^${t.id}`;const i=lines.findIndex(s=>s.trimEnd().endsWith(id));if(i>=0)return i;}if(lines[t.index]===t.rawLine)return t.index;return lines.findIndex(s=>s===t.rawLine);}

/** Date text stays readable across Obsidian themes; a separate native control opens the OS calendar. */
function dateControl(parent, value = "", caption = "날짜") {
 const wrap=el(parent,"div","qb-date-control");
 const input=el(wrap,"input","qb-input qb-date-text");
 input.type="text";input.inputMode="numeric";input.placeholder="YYYY-MM-DD";
 input.value=value||"";input.maxLength=10;input.autocomplete="off";
 input.setAttribute("aria-label",caption);
 const buttonIcon=el(wrap,"span","qb-date-icon");
 buttonIcon.setAttribute("aria-hidden","true");
 const picker=el(wrap,"input","qb-date-native");
 picker.type="date";picker.value=value||"";
 picker.setAttribute("aria-label",`${caption} 달력으로 선택`);
 picker.addEventListener("change",()=>{input.value=picker.value;});
 input.addEventListener("change",()=>{if(dateValid(input.value))picker.value=input.value;});
 return input;
}

class EntryModal extends Modal {
 constructor(app,settings){super(app);this.settings=settings;}
 onOpen(){const root=this.contentEl;root.empty();root.addClass("qb-modal");el(root,"h2","qb-modal-title",this.settings.title);if(this.settings.hint)el(root,"p","qb-modal-hint",this.settings.hint);const form=el(root,"form","qb-form"),inputs={};for(const field of this.settings.fields){const label=el(form,"label","qb-field");el(label,"span","qb-field-title",field.label);let input;if(field.options){input=el(label,"select","qb-input");for(const opt of field.options){const option=el(input,"option","",opt.label);option.value=opt.value;}}else if(field.type==="date"){input=dateControl(label,field.value??"",field.label);}else{input=el(label,"input","qb-input");input.type=field.type||"text";}input.value=field.value??"";input.required=!!field.required;if(field.placeholder)input.placeholder=field.placeholder;inputs[field.key]=input;}const err=el(form,"p","qb-error");err.setAttribute("role","alert");const actions=el(form,"div","qb-modal-actions");btn(actions,"취소","qb-btn qb-outline",()=>this.close());const save=el(actions,"button","qb-btn qb-primary",this.settings.submitText||"저장");save.type="submit";form.addEventListener("submit",async ev=>{ev.preventDefault();if(save.disabled)return;save.disabled=true;err.textContent="";const data={};for(const [key,input] of Object.entries(inputs))data[key]=input.value.trim();try{await this.settings.submit(data);this.close();}catch(e){err.textContent=e.message||String(e);console.error(e);}finally{save.disabled=false;}});}
 onClose(){this.contentEl.empty();}
}

/** A task's note is a separate Markdown file. Existing task lines remain readable in any editor. */
class TaskDetailModal extends Modal {
 constructor(app,plugin,task){super(app);this.plugin=plugin;this.task=task;this.blocks=[];this.rawMode=false;this.renderer=null;this.originalNote="";this.currentId=task.id||"";}
 async onOpen(){
  const root=this.contentEl;root.empty();root.addClass("qb-modal","qb-detail-modal");
  this.renderer=new Component();this.renderer.load();
   // The title itself is the primary editable heading; no duplicate page title or helper paragraph.
   const heading=el(root,"div","qb-detail-heading");
   this.titleInput=el(heading,"input","qb-detail-title-input");
   this.titleInput.type="text";
   this.titleInput.value=this.task.title;
   this.titleInput.placeholder="할 일 제목";
   this.titleInput.setAttribute("aria-label","할 일 제목");
   const dates=el(root,"div","qb-detail-dates");
   const dateInput=(caption,value)=>{const label=el(dates,"label","qb-field");el(label,"span","qb-field-title",caption);return dateControl(label,value,caption);};
   this.startInput=dateInput("시작",this.task.scheduled);
   this.endInput=dateInput("종료",this.task.due);
   const noteHeading=el(root,"div","qb-note-heading");
   el(noteHeading,"strong","","노트");
   const sourceButton=btn(noteHeading,"마크다운 원문","qb-btn qb-quiet",()=>this.toggleRawMode(sourceButton));
  this.editorRoot=el(root,"div","qb-note-editor");
  this.errorEl=el(root,"p","qb-error");this.errorEl.setAttribute("role","alert");
  const actions=el(root,"div","qb-modal-actions");
  btn(actions,"취소","qb-btn qb-outline",()=>this.close());
  this.saveButton=btn(actions,"저장","qb-btn qb-primary",()=>this.saveAndClose());
  try{
    const {id,content}=await this.plugin.loadTaskNote(this.task);
    this.currentId=id;this.originalNote=content;
    this.blocks=content.replace(/\r\n/g,"\n").split("\n");
    if(!this.blocks.length)this.blocks=[""];
    this.showBlocks();
  } catch(error){this.errorEl.textContent=error.message||String(error);}
 }
 sourceText(){return this.rawMode?this.rawEditor.value.replace(/\r\n/g,"\n"):this.blocks.join("\n");}
 toggleRawMode(button){
  const text=this.sourceText();this.rawMode=!this.rawMode;
  this.blocks=text.split("\n");
  button.textContent=this.rawMode?"블록 편집":"마크다운 원문";
  if(this.rawMode)this.showRaw();else this.showBlocks();
 }
  showRaw(){
   this.editorRoot.empty();
   this.rawEditor=el(this.editorRoot,"textarea","qb-note-raw");
   this.rawEditor.value=this.blocks.join("\n");
   this.rawEditor.setAttribute("aria-label","마크다운 원문 편집");
   this.rawEditor.placeholder="노트를 작성하세요. # 제목, - 목록, **강조** 등의 마크다운을 사용할 수 있습니다.";
   const preview=el(this.editorRoot,"div","qb-note-live-preview markdown-rendered");
   preview.setAttribute("aria-label","실시간 마크다운 미리보기");
   let version=0;
   const update=async()=>{
     const latest=++version,markdown=this.rawEditor.value;
     if(!markdown.trim()){preview.empty();return;}
     // Rendering is local and the text is rendered with Obsidian's safe MarkdownRenderer.
     const temp=document.createElement("div");
     try{await MarkdownRenderer.render(this.app,markdown,temp,this.plugin.paths.TASK_NOTES,this.renderer);
       if(version===latest){preview.empty();while(temp.firstChild)preview.appendChild(temp.firstChild);
         if(!preview.children?.length)preview.textContent=temp.textContent;}
     }catch(error){if(version===latest)preview.textContent=markdown;}
   };
   this.rawEditor.addEventListener("input",update);
   update();
  }
 showBlocks(focus=-1,cursor=0){
  this.editorRoot.empty();
  const list=el(this.editorRoot,"div","qb-note-blocks");
  if(!this.blocks.length)this.blocks=[""];
  this.blocks.forEach((_,index)=>this.makeBlock(list,index));
  if(focus>=0){
    const editors=list.querySelectorAll?.("textarea.qb-note-line")||[];
    const input=editors[focus];
    if(input){this.activateLine(input);input.focus();const n=Math.min(cursor,input.value.length);input.setSelectionRange?.(n,n);}
  }
 }
 activateLine(input){
  const wrapper=input.parentElement;
  if(wrapper){wrapper.classList.add("editing");wrapper.querySelector(".qb-note-preview")?.classList.add("hidden");}
  input.classList.remove("hidden");
  input.style.height="auto";input.style.height=Math.max(36,input.scrollHeight||36)+"px";
 }
 async previewBlock(container,text){
  container.empty();
  if(!text.trim()){el(container,"span","qb-placeholder","내용을 입력하세요...");return;}
  try{await MarkdownRenderer.render(this.app,text,container,this.plugin.paths.TASK_NOTES,this.renderer);}
  catch(error){container.textContent=text;}
 }
 makeBlock(parent,index){
  const wrapper=el(parent,"div","qb-note-line-wrap");
  let detached=false;
  const preview=el(wrapper,"div","qb-note-preview markdown-rendered");
  const input=el(wrapper,"textarea","qb-note-line hidden");
  input.value=this.blocks[index];input.rows=1;input.setAttribute("aria-label",`${index+1}번째 노트 줄`);
  this.previewBlock(preview,this.blocks[index]);
  if(!this.blocks[index].trim())this.activateLine(input);
  preview.addEventListener("click",()=>{this.activateLine(input);input.focus();});
  input.addEventListener("input",()=>{
    this.blocks[index]=input.value;
    input.style.height="auto";input.style.height=Math.max(36,input.scrollHeight||36)+"px";
  });
  input.addEventListener("keydown",event=>{
    if(event.key==="Enter"&&!event.shiftKey){
      event.preventDefault();const start=input.selectionStart,end=input.selectionEnd;
      const current=input.value;
      detached=true;
      this.blocks.splice(index,1,current.slice(0,start),current.slice(end));
      this.showBlocks(index+1);
    }else if(event.key==="Backspace"&&input.selectionStart===0&&input.selectionEnd===0&&index>0){
      event.preventDefault();const prev=this.blocks[index-1];
      detached=true;
      this.blocks.splice(index-1,2,prev+input.value);
      this.showBlocks(index-1,prev.length);
    }
  });
  input.addEventListener("blur",()=>{
    if(detached)return;
    this.blocks[index]=input.value;
    this.previewBlock(preview,input.value);
    if(input.value.trim()){input.classList.add("hidden");preview.classList.remove("hidden");wrapper.classList.remove("editing");}
  });
 }
 async save(){
  const data={title:this.titleInput.value,scheduled:this.startInput.value,due:this.endInput.value};
  validateTask(data);
  const markdown=this.sourceText();
  await this.plugin.saveTaskDetail(this.task,{...data,markdown});
  this.originalNote=markdown;
 }
 async saveAndClose(){
  this.errorEl.textContent="";
  try{await this.save();this.close();new Notice("할 일 내용을 저장했습니다.");}
  catch(error){this.errorEl.textContent=error.message||String(error);throw error;}
 }
 onClose(){this.renderer?.unload();this.contentEl.empty();}
}

class DeleteModal extends Modal {
 constructor(app,message,action){super(app);this.message=message;this.action=action;}
 onOpen(){const root=this.contentEl;root.empty();root.addClass("qb-modal");el(root,"h2","qb-modal-title","삭제 확인");el(root,"p","qb-modal-hint",this.message);const row=el(root,"div","qb-modal-actions");btn(row,"취소","qb-btn qb-outline",()=>this.close());btn(row,"삭제 실행","qb-btn qb-danger",async()=>{await this.action();this.close();});}
 onClose(){this.contentEl.empty();}
}
class QuestBoardPlugin extends Plugin {
 async onload(){
  this.paths=resolvePaths();
  const {ROOT,INBOX,DASHBOARD}=this.paths;
  this.panels=new Set();
  this.refreshTimer=null;
  this.lastLocalDay=today();
  this.registerView(VIEW_TYPE,leaf=>new QuestPanel(leaf,this));
  this.addRibbonIcon("layout-dashboard","목표·할 일 대시보드 열기",()=>this.openView());
  this.addCommand({id:"open-quest-board",name:"목표·할 일 대시보드 열기",callback:()=>this.openView()});
  const changed=file=>{if(file&&(file.path.startsWith(`${ROOT}/`)||file.path===INBOX))this.queueRefresh();};
  for(const event of ["create","modify","delete"]){
    this.registerEvent(this.app.vault.on(event,changed));
  }
  this.registerEvent(this.app.vault.on("rename",(file,old)=>{
    if(old?.startsWith(`${ROOT}/`)||old===INBOX)this.queueRefresh();
    changed(file);
  }));
  // 기존 Dashboard.md를 열어도 노트 편집기 대신 독립 화면으로 전환합니다.
  this.registerEvent(this.app.workspace.on("file-open",file=>{
    if(file?.path!==DASHBOARD)return;
    window.setTimeout(()=>{
      const leaf=this.app.workspace.activeLeaf;
      if(leaf?.view?.file?.path===DASHBOARD)this.openView(leaf);
    },0);
  }));
  // A new local day can change all chart buckets even if no Markdown file changed.
  this.registerInterval(window.setInterval(()=>{const day=today();if(day!==this.lastLocalDay){this.lastLocalDay=day;this.queueRefresh();}},60000));
  this.registerDomEvent(window,"focus",()=>this.queueRefresh());
  this.registerDomEvent(document,"visibilitychange",()=>{if(!document.hidden)this.queueRefresh();});
  this.app.workspace.onLayoutReady(()=>{
    const leaf=this.app.workspace.activeLeaf;
    if(leaf?.view?.file?.path===DASHBOARD)this.openView(leaf);
  });
 }
 async openView(preferredLeaf=null){
  const workspace=this.app.workspace;
  let leaf=preferredLeaf;
  if(!leaf){
    leaf=workspace.getLeavesOfType(VIEW_TYPE)[0] || workspace.activeLeaf || workspace.getLeaf(false);
  }
  if(leaf.getViewState().type!==VIEW_TYPE){
    await leaf.setViewState({type:VIEW_TYPE,active:true});
  }
  await workspace.revealLeaf(leaf);
 }
 onunload(){
  if(this.refreshTimer!==null)window.clearTimeout(this.refreshTimer);
  this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  this.panels.clear();
 }
 queueRefresh(){if(this.refreshTimer!==null)window.clearTimeout(this.refreshTimer);this.refreshTimer=window.setTimeout(()=>{this.refreshTimer=null;for(const panel of [...this.panels])panel.refresh();},200);}
 async ensureFolder(path){let p="";for(const part of path.split("/")){p=p?`${p}/${part}`:part;if(!this.app.vault.getAbstractFileByPath(p))await this.app.vault.createFolder(p);}}
 async ensureInbox(){const {INBOX}=this.paths;await this.ensureFolder(INBOX.slice(0,INBOX.lastIndexOf("/")));if(!this.app.vault.getFileByPath(INBOX))await this.app.vault.create(INBOX,`# 일반 할 일\n\n## 할 일\n${START}\n${END}\n`);}
 async getData(){const {ROOT,ACTIVE,CLEARED,INBOX}=this.paths;const files=this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(`${ROOT}/`)||f.path===INBOX);const entries=await Promise.all(files.map(async f=>({file:f,content:await this.app.vault.cachedRead(f)})));const goals=[],tasks=[];for(const {file,content} of entries){const side=file.path===INBOX;if(!side){const goalFile=file.path.startsWith(`${ACTIVE}/`)||file.path.startsWith(`${CLEARED}/`)||Boolean(property(content,"status")||property(content,"horizon")||property(content,"qb_goal"));if(!goalFile)continue;goals.push({path:file.path,name:file.basename,horizon:property(content,"horizon")||"중기",status:property(content,"status")||(file.path.startsWith(`${CLEARED}/`)?DONE:OPEN),target:property(content,"target_date"),achieved:property(content,"achieved_date")});}content.split(/\r?\n/).forEach((line,index)=>{const t=parseTask(line,file.path,index);if(t)tasks.push({...t,kind:side?"side":"goal"});});}goals.sort((a,b)=>(a.status===DONE)-(b.status===DONE)||(a.target||"9999").localeCompare(b.target||"9999"));return {goals,tasks};}
 async createGoal(data){const {ACTIVE}=this.paths;const name=titleClean(data.title),safe=fileSafe(name);if(!name||!safe)throw Error("유효한 목표명을 입력하세요.");if(!dateValid(data.target))throw Error("목표일을 확인하세요.");await this.ensureFolder(ACTIVE);const path=`${ACTIVE}/${safe}.md`;if(this.app.vault.getAbstractFileByPath(path))throw Error("같은 이름의 목표가 있습니다.");await this.app.vault.create(path,`---\nqb_goal: true\nhorizon: ${data.horizon==="장기"?"장기":"중기"}\nstatus: 미달성\ntarget_date: ${data.target||""}\n---\n\n# ${name}\n\n## 하위 작업\n${START}\n${END}\n\n## 메모\n\n`);this.queueRefresh();new Notice("새 목표가 추가되었습니다.");}
 async editGoal(goal,data){const {ACTIVE,CLEARED}=this.paths;const f=this.app.vault.getFileByPath(goal.path);if(!f)throw Error("목표 노트가 없습니다.");const name=titleClean(data.title),safe=fileSafe(name);if(!name||!safe)throw Error("목표명을 확인하세요.");if(!dateValid(data.target))throw Error("목표일이 잘못되었습니다.");const status=data.status===DONE?DONE:OPEN,folder=status===DONE?CLEARED:ACTIVE,path=`${folder}/${safe}.md`;if(path!==goal.path&&this.app.vault.getAbstractFileByPath(path))throw Error("같은 이름의 목표가 이미 있습니다.");await this.ensureFolder(folder);const achieved=status===DONE?(goal.status===DONE&&goal.achieved?goal.achieved:today()):"";await this.app.fileManager.processFrontMatter(f,fm=>{fm.qb_goal=true;fm.horizon=data.horizon==="장기"?"장기":"중기";fm.status=status;fm.target_date=data.target||"";if(achieved)fm.achieved_date=achieved;else delete fm.achieved_date;});if(name!==goal.name){await this.app.vault.process(f,text=>text.replace(new RegExp(`(^|\\n)# ${goal.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?=\\n|$)`),`$1# ${name}`));}if(path!==goal.path)await this.app.fileManager.renameFile(f,path);this.queueRefresh();new Notice("목표를 저장했습니다.");}
 async removeGoal(goal){const f=this.app.vault.getFileByPath(goal.path);if(!f)throw Error("목표 노트가 없습니다.");await this.app.vault.trash(f,false);this.queueRefresh();new Notice("목표를 Obsidian 휴지통으로 이동했습니다.");}
 async addTask(data){const {INBOX}=this.paths;validateTask(data);const path=data.destination||INBOX;if(path===INBOX)await this.ensureInbox();else{const goals=(await this.getData()).goals;if(!goals.some(g=>g.path===path&&g.status===OPEN))throw Error("미달성 목표를 선택하세요.");}const f=this.app.vault.getFileByPath(path);if(!f)throw Error("저장할 노트가 없습니다.");const line=formatTask({title:data.title,scheduled:data.scheduled,due:data.due,completed:!!data.completed,doneDate:data.doneDate||"",id:data.id||uid()});await this.app.vault.process(f,text=>text.includes(END)?text.replace(END,`${line}\n${END}`):`${text.trimEnd()}\n\n## 할 일\n${START}\n${line}\n${END}\n`);this.queueRefresh();new Notice("할 일이 추가되었습니다.");}
 async changeTask(task,data){validateTask(data);const f=this.app.vault.getFileByPath(task.path);if(!f)throw Error("원본 노트가 없습니다.");const completed=data.completed===undefined?task.completed:!!data.completed;const doneDate=completed?(task.completed?(task.doneDate||today()):today()):"";await this.app.vault.process(f,content=>{const lines=content.split(/\r?\n/),index=taskIndex(lines,task);if(index<0)throw Error("업무가 다른 곳에서 수정되었습니다. 다시 시도하세요.");const current=parseTask(lines[index],task.path,index);if(!current)throw Error("업무를 찾지 못했습니다.");lines[index]=formatTask({...current,title:data.title,scheduled:data.scheduled,due:data.due,completed,doneDate,id:current.id||uid()});return lines.join("\n");});this.queueRefresh();}
 async removeTask(task){const f=this.app.vault.getFileByPath(task.path);if(!f)throw Error("원본 노트가 없습니다.");await this.app.vault.process(f,content=>{const lines=content.split(/\r?\n/),i=taskIndex(lines,task);if(i<0)throw Error("업무가 다른 곳에서 변경되었습니다.");lines.splice(i,1);return lines.join("\n");});if(task.id){const note=this.app.vault.getFileByPath(this.notePath(task.id));if(note)await this.app.vault.trash(note,false);}this.queueRefresh();new Notice("할 일이 삭제되었습니다.");}

 notePath(taskId){if(!/^qb-[\w-]+$/.test(taskId))throw Error("할 일 식별자가 올바르지 않습니다.");return `${this.paths.TASK_NOTES}/${taskId}.md`;}
 async ensureTaskId(task){
  if(task.id)return task.id;
  const f=this.app.vault.getFileByPath(task.path);if(!f)throw Error("할 일을 찾을 수 없습니다.");
  const id=uid();
  await this.app.vault.process(f,text=>{
    const lines=text.split(/\r?\n/),index=taskIndex(lines,task);
    if(index<0)throw Error("할 일이 수정되었습니다. 화면을 새로고침하세요.");
    const current=parseTask(lines[index],task.path,index);
    if(!current)throw Error("할 일 형식을 확인하세요.");
    if(current.id){task.id=current.id;return text;}
    lines[index]=formatTask({...current,id});return lines.join("\n");
  });
  task.id=task.id||id;
  return task.id;
 }
 async loadTaskNote(task){
  const id=await this.ensureTaskId(task),path=this.notePath(id);
  const file=this.app.vault.getFileByPath(path);
  return {id,content:file?await this.app.vault.cachedRead(file):""};
 }
 async saveTaskDetail(task,data){
  validateTask(data);
  const id=await this.ensureTaskId(task);
  await this.changeTask(task,{...data,completed:task.completed});
  const markdown=String(data.markdown??"").replace(/\r\n/g,"\n");
  const path=this.notePath(id);
  await this.ensureFolder(this.paths.TASK_NOTES);
  const existing=this.app.vault.getFileByPath(path);
  if(existing)await this.app.vault.process(existing,()=>markdown);
  else await this.app.vault.create(path,markdown);
  this.queueRefresh();
 }
 taskDetailForm(task){new TaskDetailModal(this.app,this,task).open();}

 goalForm(goal=null){new EntryModal(this.app,{title:goal?"목표 수정":"새 목표",hint:"목표의 달성 여부는 할 일 완료율과 별개로 관리합니다.",fields:[{key:"title",label:"목표명",required:true,value:goal?.name||"",placeholder:"예: 제조 IT 포트폴리오 구축"},{key:"horizon",label:"목표 기간",value:goal?.horizon||"중기",options:[{value:"중기",label:"중기"},{value:"장기",label:"장기"}]},{key:"target",label:"목표일 (선택)",type:"date",value:goal?.target||""},...(goal?[{key:"status",label:"달성 상태",value:goal.status,options:[{value:OPEN,label:OPEN},{value:DONE,label:DONE}]}]:[])],submit:data=>goal?this.editGoal(goal,data):this.createGoal(data)}).open();}
 taskForm(goals,task=null,destination=""){const {INBOX}=this.paths;const choices=[{value:INBOX,label:"일반 할 일"},...goals.filter(g=>g.status===OPEN).map(g=>({value:g.path,label:`목표 · ${g.name}`}))];new EntryModal(this.app,{title:task?"할 일 수정":"새 할 일",fields:[{key:"title",label:"할 일 제목",required:true,value:task?.title||"",placeholder:"예: 작업 자료 정리하기"},...(!task?[{key:"destination",label:"소속",value:destination||INBOX,options:choices}]:[]),{key:"scheduled",label:"진행할 날짜 (선택)",type:"date",value:task?.scheduled||""},{key:"due",label:"마감일 (선택)",type:"date",value:task?.due||""}],submit:data=>task?this.changeTask(task,{...data,completed:task.completed}):this.addTask(data)}).open();}
}
class QuestPanel extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.days = 30;
    this.activeTab = "goals";
    this.goalFilter = OPEN;
    this.taskFilter = "today";
    this.search = "";
    this.selectedDay = null;
    this.expandedGoals = new Set();
    this.showAllTasksForGoals = new Set();
    this.revision = 0;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "목표와 할 일"; }
  getIcon() { return "layout-dashboard"; }
  async onOpen() { this.plugin.panels.add(this); await this.refresh(); }
  async onClose() { this.plugin.panels.delete(this); this.contentEl.empty(); }

  async refresh() {
    const revision = ++this.revision;
    try {
      const data = await this.plugin.getData();
      if (revision === this.revision) this.draw(data);
    } catch (error) {
      console.error(error);
      this.contentEl.textContent = `대시보드 오류: ${error.message || error}`;
    }
  }

  tabGroup(parent, items, selected, onSelect, className = "qb-tabs") {
    const tabs = el(parent, "div", className);
    tabs.setAttribute("role", "group");
    for (const [value, label] of items) {
      const tab = btn(tabs, label, selected === value ? "qb-tab active" : "qb-tab", () => onSelect(value));
      tab.setAttribute("aria-pressed", String(selected === value));
    }
    return tabs;
  }

  checkbox(task, parent, className = "qb-check") {
    const check = el(parent, "input", className);
    check.type = "checkbox";
    check.checked = task.completed;
    check.setAttribute("aria-label", `${task.title} 완료 여부`);
    check.addEventListener("change", async () => {
      check.disabled = true;
      try {
        await this.plugin.changeTask(task, {
          title: task.title,
          due: task.due,
          scheduled: task.scheduled,
          completed: check.checked
        });
      } catch (error) {
        check.checked = !check.checked;
        new Notice(error.message || String(error));
      } finally {
        check.disabled = false;
      }
    });
    return check;
  }

  draw(data) {
    const host = this.contentEl;
    const previousScroll = host.scrollTop;
    host.empty();
    host.addClass("quest-board");
    const shell = el(host, "main", "qb-shell");
    const { goals, tasks } = data;
    const byGoal = new Map(goals.map(goal => [goal.path, goal]));
    const pendingTasks = tasks.filter(task => !task.completed && (
      task.kind === "side" || byGoal.get(task.path)?.status === OPEN
    ));
    const completed = tasks.filter(task => task.completed && task.doneDate && dateValid(task.doneDate));
    const todayCount = completed.filter(task => task.doneDate === today()).length;

    // 상단: 제목과 작은 숫자만 남긴다. 커다란 통계 카드는 사용하지 않는다.
    const header = el(shell, "header", "qb-header");
    const titleGroup = el(header, "div", "qb-header-main");
    el(titleGroup, "h1", "qb-title", "목표와 할 일");
    el(titleGroup, "p", "qb-subtitle", "목표를 정하고 오늘의 할 일에 집중하세요.");
    const counts = el(header, "div", "qb-header-counts");
    counts.setAttribute("aria-label", `오늘 완료 ${todayCount}개, 남은 할 일 ${pendingTasks.length}개`);
    el(counts, "span", "qb-counts-label", "오늘 완료 / 남은 할 일");
    el(counts, "strong", "qb-counts-number", `(${todayCount} / ${pendingTasks.length})`);

    // 화면 상단의 짧은 완료 기록 그래프.
    const chart = el(shell, "section", "qb-chart");
    chart.setAttribute("aria-label", "날짜별 완료한 할 일 수");
    this.history(chart, completed);

    // 큰 탭: 두 영역은 동시에 길게 렌더링하지 않는다.
    const mainTabs = el(shell, "div", "qb-main-tabs");
    mainTabs.setAttribute("role", "tablist");
    for (const [value, name] of [["goals", "중·장기 목표"], ["tasks", "오늘 할 일"]]) {
      const tab = btn(mainTabs, name, this.activeTab === value ? "qb-main-tab active" : "qb-main-tab", () => {
        this.activeTab = value;
        this.draw(data);
        this.contentEl.querySelector?.(`#qb-main-tab-${value}`)?.focus?.();
      });
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(this.activeTab === value));
      tab.setAttribute("tabindex", this.activeTab === value ? "0" : "-1");
      tab.id = `qb-main-tab-${value}`;
      tab.addEventListener("keydown", event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const next = this.activeTab === "goals" ? "tasks" : "goals";
        this.activeTab = next;
        this.draw(data);
        // 재렌더 후에는 새로 선택된 탭으로 포커스를 옮긴다.
        this.contentEl.querySelector?.(`#qb-main-tab-${next}`)?.focus?.();
      });
    }
    const panel = el(shell, "section", "qb-main-panel");
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", `qb-main-tab-${this.activeTab}`);
    if (this.activeTab === "goals") this.drawGoals(panel, data);
    else this.drawTasks(panel, data);

    el(shell, "p", "qb-footnote", "완료 기록은 내 옵시디언 파일에 저장됩니다.");
    host.scrollTop = previousScroll;
  }

  drawGoals(panel, data) {
    const toolbar = el(panel, "div", "qb-content-toolbar");
    this.tabGroup(toolbar,
      [[OPEN, "미달성"], [DONE, "달성"], ["전체", "전체"]],
      this.goalFilter,
      value => { this.goalFilter = value; this.draw(data); },
      "qb-tabs qb-secondary-tabs"
    );
    btn(toolbar, "+ 새 목표", "qb-btn qb-primary qb-toolbar-add", () => this.plugin.goalForm());

    const rows = el(panel, "div", "qb-goal-list");
    rows.setAttribute("aria-label", "목표 목록");
    const shown = data.goals.filter(goal => this.goalFilter === "전체" || goal.status === this.goalFilter);
    if (!shown.length) {
      const empty = el(rows, "div", "qb-empty");
      el(empty, "strong", "qb-empty-title", this.goalFilter === OPEN ? "진행 중인 목표가 없습니다." : "표시할 목표가 없습니다.");
      el(empty, "p", "qb-empty-description", "목표를 추가하거나 다른 상태를 선택해 보세요.");
      btn(empty, "목표 추가", "qb-btn qb-outline", () => this.plugin.goalForm());
    }
    for (const goal of shown) {
      const own = data.tasks.filter(task => task.path === goal.path);
      const pending = own.filter(task => !task.completed);
      const opened = this.expandedGoals.has(goal.path);
      const row = el(rows, "article", opened ? "qb-goal-row expanded" : "qb-goal-row");
      row.dataset.status = goal.status;
      const summary = btn(row, "", "qb-goal-summary", () => {
        if (opened) this.expandedGoals.delete(goal.path);
        else this.expandedGoals.add(goal.path);
        this.draw(data);
      });
      summary.setAttribute("aria-expanded", String(opened));
      summary.setAttribute("aria-label", `${goal.name} 목표 ${opened ? "접기" : "펼치기"}`);
      const description = el(summary, "div", "qb-goal-description");
      el(description, "strong", "qb-goal-title", goal.name);
      const meta = el(description, "div", "qb-goal-meta");
      el(meta, "span", "", `${goal.horizon === "장기" ? "장기" : "중기"} 목표`);
      if (goal.target) el(meta, "span", "", `목표일 ${goal.target}`);
      const right = el(summary, "div", "qb-goal-summary-right");
      el(right, "span", goal.status === DONE ? "qb-status cleared" : "qb-status pending", goal.status);
      el(right, "span", "qb-goal-task-count", goal.status === DONE ? "완료된 목표" : `남은 작업 ${pending.length}개`);
      el(right, "span", "qb-chevron", "");

      if (!opened) continue;
      const details = el(row, "div", "qb-goal-details");
      const detailHeader = el(details, "div", "qb-detail-header");
      el(detailHeader, "strong", "qb-detail-title", `하위 할 일 · ${own.length}개`);
      const detailActions = el(detailHeader, "div", "qb-detail-actions");
      if (goal.status === OPEN) btn(detailActions, "+ 하위 할 일", "qb-btn qb-secondary", () => this.plugin.taskForm(data.goals, null, goal.path));
      btn(detailActions, "수정", "qb-btn qb-quiet", () => this.plugin.goalForm(goal));
      btn(detailActions, goal.status === DONE ? "미달성 전환" : "달성 처리", "qb-btn qb-quiet", () =>
        this.plugin.editGoal(goal, {
          title: goal.name, horizon: goal.horizon, target: goal.target,
          status: goal.status === DONE ? OPEN : DONE
        })
      );
      btn(detailActions, "삭제", "qb-btn qb-quiet qb-text-danger", () =>
        new DeleteModal(this.plugin.app,
          `‘${goal.name}’ 목표와 해당 노트의 하위 할 일을 모두 휴지통으로 이동합니다.`,
          () => this.plugin.removeGoal(goal)
        ).open()
      );
      const taskList = el(details, "div", "qb-goal-task-list");
      const sortedTasks = [...own].sort((a, b) => Number(a.completed) - Number(b.completed));
      const visibleTasks = this.showAllTasksForGoals.has(goal.path) ? sortedTasks : sortedTasks.slice(0, 6);
      if (!own.length) el(taskList, "p", "qb-empty-inline", "하위 할 일이 없습니다. 위 버튼에서 추가할 수 있습니다.");
      for (const task of visibleTasks) this.drawTaskRow(taskList, task, data, true);
      if (own.length > visibleTasks.length) {
        btn(details, `나머지 ${own.length - visibleTasks.length}개 더 보기`, "qb-btn qb-more", () => {
          this.showAllTasksForGoals.add(goal.path);
          this.draw(data);
        });
      }
    }
  }

  drawTasks(panel, data) {
    const toolbar = el(panel, "div", "qb-content-toolbar qb-tasks-heading");
    const activeGoals = data.goals.filter(goal => goal.status === OPEN);
    const creation = el(toolbar, "div", "qb-create-group");
    const addSubtask = btn(creation, "+ 목표 하위 할 일", "qb-btn qb-outline", () => {
      this.plugin.taskForm(data.goals, null, activeGoals[0]?.path || "");
    });
    if (!activeGoals.length) {
      addSubtask.disabled = true;
      addSubtask.title = "먼저 목표를 추가하세요.";
    }
    btn(creation, "+ 일반 할 일", "qb-btn qb-primary", () =>
      this.plugin.taskForm(data.goals, null, this.plugin.paths.INBOX)
    );

    const list = el(panel, "section", "qb-task-list");
    const controls = el(list, "div", "qb-task-toolbar");
    this.tabGroup(controls,
      [["today", "오늘"], ["all", "전체"], ["backlog", "날짜 없음"], ["done", "완료"]],
      this.taskFilter,
      value => { this.taskFilter = value; this.draw(data); },
      "qb-tabs qb-secondary-tabs"
    );
    const search = el(controls, "input", "qb-search");
    search.type = "search";
    search.placeholder = "할 일 검색";
    search.setAttribute("aria-label", "할 일 검색");
    search.value = this.search;
    const rows = el(list, "div", "qb-task-rows");
    search.addEventListener("input", () => { this.search = search.value; this.taskRows(data, rows); });
    this.taskRows(data, rows);
  }

  drawTaskRow(parent, task, data, isSubtask = false) {
    const byGoal = new Map(data.goals.map(goal => [goal.path, goal]));
    const row = el(parent, "div", isSubtask ? "qb-task-row qb-subtask-row" : "qb-task-row");
    row.setAttribute("role","button");row.setAttribute("tabindex","0");
    row.setAttribute("aria-label",`${task.title} 상세 정보 열기`);
    row.addEventListener("click",event=>{
      if(event.target.closest?.("input,button,a"))return;
      this.plugin.taskDetailForm(task);
    });
    row.addEventListener("keydown",event=>{
      if(event.target!==row || (event.key!=="Enter"&&event.key!==" "))return;
      event.preventDefault();this.plugin.taskDetailForm(task);
    });
    this.checkbox(task, row);
    const main = el(row, "div", "qb-task-info");
    el(main, "div", task.completed ? "qb-task-name struck" : "qb-task-name", task.title);
    const meta = el(main, "div", "qb-task-meta");
    if (!isSubtask) {
      const source = task.kind === "side" ? "일반 할 일" : (byGoal.get(task.path)?.name || "목표 하위 할 일");
      btn(meta, source, "qb-origin", () => this.plugin.app.workspace.openLinkText(task.path, "", false));
    }
    if (task.scheduled) el(meta, "span", "qb-muted", `예정 ${task.scheduled}`);
    if (task.due) el(meta, "span", task.due < today() && !task.completed ? "qb-late" : "qb-muted", `마감 ${task.due}`);
    if (task.completed && task.doneDate) el(meta, "span", "qb-muted", `완료 ${task.doneDate}`);
    const actions = el(row, "div", "qb-row-controls");
    btn(actions, "삭제", "qb-mini-btn qb-text-danger", () =>
      new DeleteModal(this.plugin.app, `‘${task.title}’ 할 일을 삭제합니다. 완료 기록도 함께 삭제됩니다.`,
        () => this.plugin.removeTask(task)).open()
    );
  }

  taskRows(data, host) {
    host.empty();
    const byGoal = new Map(data.goals.map(goal => [goal.path, goal]));
    const now = today();
    let list = data.tasks.filter(task => this.taskFilter === "done"
      ? task.completed
      : !task.completed && (task.kind === "side" || byGoal.get(task.path)?.status === OPEN)
    );
    list = list.filter(task => {
      if (this.taskFilter === "done" || this.taskFilter === "all") return true;
      if (this.taskFilter === "today") return (task.scheduled && task.scheduled <= now) || (task.due && task.due <= now);
      if (this.taskFilter === "backlog") return !task.scheduled && !task.due;
      return true;
    });
    const query = this.search.trim().toLowerCase();
    if (query) list = list.filter(task =>
      (task.title + " " + (byGoal.get(task.path)?.name || "일반 할 일")).toLowerCase().includes(query)
    );
    list.sort((a, b) => (a.due || a.scheduled || "9999").localeCompare(b.due || b.scheduled || "9999") || a.title.localeCompare(b.title));
    const summary = el(host, "div", "qb-list-summary");
    el(summary, "span", "", `${list.length}개 할 일`);
    if (!list.length) {
      const empty = el(host, "div", "qb-empty qb-task-empty");
      const message = this.search ? "검색 결과가 없습니다." :
        this.taskFilter === "today" ? "오늘 지정된 할 일이 없습니다." :
        this.taskFilter === "done" ? "완료한 할 일이 없습니다." :
        this.taskFilter === "backlog" ? "날짜가 없는 할 일이 없습니다." :
        "등록된 할 일이 없습니다.";
      el(empty, "strong", "qb-empty-title", message);
      el(empty, "p", "qb-empty-description", this.taskFilter === "today" ?
        "날짜를 지정하지 않은 할 일은 '전체'에서 확인할 수 있습니다." :
        "이곳에서 할 일을 추가하거나 상태를 변경할 수 있습니다.");
      if (this.taskFilter === "today") btn(empty, "전체 할 일 보기", "qb-btn qb-outline", () => {
        this.taskFilter = "all";
        this.draw(data);
      });
      return;
    }
    for (const task of list.slice(0, 80)) this.drawTaskRow(host, task, data);
    if (list.length > 80) el(host, "p", "qb-muted", "최대 80개까지 표시됩니다. 검색으로 범위를 좁혀주세요.");
  }

  history(host, doneTasks) {
    host.empty();
    // Compute the local reference date once per chart render. Never use UTC ISO strings.
    const reference=new Date();reference.setHours(12,0,0,0);
    const dates=Array.from({length:this.days},(_,i)=>{const day=new Date(reference);day.setDate(day.getDate()+i-this.days+1);return today(day);});
    const counts = new Map();
    for (const task of doneTasks) counts.set(task.doneDate, (counts.get(task.doneDate) || 0) + 1);
    const values = dates.map(date => counts.get(date) || 0);
    const total = values.reduce((sum, value) => sum + value, 0);
    const max = Math.max(1, ...values);

    const header = el(host, "div", "qb-chart-header");
    const info = el(header, "div", "qb-chart-title-group");
    el(info, "h2", "qb-chart-title", "일별 완료 기록");
    el(info, "span", "qb-chart-subtitle", `최근 ${this.days}일 동안 ${total}개 완료`);
    const range = el(header, "div", "qb-chart-ranges");
    this.tabGroup(range, [[7, "7일"], [30, "30일"], [90, "90일"]], this.days, value => {
      this.days = value;
      // 선택된 날이 범위 밖에 있으면 상세 내용을 접는다.
      const days = Array.from({length: value}, (_, i) => relativeDay(i - value + 1));
      if (!days.includes(this.selectedDay)) this.selectedDay = null;
      this.history(host, doneTasks);
    }, "qb-tabs qb-chart-tabs");

    if(!total){el(host,"p","qb-chart-empty","완료한 할 일이 쌓이면 여기에 기록됩니다.");}
    else {
      const peak = Math.max(...values);
      const insight=el(host,"div","qb-chart-insight");
      el(insight,"span","qb-chart-achievement",`이번 기간 ${total}개 완료`);
      el(insight,"span","qb-chart-peak",`최고 기록 하루 ${peak}개`);
    }
    const scroll = el(host, "div", "qb-chart-scroll");
    const plot = el(scroll, "div", "qb-plot");
    plot.style.setProperty("--qb-days", this.days);
    plot.setAttribute("role", "group");
    plot.setAttribute("aria-label", "날짜별 완료 개수 막대그래프");
    dates.forEach((date, i) => {
      const count = values[i];
      const column = el(plot, "button", this.selectedDay === date ? "qb-column selected" : "qb-column");
      column.type = "button";
      column.title = `${date} · ${count}개 완료`;
      column.setAttribute("aria-label", column.title);
    const zone = el(column, "span", "qb-bar-zone");
      const bar = el(zone, "span", "qb-bar");
      // Pixel height is intentional: percentage heights inside nested flex boxes
      // were sometimes measured against an indefinite height and collapsed to 0.
      const barPixels = count ? Math.max(14, Math.round(count / max * 116)) : 3;
      bar.style.height = `${barPixels}px`;
      zone.style.setProperty("--qb-bar-height",`${barPixels}px`);
      if (count) {
        bar.dataset.filled = "true";
        el(zone,"span","qb-bar-value",String(count));
      }
      if(date===today())column.dataset.today="true";
      if(count===max && count>0)column.dataset.peak="true";
      el(column, "span", "qb-chart-tick", this.days === 7 || i % (this.days === 30 ? 5 : 15) === 0 || i === this.days - 1 ? date.slice(5) : "");
      column.addEventListener("click", () => {
        this.selectedDay = this.selectedDay === date ? null : date;
        this.history(host, doneTasks);
      });
    });
    // Keep the most recent dates visible when the 90-day chart overflows horizontally.
    if(this.days>=90)scroll.scrollLeft=scroll.scrollWidth;
    if (this.selectedDay) {
      const detail = el(host, "div", "qb-chart-detail");
      const selected = doneTasks.filter(task => task.doneDate === this.selectedDay);
      el(detail, "strong", "qb-chart-detail-head", `${this.selectedDay} · ${selected.length}개 완료`);
      if (!selected.length) el(detail, "span", "qb-muted", "완료 기록이 없습니다.");
      else for (const task of selected.slice(0, 30)) {
        btn(detail, task.title, "qb-history-link", () => this.plugin.taskDetailForm(task));
      }
    }
  }
}
module.exports = QuestBoardPlugin;