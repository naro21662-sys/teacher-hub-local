import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import Tesseract from './vendor/tesseract/tesseract.esm.min.js';
import { CATEGORY_LABELS, redactText } from './redaction-core.js';

const pdfWorkerUrl = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const pdfCMapUrl = new URL('./vendor/pdfjs/cmaps/', import.meta.url).href;
const ocrWorkerUrl = new URL('./vendor/tesseract/worker.min.js', import.meta.url).href;
const ocrCoreUrl = new URL('./vendor/tesseract/core/', import.meta.url).href;
const ocrLangUrl = new URL('./vendor/tesseract/lang/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
const { createWorker } = Tesseract;

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_PAGES = 40;
const MIN_PAGE_TEXT = 40;
const $ = (id) => document.getElementById(id);
let activeRun = 0;
let extractedText = '';
let ocrWorker = null;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function setProgress(value, message) {
  $('redactProgressBar').style.width = `${Math.max(0, Math.min(100, value))}%`;
  $('redactStatusText').textContent = message;
}

function showError(message) {
  $('redactError').textContent = message;
  $('redactError').hidden = false;
}

function clearError() {
  $('redactError').hidden = true;
  $('redactError').textContent = '';
}

function normalizePageText(items) {
  let text = '';
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    text += item.str;
    text += item.hasEOL ? '\n' : ' ';
  }
  return normalizeText(text);
}

function normalizeText(text) {
  return text
    .replace(/(?:[가-힣]\s+){2,}[가-힣]{1,4}/gu, (segment) => segment.replace(/\s+/gu, ''))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderFindings(detections) {
  const counts = new Map();
  detections.forEach((item) => counts.set(item.category, (counts.get(item.category) || 0) + 1));
  $('findingTotal').textContent = `${detections.length}개`;
  const summary = $('findingSummary');
  summary.replaceChildren();
  [...counts.entries()].forEach(([category, count]) => {
    const chip = document.createElement('span');
    chip.className = 'finding-chip';
    chip.textContent = `${CATEGORY_LABELS[category]} ${count}`;
    summary.append(chip);
  });

  const list = $('findingList');
  list.replaceChildren();
  if (!detections.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-findings';
    empty.textContent = '자동으로 찾은 항목이 없습니다. 개인정보가 없다는 뜻은 아닙니다. 이름과 학번을 직접 입력하고 복사본을 꼼꼼히 확인해 주세요.';
    list.append(empty);
    return;
  }
  detections.slice(0, 120).forEach((item) => {
    const row = document.createElement('div');
    row.className = 'finding-item';
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = CATEGORY_LABELS[item.category];
    const found = document.createElement('span');
    found.className = 'found-value';
    found.textContent = item.value.replace(/\s+/gu, ' ');
    const replacement = document.createElement('span');
    replacement.className = 'replacement';
    replacement.textContent = `→ ${item.replacement}`;
    row.append(kind, found, replacement);
    list.append(row);
  });
  if (detections.length > 120) {
    const more = document.createElement('p');
    more.className = 'empty-findings';
    more.textContent = `화면에는 앞의 120개만 표시했습니다. 복사본에는 ${detections.length}개가 모두 반영되었습니다.`;
    list.append(more);
  }
}

function applyRedaction() {
  if (!extractedText) return;
  const customTerms = $('customTerms').value
    .split(/[\n,]/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const result = redactText(extractedText, {
    studentName: $('studentName').value,
    studentNumber: $('studentNumber').value,
    customTerms
  });
  $('sourceText').value = extractedText;
  $('redactedText').value = result.text;
  renderFindings(result.detections);
  $('reviewConfirmed').checked = false;
  $('copyRedactedButton').disabled = true;
}

async function ensureOcrWorker() {
  if (ocrWorker) return ocrWorker;
  ocrWorker = await createWorker('kor', 1, {
    workerPath: ocrWorkerUrl,
    corePath: ocrCoreUrl,
    langPath: ocrLangUrl,
    gzip: true,
    logger: (message) => {
      if (message.status === 'recognizing text') {
        const percent = Math.round((message.progress || 0) * 100);
        $('redactStatusText').textContent = `스캔 글자를 인식하고 있어요 · ${percent}%`;
      }
    }
  });
  return ocrWorker;
}

async function ocrPage(page) {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  const worker = await ensureOcrWorker();
  const result = await worker.recognize(canvas);
  canvas.width = 1;
  canvas.height = 1;
  return normalizeText(result.data.text || '');
}

async function processPdf(file) {
  const runId = ++activeRun;
  clearError();
  $('redactEditor').hidden = true;

  if (!file || (file.type && file.type !== 'application/pdf') || !file.name.toLowerCase().endsWith('.pdf')) {
    showError('PDF 파일만 선택할 수 있어요.');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError('50MB보다 작은 PDF를 선택해 주세요.');
    return;
  }

  $('redactDropZone').hidden = true;
  $('redactProgress').hidden = false;
  $('redactFileName').textContent = file.name;
  $('redactFileMeta').textContent = `${formatBytes(file.size)} · 파일명과 내용 모두 전송하지 않음`;
  setProgress(3, 'PDF를 이 브라우저에서 열고 있어요.');

  let loadingTask;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (runId !== activeRun) return;
    loadingTask = pdfjsLib.getDocument({ data, cMapUrl: pdfCMapUrl, cMapPacked: true, useWorkerFetch: true });
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PAGES) {
      throw new Error('too-many-pages');
    }

    const pages = [];
    let ocrPages = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (runId !== activeRun) return;
      const page = await pdf.getPage(pageNumber);
      setProgress(5 + (pageNumber - 1) / pdf.numPages * 86, `${pdf.numPages}쪽 중 ${pageNumber}쪽을 확인하고 있어요.`);
      const content = await page.getTextContent({ disableNormalization: false });
      let pageText = normalizePageText(content.items);
      const compactLength = pageText.replace(/\s/gu, '').length;
      if (compactLength < MIN_PAGE_TEXT) {
        ocrPages += 1;
        setProgress(5 + (pageNumber - 0.7) / pdf.numPages * 86, `${pageNumber}쪽은 스캔 문서예요. 한국어 OCR을 실행합니다.`);
        pageText = await ocrPage(page);
      }
      pages.push(pageText);
      page.cleanup();
    }

    if (runId !== activeRun) return;
    extractedText = normalizeText(pages.join('\n\n'));
    await loadingTask.destroy();
    loadingTask = null;
    if (!extractedText.replace(/\s/gu, '')) throw new Error('no-text');

    $('redactEditor').hidden = false;
    applyRedaction();
    setProgress(100, ocrPages
      ? `${pdf.numPages}쪽 처리를 마쳤어요. ${ocrPages}쪽은 로컬 OCR로 읽었습니다.`
      : `${pdf.numPages}쪽의 내장 텍스트를 읽었습니다. OCR은 필요하지 않았어요.`);
    $('redactEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    if (runId !== activeRun) return;
    if (loadingTask) await loadingTask.destroy().catch(() => {});
    const message = error?.name === 'PasswordException'
      ? '암호가 있는 PDF는 읽을 수 없어요. 암호 보호를 풀고 다시 시도해 주세요.'
      : error?.message === 'too-many-pages'
        ? `브라우저 메모리를 보호하기 위해 ${MAX_PAGES}쪽 이하 PDF만 처리할 수 있어요.`
        : error?.message === 'no-text'
          ? '글자를 인식하지 못했어요. 해상도가 더 높은 PDF로 다시 시도해 주세요.'
          : 'PDF를 읽는 중 문제가 생겼어요. 파일이 손상되지 않았는지 확인해 주세요.';
    setProgress(0, '처리를 완료하지 못했어요.');
    showError(message);
    console.error('Local redaction failed:', error);
  }
}

