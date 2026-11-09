// 將十六進位顏色字串 (例如 "#RRGGBB") 轉換為 RGB 陣列 [R, G, B]。
function hexToRgb(hex) {
    const r = parseInt(hex.substring(1, 3), 16);
    const g = parseInt(hex.substring(3, 5), 16);
    const b = parseInt(hex.substring(5, 7), 16);
    return [r, g, b];
}

function rgbToHex(r, g, b) {
    const to2 = value => value.toString(16).padStart(2, '0');
    return `#${to2(r)}${to2(g)}${to2(b)}`;
}

function drawImageToSquare(ctx, img, targetWidth, targetHeight, fitMode = 'stretch') {
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    if (fitMode === 'contain') {
        const scale = Math.min(targetWidth / img.naturalWidth, targetHeight / img.naturalHeight);
        const drawWidth = Math.max(1, Math.round(img.naturalWidth * scale));
        const drawHeight = Math.max(1, Math.round(img.naturalHeight * scale));
        const offsetX = Math.floor((targetWidth - drawWidth) / 2);
        const offsetY = Math.floor((targetHeight - drawHeight) / 2);
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
    } else {
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
    }
}

// 圖片轉換核心邏輯
function convertImageToNumberString(imageSrc, availableColors, indexMap, ditherStrength = 0.0, targetSize = 80, transparentCode = null, fitMode = 'stretch', isCurrent = () => true) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";

        img.onload = () => {
            if (!isCurrent()) { resolve(''); return; }
            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            const targetWidth = targetSize;
            const targetHeight = targetSize;
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            
            // 保持最近鄰居法 (保留邊緣銳利度)
            ctx.imageSmoothingEnabled = false; 
            drawImageToSquare(ctx, img, targetWidth, targetHeight, fitMode);

            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            const width = canvas.width;
            const height = canvas.height;
            let numberString = '';

            if (!Array.isArray(availableColors) || availableColors.some(color => !Array.isArray(color) || color.length !== 3)) {
                reject(new Error("可用顏色 (availableColors) 格式不正確。"));
                return;
            }

            // 顏色距離計算 (優化效能版，直接取平方和)
            function colorDistanceSquared(color1, color2) {
                const dr = color1[0] - color2[0];
                const dg = color1[1] - color2[1];
                const db = color1[2] - color2[2];
                return (dr * dr) + (dg * dg) + (db * db);
            }

            const getIndex = (x, y) => (y * width + x) * 4;

            // Dither Strength (由參數傳入): 設為 1.0 是標準抖動，設為 0.5 噪點少一半，設為 0.0 完全無抖動(純色塊) 

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = getIndex(x, y);
                    // The source PNG is a true RGBA bitmap. A fully transparent
                    // pixel must not become black during RGB quantization.
                    if (pixels[idx + 3] === 0) {
                        numberString += transparentCode ?? String(indexMap[0]);
                        continue;
                    }

                    const oldR = pixels[idx];
                    const oldG = pixels[idx + 1];
                    const oldB = pixels[idx + 2];

                    let minDistance = Infinity;
                    let closestColorIndex = -1;

                    // 找出色盤中最接近的顏色
                    for (let j = 0; j < availableColors.length; j++) {
                        const distance = colorDistanceSquared([oldR, oldG, oldB], availableColors[j]);
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestColorIndex = j;
                        }
                    }

                    const mappedIndex = indexMap[closestColorIndex];
                    numberString += String(mappedIndex);

                    const newColor = availableColors[closestColorIndex];
                    
                    // 計算捨棄的誤差，並乘上「抖動強度」來削弱副作用
                    const errR = (oldR - newColor[0]) * ditherStrength;
                    const errG = (oldG - newColor[1]) * ditherStrength;
                    const errB = (oldB - newColor[2]) * ditherStrength;

                    // 將當前像素值替換成量化後的色盤顏色，以便在畫布上呈現最終結果
                    pixels[idx] = newColor[0];
                    pixels[idx + 1] = newColor[1];
                    pixels[idx + 2] = newColor[2];

                    // Atkinson 矩陣將誤差平分為 8 份，但只把 6 份擴散出去 (總共只擴散 75%)
                    // 這會讓顏色允許「跑掉」25%，從而產生大面積乾淨的色塊，減少沙粒感。
                    const eR = errR * 0.125; // 1/8 的誤差
                    const eG = errG * 0.125;
                    const eB = errB * 0.125;

                    // 輔助函式：快速將誤差加上去
                    const addError = (offsetX, offsetY) => {
                        const nx = x + offsetX;
                        const ny = y + offsetY;
                        if (nx >= 0 && nx < width && ny < height) {
                            const i = getIndex(nx, ny);
                            if (pixels[i + 3] === 0) return;
                            pixels[i]     += eR;
                            pixels[i + 1] += eG;
                            pixels[i + 2] += eB;
                        }
                    };

                    // Atkinson 矩陣的擴散位置：
                    addError(1, 0);  // 右 (x+1, y)
                    addError(2, 0);  // 右二 (x+2, y)
                    addError(-1, 1); // 左下 (x-1, y+1)
                    addError(0, 1);  // 下 (x, y+1)
                    addError(1, 1);  // 右下 (x+1, y+1)
                    addError(0, 2);  // 下二 (x, y+2)
                }
            }

            // 將轉換後的像素資料繪製到預覽畫布上
            const previewCanvas = document.getElementById('previewCanvas');
            if (previewCanvas) {
                const previewCtx = previewCanvas.getContext('2d');
                previewCanvas.width = targetWidth;
                previewCanvas.height = targetHeight;
                previewCtx.putImageData(imageData, 0, 0);
            }
            
            resolve(numberString);
        };

        img.onerror = (error) => {
            reject(new Error(`圖片載入失敗: ${error.message || '未知錯誤'}`));
        };

        img.src = imageSrc;
    });
}


