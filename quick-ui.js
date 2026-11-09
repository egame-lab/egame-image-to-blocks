// 快速入口沿用原像素編輯器的畫布與積木轉換函式，不建立第二份編輯狀態。
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const quickTab = $('switchQuick'), advancedTab = $('switchAdvanced');
  const fitSelect = $('outputFitMode'), modeSelect = $('outputMode');
  const quickCopy = $('quickCopy'), quickMessage = $('quickMessage');
  const originalCopy = $('copyButton');
  const quickMode = $('quickOutputMode'), quickResolution = $('quickResolution');
  const quickColor = $('quickColorMode'), advancedOptions = $('quickAdvancedOptions');
  const resolutionSelect = $('resolution'), colorSelect = $('colorMode');
  const xmlOutput = $('blocklyXmlOutput'), quickXmlOutput = $('quickXmlOutput');
  const previewCanvas = $('quickPreviewCanvas'), empty = $('quickEmpty');
  const sizeReadout = $('quickDimensions');

  // The quick controls mirror the advanced controls. Both paths call the same converter.
  function syncQuickSettings() {
    quickMode.value = modeSelect.value;
    quickResolution.value = resolutionSelect.value;
    quickColor.value = colorSelect.value;
    const isAdvanced = quickMode.value === 'hidden';
    advancedOptions.hidden = !isAdvanced;
    const size = isAdvanced ? quickResolution.value : '80';
    document.querySelector('.quick-output-indicator').textContent = `輸出：${isAdvanced ? '內建擴充積木' : '標準積木'} ${size} × ${size}`;
  }
  function propagate(select, value) {
    if (select.value === value) return;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  quickMode.addEventListener('change', () => propagate(modeSelect, quickMode.value));
  quickResolution.addEventListener('change', () => propagate(resolutionSelect, quickResolution.value));
  quickColor.addEventListener('change', () => propagate(colorSelect, quickColor.value));
  [modeSelect, resolutionSelect, colorSelect].forEach(el => el.addEventListener('change', syncQuickSettings));
  syncQuickSettings();
  let hasImage = false;

  function refreshQuickPreview() {
    if (!window.pixelEditorQuickPreview) return;
    const info = window.pixelEditorQuickPreview();
    hasImage = info.hasContent;
    if (!info.hasContent) {
      previewCanvas.hidden = true;
      empty.hidden = false;
      sizeReadout.textContent = '尚未放入圖片';
      $('quickOpen').textContent = '選擇圖片';
      if (originalCopy.disabled) quickMessage.textContent = '請先放入一張圖片。';
      return;
    }
    const source = info.image;
    const factor = Math.min(1, 900 / source.width, 900 / source.height);
    previewCanvas.width = Math.max(1, Math.round(source.width * factor));
    previewCanvas.height = Math.max(1, Math.round(source.height * factor));
    const ctx = previewCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(source, 0, 0, previewCanvas.width, previewCanvas.height);
    previewCanvas.hidden = false;
    empty.hidden = true;
    sizeReadout.textContent = `${source.width} × ${source.height} px`;
    $('quickOpen').textContent = '更換圖片';
    quickMessage.textContent = originalCopy.disabled
      ? '圖片已放入。請按「預覽積木效果」。'
      : '已產生積木預覽。可查看積木效果或按「複製積木碼」。';
  }

  function syncFit() {
    document.querySelectorAll('[data-quick-fit]').forEach(b => {
      const selected = b.dataset.quickFit === fitSelect.value;
      b.classList.toggle('selected', selected);
      b.setAttribute('aria-pressed', String(selected));
    });
  }
  document.querySelectorAll('[data-quick-fit]').forEach(button => {
    button.addEventListener('click', () => {
      if (fitSelect.value !== button.dataset.quickFit) {
        fitSelect.value = button.dataset.quickFit;
        fitSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncFit();
    });
  });
  fitSelect.addEventListener('change', syncFit);
  syncFit();

  function showView(view) {
    const advanced = view === 'advanced';
    document.body.dataset.view = view;
    quickTab.classList.toggle('is-active', !advanced);
    advancedTab.classList.toggle('is-active', advanced);
    quickTab.setAttribute('aria-pressed', String(!advanced));
    advancedTab.setAttribute('aria-pressed', String(advanced));
    if (advanced) {
      requestAnimationFrame(() => $('editorFit').click());
    } else {
      syncQuickSettings();
      refreshQuickPreview();
    }

  }
  quickTab.addEventListener('click', () => showView('quick'));
  advancedTab.addEventListener('click', () => showView('advanced'));
  $('quickEditImage').addEventListener('click', () => showView('advanced'));
  $('quickOpen').addEventListener('click', () => $('imageUpload').click());
  $('quickPaste').addEventListener('click', () => $('editorPaste').click());

  const drop = $('quickDropZone');
  drop.addEventListener('dragover', e => {
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    drop.classList.add('dragover');
  });
  drop.addEventListener('dragenter', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', e => {
    if (!drop.contains(e.relatedTarget)) drop.classList.remove('dragover');
  });
  drop.addEventListener('drop', e => {
    e.preventDefault(); e.stopPropagation(); drop.classList.remove('dragover');
    if (e.dataTransfer?.files?.length) processFiles(e.dataTransfer.files, 'quick-replace');
  });

  $('quickConvert').addEventListener('click', () => {
    refreshQuickPreview();
    if (!hasImage) {
      quickMessage.textContent = '尚未放入圖片。請選擇圖片，或按 Ctrl+V 貼上。';
      return;
    }
    quickMessage.textContent = '正在預覽積木效果…';
    $('editorApply').click();
  });
  quickCopy.addEventListener('click', () => {
    if (!originalCopy.disabled) originalCopy.click();
  });
  function syncConversion() {
    const ready = !originalCopy.disabled;
    quickCopy.disabled = !ready;
    quickXmlOutput.value = ready ? xmlOutput.value : '';
    $('quickXmlStatus').textContent = ready ? '已產生積木預覽，可全選或直接從下方複製。' : '先預覽積木效果，即可查看完整程式碼。';
    if (ready) quickMessage.textContent = '已產生積木預覽。可查看積木效果或按「複製積木碼」。';
  }
  new MutationObserver(syncConversion).observe(originalCopy, {attributes:true,attributeFilter:['disabled']});
  window.addEventListener('egame:content-change', refreshQuickPreview);
  showView('quick');
  syncConversion();
})();
