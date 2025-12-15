/**
 * Renderizador de Waveform e Gerenciador de Áudio
 */

import { $, clamp } from '../utils.js';
import { COLORS, MARKERS } from '../config.js';

export class WaveformRenderer {
    constructor(app) {
        this.app = app;

        // Canvas elements
        this.wave = $('wave');
        this.mini = $('mini');
        this.spec = $('spec');
        this.labelsWrap = $('labels');

        // Contexts
        this.ctxWave = this.wave?.getContext('2d');
        this.mctx = this.mini?.getContext('2d');
        this.sctx = this.spec?.getContext('2d');

        // Audio
        this.audioCtx = null;
        this.currentBuffer = null;
        this.source = null;

        // View state
        this.zoom = 1;
        this.vzoom = app.prefs.vzoom || 1;
        this.viewStartMs = 0;
        this.cursorMs = 0;
        this.selectedMarkerId = null;

        // Spectrogram cache
        this.specCache = new Map();

        // Decode aborter
        this.audioDecodeAborter = { aborted: false };

        // Hann window for spectrogram
        this.HANN_512 = this.hann(512);

        this.setupEventListeners();
    }

    hann(N) {
        const w = new Float32Array(N);
        for (let n = 0; n < N; n++) {
            w[n] = 0.5 * (1 - Math.cos(2 * Math.PI * n / (N - 1)));
        }
        return w;
    }

