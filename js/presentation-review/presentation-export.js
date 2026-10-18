/** Editable slides, lesson provenance and safe slide export: presentation export. */
window.exportToPPTX = async function () {
  if (
    !window.currentPresentationDeck ||
    window.currentPresentationDeck.length === 0
  ) {
    alert("No slides to export. Generate or add slides first.");
    return;
  }

  const exportBtn = document.querySelector('button[onclick="exportToPPTX()"]');
  if(!exportBtn)return alert("Export is unavailable.");
  const originalText = exportBtn.innerText;
  exportBtn.innerText = "⏳ Compiling PPTX...";
  exportBtn.disabled = true;

  if (typeof window.showSubtleLoader === "function") {
    window.showSubtleLoader("Compiling presentation file...");
  }

  try {
    let pptx=new PptxGenJS();
    pptx.layout="LAYOUT_16x9";
    const visible=window.currentPresentationDeck.filter(item=>!item.hidden);
    if(!visible.length)throw Error("All slides are hidden.");
    const overflows=visible.filter(slide=>[slide.content,slide.contentLeft,slide.contentRight].join(" ").replace(/<[^>]*>/g,"").length>1700);
    if(overflows.length&&!confirm(overflows.length+" slide(s) may overflow in PowerPoint. Export anyway?"))return;

    const bgBase64 = localStorage.getItem("presentation_logo");
    const lessonData = window.selectedPlanData || {};
    const subjectTitle = lessonData.subject_title || "Adminerva Presentation";
    const topic = lessonData.weekly_overview
      ? lessonData.weekly_overview.topic
      : "Lesson Topic";

    window.currentPresentationDeck.forEach((slideData) => {
      // 🚀 SKIP HIDDEN SLIDES
      if (slideData.hidden) return;

      let slide = pptx.addSlide();

      if (bgBase64 && bgBase64.length > 50) {
        slide.background = { data: bgBase64 };
      } else {
        slide.background = { color: "F8FAFC" };
      }

      if (slideData.layout !== "media") {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: 13.333,
          h: 0.6,
          fill: { color: "EFF6FF" },
        });
        slide.addText(subjectTitle.toUpperCase(), {
          x: 0.3,
          y: 0.1,
          w: 6.5,
          h: 0.25,
          fontSize: 12,
          bold: true,
          color: "1E3A8A",
          align: "left",
        });
        slide.addText(topic, {
          x: 0.3,
          y: 0.3,
          w: 6.5,
          h: 0.2,
          fontSize: 9,
          color: "6B7280",
          align: "left",
        });
      }

      if (slideData.layout === "standard") {
        let textElements = parseHtmlToPptx(slideData.content);
        slide.addText(textElements, {
          x: 0.5,
          y: 0.8,
          w: 12.33,
          h: 4.5,
          valign: "top",
        });
      } else if (slideData.layout === "split") {
        let leftElements = parseHtmlToPptx(slideData.contentLeft);
        let rightElements = parseHtmlToPptx(slideData.contentRight);

        slide.addText(leftElements, {
          x: 0.5,
          y: 0.8,
          w: 5.85,
          h: 4.5,
          valign: "top",
        });
        slide.addText(rightElements, {
          x: 6.95,
          y: 0.8,
          w: 5.85,
          h: 4.5,
          valign: "top",
        });
      } else if (slideData.layout === "media") {
        if (slideData.mediaUrl) {
          slide.addImage({
            data: slideData.mediaUrl,
            x: 0.2,
            y: 0.2,
            w: 12.65,
            h: 7.05,
            sizing: { type: "contain" },
          });
        } else {
          slide.addText("No Media Uploaded", {
            x: 0,
            y: 3.1,
            w: 13.333,
            h: 1.4,
            align: "center",
            fontSize: 24,
            color: "999999",
          });
        }
      }
    });

    const fileName = `${subjectTitle.replace(/[^a-z0-9]/gi, "_")}_Presentation.pptx`;
    await pptx.writeFile({ fileName: fileName });
  } catch (error) {
    console.error("PPTX Export Error:", error);
    alert("Failed to export PPTX: " + error.message);
  } finally {
    exportBtn.innerText=originalText;
    exportBtn.disabled=false;
    if(typeof window.hideSubtleLoader==="function")window.hideSubtleLoader();
  }
};

// ==================================================
// 🚀 BUG FIX: HTML TO PPTX PARSER (Using textContent)
// ==================================================
function parseHtmlToPptx(htmlString) {
  if (!htmlString) return [{ text: "" }];

  let tempDiv = document.createElement("div");
  tempDiv.innerHTML=window.sanitizePresentationHtml?.(htmlString)??"";
  let pptxTextArray = [];

  Array.from(tempDiv.children).forEach((node) => {
    // 🚀 CRITICAL FIX: Use textContent instead of innerText for unattached DOM elements
    let text = node.textContent || "";
    if (!text.trim() && node.nodeName !== "BR") return;

    let fontSize = 18;
    let isBold = false;

    if (node.classList.contains("ql-size-huge") || node.nodeName === "H1") {
      fontSize = 32;
      isBold = true;
    } else if (
      node.classList.contains("ql-size-large") ||
      node.nodeName === "H2"
    ) {
      fontSize = 24;
      isBold = true;
    } else if (node.classList.contains("ql-size-small")) {
      fontSize = 12;
    }

    if (node.querySelector("strong") || node.querySelector("b")) isBold = true;

    if (node.nodeName === "UL" || node.nodeName === "OL") {
      Array.from(node.children).forEach((li) => {
        let liSize = 18;
        let liBold = !!(li.querySelector("strong") || li.querySelector("b"));

        if (li.classList.contains("ql-size-huge")) {
          liSize = 32;
          liBold = true;
        } else if (li.classList.contains("ql-size-large")) {
          liSize = 24;
          liBold = true;
        } else if (li.classList.contains("ql-size-small")) {
          liSize = 12;
        }

        pptxTextArray.push({
          text: li.textContent,
          options: {
            fontSize: liSize,
            bold: liBold,
            bullet: true,
            breakLine: true,
            color: "333333",
          },
        });
      });
    } else {
      pptxTextArray.push({
        text: text,
        options: {
          fontSize: fontSize,
          bold: isBold,
          breakLine: true,
          color: "333333",
        },
      });
    }
  });

  if (pptxTextArray.length === 0) {
    pptxTextArray.push({
      text: tempDiv.textContent,
      options: { fontSize: 18, color: "333333" },
    });
  }

  return pptxTextArray;
}
