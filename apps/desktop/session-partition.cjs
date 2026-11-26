"use strict";
/**
 * One local recovery namespace per verified Firebase UID.
 * Not an authorization credential; trusted backend school roles still apply.
 */
const {createHash}=require("node:crypto");
const PUBLIC_PARTITION="persist:adminerva-public-preview";
function schoolUserPartition(uid){
 if(typeof uid!=="string"||!uid||uid.length>128)
  throw Error("Invalid verified account for desktop storage.");
 return "persist:adminerva-school-"+createHash("sha256").update(uid,"utf8").digest("hex").slice(0,48);
}
module.exports={PUBLIC_PARTITION,schoolUserPartition};
