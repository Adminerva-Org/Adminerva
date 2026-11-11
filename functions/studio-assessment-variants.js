/** Server-issued personalized Adminerva Studio assessment variants. */
const {randomBytes,createHash}=require("node:crypto");

const JAVA_LOGIC_GENERATOR_ID="java_logic_written_work_v1";
const JAVA_OOP_GENERATOR_ID="java_oop_fundamentals_v1";
const hash=value=>createHash("sha256").update(value).digest("hex");
const deny=(code,message)=>{const error=Error(message);error.code=code;throw error;};
const cleanId=(value,label)=>{
  const text=String(value||"");
  if(!/^[A-Za-z0-9_-]{1,160}$/.test(text))deny("invalid-argument",label+" is invalid.");
  return text;
};
const activeStudent=data=>data&&data.active!==false&&!["disabled","archived","suspended"].includes(String(data.status||"active"));

function byte(entropy,index){return entropy[index%entropy.length];}
function between(entropy,index,min,max){return min+(byte(entropy,index)%(max-min+1));}
function pick(list,entropy,index){return list[byte(entropy,index)%list.length];}
function requireEntropy(entropy){
  if(!Buffer.isBuffer(entropy)||entropy.length<16)
    throw Error("Variant entropy must contain at least 16 bytes.");
}

const logicNameSets=[
  ["emberCount","signalLimit","finalScore"],
  ["orbitPoints","boostValue","missionTotal"],
  ["cedarStock","orderSize","stockResult"],
  ["pixelScore","bonusStep","displayTotal"],
  ["riverLevel","changeValue","levelResult"],
  ["novaCredits","costValue","creditResult"],
  ["maplePoints","roundValue","gameTotal"],
  ["atlasCount","stepValue","countResult"]
];
const passLabels=["READY","PASS","GO","ACCEPT","LEVEL-UP","VALID"];
const failLabels=["RETRY","HOLD","WAIT","CHECK","REVISE","NOT-YET"];

function buildJavaLogicVariant(entropy){
  requireEntropy(entropy);
  const names=pick(logicNameSets,entropy,0),first=between(entropy,1,8,24),second=between(entropy,2,3,12),
    factor=between(entropy,3,2,4),adjust=between(entropy,4,2,9),
    pass=pick(passLabels,entropy,5),fail=pick(failLabels,entropy,6),family=byte(entropy,7)%4;
  const [left,right,result]=names;
  let expression,threshold,scenario;
  if(family===0){
    expression=left+" + "+right+" * "+factor;
    threshold=first+second*factor-between(entropy,8,0,5);
    scenario="Compute a weighted total, then make a decision.";
  }else if(family===1){
    expression=left+" * "+factor+" - "+right;
    threshold=first*factor-second-between(entropy,8,0,4);
    scenario="Compute an adjusted total, then make a decision.";
  }else if(family===2){
    expression=left+" + "+right+" + "+adjust;
    threshold=first+second+adjust-between(entropy,8,0,5);
    scenario="Apply a fixed adjustment, then make a decision.";
  }else{
    expression="("+left+" - "+right+") * "+factor;
    threshold=(first-second)*factor-between(entropy,8,0,4);
    scenario="Compute a difference-based total, then make a decision.";
  }
  threshold=Math.max(4,threshold);
  const prompt=[
    "PERSONALIZED JAVA LOGIC TASK",
    "",
    scenario,
    "",
    "Create a Java console program that follows ALL of these requirements:",
    "1. Declare an int variable named `"+left+"` and assign it the value "+first+".",
    "2. Declare an int variable named `"+right+"` and assign it the value "+second+".",
    "3. Declare an int variable named `"+result+"` and compute it using this exact expression:",
    "   "+result+" = "+expression+";",
    "4. Use an if/else statement to test whether `"+result+" >= "+threshold+"`.",
    "5. If the condition is true, print exactly: "+pass+": <value of "+result+">",
    "6. Otherwise, print exactly: "+fail+": <value of "+result+">",
    "7. Do not hard-code the final numeric result in the print statement. Print the variable.",
    "8. Keep the program readable and properly indented.",
    "",
    "Use the exact variable names and values shown above. Your assigned version is different from other learners' versions."
  ].join("\n");
  return {
    generatorId:JAVA_LOGIC_GENERATOR_ID,
    prompt,
    publicSpec:{language:"java",competencies:["variables","expressions","conditionals","output"],
      variableNames:[left,right,result],values:[first,second],threshold,passLabel:pass,failLabel:fail},
    teacherSpec:{expression,family}
  };
}

