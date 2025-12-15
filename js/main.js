/**
 * Copaiba Web - Entry Point
 * Editor de oto.ini moderno e completo
 */

import { Toast } from './ui/toast.js';
import { Storage } from './storage.js';
import { OtoParser } from './oto-parser.js';
import { EncodingDetector } from './encoding.js';
import { $, debounce, escapeHtml, clamp } from './utils.js';
import { DEFAULT_PREFS } from './config.js';
import { WaveformRenderer } from './ui/waveform-renderer.js';

// Estado global da aplicação
class CopaibaApp {
    constructor() {
        // Preferências e persistência
        this.prefs = Storage.loadPrefs();
        this.starSet = Storage.loadStars();

        // Dados
        this.files = [];
        this.rows = [];
        this.selectedRowIndex = -1;
        this.selectedRowIndices = [];

        // Áudio
        this.audioCtx = null;
        this.currentBuffer = null;
        this.source = null;

        // Visualização
        this.zoom = 1;
        this.vzoom = this.prefs.vzoom || 1;
        this.viewStartMs = 0;
        this.cursorMs = 0;
        this.selectedMarkerId = null;
        this.lastMouseX = null;

        // Cache
        this.specCache = new Map();

        // Undo/Redo
        this.undoStack = [];
        this.redoStack = [];

        // Encoding
        this.lastOtoBuffer = null;
        this.lastOtoFileName = '';
        this.lastOtoEncoding = 'utf-8';
    }

    /**
     * Inicializa a aplicação
     */
    async init() {
        try {
            this.applyTheme();
            this.setupUI();
            this.setupEventListeners();
            this.loadPresetValues();

            // Inicializar renderizador de waveform
            this.waveformRenderer = new WaveformRenderer(this);

            Toast.success('Copaiba Web carregado!', 2000);
        } catch (error) {
            console.error('Erro ao inicializar:', error);
            Toast.error('Erro ao inicializar aplicação');
        }
    }

    /**
     * Aplica tema (claro/escuro)
     */
    applyTheme() {
        document.body.classList.remove('theme-light', 'theme-dark');
        document.body.classList.add('theme-' + (this.prefs.theme || 'light'));

        const btnTheme = $('btnTheme');
        if (btnTheme) {
            btnTheme.textContent = this.prefs.theme === 'dark' ? '☀️' : '🌙';
            btnTheme.title = this.prefs.theme === 'dark'
                ? 'Alternar para modo claro'
                : 'Alternar para modo escuro';
        }
    }

    /**
     * Configura elementos da UI
     */
    setupUI() {
        // Vzoom
        const vzoomSlider = $('vzoom');
        const vzoomLabel = $('vzoomLabel');
        if (vzoomSlider && vzoomLabel) {
            vzoomSlider.value = this.vzoom;
            vzoomLabel.textContent = this.vzoom.toFixed(2) + '×';
        }

        // Espectrograma
        const toggleSpec = $('toggleSpec');
        if (toggleSpec) {
            toggleSpec.checked = !!this.prefs.showSpec;
        }

        // Color pickers
        const waveColorPicker = $('waveColorPicker');
        const waveBgColorPicker = $('waveBgColorPicker');
        if (waveColorPicker) {
            waveColorPicker.value = this.prefs.waveColor || '#000000';
        }
        if (waveBgColorPicker) {
            const computedBg = getComputedStyle(document.body)
                .getPropertyValue('--card') || '#ffffff';
            waveBgColorPicker.value = this.prefs.waveBgColor || computedBg;
        }

        // Encoding badge
        EncodingDetector.updateBadge('utf-8', true);

        // Inicializar painéis flutuantes
        // TODO: Implementar float panels manager

        // Atualizar contadores
        this.updateCounters();
    }

