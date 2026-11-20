// Frontend Application Logic for MessMate

let state = {
  menu: null,
  settings: null,
  logs: [],
  groups: [],
  waStatus: null,
  activePreviewMeal: 'lunch'
};

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// --- WebSocket Connection ---
let ws;
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WS] Connected to server.');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (e) {
      console.error('[WS] Parse error:', e);
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected, reconnecting in 3s...');
    setTimeout(initWebSocket, 3000);
  };
}

function handleWsMessage(msg) {
  const { type, payload } = msg;

  if (type === 'initial_state') {
    state.waStatus = payload.waStatus;
    state.settings = payload.settings;
    updateWhatsAppUI(payload.waStatus);
    updateNextTriggerUI(payload.nextTriggers);
    applySettingsToUI(payload.settings);
  } else if (type === 'wa_qr') {
    updateQrCode(payload.qrDataUrl);
  } else if (type === 'wa_status_change') {
    updateStatusPill(payload.status);
    if (payload.status === 'connected') {
      fetchStatus();
    }
  } else if (type === 'wa_connected') {
    updateWhatsAppUI({
      status: 'connected',
      userInfo: payload.userInfo,
      groupsCount: payload.groups?.length || 0
    });
    if (payload.groups) {
      renderGroupChecklist(payload.groups);
    }
    showToast('WhatsApp connected successfully!', 'success');
  } else if (type === 'new_log') {
    state.logs.unshift(payload);
    renderLogs();
    showToast(`Sent ${payload.mealTitle} to ${payload.groupName}`, payload.status === 'success' ? 'success' : 'error');
  } else if (type === 'settings_updated') {
    state.settings = payload;
    applySettingsToUI(payload);
  }
}

// --- Initial Data Load ---
async function init() {
  initWebSocket();
  setupDropZone();
  await Promise.all([
    fetchStatus(),
    fetchMenu(),
    fetchSettings(),
    fetchLogs()
  ]);
  startCountdownTimer();
  updateTodayHeader();
}

// --- Fetch Functions ---
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    state.waStatus = data.whatsapp;
    state.settings = data.settings;
    updateWhatsAppUI(data.whatsapp);
    updateNextTriggerUI(data.nextTriggers);
    if (data.whatsapp?.status === 'connected') {
      loadGroups();
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

async function fetchMenu() {
  try {
    const res = await fetch('/api/menu');
    const data = await res.json();
    state.menu = data;
    renderMenuTable();
    updateTodayMealPreviews();
    loadMealPreview(state.activePreviewMeal);
  } catch (err) {
    console.error('Failed to fetch menu:', err);
  }
}

async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    state.settings = data;
    applySettingsToUI(data);
  } catch (err) {
    console.error('Failed to fetch settings:', err);
  }
}

async function fetchLogs() {
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();
    state.logs = data;
    renderLogs();
  } catch (err) {
    console.error('Failed to fetch logs:', err);
  }
}

async function loadGroups() {
  try {
    const res = await fetch('/api/groups');
    const data = await res.json();
    if (data.success && data.groups) {
      state.groups = data.groups;
      renderGroupChecklist(data.groups);
    }
  } catch (err) {
    console.error('Failed to load groups:', err);
  }
}

// --- UI Updaters ---
function updateWhatsAppUI(wa) {
  if (!wa) return;
  updateStatusPill(wa.status);

  const qrBox = document.getElementById('waQrBox');
  const connectedBox = document.getElementById('waConnectedBox');

  if (wa.status === 'connected') {
    qrBox.classList.add('hidden');
    connectedBox.classList.remove('hidden');

    const name = wa.userInfo?.name || 'WhatsApp User';
    const phone = wa.userInfo?.phone || wa.userInfo?.id || 'Connected';

    document.getElementById('waUserName').innerText = name;
    document.getElementById('waUserPhone').innerText = phone;
  } else {
    connectedBox.classList.add('hidden');
    qrBox.classList.remove('hidden');

    if (wa.qrDataUrl) {
      updateQrCode(wa.qrDataUrl);
    }
  }
}