// 從縮放後圖片建立最多 maxColors 色的自適應色盤（快速加權 Median Cut）。
// 先把 RGB 各縮到 5 bit 建直方圖，避免 200×200 時對數萬個唯一 RGB 反覆排序。
function buildAdaptivePalette(pixels, maxColors = 256, preserveAlpha = false) {
    // 5-bit RGB 直方圖：最多 32768 個桶，顏色保真度比 4-bit 好很多。
    const histogram = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
        if (preserveAlpha && pixels[i + 3] === 0) continue;
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let item = histogram.get(key);
        if (!item) {
            item = { rSum: 0, gSum: 0, bSum: 0, count: 0 };
            histogram.set(key, item);
        }
        item.rSum += r;
        item.gSum += g;
        item.bSum += b;
        item.count++;
    }

    const colors = [];
    for (const item of histogram.values()) {
        colors.push({
            r: Math.round(item.rSum / item.count),
            g: Math.round(item.gSum / item.count),
            b: Math.round(item.bSum / item.count),
            count: item.count
        });
    }

    if (colors.length === 0) return [[0, 0, 0]];
    if (colors.length <= maxColors) {
        return colors.map(c => [c.r, c.g, c.b]);
    }

    function makeBox(items) {
        let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0, total = 0;
        for (const c of items) {
            if (c.r < rMin) rMin = c.r;
            if (c.r > rMax) rMax = c.r;
            if (c.g < gMin) gMin = c.g;
            if (c.g > gMax) gMax = c.g;
            if (c.b < bMin) bMin = c.b;
            if (c.b > bMax) bMax = c.b;
            total += c.count;
        }
        const rRange = rMax - rMin;
        const gRange = gMax - gMin;
        const bRange = bMax - bMin;
        return { items, total, rRange, gRange, bRange, maxRange: Math.max(rRange, gRange, bRange) };
    }

    let boxes = [makeBox(colors)];
    while (boxes.length < maxColors) {
        let bestIndex = -1;
        let bestScore = -1;
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            if (box.items.length < 2 || box.maxRange === 0) continue;
            const score = box.maxRange * Math.sqrt(box.total);
            if (score > bestScore) {
                bestScore = score;
                bestIndex = i;
            }
        }
        if (bestIndex < 0) break;

        const box = boxes[bestIndex];
        let channel = 'r';
        if (box.gRange >= box.rRange && box.gRange >= box.bRange) channel = 'g';
        else if (box.bRange >= box.rRange && box.bRange >= box.gRange) channel = 'b';

        const sorted = box.items.slice().sort((a, b) => a[channel] - b[channel]);
        const half = box.total / 2;
        let acc = 0;
        let splitAt = 1;
        for (let i = 0; i < sorted.length - 1; i++) {
            acc += sorted[i].count;
            if (acc >= half) {
                splitAt = i + 1;
                break;
            }
        }
        const left = sorted.slice(0, splitAt);
        const right = sorted.slice(splitAt);
        if (!left.length || !right.length) break;
        boxes.splice(bestIndex, 1, makeBox(left), makeBox(right));
    }

    const palette = [];
    const seen = new Set();
    for (const box of boxes) {
        let rSum = 0, gSum = 0, bSum = 0, total = 0;
        for (const c of box.items) {
            rSum += c.r * c.count;
            gSum += c.g * c.count;
            bSum += c.b * c.count;
            total += c.count;
        }
        if (!total) continue;
        const rgb = [
            Math.round(rSum / total),
            Math.round(gSum / total),
            Math.round(bSum / total)
        ];
        const key = rgb.join(',');
        if (!seen.has(key)) {
            seen.add(key);
            palette.push(rgb);
        }
    }
    return palette.length ? palette : [[0, 0, 0]];
}

// 模式 B 256 色：先依這張圖建立自適應色盤，再用同一套 Atkinson 強度進行量化。
function convertImageAdaptive256(imageSrc, ditherStrength = 0.0, targetSize = 80, preserveAlpha = false, fitMode = 'stretch', isCurrent = () => true) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";

        img.onload = () => {
            if (!isCurrent()) { resolve({numberString:'', paletteHex:[], indexMap:[], alphaString:null}); return; }
            try {
            const canvas = document.getElementById('imageCanvas');
            const ctx = canvas.getContext('2d');
            canvas.width = targetSize;
            canvas.height = targetSize;
            ctx.imageSmoothingEnabled = false;
            drawImageToSquare(ctx, img, targetSize, targetSize, fitMode);

            const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
            const pixels = imageData.data;
            const width = targetSize;
            const height = targetSize;
            const paletteRgb = buildAdaptivePalette(pixels, 256, preserveAlpha);
            const alphaString = preserveAlpha ? Array.from({ length: width * height }, (_, i) => pixels[i * 4 + 3].toString(16).padStart(2, '0')).join('') : null;
            const paletteHex = paletteRgb.map(rgb => rgbToHex(rgb[0], rgb[1], rgb[2]));
            const indexMap = paletteRgb.map((_, i) => String(i).padStart(3, '0'));
            let numberString = '';

            function colorDistanceSquared(r, g, b, color) {
                const dr = r - color[0];
                const dg = g - color[1];
                const db = b - color[2];
                return dr * dr + dg * dg + db * db;
            }

            // 最近色結果用 5-bit RGB 鍵快取。最多只有 32768 種鍵，
            // 這樣仍然很快，但比 4-bit 更不容易把暖棕或米色壓壞。
            const nearestCache = new Int16Array(32768);
            nearestCache.fill(-1);
            function getClosestColorIndex(r, g, b) {
                const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
                const cached = nearestCache[key];
                if (cached >= 0) return cached;
                let best = 0;
                let minDistance = Infinity;
                for (let j = 0; j < paletteRgb.length; j++) {
                    const distance = colorDistanceSquared(r, g, b, paletteRgb[j]);
                    if (distance < minDistance) {
                        minDistance = distance;
                        best = j;
                    }
                }
                nearestCache[key] = best;
                return best;
            }

            const getIndex = (x, y) => (y * width + x) * 4;

            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = getIndex(x, y);
                    if (preserveAlpha && pixels[idx + 3] === 0) {
                        numberString += indexMap[0];
                        continue;
                    }
                    const oldR = pixels[idx];
                    const oldG = pixels[idx + 1];
                    const oldB = pixels[idx + 2];

                    const closestColorIndex = getClosestColorIndex(oldR, oldG, oldB);

                    numberString += indexMap[closestColorIndex];
                    const newColor = paletteRgb[closestColorIndex];
                    const errR = (oldR - newColor[0]) * ditherStrength;
                    const errG = (oldG - newColor[1]) * ditherStrength;
                    const errB = (oldB - newColor[2]) * ditherStrength;

                    pixels[idx] = newColor[0];
                    pixels[idx + 1] = newColor[1];
                    pixels[idx + 2] = newColor[2];

                    const eR = errR * 0.125;
                    const eG = errG * 0.125;
                    const eB = errB * 0.125;

                    const addError = (offsetX, offsetY) => {
                        const nx = x + offsetX;
                        const ny = y + offsetY;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const i = getIndex(nx, ny);
                            if (preserveAlpha && pixels[i + 3] === 0) return;
                            pixels[i] += eR;
                            pixels[i + 1] += eG;
                            pixels[i + 2] += eB;
                        }
                    };

                    addError(1, 0);
                    addError(2, 0);
                    addError(-1, 1);
                    addError(0, 1);
                    addError(1, 1);
                    addError(0, 2);
                }
            }

            const previewCanvas = document.getElementById('previewCanvas');
            if (previewCanvas) {
                const previewCtx = previewCanvas.getContext('2d');
                previewCanvas.width = targetSize;
                previewCanvas.height = targetSize;
                previewCtx.putImageData(imageData, 0, 0);
            }

            resolve({ numberString, paletteHex, indexMap, alphaString });
            } catch (error) {
                reject(error);
            }
        };

        img.onerror = (error) => {
            reject(new Error(`圖片載入失敗: ${error.message || '未知錯誤'}`));
        };

        img.src = imageSrc;
    });
}

