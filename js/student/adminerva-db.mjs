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
      if(ch===quote&&text[i+1]===quote){current+=text[++i];continue;}
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
  return quoted?quoted[2].split(quoted[1]+quoted[1]).join(quoted[1]).replace(/\\(['"])/g,"$1"):text;
}
function normalizeDb(db){
  const next=db&&typeof db==="object"?clone(db):{tables:{},history:[]};
  if(!next.tables||typeof next.tables!=="object")next.tables={};
  if(!Array.isArray(next.history))next.history=[];
  return next;
}
function tableOrThrow(db,name){
  if(!Object.hasOwn(db.tables,name))throw Error('Table "'+name+'" does not exist.');
  return db.tables[name];
}
/** Validate imported DB metadata before it can replace an existing project.
 * Keep this independent of the UI and the SQL interpreter's mutation path. */
export function validateAdminervaDb(value,{maxTables=50,maxRows=5000}={}){
  if(!value||typeof value!=="object"||Array.isArray(value)||
    !value.tables||typeof value.tables!=="object"||Array.isArray(value.tables)||
    !Array.isArray(value.history))throw Error("Invalid project database structure.");
  const tables=Object.entries(value.tables);
  if(tables.length>maxTables)throw Error("Project exceeds the database table limit.");
  for(const [name,table] of tables){
    if(!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name)||
      !table||typeof table!=="object"||Array.isArray(table)||
      !Array.isArray(table.columns)||!table.columns.length||table.columns.length>100||
      !Array.isArray(table.rows)||table.rows.length>maxRows)
      throw Error("Invalid database table or schema: "+name);
    const names=new Set();let primaryCount=0;
    for(const column of table.columns){
      if(!column||typeof column!=="object"||
        typeof column.name!=="string"||!/^[A-Za-z_][A-Za-z_0-9]*$/.test(column.name)||
        typeof column.type!=="string"||!/^[A-Za-z_][A-Za-z_0-9 ]{0,31}$/.test(column.type)||
        names.has(column.name))throw Error("Invalid or duplicate column in table "+name);
      names.add(column.name);if(column.primaryKey===true)primaryCount++;
    }
    if(primaryCount>1)throw Error("Table "+name+" has multiple primary keys.");
    const primary=table.columns.find(column=>column.primaryKey===true);
    const keys=new Set();
    for(const row of table.rows){
      if(!row||typeof row!=="object"||Array.isArray(row)||
        Object.keys(row).some(column=>!names.has(column)))
        throw Error("Invalid row in table "+name);
      for(const field of names){
        const cell=row[field];
        if(cell!==undefined&&cell!==null&&
          !(typeof cell==="string"||typeof cell==="boolean"||
            typeof cell==="number"&&Number.isFinite(cell)))
          throw Error("Invalid cell value in table "+name);
      }
      if(primary){
        const key=row[primary.name];
        if(key===undefined||key===null)throw Error("Missing primary key in table "+name);
        const normalized=String(key);
        if(keys.has(normalized))throw Error("Duplicate primary key in table "+name);
        keys.add(normalized);
      }
    }
  }
  return true;
}
function parseWhere(where,columns=[]){
  if(!where)return ()=>true;
  const m=String(where).trim().match(/^([A-Za-z_][\w]*)\s*(=|!=|<>|>=|<=|>|<)\s*([\s\S]+)$/);
  if(!m)throw Error("Adminerva DB currently supports one simple WHERE comparison.");
  const [,column,op,raw]=m,value=valueOf(raw);
  if(!columns.includes(column))throw Error('Unknown WHERE column "'+column+'".');
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
    if(new Set(columns.map(column=>column.name)).size!==columns.length)
      throw Error("Column names must be unique.");
    if(columns.filter(column=>column.primaryKey).length>1)
      throw Error("Adminerva DB supports one primary-key column per table.");
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
    if(!columns.length||columns.length!==values.length)throw Error("Column and value counts do not match.");
    if(new Set(columns).size!==columns.length)throw Error("Each INSERT column may appear only once.");
    const valid=new Set(table.columns.map(col=>col.name));
    for(const column of columns)if(!valid.has(column))throw Error('Unknown column "'+column+'".');
    const row=Object.fromEntries(table.columns.map(col=>[col.name,null]));
    columns.forEach((column,index)=>row[column]=values[index]);
    const primary=table.columns.find(col=>col.primaryKey);
    if(primary&&row[primary.name]==null)throw Error("Primary key "+primary.name+" cannot be NULL.");
    if(primary&&table.rows.some(item=>item[primary.name]==row[primary.name]))
      throw Error("Primary key value already exists.");
    table.rows.push(row);record(db,sql,"INSERT",1);
    return {db,columns:["message"],rows:[["1 row inserted."]],affected:1,type:"INSERT"};
  }

  m=sql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([A-Za-z_][\w]*)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([A-Za-z_][\w]*)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?$/i);
  if(m){
    const table=tableOrThrow(db,m[2]),available=table.columns.map(col=>col.name),predicate=parseWhere(m[3],available);
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
    const table=tableOrThrow(db,m[1]),valid=new Set(table.columns.map(col=>col.name)),
      predicate=parseWhere(m[3],[...valid]);
    const assignments=splitCsv(m[2]).map(item=>{
      const pair=item.match(/^([A-Za-z_][\w]*)\s*=\s*([\s\S]+)$/);if(!pair)throw Error("Invalid SET assignment.");
      if(!valid.has(pair[1]))throw Error('Unknown column "'+pair[1]+'".');
      return [pair[1],valueOf(pair[2])];
    });
    if(!assignments.length||new Set(assignments.map(pair=>pair[0])).size!==assignments.length)
      throw Error("Each UPDATE column must be assigned once.");
    const primary=table.columns.find(column=>column.primaryKey);
    const nextRows=table.rows.map(row=>{
      if(!predicate(row))return row;
      const updated={...row};
      assignments.forEach(([key,value])=>updated[key]=value);
      return updated;
    });
    if(primary){
      const keys=new Set();
      for(const row of nextRows){
        const value=row[primary.name];
        if(value==null)throw Error("Primary key "+primary.name+" cannot be NULL.");
        const key=String(value);
        if(keys.has(key))throw Error("Primary key value already exists.");
        keys.add(key);
      }
    }
    const affected=table.rows.filter(predicate).length;
    table.rows=nextRows;
    record(db,sql,"UPDATE",affected);
    return {db,columns:["message"],rows:[[affected+" row(s) updated."]],affected,type:"UPDATE"};
  }

  m=sql.match(/^DELETE\s+FROM\s+([A-Za-z_][\w]*)(?:\s+WHERE\s+([\s\S]+))?$/i);
  if(m){
    const table=tableOrThrow(db,m[1]),predicate=parseWhere(m[2],table.columns.map(col=>col.name)),before=table.rows.length;
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
