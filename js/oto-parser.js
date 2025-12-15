/**
 * Parser e serializador de oto.ini
 */

import { round0, basename } from './utils.js';

export class OtoParser {
    /**
     * Faz parse de conteúdo oto.ini
     * @param {string} text - Conteúdo do arquivo
     * @returns {Array} Array de objetos com dados dos aliases
     */
    static parse(text) {
        const lines = String(text)
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n');

        const out = [];

        for (const raw of lines) {
            if (!raw.trim()) continue;

            const i = raw.indexOf('=');
            if (i < 0) continue;

            const filename = raw.slice(0, i).trim();
            const parts = raw.slice(i + 1).split(',');
            const toNum = j => round0(parts[j] || 0);

            out.push({
                filename,
                alias: (parts[0] || '').trim(),
                offset: toNum(1),
                consonant: toNum(2),
                cutoff: -Math.abs(toNum(3)),
                preutter: toNum(4),
                overlap: toNum(5)
            });
        }

        return out;
    }

    /**
     * Serializa array de aliases para formato oto.ini
     * @param {Array} rows - Array de objetos com dados dos aliases
     * @returns {string} Conteúdo formatado do oto.ini
     */
    static serialize(rows) {
        return rows.map(p => `${p.filename}=${[
            p.alias || '',
            round0(p.offset),
            round0(p.consonant),
            round0(p.cutoff),
            round0(p.preutter),
            round0(p.overlap)
        ].join(',')}`).join('\n');
    }

    /**
     * Infere alias a partir do nome do arquivo
     * @param {string} filename - Nome do arquivo
     * @returns {string} Alias inferido
     */
    static inferAlias(filename) {
        return basename(filename).replace(/\.[^.]+$/, '');
    }

    /**
     * Gera chave única para identificar um alias
     * @param {Object} row - Objeto com filename e alias
     * @returns {string} Chave única
     */
    static keyFor(row) {
        return (row?.filename || '') + '|' + (row?.alias || '');
    }
}
