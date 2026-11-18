/**
 * 数値入力中の UI 再描画で下書きが消えないようにするヘルパ。
 */

/** pending が実質同じならモーダルを作り直さないための指紋 */
export function pendingFingerprint(pend) {
  if (!pend || typeof pend !== 'object') return '';
  try {
    return JSON.stringify(pend);
  } catch {
    return String(pend.type || '');
  }
}

/**
 * input/textarea の現在値を安定キーで保存。
 * @param {ParentNode|null|undefined} root
 * @param {{ activeElement?: Element|null }} [opts]
 */
export function snapshotEditableFields(root, opts = {}) {
  if (!root?.querySelectorAll) return [];
  const active = opts.activeElement ?? (typeof document !== 'undefined' ? document.activeElement : null);
  return [...root.querySelectorAll('input, textarea')].map((el) => {
    if (el.type === 'hidden' || el.type === 'radio' || el.type === 'checkbox' || el.type === 'button' || el.type === 'submit') {
      return null;
    }
    const id = el.id || null;
    const sellCount = el.getAttribute('data-sell-count');
    const sellStock = el.getAttribute('data-sell-stock');
    const name = el.getAttribute('name');
    const key = id || (sellCount != null ? `sell-count:${sellCount}` : null)
      || (sellStock != null ? `sell-stock:${sellStock}` : null)
      || (name ? `name:${name}` : null);
    if (!key) return null;
    let selectionStart = null;
    let selectionEnd = null;
    try {
      selectionStart = el.selectionStart;
      selectionEnd = el.selectionEnd;
    } catch {
      /* number など未対応ブラウザ */
    }
    return {
      key,
      id,
      sellCount,
      sellStock,
      name,
      value: el.value,
      selectionStart,
      selectionEnd,
      focused: active === el,
    };
  }).filter(Boolean);
}

/**
 * @param {ParentNode|null|undefined} root
 * @param {ReturnType<typeof snapshotEditableFields>} drafts
 * @param {{ activeElement?: { focus?: Function } }} [opts] テスト用
 */
export function restoreEditableFields(root, drafts, opts = {}) {
  if (!root?.querySelector || !drafts?.length) return;
  for (const d of drafts) {
    let el = null;
    if (d.id) el = root.querySelector(`#${cssEscape(d.id)}`);
    if (!el && d.sellCount != null) el = root.querySelector(`input[data-sell-count="${cssEscape(String(d.sellCount))}"]`);
    if (!el && d.sellStock != null) el = root.querySelector(`input[data-sell-stock="${cssEscape(String(d.sellStock))}"]`);
    if (!el && d.name) el = root.querySelector(`[name="${cssEscape(d.name)}"]`);
    if (!el) continue;
    el.value = d.value;
    if (d.focused) {
      try {
        el.focus?.();
        if (d.selectionStart != null && d.selectionEnd != null && typeof el.setSelectionRange === 'function') {
          el.setSelectionRange(d.selectionStart, d.selectionEnd);
        }
      } catch {
        /* ignore */
      }
      opts.activeElement = el;
    }
  }
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return String(value).replace(/"/g, '\\"');
}
