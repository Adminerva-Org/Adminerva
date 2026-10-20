/** Assessment authoring, repository evidence, individual review and protected grading: commit substance. */
/*
 * Conservative commit-diff screening for shared-repository grading.
 * This is NOT an authorship detector. It only identifies patches that
 * contain no observable new implementation beyond formatting/comments.
 */
const NON_SEMANTIC = new Set(['java','kt','kts','js','jsx','ts','tsx','c','cpp','cs','go','rs','php','swift']);
function extension(path) {
  const name = String(path || '').split('/').pop();
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}
function patchLines(patch) {
  if (typeof patch !== 'string') return null;
  const plus = [], minus = [];
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---') ||
        line.startsWith('@@') || line.startsWith('\\ No newline')) continue;
    if (line.startsWith('+')) plus.push(line.slice(1));
    else if (line.startsWith('-')) minus.push(line.slice(1));
  }
  return {plus, minus};
}
function meaningful(line, ext) {
  const text = line.trim();
  if (!text) return '';
  if (ext === 'xml') {
    return text;
  }
  if (/^(?:\/\/|\/\*|\*|\*\/)/.test(text)) return '';
  if (['py','rb','sh'].includes(ext) && text.startsWith('#')) return '';
  return text;
}
function canonical(line, ext) {
  const val = meaningful(line, ext);
  if (NON_SEMANTIC.has(ext)) return val.replace(/\s+/g,'');
  // Python indentation is executable syntax. Do not trim leading spaces.
  if (['py','yaml','yml'].includes(ext)) return val ? line.replace(/\s+$/g,'') : '';
  return val;
}
export function analyzePatchSubstance(patch, path) {
  const lines = patchLines(patch);
  if (!lines) return {kind:'unknown', substantive:null, reason:'Patch unavailable'};
  if (lines.plus.length + lines.minus.length === 0) {
    return {kind:'unknown', substantive:null, reason:'No changed lines available'};
  }
  const ext = extension(path);
  const semanticLines=items=>ext==='xml' ? items.join('\n').replace(/<!--[\s\S]*?(?:-->|$)/g,'').replace(/<\?xml\b[\s\S]*?\?>/g,'').split('\n') : items;
  const before = semanticLines(lines.minus).map(line=>canonical(line,ext)).filter(Boolean);
  const after = semanticLines(lines.plus).map(line=>canonical(line,ext)).filter(Boolean);
  if (!before.length && !after.length) {
    return {kind:'comments_or_whitespace',substantive:false,
      reason:'Only blank lines or full-line comments changed'};
  }
  if (before.length && before.join('\n') === after.join('\n')) {
    return {kind:'formatting_only',substantive:false,
      reason:'Added and removed implementation lines are equivalent after normalization'};
  }
  // A removed implementation line can be important; do not call it a trivial change.
  return {kind:'implementation_change',substantive:true,
    reason:'Patch changes observable implementation lines'};
}
export function analyzeFileContributions(file) {
  const results = (file.patches || []).map(p=>({
    sha:p.sha, ...analyzePatchSubstance(p.patch,file.path)
  }));
  const substantive = results.some(r=>r.substantive===true);
  const uncertain = results.some(r=>r.substantive===null);
  const lowSubstance = results.length>0 && !substantive && !uncertain;
  return {substantive,uncertain,lowSubstance,
    flaggedShas:results.filter(r=>r.substantive===false).map(r=>r.sha).filter(Boolean),
    results};
}
