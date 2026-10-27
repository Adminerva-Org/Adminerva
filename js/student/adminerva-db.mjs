/** Project-scoped Adminerva DB learning engine.
 * This models SQL CRUD in the browser. It is not presented as a JDBC driver.
 */
const clone=value=>JSON.parse(JSON.stringify(value));

function splitCsv(text){
  const values=[];let current="",quote=null,depth=0;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quote){
      current+=ch;
      if(ch===quote&&text[i-1]!=="\\")quote=null;
      continue;
    }
    if(ch==="'"||ch==='"'){quote=ch;current+=ch;continue;}
    if(ch==="(")depth++;
    if(ch===")")depth--;
    if(ch===","&&depth===0){values.push(current.trim());current="";continue;}
    current+=ch;
  }
  if(current.trim())values.push(current.trim());
  return values;
}
function valueOf(raw){
  const text=String(raw??"").trim();
  if(/^null$/i.test(text))return null;
  if(/^true$/i.test(text))return true;
  if(/^false$/i.test(text))return false;
  if(/^[-+]?\d+(\.\d+)?$/.test(text))return Number(text);
  const quoted=text.match(/^(['"])([\s\S]*)\1$/);
  return quoted?quoted[2].replace(/\\(['"])/g,"$1"):text;
}
function normalizeDb(db){
  const next=db&&typeof db==="object"?clone(db):{tables:{},history:[]};
  if(!next.tables||typeof next.tables!=="object")next.tables={};
  if(!Array.isArray(next.history))next.history=[];
  return next;
}
function tableOrThrow(db,name){
  const table=db.tables[name];
  if(!table)throw Error('Table "'+name+'" does not exist.');
  return table;
}
function parseWhere(where){
  if(!where)return ()=>true;
  const m=String(where).trim().match(/^([A-Za-z_][\w]*)\s*(=|!=|<>|>=|<=|>|<)\s*([\s\S]+)$/);
  if(!m)throw Error("Adminerva DB currently supports one simple WHERE comparison.");
  const [,column,op,raw]=m,value=valueOf(raw);
  return row=>{
    const left=row[column];
    switch(op){
      case "=":return left==value;
      case "!=":case "<>":return left!=value;
      case ">":return left>value;
      case "<":return left<value;
      case ">=":return left>=value;
      case "<=":return left<=value;
      default:return false;
    }
  };
}
function record(db,sql,type,affected=0){
  db.history.unshift({at:new Date().toISOString(),type,sql:String(sql).slice(0,2000),affected});
  db.history=db.history.slice(0,100);
}

export function executeAdminervaSql(inputDb,sqlText){
  const db=normalizeDb(inputDb),sql=String(sqlText||"").trim().replace(/;\s*$/,"");
  if(!sql)throw Error("Enter an SQL statement.");

  let m=sql.match(/^CREATE\s+TABLE\s+([A-Za-z_][\w]*)\s*\(([\s\S]+)\)$/i);
  if(m){
    const name=m[1];if(db.tables[name])throw Error('Table "'+name+'" already exists.');
    const columns=splitCsv(m[2]).map(def=>{
      const parts=def.trim().split(/\s+/),column=parts.shift();
      if(!/^[A-Za-z_][\w]*$/.test(column))throw Error("Invalid column name.");
      const type=(parts.shift()||"TEXT").toUpperCase();
      return {name:column,type,primaryKey:/PRIMARY\s+KEY/i.test(def)};
    });
    if(!columns.length)throw Error("Add at least one column.");
    db.tables[name]={columns,rows:[]};record(db,sql,"CREATE",0);
    return {db,columns:["message"],rows:[["Table "+name+" created."]],affected:0,type:"CREATE"};
  }

  m=sql.match(/^DROP\s+TABLE\s+([A-Za-z_][\w]*)$/i);
  if(m){
    tableOrThrow(db,m[1]);delete db.tables[m[1]];record(db,sql,"DROP",0);
    return {db,columns:["message"],rows:[["Table "+m[1]+" dropped."]],affected:0,type:"DROP"};
  }

  m=sql.match(/^INSERT\s+INTO\s+([A-Za-z_][\w]*)\s*\(([^)]+)\)\s*VALUES\s*\(([\s\S]+)\)$/i);
  if(m){
    const table=tableOrThrow(db,m[1]),columns=splitCsv(m[2]),values=splitCsv(m[3]).map(valueOf);
    if(columns.length!==values.length)throw Error("Column and value counts do not match.");
    const valid=new Set(table.columns.map(col=>col.name));
    for(const column of columns)if(!valid.has(column))throw Error('Unknown column "'+column+'".');
    const row=Object.fromEntries(table.columns.map(col=>[col.name,null]));
    columns.forEach((column,index)=>row[column]=values[index]);
    const primary=table.columns.find(col=>col.primaryKey);
    if(primary&&row[primary.name]!=null&&table.rows.some(item=>item[primary.name]==row[primary.name]))
      throw Error("Primary key value already exists.");
    table.rows.push(row);record(db,sql,"INSERT",1);
    return {db,columns:["message"],rows:[["1 row inserted."]],affected:1,type:"INSERT"};
  }

  m=sql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z_][\w]*)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([A-Za-z_][\w]*)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?$/i);
  if(m){
    const table=tableOrThrow(db,m[2]),predicate=parseWhere(m[3]);
    const available=table.columns.map(col=>col.name);
    const columns=m[1].trim()==="*"?available:splitCsv(m[1]).map(value=>value.trim());
    for(const column of columns)if(!available.includes(column))throw Error('Unknown column "'+column+'".');
    let rows=table.rows.filter(predicate);
    if(m[4]){
      const key=m[4],direction=(m[5]||"ASC").toUpperCase()==="DESC"?-1:1;
      if(!available.includes(key))throw Error('Unknown ORDER BY column "'+key+'".');
      rows=[...rows].sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*direction);
    }
    if(m[6])rows=rows.slice(0,Number(m[6]));
    record(db,sql,"SELECT",rows.length);
    return {db,columns,rows:rows.map(row=>columns.map(column=>row[column])),affected:rows.length,type:"SELECT"};
  }

  m=sql.match(/^UPDATE\s+([A-Za-z_][\w]*)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if(m){
    const table=tableOrThrow(db,m[1]),predicate=parseWhere(m[3]),valid=new Set(table.columns.map(col=>col.name));
    const assignments=splitCsv(m[2]).map(item=>{
      const pair=item.match(/^([A-Za-z_][\w]*)\s*=\s*([\s\S]+)$/);if(!pair)throw Error("Invalid SET assignment.");
      if(!valid.has(pair[1]))throw Error('Unknown column "'+pair[1]+'".');
      return [pair[1],valueOf(pair[2])];
    });
    let affected=0;
    table.rows.forEach(row=>{if(predicate(row)){assignments.forEach(([key,value])=>row[key]=value);affected++;}});
    record(db,sql,"UPDATE",affected);
    return {db,columns:["message"],rows:[[affected+" row(s) updated."]],affected,type:"UPDATE"};
  }

  m=sql.match(/^DELETE\s+FROM\s+([A-Za-z_][\w]*)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if(m){
    const table=tableOrThrow(db,m[1]),predicate=parseWhere(m[2]),before=table.rows.length;
    table.rows=table.rows.filter(row=>!predicate(row));
    const affected=before-table.rows.length;record(db,sql,"DELETE",affected);
    return {db,columns:["message"],rows:[[affected+" row(s) deleted."]],affected,type:"DELETE"};
  }

  throw Error("Unsupported SQL. Try CREATE TABLE, INSERT, SELECT, UPDATE, DELETE, or DROP TABLE.");
}

export function databaseSummary(db){
  const normalized=normalizeDb(db);
  return Object.entries(normalized.tables).map(([name,table])=>({
    name,rows:Array.isArray(table.rows)?table.rows.length:0,
    columns:Array.isArray(table.columns)?table.columns:[]
  }));
}