    /**
     * Configura event listeners principais
     */
    setupEventListeners() {
        // Tema
        const btnTheme = $('btnTheme');
        if (btnTheme) {
            btnTheme.addEventListener('click', () => {
                this.prefs.theme = this.prefs.theme === 'dark' ? 'light' : 'dark';
                Storage.savePrefs(this.prefs);
                this.applyTheme();
            });
        }

        // Arquivos - com fallback para navegadores sem webkitdirectory
        const btnFolder = $('btnFolder');
        const pickFolder = $('pickFolder');

        // Verificar suporte a webkitdirectory
        const supportsDir = pickFolder && ('webkitdirectory' in pickFolder);
        console.log('[DEBUG] Suporte a webkitdirectory:', supportsDir);

        // Criar input alternativo para arquivos múltiplos (fallback)
        const pickFiles = document.createElement('input');
        pickFiles.type = 'file';
        pickFiles.multiple = true;
        pickFiles.accept = 'audio/wav';
        pickFiles.style.display = 'none';
        document.body.appendChild(pickFiles);

        // Atualizar texto do botão se não suportar diretório
        if (btnFolder && !supportsDir) {
            btnFolder.textContent = 'Abrir arquivos .wav';
        }

        if (btnFolder) {
            btnFolder.addEventListener('click', () => {
                console.log('[DEBUG] Botão clicado, supportsDir:', supportsDir);
                if (supportsDir && pickFolder) {
                    pickFolder.click();
                } else {
                    pickFiles.click();
                }
            });
        }

        if (pickFolder) {
            pickFolder.addEventListener('change', (e) => {
                console.log('[DEBUG] pickFolder change event', e.target.files);
                this.handleFileSelection(e.target.files);
            });
        }

        pickFiles.addEventListener('change', (e) => {
            console.log('[DEBUG] pickFiles change event', e.target.files);
            this.handleFileSelection(e.target.files);
        });

        // Oto.ini - usar File System Access API quando disponível
        const btnOto = $('btnOto');
        const pickOto = $('pickOto');
        if (btnOto) {
            btnOto.addEventListener('click', () => {
                // Tentar usar File System Access API para permitir sobrescrever depois
                if ('showOpenFilePicker' in window) {
                    this.handleOtoLoadWithFileHandle();
                } else if (pickOto) {
                    pickOto.click();
                }
            });
        }
        if (pickOto) {
            pickOto.addEventListener('change', (e) => this.handleOtoLoad(e.target.files[0]));
        }

        // Salvar (exportar)
        const btnSave = $('btnSave');
        if (btnSave) {
            btnSave.addEventListener('click', () => this.handleSave());
        }

        // Salvar/Sobrepor (File System Access API)
        const btnSaveOverwrite = $('btnSaveOverwrite');
        if (btnSaveOverwrite) {
            btnSaveOverwrite.addEventListener('click', () => this.handleSaveOverwrite());
        }

        // Encoding change - recarregar oto se necessário
        const encodingSelect = $('otoEncoding');
        if (encodingSelect) {
            encodingSelect.addEventListener('change', () => {
                if (this.lastOtoBuffer) {
                    this.loadOtoFromBuffer(this.lastOtoBuffer, this.lastOtoFileName);
                }
            });
        }

        // Filtro (com debounce)
        const filterInput = $('filter');
        if (filterInput) {
            filterInput.addEventListener('input', debounce(() => {
                this.renderAliasList();
            }, 150));
        }

        // Checkbox de filtro
        const filterRegex = $('filterRegex');
        const filterStarred = $('filterStarred');
        if (filterRegex) {
            filterRegex.addEventListener('change', () => this.renderAliasList());
        }
        if (filterStarred) {
            filterStarred.addEventListener('change', () => this.renderAliasList());
        }

        // Atalhos globais de teclado
        this.setupKeyboardShortcuts();

        console.log('[DEBUG] Event listeners configurados com sucesso');
    }

