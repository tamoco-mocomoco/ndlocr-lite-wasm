import type { WorkerResponse } from "./worker/ocr.worker";
import type { Detection } from "./engine/deim";
import type { Element } from "./parser/ndl-parser";
import { MODEL_PRESETS, DEFAULT_PRESET_ID } from "./config/model-config";
import { computeHomography, applyPerspective } from "./engine/perspective";
import type { Point } from "./engine/perspective";

// DOM elements
const dropZone = document.getElementById("drop-zone")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const progressSection = document.getElementById("progress-section")!;
const progressLabel = document.getElementById("progress-label")!;
const progressBar = document.getElementById("progress-bar")!;
const resultSection = document.getElementById("result-section")!;
const resultCanvas = document.getElementById("result-canvas") as HTMLCanvasElement;
const textOutput = document.getElementById("text-output")!;
const structOutput = document.getElementById("struct-output")!;
const copyBtn = document.getElementById("copy-btn")!;
const presetSelect = document.getElementById("model-preset") as HTMLSelectElement;
const modelDesc = document.getElementById("model-desc")!;
const tabButtons = document.querySelectorAll<HTMLButtonElement>(".tab-bar button");
const tabContents = document.querySelectorAll<HTMLElement>(".tab-content");

// Edit mode DOM elements
const editSection = document.getElementById("edit-section")!;
const srcCanvas = document.getElementById("src-canvas") as HTMLCanvasElement;
const previewCanvas = document.getElementById("preview-canvas") as HTMLCanvasElement;
const btnCorrectOcr = document.getElementById("btn-correct-ocr")!;
const btnDirectOcr = document.getElementById("btn-direct-ocr")!;

// Colors for detection classes
const CLASS_COLORS = [
  "#000000", "#FF0000", "#00008E", "#0000E6", "#6A00E4",
  "#003C64", "#005064", "#000046", "#0000C0", "#FAAA1E",
  "#64AA1E", "#DCDC00", "#AF74AF", "#FA001E", "#A52A2A",
  "#FF4DFF", "#FF0000",
];

// Tab switching
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab!;
    tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === target));
    tabContents.forEach((c) => c.classList.toggle("active", c.id === `${target}-output`));
  });
});

// Model selector setup
for (const preset of MODEL_PRESETS) {
  const opt = document.createElement("option");
  opt.value = preset.id;
  opt.textContent = preset.label;
  presetSelect.appendChild(opt);
}
presetSelect.value = DEFAULT_PRESET_ID;
modelDesc.textContent = MODEL_PRESETS.find((p) => p.id === DEFAULT_PRESET_ID)?.description ?? "";

presetSelect.addEventListener("change", () => {
  const preset = MODEL_PRESETS.find((p) => p.id === presetSelect.value);
  modelDesc.textContent = preset?.description ?? "";
  // Worker will be reinitialized on next run
  if (worker) {
    worker.terminate();
    worker = null;
  }
});

let worker: Worker | null = null;

function createWorker(): Worker {
  const w = new Worker(new URL("./worker/ocr.worker.ts", import.meta.url), {
    type: "module",
  });
  return w;
}

function showProgress(label: string, pct: number): void {
  progressSection.style.display = "block";
  progressLabel.textContent = label;
  progressBar.style.width = `${Math.round(pct * 100)}%`;
}

function hideProgress(): void {
  progressSection.style.display = "none";
}

function drawDetections(
  img: HTMLImageElement,
  detections: Detection[],
): void {
  resultCanvas.width = img.naturalWidth;
  resultCanvas.height = img.naturalHeight;
  const ctx = resultCanvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  for (const det of detections) {
    const [x1, y1, x2, y2] = det.box;
    const color = CLASS_COLORS[det.classIndex] ?? "#FF0000";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, Math.round(img.naturalWidth / 500));
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
}

// ---- Structured view rendering ----

function renderStructuredView(page: Element): void {
  structOutput.innerHTML = "";

  for (const child of page.children) {
    if (child.tag === "TEXTBLOCK") {
      structOutput.appendChild(renderBlock("本文ブロック", "TEXTBLOCK", child.children));
    } else if (child.tag === "BLOCK") {
      const blockType = child.attrs.TYPE ?? "ブロック";
      structOutput.appendChild(renderBlock(blockType, "BLOCK", child.children));
    } else if (child.tag === "LINE") {
      // 独立行
      structOutput.appendChild(renderBlock("独立行", "LINE", [child]));
    }
  }
}

