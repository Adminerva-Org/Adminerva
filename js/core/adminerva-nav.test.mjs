import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('js/core/adminerva-nav.js', 'utf8');
class Element {
  constructor(tag='div') {
    this.tagName=tag;
    this.children=[];
    this.dataset={};
    this.className='';
    this.textContent='';
    this.attributes={};
    this.open=false;
  }
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(){/* no-op in static layout test */}
}
function mount(module='educator', page='dashboard', role='teacher') {
  const desktop=new Element(), mobile=new Element();
  const attrs={'data-module':module,'data-page':page};
  const container={
    getAttribute:key=>attrs[key],
    innerHTML:'',
    querySelector(query){
      if(query==='#av-desktop-nav')return desktop;
      if(query==='#av-mobile-nav')return mobile;
      return null;
    },
    querySelectorAll(){return []},
    addEventListener(){}
  };
  let boot;
  const document={
    createElement:tag=>new Element(tag),
    getElementById:id=>id==='adminerva-nav'?container:null,
    addEventListener:(name,fn)=>{if(name==='DOMContentLoaded')boot=fn}
  };
  const window={matchMedia:()=>({matches:false})};
  const localStorage={getItem:key=>key==='Adminerva_Role'?role:null};
  vm.runInNewContext(source,{document,window,localStorage,console,requestAnimationFrame:fn=>fn()});
  assert.equal(typeof boot,'function');
  boot();
  return {desktop,mobile,container};
}
test('teacher sees task-group menus instead of eight crowded links',()=>{
  const {desktop,mobile}=mount();
  assert.equal(desktop.children.length,3);
  assert.equal(desktop.children[0].href,'reporeviewDashboard.html');
  assert.deepEqual(desktop.children.slice(1).map(x=>x.children[0].textContent),
    ['Grading ▾','Repositories ▾']);
  assert.equal(mobile.children.length,1);
  assert.equal(mobile.children[0].children[0].textContent,'Menu · Analytics ▾');
});
test('every grouped route exists in main and admin has directory',()=>{
  const {desktop}=mount('admin','directory','superadmin');
  const links=desktop.children.flatMap(group=>group.tagName==='a'?[group]:group.children[1].children);
  for(const link of links)assert.equal(existsSync(link.href),true,'Missing route: '+link.href);
  assert.ok(links.some(link=>link.href==='users.html'));
  assert.ok(links.some(link=>link.href==='issues.html'));
  assert.ok(!links.some(link=>link.href==='gradebook.html'));
  assert.ok(!links.some(link=>link.href==='lesson-planner.html'));
});
test('only the active page is announced and its mobile section expands',()=>{
  const {desktop,mobile}=mount('educator','submissions');
  const all=desktop.children.flatMap(group=>group.tagName==='a'?[group]:group.children[1].children);
  assert.deepEqual(all.filter(x=>x.attributes['aria-current']==='page').map(x=>x.href),
    ['submissions.html']);
  const outer=mobile.children[0], panel=outer.children[1];
  assert.ok(panel.children[1].open, 'Grading section should be expanded');
  assert.match(outer.children[0].textContent,/Grading/);
});
test('ordinary teacher does not get Admin Hub directory in grouped navigation',()=>{
  const {desktop}=mount('educator','gradebook','teacher');
  const all=desktop.children.flatMap(group=>group.tagName==='a'?[group]:group.children[1].children);
  assert.ok(!all.some(x=>x.href==='users.html'));
});
test('student navigation remains separate and includes playground links',()=>{
  const {container,desktop}=mount('student','assessments','student');
  assert.equal(desktop.children.length,0);
  assert.match(container.innerHTML,/student-assessments.html/);
  assert.doesNotMatch(container.innerHTML,/Menu · Modules/);
});

test('Practice Lab has its own navigation, separate from Project Hub',()=>{
  const project=mount('student','dashboard','student').container.innerHTML;
  const projectTabs=project.match(/id="av-desktop-nav"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
  assert.match(projectTabs,/student-dashboard\.html/);
  assert.match(projectTabs,/student-assessments\.html/);
  assert.doesNotMatch(projectTabs,/student-practice\.html/);
  const practice=mount('student-practice','practice','student').container.innerHTML;
  const practiceTabs=practice.match(/id="av-desktop-nav"[^>]*>([\s\S]*?)<\/div>/)?.[1]||'';
  assert.match(practiceTabs,/student-practice\.html/);
  assert.doesNotMatch(practiceTabs,/student-assessments\.html/);
  assert.match(practice,/student-dashboard\.html/); // Project Hub is accessible from logo.
});
test('Planning appears only in Lesson Review and retains school workflow links',()=>{
  const lesson=mount('lesson','planner');
  const groups=lesson.desktop.children.slice(1).map(x=>x.children[0].textContent);
  assert.deepEqual(groups,['Planning ▾']);
  const pages=lesson.desktop.children.slice(1).flatMap(x=>x.children[1].children.map(c=>c.href));
  assert.ok(pages.includes('lesson-planner.html'));
  assert.ok(pages.includes('presentation.html'));
  assert.ok(pages.includes('schedule.html'));
  assert.ok(pages.includes('library.html'));
  assert.ok(!pages.includes('gradebook.html'));
  assert.ok(!pages.includes('users.html'));
});
test('Manage appears in the admin and settings areas, not RepoFetch',()=>{
  const settings=mount('settings','settings','teacher');
  assert.deepEqual(settings.desktop.children.slice(1).map(x=>x.children[0].textContent),['Manage ▾']);
  const repo=mount('repo','repofetch','teacher');
  assert.deepEqual(repo.desktop.children.slice(1).map(x=>x.children[0].textContent),
    ['Grading ▾','Repositories ▾']);
});
