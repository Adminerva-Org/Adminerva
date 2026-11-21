import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {validatedBulkLinkReview}=require("../functions/school-gradebook.js");
test("external link bulk drafts require individual teacher evidence review",()=>{
 assert.throws(()=>validatedBulkLinkReview("link",{
   onlyIfUngraded:true,artifactReviewNote:"Inspected the linked submission carefully."
 }),/individual teacher artifact verification/);
 assert.throws(()=>validatedBulkLinkReview("link",{
   onlyIfUngraded:true,externalArtifactVerified:true,artifactReviewNote:"Too short"
 }),/15–3000/);
 assert.throws(()=>validatedBulkLinkReview("link",{
   onlyIfUngraded:true,externalArtifactVerified:true,artifactReviewNote:"x".repeat(3001)
 }),/15–3000/);
 const note="Teacher opened and inspected the student's linked video evidence.";
 assert.equal(validatedBulkLinkReview("link",{
   onlyIfUngraded:true,externalArtifactVerified:true,artifactReviewNote:note
 }),note);
});
test("native written, Studio and approved GitHub bulk grades do not require link attestations",()=>{
 for(const source of ["studio","github","text"])
   assert.equal(validatedBulkLinkReview(source,{onlyIfUngraded:true}),"");
 assert.equal(validatedBulkLinkReview("link",{onlyIfUngraded:false}),"");
});
