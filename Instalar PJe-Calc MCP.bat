@echo off
chcp 65001 >nul
title PJe-Calc MCP - Instalar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalador\iniciar.ps1" instalar
if errorlevel 1 pause