    /**
     * Configura atalhos de teclado globais
     */
    setupKeyboardShortcuts() {
        const MARKERS = [
            { id: 'offset', key: 'Q', label: 'Corte' },
            { id: 'overlap', key: 'W', label: 'Transição' },
            { id: 'preutter', key: 'E', label: 'Início da vogal' },
            { id: 'consonant', key: 'R', label: 'Parte de loop' },
            { id: 'cutoff', key: 'T', label: 'Corte final' }
        ];

        window.addEventListener('keydown', (e) => {
            const el = document.activeElement;
            const isForm = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

            // Ignorar se estiver em input/textarea (exceto algumas teclas)
            if (isForm && !e.ctrlKey && !e.metaKey) {
                // Permitir Escape para sair do input
                if (e.key === 'Escape') {
                    el.blur();
                    return;
                }
                return;
            }

            const k = e.key;
            const ku = k.toUpperCase();

            // Y = Tocar/Pausar
            if (ku === 'Y' && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                const btnPlay = $('btnPlay');
                if (btnPlay) btnPlay.click();
                return;
            }

            // S = Toggle Star
            if (ku === 'S' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                if (this.selectedRowIndex >= 0) {
                    this.toggleStar(this.selectedRowIndex);
                }
                return;
            }

            // Shift+0 = Duplicar linha
            if (k === '0' && e.shiftKey) {
                e.preventDefault();
                this.duplicateCurrentRow();
                return;
            }

            // Shift+9 = Renomear alias
            if (k === '9' && e.shiftKey) {
                e.preventDefault();
                this.renameCurrentAlias();
                return;
            }

            // Shift+D = Deletar alias
            if (ku === 'D' && e.shiftKey) {
                e.preventDefault();
                this.deleteCurrentRow();
                return;
            }

            // Arrow Down = próximo alias
            if (k === 'ArrowDown') {
                e.preventDefault();
                if (this.selectedRowIndex < this.rows.length - 1) {
                    this.selectedRowIndices = [this.selectedRowIndex + 1];
                    this.selectRow(this.selectedRowIndex + 1);
                }
                return;
            }

            // Arrow Up = alias anterior
            if (k === 'ArrowUp') {
                e.preventDefault();
                if (this.selectedRowIndex > 0) {
                    this.selectedRowIndices = [this.selectedRowIndex - 1];
                    this.selectRow(this.selectedRowIndex - 1);
                }
                return;
            }

            // QWERT = definir parâmetros na posição do cursor
            const marker = MARKERS.find(m => m.key === ku);
            if (marker && this.waveformRenderer && this.selectedRowIndex >= 0) {
                e.preventDefault();
                const msAbs = this.waveformRenderer.cursorMs;
                this.waveformRenderer.setParamSmart(marker.id, msAbs);
                // Removido Toast para evitar lag
                return;
            }
        });
    }

    /**
     * Duplica a row atual
     */
    duplicateCurrentRow() {
        if (this.selectedRowIndex < 0 || !this.rows.length) return;

        const p = this.rows[this.selectedRowIndex];
        const copy = { ...p };
        this.rows.splice(this.selectedRowIndex + 1, 0, copy);
        this.selectedRowIndex++;
        this.selectedRowIndices = [this.selectedRowIndex];

        this.renderAliasList();
        this.refreshOtoView();
        this.selectRow(this.selectedRowIndex);

        Toast.success('Linha duplicada (Shift+0)');
    }

    /**
     * Renomeia o alias atual
     */
    renameCurrentAlias() {
        if (this.selectedRowIndex < 0 || !this.rows.length) return;

        const p = this.rows[this.selectedRowIndex];
        const novo = prompt('Novo alias:', p.alias || '');

        if (novo !== null) {
            p.alias = novo;
            this.syncInputsFromRow(p);
            this.refreshOtoView();
            this.renderAliasList();
            Toast.success('Alias renomeado (Shift+9)');
        }
    }

