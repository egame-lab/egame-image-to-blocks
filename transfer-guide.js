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
  function makeBookmarkCommand() {
    return "javascript:(async()=>{try{const B=window.Blockly;if(!B||!B.Xml)throw Error('請先進入武館積木編輯畫面');let x='';try{x=await navigator.clipboard.readText()}catch(e){}if(!x)x=prompt('請貼上積木碼：')||'';x=x.trim();if(!x)return;const w=B.getMainWorkspace?B.getMainWorkspace():B.mainWorkspace;if(!w)throw Error('找不到積木工作區');const d=B.Xml.textToDom(/^<xml(?:\\s|>)/i.test(x)?x:'<xml xmlns=\"http://www.w3.org/1999/xhtml\">'+x+'</xml>');B.Xml.domToWorkspace(w,d);alert('積木匯入完成，請記得儲存')}catch(e){alert('積木匯入失敗：'+e.message)}})();";
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
      notice(kind === 'xml' ? '積木碼已複製。回到武館，使用已安裝工具的「貼上」按鈕。' :
        kind === 'console' ? '匯入指令已複製。回到 E-game 武館的 Console，貼上並按 Enter 執行。' :
        '書籤程式已複製。建立書籤後，請把程式貼到書籤的「網址」欄。', 'success');
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
