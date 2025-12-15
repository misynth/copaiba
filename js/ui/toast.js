/**
 * Sistema de notificações Toast
 */

import { createElement } from '../utils.js';

export class Toast {
    /**
     * Mostra uma notificação toast
     * @param {string} message - Mensagem a exibir
     * @param {string} type - Tipo: 'success', 'error', 'warning', 'info'
     * @param {number} duration - Duração em ms (padrão: 3000)
     */
    static show(message, type = 'info', duration = 3000) {
        const toast = createElement('div', {
            className: `toast toast-${type}`
        });

        const icon = createElement('span', {
            className: 'toast-icon',
            textContent: this.getIcon(type)
        });

        const msg = createElement('span', {
            className: 'toast-message',
            textContent: message
        });

        toast.appendChild(icon);
        toast.appendChild(msg);

        const container = this.getOrCreateContainer();
        container.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Remove after duration
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    /**
     * Retorna ícone baseado no tipo
     * @param {string} type - Tipo da notificação
     * @returns {string} Ícone
     */
    static getIcon(type) {
        const icons = {
            success: '✓',
            error: '✗',
            warning: '⚠',
            info: 'ℹ'
        };
        return icons[type] || icons.info;
    }

    /**
     * Obtém ou cria container de toasts
     * @returns {HTMLElement} Container
     */
    static getOrCreateContainer() {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = createElement('div', {
                attributes: { id: 'toast-container' }
            });
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        return container;
    }

    /**
     * Atalhos para tipos específicos
     */
    static success(message, duration) {
        this.show(message, 'success', duration);
    }

    static error(message, duration) {
        this.show(message, 'error', duration);
    }

    static warning(message, duration) {
        this.show(message, 'warning', duration);
    }

    static info(message, duration) {
        this.show(message, 'info', duration);
    }
}
