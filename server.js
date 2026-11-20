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
app.use(express.static(path.join(__dirname, 'public')));

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
      if (!currentMenu.weekly[day]) currentMenu.weekly[day] = {};
      if (parsedWeekly[day].breakfast) currentMenu.weekly[day].breakfast = parsedWeekly[day].breakfast;
      if (parsedWeekly[day].lunch) currentMenu.weekly[day].lunch = parsedWeekly[day].lunch;
      if (parsedWeekly[day].snacks) currentMenu.weekly[day].snacks = parsedWeekly[day].snacks;
      if (parsedWeekly[day].dinner) currentMenu.weekly[day].dinner = parsedWeekly[day].dinner;
    });

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
    broadcast('new_log', result.log);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Custom Test Message
app.post('/api/test-message', async (req, res) => {
  const { groupId, text } = req.body;
  const targetGroup = groupId || scheduler.getSettings().targetGroupId;

  if (!targetGroup) {
    return res.status(400).json({ success: false, error: 'No WhatsApp group selected!' });
  }

  try {
    const messageText = text || '🔔 *Test Notification from Mess Automation Bot* 🤖\nConnection to this WhatsApp group is working properly!';
    await whatsapp.sendMessage(targetGroup, messageText);

    const log = scheduler.addLog({
      meal: 'test',
      mealTitle: 'Test Message',
      groupName: scheduler.getSettings().targetGroupName || targetGroup,
      groupId: targetGroup,
      status: 'success',
      type: 'manual',
      preview: messageText.substring(0, 80)
    });

    broadcast('new_log', log);
    res.json({ success: true, message: 'Test message sent successfully!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
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
