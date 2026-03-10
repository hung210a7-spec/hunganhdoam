@echo off
title Arduino Dashboard Server
echo ================================
echo  Arduino Dashboard Server
echo  http://localhost:3000
echo ================================
echo.
echo Doi Arduino cam USB vao...

:wait_for_port
node -e "const {SerialPort}=require('serialport');SerialPort.list().then(p=>{const found=p.find(x=>x.manufacturer&&(x.manufacturer.toLowerCase().includes('wch')||x.manufacturer.toLowerCase().includes('ch340')||x.manufacturer.toLowerCase().includes('arduino')));if(!found){console.log('Chua tim thay Arduino... Dang cho...');process.exit(1);}else{console.log('Da tim thay Arduino tai '+x.path+'!');process.exit(0);}});" 2>nul
if %errorlevel% neq 0 (
    timeout /t 3 /nobreak >nul
    goto wait_for_port
)

echo.
echo Khoi dong server...
cd /d C:\Users\Windows\Downloads\hung-anh-finance\rfid-system\web-dashboard
node server.js
pause
