# Arduino Smart Dashboard 🌿

Hệ thống giám sát nhiệt độ, độ ẩm và điều khiển quạt/máy bơm tự động.

## Kiến trúc

```
Arduino Mega → USB → Node.js (local) → Firebase RTDB → Web Dashboard (public)
```

## Cài đặt

```bash
cd web-dashboard
npm install
```

Sửa `server.js` → điền Firebase config + cổng COM Arduino

```bash
node server.js
```

Mở: http://localhost:3000
