@echo off
REM נסגר תהליך קיים על פורט 11434 (אם קיים)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :11434 ^| find "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>&1
)

REM מריץ את Ollama במצב רקע
start "" /B ollama serve
