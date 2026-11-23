/** Shared, non-authoritative app-client compatibility model (no native privileges). */
export const CLIENT_PROTOCOL=1;
export const NATIVE_CLIENT_KINDS=Object.freeze(["desktop","android","ios"]);
export const RECOGNIZED_NATIVE_CAPABILITIES=Object.freeze([
 "notifications","secure-storage","file-access","screen-capture","foreground-applications"
]);
const nativeKinds=new Set(NATIVE_CLIENT_KINDS);
const supportedCapabilities=new Set(RECOGNIZED_NATIVE_CAPABILITIES);
export function describeAppClient(value){
 const base={kind:"web",channel:"browser",protocol:null,shellVersion:null,capabilities:[]};
 if(!value||typeof value!=="object"||!nativeKinds.has(value.kind))return base;
 const protocol=Number.isSafeInteger(value.protocol)&&value.protocol>0?value.protocol:null;
 const shellVersion=typeof value.shellVersion==="string"&&
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value.shellVersion)
  ?value.shellVersion:null;
 const channel=value.channel==="public-preview"?"public-preview":
  value.channel==="release"?"release":"unknown";
 const capabilities=Array.isArray(value.capabilities)?
  [...new Set(value.capabilities.filter(x=>typeof x==="string"&&supportedCapabilities.has(x)))].sort():[];
 return {kind:value.kind,channel,protocol,shellVersion,capabilities};
}
export function assessNativeCapability(client,capability,{minimumProtocol=CLIENT_PROTOCOL}={}){
 const descriptor=describeAppClient(client);
 if(descriptor.kind==="web")return {supported:false,reason:"browser"};
 if(descriptor.protocol!==minimumProtocol)return {supported:false,reason:"incompatible-bridge"};
 if(descriptor.channel!=="release")return {supported:false,reason:"unreleased-client"};
 if(!supportedCapabilities.has(capability)||!descriptor.capabilities.includes(capability))
  return {supported:false,reason:"capability-unavailable"};
 // Capability advertisement is never a grant. Native OS permissions and the
 // school-scoped server must independently authorize any protected operation.
 return {supported:true,reason:"advertised-only"};
}
