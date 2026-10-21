/** Regression coverage: Responsive module navigation, account controls and notifications. */
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
  assert.equal(desktop.children.length,4);
  assert.equal(desktop.children[0].href,'teacher-analytics.html');
  assert.deepEqual(desktop.children.slice(1).map(x=>x.children[0].textContent),
    ['Grading ▾','Evidence tools ▾','Repositories ▾']);
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
  assert.ok(panel.children[2].open, 'Evidence tools section should be expanded');
  assert.match(outer.children[0].textContent,/Evidence tools/);
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
  const projectTabs=container.innerHTML.match(/id="av-desktop-nav"[^>]*>(.*?)<\/div>/s)?.[1]||"";
  assert.doesNotMatch(projectTabs,/student-practice.html/);
  assert.doesNotMatch(container.innerHTML,/Menu · Modules/);
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
    ['Grading ▾','Evidence tools ▾','Repositories ▾']);
});

test('Practice Lab uses its own tabs and remains in the student module switcher',()=>{
  const practice=mount('student-practice','practice','student');
  assert.match(practice.container.innerHTML,/Practice Courses/);
  assert.match(practice.container.innerHTML,/student-practice.html/);
  assert.doesNotMatch(practice.container.innerHTML,/student-assessments.html" class=/);
  const project=mount('student','dashboard','student');
  assert.match(project.container.innerHTML,/Student Modules/);
  assert.match(project.container.innerHTML,/Practice Lab/);
  assert.doesNotMatch(project.container.innerHTML,/Practice Courses/);
});

test('signed-in home navigation is distinct from project and staff task tabs',()=>{
  const student=mount('student-home','home','student');
  const teacher=mount('staff-home','home','teacher');
  assert.match(student.container.innerHTML,/Student Home/);
  assert.match(teacher.container.innerHTML,/Staff Home/);
  const studentTabs=student.container.innerHTML.split('id="av-desktop-nav"')[1]?.split('</div>')[0]?.split('>')[1]||'';
  const staffTabs=teacher.container.innerHTML.split('id="av-desktop-nav"')[1]?.split('</div>')[0]?.split('>')[1]||'';
  assert.equal(studentTabs,'');
  assert.equal(staffTabs,'');
  assert.doesNotMatch(studentTabs,/Practice Lab|Assignments/);
  assert.ok(existsSync('student-home.html'));
  assert.ok(existsSync('teacher-home.html'));
});
test('student pages request an updated nav asset instead of a stale browser cache',()=>{
  for (const path of ['student-dashboard.html','student-assessments.html',
    'student-practice.html','student-playground.html','student-settings.html']) {
    const page=readFileSync(path,'utf8');
    const version=page.match(/adminerva-nav[.]js[?]v=(\d+(?:[.]\d+){2,3})/)?.[1];
    const installed=JSON.parse(readFileSync('site-release.json','utf8')).version;
    assert.ok(version&&(version===installed||version.localeCompare('2026.10.17.2','en',{numeric:true})>=0),
      path+' must request the current or a newer nav asset');
  }
});

test('module switcher works through native disclosure controls on touch and keyboard',()=>{
  for(const [module,role] of [['lesson','teacher'],['student','student']]){
    const {container}=mount(module,'dashboard',role);
    assert.match(container.innerHTML,/<details class="relative group py-1">/);
    assert.match(container.innerHTML,/<summary aria-label="Switch Adminerva modules"/);
    assert.match(container.innerHTML,/hidden group-open:block/);
    assert.doesNotMatch(container.innerHTML,/hidden group-hover:block/);
    assert.match(container.innerHTML,/<a href="issues.html"[^>]*>/);
  }
});
test('issues tracker has a predictable direct-link home fallback',()=>{
  const {container}=mount('global','issues','student');
  assert.match(container.innerHTML,/href="student-home.html"/);
  assert.match(container.innerHTML,/Previous Page/);
  const staff=mount('global','issues','teacher');
  assert.match(staff.container.innerHTML,/href="teacher-home.html"/);
});

test('navigation never exposes a route that is missing from repository',()=>{
  const roles=[['student','dashboard','student'],['student-playground','ide','student'],
    ['student-practice','practice','student'],['educator','dashboard','teacher'],
    ['admin','directory','superadmin'],['lesson','planner','teacher']];
  for(const [module,page,role] of roles){
    const {container}=mount(module,page,role);
    const links=[...container.innerHTML.matchAll(/href="([^"]+\.html)"/g)].map(m=>m[1]);
    for(const path of links){
      assert.ok(existsSync(path),module+' links to missing route '+path);
    }
  }
});