    /**
     * Deleta a row atual
     */
    deleteCurrentRow() {
        if (this.selectedRowIndex < 0 || !this.rows.length) return;

        const confirmDelete = confirm('Deseja deletar este alias?');
        if (!confirmDelete) return;

        const idx = this.selectedRowIndex;
        this.rows.splice(idx, 1);
        this.selectedRowIndex = Math.min(idx, this.rows.length - 1);
        this.selectedRowIndices = this.selectedRowIndex >= 0 ? [this.selectedRowIndex] : [];

        this.renderAliasList();
        this.refreshOtoView();

        if (this.rows.length) {
            this.selectRow(this.selectedRowIndex);
        } else {
            const currentName = $('currentName');
            if (currentName) currentName.textContent = '(nenhum arquivo)';
            if (this.waveformRenderer) this.waveformRenderer.drawAll();
        }

        Toast.success('Alias deletado (Shift+D)');
    }

    /**
     * Carrega valores de preset
     */
    loadPresetValues() {
        if (!this.prefs.presets) {
            this.prefs.presets = { ...DEFAULT_PREFS.presets };
        }

        const presetOverlap = $('presetOverlap');
        const presetPreutter = $('presetPreutter');
        const presetConsonant = $('presetConsonant');
        const presetCutoff = $('presetCutoff');

        if (presetOverlap) presetOverlap.value = this.prefs.presets.overlap;
        if (presetPreutter) presetPreutter.value = this.prefs.presets.preutter;
        if (presetConsonant) presetConsonant.value = this.prefs.presets.consonant;
        if (presetCutoff) presetCutoff.value = this.prefs.presets.cutoff;
    }

    /**
     * Processa seleção de arquivos .wav
     */
    async handleFileSelection(fileList) {
        try {
            console.log('[DEBUG] handleFileSelection chamado', fileList);

            const arr = [...fileList];
            console.log('[DEBUG] Total de arquivos:', arr.length);

            const wavs = arr.filter(f => /\.wav$/i.test(f.name));
            console.log('[DEBUG] Arquivos .wav encontrados:', wavs.length);

            if (!wavs.length) {
                Toast.warning('Nenhum arquivo .wav encontrado');
                return;
            }

            Toast.info(`Carregando ${wavs.length} arquivos...`);

            this.files = wavs.map(f => {
                const fileData = {
                    name: f.webkitRelativePath || f.name,
                    file: f,
                    url: URL.createObjectURL(f)
                };
                console.log('[DEBUG] Arquivo mapeado:', fileData.name);
                return fileData;
            });

            console.log('[DEBUG] Total de arquivos em this.files:', this.files.length);

            // Adicionar aos rows se não existirem
            for (const f of this.files) {
                if (!this.rows.find(r => this.sameFile(r.filename, f.name))) {
                    const newRow = {
                        filename: f.name,
                        alias: OtoParser.inferAlias(f.name),
                        offset: 0,
                        consonant: 0,
                        cutoff: 0,
                        preutter: 0,
                        overlap: 0
                    };
                    console.log('[DEBUG] Adicionando row:', newRow);
                    this.rows.push(newRow);
                }
            }

            console.log('[DEBUG] Total de rows:', this.rows.length);

            this.renderAliasList();

            if (this.rows.length && this.selectedRowIndex < 0) {
                console.log('[DEBUG] Selecionando primeira row');
                this.selectRow(0);
            }

            const btnSave = $('btnSave');
            if (btnSave) btnSave.disabled = this.rows.length === 0;

            Toast.success(`${this.files.length} arquivos carregados!`);
        } catch (error) {
            console.error('[ERRO] Erro ao carregar arquivos:', error);
            Toast.error('Erro ao carregar arquivos: ' + error.message);
        }
    }

