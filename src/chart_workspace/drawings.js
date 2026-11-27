// TradingView Drawing Tools Manager
// Supports Trendline, Ray, Horizontal Line, Vertical Line, Fibonacci Retracement,
// Gann Fan, Rectangle, Measure Tool, Text Note, Magnet snap, Selection with Point-Deletion,
// Undo/Redo, and dynamic price-time coordinate anchoring.

import { toast } from '../ui.js';

export const DRAWING_NAMES = {
  trendline: 'קו מגמה (Trendline)',
  ray: 'קרן (Ray)',
  horizontal: 'קו אופקי (Horizontal Line)',
  vertical: 'קו אנכי (Vertical Line)',
  fibonacci: 'רמות פיבונאצ׳י (Fibonacci Retracement)',
  gann_fan: 'מניפת גאן (Gann Fan)',
  rectangle: 'מלבן / אזור (Rectangle)',
  measure: 'סרגל מדידה (Measure Tool)',
  text: 'הערת טקסט (Text Note)',
};

export class DrawingManager {
  constructor(overlaySvgEl, tvEngine, { symbol = 'BTCUSDT', tf = '1h', onDrawingsChange = null } = {}) {
    this.svg = overlaySvgEl;
    this.engine = tvEngine;
    this.symbol = symbol;
    this.tf = tf;
    this.onDrawingsChange = onDrawingsChange;
    this.activeTool = null;
    this.drawings = [];
    this.undoStack = [];
    this.redoStack = [];
    this.isDrawing = false;
    this.currentDrawing = null;
    this.selectedDrawing = null;
    this.magnetMode = false;
    this.locked = false;
    this.popoverEl = null;

    this.setupEvents();
    this.loadFromStorage();
    this.setupEngineSync();
  }

  setContext(symbol, tf) {
    this.symbol = symbol;
    this.tf = tf;
    this.selectedDrawing = null;
    this.hidePopover();
    this.loadFromStorage();
  }

