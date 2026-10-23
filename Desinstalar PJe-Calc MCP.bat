@echo off
chcp 65001 >nul
title PJe-Calc MCP - Desinstalar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalador\iniciar.ps1" desinstalar
if errorlevel 1 pause