function renderBlock(label: string, tag: string, children: Element[]): HTMLElement {
  const block = document.createElement("div");
  block.className = "struct-block";

  const header = document.createElement("div");
  header.className = "struct-block-header";

  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;

  const tagSpan = document.createElement("span");
  tagSpan.className = "tag";
  tagSpan.textContent = tag;

  const copyBtnEl = document.createElement("button");
  copyBtnEl.className = "block-copy-btn";
  copyBtnEl.textContent = "全てコピー \u{1F4CB}";
  copyBtnEl.addEventListener("click", () => {
    const lines = collectLines(children);
    const text = lines.map((l) => l.attrs.STRING ?? "").join("\n");
    navigator.clipboard.writeText(text).then(() => {
      copyBtnEl.textContent = "コピー済 \u2713";
      setTimeout(() => { copyBtnEl.textContent = "全てコピー \u{1F4CB}"; }, 1500);
    });
  });

  header.appendChild(labelSpan);
  header.appendChild(tagSpan);
  header.appendChild(copyBtnEl);
  block.appendChild(header);

  // LINE 要素を再帰的に収集
  const lines = collectLines(children);
  for (const line of lines) {
    const lineDiv = document.createElement("div");
    lineDiv.className = "struct-line";

    const typeSpan = document.createElement("span");
    typeSpan.className = "line-type";
    typeSpan.textContent = `[${line.attrs.TYPE ?? ""}]`;

    const textSpan = document.createElement("span");
    textSpan.className = "line-text";
    textSpan.textContent = line.attrs.STRING ?? "";

    const lineCopyBtn = document.createElement("button");
    lineCopyBtn.className = "line-copy-btn";
    lineCopyBtn.textContent = "\u{1F4CB}";
    const lineText = line.attrs.STRING ?? "";
    lineCopyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(lineText).then(() => {
        lineCopyBtn.textContent = "\u2713";
        setTimeout(() => { lineCopyBtn.textContent = "\u{1F4CB}"; }, 1500);
      });
    });

    lineDiv.appendChild(typeSpan);
    lineDiv.appendChild(textSpan);
    lineDiv.appendChild(lineCopyBtn);
    block.appendChild(lineDiv);
  }

  return block;
}

function collectLines(elements: Element[]): Element[] {
  const result: Element[] = [];
  for (const el of elements) {
    if (el.tag === "LINE") {
      result.push(el);
    } else {
      result.push(...collectLines(el.children));
    }
  }
  return result;
}

// ---- Edit mode (perspective correction) ----

// State for the 4-point editor
let editImg: HTMLImageElement | null = null;
let editFile: File | null = null;
let editImgUrl: string | null = null;
// 4 corners in image coordinates: top-left, top-right, bottom-right, bottom-left
let corners: Point[] = [];
let draggingIndex = -1;
let isDragging = false;
// Scale factor: canvas display size vs. image natural size
let displayScale = 1;

const HANDLE_RADIUS = 8;
const GRAB_RADIUS = 20; // larger grab area for touch

function enterEditMode(img: HTMLImageElement, file: File, imgUrl: string): void {
  editImg = img;
  editFile = file;
  editImgUrl = imgUrl;

  const w = img.naturalWidth;
  const h = img.naturalHeight;

  // Initial corners: 10% margin inset
  const m = 0.1;
  corners = [
    { x: w * m, y: h * m },         // top-left
    { x: w * (1 - m), y: h * m },   // top-right
    { x: w * (1 - m), y: h * (1 - m) }, // bottom-right
    { x: w * m, y: h * (1 - m) },   // bottom-left
  ];

  // Set canvas sizes to image natural size
  srcCanvas.width = w;
  srcCanvas.height = h;

  // Show edit section, hide result section
  editSection.classList.add("visible");
  resultSection.classList.remove("visible");

  // Compute display scale (CSS max-width:100% scales it down)
  updateDisplayScale();

  drawSrcCanvas();
  updatePreview();
}

function updateDisplayScale(): void {
  // After the canvas is displayed, get its CSS rendered width
  const cssWidth = srcCanvas.getBoundingClientRect().width;
  displayScale = cssWidth / srcCanvas.width;
}

function drawSrcCanvas(): void {
  if (!editImg) return;
  const ctx = srcCanvas.getContext("2d")!;
  const w = srcCanvas.width;
  const h = srcCanvas.height;

  // Draw image
  ctx.drawImage(editImg, 0, 0);

  // Draw dark overlay outside the quad
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
  ctx.beginPath();
  // Outer rectangle (full canvas)
  ctx.rect(0, 0, w, h);
  // Inner quad (counter-clockwise to cut out)
  ctx.moveTo(corners[0].x, corners[0].y);
  ctx.lineTo(corners[3].x, corners[3].y);
  ctx.lineTo(corners[2].x, corners[2].y);
  ctx.lineTo(corners[1].x, corners[1].y);
  ctx.closePath();
  ctx.fill("evenodd");
  ctx.restore();

  // Draw quad lines
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = Math.max(2, Math.round(w / 400));
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  // Draw handles
  for (const pt of corners) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, HANDLE_RADIUS / displayScale, 0, Math.PI * 2);
    ctx.fillStyle = "#3b82f6";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2 / displayScale;
    ctx.stroke();
  }
}

