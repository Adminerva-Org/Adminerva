/** Named Adminerva Code Studio projects, templates and local persistence. */
export const CODE_PROJECT_SCHEMA_VERSION = 1;
const PROJECT_PREFIX = "Adminerva_Code_Projects_v1_";
const ACTIVE_PREFIX = "Adminerva_Code_Active_Project_v1_";

const nowIso=()=>new Date().toISOString();
const clone=value=>JSON.parse(JSON.stringify(value));
const safeId=()=>globalThis.crypto?.randomUUID?.()||("p_"+Date.now().toString(36)+"_"+Math.random().toString(36).slice(2,10));

const consoleMain='public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Adminerva!");\n    }\n}';
const swingMain='import javax.swing.*;\nimport java.awt.*;\n\npublic class Main {\n    public static void main(String[] args) {\n        SwingUtilities.invokeLater(() -> {\n            JFrame frame = new JFrame("Adminerva Desktop App");\n            frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);\n            frame.setSize(520, 320);\n            frame.setLocationRelativeTo(null);\n\n            JPanel panel = new JPanel(new BorderLayout(12, 12));\n            panel.setBorder(BorderFactory.createEmptyBorder(24, 24, 24, 24));\n            panel.add(new JLabel("Your Java Swing project is ready.", SwingConstants.CENTER), BorderLayout.CENTER);\n            JButton button = new JButton("Test interaction");\n            button.addActionListener(e -> JOptionPane.showMessageDialog(frame, "Swing is running inside Adminerva."));\n            panel.add(button, BorderLayout.SOUTH);\n            frame.add(panel);\n            frame.setVisible(true);\n        });\n    }\n}';

const informationFiles={
  "src/app/Main.java":'package app;\n\nimport ui.MainFrame;\nimport javax.swing.SwingUtilities;\n\npublic class Main {\n    public static void main(String[] args) {\n        SwingUtilities.invokeLater(() -> new MainFrame().setVisible(true));\n    }\n}',
  "src/model/Record.java":'package model;\n\npublic class Record {\n    private int id;\n    private String name;\n    private String status;\n\n    public Record(int id, String name, String status) {\n        this.id = id;\n        this.name = name;\n        this.status = status;\n    }\n\n    public int getId() { return id; }\n    public String getName() { return name; }\n    public String getStatus() { return status; }\n}',
  "src/service/RecordService.java":'package service;\n\nimport java.util.ArrayList;\nimport java.util.Collections;\nimport java.util.List;\nimport model.Record;\n\npublic class RecordService {\n    private final List<Record> records = new ArrayList<>();\n\n    public void add(Record record) { records.add(record); }\n    public List<Record> all() { return Collections.unmodifiableList(records); }\n}',
  "src/ui/MainFrame.java":'package ui;\n\nimport javax.swing.*;\nimport java.awt.*;\n\npublic class MainFrame extends JFrame {\n    public MainFrame() {\n        super("Adminerva Information System");\n        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);\n        setSize(760, 480);\n        setLocationRelativeTo(null);\n\n        JLabel heading = new JLabel("Information System Starter", SwingConstants.CENTER);\n        heading.setFont(heading.getFont().deriveFont(Font.BOLD, 20f));\n        JTable table = new JTable(new Object[][]{}, new Object[]{"ID", "Name", "Status"});\n        JButton add = new JButton("Add Record");\n        add.addActionListener(e -> JOptionPane.showMessageDialog(this, "Connect this action to your project logic or Adminerva DB lab."));\n\n        JPanel actions = new JPanel(new FlowLayout(FlowLayout.RIGHT));\n        actions.add(add);\n        add(heading, BorderLayout.NORTH);\n        add(new JScrollPane(table), BorderLayout.CENTER);\n        add(actions, BorderLayout.SOUTH);\n    }\n}'
};