  setupEngineSync() {
    if (this.engine?.chart?.timeScale()) {
      try {
        this.engine.chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
          this.render();
          this.updatePopoverPosition();
        });
      } catch {}
    }
  }

  setTool(toolName) {
    this.activeTool = toolName;
    if (toolName) {
      this.selectedDrawing = null;
      this.hidePopover();
    }
    if (this.svg) {
      this.svg.style.cursor = toolName ? 'crosshair' : 'default';
      this.svg.style.pointerEvents = toolName ? 'all' : 'none';
    }
    this.render();
  }

  setupEvents() {
    if (!this.svg) return;

    this.svg.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));

    // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Escape, Delete, Backspace)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if (e.key === 'Escape') {
        if (this.selectedDrawing) {
          this.selectedDrawing = null;
          this.hidePopover();
          this.render();
        } else {
          this.cancelCurrent();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedDrawing && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
          e.preventDefault();
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
    if (this.locked) return;
    if (!this.activeTool) {
      // If clicking directly on empty background, deselect
      if (e.target === this.svg && this.selectedDrawing) {
        this.selectedDrawing = null;
        this.hidePopover();
        this.render();
      }
      return;
    }

    const pt = this.getCanvasPoint(e);

    if (this.activeTool === 'text') {
      const textPrompt = window.prompt('הזן הערת טקסט לגרף:', 'רמת מפתח / תמיכה');
      if (!textPrompt) {
        this.setTool(null);
        return;
      }
      this.pushHistory();
      const newD = {
        id: `draw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type: 'text',
        x1: pt.x,
        y1: pt.y,
        text: textPrompt,
        color: '#e2e8f0',
      };
      this.anchorToCoordinates(newD);
      this.drawings.push(newD);
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
    this.anchorToCoordinates(this.currentDrawing);
    this.pushHistory();
    const created = this.currentDrawing;
    this.currentDrawing = null;
    this.setTool(null);
    this.saveToStorage();
    this.render();
    this.selectDrawing(created.id);
  }

  anchorToCoordinates(d) {
    if (!this.engine?.chart || !this.engine?.mainSeries) return;
    const ts = this.engine.chart.timeScale();
    const series = this.engine.mainSeries;
    try {
      if (d.x1 != null) d.time1 = ts.coordinateToTime(d.x1);
      if (d.y1 != null) d.price1 = series.coordinateToPrice(d.y1);
      if (d.x2 != null) d.time2 = ts.coordinateToTime(d.x2);
      if (d.y2 != null) d.price2 = series.coordinateToPrice(d.y2);
    } catch {}
  }

  pushHistory() {
    this.undoStack.push(JSON.parse(JSON.stringify(this.drawings)));
    if (this.undoStack.length > 30) this.undoStack.shift();
    this.redoStack = [];
    if (this.onDrawingsChange) this.onDrawingsChange(this.drawings);
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
    this.selectedDrawing = null;
    this.hidePopover();
    this.saveToStorage();
    this.render();
  }

  redo() {
    if (!this.redoStack.length) return;
    const next = this.redoStack.pop();
    this.undoStack.push(JSON.parse(JSON.stringify(this.drawings)));
    this.drawings = next || [];
    this.selectedDrawing = null;
    this.hidePopover();
    this.saveToStorage();
    this.render();
  }

  selectDrawing(id) {
    const found = this.drawings.find((d) => d.id === id);
    if (!found) {
      this.selectedDrawing = null;
      this.hidePopover();
      this.render();
      return;
    }
    this.selectedDrawing = found;
    this.render();
    this.showPopover(found);
  }

  deleteDrawing(id) {
    const target = this.drawings.find((d) => d.id === id);
    const label = target ? (DRAWING_NAMES[target.type] || 'פריט') : 'פריט';
    this.pushHistory();
    this.drawings = this.drawings.filter((d) => d.id !== id);
    if (this.selectedDrawing?.id === id) {
      this.selectedDrawing = null;
      this.hidePopover();
    }
    this.saveToStorage();
    this.render();
    toast(`${label} נמחק מהגרף`, 'ok');
  }

  clearAll() {
    if (!this.drawings.length) return;
    this.pushHistory();
    this.drawings = [];
    this.selectedDrawing = null;
    this.hidePopover();
    this.saveToStorage();
    this.render();
  }

  saveToStorage() {
    try {
      const key = `alta_drawings_${this.symbol}_${this.tf}`;
      localStorage.setItem(key, JSON.stringify(this.drawings));
      if (this.onDrawingsChange) this.onDrawingsChange(this.drawings);
    } catch {}
  }

  loadFromStorage() {
    try {
      const key = `alta_drawings_${this.symbol}_${this.tf}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        this.drawings = JSON.parse(saved) || [];
        this.render();
        if (this.onDrawingsChange) this.onDrawingsChange(this.drawings);
      }
    } catch {}
  }

  showPopover(d) {
    this.hidePopover();
    if (!this.svg || !this.svg.parentElement) return;

    const parent = this.svg.parentElement;
    const pop = document.createElement('div');
    pop.className = 'tv-drawing-popover';
    pop.style.position = 'absolute';
    pop.style.zIndex = '25';
    pop.style.display = 'flex';
    pop.style.alignItems = 'center';
    pop.style.gap = '8px';
    pop.style.background = 'rgba(15, 23, 42, 0.96)';
    pop.style.border = '1px solid rgba(56, 189, 248, 0.45)';
    pop.style.borderRadius = '8px';
    pop.style.padding = '5px 10px';
    pop.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.6)';
    pop.style.fontSize = '12px';
    pop.style.color = '#e2e8f0';
    pop.style.pointerEvents = 'auto';

    const label = DRAWING_NAMES[d.type] || d.type;
    const titleSpan = document.createElement('span');
    titleSpan.style.fontWeight = '700';
    titleSpan.style.color = '#38bdf8';
    titleSpan.textContent = label;
    pop.appendChild(titleSpan);

    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.style.padding = '2px 8px';
    delBtn.style.fontSize = '11px';
    delBtn.style.background = '#dc2626';
    delBtn.style.color = '#ffffff';
    delBtn.style.border = 'none';
    delBtn.style.borderRadius = '5px';
    delBtn.style.cursor = 'pointer';
    delBtn.textContent = '🗑️ מחק פריט';
    delBtn.title = 'מחק ציור זה מהגרף (או הקש Delete/Backspace)';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      this.deleteDrawing(d.id);
    };
    pop.appendChild(delBtn);

    // Close / Deselect Button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn btn-sm btn-ghost';
    closeBtn.style.padding = '2px 6px';
    closeBtn.style.fontSize = '11px';
    closeBtn.textContent = '✕';
    closeBtn.title = 'בטל בחירה';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.selectedDrawing = null;
      this.hidePopover();
      this.render();
    };
    pop.appendChild(closeBtn);

    parent.appendChild(pop);
    this.popoverEl = pop;
    this.updatePopoverPosition();
  }

  updatePopoverPosition() {
    if (!this.popoverEl || !this.selectedDrawing) return;
    const d = this.selectedDrawing;
    const pts = this.computeRenderPoints(d);
    const midX = (pts.x1 + (pts.x2 != null ? pts.x2 : pts.x1)) / 2;
    const minY = Math.min(pts.y1, pts.y2 != null ? pts.y2 : pts.y1);

    const left = Math.max(10, Math.min(midX - 70, (this.svg.clientWidth || 800) - 200));
    const top = Math.max(10, minY - 38);

    this.popoverEl.style.left = `${left}px`;
    this.popoverEl.style.top = `${top}px`;
  }

  hidePopover() {
    if (this.popoverEl) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
  }

  computeRenderPoints(d) {
    let x1 = d.x1;
    let y1 = d.y1;
    let x2 = d.x2;
    let y2 = d.y2;

    if (this.engine?.chart && this.engine?.mainSeries) {
      const ts = this.engine.chart.timeScale();
      const series = this.engine.mainSeries;
      if (d.time1 != null) {
        const nx1 = ts.timeToCoordinate(d.time1);
        if (nx1 != null) x1 = nx1;
      }
      if (d.price1 != null) {
        const ny1 = series.priceToCoordinate(d.price1);
        if (ny1 != null) y1 = ny1;
      }
      if (d.time2 != null) {
        const nx2 = ts.timeToCoordinate(d.time2);
        if (nx2 != null) x2 = nx2;
      }
      if (d.price2 != null) {
        const ny2 = series.priceToCoordinate(d.price2);
        if (ny2 != null) y2 = ny2;
      }
    }
    return { x1, y1, x2, y2 };
  }

  render() {
    if (!this.svg) return;
    this.svg.textContent = '';

    for (const d of this.drawings) {
      const isSelected = this.selectedDrawing?.id === d.id;
      const pts = this.computeRenderPoints(d);
      const { x1, y1, x2, y2 } = pts;

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('data-id', d.id);
      g.style.cursor = 'pointer';
      g.style.pointerEvents = 'auto';

      g.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectDrawing(d.id);
      });

      if (d.type === 'horizontal') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', '0');
        line.setAttribute('x2', '100%');
        line.setAttribute('y1', String(y1));
        line.setAttribute('y2', String(y1));
        line.setAttribute('stroke', isSelected ? '#38bdf8' : d.color);
        line.setAttribute('stroke-width', String(isSelected ? (d.strokeWidth || 2) + 1.5 : d.strokeWidth || 2));
        line.setAttribute('stroke-dasharray', '4,3');
        g.appendChild(line);
      } else if (d.type === 'vertical') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('x2', String(x1));
        line.setAttribute('y1', '0');
        line.setAttribute('y2', '100%');
        line.setAttribute('stroke', isSelected ? '#38bdf8' : '#a855f7');
        line.setAttribute('stroke-width', String(isSelected ? (d.strokeWidth || 2) + 1.5 : d.strokeWidth || 2));
        line.setAttribute('stroke-dasharray', '3,3');
        g.appendChild(line);
      } else if (d.type === 'fibonacci') {
        const fibRatios = [
          { r: 0, c: '#94a3b8' },
          { r: 0.236, c: '#f43f5e' },
          { r: 0.382, c: '#eab308' },
          { r: 0.5, c: '#10b981' },
          { r: 0.618, c: '#06b6d4' },
          { r: 0.786, c: '#8b5cf6' },
          { r: 1.0, c: '#94a3b8' },
        ];
        const dy = (y2 != null ? y2 : y1) - y1;
        const xMin = Math.min(x1, x2 != null ? x2 : x1);
        const xMax = Math.max(x1, x2 != null ? x2 : x1) + 120;

        fibRatios.forEach((fib) => {
          const y = y1 + dy * fib.r;
          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(xMin));
          line.setAttribute('x2', String(xMax));
          line.setAttribute('y1', String(y));
          line.setAttribute('y2', String(y));
          line.setAttribute('stroke', fib.c);
          line.setAttribute('stroke-width', isSelected ? '2' : '1.5');
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
        const slopes = [
          { name: '1x8', m: 0.125, c: '#64748b' },
          { name: '1x4', m: 0.25, c: '#38bdf8' },
          { name: '1x2', m: 0.5, c: '#e0b64a' },
          { name: '1x1', m: 1.0, c: '#f59e0b', main: true },
          { name: '2x1', m: 2.0, c: '#e0b64a' },
          { name: '4x1', m: 4.0, c: '#38bdf8' },
          { name: '8x1', m: 8.0, c: '#64748b' },
        ];
        const dx = Math.max(40, (x2 != null ? x2 : x1 + 100) - x1);
        const baseDy = (y2 != null ? y2 : y1 + 100) - y1;

        slopes.forEach((s) => {
          const ray = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          ray.setAttribute('x1', String(x1));
          ray.setAttribute('y1', String(y1));
          ray.setAttribute('x2', String(x1 + dx * 2));
          ray.setAttribute('y2', String(y1 + baseDy * s.m * 2));
          ray.setAttribute('stroke', s.c);
          ray.setAttribute('stroke-width', s.main || isSelected ? '2' : '1');
          ray.setAttribute('stroke-opacity', '0.85');
          g.appendChild(ray);

          const tagEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          tagEl.setAttribute('x', String(x1 + dx * 1.8));
          tagEl.setAttribute('y', String(y1 + baseDy * s.m * 1.8 - 4));
          tagEl.setAttribute('fill', s.c);
          tagEl.setAttribute('font-size', '10');
          tagEl.setAttribute('font-family', 'monospace');
          tagEl.textContent = s.name;
          g.appendChild(tagEl);
        });
      } else if (d.type === 'rectangle') {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const rx = Math.min(x1, x2 != null ? x2 : x1);
        const ry = Math.min(y1, y2 != null ? y2 : y1);
        const rw = Math.max(4, Math.abs((x2 != null ? x2 : x1) - x1));
        const rh = Math.max(4, Math.abs((y2 != null ? y2 : y1) - y1));
        rect.setAttribute('x', String(rx));
        rect.setAttribute('y', String(ry));
        rect.setAttribute('width', String(rw));
        rect.setAttribute('height', String(rh));
        rect.setAttribute('fill', isSelected ? 'rgba(56, 189, 248, 0.22)' : 'rgba(56, 189, 248, 0.12)');
        rect.setAttribute('stroke', isSelected ? '#38bdf8' : d.color);
        rect.setAttribute('stroke-width', String(isSelected ? 2.5 : d.strokeWidth || 2));
        g.appendChild(rect);
      } else if (d.type === 'measure') {
        const dx = (x2 != null ? x2 : x1) - x1;
        const dy = (y2 != null ? y2 : y1) - y1;
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', String(Math.min(x1, x2 != null ? x2 : x1)));
        rect.setAttribute('y', String(Math.min(y1, y2 != null ? y2 : y1)));
        rect.setAttribute('width', String(Math.abs(dx)));
        rect.setAttribute('height', String(Math.abs(dy)));
        rect.setAttribute('fill', dy < 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)');
        rect.setAttribute('stroke', dy < 0 ? '#10b981' : '#f43f5e');
        g.appendChild(rect);

        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', String((x2 != null ? x2 : x1) + 8));
        txt.setAttribute('y', String(y2 != null ? y2 : y1));
        txt.setAttribute('fill', dy < 0 ? '#34d399' : '#fb7185');
        txt.setAttribute('font-size', '11');
        txt.setAttribute('font-family', 'monospace');
        txt.textContent = `Δ ${Math.abs(Math.round(dy))}px (${(Math.abs(dy) * 0.12).toFixed(1)}%)`;
        g.appendChild(txt);
      } else if (d.type === 'text') {
        const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', String(x1));
        txt.setAttribute('y', String(y1));
        txt.setAttribute('fill', isSelected ? '#38bdf8' : d.color || '#e2e8f0');
        txt.setAttribute('font-size', '13');
        txt.setAttribute('font-weight', '600');
        txt.setAttribute('font-family', 'Heebo, sans-serif');
        txt.textContent = d.text || '';
        g.appendChild(txt);
      } else if (d.type === 'ray') {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        const dx = (x2 != null ? x2 : x1) - x1;
        const dy = (y2 != null ? y2 : y1) - y1;
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x1 + dx * 10));
        line.setAttribute('y2', String(y1 + dy * 10));
        line.setAttribute('stroke', isSelected ? '#38bdf8' : d.color);
        line.setAttribute('stroke-width', String(isSelected ? 3 : d.strokeWidth || 2));
        g.appendChild(line);
      } else {
        // Standard Trendline
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2 != null ? x2 : x1));
        line.setAttribute('y2', String(y2 != null ? y2 : y1));
        line.setAttribute('stroke', isSelected ? '#38bdf8' : d.color);
        line.setAttribute('stroke-width', String(isSelected ? 3 : d.strokeWidth || 2));
        g.appendChild(line);
      }

      // If selected, render anchor handle dots
      if (isSelected) {
        const dot1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot1.setAttribute('cx', String(x1));
        dot1.setAttribute('cy', String(y1));
        dot1.setAttribute('r', '5');
        dot1.setAttribute('fill', '#38bdf8');
        dot1.setAttribute('stroke', '#0f172a');
        dot1.setAttribute('stroke-width', '2');
        g.appendChild(dot1);

        if (x2 != null && y2 != null) {
          const dot2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot2.setAttribute('cx', String(x2));
          dot2.setAttribute('cy', String(y2));
          dot2.setAttribute('r', '5');
          dot2.setAttribute('fill', '#38bdf8');
          dot2.setAttribute('stroke', '#0f172a');
          dot2.setAttribute('stroke-width', '2');
          g.appendChild(dot2);
        }
      }

      this.svg.appendChild(g);
    }
  }
}
