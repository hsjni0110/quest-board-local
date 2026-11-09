/* Quest Board 2.6 API-level smoke test; run with node tests/smoke-test.cjs */
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

class FakeElement {
  constructor(tag='div') {
    this.tagName=tag;
    this.children=[];
    this.events={};
    this.className='';
    this.dataset={};
    this.attributes={};
    this.scrollTop=0;
    this.value='';
    this._text='';
    this.parentElement=null;
    this.classList={add:(cls)=>{if(!this.className.includes(cls))this.className+=(' '+cls);},remove:(cls)=>{this.className=this.className.split(/\s+/).filter(x=>x!==cls).join(' ');}};
    this.style={setProperty:(name,value)=>{this.style[name]=value;}};
  }
  appendChild(el){el.parentElement=this;this.children.push(el);return el;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  focus(){}
  setSelectionRange(){}
  empty(){this.children=[];this._text='';}
  addClass(s){this.className=(this.className+' '+s).trim();}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(k,fn){(this.events[k]??=[]).push(fn);}
  set textContent(s){this._text=String(s);this.children=[];}
  get textContent(){return this._text+this.children.map(el=>el.textContent).join('');}
}
global.document={createElement:tag=>new FakeElement(tag)};
global.window={setTimeout,clearTimeout,setInterval:()=>123,clearInterval:()=>{}};
class Plugin {registerView(k,v){this.viewFactory=v;} addRibbonIcon(){} addCommand(){} registerEvent(){} registerInterval(){} registerDomEvent(){} }
class ItemView {constructor(leaf){this.leaf=leaf;this.contentEl=new FakeElement();}}
class Modal {constructor(app){this.app=app;this.contentEl=new FakeElement();}open(){Modal.current=this;this.opened=this.onOpen?.();return this.opened;}close(){this.onClose?.();}}
class Component {load(){} unload(){}}
const MarkdownRenderer={render:async(_app,markdown,element)=>{element.textContent=markdown;}};
class Notice {constructor(){} }
const oldLoad=Module._load;
Module._load=function(request,parent,isMain){if(request==='obsidian')return {Plugin,ItemView,Modal,Notice,Component,MarkdownRenderer};return oldLoad.apply(this,arguments);};
const QuestBoardPlugin=require(path.join(__dirname,'../main.js'));
Module._load=oldLoad;

const root='Management';
const goalPath=`${root}/02_Goals/Active/운동.md`;
const inboxPath=`${root}/03_Lists/Inbox.md`;
const files=new Map([[goalPath,'---\nqb_goal: true\nhorizon: 중기\nstatus: 미달성\ntarget_date:\n---\n# 운동\n\n## 하위 작업\n<!-- QB:TASKS:START -->\n- [ ] 달리기 연습 ^qb-abc\n<!-- QB:TASKS:END -->\n'],[inboxPath,'# 일반 할 일\n\n## 할 일\n<!-- QB:TASKS:START -->\n- [ ] 방 정리 ^qb-def\n<!-- QB:TASKS:END -->\n']]);
const folders=new Set([root,`${root}/02_Goals`,`${root}/02_Goals/Active`,`${root}/03_Lists`]);
const getFile=path=>files.has(path)?{path,basename:path.split('/').at(-1).replace(/\.md$/,'')}:null;
const getAbstract=path=>getFile(path)||(folders.has(path)?{path}:null);
const vault={
 on(){return {}},
 getMarkdownFiles(){return Array.from(files.keys()).map(getFile);},
 cachedRead(file){return Promise.resolve(files.get(file.path));},
 getAbstractFileByPath:getAbstract,
 getFileByPath:getFile,
 createFolder(p){folders.add(p);return Promise.resolve({path:p});},
 create(p,c){assert(!files.has(p));files.set(p,c);return Promise.resolve(getFile(p));},
 process(file,fn){const before=files.get(file.path);files.set(file.path,fn(before));return Promise.resolve(files.get(file.path));},
 trash(file){files.delete(file.path);return Promise.resolve();}
};
const app={vault,
 workspace:{on(){return {};},onLayoutReady(){},getLeavesOfType(){return [];},getLeaf(){return {};},revealLeaf(){},activeLeaf:null},
 fileManager:{
  async processFrontMatter(file,edit){
    const content=files.get(file.path), m=content.match(/^---\n([\s\S]*?)\n---\n/);
    assert(m,'frontmatter missing');
    const fm=Object.fromEntries(m[1].split('\n').map(s=>s.split(/:\s*/).slice(0,2)));
    edit(fm);
    const front='---\n'+Object.entries(fm).map(([k,v])=>`${k}: ${v}`).join('\n')+'\n---\n';
    files.set(file.path,front+content.slice(m[0].length));
  },
  async renameFile(file,p){files.set(p,files.get(file.path));files.delete(file.path);file.path=p;}
 }};
const findByClass=(root,cls)=>{const out=[];function rec(n){if(n.className?.split(/\s+/).includes(cls))out.push(n);for(const child of n.children)rec(child);}rec(root);return out;};
(async()=>{
  const plugin=new QuestBoardPlugin();plugin.app=app;await plugin.onload();plugin.queueRefresh=()=>{};
  assert.equal(plugin.paths.ROOT,'Management/02_Goals');
  const panel=plugin.viewFactory({});
  await panel.onOpen();
  assert.equal(panel.activeTab,'goals');
  assert.equal(panel.taskFilter,'today');
  assert.equal(findByClass(panel.contentEl,'qb-stats').length,0,'no oversized stat cards');
  assert.equal(findByClass(panel.contentEl,'qb-chart').length,1,'chart near top');
  assert.equal(findByClass(panel.contentEl,'qb-column').length,30,'30 chart columns');
  assert.equal(findByClass(panel.contentEl,'qb-main-tab').length,2,'two main tabs');
  assert.equal(findByClass(panel.contentEl,'qb-goal-row').length,1,'compact goal row');
  assert.equal(findByClass(panel.contentEl,'qb-task-row').length,0,'tasks area hidden on goals tab');
  assert(panel.contentEl.textContent.includes('(0 / 2)'),'small header counts open tasks');
  assert(!panel.contentEl.textContent.includes('7일 마감'));

  // Expand the goal; details and subtask are disclosed only on request.
  const summary=findByClass(panel.contentEl,'qb-goal-summary')[0];
  await summary.events.click[0]();
  assert.equal(findByClass(panel.contentEl,'qb-goal-row')[0].className.includes('expanded'),true);
  assert.equal(findByClass(panel.contentEl,'qb-subtask-row').length,1);
  assert(panel.contentEl.textContent.includes('하위 할 일'));

  // Switching to task tab renders only the task workflow; today's list is initially empty.
  const tabs=findByClass(panel.contentEl,'qb-main-tab');
  await tabs[1].events.click[0]();
  assert.equal(panel.activeTab,'tasks');
  assert.equal(findByClass(panel.contentEl,'qb-goal-row').length,0);
  assert(panel.contentEl.textContent.includes('오늘 지정된 할 일이 없습니다'));
  assert(panel.contentEl.textContent.includes('일반 할 일'));

  // Unscheduled tasks must be findable under 전체.
  const overall=findByClass(panel.contentEl,'qb-tab').find(el=>el.textContent==='전체');
  await overall.events.click[0]();
  assert.equal(panel.taskFilter,'all');
  assert.equal(findByClass(panel.contentEl,'qb-task-row').length,2);

  const goals=await plugin.getData();
  const sub=goals.tasks.find(t=>t.title==='달리기 연습');
  await plugin.changeTask(sub,{title:sub.title,scheduled:'',due:'',completed:true});
  assert(files.get(goalPath).includes('✅ '),'complete date stored');
  await panel.refresh();
  assert(panel.contentEl.textContent.includes('(1 / 1)'),'header completion counts update');
  assert.equal(findByClass(panel.contentEl,'qb-task-row').length,1,'completed excluded from open tasks');
  assert(panel.contentEl.textContent.includes('최근 30일 동안 1개 완료'),'history graph counts completion');
  const completedBars=findByClass(panel.contentEl,'qb-bar').filter(bar=>bar.dataset.filled==='true');
  assert.equal(completedBars.length,1,'completion is rendered as a visible bar');
  assert.match(completedBars[0].style.height,/^\d+px$/,'bar uses deterministic pixel height');
  assert(Number.parseInt(completedBars[0].style.height,10)>=14,'completed bar remains visible even when values are small');
  assert.equal(findByClass(panel.contentEl,'qb-bar-value').length,1,'completed count appears on the bar');
  assert(panel.contentEl.textContent.includes('이번 기간 1개 완료'),'achievement summary is present');
  const plot=findByClass(panel.contentEl,'qb-column');
  await plot.at(-1).events.click[0]();
  assert(panel.contentEl.textContent.includes('달리기 연습'),'chart detail on click');

  // Existing data workflows remain intact.
  await plugin.addTask({title:'운동 추가',destination:goalPath,scheduled:'',due:''});
  await plugin.addTask({title:'새 일반 할 일',destination:inboxPath,scheduled:'',due:''});
  await panel.refresh();
  assert.equal(findByClass(panel.contentEl,'qb-task-row').length,3);
  await plugin.createGoal({title:'새 목표',horizon:'장기',target:''});
  assert(files.has(`${root}/02_Goals/Active/새 목표.md`));
  // Clicking anywhere on the task row (except controls) opens detail editor.
  const firstRow=findByClass(panel.contentEl,'qb-task-row')[0];
  firstRow.events.click[0]({target:{closest:()=>null}});
  await Modal.current.opened;
  assert.equal(Modal.current.titleInput.value,'방 정리');
  assert.equal(Modal.current.startInput.value,'');
  assert.equal(Modal.current.endInput.value,'');
  assert.equal(findByClass(Modal.current.contentEl,'qb-modal-title').length,0,'duplicate detail title is removed');
  assert.equal(findByClass(Modal.current.contentEl,'qb-modal-hint').length,0,'instruction paragraph is removed');
  assert.equal(findByClass(Modal.current.contentEl,'qb-detail-title-input').length,1,'editable task title is used as heading');
  assert.equal(findByClass(Modal.current.contentEl,'qb-date-control').length,2,'dates use compact text-and-calendar controls');
  assert(!Modal.current.contentEl.textContent.includes('노트에서 열기'),'no external note-open action');
  const pickers=findByClass(Modal.current.contentEl,'qb-date-native');
  pickers[0].value='2026-11-14';
  pickers[0].events.change[0]();
  assert.equal(Modal.current.startInput.value,'2026-11-14','date picker updates visible date text');
  Modal.current.startInput.value='';
  const rawModeButton=findByClass(Modal.current.contentEl,'qb-note-heading')[0].children.find(el=>el.tagName==='button');
  assert(rawModeButton,'markdown source button should be available');
  await rawModeButton.events.click[0]();
  assert.equal(findByClass(Modal.current.contentEl,'qb-note-raw').length,1,'markdown source editor stays inside modal');
  assert.equal(findByClass(Modal.current.contentEl,'qb-note-live-preview').length,1,'markdown preview stays inside modal');
  await rawModeButton.events.click[0]();
  const line=findByClass(Modal.current.contentEl,'qb-note-line')[0];
  line.value='## 서식 제목';
  line.events.input[0]();
  line.selectionStart=line.value.length;line.selectionEnd=line.value.length;
  line.events.keydown[0]({key:'Enter',shiftKey:false,preventDefault(){}});
  assert.deepEqual(Modal.current.blocks,['## 서식 제목',''], 'Enter commits Markdown-formatted line and moves to a new block');
  Modal.current.titleInput.value='방 정리 후 청소';
  Modal.current.startInput.value='2026-11-10';
  Modal.current.endInput.value='2026-11-12';
  Modal.current.blocks=['## 오늘 기록','**정리 완료**','- 다음 단계'];
  await Modal.current.save();
  const savedNotes=[...files.entries()].filter(([name])=>name.startsWith('Management/04_TaskNotes/') && name.endsWith('.md'));
  assert.equal(savedNotes.length,1,'task-specific Markdown note created');
  assert(savedNotes[0][1].includes('**정리 완료**'));
  assert(files.get(inboxPath).includes('방 정리 후 청소 ⏳ 2026-11-10 📅 2026-11-12'));
  const modified=(await plugin.getData()).tasks.find(t=>t.title==='방 정리 후 청소');
  assert(modified.id?.startsWith('qb-'),'legacy task receives stable ID');
  await plugin.changeTask(modified,{title:modified.title,scheduled:modified.scheduled,due:modified.due,completed:true});
  assert(files.get(inboxPath).includes('✅ '),'task completed on button press gets completion date');
  assert(files.has(savedNotes[0][0]),'note survives completion');

  // Yesterday's completion must remain on the chart after local midnight.
  const NativeDate=global.Date;
  global.Date=class extends NativeDate {
    constructor(...args){super(...(args.length?args:['2026-11-10T12:00:00']));}
    static now(){return new NativeDate('2026-11-10T12:00:00').getTime();}
  };
  const graphParent=new FakeElement();
  panel.days=7;
  panel.history(graphParent,[{title:'어제 완료',doneDate:'2026-11-09',completed:true}]);
  assert(graphParent.textContent.includes('최근 7일 동안 1개 완료'),'previous day remains visible after midnight');
  global.Date=NativeDate;

  const goal=(await plugin.getData()).goals.find(x=>x.name==='새 목표');
  await plugin.editGoal(goal,{title:'새 목표',horizon:'장기',target:'',status:'달성'});
  assert(files.has(`${root}/02_Goals/Cleared/새 목표.md`));
  console.log('PASS: graph rollover, row-click detail, Markdown notes, start/end dates, completion date, prior v2.4 workflows');
})().catch(e=>{console.error(e);process.exitCode=1;});