    /**
     * Carrega arquivo oto.ini
     */
    async handleOtoLoad(file) {
        if (!file) return;

        try {
            Toast.info('Carregando oto.ini...');

            this.lastOtoFileName = file.name || '';
            this.lastOtoBuffer = await file.arrayBuffer();

            const encodingSelect = $('otoEncoding');
            const selectedEncoding = encodingSelect?.value || 'auto';

            let result;
            if (selectedEncoding === 'auto') {
                result = EncodingDetector.detect(this.lastOtoBuffer);
                EncodingDetector.updateBadge(result.encoding, true);
            } else {
                result = {
                    encoding: selectedEncoding,
                    text: EncodingDetector.decodeBuffer(this.lastOtoBuffer, selectedEncoding)
                };
                EncodingDetector.updateBadge(selectedEncoding, false);
            }

            this.lastOtoEncoding = result.encoding;
            this.rows = OtoParser.parse(result.text);

            // Adicionar arquivos sem entrada
            if (this.files.length) {
                for (const f of this.files) {
                    if (!this.rows.find(r => this.sameFile(r.filename, f.name))) {
                        this.rows.push({
                            filename: f.name,
                            alias: OtoParser.inferAlias(f.name),
                            offset: 0,
                            consonant: 0,
                            cutoff: 0,
                            preutter: 0,
                            overlap: 0
                        });
                    }
                }
            }

            if (this.rows.length && this.selectedRowIndex < 0) {
                this.selectedRowIndex = 0;
            }

            if (this.rows.length) {
                this.selectRow(this.selectedRowIndex);
            }

            this.refreshOtoView();
            this.renderAliasList();

            Toast.success(`oto.ini carregado! ${this.rows.length} aliases encontrados`);
        } catch (error) {
            console.error('Erro ao carregar oto.ini:', error);
            Toast.error('Erro ao carregar oto.ini');
        }
    }

    /**
     * Recarrega oto.ini de buffer (usado quando encoding muda)
     */
    async loadOtoFromBuffer(buf, filename) {
        try {
            const encodingSelect = $('otoEncoding');
            const selectedEncoding = encodingSelect?.value || 'auto';

            let result;
            if (selectedEncoding === 'auto') {
                result = EncodingDetector.detect(buf);
                EncodingDetector.updateBadge(result.encoding, true);
                console.log(`[DEBUG] oto.ini recarregado (${filename || 'buffer'}) em ${result.encoding} (auto)`);
            } else {
                result = {
                    encoding: selectedEncoding,
                    text: EncodingDetector.decodeBuffer(buf, selectedEncoding)
                };
                EncodingDetector.updateBadge(selectedEncoding, false);
                console.log(`[DEBUG] oto.ini recarregado (${filename || 'buffer'}) em ${selectedEncoding}`);
            }

            this.lastOtoEncoding = result.encoding;
            this.rows = OtoParser.parse(result.text);

            // Mesclar com arquivos carregados
            if (this.files.length) {
                for (const f of this.files) {
                    if (!this.rows.find(r => this.sameFile(r.filename, f.name))) {
                        this.rows.push({
                            filename: f.name,
                            alias: OtoParser.inferAlias(f.name),
                            offset: 0,
                            consonant: 0,
                            cutoff: 0,
                            preutter: 0,
                            overlap: 0
                        });
                    }
                }
            }

            if (this.rows.length && this.selectedRowIndex < 0) {
                this.selectedRowIndex = 0;
            }

            if (this.rows.length) {
                this.selectRow(this.selectedRowIndex);
            }

            this.refreshOtoView();
            this.renderAliasList();
        } catch (error) {
            console.error('Erro ao recarregar oto.ini:', error);
            Toast.error('Erro ao recarregar oto.ini');
        }
    }

    /**
     * Salva oto.ini
     */
    handleSave() {
        if (!this.rows.length) {
            Toast.warning('Nenhum alias para salvar');
            return;
        }

        const preferred = this.lastOtoEncoding || 'utf-8';
        const choice = prompt(
            'Salvar como:\n1) UTF-8 (Recomendado)\n2) ANSI/Shift_JIS (Experimental)\n3) Mesma codificação lida (' + preferred + ')\n\nDigite 1, 2 ou 3:',
            '1'
        );

        let enc = 'utf-8';
        if (choice === '2') enc = 'shift_jis';
        else if (choice === '3') enc = preferred;

        this.saveOtoWithEncoding(enc);
    }

