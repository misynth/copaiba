/**
 * Gerenciamento de LocalStorage
 */

import { DEFAULT_PREFS, STORAGE_KEYS } from './config.js';

export class Storage {
    /**
     * Carrega preferências do localStorage
     * @returns {Object} Preferências
     */
    static loadPrefs() {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.PREFS);
            return stored ? { ...DEFAULT_PREFS, ...JSON.parse(stored) } : { ...DEFAULT_PREFS };
        } catch {
            return { ...DEFAULT_PREFS };
        }
    }

    /**
     * Salva preferências no localStorage
     * @param {Object} prefs - Preferências a salvar
     */
    static savePrefs(prefs) {
        try {
            localStorage.setItem(STORAGE_KEYS.PREFS, JSON.stringify(prefs));
        } catch (e) {
            console.warn('Falha ao salvar preferências:', e);
        }
    }

    /**
     * Carrega stars (favoritos) do localStorage
     * @returns {Set} Set de strings com chaves dos favoritos
     */
    static loadStars() {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.STARS);
            return new Set(JSON.parse(stored || '[]'));
        } catch {
            return new Set();
        }
    }

    /**
     * Salva stars no localStorage
     * @param {Set} starSet - Set de favoritos
     */
    static saveStars(starSet) {
        try {
            localStorage.setItem(STORAGE_KEYS.STARS, JSON.stringify([...starSet]));
        } catch (e) {
            console.warn('Falha ao salvar favoritos:', e);
        }
    }

    /**
     * Carrega estado de um painel flutuante
     * @param {string} key - Chave do painel
     * @returns {Object|null} Estado salvo ou null
     */
    static loadPaneState(key) {
        try {
            const stored = localStorage.getItem(STORAGE_KEYS.FLOAT_PREFIX + key);
            return stored ? JSON.parse(stored) : null;
        } catch {
            return null;
        }
    }

    /**
     * Salva estado de um painel flutuante
     * @param {string} key - Chave do painel
     * @param {Object} state - Estado a salvar
     */
    static savePaneState(key, state) {
        try {
            const prev = this.loadPaneState(key) || {};
            localStorage.setItem(
                STORAGE_KEYS.FLOAT_PREFIX + key,
                JSON.stringify({ ...prev, ...state })
            );
        } catch (e) {
            console.warn('Falha ao salvar estado do painel:', e);
        }
    }
}