function resetRedactor() {
  activeRun += 1;
  extractedText = '';
  $('redactFileInput').value = '';
  $('studentName').value = '';
  $('studentNumber').value = '';
  $('customTerms').value = '';
  $('sourceText').value = '';
  $('redactedText').value = '';
  $('reviewConfirmed').checked = false;
  $('copyRedactedButton').disabled = true;
  $('redactDropZone').hidden = false;
  $('redactProgress').hidden = true;
  $('redactEditor').hidden = true;
  clearError();
  setProgress(0, '파일을 준비하고 있어요.');
}

async function copyRedactedText() {
  const value = $('redactedText').value.trim();
  if (!value || !$('reviewConfirmed').checked) return;
  try {
    await navigator.clipboard.writeText(value);
    const button = $('copyRedactedButton');
    button.textContent = '복사했어요';
    setTimeout(() => { button.textContent = '검토한 복사본 복사'; }, 1800);
  } catch (error) {
    showError('브라우저가 클립보드 복사를 허용하지 않았어요. 복사본 영역에서 직접 선택해 복사해 주세요.');
  }
}

const dropZone = $('redactDropZone');
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    $('redactFileInput').click();
  }
});
$('redactFileInput').addEventListener('change', (event) => processPdf(event.target.files?.[0]));
['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.add('is-dragging');
}));
['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
}));
dropZone.addEventListener('drop', (event) => processPdf(event.dataTransfer?.files?.[0]));
$('clearRedactButton').addEventListener('click', resetRedactor);
$('applyRedactionButton').addEventListener('click', applyRedaction);
$('redactedText').addEventListener('input', () => {
  $('reviewConfirmed').checked = false;
  $('copyRedactedButton').disabled = true;
});
$('reviewConfirmed').addEventListener('change', (event) => {
  $('copyRedactedButton').disabled = !event.target.checked || !$('redactedText').value.trim();
});
$('copyRedactedButton').addEventListener('click', copyRedactedText);
window.addEventListener('pagehide', () => {
  if (ocrWorker) ocrWorker.terminate().catch(() => {});
});

