# ☁️ How to Run 24/7 Automation (When Laptop and Phone are OFF)

To make sure your mess menu notifications are sent every single day on time **even when your laptop is shut down and your phone is switched off**, the automation must run on a **Free Cloud Server**.

---

## ❓ Frequently Asked Questions

### 1. Does my phone need to stay ON?
**NO.** WhatsApp uses the modern **Multi-Device protocol**. Once you scan the QR code to connect the bot, WhatsApp creates an independent linked session. Your phone can be out of battery, switched off, or in airplane mode — WhatsApp will still deliver the messages from the server to your group!

### 2. Can my laptop stay OFF?
**YES, once deployed to the cloud.** A laptop running locally stops executing programs when powered off. By putting this app on a free cloud hosting platform (like Render or Railway), the server runs 24/7 inside a data center.

### 3. How do I update the monthly menu when my laptop is off?
You will have your own private website link (e.g. `https://my-mess-menu.onrender.com`).
Whenever a new month starts:
1. Open that link on **any browser (even on your phone)**.
2. Simply **drag & drop** your new monthly Excel sheet into the drop zone.
3. The server immediately parses it and runs automatically for the rest of the month!

---

## 🚀 3-Minute Free Cloud Deployment Guide (Render.com)

Render provides free hosting for web services. Follow these 3 easy steps:

### Step 1: Upload this project to GitHub
1. Open PowerShell or Terminal in this folder:
   ```powershell
   git init
   git add .
   git commit -m "Initial commit for MessMate 24/7 automation"
   ```
2. Create a new repository on [GitHub](https://github.com) (name it `mess-menu-automation`, public or private).
3. Push your code:
   ```powershell
   git remote add origin https://github.com/YOUR_USERNAME/mess-menu-automation.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Deploy for Free on Render
1. Go to [Render.com](https://render.com) and sign up / log in with your GitHub account.
2. Click **"New +"** in the top right > **"Web Service"**.
3. Select your GitHub repository (`mess-menu-automation`).
4. Set the settings:
   - **Name**: `my-mess-menu` (or any name you like)
   - **Region**: Choose the closest region (e.g. Singapore or Frankfurt)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free**
5. Click **"Deploy Web Service"**.
6. Wait 1-2 minutes until Render gives you your live URL (e.g., `https://my-mess-menu.onrender.com`).

---

### Step 3: Link WhatsApp & Set Target Group
1. Open your live URL on your computer or phone.
2. Point your WhatsApp camera (*WhatsApp > Linked Devices > Link a Device*) at the QR code on your live site.
3. Once connected, choose your hostel mess WhatsApp group from the dropdown and click **"Set as Target Group"**.
4. Drop your monthly Excel menu file into the large drop box.

---

### 💡 Pro Tip: Keeping Free Tier Awake 24/7
Free tier web services on Render go to sleep after 15 minutes of web inactivity.
To prevent this and keep it running 24/7:
1. Go to [UptimeRobot.com](https://uptimerobot.com) (100% Free).
2. Click **"Add New Monitor"**:
   - **Monitor Type**: `HTTP(s)`
   - **Friendly Name**: `Mess Menu Bot Keep-Alive`
   - **URL**: `https://your-service-name.onrender.com/health`
   - **Monitoring Interval**: `Every 5 minutes`
3. Click **Create Monitor**.
Now your cloud server will stay awake **24/7/365** without ever sleeping!