function updateStatusPill(status) {
  const pill = document.getElementById('waStatusPill');
  const text = document.getElementById('waStatusText');

  if (status === 'connected') {
    pill.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
    pill.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>Connected</span>';
  } else if (status === 'qr_ready') {
    pill.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold bg-sky-500/10 border-sky-500/30 text-sky-400';
    pill.innerHTML = '<span class="w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span><span>Scan QR Code</span>';
  } else {
    pill.className = 'flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-semibold bg-amber-500/10 border-amber-500/30 text-amber-400';
    pill.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span><span>Connecting...</span>';
  }
}

function updateQrCode(qrDataUrl) {
  const img = document.getElementById('qrImg');
  const loading = document.getElementById('qrLoading');
  if (qrDataUrl) {
    img.src = qrDataUrl;
    img.classList.remove('hidden');
    loading.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    loading.classList.remove('hidden');
  }
}

function getSelectedGroupIds() {
  const current = state.settings?.targetGroups || [];
  if (Array.isArray(current) && current.length > 0) {
    return current.map(g => g.id);
  }
  if (state.settings?.targetGroupId) {
    return [state.settings.targetGroupId];
  }
  return [];
}

function renderGroupChecklist(groups) {
  const container = document.getElementById('groupChecklist');
  if (!container) return;

  if (!groups || groups.length === 0) {
    container.innerHTML = '<p class="text-slate-500 text-center py-3 text-[11px]">No WhatsApp groups found.</p>';
    return;
  }

  const selectedIds = getSelectedGroupIds();

  container.innerHTML = groups.map(g => {
    const isChecked = selectedIds.includes(g.id);
    return `
      <label class="group-item flex items-center justify-between p-2 rounded-lg hover:bg-slate-900 cursor-pointer transition select-none" data-name="${g.name.toLowerCase()}">
        <div class="flex items-center gap-2.5 overflow-hidden">
          <input type="checkbox" value="${g.id}" data-name="${encodeURIComponent(g.name)}" ${isChecked ? 'checked' : ''} onchange="onGroupCheckboxChange()" class="group-checkbox rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0 cursor-pointer" />
          <span class="text-xs font-medium text-slate-200 truncate">${g.name}</span>
        </div>
        <span class="text-[10px] text-slate-500 shrink-0 font-mono ml-2">${g.participantsCount} members</span>
      </label>
    `;
  }).join('');

  updateSelectedGroupsUI();
  updateTargetGroupsHeader();
}

function filterGroupList() {
  const query = (document.getElementById('groupSearchInput')?.value || '').toLowerCase().trim();
  const items = document.querySelectorAll('.group-item');
  items.forEach(item => {
    const name = item.getAttribute('data-name') || '';
    if (!query || name.includes(query)) {
      item.classList.remove('hidden');
    } else {
      item.classList.add('hidden');
    }
  });
}

function onGroupCheckboxChange() {
  updateSelectedGroupsUI();
}

function updateSelectedGroupsUI() {
  const bar = document.getElementById('selectedGroupsBar');
  if (!bar) return;

  const checkboxes = document.querySelectorAll('.group-checkbox:checked');
  const selectedCount = checkboxes.length;

  if (selectedCount === 0) {
    bar.innerHTML = '<span class="text-[11px] text-amber-400/80 italic">No groups selected yet. Check groups above to broadcast!</span>';
    return;
  }

  bar.innerHTML = `
    <div class="w-full text-[11px] text-emerald-400 font-semibold mb-1 flex items-center justify-between">
      <span>${selectedCount} Group${selectedCount > 1 ? 's' : ''} Selected for Broadcast</span>
    </div>
  ` + Array.from(checkboxes).map(cb => {
    const id = cb.value;
    const name = decodeURIComponent(cb.getAttribute('data-name') || id);
    return `
      <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium">
        <span class="truncate max-w-[120px]">${name}</span>
        <button type="button" onclick="uncheckGroup('${id}')" class="text-slate-400 hover:text-white">&times;</button>
      </span>
    `;
  }).join('');
}