    setupEventListeners() {
        if (!this.wave) return;

        // Cache para evitar redesenhos desnecessários
        this._lastCursorX = -1;

        // Mouse move - redesenha APENAS canvas (nenhum DOM)
        this.wave.addEventListener('mousemove', (e) => {
            if (!this.wave || !this.ctxWave || !this.currentBuffer) return;

            const rect = this.wave.getBoundingClientRect();
            const x = clamp(e.clientX - rect.left, 0, rect.width);
            this.cursorMs = this.xToMs(x);
            const cx = this.msToX(this.cursorMs);

            // Se o cursor não mudou, não redesenhar
            if (Math.abs(cx - this._lastCursorX) < 2) return;
            this._lastCursorX = cx;

            // Usar requestAnimationFrame para limitar
            if (!this._cursorPending) {
                this._cursorPending = true;
                requestAnimationFrame(() => {
                    this._cursorPending = false;
                    // Redesenhar APENAS canvas - NENHUM DOM
                    this.drawWave();       // Waveform + cursor
                    this.drawParamFills(); // Preenchimentos coloridos
                    this.drawMarkerLines();// Linhas dos marcadores
                    // NÃO chamar drawMini() nem drawMarkers() durante movimento
                });
            }
        });

        // Click to play
        this.wave.addEventListener('click', () => {
            if (!this.currentBuffer || this.app.selectedRowIndex < 0) return;
            const p = this.app.rows[this.app.selectedRowIndex];
            const totalMs = this.currentBuffer.duration * 1000;
            const offsetMs = clamp(Math.round(p.offset || 0), 0, totalMs);
            const c = Math.round(p.cutoff || 0);
            let cutoffMs = clamp(offsetMs + Math.abs(c), 0, totalMs);
            if (cutoffMs <= offsetMs) cutoffMs = totalMs;
            this.playRegion(offsetMs / 1000, cutoffMs / 1000);
        });

        // Wheel for zoom and navigation
        this.wave.addEventListener('wheel', (e) => {
            if (!this.currentBuffer) return;
            const rect = this.wave.getBoundingClientRect();
            const x = clamp(e.clientX - rect.left, 0, rect.width);
            const hasCtrl = e.ctrlKey || e.metaKey;
            const hasShift = e.shiftKey;
            const hasAlt = e.altKey;

            // Plain wheel: navigate rows
            if (!hasCtrl && !hasShift && !hasAlt) {
                e.preventDefault();
                if (e.deltaY > 0 && this.app.selectedRowIndex < this.app.rows.length - 1) {
                    this.app.selectRow(this.app.selectedRowIndex + 1);
                } else if (e.deltaY < 0 && this.app.selectedRowIndex > 0) {
                    this.app.selectRow(this.app.selectedRowIndex - 1);
                }
                return;
            }

            // Shift+wheel: pan
            if (hasShift && !hasCtrl && !hasAlt) {
                e.preventDefault();
                const totalMs = this.currentBuffer.duration * 1000;
                const vw = this.getViewWindowMs(totalMs);
                const dir = e.deltaY > 0 ? 1 : -1;
                const delta = vw * 0.1 * dir;
                this.viewStartMs = clamp(this.viewStartMs + delta, 0, Math.max(0, totalMs - vw));
                this.drawAll();
                return;
            }

            // Alt+wheel: V-zoom
            if (hasAlt && !hasCtrl) {
                e.preventDefault();
                this.vzoom = clamp((this.vzoom || 1) * (e.deltaY > 0 ? 1 / 1.1 : 1.1), 0.25, 4);
                const vzoomSlider = $('vzoom');
                const vzoomLabel = $('vzoomLabel');
                if (vzoomSlider) vzoomSlider.value = String(this.vzoom);
                if (vzoomLabel) vzoomLabel.textContent = this.vzoom.toFixed(2) + '×';
                this.app.prefs.vzoom = this.vzoom;
                this.drawAll();
                return;
            }

            // Ctrl+wheel: H-zoom
            if (hasCtrl && !hasAlt) {
                e.preventDefault();
                const anchorMs = this.xToMs(x);
                const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
                const oldZoom = this.zoom;
                this.zoom = clamp(oldZoom * factor, 1, 128);
                const zoomSlider = $('zoom');
                const zoomLabel = $('zoomLabel');
                if (zoomSlider) zoomSlider.value = String(this.zoom);
                if (zoomLabel) zoomLabel.textContent = `${Math.round(this.zoom)}×`;
                const totalMs = this.currentBuffer.duration * 1000;
                const vw = this.getViewWindowMs(totalMs);
                this.viewStartMs = clamp(anchorMs - (x / this.wave.width) * vw, 0, Math.max(0, totalMs - vw));
                this.drawAll();
            }
        }, { passive: false });

        // Play button
        const btnPlay = $('btnPlay');
        if (btnPlay) {
            btnPlay.addEventListener('click', () => this.togglePlay());
        }

        // Zoom slider
        const zoomSlider = $('zoom');
        if (zoomSlider) {
            zoomSlider.addEventListener('input', () => {
                this.zoom = Number(zoomSlider.value) || 1;
                const zoomLabel = $('zoomLabel');
                if (zoomLabel) zoomLabel.textContent = `${Math.round(this.zoom)}×`;
                this.drawAll();
            });
        }

        // V-Zoom slider
        const vzoomSlider = $('vzoom');
        if (vzoomSlider) {
            vzoomSlider.addEventListener('input', () => {
                this.vzoom = Number(vzoomSlider.value) || 1;
                const vzoomLabel = $('vzoomLabel');
                if (vzoomLabel) vzoomLabel.textContent = this.vzoom.toFixed(2) + '×';
                this.app.prefs.vzoom = this.vzoom;
                this.drawAll();
            });
        }

        // Spectrogram toggle
        const toggleSpec = $('toggleSpec');
        if (toggleSpec) {
            toggleSpec.addEventListener('change', () => {
                const specWrap = $('specWrap');
                if (specWrap) {
                    specWrap.classList.toggle('hidden', !toggleSpec.checked);
                }
                if (toggleSpec.checked && this.app.selectedRowIndex >= 0) {
                    const idx = this.app.getFileIndexForFilename(this.app.rows[this.app.selectedRowIndex]?.filename || '');
                    if (idx >= 0) this.ensureSpectrogramFor(idx);
                }
                this.drawAll();
            });
        }

        // Marker drag - otimizado para não atualizar DOM durante arrasto
        if (this.labelsWrap) {
            this.labelsWrap.addEventListener('mousedown', (e) => {
                const t = e.target;
                if (!t.classList.contains('handle')) return;
                e.preventDefault();
                const id = t.dataset.mid;

                // Durante arrasto: só atualiza canvas, NÃO atualiza DOM
                const onMove = (ev) => {
                    const rect = this.wave.getBoundingClientRect();
                    const x = clamp(ev.clientX - rect.left, 0, rect.width);
                    // Atualizar apenas o valor interno e redesenhar canvas
                    this.setParamVisualOnly(id, this.xToMs(x));
                };

                // Ao soltar: atualiza DOM (inputs, lista, etc)
                const onUp = () => {
                    removeEventListener('mousemove', onMove);
                    removeEventListener('mouseup', onUp);
                    // Agora sim, atualiza tudo
                    this.app.syncInputsFromRow(this.app.rows[this.app.selectedRowIndex]);
                    this.app.refreshOtoView();
                    // NÃO chamar renderAliasList aqui - desnecessário
                };
                addEventListener('mousemove', onMove);
                addEventListener('mouseup', onUp);
            });

            this.labelsWrap.addEventListener('click', (e) => {
                const m = e.target?.dataset?.mid;
                if (!m) return;
                this.selectedMarkerId = m;
                this.drawAll();
            });
        }

        // Window resize
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        if (!this.wave || !this.mini) return;

        const ratio = Math.max(1, Math.floor(devicePixelRatio || 1));
        const wrapWave = this.wave.parentElement?.getBoundingClientRect().width || 800;
        const wrapMini = this.mini.parentElement?.getBoundingClientRect().width || 800;

        this.wave.width = Math.max(300, Math.floor(wrapWave * ratio));
        this.wave.height = Math.floor(260 * ratio);
        this.ctxWave?.setTransform(ratio, 0, 0, ratio, 0, 0);

        this.mini.width = Math.max(300, Math.floor(wrapMini * ratio));
        this.mini.height = Math.floor(60 * ratio);
        this.mctx?.setTransform(ratio, 0, 0, ratio, 0, 0);

        this.drawAll();
    }