function updatePreview(lowRes = false): void {
  if (!editImg) return;

  // Compute output size from destination rectangle
  const dstW = Math.round(
    Math.max(
      dist(corners[0], corners[1]),
      dist(corners[3], corners[2]),
    ),
  );
  const dstH = Math.round(
    Math.max(
      dist(corners[0], corners[3]),
      dist(corners[1], corners[2]),
    ),
  );
  if (dstW <= 0 || dstH <= 0) return;

  // Destination corners: rectangle
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: dstW, y: 0 },
    { x: dstW, y: dstH },
    { x: 0, y: dstH },
  ];

  // Get source image data
  const scale = lowRes ? 0.25 : 1;
  const sw = Math.round(editImg.naturalWidth * scale);
  const sh = Math.round(editImg.naturalHeight * scale);
  const ow = Math.round(dstW * scale);
  const oh = Math.round(dstH * scale);
  if (sw <= 0 || sh <= 0 || ow <= 0 || oh <= 0) return;

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = sw;
  tmpCanvas.height = sh;
  const tmpCtx = tmpCanvas.getContext("2d")!;
  tmpCtx.drawImage(editImg, 0, 0, sw, sh);
  const srcData = tmpCtx.getImageData(0, 0, sw, sh);

  // Scale corners for low-res
  const scaledCorners = corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const scaledDst = dst.map((p) => ({ x: p.x * scale, y: p.y * scale }));

  const matrix = computeHomography(scaledCorners, scaledDst);
  const result = applyPerspective(srcData, matrix, ow, oh);

  previewCanvas.width = ow;
  previewCanvas.height = oh;
  const pCtx = previewCanvas.getContext("2d")!;
  pCtx.putImageData(result, 0, 0);
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function canvasToImage(e: MouseEvent | Touch): Point {
  const rect = srcCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / displayScale,
    y: (e.clientY - rect.top) / displayScale,
  };
}

function findNearestCorner(pt: Point): number {
  const threshold = GRAB_RADIUS / displayScale;
  let minDist = Infinity;
  let minIdx = -1;
  for (let i = 0; i < corners.length; i++) {
    const d = dist(pt, corners[i]);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  return minDist <= threshold ? minIdx : -1;
}

// Mouse events
srcCanvas.addEventListener("mousedown", (e) => {
  updateDisplayScale();
  const pt = canvasToImage(e);
  draggingIndex = findNearestCorner(pt);
  if (draggingIndex >= 0) isDragging = true;
});

srcCanvas.addEventListener("mousemove", (e) => {
  if (!isDragging || draggingIndex < 0) return;
  const pt = canvasToImage(e);
  corners[draggingIndex] = {
    x: Math.max(0, Math.min(pt.x, srcCanvas.width)),
    y: Math.max(0, Math.min(pt.y, srcCanvas.height)),
  };
  drawSrcCanvas();
  updatePreview(true);
});

window.addEventListener("mouseup", () => {
  if (isDragging) {
    isDragging = false;
    draggingIndex = -1;
    updatePreview(false);
  }
});

// Touch events
srcCanvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  updateDisplayScale();
  const touch = e.touches[0];
  const pt = canvasToImage(touch);
  draggingIndex = findNearestCorner(pt);
  if (draggingIndex >= 0) isDragging = true;
}, { passive: false });

srcCanvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  if (!isDragging || draggingIndex < 0) return;
  const touch = e.touches[0];
  const pt = canvasToImage(touch);
  corners[draggingIndex] = {
    x: Math.max(0, Math.min(pt.x, srcCanvas.width)),
    y: Math.max(0, Math.min(pt.y, srcCanvas.height)),
  };
  drawSrcCanvas();
  updatePreview(true);
}, { passive: false });

window.addEventListener("touchend", () => {
  if (isDragging) {
    isDragging = false;
    draggingIndex = -1;
    updatePreview(false);
  }
});

// ---- Convert corrected image to Blob ----

