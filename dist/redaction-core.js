export const CATEGORY_LABELS = {
  student: '학생 식별정보',
  school: '학교·교육기관',
  region: '지역·주소',
  date: '날짜·시점',
  activity: '대회·외부활동',
  person: '교직원·관계자',
  contact: '연락처·계정',
  custom: '직접 지정'
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addPatternMatches(text, detections, pattern, category, replacement, priority = 10) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[0];
    if (!value.trim()) continue;
    detections.push({ start: match.index, end: match.index + value.length, value, category, replacement, priority });
    if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
  }
}

function resolveOverlaps(detections) {
  const ranked = [...detections].sort((a, b) => b.priority - a.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  ranked.forEach((candidate) => {
    const overlaps = accepted.some((item) => candidate.start < item.end && candidate.end > item.start);
    if (!overlaps) accepted.push(candidate);
  });
  return accepted.sort((a, b) => a.start - b.start);
}

export function detectSensitiveText(text, options = {}) {
  const detections = [];
  const studentName = String(options.studentName || '').trim();
  const studentNumber = String(options.studentNumber || '').trim();
  const customTerms = Array.isArray(options.customTerms)
    ? options.customTerms.map((value) => String(value).trim()).filter((value) => value.length >= 2)
    : [];

  if (studentName) addPatternMatches(text, detections, new RegExp(escapeRegExp(studentName), 'gu'), 'student', '[학생]', 100);
  if (studentNumber) addPatternMatches(text, detections, new RegExp(escapeRegExp(studentNumber), 'gu'), 'student', '[학번]', 100);
  customTerms.forEach((term) => addPatternMatches(text, detections, new RegExp(escapeRegExp(term), 'gu'), 'custom', '[비식별]', 95));

  const patterns = [
    [/\b(?:01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}\b/gu, 'contact', '[연락처]', 90],
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, 'contact', '[이메일]', 90],
    [/(?:성명|이름|학생명|대상자)\s*[:：]?\s*[가-힣]{2,4}/gu, 'student', '[학생]', 85],
    [/(?:학번|학생번호)\s*[:：]?\s*\d{4,14}/gu, 'student', '[학번]', 85],
    [/\b\d{7,14}\b/gu, 'student', '[식별번호]', 65],
    [/\d{1,2}\s*학년\s*\d{1,2}\s*반(?:\s*\d{1,2}\s*번)?/gu, 'student', '[학급정보]', 75],
    [/[가-힣A-Za-z0-9·]{2,24}(?:초등학교|중학교|고등학교)/gu, 'school', '[학교]', 80],
    [/[가-힣A-Za-z0-9·]{2,24}(?:교육지원청|교육청)/gu, 'school', '[교육기관]', 80],
    [/[가-힣A-Za-z0-9·]{2,24}(?:대학교|대학|연구원|연구소|협회)/gu, 'school', '[외부기관]', 70],
    [/(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)/gu, 'region', '[지역]', 75],
    [/(?:주소|거주지|소재지)\s*[:：]?\s*[^\n]{2,60}/gu, 'region', '[주소]', 78],
    [/(?:19|20)\d{2}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?/gu, 'date', '[날짜]', 72],
    [/\d{1,2}\s*월\s*\d{1,2}\s*일/gu, 'date', '[날짜]', 68],
    [/[가-힣A-Za-z0-9·]{2,28}(?:경진대회|대회|공모전|발표회|페스티벌)/gu, 'activity', '[외부활동]', 74],
    [/(?:담임|지도교사|교사|교장|교감|강사)\s*[:：]?\s*[가-힣]{2,4}/gu, 'person', '[교직원]', 76]
  ];
  patterns.forEach(([pattern, category, replacement, priority]) => {
    addPatternMatches(text, detections, pattern, category, replacement, priority);
  });
  return resolveOverlaps(detections);
}

export function redactText(text, options = {}) {
  const detections = detectSensitiveText(text, options);
  let result = '';
  let cursor = 0;
  detections.forEach((item) => {
    result += text.slice(cursor, item.start);
    result += item.replacement;
    cursor = item.end;
  });
  return { text: result + text.slice(cursor), detections };
}

