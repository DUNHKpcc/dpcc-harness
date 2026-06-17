/**
 * Element Inspector — injectable script for the Browser Panel's "Element Grab" feature.
 *
 * `getInspectorScript()` returns a self-contained IIFE string that, when executed
 * inside a webview via `executeJavaScript()`, creates a hover overlay and click
 * handler. Captured element data is sent back via `console.log` with a
 * `__pcc_agent_grab__` marker so the renderer can filter it from normal console output.
 */

// Marker used to identify our messages in the console-message stream.
export const GRAB_MARKER = "__pcc_agent_grab__";

/**
 * Returns the injectable JavaScript string. The script:
 * - Shows a blue overlay that tracks the hovered element
 * - On click, captures element metadata and sends it via console.log
 * - On Escape, sends a cancellation signal
 * - Exposes `window.__pcc_agent_inspector_cleanup__()` for teardown
 */
export function getInspectorScript(): string {
  // Everything inside the template literal runs in the webview context —
  // no closures or imports are available, it must be fully self-contained.
  return `(function() {
  /* Guard against double-injection */
  if (window.__pcc_agent_inspector_active__) return;
  window.__pcc_agent_inspector_active__ = true;

  /* ── Overlay ── */
  var overlay = document.createElement('div');
  overlay.id = '__pcc_agent_inspector_overlay__';
  overlay.style.cssText =
    'position:fixed;pointer-events:none;z-index:2147483647;' +
    'border:2px solid #3b82f6;background:rgba(59,130,246,0.08);' +
    'transition:top 0.08s ease,left 0.08s ease,width 0.08s ease,height 0.08s ease;' +
    'border-radius:3px;display:none;';
  document.documentElement.appendChild(overlay);

  /* ── Label (tag + dimensions) ── */
  var label = document.createElement('div');
  label.style.cssText =
    'position:absolute;bottom:-22px;left:0;padding:2px 6px;' +
    'font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;' +
    'color:#fff;background:#3b82f6;border-radius:3px;white-space:nowrap;' +
    'pointer-events:none;max-width:300px;overflow:hidden;text-overflow:ellipsis;';
  overlay.appendChild(label);

  var currentTarget = null;

  /* ── Helpers ── */

  /** Build a best-effort CSS selector (max 5 ancestors). */
  function buildSelector(el) {
    var parts = [];
    var node = el;
    for (var i = 0; i < 5 && node && node !== document.documentElement; i++) {
      if (node.nodeType !== 1) break;
      if (node.id) {
        parts.unshift('#' + CSS.escape(node.id));
        break; // id is unique enough
      }
      var seg = node.tagName.toLowerCase();
      // Add first two classes for specificity
      if (node.classList && node.classList.length > 0) {
        var cls = Array.prototype.slice.call(node.classList, 0, 2);
        seg += '.' + cls.map(function(c) { return CSS.escape(c); }).join('.');
      }
      // nth-of-type for disambiguation among siblings
      var parent = node.parentElement;
      if (parent) {
        var siblings = parent.children;
        var sameTag = 0, idx = 0;
        for (var j = 0; j < siblings.length; j++) {
          if (siblings[j].tagName === node.tagName) {
            sameTag++;
            if (siblings[j] === node) idx = sameTag;
          }
        }
        if (sameTag > 1) seg += ':nth-of-type(' + idx + ')';
      }
      parts.unshift(seg);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  /** Whitelist of attributes worth capturing. */
  var ATTR_WHITELIST = [
    'id','href','src','alt','name','type','role','aria-label','aria-labelledby',
    'data-testid','placeholder','value','title','action','method','for',
    'target','rel','download','tabindex','disabled','checked','selected',
  ];

  function captureAttributes(el) {
    var result = {};
    for (var i = 0; i < ATTR_WHITELIST.length; i++) {
      var a = ATTR_WHITELIST[i];
      if (el.hasAttribute && el.hasAttribute(a)) {
        result[a] = el.getAttribute(a) || '';
      }
    }
    return result;
  }

  /** Key computed styles to capture. */
  var STYLE_KEYS = [
    'display','position','visibility','opacity','width','height',
    'color','backgroundColor','fontSize','fontWeight','zIndex',
    'overflow','cursor','borderRadius','padding','margin',
  ];

  function captureStyles(el) {
    var result = {};
    try {
      var cs = window.getComputedStyle(el);
      for (var i = 0; i < STYLE_KEYS.length; i++) {
        var k = STYLE_KEYS[i];
        var v = cs[k];
        if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') {
          result[k] = v;
        }
      }
    } catch(e) { /* cross-origin or detached element */ }
    return result;
  }

  /* ── Event handlers ── */

  function onMouseMove(e) {
    // Pierce shadow DOM when possible
    var el = (e.composedPath && e.composedPath().length > 0) ? e.composedPath()[0] : e.target;
    if (!el || el === overlay || el === label || el.nodeType !== 1) return;
    currentTarget = el;

    var rect = el.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';

    var tag = el.tagName.toLowerCase();
    var cls = el.classList && el.classList.length > 0
      ? '.' + Array.prototype.slice.call(el.classList, 0, 2).join('.')
      : '';
    var dims = Math.round(rect.width) + '×' + Math.round(rect.height);
    label.textContent = tag + cls + '  ' + dims;

    // Flip label above if near bottom edge
    if (rect.bottom + 24 > window.innerHeight) {
      label.style.bottom = 'auto';
      label.style.top = '-22px';
    } else {
      label.style.bottom = '-22px';
      label.style.top = 'auto';
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!currentTarget) return;

    var el = currentTarget;
    var data = {
      tag: el.tagName ? el.tagName.toLowerCase() : 'unknown',
      selector: buildSelector(el),
      classes: el.classList ? Array.prototype.slice.call(el.classList) : [],
      attributes: captureAttributes(el),
      textContent: ((el.innerText || el.textContent || '')).trim().slice(0, 500),
      outerHTML: (el.outerHTML || '').slice(0, 2000),
      computedStyles: captureStyles(el),
      boundingRect: (function() {
        var r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })(),
    };

    console.log(JSON.stringify({ __pcc_agent_grab__: true, data: data }));
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      console.log(JSON.stringify({ __pcc_agent_grab__: true, cancelled: true }));
    }
  }

  /* ── Cursor style override ── */
  var cursorStyle = document.createElement('style');
  cursorStyle.id = '__pcc_agent_inspector_cursor__';
  cursorStyle.textContent = '* { cursor: crosshair !important; }';
  document.documentElement.appendChild(cursorStyle);

  /* ── Attach listeners (capture phase to intercept before page handlers) ── */
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);

  /* ── Cleanup function — called when inspect mode is toggled off ── */
  window.__pcc_agent_inspector_cleanup__ = function() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (cursorStyle.parentNode) cursorStyle.parentNode.removeChild(cursorStyle);
    delete window.__pcc_agent_inspector_active__;
    delete window.__pcc_agent_inspector_cleanup__;
  };
})();`;
}

/** Cleanup script — call when disabling inspect mode. */
export function getCleanupScript(): string {
  return `if (window.__pcc_agent_inspector_cleanup__) window.__pcc_agent_inspector_cleanup__();`;
}
