// E-game 武館匯入指南：共用快速／進階模式的 XML；不讀取使用者剪貼簿。
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const guide = $('transferGuide');
  const dialog = guide.querySelector('.transfer-dialog');
  const status = $('transferStatus');
  const tabs = Array.from(guide.querySelectorAll('[data-transfer-method]'));
  const panels = Array.from(guide.querySelectorAll('[data-transfer-panel]'));
  const originalCopy = $('copyButton');
  const xmlOutput = $('blocklyXmlOutput');
  const copyXmlButton = $('transferCopyXml');
  const copyConsoleButton = $('transferCopyConsole');
  const copyBookmarkButton = $('transferCopyBookmark');
  let previousFocus = null;
  let view = 'tools';

  function currentXml() {
    if (originalCopy.disabled) return '';
    return xmlOutput.value.trim();
  }
  function updateReady() {
    const ready = !!currentXml();
    copyXmlButton.disabled = !ready;
    copyConsoleButton.disabled = !ready;
    return ready;
  }
  function notice(message, state = '') {
    status.textContent = message;
    status.dataset.state = state;
  }
  function switchMethod(name, focus) {
    view = name;
    for (const tab of tabs) {
      const selected = tab.dataset.transferMethod === name;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) panel.hidden = panel.dataset.transferPanel !== name;
    notice(name === 'bookmark' ? '書籤只需設定一次；建議在空白武館使用，避免影響原有積木。' :
      updateReady() ? '積木已準備好，可直接複製所選方法需要的內容。' :
      '請先在網站完成「預覽積木效果」，再複製積木碼或匯入指令。');
  }
  function openGuide() {
    previousFocus = document.activeElement;
    guide.hidden = false;
    document.body.classList.add('transfer-guide-open');
    switchMethod('tools', false);
    $('transferClose').focus();
  }
  function closeGuide() {
    guide.hidden = true;
    document.body.classList.remove('transfer-guide-open');
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  document.querySelectorAll('[data-open-transfer]').forEach(button => button.addEventListener('click', openGuide));
  $('transferClose').addEventListener('click', closeGuide);
  guide.addEventListener('mousedown', e => { if (e.target === guide) closeGuide(); });
  // iOS WebKit can rubber-band a dialog even with overscroll-behavior: contain.
  // Block only touch gestures that would go past the top/bottom of the guide;
  // ordinary scrolling inside the dialog and two-finger gestures stay enabled.
  let touchY = null;
  guide.addEventListener('touchstart', event => {
    touchY = event.touches.length === 1 ? event.touches[0].clientY : null;
  }, {passive: true});
  guide.addEventListener('touchend', () => { touchY = null; }, {passive: true});
  guide.addEventListener('touchcancel', () => { touchY = null; }, {passive: true});
  guide.addEventListener('touchmove', event => {
    if (guide.hidden || event.touches.length !== 1 || touchY === null) return;
    const nextY = event.touches[0].clientY;
    const deltaY = nextY - touchY;
    touchY = nextY;
    if (!deltaY || !event.cancelable) return;
    const outsideDialog = !dialog.contains(event.target);
    const atTop = dialog.scrollTop <= 1;
    const atBottom = dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 1;
    const noScroll = dialog.scrollHeight <= dialog.clientHeight + 1;
    if (outsideDialog || noScroll || (deltaY > 0 && atTop) || (deltaY < 0 && atBottom)) {
      event.preventDefault();
    }
  }, {passive: false});
  guide.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeGuide(); return; }
    if (e.key === 'Tab') {
      const tabbable = Array.from(dialog.querySelectorAll('button:not([disabled]):not([tabindex="-1"])')).filter(el => el.offsetParent !== null);
      if (!tabbable.length) return;
      const first = tabbable[0], last = tabbable[tabbable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => switchMethod(tab.dataset.transferMethod, false));
    tab.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      switchMethod(next.dataset.transferMethod, true);
    });
  });

  // 若積木 XML 已有 <xml> 根節點就沿用；否則包成符合 E-game 舊版 Blockly 的格式。
  function asWorkspaceXml(xml) {
    return /^<xml(?:\s|>)/i.test(xml) ? xml : `<xml xmlns="http://www.w3.org/1999/xhtml">${xml}</xml>`;
  }
  function makeConsoleCommand(xml) {
    const value = JSON.stringify(asWorkspaceXml(xml)).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `(() => {
  const B = window.Blockly;
  if (!B || !B.Xml) throw new Error('請先開啟 E-game 武館積木編輯畫面');
  const ws = B.getMainWorkspace ? B.getMainWorkspace() : B.mainWorkspace;
  if (!ws) throw new Error('找不到積木工作區');
  const dom = B.Xml.textToDom(${value});
  B.Xml.domToWorkspace(ws, dom); // E-game 使用舊版參數順序
  console.log('積木匯入完成，請記得儲存');
})();`;
  }
  // Android Chrome 的原生 prompt() 在測試時截斷 5,000 字元。
  // 手機書籤：可按鈕讀取剪貼簿，失敗時手動貼入 textarea；成功匯入會自動關閉。
  // 手機 Chrome 書籤網址不宜過長：短版完全獨立、不依賴載入外部 JS。
  // iOS Chrome 會透過 NSString stringByRemovingPercentEncoding 解碼 javascript: URL。
  // 書籤中 CSS 的百分號必須寫成 %25，否則解碼可能回傳 nil，導致書籤無反應。
  // 可直接讀剪貼簿，失敗時 textarea 手動貼上，XML 解析後才匯入。
  function makeBookmarkCommand() {
    return "javascript:(()=>{try{let b=Blockly,w=b.getMainWorkspace(),d=document,p=d.createElement('div');if(!w)throw 0;d.getElementById('eg-short-paste')?.remove();p.id='eg-short-paste';p.style='position:fixed;inset:0;z-index:2147483647;background:#0009;display:grid;place-items:center';p.innerHTML='<div style=\"background:white;color:black;padding:16px;width:90%25;max-width:500px\"><b>匯入積木</b><textarea style=\"display:block;width:100%25;box-sizing:border-box;height:30vh\" placeholder=\"長按貼上 XML\"></textarea><button>剪貼簿</button><button>匯入</button><button>取消</button><p></p></div>';d.body.append(p);let t=p.querySelector('textarea'),[a,c,x]=p.querySelectorAll('button'),s=p.querySelector('p'),done=false;function go(v){if(done)return;try{v=v.trim();v=/^<xml[\\s>]/i.test(v)?v:'<xml>'+v+'</xml>';let q=new DOMParser().parseFromString(v,'text/xml');if(q.querySelector('parsererror'))throw Error('XML 不完整');let n=q.getElementsByTagName('block').length;if(!n)throw Error('沒有積木');if(w.remainingCapacity&&w.remainingCapacity()<n)throw Error('容量不足');let l=w.getAllBlocks(false).length;b.Xml.domToWorkspace(w,b.Xml.textToDom(v));let m=w.getAllBlocks(false).length-l;done=true;p.remove();let z=d.createElement('div');z.textContent='匯入 '+m+'/'+n+' 個積木';z.style='position:fixed;z-index:2147483647;bottom:20px;left:20px;background:#164;color:white;padding:12px';d.body.append(z);setTimeout(()=>z.remove(),3000)}catch(e){s.textContent=e.message}}a.onclick=async()=>{try{go(await navigator.clipboard.readText())}catch{ s.textContent='請長按貼上'}};c.onclick=()=>go(t.value);x.onclick=()=>p.remove();t.onpaste=()=>setTimeout(()=>go(t.value),50)}catch{alert('請進入武館')}})();";
  }
  async function copyText(text) {
    // 寫入剪貼簿的授權行為只由使用者實際按鈕觸發，不會像 Console 範例那樣讀取網頁焦點。
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* file: URLs/permissions fallback */ }
    }
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(field);
    field.focus(); field.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* blocked by browser */ }
    field.remove();
    return ok;
  }
  async function copyWithFeedback(value, kind) {
    try {
      if (!await copyText(value)) throw new Error('瀏覽器不允許複製，請檢查剪貼簿權限');
      notice(kind === 'xml' ? '積木碼已複製。回到武館，使用工具或書籤匯入。' :
        kind === 'console' ? '匯入指令已複製。回到 E-game 武館的 Console，貼上並按 Enter 執行。' :
        '書籤程式已複製。建立書籤後，請把程式貼到書籤的「網址」欄。', 'success');
      if (kind === 'xml') {
        closeGuide();
        const prior = document.getElementById('egame-copy-notice');
        if (prior) prior.remove();
        const toast = document.createElement('div');
        toast.id = 'egame-copy-notice';
        toast.setAttribute('role', 'status');
        toast.textContent = '積木碼已複製，可切換到武館貼上';
        toast.style.cssText = 'position:fixed;left:12px;right:12px;bottom:16px;max-width:420px;margin:auto;z-index:99999;background:#283b30;color:#fff;border-radius:9px;padding:12px 16px;box-shadow:0 6px 25px #0005;font:15px/1.5 sans-serif;text-align:center';
        document.body.append(toast);
        setTimeout(() => toast.remove(), 2500);
      }
    } catch (err) { notice('複製失敗：' + err.message, 'error'); }
  }
  copyXmlButton.addEventListener('click', () => {
    const xml = currentXml();
    if (!xml) return notice('請先預覽積木效果。', 'error');
    copyWithFeedback(xml, 'xml');
  });
  copyConsoleButton.addEventListener('click', () => {
    const xml = currentXml();
    if (!xml) return notice('請先預覽積木效果。', 'error');
    copyWithFeedback(makeConsoleCommand(xml), 'console');
  });
  copyBookmarkButton.addEventListener('click', () => copyWithFeedback(makeBookmarkCommand(), 'bookmark'));
  new MutationObserver(() => { if (!guide.hidden) updateReady(); }).observe(originalCopy, {attributes:true,attributeFilter:['disabled']});
  updateReady();
  // 測試時可在 Console 使用純函式檢視指令，實際網站無需開啟 Console。
  window.egameTransferGuide = {makeConsoleCommand, makeBookmarkCommand};
})();