    /**
     * Salva oto.ini com encoding específico
     */
    saveOtoWithEncoding(enc) {
        const content = OtoParser.serialize(this.rows);
        let blob;

        if (enc === 'shift_jis') {
            if (window.Encoding) {
                try {
                    const sj = window.Encoding.convert(content, 'SJIS', 'UNICODE');
                    blob = new Blob([new Uint8Array(sj)], { type: 'text/plain;charset=shift_jis' });
                    Toast.success('oto.ini exportado em Shift_JIS');
                } catch (e) {
                    Toast.warning('Falha ao converter para Shift_JIS. Salvando em UTF-8.');
                    blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                }
            } else {
                Toast.warning('Sem Encoding.js: salvando em UTF-8');
                blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            }
        } else {
            blob = new Blob([content], { type: 'text/plain;charset=' + enc });
            Toast.success(`oto.ini exportado em ${enc}`);
        }

        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'oto.ini';
        a.click();
    }

    /**
     * Salva/Sobrepõe o oto.ini diretamente no arquivo original
     * Usa File System Access API quando disponível
     */
    async handleSaveOverwrite() {
        if (!this.rows.length) {
            Toast.warning('Nenhum alias para salvar');
            return;
        }

        // Verificar se File System Access API está disponível
        if (!this.otoFileHandle) {
            Toast.warning('Nenhum arquivo oto.ini aberto com permissão de escrita. Use "Carregar oto.ini" primeiro.');
            return;
        }

        try {
            Toast.info('Salvando...');

            const content = OtoParser.serialize(this.rows);
            const enc = this.lastOtoEncoding || 'utf-8';

            let data;
            if (enc === 'shift_jis' && window.Encoding) {
                try {
                    const sj = window.Encoding.convert(content, 'SJIS', 'UNICODE');
                    data = new Uint8Array(sj);
                } catch {
                    data = new TextEncoder().encode(content);
                }
            } else {
                data = new TextEncoder().encode(content);
            }

            // Escrever no arquivo
            const writable = await this.otoFileHandle.createWritable();
            await writable.write(data);
            await writable.close();

            Toast.success('oto.ini salvo com sucesso!');
        } catch (error) {
            console.error('Erro ao salvar oto.ini:', error);

            // Fallback: tentar com seleção de arquivo
            if (error.name === 'NotAllowedError') {
                Toast.warning('Permissão negada. Tentando método alternativo...');
                this.handleSave();
            } else {
                Toast.error('Erro ao salvar: ' + error.message);
            }
        }
    }

    /**
     * Carrega oto.ini com File System Access API (para permitir sobrescrever depois)
     */
    async handleOtoLoadWithFileHandle() {
        try {
            // Verificar se File System Access API está disponível
            if ('showOpenFilePicker' in window) {
                const [fileHandle] = await window.showOpenFilePicker({
                    types: [{
                        description: 'oto.ini files',
                        accept: { 'text/plain': ['.ini'] }
                    }],
                    multiple: false
                });

                this.otoFileHandle = fileHandle;
                const file = await fileHandle.getFile();

                // Mostrar botão de salvar/sobrepor
                const btnSaveOverwrite = $('btnSaveOverwrite');
                if (btnSaveOverwrite) {
                    btnSaveOverwrite.classList.remove('hidden');
                    btnSaveOverwrite.disabled = false;
                }

                await this.handleOtoLoad(file);
            } else {
                // Fallback para método tradicional
                $('pickOto')?.click();
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Erro ao abrir arquivo:', error);
                Toast.error('Erro ao abrir arquivo');
            }
        }
    }