    async decodeAndDraw(item, fileIndex) {
        try {
            this.audioDecodeAborter.aborted = true;
            this.audioDecodeAborter = { aborted: false };
            const aborter = this.audioDecodeAborter;

            this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const arrbuf = await fetch(item.url).then(r => r.arrayBuffer());
            if (aborter.aborted) return;

            this.currentBuffer = await this.audioCtx.decodeAudioData(arrbuf.slice(0));
            if (aborter.aborted) return;

            const srInfo = $('srInfo');
            if (srInfo) {
                srInfo.textContent = `• ${this.currentBuffer.sampleRate} Hz • ${this.currentBuffer.duration.toFixed(2)} s`;
            }

            this.resizeCanvas();

            this.specCache.delete(fileIndex);
            const toggleSpec = $('toggleSpec');
            if (toggleSpec?.checked) {
                await this.ensureSpectrogramFor(fileIndex);
            }

            this.drawAll();
        } catch (error) {
            console.error('Erro ao decodificar áudio:', error);
        }
    }

    getViewWindowMs(totalMs) {
        if (!totalMs) return 0;
        return Math.max(1, totalMs / Math.max(1, this.zoom));
    }

    msToX(ms) {
        if (!this.currentBuffer || !this.wave) return 0;
        const totalMs = this.currentBuffer.duration * 1000;
        const vw = this.getViewWindowMs(totalMs);
        return ((ms - this.viewStartMs) / vw) * this.wave.width;
    }

