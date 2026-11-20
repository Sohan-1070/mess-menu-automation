const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const xlsx = require('xlsx');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const whatsapp = require('./whatsapp');
const scheduler = require('./scheduler');
const { parseAnyMenuFile, countValidDays } = require('./menuParser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const upload = multer({ dest: path.join(__dirname, 'uploads/') });
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
}

app.use(cors());
app.use(express.json());

// Disable caching for frontend updates so browser always sees latest UI immediately
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0
}));

// WebSocket Broadcast Helper
function broadcast(type, payload) {
  const data = JSON.stringify({ type, payload });
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

// WhatsApp Event Forwarding to WebSocket
whatsapp.onEvent((type, data) => {
  broadcast(`wa_${type}`, data);
});

wss.on('connection', (ws) => {
  // Send initial state on client connect
  const waStatus = whatsapp.getStatus();
  ws.send(JSON.stringify({
    type: 'initial_state',
    payload: {
      waStatus,
      nextTriggers: scheduler.getNextTriggers(),
      settings: scheduler.getSettings()
    }
  }));
});

// --- API ROUTES ---

// Health check endpoint (for cloud 24/7 keep-alive services like UptimeRobot / cron-job.org)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
app.get('/ping', (req, res) => {
  res.send('pong');
});

// 1. Status & Overview
app.get('/api/status', (req, res) => {
  res.json({
    whatsapp: whatsapp.getStatus(),
    nextTriggers: scheduler.getNextTriggers(),
    settings: scheduler.getSettings()
  });
});

// 2. Fetch WhatsApp Groups
app.get('/api/groups', async (req, res) => {
  try {
    const groups = await whatsapp.refreshGroups();
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Menu Get & Save
app.get('/api/menu', (req, res) => {
  res.json(scheduler.getMenu());
});

app.post('/api/menu', (req, res) => {
  try {
    const newMenu = req.body;
    fs.writeFileSync(scheduler.menuFile, JSON.stringify(newMenu, null, 2), 'utf8');
    res.json({ success: true, menu: newMenu });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Excel / CSV / PDF Menu Upload (Universal Parser)
app.post('/api/upload-menu', upload.single('menuFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded!' });
  }

  const filePath = req.file.path;
  const originalName = req.file.originalname;

  try {
    console.log('[Upload] Parsing menu file: ' + originalName);
    const parsedWeekly = await parseAnyMenuFile(filePath, originalName);
    const validCount = countValidDays(parsedWeekly);

    if (validCount === 0) {
      throw new Error('No meal schedule could be identified in the file. Please ensure it contains days and meal sections.');
    }

    const currentMenu = scheduler.getMenu();
    Object.keys(parsedWeekly).forEach(day => {
      if (day.startsWith('_')) return; // ignore internal metadata like _servingTimes
      if (!currentMenu.weekly[day]) currentMenu.weekly[day] = {};
      if (parsedWeekly[day].breakfast) currentMenu.weekly[day].breakfast = parsedWeekly[day].breakfast;
      if (parsedWeekly[day].lunch) currentMenu.weekly[day].lunch = parsedWeekly[day].lunch;
      if (parsedWeekly[day].snacks) currentMenu.weekly[day].snacks = parsedWeekly[day].snacks;
      if (parsedWeekly[day].dinner) currentMenu.weekly[day].dinner = parsedWeekly[day].dinner;
    });

    // Update serving times if extracted from the sheet
    if (parsedWeekly._servingTimes) {
      const currentSettings = scheduler.getSettings();
      Object.keys(parsedWeekly._servingTimes).forEach(meal => {
        if (currentSettings.timings && currentSettings.timings[meal]) {
          currentSettings.timings[meal].servingTime = parsedWeekly._servingTimes[meal];
        }
      });
      fs.writeFileSync(scheduler.settingsFile, JSON.stringify(currentSettings, null, 2), 'utf8');
    }

    fs.writeFileSync(scheduler.menuFile, JSON.stringify(currentMenu, null, 2), 'utf8');

    // Clean up uploaded temp file
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: 'Successfully imported menu for ' + validCount + ' days from "' + originalName + '"!',
      menu: currentMenu
    });
  } catch (err) {
    console.error('[Upload Error]', err.message);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.status(400).json({ success: false, error: err.message });
  }
});

// 5. Settings Get & Save
app.get('/api/settings', (req, res) => {
  res.json(scheduler.getSettings());
});

app.post('/api/settings', (req, res) => {
  try {
    const updated = req.body;
    fs.writeFileSync(scheduler.settingsFile, JSON.stringify(updated, null, 2), 'utf8');
    scheduler.startAll(); // Reschedule cron jobs
    broadcast('settings_updated', updated);
    res.json({ success: true, settings: updated });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Delivery Logs
app.get('/api/logs', (req, res) => {
  res.json(scheduler.logs);
});

// 7. Manual Send Now
app.post('/api/send-now', async (req, res) => {
  const { meal } = req.body;
  if (!meal) {
    return res.status(400).json({ success: false, error: 'Meal parameter is required (breakfast, lunch, snacks, dinner)' });
  }

  try {
    const result = await scheduler.sendMealNotification(meal, true);
    if (result.logs) {
      result.logs.forEach(l => broadcast('new_log', l));
    }
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Custom Test Message (Single or Multi-Group Broadcast)
app.post('/api/test-message', async (req, res) => {
  const { groupId, text } = req.body;
  let targetGroups = [];

  if (groupId) {
    targetGroups.push({ id: groupId, name: 'Selected Group' });
  } else {
    targetGroups = scheduler.getTargetGroups();
  }

  if (targetGroups.length === 0) {
    return res.status(400).json({ success: false, error: 'No WhatsApp group selected! Please select at least one group.' });
  }

  const messageText = text || '🔔 *Test Notification from MessMate Bot* 🤖\nConnection to this WhatsApp group is verified and working!';
  const sentGroups = [];

  for (let i = 0; i < targetGroups.length; i++) {
    const g = targetGroups[i];
    try {
      await whatsapp.sendMessage(g.id, messageText);
      const log = scheduler.addLog({
        meal: 'test',
        mealTitle: 'Test Message',
        groupName: g.name,
        groupId: g.id,
        status: 'success',
        type: 'manual',
        preview: messageText.substring(0, 80)
      });
      broadcast('new_log', log);
      sentGroups.push(g.name);

      if (i < targetGroups.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (e) {
      console.error(`[Test Message Error] Failed sending to ${g.name}:`, e.message);
    }
  }

  if (sentGroups.length === 0) {
    return res.status(500).json({ success: false, error: 'Failed to send test message to groups.' });
  }

  res.json({ success: true, message: `Test message sent successfully to ${sentGroups.length} group(s)!` });
});

// 9. WhatsApp Disconnect
app.post('/api/whatsapp/disconnect', async (req, res) => {
  try {
    await whatsapp.disconnect();
    res.json({ success: true, message: 'WhatsApp session disconnected.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 10. Meal Preview
app.get('/api/preview/:meal', (req, res) => {
  try {
    const meal = req.params.meal;
    const formatted = scheduler.formatMealMessage(meal);
    res.json({ success: true, ...formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🍽️  MESS MENU WHATSAPP AUTOMATION SERVER`);
  console.log(`🌐 Dashboard running at: http://localhost:${PORT}`);
  console.log(`======================================================\n`);

  // Start WhatsApp Socket
  whatsapp.init();

  // Start Cron Jobs
  scheduler.startAll();
});
