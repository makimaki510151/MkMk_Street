/** MkMk Street — イベントNPC定義（実装は engine.js） */

/** @typedef {'mark_fairy'|'merchant'|'poverty'} EventNpcKind */

export const EVENT_NPC_KINDS = {
  mark_fairy: {
    kind: 'mark_fairy',
    label: 'マークの妖精',
    diceMax: 10,
    color: '#c5a3ff',
    glyph: '妖',
  },
  merchant: {
    kind: 'merchant',
    label: '大商人',
    diceMax: 10,
    color: '#f0c060',
    glyph: '商',
  },
  poverty: {
    kind: 'poverty',
    label: '貧乏神',
    diceMax: 6,
    color: '#8a9a7b',
    glyph: '貧',
  },
};

export function eventNpcLabel(kind) {
  return EVENT_NPC_KINDS[kind]?.label || 'イベントNPC';
}
