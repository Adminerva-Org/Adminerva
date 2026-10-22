/** One account-owned compatibility mirror. No duplicate persistent copies of credentials. */
export const CONNECTION_DEFAULTS=Object.freeze({githubToken:"",geminiKey:"",aiModel:"gemini-3.8-flash",engineMode:"cloud"});
const ownerKey="Adminerva_connection_owner";
const keys={githubToken:"Adminerva_github_token",geminiKey:"Adminerva_gemini_token",aiModel:"Adminerva_ai_model",engineMode:"Adminerva_engine_mode"};
function values(source={}){
  return Object.fromEntries(Object.entries(CONNECTION_DEFAULTS).map(([key,fallback])=>[key,typeof source[key]==="string"&&(source[key]||!fallback)?source[key]:fallback]));
}
export function clearConnectionPreferences(storage=localStorage){
  for(const key of Object.values(keys))storage.removeItem(key);
  storage.removeItem(ownerKey);
}
export function activateConnectionOwner(uid,storage=localStorage){
  if(uid==null){clearConnectionPreferences(storage);return {...CONNECTION_DEFAULTS};}
  if(typeof uid!=="string"||!uid)throw Error("A signed-in account is required for connection preferences.");
  if(storage.getItem(ownerKey)!==uid)clearConnectionPreferences(storage);
  storage.setItem(ownerKey,uid);
  return values(Object.fromEntries(Object.entries(keys).map(([key,storageKey])=>[key,storage.getItem(storageKey)])));
}
export function writeConnectionPreferences(uid,preferences,storage=localStorage){
  if(!uid||storage.getItem(ownerKey)!==uid)throw Error("Connection account changed. Reload before saving.");
  const normalized=values(preferences);
  for(const [key,storageKey] of Object.entries(keys))storage.setItem(storageKey,normalized[key]);
  return normalized;
}
