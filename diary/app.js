(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const moodSymbols = { '행복': '☺', '평온': '○', '슬픔': '◡', '복잡': '≋' };
  let entries = [];
  let activeId = null;
  let activeMood = '';
  let toastTimer;

  function localDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(`${value}T00:00:00`));
  }

  function escapeHtml(value) {
    const node = document.createElement('div');
    node.textContent = value;
    return node.innerHTML;
  }

  async function request(url, options) {
    const response = await fetch(url, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options && options.headers) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || '요청을 처리하지 못했습니다.');
    return payload;
  }

  function getFilteredEntries() {
    const query = $('searchInput').value.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesMood = !activeMood || entry.mood === activeMood;
      const haystack = `${entry.title} ${entry.content} ${entry.tags.join(' ')}`.toLowerCase();
      return matchesMood && (!query || haystack.includes(query));
    });
  }

  function renderEntries() {
    const list = $('entryList');
    const filtered = getFilteredEntries();
    list.replaceChildren();
    $('emptyState').hidden = filtered.length > 0;
    filtered.forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `entry-card${entry.id === activeId ? ' is-active' : ''}`;
      button.innerHTML = `
        <span class="entry-meta"><time datetime="${entry.date}">${formatDate(entry.date)}</time><span class="mood-mark">${moodSymbols[entry.mood] || '○'} ${escapeHtml(entry.mood)}</span></span>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.content)}</p>
        <span class="entry-tags">${entry.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</span>`;
      button.addEventListener('click', () => editEntry(entry.id));
      list.appendChild(button);
    });
  }

  function dayKey(date) {
    return new Date(`${date}T00:00:00`).setHours(0, 0, 0, 0);
  }

  function renderSummary() {
    $('totalCount').textContent = entries.length;
    const today = new Date();
    $('monthCount').textContent = entries.filter((entry) => {
      const date = new Date(`${entry.date}T00:00:00`);
      return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth();
    }).length;
    const days = [...new Set(entries.map((entry) => dayKey(entry.date)))].sort((a, b) => b - a);
    let streak = 0;
    if (days.length) {
      const oneDay = 86400000;
      const todayKey = new Date().setHours(0, 0, 0, 0);
      let expected = days[0] === todayKey || days[0] === todayKey - oneDay ? days[0] : null;
      for (const day of days) {
        if (expected === null || day !== expected) break;
        streak += 1;
        expected -= oneDay;
      }
    }
    $('streakCount').textContent = streak;
  }

  function resetForm(focus = false) {
    activeId = null;
    $('entryForm').reset();
    $('dateInput').value = localDate();
    document.querySelector('input[name="mood"][value="평온"]').checked = true;
    $('editorMode').textContent = 'NEW ENTRY';
    $('editorTitle').textContent = '오늘을 기록해요';
    $('saveButton').textContent = '기록 저장';
    $('deleteButton').hidden = true;
    updateCharCount();
    renderEntries();
    if (focus) {
      $('titleInput').focus();
      document.querySelector('.editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function editEntry(id) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    activeId = id;
    $('dateInput').value = entry.date;
    $('titleInput').value = entry.title;
    $('contentInput').value = entry.content;
    $('tagsInput').value = entry.tags.join(', ');
    const moodInput = document.querySelector(`input[name="mood"][value="${CSS.escape(entry.mood)}"]`);
    if (moodInput) moodInput.checked = true;
    $('editorMode').textContent = 'EDIT ENTRY';
    $('editorTitle').textContent = '기록을 다듬어요';
    $('saveButton').textContent = '수정 저장';
    $('deleteButton').hidden = false;
    updateCharCount();
    renderEntries();
    if (window.innerWidth <= 900) document.querySelector('.editor-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function formData() {
    return {
      date: $('dateInput').value,
      title: $('titleInput').value.trim(),
      content: $('contentInput').value.trim(),
      mood: document.querySelector('input[name="mood"]:checked').value,
      tags: $('tagsInput').value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean)
    };
  }

  async function saveEntry(event) {
    event.preventDefault();
    $('saveButton').disabled = true;
    try {
      const editing = Boolean(activeId);
      const payload = await request(editing ? `/api/entries/${activeId}` : '/api/entries', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(formData())
      });
      const index = entries.findIndex((entry) => entry.id === payload.entry.id);
      if (index >= 0) entries[index] = payload.entry;
      else entries.unshift(payload.entry);
      entries.sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
      activeId = payload.entry.id;
      renderSummary();
      renderEntries();
      $('editorMode').textContent = 'EDIT ENTRY';
      $('editorTitle').textContent = '기록을 다듬어요';
      $('saveButton').textContent = '수정 저장';
      $('deleteButton').hidden = false;
      showToast(editing ? '일기를 수정했습니다.' : '오늘의 기록을 저장했습니다.');
    } catch (error) {
      showToast(error.message);
    } finally {
      $('saveButton').disabled = false;
    }
  }

  async function deleteEntry() {
    if (!activeId || !window.confirm('이 일기를 삭제할까요? 삭제한 기록은 되돌릴 수 없어요.')) return;
    try {
      await request(`/api/entries/${activeId}`, { method: 'DELETE' });
      entries = entries.filter((entry) => entry.id !== activeId);
      resetForm();
      renderSummary();
      showToast('일기를 삭제했습니다.');
    } catch (error) {
      showToast(error.message);
    }
  }

  function updateCharCount() {
    $('charCount').textContent = `${$('contentInput').value.length.toLocaleString('ko-KR')}자`;
  }

  function showToast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400);
  }

  async function init() {
    resetForm();
    $('entryForm').addEventListener('submit', saveEntry);
    $('newEntryButton').addEventListener('click', () => resetForm(true));
    $('deleteButton').addEventListener('click', deleteEntry);
    $('contentInput').addEventListener('input', updateCharCount);
    $('searchInput').addEventListener('input', renderEntries);
    $('moodFilters').addEventListener('click', (event) => {
      const button = event.target.closest('[data-mood]');
      if (!button) return;
      activeMood = button.dataset.mood;
      document.querySelectorAll('[data-mood]').forEach((chip) => chip.classList.toggle('is-active', chip === button));
      renderEntries();
    });
    try {
      const payload = await request('/api/entries');
      entries = payload.entries;
      renderEntries();
      renderSummary();
    } catch (error) {
      showToast(`기록을 불러오지 못했습니다: ${error.message}`);
    }
  }

  init();
})();
