import {notificationTarget} from "./notification-routing.mjs";
export const NOTIFICATION_HISTORY_LIMIT=200;
export const historyDocId=key=>"n_"+encodeURIComponent(String(key||"")).slice(0,900);
export function historyRecord(item,ownerUid,savedForLater=false){
  return {
    ownerUid:String(ownerUid),
    sourceKey:String(item.key||"").slice(0,500),
    type:String(item.type||"notice").slice(0,32),
    recipientRole:item.type==="issue"?(item.recipientRole||"admin"):"general",
    title:String(item.title||"Notification").slice(0,240),
    body:String(item.body||"").slice(0,800),
    target:notificationTarget(item.target),
    at:Number.isFinite(Number(item.at))?Math.max(0,Number(item.at)):0,
    savedForLater:Boolean(savedForLater)
  };
}
export function mergeNotificationHistory(live,history,read){
  const byKey=new Map();
  for(const item of history||[]){
    if(!item.sourceKey)continue;
    byKey.set(item.sourceKey,{
      ...item,key:item.sourceKey,saved:false,history:true,readAt:item.openedAt||true,
      pinned:Boolean(item.savedForLater)
    });
  }
  for(const item of live||[]){
    const older=byKey.get(item.key);
    byKey.set(item.key,{...item,pinned:Boolean(older?.pinned),
      history:Boolean(older),readAt:item.readAt||older?.readAt});
  }
  return [...byKey.values()].sort((a,b)=>Number(b.at||0)-Number(a.at||0))
    .slice(0,NOTIFICATION_HISTORY_LIMIT);
}