    /**
     * Renderiza lista de aliases (otimizado com DocumentFragment)
     */
    renderAliasList() {
        const aliasList = $('aliasList');
        if (!aliasList) return;

        const countAliases = $('countAliases');
        if (countAliases) {
            countAliases.textContent = String(this.rows.length);
        }

        // Usar DocumentFragment para performance
        const fragment = document.createDocumentFragment();
        const selectedSet = new Set(this.selectedRowIndices || []);

        // Pre-calcular para evitar chamadas repetidas
        const rowsLen = this.rows.length;

        for (let idx = 0; idx < rowsLen; idx++) {
            const r = this.rows[idx];
            // TODO: Aplicar filtros aqui para pular itens não visíveis

            const isSelected = selectedSet.has(idx);
            const hasFile = this.getFileIndexForFilename(r.filename) >= 0;
            const starred = this.starSet.has(OtoParser.keyFor(r));

            const div = document.createElement('div');
            div.className = isSelected
                ? 'alias-row flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-slate-500/10 cursor-pointer selected'
                : 'alias-row flex items-center gap-2 px-2 py-2 text-sm rounded-md hover:bg-slate-500/10 cursor-pointer';
            div.dataset.idx = String(idx);

            const starIcon = starred ? '★' : '☆';
            const aliasText = escapeHtml(r.alias || '(sem alias)');
            const wavText = hasFile
                ? escapeHtml(r.filename.split(/[\\/]/).pop())
                : '! wav';

            div.innerHTML = `<button class="px-1 star" title="${starred ? 'Desmarcar ★' : 'Marcar ★'}">${starIcon}</button><div class="font-mono text-xs truncate" title="${aliasText}">${aliasText}</div><div class="ml-auto flex items-center gap-2"><span class="tag" title="${wavText}">${wavText}</span></div>`;

            fragment.appendChild(div);
        }

        // Limpar e adicionar de uma vez (mais eficiente)
        aliasList.innerHTML = '';
        aliasList.appendChild(fragment);

        // Usar event delegation ao invés de listeners individuais
        if (!this._aliasListDelegated) {
            this._aliasListDelegated = true;
            aliasList.addEventListener('click', (ev) => {
                const row = ev.target.closest('.alias-row');
                if (!row) return;
                const idx = parseInt(row.dataset.idx, 10);
                if (isNaN(idx)) return;

                if (ev.target.classList.contains('star')) {
                    this.toggleStar(idx);
                    ev.stopPropagation();
                    return;
                }

                this.selectedRowIndices = [idx];
                this.selectedRowIndex = idx;
                this.selectRow(idx);
            });
        }

        this.updateCounters();
    }

    /**
     * Handle click em alias
     */
    handleAliasClick(ev, idx) {
        // TODO: Implementar lógica de seleção completa
        if (ev.target && ev.target.classList.contains('star')) {
            this.toggleStar(idx);
            ev.stopPropagation();
            return;
        }

        this.selectedRowIndices = [idx];
        this.selectedRowIndex = idx;
        this.selectRow(idx);
    }

    /**
     * Seleciona uma row
     */
    async selectRow(rowIndex) {
        if (!this.rows.length) return;

        this.selectedRowIndex = clamp(rowIndex, 0, this.rows.length - 1);
        const r = this.rows[this.selectedRowIndex];
        if (!r) return;

        const currentName = $('currentName');
        if (currentName) {
            currentName.textContent = r.filename || '(sem arquivo)';
        }

        // Carregar parâmetros para a UI
        this.loadParamsToUI();

        // Carregar e decodificar áudio
        const fIdx = this.getFileIndexForFilename(r.filename);
        if (fIdx >= 0 && this.waveformRenderer) {
            await this.waveformRenderer.decodeAndDraw(this.files[fIdx], fIdx);
            this.waveformRenderer.centerOnOffset();
        } else if (this.waveformRenderer) {
            const srInfo = $('srInfo');
            if (srInfo) srInfo.textContent = '';
            this.waveformRenderer.currentBuffer = null;
            this.waveformRenderer.drawAll();
        }

        this.renderAliasList();
    }