    xToMs(x) {
        if (!this.currentBuffer || !this.wave) return 0;
        const totalMs = this.currentBuffer.duration * 1000;
        const vw = this.getViewWindowMs(totalMs);
        return this.viewStartMs + (x / this.wave.width) * vw;
    }

    getWaveColors() {
        const waveColorPicker = $('waveColorPicker');
        const waveBgColorPicker = $('waveBgColorPicker');
        return {
            waveColor: waveColorPicker?.value || (this.app.prefs.theme === 'dark' ? '#e2e8f0' : '#000000'),
            waveBg: waveBgColorPicker?.value || (this.app.prefs.theme === 'dark' ? '#020617' : '#ffffff')
        };
    }

    drawWave() {
        if (!this.wave || !this.ctxWave) return;

        const W = this.wave.width, H = this.wave.height, c = this.ctxWave;
        const { waveBg, waveColor } = this.getWaveColors();

        c.clearRect(0, 0, W, H);
        c.fillStyle = waveBg;
        c.fillRect(0, 0, W, H);

        c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--grid') || '#e5e7eb';
        c.beginPath();
        c.moveTo(0, H / 2);
        c.lineTo(W, H / 2);
        c.stroke();

        if (this.currentBuffer) {
            const ch = this.currentBuffer.getChannelData(0);
            const totalMs = this.currentBuffer.duration * 1000;
            const totalSamples = ch.length;
            const vw = this.getViewWindowMs(totalMs);
            const startMs = this.viewStartMs, endMs = startMs + vw;
            const startSamp = Math.floor((startMs / totalMs) * totalSamples);
            const endSamp = Math.min(totalSamples, Math.ceil((endMs / totalMs) * totalSamples));
            const samplesInView = Math.max(1, endSamp - startSamp);
            const step = Math.max(1, Math.floor(samplesInView / W));

            c.beginPath();
            let x = 0;
            for (let i = startSamp; i < endSamp; i += step) {
                let min = 1e9, max = -1e9;
                for (let j = 0; j < step && i + j < endSamp; j++) {
                    const v = ch[i + j];
                    if (v < min) min = v;
                    if (v > max) max = v;
                }
                const mid = H / 2, scale = H * 0.45 * (this.vzoom || 1);
                c.moveTo(x, mid + min * scale);
                c.lineTo(x, mid + max * scale);
                x += 1;
            }
            c.strokeStyle = waveColor;
            c.stroke();
        }

        // Draw cursor
        const cx = this.msToX(this.cursorMs);
        c.strokeStyle = '#f97316';
        c.beginPath();
        c.moveTo(cx, 0);
        c.lineTo(cx, H);
        c.stroke();
    }

    drawParamFills() {
        if (!this.currentBuffer || this.app.selectedRowIndex < 0 || !this.ctxWave) return;

        const p = this.app.rows[this.app.selectedRowIndex];
        const totalMs = this.currentBuffer.duration * 1000;
        const off = clamp(Math.round(p.offset || 0), 0, totalMs);
        const consDur = clamp(Math.round(p.consonant || 0), 0, Math.max(0, totalMs - off));
        const c = Math.round(p.cutoff || 0);
        const consStart = off;
        const consEnd = clamp(off + consDur, 0, totalMs);

        // Lógica correta do cutoff:
        // - Negativo: conta a partir do offset (offset + |cutoff|)
        // - Positivo: conta a partir do FINAL do arquivo (totalMs - cutoff)
        let cutAbs;
        if (c <= 0) {
            // Cutoff negativo ou zero: offset + |cutoff|
            cutAbs = clamp(off + Math.abs(c), 0, totalMs);
        } else {
            // Cutoff positivo: totalMs - cutoff
            cutAbs = clamp(totalMs - c, 0, totalMs);
        }

        const f = (x1, x2, color, a) => {
            const ctx = this.ctxWave;
            const W = ctx.canvas.width;
            const a1 = Math.max(0, Math.min(W, Math.min(x1, x2)));
            const b1 = Math.max(0, Math.min(W, Math.max(x1, x2)));
            if (b1 <= a1) return;
            ctx.save();
            ctx.globalAlpha = a;
            ctx.fillStyle = color;
            ctx.fillRect(a1, 0, b1 - a1, ctx.canvas.height);
            ctx.restore();
        };

        f(this.msToX(0), this.msToX(off), COLORS.offset, 0.12);
        f(this.msToX(consStart), this.msToX(consEnd), COLORS.consonant, 0.12);
        f(this.msToX(cutAbs), this.msToX(totalMs), COLORS.cutoff, 0.12);
    }