/**
 * 將數字字串轉換成積木 XML 格式。
 * @param {string} numberString - 轉換後的數字字串。
 * @returns {string} - 轉換後的積木 XML。
 */
function buildRowRuns(numberString, size, codeWidth = 2) {
    const rows = [];
    for (let y = 0; y < size; y++) {
        const row = [];
        const rowStart = y * size * codeWidth;
        let prev = numberString.substring(rowStart, rowStart + codeWidth);
        let len = 1;
        for (let x = 1; x < size; x++) {
            const code = numberString.substring(rowStart + x * codeWidth, rowStart + (x + 1) * codeWidth);
            if (code === prev) {
                len++;
            } else {
                row.push({ code: prev, len });
                prev = code;
                len = 1;
            }
        }
        row.push({ code: prev, len });
        rows.push(row);
    }
    return rows;
}

function encodeRunsText(rows, countWidth = 3, lenWidth = 3) {
    let encoded = '';
    let totalRuns = 0;
    let maxRunsPerRow = 0;
    for (const row of rows) {
        totalRuns += row.length;
        maxRunsPerRow = Math.max(maxRunsPerRow, row.length);
        encoded += String(row.length).padStart(countWidth, '0');
        for (const run of row) {
            encoded += run.code;
            encoded += String(run.len).padStart(lenWidth, '0');
        }
    }
    return { encoded, totalRuns, maxRunsPerRow };
}