const oopContexts=[
  {
    classNames:["LibraryBook","ReadingBook","BookRecord"],
    textFields:["bookTitle","titleName","readingTitle"],
    numberFields:["copyCount","pagePoints","borrowCredits"],
    methods:["addCopies","addPoints","addCredits"],
    objectRoots:["book","reading","record"],
    labels:["Atlas Guide","Nova Stories","Cedar Notes","Orbit Manual","Maple Tales","Pixel Journal"]
  },
  {
    classNames:["GamePlayer","PlayerProfile","GameHero"],
    textFields:["playerName","heroName","profileName"],
    numberFields:["levelPoints","energyPoints","skillPoints"],
    methods:["gainPoints","addEnergy","trainSkill"],
    objectRoots:["player","hero","profile"],
    labels:["Astra","Bolt","Cinder","Drift","Echo","Flare"]
  },
  {
    classNames:["StoreItem","ProductStock","InventoryItem"],
    textFields:["productName","itemName","stockLabel"],
    numberFields:["stockCount","unitCount","supplyCount"],
    methods:["restock","addUnits","addSupply"],
    objectRoots:["item","product","stock"],
    labels:["Cable Kit","Desk Lamp","Mouse Pad","Notebook Set","USB Hub","Webcam Stand"]
  },
  {
    classNames:["VehicleTrip","CarMeter","TravelVehicle"],
    textFields:["vehicleName","routeName","tripLabel"],
    numberFields:["distanceKm","travelPoints","tripCount"],
    methods:["addDistance","addTravel","addTrips"],
    objectRoots:["vehicle","trip","car"],
    labels:["Blue Route","City Loop","North Run","River Road","South Link","West Path"]
  },
  {
    classNames:["LearnerProfile","CourseLearner","StudentRecord"],
    textFields:["learnerName","studentName","recordName"],
    numberFields:["activityPoints","taskPoints","progressPoints"],
    methods:["addActivity","addTaskPoints","addProgress"],
    objectRoots:["learner","student","record"],
    labels:["Alex Cruz","Bea Santos","Carlo Reyes","Dina Flores","Enzo Lim","Faith Ramos"]
  },
  {
    classNames:["SmartDevice","GadgetItem","DeviceProfile"],
    textFields:["deviceName","gadgetName","modelName"],
    numberFields:["batteryPoints","usagePoints","chargeLevel"],
    methods:["addBattery","addUsage","chargeUp"],
    objectRoots:["device","gadget","model"],
    labels:["Nova Pad","Atlas Phone","Pixel Watch","Cedar Tab","Orbit Band","Maple Hub"]
  },
  {
    classNames:["TransitPass","RidePass","TravelPass"],
    textFields:["passName","routeLabel","travelerName"],
    numberFields:["rideCredits","tripCredits","travelCredits"],
    methods:["addRides","addTrips","addCredits"],
    objectRoots:["pass","ride","travel"],
    labels:["City Pass","North Card","River Ticket","South Pass","Metro Card","Campus Ride"]
  },
  {
    classNames:["FitnessMember","TrainingProfile","WorkoutMember"],
    textFields:["memberName","profileName","athleteName"],
    numberFields:["sessionPoints","workoutPoints","trainingPoints"],
    methods:["addSessions","addWorkout","addTraining"],
    objectRoots:["member","profile","athlete"],
    labels:["Ari Vega","Ben Cole","Cora Lane","Drew Moss","Elle Ray","Finn Park"]
  }
];
const amountParams=["amount","increase","addedValue","increment","extraPoints","change"];