    /**
     * Calcula posição absoluta de um marcador em ms
     * Lógica do cutoff:
     * - Negativo: offset + |cutoff|
     * - Positivo: totalMs - cutoff (conta do final do arquivo)
     */
    markerAbs(p, id) {
        const totalMs = this.currentBuffer ? Math.round(this.currentBuffer.duration * 1000) : 0;
        if (id === 'offset') return p.offset || 0;
        if (id === 'consonant') return (p.offset || 0) + (p.consonant || 0);
        if (id === 'preutter') return (p.offset || 0) + (p.preutter || 0);
        if (id === 'overlap') return (p.offset || 0) + (p.overlap || 0);
        if (id === 'cutoff') {
            const c = Math.round(p.cutoff || 0);
            if (c <= 0) {
                // Negativo: offset + |cutoff|
                return clamp((p.offset || 0) + Math.abs(c), 0, totalMs);
            } else {
                // Positivo: totalMs - cutoff
                return clamp(totalMs - c, 0, totalMs);
            }
        }
        return 0;
    }

    drawMarkerLines() {
        if (this.app.selectedRowIndex < 0 || !this.ctxWave) return;

        const p = this.app.rows[this.app.selectedRowIndex];
        const W1 = this.wave.width, H1 = this.wave.height;

        this.ctxWave.save();
        this.ctxWave.lineWidth = 1;

        MARKERS.forEach(m => {
            const x = this.msToX(this.markerAbs(p, m.id));
            if (x < 0 || x > W1) return;

            this.ctxWave.strokeStyle = COLORS[m.id] || '#000';
            this.ctxWave.beginPath();
            this.ctxWave.moveTo(Math.round(x) + 0.5, 0);
            this.ctxWave.lineTo(Math.round(x) + 0.5, H1);
            this.ctxWave.stroke();
        });

        this.ctxWave.restore();
    }

    drawMarkers() {
        if (!this.labelsWrap) return;

        this.labelsWrap.innerHTML = '';
        if (this.app.selectedRowIndex < 0) return;

        const overlayH = this.wave.getBoundingClientRect().height;
        const p = this.app.rows[this.app.selectedRowIndex];

        MARKERS.forEach(m => {
            const msAbs = this.markerAbs(p, m.id);
            const x = this.msToX(msAbs);
            if (x < 0 || x > this.wave.width) return;

            const h = document.createElement('div');
            h.className = 'handle';
            h.style.left = x + 'px';
            h.style.top = '0px';
            h.style.height = overlayH + 'px';
            h.dataset.mid = m.id;
            this.labelsWrap.appendChild(h);

            const lab = document.createElement('div');
            lab.className = 'marker-label' + (this.selectedMarkerId === m.id ? ' marker-selected' : '');
            lab.style.left = x + 'px';
            lab.style.top = '14px';
            lab.textContent = `${m.label} ${Math.round(p[m.id] || 0)}ms`;
            lab.dataset.mid = m.id;
            this.labelsWrap.appendChild(lab);
        });
    }