function textToBlocksOriginal(numberString, hexColors, newIndexMap, hasTransparency = false) {
    const string_v_left = `<block type="procedures_defreturn" collapsed="true" x="0" y="0"><mutation><arg name="array"></arg><arg name="prefix"></arg><arg name="_i"></arg></mutation><field name="NAME">array_next</field><statement name="STACK"><block type="procedures_ifreturn"><mutation value="1"></mutation><value name="CONDITION"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="variables_get"><field name="VAR">prefix</field></block></value><value name="B"><block type="variables_get"><field name="VAR">array</field></block></value></block></value><value name="VALUE"><block type="math_number"><field name="NUM">-1</field></block></value><next><block type="controls_for"><field name="VAR">_i</field><value name="TO"><block type="math_number"><field name="NUM">8</field></block></value><statement name="DO"><block type="controls_if"><value name="IF0"><block type="logic_compare"><field name="OP">GT</field><value name="A"><block type="math_arithmetic"><field name="OP">ADD</field><value name="A"><block type="variables_get"><field name="VAR">prefix</field></block></value><value name="B"><block type="math_arithmetic"><field name="OP">ADD</field><value name="A"><block type="variables_get"><field name="VAR">_i</field></block></value><value name="B"><block type="math_number"><field name="NUM">1</field></block></value></block></value></block></value><value name="B"><block type="variables_get"><field name="VAR">array</field></block></value></block></value><statement name="DO0"><block type="controls_flow_statements"><field name="FLOW">BREAK</field></block></statement></block></statement></block></next></block></statement><value name="RETURN"><block type="variables_get"><field name="VAR">_i</field></block></value></block><block type="procedures_defnoreturn" collapsed="true" x="0" y="52"><mutation><arg name="color"></arg></mutation><field name="NAME">choose</field><statement name="STACK"><block type="controls_if"><mutation elseif="69" else="1"></mutation>`;
    const string_v_right = `<statement name="ELSE"><block type="draw_colour"><value name="COLOUR"><block type="variables_get"><field name="VAR">transparent</field></block></value></block></statement></block></statement></block><block type="variables_set" x="0" y="104"><field name="VAR">data</field><value name="VALUE"><block type="colour_picker"><field name="COLOUR">#000000</field></block></value><next><block type="variables_set"><field name="VAR">prefix</field><value name="VALUE"><block type="colour_picker"><field name="COLOUR">#000000</field></block></value><next><block xmlns="http://www.w3.org/1999/xhtml" type="variables_set" collapsed="true"><field name="VAR">data</field><value name="VALUE">`;
    const string_w = `<block type="math_arithmetic" inline="false"><field name="OP">ADD</field><value name="A">`;
    const string_x = `<block type="variables_get"><field name="VAR">data</field></block>`;
    const string_y_left = `</value><value name="B"><block type="math_number"><field name="NUM">`;
    const string_y_right = `</field></block></value></block>`;
    const string_z = `</value><next><block type="variables_set"><field name="VAR">transparent</field><value name="VALUE"><block type="math_arithmetic"><field name="OP">ADD</field><value name="A"><block type="math_arithmetic"><field name="OP">ADD</field><value name="A"><block type="variables_get"><field name="VAR">prefix</field></block></value></block></value></block></value><next><block type="jump"><field name="DIR">jumpForward</field><value name="VALUE"><block type="math_number"><field name="NUM">197.5</field></block></value><next><block type="draw_turn"><field name="DIR">turnRight</field><value name="VALUE"><block type="math_number"><field name="NUM">90</field></block></value><next><block type="jump"><field name="DIR">jumpBackward</field><value name="VALUE"><block type="math_number"><field name="NUM">197.5</field></block></value><next><block type="controls_repeat_ext"><value name="TIMES"><block type="math_number"><field name="NUM">80</field></block></value><statement name="DO"><block type="controls_repeat_ext"><value name="TIMES"><block type="math_number"><field name="NUM">80</field></block></value><statement name="DO"><block type="variables_set"><field name="VAR">color</field><next><block type="controls_repeat_ext"><value name="TIMES"><block type="math_number"><field name="NUM">2</field></block></value><statement name="DO"><block type="variables_set"><field name="VAR">next</field><value name="VALUE"><block type="procedures_callreturn"><mutation name="array_next"><arg name="array"></arg><arg name="prefix"></arg><arg name="_i"></arg></mutation><value name="ARG0"><block type="variables_get"><field name="VAR">data</field></block></value><value name="ARG1"><block type="variables_get"><field name="VAR">prefix</field></block></value></block></value><next><block type="variables_set"><field name="VAR">prefix</field><value name="VALUE"><block type="math_arithmetic"><field name="OP">ADD</field><value name="A"><block type="variables_get"><field name="VAR">prefix</field></block></value><value name="B"><block type="variables_get"><field name="VAR">next</field></block></value></block></value><next><block type="variables_set"><field name="VAR">color</field><value name="VALUE"><block type="math_arithmetic"><field name="OP">ADD</field><value name="A"><block type="math_arithmetic"><field name="OP">MULTIPLY</field><value name="A"><block type="variables_get"><field name="VAR">color</field></block></value><value name="B"><block type="math_number"><field name="NUM">10</field></block></value></block></value><value name="B"><block type="variables_get"><field name="VAR">next</field></block></value></block></value></block></next></block></next></block></statement><next><block type="procedures_callnoreturn"><mutation name="choose"><arg name="color"></arg></mutation><value name="ARG0"><block type="variables_get"><field name="VAR">color</field></block></value><next><block type="draw_move"><field name="DIR">moveForward</field><next><block type="jump"><field name="DIR">jumpForward</field><value name="VALUE"><block type="math_number"><field name="NUM">5</field></block></value></block></next></block></next></block></next></block></next></block></statement><next><block type="draw_turn"><field name="DIR">turnLeft</field><value name="VALUE"><block type="math_number"><field name="NUM">0.71615994547</field></block></value><next><block type="jump"><field name="DIR">jumpBackward</field><value name="VALUE"><block type="math_number"><field name="NUM">400.031248779392</field></block></value><next><block type="draw_turn"><field name="DIR">turnRight</field><value name="VALUE"><block type="math_number"><field name="NUM">0.71615994547</field></block></value></block></next></block></next></block></next></block></next></block>`;
    let result_v = "";
    let result_y = "";
    for (let i = 0; i < hexColors.length; i++) {
        result_v += `<value name="IF${i}"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="variables_get"><field name="VAR">color</field></block></value><value name="B"><block type="math_number"><field name="NUM">${newIndexMap[i]}</field></block></value></block></value><statement name="DO${i}"><block type="draw_colour"><value name="COLOUR"><block type="colour_picker"><field name="COLOUR">${hexColors[i]}</field></block></value></block></statement>`;
    }
    result_v = string_v_left + result_v + string_v_right;

    const chunkSize = 16;
    let repeat = 0;
    for (let i = 0; i < numberString.length; i += chunkSize) {
        const chunk = numberString.substring(i, i + chunkSize);
        result_y += string_y_left + chunk + string_y_right;
        repeat++;
    }

    // Index 11 is reserved for transparent pixels (normal colors are 12..88).
    // Skip the pixel without painting, but keep the same Turtle travel distance.
    // Add the condition only if the image contains real transparent pixels.
    let drawingTail = string_z;
    if (hasTransparency) {
        const move = '<block type="draw_move"><field name="DIR">moveForward</field><next>';
        const skipped = `<block type="controls_if"><mutation else="1"></mutation><value name="IF0"><block type="logic_compare"><field name="OP">EQ</field><value name="A"><block type="variables_get"><field name="VAR">color</field></block></value><value name="B"><block type="math_number"><field name="NUM">11</field></block></value></block></value><statement name="DO0"><block type="jump"><field name="DIR">jumpForward</field></block></statement><statement name="ELSE"><block type="draw_move"><field name="DIR">moveForward</field></block></statement><next>`;
        drawingTail = drawingTail.replace(move, skipped);
    }
    // Original v0.3.1 template contains a short closing-tag imbalance at
    // the very end of the massive numeric ADD chain. Complete only missing
    // structural closers, without changing any color, loop or drawing block.
    return completeLegacyBlockXml(result_v + string_w.repeat(repeat) + string_x + result_y + drawingTail);
}
function completeLegacyBlockXml(xml) {
    const tokens = /<\/?[A-Za-z][\w:-]*\b[^>]*>/g;
    const stack = [];
    let result = '', start = 0, match;
    while ((match = tokens.exec(xml))) {
        result += xml.slice(start, match.index);
        const tag = match[0], closing = tag.startsWith('</'), name = /^<\/?([\w:-]+)/.exec(tag)?.[1];
        if (closing) {
            const position = stack.lastIndexOf(name);
            if (position < 0) {start = tokens.lastIndex;continue;}
            while (stack.length - 1 > position) result += `</${stack.pop()}>`;
            stack.pop();result += tag;
        } else {
            result += tag;
            if (!tag.endsWith('/>'))stack.push(name);
        }
        start = tokens.lastIndex;
    }
    result += xml.slice(start);
    while (stack.length)result += `</${stack.pop()}>`;
    return result;
}


// 將 XML 文字欄位中的特殊字元轉義。
function escapeXmlText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// 模式 B：將來源色盤的結果重新編成「本圖局部色盤」。
// 色彩本身不變，只把實際用到的顏色重新編號，因此任何圖片仍先經過所選來源色盤量化。
function buildLocalPalette(numberString, hexColors, newIndexMap, sourceCodeWidth = 2, localIndexWidth = 2) {
    const globalCodeToHex = new Map();
    for (let i = 0; i < newIndexMap.length; i++) {
        globalCodeToHex.set(String(newIndexMap[i]).padStart(sourceCodeWidth, '0'), hexColors[i]);
    }

    const usedCodes = [];
    const codeToLocal = new Map();
    let localData = '';

    for (let i = 0; i < numberString.length; i += sourceCodeWidth) {
        const code = numberString.substring(i, i + sourceCodeWidth);
        if (!codeToLocal.has(code)) {
            codeToLocal.set(code, usedCodes.length);
            usedCodes.push(code);
        }
        localData += String(codeToLocal.get(code)).padStart(localIndexWidth, '0');
    }

    return {
        data: localData,
        colors: usedCodes.map(code => globalCodeToHex.get(code))
    };
}

