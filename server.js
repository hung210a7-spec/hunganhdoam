/*
 * =====================================================
 *  SERVER NODE.JS — Arduino Dashboard + Firebase
 *  Chạy: node server.js
 *  Web local: http://localhost:3000
 * =====================================================
 */

const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const { SerialPort }      = require('serialport');
const { ReadlineParser }  = require('@serialport/parser-readline');
const { initializeApp }   = require('firebase/app');
const { getDatabase, ref, set, onValue, push } = require('firebase/database');
const path = require('path');

// =====================================================
//  ⚙️ CẤU HÌNH — SỬA CÁC GIÁ TRỊ NÀY
// =====================================================
const BAUD_RATE   = 9600;
const WEB_PORT    = 3000;
const FALLBACK_PORT = 'COM7'; // Dự phòng nếu không tự tìm được

// Tự động tìm cổng COM của Arduino (CH340 chip = wch.cn)
async function findArduinoPort() {
  const { SerialPort } = require('serialport');
  const ports = await SerialPort.list();
  const arduino = ports.find(p =>
    p.manufacturer && (
      p.manufacturer.toLowerCase().includes('wch') ||
      p.manufacturer.toLowerCase().includes('arduino') ||
      p.manufacturer.toLowerCase().includes('ch340') ||
      p.manufacturer.toLowerCase().includes('ch341')
    )
  );
  if (arduino) {
    console.log(`🔍 Tìm thấy Arduino tại: ${arduino.path} (${arduino.manufacturer})`);
    return arduino.path;
  }
  console.warn(`⚠️ Không tự tìm thấy Arduino, dùng cổng mặc định: ${FALLBACK_PORT}`);
  return FALLBACK_PORT;
}


// 🔥 Firebase config — lấy từ Firebase Console
const firebaseConfig = {
  apiKey:            "AIzaSyBoVEofW3IdbppeDdP9ksiIoA_zac0zS5U",
  authDomain:        "hunganh-doam1.firebaseapp.com",
  databaseURL:       "https://hunganh-doam1-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "hunganh-doam1",
  storageBucket:     "hunganh-doam1.firebasestorage.app",
  messagingSenderId: "430690199452",
  appId:             "1:430690199452:web:14018e3458ba9fea788a59"
};
// =====================================================

// Khởi tạo Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db          = getDatabase(firebaseApp);

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

let lastData = { t: '--', h: '--', fan: false, pump: false };
let eventLog = [];

// Ghi log sự kiện
function addEvent(type, status, value) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('vi-VN');
  const dateStr = now.toLocaleDateString('vi-VN');
  let message = '';
  if (type === 'fan') {
    message = status ? `🌡️ Nhiệt độ vượt mức (${value}°C) — Đang hạ nhiệt`
                     : `✅ Nhiệt độ lý tưởng (${value}°C) — Quạt tắt`;
  } else {
    message = status ? `💧 Độ ẩm thấp (${value}%) — Đang cải thiện độ ẩm`
                     : `✅ Độ ẩm lý tưởng (${value}%) — Máy bơm tắt`;
  }
  const event = { type, status, value, message, time: timeStr, date: dateStr, ts: Date.now() };
  eventLog.unshift(event);
  if (eventLog.length > 50) eventLog.pop();

  // Đẩy lên Firebase
  push(ref(db, 'events'), event).catch(console.error);
  return event;
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

// Đẩy sensor data lên Firebase
function pushSensorData(data) {
  set(ref(db, 'sensor'), { ...data, updatedAt: Date.now() }).catch(console.error);
}

let port, parser, prevFan = null, prevPump = null;
let reconnecting = false;

function scheduleReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  console.log('🔄 Đang chờ kết nối lại Serial sau 3 giây...');
  setTimeout(() => { reconnecting = false; connectSerial(); }, 3000);
}

async function connectSerial() {
  // Đóng port cũ nếu còn
  if (port && port.isOpen) { try { port.close(); } catch(_) {} }

  const detectedPort = await findArduinoPort();

  try {
    port = new SerialPort({ path: detectedPort, baudRate: BAUD_RATE });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    port.on('open', () => console.log(`✅ Serial: ${detectedPort} — Đã kết nối!`));


    parser.on('data', (line) => {
      line = line.trim();
      if (!line.startsWith('{')) return;
      try {
        const data = JSON.parse(line);
        lastData = data;
        pushSensorData(data);

        const newEvents = [];
        if (prevFan  !== null && prevFan  !== data.fan)  newEvents.push(addEvent('fan',  data.fan,  data.t));
        if (prevPump !== null && prevPump !== data.pump)  newEvents.push(addEvent('pump', data.pump, data.h));
        prevFan  = data.fan;
        prevPump = data.pump;

        broadcast({ type: 'update', data, events: newEvents });
      } catch (_) {}
    });

    port.on('close', () => {
      console.warn('⚠️ Serial bị ngắt (rút USB?) — Đang chờ kết nối lại...');
      scheduleReconnect();
    });
    port.on('error', (err) => {
      console.error('❌ Serial lỗi:', err.message);
      scheduleReconnect();
    });
  } catch (err) {
    console.error('❌ Không mở được Serial:', err.message);
    scheduleReconnect();
  }
}


// ── API ──
app.post('/api/control', (req, res) => {
  const { device, action } = req.body;
  if (!port || !port.isOpen) return res.json({ ok: false, msg: 'Serial chưa kết nối' });

  if (device === 'auto') {
    port.write('AUTO\n', (err) => {
      if (err) return res.json({ ok: false });
      broadcast({ type: 'autoReset' });
      set(ref(db, 'control'), { cmd: 'AUTO', ts: Date.now() }).catch(console.error);
      res.json({ ok: true });
    });
    return;
  }

  const cmd = `${device.toUpperCase()}:${action.toUpperCase()}\n`;
  port.write(cmd, (err) => {
    if (err) return res.json({ ok: false, msg: err.message });
    const isOn = action.toUpperCase() === 'ON';
    const value = device === 'FAN' ? lastData.t : lastData.h;
    const event = addEvent(device.toLowerCase(), isOn, value);
    // Lưu lệnh lên Firebase để dashboard public cũng gửi được
    set(ref(db, 'control'), { cmd, ts: Date.now() }).catch(console.error);
    broadcast({ type: 'control', event });
    res.json({ ok: true });
  });
});

// Lắng nghe lệnh từ Firebase (từ public dashboard)
onValue(ref(db, 'control'), (snapshot) => {
  const data = snapshot.val();
  if (!data || !data.cmd) return;
  if (!port || !port.isOpen) return;
  // Chỉ xử lý lệnh mới (trong vòng 5 giây)
  if (Date.now() - data.ts > 5000) return;
  port.write(data.cmd + (data.cmd.includes('\n') ? '' : '\n'));
});

app.get('/api/log',  (req, res) => res.json(eventLog));
app.get('/api/data', (req, res) => res.json(lastData));

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'init', data: lastData, log: eventLog }));
});

server.listen(WEB_PORT, () => {
  console.log(`\n🚀 Dashboard: http://localhost:${WEB_PORT}`);
  console.log(`📡 Serial: Auto-detect Arduino\n`);
});

connectSerial();