function uncheckGroup(id) {
  const cb = document.querySelector(`.group-checkbox[value="${id}"]`);
  if (cb) {
    cb.checked = false;
    updateSelectedGroupsUI();
  }
}

function updateTargetGroupsHeader() {
  const header = document.getElementById('targetGroupNameHeader');
  if (!header) return;

  const groups = state.settings?.targetGroups || [];
  if (Array.isArray(groups) && groups.length > 0) {
    if (groups.length === 1) {
      header.textContent = groups[0].name;
    } else {
      header.textContent = `${groups.length} Groups (${groups[0].name}, +${groups.length - 1} more)`;
    }
  } else if (state.settings?.targetGroupName) {
    header.textContent = state.settings.targetGroupName;
  } else {
    header.textContent = 'None Selected';
  }
}

function applySettingsToUI(settings) {
  if (!settings) return;

  if (settings.messName) {
    document.getElementById('inputMessName').value = settings.messName;
  }
  updateTargetGroupsHeader();
  if (settings.template) {
    document.getElementById('templateTextarea').value = settings.template;
  }

  // Meal Timings
  const timings = settings.timings || {};
  if (timings.breakfast) {
    document.getElementById('timeBreakfast').value = timings.breakfast.time || '07:30';
    document.getElementById('servingBreakfast').value = timings.breakfast.servingTime || '';
    document.getElementById('enableBreakfast').checked = timings.breakfast.enabled !== false;
    document.getElementById('timeBadgeBreakfast').innerText = timings.breakfast.time || '07:30';
  }
  if (timings.lunch) {
    document.getElementById('timeLunch').value = timings.lunch.time || '12:30';
    document.getElementById('servingLunch').value = timings.lunch.servingTime || '';
    document.getElementById('enableLunch').checked = timings.lunch.enabled !== false;
    document.getElementById('timeBadgeLunch').innerText = timings.lunch.time || '12:30';
  }
  if (timings.snacks) {
    document.getElementById('timeSnacks').value = timings.snacks.time || '17:00';
    document.getElementById('servingSnacks').value = timings.snacks.servingTime || '';
    document.getElementById('enableSnacks').checked = timings.snacks.enabled !== false;
    document.getElementById('timeBadgeSnacks').innerText = timings.snacks.time || '17:00';
  }
  if (timings.dinner) {
    document.getElementById('timeDinner').value = timings.dinner.time || '19:45';
    document.getElementById('servingDinner').value = timings.dinner.servingTime || '';
    document.getElementById('enableDinner').checked = timings.dinner.enabled !== false;
    document.getElementById('timeBadgeDinner').innerText = timings.dinner.time || '19:45';
  }
}

function updateTodayHeader() {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const dayName = days[now.getDay()];
  const dateStr = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  document.getElementById('todayDayBadge').innerText = dayName;
  document.getElementById('todayDateStr').innerText = dateStr;
}

function updateTodayMealPreviews() {
  if (!state.menu || !state.menu.weekly) return;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const now = new Date();
  const todayDay = days[now.getDay()];
  const todayMenu = state.menu.weekly[todayDay] || {};

  document.getElementById('todayBreakfastPreview').innerText = todayMenu.breakfast || 'Not set';
  document.getElementById('todayLunchPreview').innerText = todayMenu.lunch || 'Not set';
  document.getElementById('todaySnacksPreview').innerText = todayMenu.snacks || 'Not set';
  document.getElementById('todayDinnerPreview').innerText = todayMenu.dinner || 'Not set';
}

function updateNextTriggerUI(triggers) {
  const badge = document.getElementById('nextAlertBadge');
  const text = document.getElementById('nextAlertText');

  if (!triggers || triggers.length === 0) {
    text.innerText = 'All meals disabled';
    return;
  }

  const next = triggers[0];
  const triggerTime = new Date(next.triggerDate);
  const diffMinutes = Math.max(0, Math.floor((triggerTime - new Date()) / 60000));
  const hours = Math.floor(diffMinutes / 60);
  const mins = diffMinutes % 60;

  const hoursStr = hours > 0 ? `${hours}h ` : '';
  text.innerText = `${next.emoji} ${next.title} in ${hoursStr}${mins}m (${next.time})`;
}

