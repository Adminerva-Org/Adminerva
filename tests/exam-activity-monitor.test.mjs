import test from "node:test";
import assert from "node:assert/strict";
import {createExamActivityObserver} from "../js/student/exam-activity-monitor.mjs";
function target(){
 const events=new Map();
 return {addEventListener(k,f){if(!events.has(k))events.set(k,new Set());events.get(k).add(f);},
 removeEventListener(k,f){events.get(k)?.delete(f);},
 fire(k){for(const f of events.get(k)||[])f();}};
}
test("activity observation is gated and stops cleanly",()=>{
 const doc=Object.assign(target(),{hidden:true}),win=target(),received=[];
 const observer=createExamActivityObserver({documentTarget:doc,windowTarget:win,
  emit:item=>received.push(item),now:()=>1234});
 doc.fire("visibilitychange");
 assert.equal(received.length,0);
 assert.throws(()=>observer.start({taskId:"task_1",sessionEpoch:1,monitoringEnabled:true}));
 observer.start({taskId:"task_1",sessionEpoch:1,monitoringEnabled:true,noticeAcknowledged:true});
 doc.fire("visibilitychange");win.fire("blur");
 observer.stop();win.fire("focus");
 assert.equal(observer.active,false);
 assert.deepEqual(received.map(x=>x.kind),["exam_started","page_hidden","window_blurred","exam_stopped"]);
});
test("telemetry transport failures never interrupt the editor",()=>{
 const observer=createExamActivityObserver({documentTarget:target(),windowTarget:target(),
  emit:()=>{throw Error("Network interrupted");}});
 assert.doesNotThrow(()=>observer.start({taskId:"t",sessionEpoch:1,monitoringEnabled:true,noticeAcknowledged:true}));
 assert.doesNotThrow(()=>observer.stop());
});
