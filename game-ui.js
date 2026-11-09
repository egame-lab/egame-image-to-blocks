// 介面狀態輔助：步驟印章、轉換後的預覽切換、複製完成的狀態。
// 只讀取既有狀態並更新畫面，不改動繪圖或積木轉換邏輯。
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const body = document.body;
  const copyButton = $('copyButton');
  const quickMessage = $('quickMessage');
  const frame = $('quickPreviewFrame');
  const resultCanvas = $('quickResultCanvas');
  const toast = $('messageBox');
  const frameTabs = document.querySelectorAll('[data-frame-show]');
  let copied = false;

  // ── 目前進行到哪一步：add → convert → copy → done ──
  function hasContent() {
    try { return !!(window.pixelEditorQuickPreview && window.pixelEditorQuickPreview().hasContent); }
    catch { return false; }
  }
  function updateStage() {
    const converted = !copyButton.disabled;
    if (!converted) copied = false;
    const has = converted || hasContent();
    body.dataset.stage = !has ? 'add' : !converted ? 'convert' : copied ? 'done' : 'copy';
  }
  let stageTimer;
  const scheduleStage = () => { clearTimeout(stageTimer); stageTimer = setTimeout(updateStage, 120); };

  // ── 預覽框：「你的圖片」／「積木效果」 ──
  function showFrame(which) {
    frame.dataset.show = which;
    frameTabs.forEach(tab => {
      const on = tab.dataset.frameShow === which;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-pressed', String(on));
    });
  }
  frameTabs.forEach(tab => tab.addEventListener('click', () => showFrame(tab.dataset.frameShow)));

  // 轉換完成後，把「積木顏色」畫面複製到快速模式的預覽框。
  function mirrorResult() {
    const src = $('previewCanvas');
    if (!src || !src.width || !src.height) return;
    resultCanvas.width = src.width;
    resultCanvas.height = src.height;
    const ctx = resultCanvas.getContext('2d');
    ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);
    ctx.drawImage(src, 0, 0);
  }

  let wasReady = !copyButton.disabled;
  function onConversionChange() {
    const ready = !copyButton.disabled;
    if (ready && !wasReady) {
      requestAnimationFrame(() => { mirrorResult(); showFrame('result'); });
    } else if (ready) {
      requestAnimationFrame(mirrorResult);
    } else {
      showFrame('source');
    }
    wasReady = ready;
    updateStage();
  }
  new MutationObserver(onConversionChange).observe(copyButton, { attributes: true, attributeFilter: ['disabled'] });

  // ── 複製成功 ──
  copyButton.addEventListener('click', () => {
    setTimeout(() => {
      const ok = toast.classList.contains('bg-green-100') && !toast.classList.contains('hidden');
      if (!ok) return;
      copied = true;
      quickMessage.textContent = '積木碼已複製，可貼到 E-game 使用。';
      updateStage();
    }, 0);
  });

  // 內容有變動時重新判斷（貼圖、替換、繪圖、復原／重做）
  window.addEventListener('egame:content-change', scheduleStage);
  document.addEventListener('pointerup', scheduleStage, true);
  document.addEventListener('keyup', scheduleStage, true);
  document.getElementById('quickDropZone').addEventListener('drop', () => setTimeout(updateStage, 300));

  showFrame('source');
  updateStage();
})();