const diagrams={
  useCase:"flowchart LR\n  User([User]) --> Login[Log in]\n  User --> Manage[Manage records]\n  User --> Report[View report]",
  classDiagram:"classDiagram\n  class Record {\n    -int id\n    -String name\n    -String status\n    +getId() int\n    +getName() String\n  }\n  class RecordService {\n    +add(Record)\n    +all() List~Record~\n  }\n  RecordService --> Record",
  sequence:"sequenceDiagram\n  actor User\n  participant UI\n  participant Service\n  participant DB as Adminerva DB\n  User->>UI: Submit record\n  UI->>Service: validate()\n  Service->>DB: INSERT\n  DB-->>Service: success\n  Service-->>UI: updated data",
  architecture:"flowchart LR\n  UI[Presentation / Swing] --> S[Service Layer]\n  S --> D[Data Access]\n  D --> DB[(Adminerva DB)]"
};

export const CODE_PROJECT_TEMPLATES = {
  "java-console":{
    id:"java-console",title:"Java Console",icon:">_",description:"Java fundamentals, algorithms and object-oriented programming.",lang:"java",
    config:{javaVersion:"17",runMode:"console",database:false,persistentFiles:true},
    workspace:{files:{"Main.java":consoleMain},fileOrder:["Main.java"],activeFilename:"Main.java",folders:[],projectOrder:["Main.java"]}
  },
  "java-desktop":{
    id:"java-desktop",title:"Java Desktop",icon:"▣",description:"Build graphical applications with Swing and AWT.",lang:"java",
    config:{javaVersion:"17",runMode:"desktop",database:false,persistentFiles:true},
    workspace:{files:{"Main.java":swingMain},fileOrder:["Main.java"],activeFilename:"Main.java",folders:[],projectOrder:["Main.java"]}
  },
  "java-information":{
    id:"java-information",title:"Java Information System",icon:"▦",description:"Swing application structure with a project-scoped Adminerva DB lab.",lang:"java",
    config:{javaVersion:"17",runMode:"desktop",database:true,persistentFiles:true},
    workspace:{files:informationFiles,fileOrder:Object.keys(informationFiles),activeFilename:"src/app/Main.java",
      folders:["src","src/app","src/model","src/service","src/ui","data","design"],
      projectOrder:["src","src/app","src/app/Main.java","src/model","src/model/Record.java","src/service","src/service/RecordService.java","src/ui","src/ui/MainFrame.java","data","design"]},
    database:{tables:{records:{columns:[{name:"id",type:"INTEGER",primaryKey:true},{name:"name",type:"TEXT"},{name:"status",type:"TEXT"}],rows:[]}},history:[]},
    design:diagrams
  },
  "java-blank":{
    id:"java-blank",title:"Blank Java Project",icon:"☕",description:"Start with a minimal Java project and configure capabilities yourself.",lang:"java",
    config:{javaVersion:"17",runMode:"console",database:false,persistentFiles:true},
    workspace:{files:{"Main.java":consoleMain},fileOrder:["Main.java"],activeFilename:"Main.java",folders:[],projectOrder:["Main.java"]}
  },
  "python-console":{
    id:"python-console",title:"Python Console",icon:"Py",description:"Python scripts and console exercises.",lang:"python",
    config:{runMode:"console",database:false,persistentFiles:true},
    workspace:{files:{"main.py":'print("Hello, Adminerva!")'},fileOrder:["main.py"],activeFilename:"main.py",folders:[],projectOrder:["main.py"]}
  },
  "web":{
    id:"web",title:"Web Application",icon:"</>",description:"HTML, CSS and JavaScript with live preview.",lang:"web",
    config:{runMode:"web",database:false,persistentFiles:true},
    workspace:{files:{"index.html":'<!doctype html>\n<html><head><meta charset="utf-8"><title>Adminerva Web Project</title></head><body><h1>Hello, Adminerva!</h1></body></html'},fileOrder:["index.html"],activeFilename:"index.html",folders:[],projectOrder:["index.html"]}
  }
};

