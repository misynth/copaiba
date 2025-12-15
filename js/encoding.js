/**
 * Detecção e conversão de encoding de arquivos
 */

export class EncodingDetector {
    /**
     * Conta caracteres japoneses em uma string
     * @param {string} str - String a analisar
     * @returns {number} Quantidade de caracteres japoneses
     */
    static countJapaneseChars(str) {
        let n = 0;
        for (let i = 0; i < str.length; i++) {
            const code = str.charCodeAt(i);
            // Hiragana, Katakana, Kanji, Half-width Katakana
            if ((code >= 0x3040 && code <= 0x30FF) ||
                (code >= 0x4E00 && code <= 0x9FFF) ||
                (code >= 0xFF66 && code <= 0xFF9D)) {
                n++;
            }
        }
        return n;
    }

    /**
     * Decodifica buffer com encoding específico
     * @param {ArrayBuffer} buf - Buffer a decodificar
     * @param {string} enc - Encoding a usar
     * @returns {string} Texto decodificado
     */
    static decodeBuffer(buf, enc) {
        try {
            return new TextDecoder(enc).decode(buf);
        } catch {
            try {
                return new TextDecoder('utf-8').decode(buf);
            } catch {
                return '';
            }
        }
    }

    /**
     * Detecta encoding automaticamente
     * @param {ArrayBuffer} buf - Buffer a analisar
     * @returns {Object} { encoding: string, text: string }
     */
    static detect(buf) {
        const u8 = new Uint8Array(buf);

        // Detectar BOM UTF-8
        if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) {
            return {
                encoding: 'utf-8',
                text: new TextDecoder('utf-8').decode(u8.subarray(3))
            };
        }

        // Detectar BOM UTF-16 LE
        if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) {
            return {
                encoding: 'utf-16le',
                text: new TextDecoder('utf-16le').decode(u8.subarray(2))
            };
        }

        // Tentar múltiplos encodings
        const candidates = [];
        ['utf-8', 'shift_jis', 'windows-1252'].forEach(enc => {
            try {
                const dec = new TextDecoder(enc, { fatal: true });
                const txt = dec.decode(u8);
                candidates.push({
                    enc,
                    text: txt,
                    jp: this.countJapaneseChars(txt)
                });
            } catch {
                // Falha de decodificação, ignorar este encoding
            }
        });

        // Se nenhum funcionou, usar UTF-8 como fallback
        if (!candidates.length) {
            return {
                encoding: 'utf-8',
                text: new TextDecoder('utf-8').decode(u8)
            };
        }

        // Priorizar por caracteres japoneses, depois UTF-8
        candidates.sort((a, b) => (b.jp - a.jp) || (a.enc === 'utf-8' ? -1 : 1));

        return {
            encoding: candidates[0].enc,
            text: candidates[0].text
        };
    }

    /**
     * Atualiza badge de encoding na UI
     * @param {string} encoding - Encoding detectado
     * @param {boolean} isAuto - Se foi auto-detectado
     */
    static updateBadge(encoding, isAuto) {
        const map = {
            'utf-8': 'UTF-8',
            'shift_jis': 'ANSI JP (Shift_JIS)',
            'windows-1252': 'ANSI Latin-1',
            'utf-16le': 'UTF-16 LE'
        };

        const label = map[encoding] || encoding;
        const badge = document.getElementById('encodingBadge');

        if (badge) {
            badge.textContent = label + (isAuto ? ' (auto)' : '');
            badge.title = `Codificação usada: ${label}${isAuto ? ' (detectada automaticamente)' : ''}`;
        }
    }
}
