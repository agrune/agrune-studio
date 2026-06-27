// 인페이지 캡처 스크립트(문자열) + REC 오버레이. 브라우저에서만 실행되므로 DOM을 자유롭게 쓴다.
// addInitScript로 모든 문서에 주입되며 네비게이션을 넘어 재적용된다. exposeBinding(BINDING)으로
// Node에 이벤트를 보낸다. nonce는 단조 카운터(결정론, Math.random 미사용).

import { HIT_ATTR } from './refmap.js'

export const BINDING = '__agruneRecord'
export const OVERLAY_ID = '__agrune_rec_overlay'

export const CAPTURE_SCRIPT = `(() => {
  if (window.__agruneRecInjected) return;
  window.__agruneRecInjected = true;
  var HIT = ${JSON.stringify(HIT_ATTR)};
  var BINDING = ${JSON.stringify(BINDING)};
  var OVERLAY_ID = ${JSON.stringify(OVERLAY_ID)};
  var seq = 0;
  function send(payload) { try { if (window[BINDING]) window[BINDING](payload); } catch (e) {} }
  function now() { try { return Math.round(performance.now()); } catch (e) { return 0; } }
  function inOverlay(el) { return !!(el && el.closest && el.closest('#' + OVERLAY_ID)); }
  function describe(el) {
    var d = { tag: (el.tagName || '').toLowerCase() };
    var role = el.getAttribute && el.getAttribute('role'); if (role) d.role = role;
    var tid = el.getAttribute && (el.getAttribute('data-testid') || el.getAttribute('data-test-id')); if (tid) d.testId = tid;
    var name = (el.getAttribute && el.getAttribute('aria-label')) || (el.textContent || '').trim().slice(0, 80); if (name) d.name = name;
    if (el.id) d.css = '#' + el.id;
    else if (el.className && typeof el.className === 'string') d.css = d.tag + '.' + el.className.trim().split(/\\s+/).join('.');
    else d.css = d.tag;
    return d;
  }
  function tag(el) { var n = 'n' + (++seq); try { el.setAttribute(HIT, n); } catch (e) {} return n; }
  function verbFor(el, type) {
    var t = (el.tagName || '').toLowerCase();
    if (type === 'click') return 'click';
    if (t === 'select') return 'select';
    if (t === 'input' && (el.type === 'checkbox')) return el.checked ? 'check' : 'uncheck';
    return 'fill';
  }
  document.addEventListener('click', function (e) {
    var el = e.target; if (!el || inOverlay(el)) return;
    send({ type: 'action', do: 'click', nonce: tag(el), rawTarget: describe(el), t: now() });
  }, true);
  document.addEventListener('change', function (e) {
    var el = e.target; if (!el || inOverlay(el)) return;
    var v = verbFor(el, 'change');
    var value = (v === 'fill' || v === 'select') ? String(el.value == null ? '' : el.value) : undefined;
    send({ type: 'action', do: v, value: value, nonce: tag(el), rawTarget: describe(el), t: now() });
  }, true);
  function navHook(url) { send({ type: 'nav', url: url || location.href, t: now() }); }
  var _ps = history.pushState; history.pushState = function () { var r = _ps.apply(this, arguments); navHook(location.href); return r; };
  var _rs = history.replaceState; history.replaceState = function () { var r = _rs.apply(this, arguments); navHook(location.href); return r; };
  window.addEventListener('popstate', function () { navHook(location.href); });
  function overlay() {
    if (document.getElementById(OVERLAY_ID)) return;
    var box = document.createElement('div'); box.id = OVERLAY_ID;
    box.setAttribute('style', 'position:fixed;z-index:2147483647;right:14px;bottom:14px;display:flex;gap:8px;align-items:center;font:600 12px -apple-system,system-ui,sans-serif;background:#161b22;color:#e6edf3;border:1px solid #2a323d;border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,.4)');
    var dot = document.createElement('span'); dot.setAttribute('style', 'width:9px;height:9px;border-radius:50%;background:#f85149;display:inline-block');
    var label = document.createElement('span'); label.textContent = 'REC';
    var bug = document.createElement('button'); bug.textContent = '버그다!';
    bug.setAttribute('style', 'cursor:pointer;border:none;border-radius:7px;padding:5px 10px;font:inherit;background:#f85149;color:#fff');
    bug.addEventListener('click', function () { send({ type: 'bug', t: now() }); });
    var cp = document.createElement('button'); cp.textContent = '체크포인트';
    cp.setAttribute('style', 'cursor:pointer;border:1px solid #2a323d;border-radius:7px;padding:5px 10px;font:inherit;background:#1c232d;color:#e6edf3');
    cp.addEventListener('click', function () { send({ type: 'checkpoint', t: now() }); });
    box.appendChild(dot); box.appendChild(label); box.appendChild(bug); box.appendChild(cp);
    (document.body || document.documentElement).appendChild(box);
  }
  if (document.body) overlay(); else document.addEventListener('DOMContentLoaded', overlay);
})();`