function buildJavaOopVariant(entropy){
  requireEntropy(entropy);
  const context=pick(oopContexts,entropy,0),
    className=pick(context.classNames,entropy,1),
    textField=pick(context.textFields,entropy,2),
    numberField=pick(context.numberFields,entropy,3),
    methodName=pick(context.methods,entropy,4),
    objectRoot=pick(context.objectRoots,entropy,5),
    amountParam=pick(amountParams,entropy,6),
    firstLabel=pick(context.labels,entropy,7),
    secondLabel=context.labels[(context.labels.indexOf(firstLabel)+1+byte(entropy,8)%(context.labels.length-1))%context.labels.length],
    firstStart=between(entropy,9,4,18),
    secondStart=between(entropy,10,5,20),
    firstChange=between(entropy,11,2,7),
    secondChange=between(entropy,12,1,6),
    firstObject=["primary","first","main","active"][byte(entropy,13)%4]+objectRoot[0].toUpperCase()+objectRoot.slice(1),
    secondObject=["backup","second","extra","other"][byte(entropy,14)%4]+objectRoot[0].toUpperCase()+objectRoot.slice(1),
    displayMethod=["displayInfo","showDetails","printSummary"][byte(entropy,15)%3],
    firstFinal=firstStart+firstChange,secondFinal=secondStart+secondChange,
    outputPrefix=className+" -> ";
  const firstOutput=outputPrefix+textField+": "+firstLabel+" | "+numberField+": "+firstFinal;
  const secondOutput=outputPrefix+textField+": "+secondLabel+" | "+numberField+": "+secondFinal;
  const prompt=[
    "MINI PETA 3 — PERSONALIZED JAVA OOP CHALLENGE",
    "",
    "Create a Java console project that demonstrates the required Object-Oriented Programming structure. Your identifiers and values are assigned specifically to this attempt.",
    "",
    "A. CLASS FILE",
    "Create a file named `"+className+".java` containing a public class named `"+className+"`.",
    "1. Declare exactly these two instance fields as private:",
    "   private String "+textField+";",
    "   private int "+numberField+";",
    "2. Create a constructor with this exact header:",
    "   public "+className+"(String "+textField+", int "+numberField+")",
    "3. Inside the constructor, initialize both fields using `this`.",
    "4. Create this public behavior method:",
    "   public void "+methodName+"(int "+amountParam+")",
    "   The method must add "+amountParam+" to "+numberField+" using the object's field. Do not return a hard-coded answer.",
    "5. Create this public display method:",
    "   public void "+displayMethod+"()",
    "   It must print the object's current field values in this format:",
    "   "+outputPrefix+textField+": <text value> | "+numberField+": <number value>",
    "",
    "B. MAIN PROGRAM",
    "In `Main.java`, create these two objects using the exact object variable names and starting values:",
    "1. "+className+" "+firstObject+" = new "+className+"(\""+firstLabel+"\", "+firstStart+");",
    "2. "+className+" "+secondObject+" = new "+className+"(\""+secondLabel+"\", "+secondStart+");",
    "3. Call `"+firstObject+"."+methodName+"("+firstChange+");`",
    "4. Call `"+secondObject+"."+methodName+"("+secondChange+");`",
    "5. Call `"+displayMethod+"()` once for each object after the updates.",
    "",
    "EXPECTED OUTPUT",
    firstOutput,
    secondOutput,
    "",
    "OOP REQUIREMENTS",
    "- Keep the two fields private; do not make them public or static.",
    "- Put the reusable object behavior inside "+className+", not entirely inside Main.",
    "- Use the constructor to initialize object state.",
    "- Use the assigned method to modify each object's own state.",
    "- Do not hard-code the two expected output lines as complete literal strings.",
    "- Keep both Java files readable and properly indented.",
    "",
    "Only the requirements in your assigned version are graded. Inheritance, interfaces, databases, GUI code and advanced frameworks are NOT required."
  ].join("\n");
  return {
    generatorId:JAVA_OOP_GENERATOR_ID,
    prompt,
    publicSpec:{
      language:"java",
      competencies:["class","encapsulation","constructor","instance_method","objects","state","output"],
      className,requiredFiles:["Main.java",className+".java"],
      fields:[{name:textField,type:"String",visibility:"private"},{name:numberField,type:"int",visibility:"private"}],
      constructor:{parameters:[textField,numberField],requiresThis:true},
      behaviorMethod:{name:methodName,parameter:amountParam,operation:numberField+" += "+amountParam},
      displayMethod,
      objects:[
        {variable:firstObject,textValue:firstLabel,startValue:firstStart,change:firstChange,finalValue:firstFinal},
        {variable:secondObject,textValue:secondLabel,startValue:secondStart,change:secondChange,finalValue:secondFinal}
      ],
      expectedOutput:[firstOutput,secondOutput]
    },
    teacherSpec:{context:className,outputPrefix}
  };
}