export function projectStoreKey(uid){return PROJECT_PREFIX+uid;}
export function activeProjectKey(uid){return ACTIVE_PREFIX+uid;}

export function normalizeProject(project){
  if(!project||typeof project!=="object")return null;
  const template=CODE_PROJECT_TEMPLATES[project.template]||CODE_PROJECT_TEMPLATES["java-blank"];
  if(typeof project.id!=="string"||!project.id||typeof project.title!=="string"||!project.title.trim())return null;
  const state=project.state||template.workspace;
  if(!state?.files||!Array.isArray(state.fileOrder)||!state.fileOrder.length)return null;
  return {
    schemaVersion:CODE_PROJECT_SCHEMA_VERSION,
    id:project.id,ownerUid:String(project.ownerUid||""),title:project.title.trim().slice(0,120),
    template:template.id,lang:project.lang||template.lang,status:project.status==="archived"?"archived":"active",
    config:{...template.config,...(project.config||{})},
    state:clone(state),
    database:clone(project.database||template.database||{tables:{},history:[]}),
    design:clone(project.design||template.design||{}),
    evidence:clone(project.evidence||{events:[],runs:[]}),
    createdAt:project.createdAt||nowIso(),updatedAt:project.updatedAt||nowIso(),lastOpenedAt:project.lastOpenedAt||project.updatedAt||nowIso()
  };
}

export function readCodeProjects(storage,uid){
  try{
    const parsed=JSON.parse(storage.getItem(projectStoreKey(uid))||"[]");
    if(!Array.isArray(parsed))return [];
    return parsed.map(normalizeProject).filter(Boolean).sort((a,b)=>String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)));
  }catch{return [];}
}

export function writeCodeProjects(storage,uid,projects){
  const normalized=projects.map(normalizeProject).filter(Boolean);
  storage.setItem(projectStoreKey(uid),JSON.stringify(normalized));
  return normalized;
}

export function createCodeProject(storage,uid,{title,templateId,config={}}){
  const template=CODE_PROJECT_TEMPLATES[templateId]||CODE_PROJECT_TEMPLATES["java-blank"];
  const time=nowIso();
  const project=normalizeProject({
    id:safeId(),ownerUid:uid,title:String(title||"Untitled Project").trim()||"Untitled Project",
    template:template.id,lang:template.lang,config:{...template.config,...config},state:clone(template.workspace),
    database:clone(template.database||{tables:{},history:[]}),design:clone(template.design||{}),
    evidence:{events:[],runs:[]},createdAt:time,updatedAt:time,lastOpenedAt:time,status:"active"
  });
  const projects=readCodeProjects(storage,uid);
  writeCodeProjects(storage,uid,[project,...projects]);
  storage.setItem(activeProjectKey(uid),project.id);
  return project;
}

export function saveCodeProject(storage,uid,project){
  const next=normalizeProject({...project,ownerUid:uid,updatedAt:nowIso()});
  if(!next)throw Error("Invalid project.");
  const projects=readCodeProjects(storage,uid);
  const index=projects.findIndex(item=>item.id===next.id);
  if(index>=0)projects[index]=next;else projects.unshift(next);
  writeCodeProjects(storage,uid,projects);
  storage.setItem(activeProjectKey(uid),next.id);
  return next;
}

export function deleteCodeProject(storage,uid,projectId){
  const projects=readCodeProjects(storage,uid).filter(item=>item.id!==projectId);
  writeCodeProjects(storage,uid,projects);
  if(storage.getItem(activeProjectKey(uid))===projectId)storage.removeItem(activeProjectKey(uid));
  return projects;
}

export function findCodeProject(storage,uid,projectId){
  return readCodeProjects(storage,uid).find(project=>project.id===projectId)||null;
}

export function projectTemplateLabel(project){
  return (CODE_PROJECT_TEMPLATES[project?.template]||{}).title||"Code Project";
}
