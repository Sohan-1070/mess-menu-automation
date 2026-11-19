const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrDataUrl = null;
    this.rawQr = null;
    this.userInfo = null;
    this.groups = [];
    this.eventListeners = [];
    this.authFolder = path.join(__dirname, 'auth_info_baileys');
    this.isReconnecting = false;
  }

  onEvent(callback) {
    this.eventListeners.push(callback);
  }

  emitEvent(type, data) {
    this.eventListeners.forEach(listener => {
      try {
        listener(type, data);
      } catch (err) {
        console.error('Error in event listener:', err);
      }
    });
  }

  async init() {
    try {
      this.status = 'connecting';
      this.emitEvent('status_change', { status: this.status });

      const { state, saveCreds } = await useMultiFileAuthState(this.authFolder);
      const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Mess Automation', 'Chrome', '1.0.0'],
        syncFullHistory: false
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.status = 'qr_ready';
          this.rawQr = qr;
          try {
            this.qrDataUrl = await QRCode.toDataURL(qr);
          } catch (err) {
            console.error('Error generating QR DataURL:', err);
          }
          this.emitEvent('qr', { qrDataUrl: this.qrDataUrl, raw: qr });
          this.emitEvent('status_change', { status: this.status });
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          
          this.status = 'disconnected';
          this.qrDataUrl = null;
          this.rawQr = null;
          this.userInfo = null;
          this.groups = [];
          this.emitEvent('status_change', { status: this.status, reason: statusCode });

          if (shouldReconnect) {
            if (!this.isReconnecting) {
              this.isReconnecting = true;
              console.log('WhatsApp connection closed, reconnecting in 5s...');
              setTimeout(() => {
                this.isReconnecting = false;
                this.init();
              }, 5000);
            }
          } else {
            console.log('WhatsApp logged out. Clearing session files...');
            this.clearAuthFiles();
            setTimeout(() => this.init(), 2000);
          }
        } else if (connection === 'open') {
          this.status = 'connected';
          this.qrDataUrl = null;
          this.rawQr = null;

          const userJid = this.sock.user?.id || '';
          const phone = userJid.split(':')[0] || userJid.split('@')[0];
          const name = this.sock.user?.name || phone;

          this.userInfo = { id: userJid, phone, name };
          console.log(`WhatsApp connected successfully as: ${name} (${phone})`);

          // Fetch groups
          await this.refreshGroups();

          this.emitEvent('connected', {
            userInfo: this.userInfo,
            groups: this.groups
          });
          this.emitEvent('status_change', { status: this.status });
        }
      });
    } catch (err) {
      console.error('Failed to initialize WhatsApp socket:', err);
      this.status = 'disconnected';
      this.emitEvent('status_change', { status: this.status, error: err.message });
    }
  }

  async refreshGroups() {
    if (!this.sock || this.status !== 'connected') {
      return [];
    }

    try {
      const groupData = await this.sock.groupFetchAllParticipating();
      const list = Object.values(groupData).map(g => ({
        id: g.id,
        name: g.subject || 'Unnamed Group',
        desc: g.desc || '',
        participantsCount: g.participants ? g.participants.length : 0
      }));

      list.sort((a, b) => a.name.localeCompare(b.name));
      this.groups = list;
      return list;
    } catch (err) {
      console.error('Error fetching participating groups:', err);
      return [];
    }
  }

  async sendMessage(toJid, messageText) {
    if (!this.sock || this.status !== 'connected') {
      throw new Error('WhatsApp is not connected! Please scan the QR code first.');
    }

    if (!toJid) {
      throw new Error('No recipient or WhatsApp group selected!');
    }

    // Normalise JID if needed
    let cleanJid = toJid.trim();
    if (!cleanJid.includes('@')) {
      if (cleanJid.includes('-') || cleanJid.length > 15) {
        cleanJid = `${cleanJid}@g.us`;
      } else {
        cleanJid = `${cleanJid}@s.whatsapp.net`;
      }
    }

    const result = await this.sock.sendMessage(cleanJid, { text: messageText });
    return result;
  }

  clearAuthFiles() {
    try {
      if (fs.existsSync(this.authFolder)) {
        fs.rmSync(this.authFolder, { recursive: true, force: true });
        console.log('Cleared auth session files.');
      }
    } catch (e) {
      console.error('Error clearing auth files:', e);
    }
  }

  async disconnect() {
    try {
      if (this.sock) {
        await this.sock.logout().catch(() => {});
        this.sock.end(new Error('User manual disconnect'));
      }
    } catch (e) {
      console.error('Error during logout:', e);
    } finally {
      this.clearAuthFiles();
      this.status = 'disconnected';
      this.userInfo = null;
      this.qrDataUrl = null;
      this.groups = [];
      this.emitEvent('status_change', { status: this.status });
      setTimeout(() => this.init(), 1500);
    }
  }

  getStatus() {
    return {
      status: this.status,
      qrDataUrl: this.qrDataUrl,
      userInfo: this.userInfo,
      groupsCount: this.groups.length
    };
  }
}

module.exports = new WhatsAppService();