    /**
     * Carrega parâmetros da row atual para inputs da UI
     */
    loadParamsToUI() {
        const p = this.rows[this.selectedRowIndex];
        if (!p) return;

        const aliasIn = $('alias');
        const offsetIn = $('offset');
        const consonantIn = $('consonant');
        const cutoffIn = $('cutoff');
        const preutterIn = $('preutter');
        const overlapIn = $('overlap');

        if (aliasIn) aliasIn.value = p.alias || '';
        if (offsetIn) offsetIn.value = String(Math.round(p.offset || 0));
        if (consonantIn) consonantIn.value = String(Math.round(p.consonant || 0));
        if (cutoffIn) cutoffIn.value = String(Math.round(p.cutoff || 0));
        if (preutterIn) preutterIn.value = String(Math.round(p.preutter || 0));
        if (overlapIn) overlapIn.value = String(Math.round(p.overlap || 0));

        if (this.waveformRenderer) {
            this.waveformRenderer.cursorMs = p.offset || 0;
            this.waveformRenderer.drawAll();
        }
    }

    /**
     * Sincroniza inputs da UI com a row
     */
    syncInputsFromRow(p) {
        const aliasIn = $('alias');
        const offsetIn = $('offset');
        const consonantIn = $('consonant');
        const cutoffIn = $('cutoff');
        const preutterIn = $('preutter');
        const overlapIn = $('overlap');

        if (aliasIn) aliasIn.value = p.alias || '';
        if (offsetIn) offsetIn.value = String(Math.round(p.offset || 0));
        if (consonantIn) consonantIn.value = String(Math.round(p.consonant || 0));
        if (cutoffIn) cutoffIn.value = String(Math.round(p.cutoff || 0));
        if (preutterIn) preutterIn.value = String(Math.round(p.preutter || 0));
        if (overlapIn) overlapIn.value = String(Math.round(p.overlap || 0));
    }

    /**
     * Toggle star em alias
     */
    toggleStar(idx) {
        const k = OtoParser.keyFor(this.rows[idx]);
        if (this.starSet.has(k)) {
            this.starSet.delete(k);
        } else {
            this.starSet.add(k);
        }
        Storage.saveStars(this.starSet);
        this.renderAliasList();
        this.updateCounters();
    }

    /**
     * Atualiza contadores
     */
    updateCounters() {
        const countStars = $('countStars');
        if (countStars) {
            countStars.textContent = '★ ' + String(this.starSet.size);
        }
    }

    /**
     * Refresh oto view (textarea)
     */
    refreshOtoView() {
        const otoView = $('otoView');
        const countLines = $('countLines');

        if (!otoView) return;

        const text = OtoParser.serialize(this.rows);
        const lines = text.split('\n');

        if (countLines) {
            countLines.textContent = String(lines.length);
        }

        otoView.value = text;
    }

    /**
     * Verifica se dois filenames são o mesmo arquivo
     */
    sameFile(a, b) {
        if (!a || !b) return false;
        if (a === b) return true;

        const ba = a.toLowerCase().split(/[\\/]/).pop();
        const bb = b.toLowerCase().split(/[\\/]/).pop();

        return ba === bb;
    }

    /**
     * Obtém índice de arquivo por filename
     */
    getFileIndexForFilename(fn) {
        let idx = this.files.findIndex(f => f.name === fn);
        if (idx >= 0) return idx;

        const b = fn.toLowerCase().split(/[\\/]/).pop();
        idx = this.files.findIndex(f => {
            const fb = f.name.toLowerCase().split(/[\\/]/).pop();
            return fb === b;
        });

        return idx;
    }
}

// Inicializar quando DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.copaibaApp = new CopaibaApp();
        window.copaibaApp.init();
    });
} else {
    window.copaibaApp = new CopaibaApp();
    window.copaibaApp.init();
}