    drawMini() {
        if (!this.mini || !this.mctx) return;

        const W = this.mini.width, H = this.mini.height, c = this.mctx;
        const { waveBg, waveColor } = this.getWaveColors();

        c.clearRect(0, 0, W, H);
        c.fillStyle = waveBg;
        c.fillRect(0, 0, W, H);

        c.strokeStyle = getComputedStyle(document.body).getPropertyValue('--grid') || '#e5e7eb';
        c.beginPath();
        c.moveTo(0, H / 2);
        c.lineTo(W, H / 2);
        c.stroke();

        if (!this.currentBuffer) return;

        const ch = this.currentBuffer.getChannelData(0);
        const step = Math.max(1, Math.floor(ch.length / W));

        c.beginPath();
        let x = 0;
        for (let i = 0; i < ch.length; i += step) {
            let min = 1e9, max = -1e9;
            for (let j = 0; j < step && i + j < ch.length; j++) {
                const v = ch[i + j];
                if (v < min) min = v;
                if (v > max) max = v;
            }
            const mid = H / 2, scale = H * 0.4;
            c.moveTo(x, mid + min * scale);
            c.lineTo(x, mid + max * scale);
            x += 1;
        }
        c.strokeStyle = waveColor;
        c.stroke();

        // Draw view window
        const totalMs = this.currentBuffer.duration * 1000;
        const vw = this.getViewWindowMs(totalMs);
        const x1 = (this.viewStartMs / totalMs) * W;
        const x2 = ((this.viewStartMs + vw) / totalMs) * W;

        c.fillStyle = 'rgba(59,130,246,0.15)';
        c.fillRect(x1, 0, Math.max(2, x2 - x1), H);
        c.strokeStyle = '#3b82f6';
        c.strokeRect(x1 + 0.5, 0.5, Math.max(2, x2 - x1) - 1, H - 1);
    }

    async ensureSpectrogramFor(fileIndex) {
        if (this.specCache.has(fileIndex)) {
            this.drawSpectrogram(fileIndex);
            return;
        }
        if (!this.currentBuffer) return;

        const ch = this.currentBuffer.getChannelData(0);
        const N = 512, hop = 256;
        const rowsCount = N / 2;
        const frames = Math.max(1, Math.floor((ch.length - N) / hop) + 1);
        const data = new Float32Array(frames * rowsCount);
        let minDB = +Infinity, maxDB = -Infinity;
        const w = this.HANN_512;
        const TWO_PI = 2 * Math.PI;

        for (let frame = 0; frame < frames; frame++) {
            const start = frame * hop;
            for (let bin = 0; bin < rowsCount; bin++) {
                const freq = TWO_PI * bin / N;
                const cosTheta = Math.cos(freq), sinTheta = Math.sin(freq);
                let cos_n = 1, sin_n = 0, re = 0, im = 0;
                for (let n = 0; n < N; n++) {
                    const sample = (ch[start + n] || 0) * w[n];
                    re += sample * cos_n;
                    im -= sample * sin_n;
                    const tmp = cos_n;
                    cos_n = tmp * cosTheta - sin_n * sinTheta;
                    sin_n = tmp * sinTheta + sin_n * cosTheta;
                }
                const mag = Math.sqrt(re * re + im * im);
                const db = 20 * Math.log10(mag + 1e-8);
                data[frame * rowsCount + bin] = db;
                if (db < minDB) minDB = db;
                if (db > maxDB) maxDB = db;
            }
        }

        this.specCache.set(fileIndex, { cols: frames, rows: rowsCount, data, minDB, maxDB, hop, N });
        this.drawSpectrogram(fileIndex);
    }

    colorMap(t) {
        t = clamp(t, 0, 1);
        const r = Math.min(255, Math.max(0, Math.floor(255 * (1.5 * t))));
        const g = Math.min(255, Math.max(0, Math.floor(255 * Math.pow(t, 1.5))));
        const b = Math.min(255, Math.max(0, Math.floor(255 * (t < 0.5 ? (0.5 - t) : (1.0 - t)) * 1.6)));
        return [r, g, b, 255];
    }

