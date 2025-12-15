/**
 * Configurações e constantes globais do Copaiba Web
 */

export const COLORS = {
    overlap: '#22c55e',
    preutter: '#ef4444',
    consonant: '#ec4899',
    offset: '#1e3a8a',
    cutoff: '#60a5fa'
};

export const MARKERS = [
    { key: 'Q', id: 'offset', label: 'Corte inicial' },
    { key: 'W', id: 'overlap', label: 'Transição' },
    { key: 'E', id: 'preutter', label: 'Início da vogal' },
    { key: 'R', id: 'consonant', label: 'Parte de loop' },
    { key: 'T', id: 'cutoff', label: 'Corte final' }
];

export const DEFAULT_PREFS = {
    theme: 'light',
    vzoom: 1,
    showSpec: false,
    waveColor: '#000000',
    waveBgColor: null,
    presets: {
        overlap: 120,
        preutter: 300,
        consonant: 430,
        cutoff: -580
    }
};

export const STORAGE_KEYS = {
    PREFS: 'copaiba_prefs_v4',
    STARS: 'copaiba_stars_v1',
    FLOAT_PREFIX: 'flt:'
};
