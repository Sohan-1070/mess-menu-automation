const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const whatsapp = require('./whatsapp');

class SchedulerService {
  constructor() {
    this.cronJobs = {};
    this.logsFile = path.join(__dirname, 'data', 'logs.json');
    this.menuFile = path.join(__dirname, 'data', 'menu.json');
    this.settingsFile = path.join(__dirname, 'config', 'settings.json');
    this.logs = this.loadLogs();
  }

  loadLogs() {
    try {
      if (fs.existsSync(this.logsFile)) {
        return JSON.parse(fs.readFileSync(this.logsFile, 'utf8'));
      }
    } catch (e) {
      console.error('Error loading logs:', e);
    }
    return [];
  }

  saveLogs() {
    try {
      // Keep latest 150 logs
      if (this.logs.length > 150) {
        this.logs = this.logs.slice(0, 150);
      }
      fs.writeFileSync(this.logsFile, JSON.stringify(this.logs, null, 2), 'utf8');
    } catch (e) {
      console.error('Error saving logs:', e);
    }
  }

  addLog(entry) {
    const logItem = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      displayTime: new Date().toLocaleString(),
      ...entry
    };
    this.logs.unshift(logItem);
    this.saveLogs();
    return logItem;
  }

  getMenu() {
    try {
      return JSON.parse(fs.readFileSync(this.menuFile, 'utf8'));
    } catch (e) {
      return { weekly: {}, specialDates: {} };
    }
  }

  getSettings() {
    try {
      return JSON.parse(fs.readFileSync(this.settingsFile, 'utf8'));
    } catch (e) {
      return {};
    }
  }

  formatMealMessage(mealKey, targetDate = new Date()) {
    const settings = this.getSettings();
    const menuData = this.getMenu();

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = days[targetDate.getDay()];
    const dateStr = targetDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    const isoDate = targetDate.toISOString().split('T')[0];

    const mealConfig = settings.timings?.[mealKey] || {
      title: mealKey.charAt(0).toUpperCase() + mealKey.slice(1),
      emoji: '🍽️',
      servingTime: 'Standard Mess Time'
    };

    // Check special dates override first, then weekly day
    let rawItems = '';
    if (menuData.specialDates && menuData.specialDates[isoDate] && menuData.specialDates[isoDate][mealKey]) {
      rawItems = menuData.specialDates[isoDate][mealKey];
    } else if (menuData.weekly && menuData.weekly[dayName] && menuData.weekly[dayName][mealKey]) {
      rawItems = menuData.weekly[dayName][mealKey];
    }

    if (!rawItems || rawItems.trim().length === 0) {
      rawItems = 'Menu details not updated for today.';
    }

    // Format items into clean bullet points
    const itemLines = rawItems
      .split(/[,;\n]+/)
      .map(item => item.trim())
      .filter(item => item.length > 0)
      .map(item => `• ${item}`)
      .join('\n');

    let template = settings.template || "🍽️ *{messName} • {mealUpper}* 🍽️\n📅 *{day}, {date}*\n━━━━━━━━━━━━━━━━━━━━\n{itemsList}\n━━━━━━━━━━━━━━━━━━━━\n⏰ *Serving Time:* {servingTime}\n✨ Have a wonderful meal!";

    const message = template
      .replace(/{messName}/g, settings.messName || 'Hostel Mess')
      .replace(/{meal}/g, mealConfig.title)
      .replace(/{mealUpper}/g, mealConfig.title.toUpperCase())
      .replace(/{emoji}/g, mealConfig.emoji || '🍽️')
      .replace(/{day}/g, dayName)
      .replace(/{date}/g, dateStr)
      .replace(/{itemsList}/g, itemLines)
      .replace(/{servingTime}/g, mealConfig.servingTime || 'As scheduled');

    return {
      message,
      dayName,
      dateStr,
      mealTitle: mealConfig.title,
      items: rawItems
    };
  }

  async sendMealNotification(mealKey, isManual = false) {
    const settings = this.getSettings();
    const targetGroupId = settings.targetGroupId;

    if (!targetGroupId) {
      const err = 'No target WhatsApp group configured in Settings!';
      console.warn(`[Scheduler] Cannot send ${mealKey}: ${err}`);
      this.addLog({
        meal: mealKey,
        status: 'failed',
        error: err,
        type: isManual ? 'manual' : 'scheduled'
      });
      throw new Error(err);
    }

    const { message, mealTitle } = this.formatMealMessage(mealKey);

    try {
      await whatsapp.sendMessage(targetGroupId, message);
      console.log(`[Scheduler] Successfully sent ${mealTitle} notification to ${settings.targetGroupName || targetGroupId}`);
      
      const log = this.addLog({
        meal: mealKey,
        mealTitle,
        groupName: settings.targetGroupName || targetGroupId,
        groupId: targetGroupId,
        status: 'success',
        type: isManual ? 'manual' : 'scheduled',
        preview: message.substring(0, 80) + '...'
      });

      return { success: true, log, message };
    } catch (err) {
      console.error(`[Scheduler] Error sending ${mealTitle}:`, err.message);
      this.addLog({
        meal: mealKey,
        mealTitle,
        groupName: settings.targetGroupName || targetGroupId,
        groupId: targetGroupId,
        status: 'failed',
        error: err.message,
        type: isManual ? 'manual' : 'scheduled'
      });
      throw err;
    }
  }

  startAll() {
    this.stopAll();
    const settings = this.getSettings();
    const timings = settings.timings || {};

    Object.keys(timings).forEach(mealKey => {
      const cfg = timings[mealKey];
      if (!cfg.enabled || !cfg.time) return;

      const [hours, minutes] = cfg.time.split(':').map(Number);
      if (isNaN(hours) || isNaN(minutes)) return;

      // Cron syntax: minute hour * * *
      const cronExpr = `${minutes} ${hours} * * *`;
      console.log(`[Scheduler] Scheduling ${mealKey.toUpperCase()} at ${cfg.time} (${cronExpr})`);

      try {
        const job = cron.schedule(cronExpr, async () => {
          console.log(`[Scheduler] Cron triggered for ${mealKey} at ${new Date().toLocaleTimeString()}`);
          try {
            await this.sendMealNotification(mealKey, false);
          } catch (e) {
            console.error(`[Scheduler] Cron execution failed for ${mealKey}:`, e.message);
          }
        });

        this.cronJobs[mealKey] = job;
      } catch (err) {
        console.error(`[Scheduler] Failed to schedule cron for ${mealKey}:`, err);
      }
    });
  }

  stopAll() {
    Object.keys(this.cronJobs).forEach(key => {
      try {
        this.cronJobs[key].stop();
      } catch (e) {}
    });
    this.cronJobs = {};
  }

  getNextTriggers() {
    const settings = this.getSettings();
    const timings = settings.timings || {};
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const upcoming = [];

    Object.keys(timings).forEach(mealKey => {
      const cfg = timings[mealKey];
      if (!cfg.enabled || !cfg.time) return;

      const [h, m] = cfg.time.split(':').map(Number);
      const triggerMinutes = h * 60 + m;

      let triggerDate = new Date(now);
      triggerDate.setHours(h, m, 0, 0);

      // If already passed today, scheduled for tomorrow
      if (triggerMinutes <= currentMinutes) {
        triggerDate.setDate(triggerDate.getDate() + 1);
      }

      upcoming.push({
        mealKey,
        title: cfg.title,
        emoji: cfg.emoji,
        time: cfg.time,
        triggerDate: triggerDate.toISOString(),
        diffMs: triggerDate.getTime() - now.getTime()
      });
    });

    upcoming.sort((a, b) => a.diffMs - b.diffMs);
    return upcoming;
  }
}

module.exports = new SchedulerService();