    drawSpectrogram(fileIndex) {
        const cache = this.specCache.get(fileIndex);
        const specWrap = $('specWrap');
        const toggleSpec = $('toggleSpec');

        if (specWrap) {
            specWrap.classList.toggle('hidden', !toggleSpec?.checked);
        }

        if (!toggleSpec?.checked || !cache || !this.currentBuffer || !this.spec || !this.sctx) return;

        const totalMs = this.currentBuffer.duration * 1000;
        const vw = this.getViewWindowMs(totalMs);
        const totalCols = cache.cols;
        const msPerHop = 1000 * cache.hop / this.currentBuffer.sampleRate;
        const colStart = Math.max(0, Math.floor(this.viewStartMs / msPerHop));
        const colEnd = Math.min(totalCols - 1, Math.ceil((this.viewStartMs + vw) / msPerHop));
        const viewCols = Math.max(1, colEnd - colStart + 1);

        const ratio = Math.max(1, Math.floor(devicePixelRatio || 1));
        const wrapW = this.spec.parentElement?.getBoundingClientRect().width || 800;
        this.spec.width = Math.max(300, Math.floor(wrapW * ratio));
        this.spec.height = Math.floor(180 * ratio);
        this.sctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        this.sctx.clearRect(0, 0, this.spec.width, this.spec.height);

        const W = this.spec.width, H = this.spec.height, rowsCount = cache.rows;
        const img = this.sctx.createImageData(W, H);
        const min = cache.minDB, max = cache.maxDB;

        for (let x = 0; x < W; x++) {
            const col = colStart + Math.floor((x / W) * viewCols);
            const base = col * rowsCount;
            for (let y = 0; y < H; y++) {
                const bin = Math.floor((1 - y / H) * (rowsCount - 1));
                const v = cache.data[base + bin];
                const t = (v - min) / Math.max(1e-6, (max - min));
                const [r, g, b, a] = this.colorMap(t);
                const idx = (y * W + x) * 4;
                img.data[idx] = r;
                img.data[idx + 1] = g;
                img.data[idx + 2] = b;
                img.data[idx + 3] = a;
            }
        }
        this.sctx.putImageData(img, 0, 0);
    }

    drawAll() {
        this.drawWave();
        this.drawParamFills();
        this.drawMarkerLines();
        this.drawMarkers();
        this.drawMini();

        const toggleSpec = $('toggleSpec');
        if (toggleSpec?.checked && this.app.selectedRowIndex >= 0) {
            const idx = this.app.getFileIndexForFilename(this.app.rows[this.app.selectedRowIndex]?.filename || '');
            if (idx >= 0) this.drawSpectrogram(idx);
        }
    }

    setParamSmart(id, msAbs) {
        if (this.app.selectedRowIndex < 0) return;

        const p = this.app.rows[this.app.selectedRowIndex];
        const totalMs = this.currentBuffer ? Math.round(this.currentBuffer.duration * 1000) : Number.POSITIVE_INFINITY;

        if (id === 'offset') {
            p.offset = Math.round(clamp(msAbs, 0, totalMs));
            p.consonant = Math.round(clamp(p.consonant || 0, 0, Math.max(0, totalMs - p.offset)));
            p.preutter = Math.round(clamp(p.preutter || 0, 0, Math.max(0, totalMs - p.offset)));
            p.overlap = Math.round(clamp(p.overlap || 0, 0, Math.max(0, totalMs - p.offset)));
        } else if (id === 'consonant') {
            p.consonant = Math.round(clamp(msAbs - (p.offset || 0), 0, Math.max(0, totalMs - (p.offset || 0))));
        } else if (id === 'cutoff') {
            const rel = msAbs - (p.offset || 0);
            const relClamped = clamp(rel, 0, Math.max(0, totalMs - (p.offset || 0)));
            p.cutoff = -Math.round(relClamped);
        } else if (id === 'preutter' || id === 'overlap') {
            const rel = msAbs - (p.offset || 0);
            p[id] = Math.round(clamp(rel, 0, Math.max(0, totalMs - (p.offset || 0))));
        }

        this.app.syncInputsFromRow(p);
        this.app.refreshOtoView();
        this.app.renderAliasList();
        this.drawAll();
    }

