@echo off
chcp 65001 >nul
title PJe-Calc MCP - Conferir
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalador\iniciar.ps1" conferir
if errorlevel 1 pause
