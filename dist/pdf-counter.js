import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';

const pdfWorkerUrl = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const pdfCMapUrl = new URL('./vendor/pdfjs/cmaps/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const $ = (id) => document.getElementById(id);
const numberFormatter = new Intl.NumberFormat('ko-KR');
let activeRun = 0;
let latestResult = null;

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function setProgress(value, message) {
  $('pdfProgressBar').style.width = `${Math.max(0, Math.min(100, value))}%`;
  $('pdfStatusText').textContent = message;
}

function showError(message) {
  $('pdfError').textContent = message;
  $('pdfError').hidden = false;
  $('pdfResults').hidden = true;
}

function clearError() {
  $('pdfError').hidden = true;
  $('pdfError').textContent = '';
}

function resetCounter() {
  activeRun += 1;
  latestResult = null;
  $('pdfFileInput').value = '';
  $('pdfDropZone').hidden = false;
  $('pdfProgress').hidden = true;
  $('pdfResults').hidden = true;
  clearError();
  setProgress(0, '파일을 준비하고 있어요.');
}

function normalizePageText(items) {
  let text = '';
  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue;
    text += item.str;
    text += item.hasEOL ? '\n' : ' ';
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countText(text, pages) {
  const characters = Array.from(text);
  const withoutSpaces = characters.filter((character) => !/\s/u.test(character)).length;
  const withSpaces = characters.length;
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return {
    withoutSpaces,
    withSpaces,
    words,
    pages,
    manuscriptSheets: Math.ceil(withoutSpaces / 200),
    text
  };
}

function renderResult(result) {
  $('countNoSpaces').textContent = numberFormatter.format(result.withoutSpaces);
  $('countWithSpaces').textContent = numberFormatter.format(result.withSpaces);
  $('countWords').textContent = numberFormatter.format(result.words);
  $('countPages').textContent = numberFormatter.format(result.pages);
  $('countSheets').textContent = `${numberFormatter.format(result.manuscriptSheets)}매`;
  $('pdfTextPreview').textContent = result.text.length > 5000
    ? `${result.text.slice(0, 5000)}\n\n… 미리보기는 5,000자까지 표시됩니다.`
    : result.text;
  $('pdfResults').hidden = false;
}

async function processPdf(file) {
  const runId = ++activeRun;
  latestResult = null;
  clearError();
  $('pdfResults').hidden = true;

  if (!file || (file.type && file.type !== 'application/pdf') || !file.name.toLowerCase().endsWith('.pdf')) {
    showError('PDF 파일만 선택할 수 있어요.');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showError('200MB보다 작은 PDF를 선택해 주세요.');
    return;
  }

  $('pdfDropZone').hidden = true;
  $('pdfProgress').hidden = false;
  $('pdfFileName').textContent = file.name;
  $('pdfFileMeta').textContent = `${formatBytes(file.size)} · 이 기기에서만 처리`;
  setProgress(3, 'PDF를 열고 있어요.');

  try {
    const data = new Uint8Array(await file.arrayBuffer());
    if (runId !== activeRun) return;
    const loadingTask = pdfjsLib.getDocument({
      data,
      cMapUrl: pdfCMapUrl,
      cMapPacked: true,
      useWorkerFetch: true
    });
    const pdf = await loadingTask.promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      if (runId !== activeRun) {
        await loadingTask.destroy();
        return;
      }
      setProgress(5 + (pageNumber / pdf.numPages) * 88, `${pdf.numPages}쪽 중 ${pageNumber}쪽의 글자를 읽고 있어요.`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      pages.push(normalizePageText(content.items));
      page.cleanup();
    }

    if (runId !== activeRun) return;
    const extractedText = pages.join('\n\n').trim();
    const result = countText(extractedText, pdf.numPages);
    await loadingTask.destroy();

    if (!result.withoutSpaces) {
      setProgress(100, '텍스트를 찾지 못했어요.');
      showError('이 PDF에서 읽을 수 있는 텍스트를 찾지 못했어요. 스캔 이미지로 된 PDF는 OCR 기능이 필요합니다.');
      return;
    }

    latestResult = result;
    renderResult(result);
    setProgress(100, `${pdf.numPages}쪽 분석을 마쳤어요. 결과는 이 탭에만 남아 있습니다.`);
  } catch (error) {
    if (runId !== activeRun) return;
    const message = error?.name === 'PasswordException'
      ? '암호가 있는 PDF는 읽을 수 없어요. 암호 보호를 풀고 다시 시도해 주세요.'
      : 'PDF를 읽는 중 문제가 생겼어요. 파일이 손상되지 않았는지 확인해 주세요.';
    setProgress(0, '분석을 완료하지 못했어요.');
    showError(message);
    console.error('Local PDF analysis failed:', error);
  }
}

async function copyResult() {
  if (!latestResult) return;
  const summary = [
    'PDF 글자 수 계산 결과',
    `공백 제외: ${numberFormatter.format(latestResult.withoutSpaces)}글자`,
    `공백 포함: ${numberFormatter.format(latestResult.withSpaces)}글자`,
    `어절: ${numberFormatter.format(latestResult.words)}개`,
    `페이지: ${numberFormatter.format(latestResult.pages)}쪽`,
    `200자 원고지: 약 ${numberFormatter.format(latestResult.manuscriptSheets)}매`
  ].join('\n');

  try {
    await navigator.clipboard.writeText(summary);
    const button = $('copyResultButton');
    button.textContent = '복사했어요';
    setTimeout(() => { button.textContent = '결과 복사'; }, 1800);
  } catch (error) {
    showError('브라우저가 클립보드 복사를 허용하지 않았어요.');
  }
}

const dropZone = $('pdfDropZone');
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    $('pdfFileInput').click();
  }
});
$('pdfFileInput').addEventListener('change', (event) => processPdf(event.target.files?.[0]));
['dragenter', 'dragover'].forEach((type) => dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.add('is-dragging');
}));
['dragleave', 'drop'].forEach((type) => dropZone.addEventListener(type, (event) => {
  event.preventDefault();
  dropZone.classList.remove('is-dragging');
}));
dropZone.addEventListener('drop', (event) => processPdf(event.dataTransfer?.files?.[0]));
$('clearPdfButton').addEventListener('click', resetCounter);
$('copyResultButton').addEventListener('click', copyResult);