// 模式 B：使用 Console 調出的 text / lists / text_getSubstring 隱藏積木。
// 圖片資料只需要一個 text 積木；色盤用一個 lists_create_with，且只保留本圖真正出現的顏色。
function textToBlocksHidden(numberString, hexColors, newIndexMap, size, sourceCodeWidth = 2, localIndexWidth = 2, alphaString = null) {
    const local = buildLocalPalette(numberString, hexColors, newIndexMap, sourceCodeWidth, localIndexWidth);
    // Alpha is stored per run, so the RGB palette stays at most 256 entries.
    let runData = local.data;
    if (alphaString !== null) {
        runData = '';
        for (let i = 0; i < size * size; i++) {
            const alpha = alphaString.substring(i * 2, i * 2 + 2);
            const code = alpha === '00' ? '0'.repeat(localIndexWidth) : local.data.substring(i * localIndexWidth, (i + 1) * localIndexWidth);
            runData += code + alpha;
        }
    }
    const rows = buildRowRuns(runData, size, localIndexWidth + (alphaString !== null ? 2 : 0));
    const runInfo = encodeRunsText(rows, 3, 3);
    const step = 400 / size;
    const startOffset = (400 - step) / 2;
    const rowReturnDistance = Math.sqrt(400 * 400 + step * step);
    const rowReturnAngle = Math.atan2(step, 400) * 180 / Math.PI;
    const cleanNumber = value => Number(value.toFixed(12)).toString();
    const rowReturnDistanceText = cleanNumber(rowReturnDistance);
    const rowReturnAngleText = cleanNumber(rowReturnAngle);

    const paletteItems = local.colors.map((hex, i) =>
        `<value name="ADD${i}"><block type="colour_picker"><field name="COLOUR">${hex}</field></block></value>`
    ).join('');

    const paletteBlock = `<block type="variables_set" x="0" y="0"><field name="VAR">palette</field><value name="VALUE"><block type="lists_create_with"><mutation items="${local.colors.length}"></mutation>${paletteItems}</block></value><next>`;
    const dataBlock = `<block type="variables_set"><field name="VAR">data</field><value name="VALUE"><block type="text"><field name="TEXT">${escapeXmlText(runInfo.encoded)}</field></block></value><next>`;
    const indexBlock = `<block type="variables_set"><field name="VAR">index</field><next>`;
    const startBlocks = `<block type="jump"><field name="DIR">jumpForward</field><value name="VALUE"><block type="math_number"><field name="NUM">${startOffset}</field></block></value><next><block type="draw_turn"><field name="DIR">turnRight</field><value name="VALUE"><block type="math_number"><field name="NUM">90</field></block></value><next><block type="jump"><field name="DIR">jumpBackward</field><value name="VALUE"><block type="math_number"><field name="NUM">${startOffset}</field></block></value><next>`;

    const readTextRange = (startExpr, endExpr) => `<block type="text_getSubstring"><mutation at1="true" at2="true"></mutation><field name="WHERE1">FROM_START</field><field name="WHERE2">FROM_START</field><value name="STRING"><block type="variables_get"><field name="VAR">data</field></block></value><value name="AT1">${startExpr}</value><value name="AT2">${endExpr}</value></block>`;
    const addExpr = (a, b) => `<block type="math_arithmetic"><field name="OP">ADD</field><value name="A">${a}</value><value name="B">${b}</value></block>`;
    const minusExpr = (a, b) => `<block type="math_arithmetic"><field name="OP">MINUS</field><value name="A">${a}</value><value name="B">${b}</value></block>`;
    const multExpr = (a, b) => `<block type="math_arithmetic"><field name="OP">MULTIPLY</field><value name="A">${a}</value><value name="B">${b}</value></block>`;
    const num = n => `<block type="math_number"><field name="NUM">${n}</field></block>`;
    // Empty B uses the E-game generator's default 0: numeric coercion with one fewer block.
    const toNumberExpr = a => `<block type="math_arithmetic"><field name="OP">MINUS</field><value name="A">${a}</value></block>`;
    const vget = name => `<block type="variables_get"><field name="VAR">${name}</field></block>`;

    const rowRunText = readTextRange(addExpr(vget('index'), num(1)), addExpr(vget('index'), num(3)));
    const colorText = readTextRange(addExpr(vget('index'), num(1)), addExpr(vget('index'), num(localIndexWidth)));
    const runLengthText = readTextRange(addExpr(vget('index'), num(1)), addExpr(vget('index'), num(3)));

    const getPaletteColor = `<block type="lists_getIndex"><mutation statement="false" at="true"></mutation><field name="MODE">GET</field><field name="WHERE">FROM_START</field><value name="VALUE"><block type="variables_get"><field name="VAR">palette</field></block></value><value name="AT">${addExpr(vget('color'), num(1))}</value></block>`;

    let drawRun = `<block type="variables_set"><field name="VAR">colorText</field><value name="VALUE">${colorText}</value><next><block type="variables_set"><field name="VAR">color</field><value name="VALUE">${toNumberExpr(vget('colorText'))}</value><next><block type="variables_set"><field name="VAR">index</field><value name="VALUE">${addExpr(vget('index'), num(localIndexWidth))}</value><next><block type="variables_set"><field name="VAR">runLengthText</field><value name="VALUE">${runLengthText}</value><next><block type="variables_set"><field name="VAR">runLength</field><value name="VALUE">${toNumberExpr(vget('runLengthText'))}</value><next><block type="variables_set"><field name="VAR">index</field><value name="VALUE">${addExpr(vget('index'), num(3))}</value><next><block type="draw_colour"><value name="COLOUR">${getPaletteColor}</value><next><block type="draw_move"><field name="DIR">moveForward</field><value name="VALUE">${multExpr(minusExpr(vget('runLength'), num(1)), num(step))}</value><next><block type="jump"><field name="DIR">jumpForward</field><value name="VALUE">${num(step)}</value></block></next></block></next></block></next></block></next></block></next></block></next></block></next></block></next></block>`;

    if (alphaString !== null) {
        const alphaText = readTextRange(addExpr(vget('index'), num(1)), addExpr(vget('index'), num(2)));
        const readAlpha = `<block type="variables_set"><field name="VAR">alphaText</field><value name="VALUE">${alphaText}</value><next><block type="variables_set"><field name="VAR">index</field><value name="VALUE">${addExpr(vget('index'), num(2))}</value><next>`;
        const marker = `<block type="variables_set"><field name="VAR">runLengthText</field>`;
        drawRun = drawRun.replace(marker, readAlpha + marker);
        // Add two closing next/block pairs for the Alpha reader.
        drawRun += '</next></block></next></block>';
        const oldTail = `<block type="draw_colour"><value name="COLOUR">${getPaletteColor}</value><next><block type="draw_move"><field name="DIR">moveForward</field><value name="VALUE">${multExpr(minusExpr(vget('runLength'), num(1)), num(step))}</value><next><block type="jump"><field name="DIR">jumpForward</field><value name="VALUE">${num(step)}</value></block></next></block></next></block>`;
        // draw_colour accepts a color or an untyped variable, not a String/Number output.
        // Build the CSS string in a variable before passing it to the color input.
        const rgba = addExpr(getPaletteColor, vget('alphaText'));
        const colorAssignment = `<block type="variables_set"><field name="VAR">paintColor</field><value name="VALUE">${rgba}</value><next>`;
        const painted = colorAssignment + oldTail.replace(getPaletteColor, vget('paintColor')) + '</next></block>';
        const skip = `<block type="jump"><field name="DIR">jumpForward</field><value name="VALUE">${multExpr(vget('runLength'), num(step))}</value></block>`;
        const condition = `<block type="logic_compare"><field name="OP">EQ</field><value name="A">${vget('alphaText')}</value><value name="B"><block type="text"><field name="TEXT">00</field></block></value></block>`;
        drawRun = drawRun.replace(oldTail, `<block type="controls_if"><mutation else="1"></mutation><value name="IF0">${condition}</value><statement name="DO0">${skip}</statement><statement name="ELSE">${painted}</statement></block>`);
    }

    const rowReturn = `<block type="draw_turn"><field name="DIR">turnLeft</field><value name="VALUE">${num(rowReturnAngleText)}</value><next><block type="jump"><field name="DIR">jumpBackward</field><value name="VALUE">${num(rowReturnDistanceText)}</value><next><block type="draw_turn"><field name="DIR">turnRight</field><value name="VALUE">${num(rowReturnAngleText)}</value></block></next></block></next></block>`;

    const loops = `<block type="controls_repeat_ext"><value name="TIMES">${num(size)}</value><statement name="DO"><block type="variables_set"><field name="VAR">rowRunsText</field><value name="VALUE">${rowRunText}</value><next><block type="variables_set"><field name="VAR">rowRuns</field><value name="VALUE">${toNumberExpr(vget('rowRunsText'))}</value><next><block type="variables_set"><field name="VAR">index</field><value name="VALUE">${addExpr(vget('index'), num(3))}</value><next><block type="controls_repeat_ext"><value name="TIMES">${vget('rowRuns')}</value><statement name="DO">${drawRun}</statement><next>${rowReturn}</next></block></next></block></next></block></next></block></statement></block>`;

    return paletteBlock + dataBlock + indexBlock + startBlocks + loops + `</next></block></next></block></next></block></next></block></next></block></next></block>`;
}