function startCountdownTimer() {
  setInterval(async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      updateNextTriggerUI(data.nextTriggers);
    } catch (e) {}
  }, 60000); // Check every minute
}

// --- Menu Table Rendering & Editing ---
function renderMenuTable() {
  const tbody = document.getElementById('menuTableBody');
  tbody.innerHTML = '';

  const weekly = state.menu?.weekly || {};

  daysOfWeek.forEach(day => {
    const meal = weekly[day] || { breakfast: '', lunch: '', snacks: '', dinner: '' };
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/40 transition';

    tr.innerHTML = `
      <td class="py-3 px-3 font-semibold text-slate-200">${day}</td>
      <td class="py-2 px-2">
        <textarea data-day="${day}" data-meal="breakfast" rows="2" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500">${meal.breakfast || ''}</textarea>
      </td>
      <td class="py-2 px-2">
        <textarea data-day="${day}" data-meal="lunch" rows="2" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500">${meal.lunch || ''}</textarea>
      </td>
      <td class="py-2 px-2">
        <textarea data-day="${day}" data-meal="snacks" rows="2" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500">${meal.snacks || ''}</textarea>
      </td>
      <td class="py-2 px-2">
        <textarea data-day="${day}" data-meal="dinner" rows="2" class="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500">${meal.dinner || ''}</textarea>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function saveTableMenu() {
  const textareas = document.querySelectorAll('#menuTableBody textarea');
  const updatedWeekly = {};

  daysOfWeek.forEach(day => {
    updatedWeekly[day] = { breakfast: '', lunch: '', snacks: '', dinner: '' };
  });

  textareas.forEach(ta => {
    const day = ta.getAttribute('data-day');
    const meal = ta.getAttribute('data-meal');
    if (updatedWeekly[day]) {
      updatedWeekly[day][meal] = ta.value.trim();
    }
  });

  try {
    const currentMenu = state.menu || { specialDates: {} };
    currentMenu.weekly = updatedWeekly;

    const res = await fetch('/api/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentMenu)
    });

    const data = await res.json();
    if (data.success) {
      state.menu = data.menu;
      updateTodayMealPreviews();
      loadMealPreview(state.activePreviewMeal);
      showToast('Weekly menu updated and saved!', 'success');
    }
  } catch (err) {
    showToast('Failed to save menu: ' + err.message, 'error');
  }
}

// --- Menu File Drag & Drop & Upload ---
function setupDropZone() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('dragDropInput');

  if (!dropZone || !fileInput) return;

  // Click anywhere on drop zone to pick file
  dropZone.addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleAutoUpload(fileInput.files[0]);
    }
  });

  // Drag over / enter effects
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.add('border-emerald-400', 'bg-emerald-950/20', 'scale-[1.01]');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropZone.classList.remove('border-emerald-400', 'bg-emerald-950/20', 'scale-[1.01]');
    });
  });

  // Drop event
  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      handleAutoUpload(files[0]);
    }
  });
}

async function handleAutoUpload(file) {
  const validExts = ['.xlsx', '.xls', '.csv', '.pdf'];
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

  if (!validExts.includes(ext)) {
    showToast('Please drop a valid menu file (.pdf, .xlsx, .xls, or .csv)!', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('menuFile', file);

  const isPdf = ext === '.pdf';
  showToast(`⚡ Extracting & importing "${file.name}" ${isPdf ? '(PDF Text)' : ''}...`, 'info');

  try {
    const res = await fetch('/api/upload-menu', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    if (data.success) {
      state.menu = data.menu;
      renderMenuTable();
      updateTodayMealPreviews();
      loadMealPreview(state.activePreviewMeal);
      showToast(`🎉 ${data.message || 'Menu updated successfully!'}`, 'success');
    } else {
      showToast('Import error: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Failed to upload file: ' + err.message, 'error');
  }
}

// Settings & Timings Save
async function saveTimingsSettings() {
  const currentSettings = state.settings || {};

  currentSettings.messName = document.getElementById('inputMessName').value.trim() || 'Hostel Mess';

  if (!currentSettings.timings) currentSettings.timings = {};

  currentSettings.timings.breakfast = {
    title: 'Breakfast',
    emoji: '🌅',
    enabled: document.getElementById('enableBreakfast').checked,
    time: document.getElementById('timeBreakfast').value,
    servingTime: document.getElementById('servingBreakfast').value
  };

  currentSettings.timings.lunch = {
    title: 'Lunch',
    emoji: '🍛',
    enabled: document.getElementById('enableLunch').checked,
    time: document.getElementById('timeLunch').value,
    servingTime: document.getElementById('servingLunch').value
  };

  currentSettings.timings.snacks = {
    title: 'Evening Snacks',
    emoji: '☕',
    enabled: document.getElementById('enableSnacks').checked,
    time: document.getElementById('timeSnacks').value,
    servingTime: document.getElementById('servingSnacks').value
  };

  currentSettings.timings.dinner = {
    title: 'Dinner',
    emoji: '🍲',
    enabled: document.getElementById('enableDinner').checked,
    time: document.getElementById('timeDinner').value,
    servingTime: document.getElementById('servingDinner').value
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentSettings)
    });

    const data = await res.json();
    if (data.success) {
      state.settings = data.settings;
      applySettingsToUI(data.settings);
      fetchStatus();
      showToast('Alert schedule and timings saved!', 'success');
    }
  } catch (err) {
    showToast('Failed to save timings: ' + err.message, 'error');
  }
}

// --- Multiple Group Selector Save ---
async function saveSelectedGroups() {
  const checkboxes = document.querySelectorAll('.group-checkbox:checked');
  const targetGroups = Array.from(checkboxes).map(cb => ({
    id: cb.value,
    name: decodeURIComponent(cb.getAttribute('data-name') || cb.value)
  }));

  if (targetGroups.length === 0) {
    showToast('Please check at least one WhatsApp group!', 'error');
    return;
  }

  const currentSettings = state.settings || {};
  currentSettings.targetGroups = targetGroups;
  currentSettings.targetGroupId = targetGroups[0].id; // backward compatibility
  currentSettings.targetGroupName = targetGroups.map(g => g.name).join(', ');

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentSettings)
    });

    const data = await res.json();
    if (data.success) {
      state.settings = data.settings;
      updateTargetGroupsHeader();
      showToast(`Saved ${targetGroups.length} target WhatsApp group(s)!`, 'success');
    }
  } catch (err) {
    showToast('Failed to save groups: ' + err.message, 'error');
  }
}

// --- Manual Actions ---
async function sendMealNow(mealKey) {
  if (!confirm(`Are you sure you want to send today's ${mealKey.toUpperCase()} menu to the WhatsApp group right now?`)) {
    return;
  }

  showToast(`Sending ${mealKey} notification...`, 'info');

  try {
    const res = await fetch('/api/send-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meal: mealKey })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Dispatched ${mealKey} to WhatsApp group!`, 'success');
    } else {
      showToast(`Error: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Failed: ${err.message}`, 'error');
  }
}

async function sendTestGroupMessage() {
  showToast('Sending test message to WhatsApp group...', 'info');

  try {
    const res = await fetch('/api/test-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (data.success) {
      showToast('Test message sent to group successfully!', 'success');
    } else {
      showToast('Error: ' + data.error, 'error');
    }
  } catch (err) {
    showToast('Failed to send test message: ' + err.message, 'error');
  }
}

async function refreshWhatsApp() {
  showToast('Refreshing WhatsApp status & groups...', 'info');
  await fetchStatus();
  await loadGroups();
}

async function disconnectWhatsApp() {
  if (!confirm('Are you sure you want to log out and disconnect WhatsApp? You will need to scan QR code again.')) {
    return;
  }

  try {
    const res = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast('WhatsApp logged out. Scan new QR code.', 'info');
      fetchStatus();
    }
  } catch (err) {
    showToast('Logout error: ' + err.message, 'error');
  }
}

// --- Template & Live Preview ---
async function loadMealPreview(mealKey) {
  state.activePreviewMeal = mealKey;
  try {
    const res = await fetch(`/api/preview/${mealKey}`);
    const data = await res.json();
    if (data.success) {
      document.getElementById('livePreviewContent').textContent = data.message;
    }
  } catch (e) {
    console.error('Preview error:', e);
  }
}

function insertVar(varName) {
  const ta = document.getElementById('templateTextarea');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = ta.value;
  ta.value = text.substring(0, start) + varName + text.substring(end);
  ta.focus();
}

function resetDefaultTemplate() {
  const def = "🍽️ *{messName} • {mealUpper}* 🍽️\n📅 *{day}, {date}*\n━━━━━━━━━━━━━━━━━━━━\n{itemsList}\n━━━━━━━━━━━━━━━━━━━━\n⏰ *Serving Time:* {servingTime}\n✨ Have a wonderful meal!";
  document.getElementById('templateTextarea').value = def;
}

async function saveTemplate() {
  const currentSettings = state.settings || {};
  currentSettings.template = document.getElementById('templateTextarea').value;

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentSettings)
    });

    const data = await res.json();
    if (data.success) {
      state.settings = data.settings;
      loadMealPreview(state.activePreviewMeal);
      showToast('Template updated and saved!', 'success');
    }
  } catch (err) {
    showToast('Failed to save template: ' + err.message, 'error');
  }
}