function correctedImageToBlob(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Full-res perspective transform
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = editImg!.naturalWidth;
    tmpCanvas.height = editImg!.naturalHeight;
    const tmpCtx = tmpCanvas.getContext("2d")!;
    tmpCtx.drawImage(editImg!, 0, 0);
    const srcData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);

    const dstW = Math.round(
      Math.max(dist(corners[0], corners[1]), dist(corners[3], corners[2])),
    );
    const dstH = Math.round(
      Math.max(dist(corners[0], corners[3]), dist(corners[1], corners[2])),
    );

    const dst: Point[] = [
      { x: 0, y: 0 },
      { x: dstW, y: 0 },
      { x: dstW, y: dstH },
      { x: 0, y: dstH },
    ];

    const matrix = computeHomography(corners, dst);
    const result = applyPerspective(srcData, matrix, dstW, dstH);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = dstW;
    outCanvas.height = dstH;
    const outCtx = outCanvas.getContext("2d")!;
    outCtx.putImageData(result, 0, 0);

    outCanvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to create blob"));
    }, "image/png");
  });
}

// ---- Main processing ----

function runOcr(imageBlob: Blob, img: HTMLImageElement, imgUrl: string): void {
  if (!worker) {
    worker = createWorker();
  }

  const presetId = presetSelect.value;

  // Hide edit section, reset result UI
  editSection.classList.remove("visible");
  resultSection.classList.remove("visible");
  textOutput.textContent = "";
  structOutput.innerHTML = "";
  presetSelect.disabled = true;
  showProgress("モデルを初期化中...", 0);

  worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    switch (msg.type) {
      case "init-progress": {
        const pct = msg.total > 0 ? Math.min(msg.loaded / msg.total, 1) : 0;
        showProgress(`${msg.model} ダウンロード中... ${Math.round(pct * 100)}%`, pct);
        break;
      }
      case "init-done":
        showProgress("検出中...", 0);
        break;
      case "detect-done":
        showProgress(`${msg.numDetections} 領域を検出。認識中...`, 0);
        break;
      case "recognize-progress": {
        const pct = msg.current / msg.total;
        showProgress(
          `認識中... ${msg.current}/${msg.total} 行`,
          pct,
        );
        break;
      }
      case "result": {
        hideProgress();
        presetSelect.disabled = false;
        // Draw detections
        drawDetections(img, msg.detections);
        // Show text
        const text = msg.lines.map((l) => l.text).join("\n");
        textOutput.textContent = text;
        // Show structured view
        renderStructuredView(msg.page);
        resultSection.classList.add("visible");
        URL.revokeObjectURL(imgUrl);
        break;
      }
      case "error":
        hideProgress();
        presetSelect.disabled = false;
        alert(`エラー: ${msg.message}`);
        URL.revokeObjectURL(imgUrl);
        break;
    }
  };

  worker.postMessage({ type: "run", imageBlob, presetId });
}

async function processFile(file: File): Promise<void> {
  // Show image preview and enter edit mode
  const imgUrl = URL.createObjectURL(file);
  const img = new Image();
  img.src = imgUrl;
  await img.decode();

  enterEditMode(img, file, imgUrl);
}

// Edit mode button handlers
btnCorrectOcr.addEventListener("click", async () => {
  if (!editImg || !editImgUrl) return;
  btnCorrectOcr.setAttribute("disabled", "true");
  btnDirectOcr.setAttribute("disabled", "true");

  try {
    const correctedBlob = await correctedImageToBlob();

    // Create an img from the corrected blob for drawing detections later
    const correctedUrl = URL.createObjectURL(correctedBlob);
    const correctedImg = new Image();
    correctedImg.src = correctedUrl;
    await correctedImg.decode();

    if (editImgUrl) URL.revokeObjectURL(editImgUrl);
    runOcr(correctedBlob, correctedImg, correctedUrl);
  } catch (err) {
    alert(`補正エラー: ${err}`);
  } finally {
    btnCorrectOcr.removeAttribute("disabled");
    btnDirectOcr.removeAttribute("disabled");
  }
});

btnDirectOcr.addEventListener("click", () => {
  if (!editFile || !editImg || !editImgUrl) return;
  runOcr(editFile, editImg, editImgUrl);
});

// Event handlers
dropZone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) processFile(file);
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("dragover");
});

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer?.files[0];
  if (file && file.type.startsWith("image/")) {
    processFile(file);
  }
});

copyBtn.addEventListener("click", () => {
  const text = textOutput.textContent ?? "";
  navigator.clipboard.writeText(text).then(() => {
    copyBtn.textContent = "コピー済 \u2713";
    setTimeout(() => {
      copyBtn.textContent = "全てコピー \u{1F4CB}";
    }, 2000);
  });
});
