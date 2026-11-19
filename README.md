# 🍽️ MessMate - WhatsApp Mess Menu Automation

A complete, automated web application that manages your monthly mess/hostel food menu and automatically dispatches formatted meal notifications (Breakfast, Lunch, Snacks, Dinner) directly to your WhatsApp group according to your scheduled meal timings.

---

## ✨ Features

- **Monthly Menu Upload**: Upload your mess menu as an Excel spreadsheet (`.xlsx`, `.xls`) or CSV file every month.
- **Sample Excel Template**: 1-click download of a pre-formatted Excel template ready to fill and import.
- **Interactive Live Menu Editor**: Edit meals (Monday to Sunday) directly in your browser.
- **Automated WhatsApp Scheduler**:
  - 🌅 **Breakfast**: e.g., 07:30 AM
  - 🍛 **Lunch**: e.g., 12:30 PM
  - ☕ **Snacks / Hi-Tea**: e.g., 05:00 PM
  - 🍲 **Dinner**: e.g., 07:45 PM
- **Interactive WhatsApp Web QR Code**:
  - Connects securely using official WhatsApp Web protocols (powered by Baileys).
  - Automatically fetches all WhatsApp groups you are in.
  - Choose your hostel/mess group from a clean dropdown.
  - Persistent login: session saved locally so you only scan once.
- **Customizable Message Formatting**:
  - WhatsApp emojis, bold formatting, dish bullet points, and serving timings.
  - Live WhatsApp chat bubble simulation preview in the web dashboard.
- **Instant "Send Now" & Test Trigger**:
  - Send any meal menu immediately with one click without waiting for scheduled time.
  - Send custom test messages to verify connection.
- **Delivery Activity Logs**:
  - Real-time audit log tracking sent, pending, or failed messages with exact timestamps.

---

## 🚀 How to Run

### Option 1: Quick Double-Click (Windows)
Double-click `start.bat` in this folder. It will start the server and open the dashboard in your default web browser automatically!

### Option 2: Command Line
```powershell
# In this directory:
npm install
node server.js
```
Open **`http://localhost:3000`** in your browser.

---

## 📱 Quick Setup Guide

1. **Open the Dashboard**: Go to `http://localhost:3000`.
2. **Scan the WhatsApp QR Code**:
   - On your phone, open WhatsApp.
   - Go to **Settings** > **Linked Devices** > **Link a Device**.
   - Point your phone camera at the QR code displayed on the screen.
3. **Select Your WhatsApp Group**:
   - Once connected, your WhatsApp groups will load in the dropdown.
   - Select your hostel mess group and click **"Set as Target Group"**.
4. **Upload or Customize Your Monthly Menu**:
   - Click **"Monthly Menu Upload"** to upload an Excel file (`.xlsx`) or download our sample template.
   - Or edit the items directly in the **Weekly Menu Schedule** table.
5. **Adjust Alert Timings**:
   - Go to the **Meal Timings & Schedule** tab to set when Breakfast (e.g., 07:30), Lunch (e.g., 12:30), etc., should be sent.
6. **Done!** The system will automatically post each meal's menu to your WhatsApp group at the configured times every day.

---

## 📂 Project Structure

```
Wp mess menu/
│
├── server.js               # Express API & WebSocket Server
├── whatsapp.js             # WhatsApp Web connection & messaging engine
├── scheduler.js            # Node-cron automated meal notification scheduler
├── start.bat               # Windows 1-click launcher script
│
├── config/
│   └── settings.json       # Alert timings, target group, and template config
│
├── data/
│   ├── menu.json           # Active 7-day weekly mess menu & special date overrides
│   └── logs.json           # Message dispatch history
│
├── public/                 # Web Dashboard
│   ├── index.html          # Modern Tailwind CSS dashboard
│   ├── style.css           # Custom sleek UI styling
│   ├── app.js              # Real-time WebSocket & client controller
│   └── sample_menu_template.xlsx # Pre-built template for Excel upload
│
└── auth_info_baileys/      # Saved WhatsApp multi-file auth credentials
```