// 顯示訊息框
function showMessage(message, type = 'info') {
    const messageBox = document.getElementById('messageBox');
    messageBox.textContent = message;
    messageBox.classList.remove('hidden', 'bg-red-100', 'text-red-700', 'bg-green-100', 'text-green-700', 'bg-blue-100', 'text-blue-700');
    if (type === 'error') {
        messageBox.classList.add('bg-red-100', 'text-red-700');
    } else if (type === 'success') {
        messageBox.classList.add('bg-green-100', 'text-green-700');
    } else {
        messageBox.classList.add('bg-blue-100', 'text-blue-700');
    }
    messageBox.classList.remove('hidden');
    setTimeout(() => {
        messageBox.classList.add('hidden');
    }, 3000);
}

// DOM 元素
const imageUpload = document.getElementById('imageUpload');
const imageCanvas = document.getElementById('imageCanvas');
const previewCanvas = document.getElementById('previewCanvas');
const canvasMessage = document.getElementById('canvasMessage');
const ditherStrengthSlider = document.getElementById('ditherStrength');
const ditherStrengthValue = document.getElementById('ditherStrengthValue');
// MODIFIED: Variable name updated for clarity
const blocklyXmlOutput = document.getElementById('blocklyXmlOutput');
const copyButton = document.getElementById('copyButton');
const dropArea = document.getElementById('dropArea');
const outputModeSelect = document.getElementById('outputMode');
const resolutionSelect = document.getElementById('resolution');
const colorModeSelect = document.getElementById('colorMode');
const resolutionHint = document.getElementById('resolutionHint');
const outputStats = document.getElementById('outputStats');
const outputFitModeSelect = document.getElementById('outputFitMode');

const hexColors = [
    "#ffffff", "#cccccc", "#c0c0c0", "#999999", "#666666", "#333333", "#000000", "#ffcccc", "#ff6666", "#ff0000", "#cc0000", "#990000", "#660000", "#330000", "#ffcc99", "#ff9966", "#ff9900", "#ff6600", "#cc6600", "#993300", "#663300", "#ffff99", "#ffff66", "#ffcc66", "#ffcc33", "#cc9933", "#996633", "#663333", "#ffffcc", "#ffff33", "#ffff00", "#ffcc00", "#999900", "#666600", "#333300", "#99ff99", "#66ff99", "#33ff33", "#33cc00", "#009900", "#006600", "#003300", "#99ffff", "#33ffff", "#66cccc", "#00cccc", "#339999", "#336666", "#003333", "#ccffff", "#66ffff", "#33ccff", "#3366ff", "#3333ff", "#000099", "#000066", "#ccccff", "#9999ff", "#6666cc", "#6633ff", "#6600cc", "#333399", "#330099", "#ffccff", "#ff99ff", "#cc66cc", "#cc33cc", "#993399", "#663366", "#330033"
];

// 固定 70 色：A 與 B70 共用。
const availableColorsRgb = hexColors.map(hexToRgb);
const hiddenHexColors70 = hexColors.slice();
const hiddenAvailableColorsRgb70 = hiddenHexColors70.map(hexToRgb);
const hiddenIndexMap70 = hiddenHexColors70.map((_, i) => String(i).padStart(2, '0'));


