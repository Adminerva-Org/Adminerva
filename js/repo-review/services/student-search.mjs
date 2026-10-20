export function searchStudents(students, {section = "", text = "", selected = "", limit = 40} = {}) {
  const normalize = value => String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const terms = normalize(text).trim().split(/\s+/).filter(Boolean);
  const matches = students.filter(student => (!section || student.section === section) &&
    terms.every(term => normalize([student.name, student.githubUsername, student.section].join(" ")).includes(term)))
    .sort((first, second) => String(first.name || first.id).localeCompare(String(second.name || second.id)) || first.id.localeCompare(second.id));
  const rows = matches.slice(0, limit);
  const current = students.find(student => student.id === selected);
  if (current && !rows.some(student => student.id === selected)) rows.unshift(current);
  return {rows, total:matches.length, truncated:matches.length > limit};
}
