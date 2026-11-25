@echo off
cd /d "%~dp0"
start "" "http://localhost:8141/?v=boundary#/demo/delidata"
node server\server.js