const newIndexMap = [];
let currentNum = 12;
while (newIndexMap.length < hexColors.length) {
    if (currentNum % 10 !== 0) {
        newIndexMap.push(currentNum);
    }
    currentNum++;
}

let currentImageUrl = null;
// Each asynchronous conversion owns a generation; abandoned results must never become copyable.
let conversionGeneration = 0;
// Edits never leave a stale XML output looking current.
window.editorInvalidateConversion = () => {
    conversionGeneration++;
    currentImageUrl = null;
    blocklyXmlOutput.value = '';
    copyButton.disabled = true;
    canvasMessage.textContent = '畫板有修改，請重新預覽積木效果。';
    if (outputStats) outputStats.textContent = '';
    for (const c of [imageCanvas, previewCanvas]) { if(c) c.getContext('2d').clearRect(0,0,c.width,c.height); }
};

function getSourceAlphaString() {
    // imageCanvas was just populated with the original scaled image.
    const ctx = imageCanvas.getContext('2d');
    const data = ctx.getImageData(0, 0, imageCanvas.width, imageCanvas.height).data;
    let any = false, alpha = '';
    for (let i = 3; i < data.length; i += 4) {
        const a = data[i]; if (a !== 255) any = true;
        alpha += a.toString(16).padStart(2, '0');
    }
    return any ? alpha : null;
}
async function imageHasTransparency(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const c = document.createElement('canvas');
            // Check full composite resolution; never confuse CSS checks with pixels.
            c.width = img.naturalWidth;c.height = img.naturalHeight;
            const context = c.getContext('2d', {willReadFrequently:true});
            context.drawImage(img, 0, 0);
            const pixels = context.getImageData(0, 0, c.width, c.height).data;
            let transparent = false;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) {transparent = true;break;}
            resolve(transparent);
        };
        img.onerror = reject;img.src = url;
    });
}

async function runConversion(showToast = false) {
    if (!currentImageUrl) return;
    const generation = ++conversionGeneration;
    const sourceUrl = currentImageUrl;
    const isCurrent = () => generation === conversionGeneration;

    canvasMessage.textContent = '正在轉換圖片...';
    blocklyXmlOutput.value = '轉換中...';
    copyButton.disabled = true;

    // 清除上一次的預覽
    if (previewCanvas) {
        const previewCtx = previewCanvas.getContext('2d');
        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }

    try {
        const ditherStrength = ditherStrengthSlider ? (parseFloat(ditherStrengthSlider.value) / 100) : 0.0;
        const mode = outputModeSelect ? outputModeSelect.value : 'original';
        const requestedSize = resolutionSelect ? parseInt(resolutionSelect.value, 10) : 80;
        const size = mode === 'original' ? 80 : requestedSize;
        const fitMode = outputFitModeSelect ? outputFitModeSelect.value : 'stretch';

        let numberString;
        let resultXml;
        const inputHasAlpha = await imageHasTransparency(sourceUrl);
        if (!isCurrent()) return;
        if (mode === 'hidden') {
            const colorMode = colorModeSelect ? colorModeSelect.value : '70';
            // 70 色選項維持固定色盤；透明資料由對應的 70 色分支處理。
            const use256 = colorMode === '256' || colorMode === '256-alpha';
            const preserveAlpha = colorMode === '256-alpha' || (use256 && inputHasAlpha);
            if (use256) {
                const adaptive = await convertImageAdaptive256(sourceUrl, ditherStrength, size, preserveAlpha, fitMode, isCurrent);
                if (!isCurrent()) return;
                numberString = adaptive.numberString;
                resultXml = textToBlocksHidden(numberString, adaptive.paletteHex, adaptive.indexMap, size, 3, 3, adaptive.alphaString);
                const local = buildLocalPalette(numberString, adaptive.paletteHex, adaptive.indexMap, 3, 3);
                if (outputStats) {
                    outputStats.textContent = `${size}×${size}｜${(size * size).toLocaleString()} 像素｜模式 B｜${fitMode === 'contain' ? '完整保留比例＋透明補邊' : '拉伸填滿'}｜自適應最多 256 色${preserveAlpha ? '＋原圖透明度' : ''}｜本圖色盤 ${adaptive.paletteHex.length} 色｜實際使用 ${local.colors.length} 色｜data ${local.data.length.toLocaleString()} 字元`;
                }
            } else {
                numberString = await convertImageToNumberString(sourceUrl, hiddenAvailableColorsRgb70, hiddenIndexMap70, ditherStrength, size, null, fitMode, isCurrent);
                if (!isCurrent()) return;
                const transparentPixels = getSourceAlphaString();
                resultXml = textToBlocksHidden(numberString, hiddenHexColors70, hiddenIndexMap70, size, 2, 2, transparentPixels);
                const local = buildLocalPalette(numberString, hiddenHexColors70, hiddenIndexMap70, 2, 2);
                if (outputStats) {
                    outputStats.textContent = `${size}×${size}｜${(size * size).toLocaleString()} 像素｜模式 B｜${fitMode === 'contain' ? '完整保留比例＋透明補邊' : '拉伸填滿'}｜固定 70 色${transparentPixels ? '＋保留透明度' : ''}｜本圖使用 ${local.colors.length} 色｜data ${local.data.length.toLocaleString()} 字元`;
                }
            }
        } else {
            numberString = await convertImageToNumberString(sourceUrl, availableColorsRgb, newIndexMap, ditherStrength, size, '11', fitMode, isCurrent);
            if (!isCurrent()) return;
            const hasTransparentPixels = Boolean(getSourceAlphaString());
            resultXml = textToBlocksOriginal(numberString, hexColors, newIndexMap, hasTransparentPixels);
            if (outputStats) {
                const chunks = Math.ceil(numberString.length / 16);
                outputStats.textContent = `80×80｜6,400 像素｜模式 A｜${fitMode === 'contain' ? '完整保留比例＋透明補邊' : '拉伸填滿'}｜固定 70 色${hasTransparentPixels ? '＋跳過完全透明像素' : ''}｜原版資料約 ${chunks} 個數字積木 + ${chunks} 個 ADD；80×80 已接近實用上限`;
            }
        }
        blocklyXmlOutput.value = resultXml;
        copyButton.disabled = false;
        canvasMessage.textContent = `預覽完成。左邊是調整尺寸後的原圖，右邊是實際積木會使用的顏色。${fitMode === 'contain' ? '目前使用完整保留比例，周圍透明補邊。' : '目前使用拉伸填滿。'}`;
        if (showToast) {
            showMessage('積木效果已更新。', 'success');
        }
    } catch (error) {
        if (!isCurrent()) return;
        console.error("轉換圖片時發生錯誤:", error);
        blocklyXmlOutput.value = '轉換失敗，請檢查主控台。';
        copyButton.disabled = true;
        canvasMessage.textContent = '圖片載入或轉換失敗';
        showMessage(`錯誤: ${error.message}`, 'error');
    }
}

