import {collection,getDocsFromServer,query,where} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
const pending=new Map();
export function practiceMemberships(database,user){
  if(!user?.emailVerified||!user.email)return Promise.resolve([]);
  const key=user.uid+":"+user.email.toLowerCase();
  if(!pending.has(key))pending.set(key,getDocsFromServer(query(collection(database,"students"),where("email","==",user.email.toLowerCase()))).then(records=>records.docs.map(record=>({id:record.id,...record.data()}))).finally(()=>pending.delete(key)));
  return pending.get(key);
}
