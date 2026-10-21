export const lessonSettingKeys={teacher_name:"defaultTeacher",subject_title:"defaultSubject",default_prelim:"defaultPrelim",default_closing:"defaultClosing",sig_teacher:"sig1Name",sig_teacher_title:"sig1Title",sig_subject_coord:"sig2Name",sig_subject_coord_title:"sig2Title",sig_grade_coord:"sig3Name",sig_grade_coord_title:"sig3Title",sig_principal:"sig4Name",sig_principal_title:"sig4Title"};
export function captureLessonSettings(storage,overrides={}) {
  return Object.fromEntries(Object.entries(lessonSettingKeys).map(([field,key])=>[field,String(overrides[field]??storage.getItem("Adminerva_"+key)??storage.getItem("lessonReview_"+key)??"").slice(0,10000)]));
}
export function savedLessonSettings(plan) {
  const settings=plan.document_settings&&typeof plan.document_settings==="object"?plan.document_settings:{};
  return Object.fromEntries(Object.keys(lessonSettingKeys).filter(key=>typeof settings[key]==="string").map(key=>[key,settings[key]]).concat([["subject_title",plan.subject_title||settings.subject_title||"Subject"],["teacher_name",plan.teacher_name||settings.teacher_name||"Unassigned"]]));
}
