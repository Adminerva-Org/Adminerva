const encoder=new TextEncoder();

function xml(value){
  return String(value??"").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,"")
    .replace(/[&<>"']/g,char=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"
  })[char]);
}
function columnName(index){
  let value=index+1,name="";
  while(value){value--;name=String.fromCharCode(65+(value%26))+name;value=Math.floor(value/26);}
  return name;
}
function crcTable(){
  const table=new Uint32Array(256);
  for(let n=0;n<256;n++){
    let c=n;
    for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
    table[n]=c>>>0;
  }
  return table;
}
const CRC_TABLE=crcTable();
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes)crc=CRC_TABLE[(crc^byte)&0xff]^(crc>>>8);
  return (crc^0xffffffff)>>>0;
}
function dosTime(date){
  return ((date.getHours()&31)<<11)|((date.getMinutes()&63)<<5)|((date.getSeconds()>>1)&31);
}
function dosDate(date){
  const year=Math.max(1980,date.getFullYear());
  return (((year-1980)&127)<<9)|(((date.getMonth()+1)&15)<<5)|(date.getDate()&31);
}
function concat(parts){
  const size=parts.reduce((sum,part)=>sum+part.length,0),out=new Uint8Array(size);
  let offset=0;for(const part of parts){out.set(part,offset);offset+=part.length;}return out;
}
function zip(files){
  const localParts=[],centralParts=[];let localOffset=0,centralSize=0;
  const now=new Date(),time=dosTime(now),date=dosDate(now);
  for(const file of files){
    const name=encoder.encode(file.name),data=typeof file.data==="string"?encoder.encode(file.data):file.data;
    const crc=crc32(data),local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0,true);
    lv.setUint16(8,0,true);lv.setUint16(10,time,true);lv.setUint16(12,date,true);
    lv.setUint32(14,crc,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);
    lv.setUint16(26,name.length,true);lv.setUint16(28,0,true);local.set(name,30);
    localParts.push(local,data);

    const central=new Uint8Array(46+name.length),cv=new DataView(central.buffer);
    cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);
    cv.setUint16(8,0,true);cv.setUint16(10,0,true);cv.setUint16(12,time,true);cv.setUint16(14,date,true);
    cv.setUint32(16,crc,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);
    cv.setUint16(28,name.length,true);cv.setUint16(30,0,true);cv.setUint16(32,0,true);
    cv.setUint16(34,0,true);cv.setUint16(36,0,true);cv.setUint32(38,0,true);
    cv.setUint32(42,localOffset,true);central.set(name,46);
    centralParts.push(central);centralSize+=central.length;
    localOffset+=local.length+data.length;
  }
  const end=new Uint8Array(22),ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true);ev.setUint16(4,0,true);ev.setUint16(6,0,true);
  ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);
  ev.setUint32(12,centralSize,true);ev.setUint32(16,localOffset,true);ev.setUint16(20,0,true);
  return concat([...localParts,...centralParts,end]);
}
function cell(value,row,column,header=false){
  const ref=columnName(column)+(row+1),style=header?' s="1"':"";
  if(typeof value==="number"&&Number.isFinite(value))
    return '<c r="'+ref+'"'+style+'><v>'+value+'</v></c>';
  const text=String(value??"");
  return '<c r="'+ref+'" t="inlineStr"'+style+'><is><t xml:space="preserve">'+xml(text)+'</t></is></c>';
}
function worksheet(rows,headerRowIndex=0){
  const safeHeader=Math.max(0,Math.min(rows.length-1,Number(headerRowIndex)||0));
  const body=rows.map((values,rowIndex)=>
    '<row r="'+(rowIndex+1)+'">'+values.map((value,columnIndex)=>cell(value,rowIndex,columnIndex,rowIndex===safeHeader)).join("")+'</row>'
  ).join("");
  const maxColumns=Math.max(1,...rows.map(row=>row.length)),lastRow=Math.max(1,rows.length),
    last=columnName(maxColumns-1)+lastRow,headerRow=safeHeader+1;
  const filter=rows.length>headerRow?'<autoFilter ref="A'+headerRow+':'+last+'"/>':"";
  const cols='<cols><col min="1" max="1" width="28" customWidth="1"/>'+
    (maxColumns>1?'<col min="2" max="'+maxColumns+'" width="15" customWidth="1"/>':"")+'</cols>';
  const split=headerRow,topLeft='A'+(headerRow+1);
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="'+split+'" topLeftCell="'+topLeft+'" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
    cols+'<sheetData>'+body+'</sheetData>'+filter+'</worksheet>';
}
const STYLES='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
  '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="11"/><name val="Aptos"/></font></fonts>'+
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'+
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>'+
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

export function classRecordWorkbook(rows,{sheetName="Class Record",headerRowIndex=0}={}){
  if(!Array.isArray(rows)||!rows.length)throw Error("Workbook rows are required.");
  if(rows.length>5000||rows.some(row=>!Array.isArray(row)||row.length>200))
    throw Error("Workbook exceeds the supported Class Record export size.");
  const safeName=String(sheetName||"Class Record").replace(/[\\/*?:\[\]]/g," ").trim().slice(0,31)||"Class Record";
  const files=[
    {name:"[Content_Types].xml",data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'},
    {name:"_rels/.rels",data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'},
    {name:"xl/workbook.xml",data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+xml(safeName)+'" sheetId="1" r:id="rId1"/></sheets></workbook>'},
    {name:"xl/_rels/workbook.xml.rels",data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'},
    {name:"xl/styles.xml",data:STYLES},
    {name:"xl/worksheets/sheet1.xml",data:worksheet(rows,headerRowIndex)}
  ];
  return new Blob([zip(files)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}