    /**
     * Atualiza parâmetro APENAS visualmente (canvas), sem tocar no DOM
     * Usado durante arrasto de marcadores para evitar lag
     */
    setParamVisualOnly(id, msAbs) {
        if (this.app.selectedRowIndex < 0) return;

        const p = this.app.rows[this.app.selectedRowIndex];
        const totalMs = this.currentBuffer ? Math.round(this.currentBuffer.duration * 1000) : Number.POSITIVE_INFINITY;

        if (id === 'offset') {
            p.offset = Math.round(clamp(msAbs, 0, totalMs));
            p.consonant = Math.round(clamp(p.consonant || 0, 0, Math.max(0, totalMs - p.offset)));
            p.preutter = Math.round(clamp(p.preutter || 0, 0, Math.max(0, totalMs - p.offset)));
            p.overlap = Math.round(clamp(p.overlap || 0, 0, Math.max(0, totalMs - p.offset)));
        } else if (id === 'consonant') {
            p.consonant = Math.round(clamp(msAbs - (p.offset || 0), 0, Math.max(0, totalMs - (p.offset || 0))));
        } else if (id === 'cutoff') {
            const rel = msAbs - (p.offset || 0);
            const relClamped = clamp(rel, 0, Math.max(0, totalMs - (p.offset || 0)));
            p.cutoff = -Math.round(relClamped);
        } else if (id === 'preutter' || id === 'overlap') {
            const rel = msAbs - (p.offset || 0);
            p[id] = Math.round(clamp(rel, 0, Math.max(0, totalMs - (p.offset || 0))));
        }

        // Só redesenha canvas - NÃO toca em DOM
        // NÃO chamar drawMarkers() - ele cria elementos DOM!
        this.drawWave();
        this.drawParamFills();
        this.drawMarkerLines();
        // drawMarkers() REMOVIDO - causa lag
        this.drawMini();
    }

    togglePlay() {
        if (!this.currentBuffer) return;

        if (this.source) {
            try { this.source.stop(); } catch { }
            try { this.source.disconnect(); } catch { }
            this.source = null;
        } else {
            this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            this.audioCtx.resume();
            this.source = this.audioCtx.createBufferSource();
            this.source.buffer = this.currentBuffer;
            this.source.connect(this.audioCtx.destination);
            this.source.start(this.audioCtx.currentTime + 0.01, Math.max(0, this.cursorMs / 1000));
            this.source.onended = () => { this.source = null; };
        }
    }

    playRegion(startSec, endSec) {
        if (!this.currentBuffer) return;

        if (this.source) {
            try { this.source.stop(); } catch { }
            try { this.source.disconnect(); } catch { }
            this.source = null;
        }

        this.audioCtx = this.audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        this.audioCtx.resume();
        this.source = this.audioCtx.createBufferSource();
        this.source.buffer = this.currentBuffer;
        this.source.connect(this.audioCtx.destination);
        const dur = Math.max(0, endSec - startSec);
        const when = (this.audioCtx.currentTime || 0) + 0.01;
        this.source.start(when, startSec, dur);
        this.source.onended = () => { this.source = null; };
    }

    centerOnOffset() {
        if (!this.currentBuffer || this.app.selectedRowIndex < 0) return;

        const p = this.app.rows[this.app.selectedRowIndex];
        const totalMs = this.currentBuffer.duration * 1000;
        const vw = this.getViewWindowMs(totalMs);
        this.viewStartMs = clamp((p.offset || 0) - vw / 2, 0, Math.max(0, totalMs - vw));
        this.cursorMs = p.offset || 0;
    }
}
