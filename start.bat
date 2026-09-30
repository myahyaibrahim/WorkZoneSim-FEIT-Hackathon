@echo off
cd /d "%~dp0"
start "" http://localhost:8090
node server.js 8090