// --- Delivery Logs ---
function renderLogs() {
  const tbody = document.getElementById('logsTableBody');
  if (!state.logs || state.logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-slate-500">No logs yet. Messages sent will appear here.</td></tr>`;
    return;
  }

  tbody.innerHTML = state.logs.map(log => {
    const isSuccess = log.status === 'success';
    const statusPill = isSuccess
      ? `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Delivered</span>`
      : `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">Failed</span>`;

    const typePill = log.type === 'manual'
      ? `<span class="text-slate-400 text-[10px]">Manual</span>`
      : `<span class="text-emerald-400 text-[10px]">Auto Cron</span>`;

    return `
      <tr class="hover:bg-slate-800/40 transition">
        <td class="py-2.5 px-3 font-mono text-[11px] text-slate-400">${log.displayTime || log.timestamp}</td>
        <td class="py-2.5 px-3 font-semibold text-slate-200 capitalize">${log.mealTitle || log.meal}</td>
        <td class="py-2.5 px-3">${typePill}</td>
        <td class="py-2.5 px-3 text-slate-300 font-medium">${log.groupName || log.groupId}</td>
        <td class="py-2.5 px-3">${statusPill}</td>
        <td class="py-2.5 px-3 font-mono text-[10px] text-slate-400 max-w-xs truncate">${log.error ? `<span class="text-rose-400">${log.error}</span>` : (log.preview || 'Dispatched')}</td>
      </tr>
    `;
  }).join('');
}

