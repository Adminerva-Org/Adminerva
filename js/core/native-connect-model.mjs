/** Strictly validate the public random pairing reference. No token belongs in a URL. */
export function validFlowId(flowId){
 return typeof flowId==="string"&&/^[A-Za-z0-9_-]{43}$/.test(flowId);
}
