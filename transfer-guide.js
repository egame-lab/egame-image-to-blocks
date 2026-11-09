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
  // Android Chrome 的原生 prompt() 在測試時截斷 5,000 字元。
  // 手機書籤：可按鈕讀取剪貼簿，失敗時手動貼入 textarea；成功匯入會自動關閉。
  function makeBookmarkCommand() {
    function openEgameXmlPaste() {
      try {
        const B = window.Blockly;
        const w = B && (B.getMainWorkspace ? B.getMainWorkspace() : B.mainWorkspace);
        if (!B || !B.Xml || !w) throw Error('請先進入 E-game 武館積木編輯畫面');
        const previous = document.getElementById('egame-xml-paste-panel');
        if (previous) previous.remove();
        const layer = document.createElement('div');
        layer.id = 'egame-xml-paste-panel';
        layer.setAttribute('role', 'dialog');
        layer.setAttribute('aria-label', '匯入 E-game 積木');
        layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:12px;box-sizing:border-box;background:rgba(0,0,0,.7)';
        const panel = document.createElement('div');
        panel.style.cssText = 'width:100%;max-width:600px;max-height:92dvh;overflow:auto;box-sizing:border-box;background:#fff;color:#222;border-radius:12px;padding:16px;font:16px/1.5 system-ui,sans-serif;box-shadow:0 10px 35px #0006';
        const title = document.createElement('strong');
        title.textContent = '匯入 E-game 積木';
        title.style.cssText = 'display:block;font-size:18px;margin-bottom:6px';
        const help = document.createElement('div');
        help.textContent = '已複製積木碼？直接按下方按鈕。若無法讀取剪貼簿，也能長按文字框貼上。';
        help.style.cssText = 'font-size:14px;margin-bottom:10px';
        const fromClipboard = document.createElement('button');
        fromClipboard.type = 'button';
        fromClipboard.textContent = '從剪貼簿匯入';
        fromClipboard.style.cssText = 'display:block;width:100%;min-height:48px;border:0;border-radius:8px;background:#2563eb;color:white;font-size:16px;font-weight:600;margin:0 0 10px';
        const fallbackLabel = document.createElement('div');
        fallbackLabel.textContent = '或長按下方輸入框貼上（貼上後自動驗證並匯入）';
        fallbackLabel.style.cssText = 'font-size:13px;color:#555;margin-bottom:6px';
        const input = document.createElement('textarea');
        input.placeholder = '長按此處貼上完整 XML；不使用 5,000 字元限制的 prompt';
        input.setAttribute('spellcheck', 'false');
        input.style.cssText = 'display:block;box-sizing:border-box;width:100%;height:24dvh;min-height:110px;max-height:45vh;resize:vertical;overflow:auto;border:1px solid #999;border-radius:7px;padding:10px;color:#222;background:#fff;font:16px/1.4 monospace';
        const status = document.createElement('div');
        status.setAttribute('role', 'status');
        status.style.cssText = 'font-size:13px;min-height:26px;white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0';
        status.textContent = '尚未匯入積木';
        const controls = document.createElement('div');
        controls.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '取消';
        close.style.cssText = 'min-height:40px;padding:7px 16px;border:1px solid #aaa;background:#eee;color:#222;border-radius:7px;font-size:15px';
        close.onclick = () => layer.remove();
        const submit = document.createElement('button');
        submit.type = 'button';
        submit.textContent = '手動驗證並匯入';
        submit.style.cssText = 'min-height:40px;padding:7px 16px;border:1px solid #2563eb;background:#fff;color:#1d4ed8;border-radius:7px;font-size:15px';
        let completed = false;
        let pasteTask = null;
        function setStatus(message, color) {
          status.style.color = color || '#333';
          status.textContent = message;
        }
        function announceSuccess(count) {
          layer.remove();
          const existing = document.getElementById('egame-xml-paste-success');
          if (existing) existing.remove();
          const toast = document.createElement('div');
          toast.id = 'egame-xml-paste-success';
          toast.setAttribute('role', 'status');
          toast.textContent = '已匯入 ' + count + ' 個積木，請記得儲存武館';
          toast.style.cssText = 'position:fixed;left:12px;right:12px;bottom:20px;margin:auto;max-width:480px;z-index:2147483647;border-radius:9px;background:#166534;color:#fff;padding:13px 15px;box-shadow:0 6px 24px #0007;text-align:center;font:15px/1.5 system-ui,sans-serif';
          document.body.append(toast);
          toast.onclick = () => toast.remove();
          setTimeout(() => toast.remove(), 3500);
        }
        function importXml(value) {
          if (completed || !layer.isConnected) return;
          try {
            const x = value.trim();
            if (!x) throw Error('請先貼上積木碼');
            const xml = /^<xml(?:\s|>)/i.test(x) ? x : '<xml xmlns="http://www.w3.org/1999/xhtml">' + x + '</xml>';
            const parsed = new DOMParser().parseFromString(xml, 'application/xml');
            if (parsed.getElementsByTagName('parsererror').length) throw Error('XML 結構不完整，請重新複製完整內容');
            const count = parsed.getElementsByTagName('block').length;
            if (!count) throw Error('找不到積木，請確認複製的是 XML');
            const available = typeof w.remainingCapacity === 'function' ? w.remainingCapacity() : Infinity;
            if (Number.isFinite(available) && count > available) throw Error('剩餘容量 ' + available + '，不足以容納 ' + count + ' 個積木');
            const before = w.getAllBlocks(false).length;
            B.Xml.domToWorkspace(w, B.Xml.textToDom(xml)); /* E-game 舊版 Blockly：workspace 在前 */
            const added = w.getAllBlocks(false).length - before;
            if (added !== count) {
              completed = true; /* 避免數量不符時連按導致重複插入 */
              fromClipboard.disabled = true;
              submit.disabled = true;
              setStatus('已加入 ' + added + '/' + count + ' 個積木，數量不一致，請檢查武館工作區。視窗保留供檢查，避免重複匯入。', '#b45309');
              return;
            }
            completed = true;
            announceSuccess(added);
          } catch (e) {
            setStatus('尚未匯入：' + e.message + '\n目前輸入 ' + (value || '').length.toLocaleString() + ' 字元', '#b91c1c');
          }
        }
        /* Android 有些輸入法只觸發 input(insertFromPaste)，因此兩種事件共用防重複排程。 */
        function schedulePasteImport() {
          clearTimeout(pasteTask);
          pasteTask = setTimeout(() => { if (!completed) importXml(input.value); }, 60);
        }
        input.addEventListener('input', e => {
          setStatus('已接收 ' + input.value.length.toLocaleString() + ' 個字元', '#333');
          if (e.inputType === 'insertFromPaste') schedulePasteImport();
        });
        input.addEventListener('paste', schedulePasteImport);
        submit.onclick = () => importXml(input.value);
        fromClipboard.onclick = async () => {
          if (completed) return;
          if (!navigator.clipboard || !navigator.clipboard.readText) {
            setStatus('瀏覽器不支援直接讀取剪貼簿，請長按下方文字框貼上。', '#b45309');
            return;
          }
          try {
            fromClipboard.disabled = true;
            const value = await navigator.clipboard.readText();
            if (!layer.isConnected) return;
            input.value = value;
            setStatus('已讀取 ' + value.length.toLocaleString() + ' 個字元，正在驗證…', '#333');
            importXml(value);
          } catch (e) {
            setStatus('瀏覽器未允許讀取剪貼簿；請長按下方文字框選擇「貼上」。', '#b45309');
          } finally {
            if (!completed) fromClipboard.disabled = false;
          }
        };
        controls.append(close, submit);
        panel.append(title, help, fromClipboard, fallbackLabel, input, status, controls);
        layer.append(panel);
        document.body.append(layer);
        layer.addEventListener('keydown', e => { if (e.key === 'Escape') layer.remove(); });
      } catch (e) {
        alert('積木貼上視窗開啟失敗：' + e.message);
      }
    }
    return 'javascript:(' + openEgameXmlPaste.toString().replace(/\s*\n\s*/g, '') + ')()';
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
