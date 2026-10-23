/** Print the original merged school table built by document-exporter.js. */
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
    if (status) status.textContent = "Legacy print layout ready. Choose Landscape and the paper size required by your school; enable background graphics for the blue headings and turn off browser headers and footers.";
    window.print();
  } catch (error) {
    if (status) { status.textContent = error?.message || "The print layout could not be prepared. Your lesson content is still available; try again."; status.dataset.tone = "error"; }
    else alert("The print layout could not be prepared. Your lesson content is still available; try again.");
  } finally {
    printBusy = false;
    buttons.forEach((button, index) => { button.disabled = priorDisabled[index]; button.removeAttribute("aria-busy"); });
  }
}
