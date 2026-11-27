// TradingView Drawing Tools Manager
// Supports Trendline, Ray, Horizontal Line, Vertical Line, Fibonacci Retracement,
// Gann Fan, Rectangle, Measure Tool, Text Note, Magnet snap, Undo/Redo, and localStorage persistence.

export class DrawingManager {
  constructor(overlaySvgEl, tvEngine, { symbol = 'BTCUSDT', tf = '1h' } = {}) {
    this.svg = overlaySvgEl;
    this.engine = tvEngine;
    this.symbol = symbol;
    this.tf = tf;
    this.activeTool = null;
    this.drawings = [];
    this.undoStack = [];
    this.redoStack = [];
    this.isDrawing = false;
    this.currentDrawing = null;
    this.selectedDrawing = null;
    this.magnetMode = false;
    this.locked = false;

    this.setupEvents();
    this.loadFromStorage();
  }

  setContext(symbol, tf) {
    this.symbol = symbol;
    this.tf = tf;
    this.loadFromStorage();
  }

  setTool(toolName) {
    this.activeTool = toolName;
    if (this.svg) {
      this.svg.style.cursor = toolName ? 'crosshair' : 'default';
      this.svg.style.pointerEvents = toolName || this.drawings.length ? 'all' : 'none';
    }
  }

