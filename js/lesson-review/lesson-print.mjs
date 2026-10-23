/** Browser print layout. Keep school columns, but never span a session across rows. */
const MM_TO_PX = 96 / 25.4;
const COLUMN_MM = [24.93, 41.55, 41.55, 16.62, 85.87, 33.24, 33.24];
const text = value => String(value ?? "").replace(/\\n/g, "\n");
const field = (label, value) => text(value).trim() ? `${label}:\n${text(value)}` : "";

// Bound each cell by its rendered height, including unusually long pasted text.
// Small independent rows can move to the next page without stranding a whole session.
function createCellSplitter() {
  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;box-sizing:content-box;margin:0;padding:0;border:0;font:9pt/1.22 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal;";
  document.body.append(probe);
  return {
    split(value, column) {
      let remaining = text(value).trim();
      if (!remaining) return [];
      probe.style.width = `${(COLUMN_MM[column] - 2.4) * MM_TO_PX}px`;
      const limit = 37 * MM_TO_PX;
      const chunks = [];
      while (remaining) {
        probe.textContent = remaining;
        if (probe.getBoundingClientRect().height <= limit) {
          chunks.push(remaining);
          break;
        }
        let low = 1;
        let high = remaining.length;
        while (low < high) {
          const mid = Math.ceil((low + high) / 2);
          probe.textContent = remaining.slice(0, mid);
          if (probe.getBoundingClientRect().height <= limit) low = mid;
          else high = mid - 1;
        }
        let cut = Math.max(1, low);
        const boundary = Math.max(remaining.lastIndexOf("\n", cut - 1), remaining.lastIndexOf(" ", cut - 1));
        if (boundary >= cut * 0.6) cut = boundary + 1;
        // A surrogate pair is one character; never divide an emoji between cells.
        if (cut > 1 && /[\uD800-\uDBFF]/.test(remaining[cut - 1])) cut--;
        chunks.push(remaining.slice(0, cut).trim());
        remaining = remaining.slice(cut).trim();
      }
      return chunks;
    },
    dispose() { probe.remove(); },
  };
}

function activityParts(session, splitter) {
  const isFlex = text(session.session_name).toLowerCase().includes("flex");
  const isLab = text(session.session_name).includes("4-6");
  const parts = [
    ["Preliminary Activities", session.preliminary, isFlex ? "" : isLab ? "10 mins" : "5 mins"],
    ["Motivation / Recall", session.motivation, isFlex ? "" : isLab ? "10 mins" : "5 mins"],
    ["Learning Activities", session.learning_activities, isFlex ? "" : isLab ? "110 mins" : "26 mins"],
    ["Evaluation", session.evaluation, isFlex ? "" : isLab ? "15 mins" : "10 mins"],
    ["Closing Activities", session.closing, isFlex ? "" : isLab ? "5 mins" : "4 mins"],
    ["Values Integration", session.values_integration, ""],
  ];
  return parts.flatMap(([label, value, duration]) =>
    splitter.split(value, 4).map((content, index) => ({
      label: `${label}${index ? " (continued)" : ""}`,
      content,
      time: index ? "" : duration,
    })),
  );
}

export function buildContinuousLessonRows(plan, overview) {
  const body = document.getElementById("printTableBody");
  if (!body) throw new Error("The lesson print layout is unavailable. Refresh this page and try again.");
  const splitter = createCellSplitter();
  const fragment = document.createDocumentFragment();
  try {
    plan.forEach((session, index) => {
      const heading = document.createElement("tr");
      heading.className = "lesson-print-session";
      const headingCell = document.createElement("th");
      headingCell.colSpan = 7;
      headingCell.scope = "rowgroup";
      headingCell.textContent = text(session.session_name) || `Session ${index + 1}`;
      heading.append(headingCell);
      fragment.append(heading);

      const columns = [
        splitter.split(session.topic || overview.topic, 0),
        splitter.split([
          field("Content Standard", overview.content_standard),
          field("Performance Standard", overview.performance_standard),
          field("Formation Standard", session.formation_standard),
        ].filter(Boolean).join("\n\n"), 1),
        splitter.split([
          field("Learning Competencies", session.competencies),
          field("Objectives", session.objectives),
        ].filter(Boolean).join("\n\n"), 2),
        [], [],
        splitter.split(overview.materials, 5),
        splitter.split(session.remarks, 6),
      ];
      const activities = activityParts(session, splitter);
      const rowCount = Math.max(1, activities.length, ...columns.map(values => values.length));
      for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
        const row = document.createElement("tr");
        row.className = "lesson-print-content-row";
        for (let column = 0; column < 7; column++) {
          const cell = document.createElement("td");
          if (column === 3) {
            cell.className = "lesson-print-time";
            cell.textContent = activities[rowIndex]?.time || "";
          } else if (column === 4 && activities[rowIndex]) {
            const label = document.createElement("strong");
            label.className = "lesson-print-activity-label";
            label.textContent = activities[rowIndex].label;
            cell.append(label, document.createTextNode(activities[rowIndex].content));
          } else {
            cell.textContent = columns[column][rowIndex] || "";
          }
          row.append(cell);
        }
        fragment.append(row);
      }
    });
    body.replaceChildren(fragment);
  } finally {
    splitter.dispose();
  }
}

let printBusy = false;
export async function printLesson({ saveFirst = false } = {}) {
  if (printBusy) return;
  printBusy = true;
  const buttons = [...document.querySelectorAll("[data-lesson-print]")];
  const priorDisabled = buttons.map(button => button.disabled);
  buttons.forEach(button => { button.disabled = true; button.setAttribute("aria-busy", "true"); });
  const status = document.getElementById("lessonPrintStatus");
  if (status) { status.textContent = "Preparing the complete lesson for printing…"; status.dataset.tone = ""; }
  try {
    if (saveFirst && !await window.saveLessonPlan()) {
      if (status) status.textContent = "The lesson was not saved. Review the save message, then try again.";
      return;
    }
    if (!await window.buildDocumentLayout()) {
      if (status) status.textContent = "Generate or load a lesson plan before printing.";
      return;
    }
    buildContinuousLessonRows(window.currentPlan, window.currentWeeklyOverview);
    await document.fonts?.ready;
    const header = document.getElementById("printHeaderImage");
    if (header?.getAttribute("src") && !header.complete) {
      await Promise.race([
        new Promise(resolve => {
          header.addEventListener("load", resolve, { once: true });
          header.addEventListener("error", resolve, { once: true });
        }),
        new Promise(resolve => setTimeout(resolve, 2000)),
      ]);
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (status) status.textContent = "Print layout ready. Choose A4, Landscape and 100% scale; turn off browser headers and footers.";
    window.print();
  } catch (error) {
    if (status) { status.textContent = error?.message || "The print layout could not be prepared. Your lesson content is still available; try again."; status.dataset.tone = "error"; }
    else alert("The print layout could not be prepared. Your lesson content is still available; try again.");
  } finally {
    printBusy = false;
    buttons.forEach((button, index) => { button.disabled = priorDisabled[index]; button.removeAttribute("aria-busy"); });
  }
}
