/**
 * Funções utilitárias gerais
 */

// DOM helpers
export const $ = id => document.getElementById(id);
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

// Math helpers
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const round0 = (x) => Math.round(Number(x || 0));
export const fmt = (ms) => String(round0(ms));

// String helpers
export const basename = (p) => (p || '').split(/[\\/]/).pop();
export const lower = (s) => String(s || '').toLowerCase();

/**
 * Debounce - aguarda um tempo antes de executar função
 * @param {Function} fn - Função a ser executada
 * @param {number} delay - Delay em ms
 * @returns {Function} Função debounced
 */
export function debounce(fn, delay) {
    let timeoutId;
    return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

/**
 * Sanitiza HTML para prevenir XSS
 * @param {string} text - Texto a ser sanitizado
 * @returns {string} HTML seguro
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Cria um elemento DOM com classes e atributos
 * @param {string} tag - Tag HTML
 * @param {Object} options - Opções (className, textContent, etc)
 * @returns {HTMLElement}
 */
export function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.dataset) {
        Object.entries(options.dataset).forEach(([key, val]) => {
            el.dataset[key] = val;
        });
    }
    if (options.attributes) {
        Object.entries(options.attributes).forEach(([key, val]) => {
            el.setAttribute(key, val);
        });
    }
    return el;
}