const GENERATORS=new Map([
  [JAVA_LOGIC_GENERATOR_ID,buildJavaLogicVariant],
  [JAVA_OOP_GENERATOR_ID,buildJavaOopVariant]
]);
function buildVariant(generatorId,entropy){
  const builder=GENERATORS.get(generatorId);
  if(!builder)throw Error("Unsupported personalized task generator.");
  return builder(entropy);
}
function candidate(generatorId){
  const variant=buildVariant(generatorId,randomBytes(24));
  const variantKey=hash(variant.prompt);
  return {...variant,variantKey,variantId:variantKey.slice(0,16)};
}
function timeMillis(value){return value?.toMillis?.()||0;}

function createStudioAssessmentVariantService({db,Timestamp}){
  async function assessmentRecord(assessmentId){
    const record=await db.doc("assessments/"+assessmentId).get();
    if(!record.exists)deny("not-found","This assessment is unavailable.");
    const data=record.data(),generatorId=data.personalizedTask?.generator;
    if(data.schemaVersion!==3||data.submissionSource!=="studio"||data.personalizedTask?.enabled!==true)
      deny("failed-precondition","This assessment does not use personalized Studio tasks.");
    if(!GENERATORS.has(generatorId))
      deny("failed-precondition","This personalized task generator is not supported.");
    return {ref:record.ref,data,generatorId};
  }
  async function studentFor(actor,assessment){
    const email=String(actor.token?.email||"").toLowerCase().trim();
    if(!actor.uid||actor.token?.email_verified!==true||!email)
      deny("unauthenticated","Use a verified school account before opening a personalized task.");
    const snap=await db.collection("students").where("email","==",email).limit(20).get();
    const matches=snap.docs.filter(record=>{
      const data=record.data();
      return activeStudent(data)&&Array.isArray(assessment.sectionIds)&&assessment.sectionIds.includes(data.section);
    });
    if(!matches.length)deny("permission-denied","This assessment is not assigned to your verified class.");
    if(matches.length>1){
      const distinct=[...new Set(matches.map(record=>record.data().section))];
      if(distinct.length>1)deny("failed-precondition","This account has multiple matching class records. Open the assignment from My Assessments.");
    }
    const record=matches[0];
    return {id:record.id,...record.data()};
  }
  function windowOpen(assessment,section,now){
    const entry=assessment.studioWindows?.[section];
    if(!entry)return false;
    return now>=timeMillis(entry.opensAt)&&now<=timeMillis(entry.closesAt);
  }
  async function authorizeTeacher(actor,assessment,student){
    const email=String(actor.token?.email||"").toLowerCase().trim();
    if(!actor.uid||actor.token?.email_verified!==true||!email)
      deny("unauthenticated","Use a verified staff account.");
    if(assessment.ownerUid===actor.uid)return;
    const access=await db.doc("staff_access/"+email).get();
    const data=access.exists?access.data():null;
    if(data?.status==="active"&&data.role==="admin")return;
    if(data?.status==="active"&&data.role==="teacher"&&Array.isArray(data.sections)&&data.sections.includes(student.section))return;
    deny("permission-denied","You are not authorized to inspect this learner's personalized task.");
  }
  return async request=>{
    const actor=request.auth||{},input=request.data||{},assessmentId=cleanId(input.assessmentId,"Assessment");
    const {data:assessment,generatorId}=await assessmentRecord(assessmentId);
    if(input.action==="inspect"){
      const studentId=cleanId(input.studentId,"Student"),attempt=Number(input.attempt);
      if(!Number.isInteger(attempt)||attempt<1||attempt>30)deny("invalid-argument","Attempt number is invalid.");
      const studentRecord=await db.doc("students/"+studentId).get();
      if(!studentRecord.exists)deny("not-found","Student record unavailable.");
      const student={id:studentRecord.id,...studentRecord.data()};
      await authorizeTeacher(actor,assessment,student);
      const variant=await db.doc("studio_assessment_variants/"+studentId+"_"+assessmentId+"/attempts/"+attempt).get();
      if(!variant.exists)deny("not-found","No personalized task was recorded for this submitted revision.");
      const data=variant.data();
      return {assessmentId,studentId,attempt,variantId:data.variantId,prompt:data.prompt,
        generatorId:data.generatorId,createdAt:timeMillis(data.createdAt),publicSpec:data.publicSpec||null};
    }
    const student=await studentFor(actor,assessment),now=Date.now(),headRef=db.doc("studio_submissions/"+student.id+"_"+assessmentId),
      head=await headRef.get(),headData=head.exists?head.data():null;
    let attempt=1,readOnly=false;
    if(headData){
      const revision=Number(headData.revision)||1;
      if(headData.status==="revision_requested")attempt=revision+1;
      else {attempt=revision;readOnly=["submitted","reviewed"].includes(headData.status);}
    }
    if(attempt>30)deny("failed-precondition","The Studio revision limit was reached.");
    const variantRef=db.doc("studio_assessment_variants/"+student.id+"_"+assessmentId+"/attempts/"+attempt),
      existing=await variantRef.get();
    if(existing.exists){
      const data=existing.data();
      if(data.generatorId!==generatorId)
        deny("failed-precondition","The assessment recipe changed after this attempt was issued. Ask your teacher to review the blueprint.");
      return {assessmentId,studentId:student.id,attempt,variantId:data.variantId,prompt:data.prompt,
        generatorId:data.generatorId,createdAt:timeMillis(data.createdAt),readOnly,publicSpec:data.publicSpec||null};
    }
    if(readOnly)deny("failed-precondition","The submitted revision has no recorded personalized task.");
    if(!windowOpen(assessment,student.section,now))
      deny("failed-precondition","This personalized task cannot start outside the Studio submission window.");
    const candidates=Array.from({length:8},()=>candidate(generatorId));
    const root=db.doc("studio_assessment_variants/"+student.id+"_"+assessmentId);
    let result;
    await db.runTransaction(async tx=>{
      const latestHead=await tx.get(headRef);
      let currentAttempt=1;
      if(latestHead.exists){
        const data=latestHead.data(),revision=Number(data.revision)||1;
        currentAttempt=data.status==="revision_requested"?revision+1:revision;
      }
      if(currentAttempt!==attempt)deny("failed-precondition","Submission status changed. Reload the assignment before starting a new task.");
      const current=await tx.get(variantRef);
      if(current.exists){result=current.data();return;}
      const registryRefs=candidates.map(item=>db.doc("studio_assessment_variant_registry/"+assessmentId+"/keys/"+item.variantKey));
      const registry=await Promise.all(registryRefs.map(ref=>tx.get(ref)));
      const previous=attempt>1?await tx.get(db.doc(root.path+"/attempts/"+(attempt-1))):null;
      const previousKey=previous?.exists?previous.data().variantKey:null;
      const index=registry.findIndex((record,i)=>!record.exists&&candidates[i].variantKey!==previousKey);
      if(index<0)deny("resource-exhausted","Could not allocate a unique task variant. Reload and try again.");
      const chosen=candidates[index],createdAt=Timestamp.fromMillis(now);
      result={assessmentId,studentId:student.id,ownerUid:actor.uid,section:student.section,attempt,
        variantId:chosen.variantId,variantKey:chosen.variantKey,generatorId:chosen.generatorId,
        prompt:chosen.prompt,publicSpec:chosen.publicSpec,teacherSpec:chosen.teacherSpec,createdAt};
      tx.create(registryRefs[index],{studentId:student.id,attempt,variantId:chosen.variantId,generatorId,createdAt});
      tx.create(variantRef,result);
    });
    return {assessmentId,studentId:student.id,attempt,variantId:result.variantId,prompt:result.prompt,
      generatorId:result.generatorId,createdAt:timeMillis(result.createdAt),readOnly:false,publicSpec:result.publicSpec||null};
  };
}

module.exports={
  createStudioAssessmentVariantService,
  buildJavaLogicVariant,
  buildJavaOopVariant,
  buildVariant,
  JAVA_LOGIC_GENERATOR_ID,
  JAVA_OOP_GENERATOR_ID
};
