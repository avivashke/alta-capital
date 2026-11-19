#!/usr/bin/env bash
# Alta Capital — One-Click Free Local AI Models Installer for Linux & macOS (Ollama GPU/CPU)
set -euo pipefail

echo "=============================================================="
echo "  Alta Capital — Local Machine Free AI Models Setup (Ollama)"
echo "=============================================================="

export OLLAMA_ORIGINS="*"
export OLLAMA_HOST="0.0.0.0:11434"

# 1. Detect RAM (GB)
RAM_GB=8
if [ "$(uname -s)" = "Darwin" ]; then
  RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
elif [ -r /proc/meminfo ]; then
  RAM_KB=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  RAM_GB=$(( RAM_KB / 1024 / 1024 ))
fi
echo "Detected System RAM: ${RAM_GB} GB"

# 2. Install Ollama if missing
if ! command -v ollama >/dev/null 2>&1; then
  echo "Installing Ollama..."
  if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install ollama
  else
    curl -fsSL https://ollama.com/install.sh | sh
  fi
fi

# 3. Start Ollama if not running
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Starting Ollama server with OLLAMA_ORIGINS=* ..."
  nohup ollama serve >/tmp/ollama-alta.log 2>&1 &
  sleep 3
fi

# 4. Pull RAM-matched free models (Hebrew + Quant + Reasoning)
MODELS=("qwen2.5:3b" "llama3.2:3b")
if [ "$RAM_GB" -ge 12 ]; then
  MODELS+=("qwen2.5:7b" "deepseek-r1:7b")
fi
if [ "$RAM_GB" -ge 24 ]; then
  MODELS+=("qwen2.5-coder:7b")
fi

echo "Pulling free local models: ${MODELS[*]}"
for m in "${MODELS[@]}"; do
  echo "  -> ollama pull $m"
  ollama pull "$m"
done

echo ""
echo "Installed local models:"
ollama list || true
echo ""
echo "DONE! Alta Capital will automatically detect & add these models to your AI Pool."
