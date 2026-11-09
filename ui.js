// 介面輔助：只處理畫面顯示，不改動轉換或繪圖邏輯。
(() => {
    'use strict';
    const $ = id => document.getElementById(id);

    // ── 1. 輸出方式卡片 ↔ 隱藏的 #outputMode 下拉選單 ──
    const modeSelect = $('outputMode');
    const modeCards = document.querySelectorAll('[data-mode-card]');
    const modeBOptions = $('modeBOptions');

    function syncMode() {
        const mode = modeSelect.value;
        modeCards.forEach(card => {
            const on = card.dataset.modeCard === mode;
            card.classList.toggle('selected', on);
            card.setAttribute('aria-pressed', String(on));
        });
        modeBOptions.hidden = mode !== 'hidden';
    }
    modeCards.forEach(card => card.addEventListener('click', () => {
        if (modeSelect.value !== card.dataset.modeCard) {
            modeSelect.value = card.dataset.modeCard;
            modeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        syncMode();
    }));
    modeSelect.addEventListener('change', syncMode);
    syncMode();

    // ── 2. 步驟狀態：轉換完成（可複製）時，步驟 1、2 打勾 ──
    const copyButton = $('copyButton');
    const copyHint = document.querySelector('.copy-hint');
    let scrollAfterConvert = false;

    function syncConverted() {
        const ready = !copyButton.disabled;
        document.body.dataset.converted = ready ? 'yes' : 'no';
        if (copyHint) copyHint.textContent = ready ? '複製後貼到 E-game 使用。' : '先預覽積木效果，才能複製。';
        if (ready && scrollAfterConvert) {
            scrollAfterConvert = false;
            if (document.body.dataset.view === 'advanced') {
                $('step2').scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
    }
    new MutationObserver(syncConverted).observe(copyButton, { attributes: true, attributeFilter: ['disabled'] });
    syncConverted();

    // 按下預覽按鈕後才自動捲到結果；預覽若失敗，10 秒後不再等待。
    let scrollTimer;
    $('editorApply').addEventListener('click', () => {
        scrollAfterConvert = true;
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(() => { scrollAfterConvert = false; }, 10000);
    }, true);

    // ── 3. 「更多」選單：點外面、按 Esc 或選了項目就收起 ──
    const moreMenu = $('moreMenu');
    document.addEventListener('click', e => {
        if (!moreMenu.open) return;
        if (!moreMenu.contains(e.target) || e.target.closest('.menu-list button')) moreMenu.open = false;
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && moreMenu.open) moreMenu.open = false;
    });

    // ── 3a. 圖案二級選單：選擇工具或點選外部時自動收合 ──
    const shapesMenu=$('editorShapesMenu');
    document.addEventListener('click', e=>{
        if(shapesMenu?.open && !shapesMenu.contains(e.target))shapesMenu.open=false;
    });
    document.addEventListener('keydown',e=>{
        if(e.key==='Escape' && shapesMenu?.open){shapesMenu.open=false; shapesMenu.querySelector('summary')?.focus();}
    });

    // ── 4. 「加入圖片」是 label，讓鍵盤也能操作 ──
    const addImage = $('addImageLabel');
    addImage.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            $('imageUpload').click();
        }
    });

    // ── 5. 圖層：顯示數量，第一次出現貼圖時自動展開 ──
    const layersFold = $('layersFold');
    const layersBadge = $('layersBadge');
    const layerCount = $('editorLayerCount');
    let lastCount = 0;

    function syncLayers() {
        const count = parseInt(layerCount.textContent, 10) || 0;
        layersBadge.textContent = String(count);
        layersBadge.hidden = count === 0;
        if (count > 0 && lastCount === 0) layersFold.open = true;
        lastCount = count;
    }
    new MutationObserver(syncLayers).observe(layerCount, { childList: true, characterData: true, subtree: true });
    syncLayers();

    // ── 6. 快捷尺寸隨編輯畫布實際大小標示目前選項 ──
    const editorDims = $('editorDims');
    const sizeButtons = document.querySelectorAll('[data-canvas-preset]');
    function syncCanvasSizes() {
        const dims = editorDims.textContent.replace(/\s/g, '');
        sizeButtons.forEach(button => {
            const n = button.dataset.canvasPreset;
            const isCurrent = dims === `${n}×${n}`;
            button.setAttribute('aria-pressed', String(isCurrent));
            button.title = `${n} × ${n}（${isCurrent ? '目前大小' : '改變編輯畫布大小'}）`;
        });
    }
    new MutationObserver(syncCanvasSizes).observe(editorDims, { childList: true, characterData: true, subtree: true });
    syncCanvasSizes();

    // ── 7. 視窗大小改變時，「符合視窗」模式自動重新置中 ──
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if ($('editorZoom').value === 'fit') $('editorFit').click();
        }, 150);
    });
})();