  setupEvents() {
    if (!this.svg) return;

    this.svg.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));

    // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Escape, Delete)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === 'Escape') {
        this.cancelCurrent();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedDrawing) {
          this.deleteDrawing(this.selectedDrawing.id);
        }
      }
    });
  }

  getCanvasPoint(e) {
    const rect = this.svg.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    if (this.magnetMode && this.engine?.candles?.length) {
      const candles = this.engine.candles;
      const ts = this.engine.chart?.timeScale();
      const series = this.engine.mainSeries;
      if (ts && series) {
        let bestDist = 25;
        let snapX = x;
        let snapY = y;
        for (const c of candles.slice(-60)) {
          const t = c.t || c.time;
          const cx = ts.timeToCoordinate(t > 1e11 ? Math.floor(t / 1000) : t);
          if (cx != null && Math.abs(cx - x) < bestDist) {
            const highY = series.priceToCoordinate(c.h ?? c.high ?? c.c);
            const lowY = series.priceToCoordinate(c.l ?? c.low ?? c.c);
            if (highY != null && Math.abs(highY - y) < Math.abs(snapY - y)) {
              snapX = cx;
              snapY = highY;
            }
            if (lowY != null && Math.abs(lowY - y) < Math.abs(snapY - y)) {
              snapX = cx;
              snapY = lowY;
            }
          }
        }
        x = snapX;
        y = snapY;
      }
    }
    return { x, y };
  }

  onMouseDown(e) {
    if (!this.activeTool || this.locked) return;
    const pt = this.getCanvasPoint(e);

    if (this.activeTool === 'text') {
      const textPrompt = window.prompt('הזן הערת טקסט לגרף:', 'רמת מפתח / תמיכה');
      if (!textPrompt) {
        this.setTool(null);
        return;
      }
      this.pushHistory();
      this.drawings.push({
        id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'text',
        x1: pt.x,
        y1: pt.y,
        text: textPrompt,
        color: '#e2e8f0',
      });
      this.saveToStorage();
      this.render();
      this.setTool(null);
      return;
    }

    this.isDrawing = true;
    this.currentDrawing = {
      id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: this.activeTool,
      x1: pt.x,
      y1: pt.y,
      x2: pt.x,
      y2: pt.y,
      color: '#38bdf8',
      strokeWidth: 2,
    };
    this.drawings.push(this.currentDrawing);
    this.render();
  }

  onMouseMove(e) {
    if (!this.isDrawing || !this.currentDrawing) return;
    const pt = this.getCanvasPoint(e);
    this.currentDrawing.x2 = pt.x;
    this.currentDrawing.y2 = pt.y;
    this.render();
  }

  onMouseUp() {
    if (!this.isDrawing || !this.currentDrawing) return;
    this.isDrawing = false;
    this.pushHistory();
    this.currentDrawing = null;
    this.setTool(null);
    this.saveToStorage();
    this.render();
  }

  pushHistory() {
    this.undoStack.push(JSON.parse(JSON.stringify(this.drawings)));
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
  }

  cancelCurrent() {
    if (this.isDrawing && this.currentDrawing) {
      this.drawings = this.drawings.filter((d) => d.id !== this.currentDrawing.id);
      this.isDrawing = false;
      this.currentDrawing = null;
      this.render();
    }
    this.setTool(null);
  }

  undo() {
    if (!this.undoStack.length) return;
    const prev = this.undoStack.pop();
    this.redoStack.push(JSON.parse(JSON.stringify(this.drawings)));
    this.drawings = prev || [];
    this.saveToStorage();
    this.render();
  }

  redo() {
    if (!this.redoStack.length) return;
    const next = this.redoStack.pop();
    this.undoStack.push(JSON.parse(JSON.stringify(this.drawings)));
    this.drawings = next || [];
    this.saveToStorage();
    this.render();
  }

  deleteDrawing(id) {
    this.pushHistory();
    this.drawings = this.drawings.filter((d) => d.id !== id);
    if (this.selectedDrawing?.id === id) this.selectedDrawing = null;
    this.saveToStorage();
    this.render();
  }

  clearAll() {
    if (!this.drawings.length) return;
    this.pushHistory();
    this.drawings = [];
    this.selectedDrawing = null;
    this.saveToStorage();
    this.render();
  }

  saveToStorage() {
    try {
      const key = `alta_drawings_${this.symbol}_${this.tf}`;
      localStorage.setItem(key, JSON.stringify(this.drawings));
    } catch {}
  }

  loadFromStorage() {
    try {
      const key = `alta_drawings_${this.symbol}_${this.tf}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        this.drawings = JSON.parse(saved) || [];
        this.render();
      }
    } catch {}
  }

  render() {
    if (!this.svg) return;
    this.svg.textContent = '';

    for (const d of this.drawings) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-id', d.id);
      g.style.cursor = 'pointer';

      if (d.type === 'horizontal') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '0');
        line.setAttribute('x2', '100%');
        line.setAttribute('y1', String(d.y1));
        line.setAttribute('y2', String(d.y1));
        line.setAttribute('stroke', d.color);
        line.setAttribute('stroke-width', String(d.strokeWidth));
        line.setAttribute('stroke-dasharray', '4,3');
        g.appendChild(line);
      } else if (d.type === 'vertical') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(d.x1));
        line.setAttribute('x2', String(d.x1));
        line.setAttribute('y1', '0');
        line.setAttribute('y2', '100%');
        line.setAttribute('stroke', '#a855f7');
        line.setAttribute('stroke-width', String(d.strokeWidth));
        line.setAttribute('stroke-dasharray', '3,3');
        g.appendChild(line);
      } else if (d.type === 'fibonacci') {
        // Fibonacci Retracement Levels (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0)
        const fibRatios = [
          { r: 0, c: '#94a3b8' },
          { r: 0.236, c: '#f43f5e' },
          { r: 0.382, c: '#eab308' },
          { r: 0.5, c: '#10b981' },
          { r: 0.618, c: '#06b6d4' },
          { r: 0.786, c: '#8b5cf6' },
          { r: 1.0, c: '#94a3b8' },
        ];
        const dy = d.y2 - d.y1;
        const xMin = Math.min(d.x1, d.x2);
        const xMax = Math.max(d.x1, d.x2) + 120;

        fibRatios.forEach((fib) => {
          const y = d.y1 + dy * fib.r;
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(xMin));
          line.setAttribute('x2', String(xMax));
          line.setAttribute('y1', String(y));
          line.setAttribute('y2', String(y));
          line.setAttribute('stroke', fib.c);
          line.setAttribute('stroke-width', '1.5');
          line.setAttribute('stroke-dasharray', fib.r === 0.5 || fib.r === 0.618 ? 'none' : '3,2');
          g.appendChild(line);

          const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          lbl.setAttribute('x', String(xMin + 6));
          lbl.setAttribute('y', String(y - 4));
          lbl.setAttribute('fill', fib.c);
          lbl.setAttribute('font-size', '10');
          lbl.setAttribute('font-family', 'monospace');
          lbl.textContent = `Fib ${fib.r * 100}%`;
          g.appendChild(lbl);
        });
      } else if (d.type === 'gann_fan') {
        // Gann Fan (1x8, 1x4, 1x3, 1x2, 1x1, 2x1, 3x1, 4x1, 8x1)
        const slopes = [
          { name: '1x8', m: 0.125, c: '#64748b' },
          { name: '1x4', m: 0.25, c: '#38bdf8' },
          { name: '1x2', m: 0.5, c: '#e0b64a' },
          { name: '1x1', m: 1.0, c: '#f59e0b', main: true },
          { name: '2x1', m: 2.0, c: '#e0b64a' },
          { name: '4x1', m: 4.0, c: '#38bdf8' },
          { name: '8x1', m: 8.0, c: '#64748b' },
        ];
        const dx = Math.max(40, d.x2 - d.x1);
        const baseDy = d.y2 - d.y1;

        slopes.forEach((s) => {
          const ray = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          ray.setAttribute('x1', String(d.x1));
          ray.setAttribute('y1', String(d.y1));
          ray.setAttribute('x2', String(d.x1 + dx * 2));
          ray.setAttribute('y2', String(d.y1 + baseDy * s.m * 2));
          ray.setAttribute('stroke', s.c);
          ray.setAttribute('stroke-width', s.main ? '2' : '1');
          ray.setAttribute('stroke-opacity', '0.75');
          g.appendChild(ray);

          const tag = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          tag.setAttribute('x', String(d.x1 + dx * 1.8));
          tag.setAttribute('y', String(d.y1 + baseDy * s.m * 1.8 - 4));
          tag.setAttribute('fill', s.c);
          tag.setAttribute('font-size', '10');
          tag.setAttribute('font-family', 'monospace');
          tag.textContent = s.name;
          g.appendChild(tag);
        });
      } else if (d.type === 'rectangle') {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const rx = Math.min(d.x1, d.x2);
        const ry = Math.min(d.y1, d.y2);
        const rw = Math.max(4, Math.abs(d.x2 - d.x1));
        const rh = Math.max(4, Math.abs(d.y2 - d.y1));
        rect.setAttribute('x', String(rx));
        rect.setAttribute('y', String(ry));
        rect.setAttribute('width', String(rw));
        rect.setAttribute('height', String(rh));
        rect.setAttribute('fill', 'rgba(56, 189, 248, 0.12)');
        rect.setAttribute('stroke', d.color);
        rect.setAttribute('stroke-width', String(d.strokeWidth));
        g.appendChild(rect);
      } else if (d.type === 'measure') {
        const dx = d.x2 - d.x1;
        const dy = d.y2 - d.y1;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(Math.min(d.x1, d.x2)));
        rect.setAttribute('y', String(Math.min(d.y1, d.y2)));
        rect.setAttribute('width', String(Math.abs(dx)));
        rect.setAttribute('height', String(Math.abs(dy)));
        rect.setAttribute('fill', dy < 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)');
        rect.setAttribute('stroke', dy < 0 ? '#10b981' : '#f43f5e');
        g.appendChild(rect);

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', String(d.x2 + 8));
        txt.setAttribute('y', String(d.y2));
        txt.setAttribute('fill', dy < 0 ? '#34d399' : '#fb7185');
        txt.setAttribute('font-size', '11');
        txt.setAttribute('font-family', 'monospace');
        txt.textContent = `Δ ${Math.abs(Math.round(dy))}px (${(Math.abs(dy) * 0.12).toFixed(1)}%)`;
        g.appendChild(txt);
      } else if (d.type === 'text') {
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', String(d.x1));
        txt.setAttribute('y', String(d.y1));
        txt.setAttribute('fill', d.color || '#e2e8f0');
        txt.setAttribute('font-size', '13');
        txt.setAttribute('font-weight', '600');
        txt.setAttribute('font-family', 'Heebo, sans-serif');
        txt.textContent = d.text || '';
        g.appendChild(txt);
      } else if (d.type === 'ray') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const dx = d.x2 - d.x1;
        const dy = d.y2 - d.y1;
        line.setAttribute('x1', String(d.x1));
        line.setAttribute('y1', String(d.y1));
        line.setAttribute('x2', String(d.x1 + dx * 10));
        line.setAttribute('y2', String(d.y1 + dy * 10));
        line.setAttribute('stroke', d.color);
        line.setAttribute('stroke-width', String(d.strokeWidth));
        g.appendChild(line);
      } else {
        // Standard Trendline
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(d.x1));
        line.setAttribute('y1', String(d.y1));
        line.setAttribute('x2', String(d.x2));
        line.setAttribute('y2', String(d.y2));
        line.setAttribute('stroke', d.color);
        line.setAttribute('stroke-width', String(d.strokeWidth));
        g.appendChild(line);
      }

      this.svg.appendChild(g);
    }
  }
}