async function processFiles(files, mode = 'float') {
    if (files.length === 0) {
        window.editorInvalidateConversion?.();
        currentImageUrl = null;
        blocklyXmlOutput.value = '';
        copyButton.disabled = true;
        canvasMessage.textContent = '請選擇圖片';
        return;
    }

    const file = files[0];

    if (!file.type.startsWith('image/')) {
        window.editorInvalidateConversion?.();
        showMessage('請上傳圖片檔案 (例如 .jpg, .png, .gif)', 'error');
        currentImageUrl = null;
        blocklyXmlOutput.value = '';
        copyButton.disabled = true;
        canvasMessage.textContent = '請選擇圖片';
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        if (window.pixelEditorLoad) { await window.pixelEditorLoad(e.target.result, mode, file.name); }
        else { currentImageUrl = e.target.result; await runConversion(true); }
      } catch (err) { showMessage(`圖片載入失敗：${err.message}`, 'error'); }
    };
    reader.readAsDataURL(file);
}

// --- 事件監聽器 ---

imageUpload.addEventListener('change', (event) => {
    processFiles(event.target.files, getPasteMode());
    event.target.value = '';
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

// The preview section is read-only; files are accepted in the editor workspace.
const getPasteMode=()=>document.body.dataset.view==='quick'?'quick-replace':(document.getElementById('editorPasteMode')?.value||'float');
const editorViewportForDrop=document.getElementById('editorViewport');
if(editorViewportForDrop)editorViewportForDrop.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();processFiles(e.dataTransfer.files,getPasteMode());});

// Prefer image payloads regardless of which control currently has focus.
document.addEventListener('paste', (e) => {
    const clipboard = e.clipboardData;
    if (!clipboard) return;
    const file = Array.from(clipboard.items || []).find(item => item.type.startsWith('image/'))?.getAsFile();
    if (file) {
        e.preventDefault();
        processFiles([file], getPasteMode());
    }
});

const editorPasteButton = document.getElementById('editorPaste');
if (editorPasteButton) editorPasteButton.addEventListener('click', async () => {
    if (!navigator.clipboard?.read) {
        showMessage('瀏覽器無法直接讀取剪貼簿，請在頁面按 Ctrl+V，或使用「加入圖片」。', 'error');
        return;
    }
    try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
            const type = item.types.find(t => t.startsWith('image/'));
            if (type) {
                await processFiles([new File([await item.getType(type)], 'clipboard.png', {type})], getPasteMode());
                return;
            }
        }
        showMessage('剪貼簿沒有圖片。請先複製圖片或截圖。', 'error');
    } catch (err) {
        showMessage('無法直接讀取剪貼簿，請試 Ctrl+V 或使用「加入圖片」。', 'error');
    }
});

copyButton.addEventListener('click', () => {
    const textToCopy = blocklyXmlOutput.value;

    if (textToCopy) {
        const tempInput = document.createElement('textarea');
        tempInput.value = textToCopy;
        document.body.appendChild(tempInput);
        tempInput.select();
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                showMessage('已成功複製到剪貼簿！', 'success');
            } else {
                showMessage('複製失敗，請手動複製。', 'error');
            }
        } catch (err) {
            console.error('複製時發生錯誤:', err);
            showMessage('複製時發生錯誤，請手動複製。', 'error');
        }
        document.body.removeChild(tempInput);
    } else {
        showMessage('沒有內容可以複製。', 'info');
    }
});


function updateModeUi() {
    const mode = outputModeSelect ? outputModeSelect.value : 'original';
    const hiddenMode = mode === 'hidden';
    if (resolutionSelect) {
        resolutionSelect.disabled = !hiddenMode;
        if (!hiddenMode) resolutionSelect.value = '80';
    }
    if (colorModeSelect) {
        colorModeSelect.disabled = !hiddenMode;
        if (!hiddenMode) colorModeSelect.value = '70';
    }
    if (resolutionHint) {
        if (!hiddenMode) {
            resolutionHint.textContent = `武館積木包積木：固定 80×80、70 色。複雜圖片可能較慢；透明像素略過。${(outputFitModeSelect?.value === 'contain') ? '保留比例，透明補邊' : '拉伸填滿'}。`;
        } else {
            const colorMode = colorModeSelect ? colorModeSelect.value : '70';
            const fitHint = (outputFitModeSelect?.value === 'contain') ? '完整保留比例並以透明補邊。' : '拉伸填滿輸出方形。';
            resolutionHint.textContent = colorMode === '256-alpha'
                ? `內建擴充積木：自適應 256 色＋透明度，透明區域略過。${fitHint}重疊處可能影響透明度。`
                : colorMode === '256'
                ? `內建擴充積木：解析度可調，依圖片建立最多 256 色色盤。${fitHint}`
                : `內建擴充積木：解析度可調，使用固定 70 色。${fitHint}`;
        }
    }
    runConversion(false);
}

if (outputModeSelect) outputModeSelect.addEventListener('change', updateModeUi);
if (resolutionSelect) resolutionSelect.addEventListener('change', () => runConversion(false));
if (colorModeSelect) colorModeSelect.addEventListener('change', updateModeUi);
if (outputFitModeSelect) outputFitModeSelect.addEventListener('change', updateModeUi);

// 抖動強度調整事件監聽
if (ditherStrengthSlider && ditherStrengthValue) {
    ditherStrengthSlider.addEventListener('input', () => {
        const val = ditherStrengthSlider.value;
        ditherStrengthValue.textContent = `${val}%`;
        runConversion(false);
    });
}

// 初始化狀態
blocklyXmlOutput.value = '';
copyButton.disabled = true;
canvasMessage.textContent = '尚未轉換。畫好圖後，請按「預覽積木效果」。';
updateModeUi();