// --- Tab Switching ---
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('text-emerald-400', 'border-emerald-400');
    btn.classList.add('text-slate-400', 'border-transparent');
  });

  const activeContent = document.getElementById(tabId);
  const activeBtn = document.getElementById(`tabBtn-${tabId}`);

  if (activeContent) activeContent.classList.remove('hidden');
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-400', 'border-transparent');
    activeBtn.classList.add('text-emerald-400', 'border-emerald-400');
  }

  if (tabId === 'templateTab') {
    loadMealPreview(state.activePreviewMeal);
  }
}

// --- Toast Notifications ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');

  let bgClass = 'bg-slate-800 border-slate-700 text-white';
  let icon = 'fa-info-circle text-sky-400';

  if (type === 'success') {
    bgClass = 'bg-emerald-950/90 border-emerald-500/40 text-emerald-100';
    icon = 'fa-check-circle text-emerald-400';
  } else if (type === 'error') {
    bgClass = 'bg-rose-950/90 border-rose-500/40 text-rose-100';
    icon = 'fa-circle-exclamation text-rose-400';
  }

  toast.className = `toast pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-2xl text-xs font-medium ${bgClass}`;
  toast.innerHTML = `<i class="fa-solid ${icon} text-sm"></i><span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Boot up
window.addEventListener('DOMContentLoaded', init);
