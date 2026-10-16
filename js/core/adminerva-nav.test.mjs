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
  assert.equal(desktop.children.length,5);
  assert.equal(desktop.children[0].href,'reporeviewDashboard.html');
  assert.deepEqual(desktop.children.slice(1).map(x=>x.children[0].textContent),
    ['Grading ▾','Repositories ▾','Planning ▾','Manage ▾']);
  assert.equal(mobile.children.length,1);
  assert.equal(mobile.children[0].children[0].textContent,'Menu · Analytics ▾');
});
test('every grouped route exists in main and admin has directory',()=>{
  const {desktop}=mount('admin','directory','superadmin');
  const links=desktop.children.flatMap(group=>group.tagName==='a'?[group]:group.children[1].children);
  for(const link of links)assert.equal(existsSync(link.href),true,'Missing route: '+link.href);
  assert.ok(links.some(link=>link.href==='users.html'));
  assert.ok(links.some(link=>link.href==='gradebook.html'));
  assert.ok(links.some(link=>link.href==='submissions.html'));
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
