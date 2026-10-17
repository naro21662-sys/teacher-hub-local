(() => {
  'use strict';

  const STORAGE_KEY = 'teacher-hub-seat-changer-v1';
  const DEFAULT_STATE = {
    className: '',
    rows: 5,
    columns: 6,
    students: [],
    seats: [],
    previousSeats: null,
    orientation: 'teacher'
  };

  const $ = (id) => document.getElementById(id);
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const cloneSeats = (seats) => seats.map((seat) => ({ ...seat }));
  let state = loadState();
  let layoutEditing = false;
  let toastTimer;

  function makeSeats(rows, columns, previous = []) {
    return Array.from({ length: rows * columns }, (_, index) => ({
      disabled: previous[index]?.disabled || false,
      studentId: previous[index]?.studentId || null,
      locked: previous[index]?.locked || false
    }));
  }

  function normalizeState(saved) {
    const next = { ...DEFAULT_STATE, ...saved };
    next.rows = clampNumber(next.rows, 2, 10, 5);
    next.columns = clampNumber(next.columns, 2, 10, 6);
    next.students = Array.isArray(next.students) ? next.students.filter((student) => student && student.id && student.name) : [];
    const validIds = new Set(next.students.map((student) => student.id));
    next.seats = makeSeats(next.rows, next.columns, Array.isArray(next.seats) ? next.seats : []);
    next.seats = next.seats.map((seat) => ({
      disabled: Boolean(seat.disabled),
      studentId: validIds.has(seat.studentId) ? seat.studentId : null,
      locked: Boolean(seat.locked && validIds.has(seat.studentId) && !seat.disabled)
    }));
    next.previousSeats = Array.isArray(next.previousSeats) ? next.previousSeats : null;
    next.orientation = next.orientation === 'student' ? 'student' : 'teacher';
    return next;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return normalizeState(raw ? JSON.parse(raw) : DEFAULT_STATE);
    } catch (error) {
      return normalizeState(DEFAULT_STATE);
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function showView(name) {
    const titles = {
      hub: '교실 도구함',
      seat: '자리 바꾸기 — 교실 도구함',
      pdf: 'PDF 글자 수 세기 — 교실 도구함',
      redact: '생활기록부 개인정보 가리기 — 교실 도구함'
    };
    $('hubView').classList.toggle('is-active', name === 'hub');
    $('seatView').classList.toggle('is-active', name === 'seat');
    $('pdfView').classList.toggle('is-active', name === 'pdf');
    $('redactView').classList.toggle('is-active', name === 'redact');
    document.title = titles[name] || titles.hub;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (name === 'seat') renderAll();
  }

  function fillSizeOptions() {
    for (let value = 2; value <= 10; value += 1) {
      const colOption = new Option(`${value}칸`, String(value));
      const rowOption = new Option(`${value}줄`, String(value));
      $('columnsSelect').add(colOption);
      $('rowsSelect').add(rowOption);
    }
  }

  function renderAll(shuffled = false) {
    $('className').value = state.className;
    $('columnsSelect').value = String(state.columns);
    $('rowsSelect').value = String(state.rows);
    $('classLabel').textContent = state.className.trim() || '우리 반';
    $('studentCount').textContent = `${state.students.length}명`;
    $('activeSeatCount').textContent = state.seats.filter((seat) => !seat.disabled).length;
    $('fixedSeatCount').textContent = state.seats.filter((seat) => seat.locked).length;
    $('undoButton').disabled = !state.previousSeats;
    renderStudents();
    renderSeats(shuffled);
    renderOrientation();
  }

  function renderStudents() {
    const list = $('studentList');
    list.replaceChildren();
    $('emptyStudents').hidden = state.students.length > 0;
    state.students.forEach((student) => {
      const item = document.createElement('li');
      const input = document.createElement('input');
      input.value = student.name;
      input.maxLength = 30;
      input.setAttribute('aria-label', `${student.name} 이름 수정`);
      input.addEventListener('change', () => renameStudent(student.id, input.value));
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
      });

      const actions = document.createElement('span');
      actions.className = 'student-actions';
      const remove = document.createElement('button');
      remove.className = 'list-button';
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `${student.name} 삭제`);
      remove.addEventListener('click', () => removeStudent(student.id));
      actions.append(remove);
      item.append(input, actions);
      list.append(item);
    });
  }

  function renderSeats(shuffled = false) {
    const grid = $('seatGrid');
    grid.replaceChildren();
    grid.style.gridTemplateColumns = `repeat(${state.columns}, minmax(70px, 1fr))`;
    const indexedSeats = state.seats.map((seat, index) => ({ seat, index }));
    const displaySeats = state.orientation === 'student' ? indexedSeats.reverse() : indexedSeats;

    displaySeats.forEach(({ seat, index }, displayIndex) => {
      const student = state.students.find((item) => item.id === seat.studentId);
      const card = document.createElement('div');
      card.className = 'seat';
      if (student) card.classList.add('has-student');
      if (seat.locked) card.classList.add('is-locked');
      if (seat.disabled) card.classList.add('is-disabled');
      if (layoutEditing) card.classList.add('is-editable');
      if (shuffled && student) {
        card.classList.add('just-shuffled');
        card.style.animationDelay = `${Math.min(displayIndex * 18, 260)}ms`;
      }
      card.setAttribute('role', layoutEditing ? 'button' : 'group');
      card.setAttribute('aria-label', seat.disabled ? `${index + 1}번, 사용하지 않는 자리` : `${index + 1}번 자리${student ? `, ${student.name}` : ', 비어 있음'}${seat.locked ? ', 고정됨' : ''}`);
      if (layoutEditing) {
        card.tabIndex = 0;
        card.addEventListener('click', () => toggleDisabledSeat(index));
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleDisabledSeat(index);
          }
        });
      }

      const number = document.createElement('span');
      number.className = 'seat-number';
      number.textContent = String(index + 1);
      card.append(number);

      const content = document.createElement('span');
      content.className = student ? 'student-name' : 'empty-seat';
      content.textContent = seat.disabled ? '사용 안 함' : student ? student.name : '빈자리';
      card.append(content);

      if (student && !seat.disabled && !layoutEditing) {
        const lock = document.createElement('button');
        lock.type = 'button';
        lock.className = 'lock-button';
        lock.textContent = seat.locked ? '●' : '○';
        lock.title = seat.locked ? '자리 고정 해제' : '이 학생 자리 고정';
        lock.setAttribute('aria-label', `${student.name} 자리 ${seat.locked ? '고정 해제' : '고정'}`);
        lock.addEventListener('click', () => toggleLock(index));
        card.append(lock);
      }
      grid.append(card);
    });
  }

  function renderOrientation() {
    const isStudent = state.orientation === 'student';
    $('classroomShell').classList.toggle('student-view', isStudent);
    $('orientationButton').textContent = isStudent ? '교사 시점으로 보기' : '학생 시점으로 보기';
  }

  function addStudent(name) {
    const clean = name.trim();
    if (!clean) return;
    state.students.push({ id: uid(), name: clean });
    state.previousSeats = null;
    saveState();
    renderAll();
    showToast(`${clean} 학생을 추가했습니다.`);
  }

  function renameStudent(id, name) {
    const clean = name.trim();
    const student = state.students.find((item) => item.id === id);
    if (!student) return;
    if (!clean) {
      renderStudents();
      showToast('이름은 비워 둘 수 없습니다.');
      return;
    }
    student.name = clean;
    saveState();
    renderAll();
  }

  function removeStudent(id) {
    const student = state.students.find((item) => item.id === id);
    if (!student) return;
    state.students = state.students.filter((item) => item.id !== id);
    state.seats = state.seats.map((seat) => seat.studentId === id ? { ...seat, studentId: null, locked: false } : seat);
    state.previousSeats = null;
    saveState();
    renderAll();
    showToast(`${student.name} 학생을 삭제했습니다.`);
  }

  function applyBulkNames() {
    const names = $('bulkNames').value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
    if (!names.length) {
      showNotice('입력한 이름이 없습니다. 한 줄에 한 명씩 입력해 주세요.');
      return;
    }
    const oldBuckets = new Map();
    state.students.forEach((student) => {
      const bucket = oldBuckets.get(student.name) || [];
      bucket.push(student);
      oldBuckets.set(student.name, bucket);
    });
    state.students = names.map((name) => {
      const existing = oldBuckets.get(name)?.shift();
      return existing || { id: uid(), name };
    });
    const validIds = new Set(state.students.map((student) => student.id));
    state.seats = state.seats.map((seat) => validIds.has(seat.studentId) ? seat : { ...seat, studentId: null, locked: false });
    state.previousSeats = null;
    saveState();
    $('bulkEntry').hidden = true;
    renderAll();
    showToast(`${names.length}명의 명단을 적용했습니다.`);
  }

  function resizeClassroom() {
    const rows = Number($('rowsSelect').value);
    const columns = Number($('columnsSelect').value);
    if (rows === state.rows && columns === state.columns) {
      showToast('현재 교실 크기와 같습니다.');
      return;
    }
    const oldRows = state.rows;
    const oldColumns = state.columns;
    const nextSeats = makeSeats(rows, columns);
    for (let row = 0; row < Math.min(oldRows, rows); row += 1) {
      for (let column = 0; column < Math.min(oldColumns, columns); column += 1) {
        nextSeats[row * columns + column] = { ...state.seats[row * oldColumns + column] };
      }
    }
    state.rows = rows;
    state.columns = columns;
    state.seats = nextSeats;
    state.previousSeats = null;
    saveState();
    renderAll();
    showToast(`${columns}칸 × ${rows}줄로 변경했습니다.`);
  }

  function toggleDisabledSeat(index) {
    const seat = state.seats[index];
    seat.disabled = !seat.disabled;
    if (seat.disabled) {
      seat.studentId = null;
      seat.locked = false;
    }
    state.previousSeats = null;
    saveState();
    renderAll();
  }

  function toggleLock(index) {
    const seat = state.seats[index];
    if (!seat.studentId || seat.disabled) return;
    seat.locked = !seat.locked;
    saveState();
    renderAll();
    const student = state.students.find((item) => item.id === seat.studentId);
    showToast(`${student?.name || '학생'}의 자리 고정을 ${seat.locked ? '설정' : '해제'}했습니다.`);
  }

  function shuffleSeats() {
    const activeSeats = state.seats.filter((seat) => !seat.disabled);
    if (!state.students.length) {
      showNotice('먼저 학생 명단을 입력해 주세요.');
      return;
    }
    if (state.students.length > activeSeats.length) {
      showNotice(`사용 가능한 자리가 ${state.students.length - activeSeats.length}개 부족합니다. 자리 편집에서 좌석을 늘려 주세요.`);
      return;
    }

    const lockedStudentIds = new Set(state.seats.filter((seat) => seat.locked && seat.studentId).map((seat) => seat.studentId));
    const waitingStudents = state.students.filter((student) => !lockedStudentIds.has(student.id));
    const targetIndices = state.seats.map((seat, index) => ({ seat, index })).filter(({ seat }) => !seat.disabled && !seat.locked).map(({ index }) => index);
    fisherYates(waitingStudents);
    state.previousSeats = cloneSeats(state.seats);
    targetIndices.forEach((index, order) => {
      state.seats[index].studentId = waitingStudents[order]?.id || null;
      state.seats[index].locked = false;
    });
    saveState();
    renderAll(true);
    showNotice('새로운 자리 배치가 완료되었습니다.', true);
  }

  function fisherYates(list) {
    for (let index = list.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [list[index], list[target]] = [list[target], list[index]];
    }
  }

  function undoShuffle() {
    if (!state.previousSeats) return;
    state.seats = cloneSeats(state.previousSeats);
    state.previousSeats = null;
    saveState();
    renderAll();
    showToast('직전 배치로 되돌렸습니다.');
  }

  function showNotice(message, success = false) {
    const notice = $('notice');
    notice.textContent = message;
    notice.classList.toggle('success', success);
    notice.hidden = false;
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => { notice.hidden = true; }, 5000);
  }

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
  }

  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    state = normalizeState(DEFAULT_STATE);
    layoutEditing = false;
    $('layoutEditButton').setAttribute('aria-pressed', 'false');
    $('layoutEditButton').textContent = '편집 시작';
    renderAll();
    showToast('저장 데이터를 모두 초기화했습니다.');
  }

  fillSizeOptions();

  $('openSeatApp').addEventListener('click', () => showView('seat'));
  $('openPdfApp').addEventListener('click', () => showView('pdf'));
  $('openRedactApp').addEventListener('click', () => showView('redact'));
  $('backToHub').addEventListener('click', () => showView('hub'));
  $('backFromPdf').addEventListener('click', () => showView('hub'));
  $('backFromRedact').addEventListener('click', () => showView('hub'));
  $('brandButton').addEventListener('click', () => showView('hub'));
  $('className').addEventListener('input', (event) => {
    state.className = event.target.value;
    $('classLabel').textContent = state.className.trim() || '우리 반';
    saveState();
  });
  $('applySizeButton').addEventListener('click', resizeClassroom);
  $('addStudentForm').addEventListener('submit', (event) => {
    event.preventDefault();
    addStudent($('studentNameInput').value);
    $('studentNameInput').value = '';
    $('studentNameInput').focus();
  });
  $('toggleBulkButton').addEventListener('click', () => {
    const willOpen = $('bulkEntry').hidden;
    $('bulkEntry').hidden = !willOpen;
    if (willOpen) {
      $('bulkNames').value = state.students.map((student) => student.name).join('\n');
      $('bulkNames').focus();
    }
  });
  $('cancelBulkButton').addEventListener('click', () => { $('bulkEntry').hidden = true; });
  $('applyBulkButton').addEventListener('click', applyBulkNames);
  $('layoutEditButton').addEventListener('click', () => {
    layoutEditing = !layoutEditing;
    $('layoutEditButton').setAttribute('aria-pressed', String(layoutEditing));
    $('layoutEditButton').textContent = layoutEditing ? '편집 완료' : '편집 시작';
    renderSeats();
    showToast(layoutEditing ? '학생을 배치하지 않을 자리를 눌러 주세요.' : '자리 편집을 마쳤습니다.');
  });
  $('orientationButton').addEventListener('click', () => {
    state.orientation = state.orientation === 'teacher' ? 'student' : 'teacher';
    saveState();
    renderAll();
  });
  $('shuffleButton').addEventListener('click', shuffleSeats);
  $('undoButton').addEventListener('click', undoShuffle);
  $('collapseSettings').addEventListener('click', () => {
    const card = document.querySelector('.settings-card');
    const collapsed = card.classList.toggle('is-collapsed');
    $('collapseSettings').textContent = collapsed ? '+' : '−';
    $('collapseSettings').setAttribute('aria-expanded', String(!collapsed));
    $('collapseSettings').setAttribute('aria-label', collapsed ? '설정 펼치기' : '설정 접기');
  });
  $('resetButton').addEventListener('click', () => $('confirmDialog').showModal());
  $('confirmDialog').addEventListener('close', () => {
    if ($('confirmDialog').returnValue === 'confirm') resetAll();
  });

  if (!state.seats.length) state.seats = makeSeats(state.rows, state.columns);
  renderAll();
})();
