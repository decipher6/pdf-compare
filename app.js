/**
 * PDF Pixel Comparison Tool
 * Client-side only: compares two PDFs and shows overlay or semantic diff.
 * Files never leave the browser.
 */

(function () {
  'use strict';

  // PDF.js worker
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  var DPI_SCALE = 1.5;
  var WHITE_THRESHOLD = 250;

  // ── DOM refs ────────────────────────────────────────────

  // Setup view
  var setupView         = document.getElementById('setupView');
  var zone1             = document.getElementById('zone1');
  var zone2             = document.getElementById('zone2');
  var fileInput1        = document.getElementById('file1');
  var fileInput2        = document.getElementById('file2');
  var filename1El       = document.getElementById('filename1');
  var filename2El       = document.getElementById('filename2');
  
  var compareBtn        = document.getElementById('compareBtn');
  var loadingOverlay    = document.getElementById('loadingOverlay');
  var errorBanner       = document.getElementById('errorBanner');
  var errorText         = document.getElementById('errorText');

  // Results view
  var resultsSection    = document.getElementById('resultsSection');
  var toolbarSyncLabel  = document.getElementById('toolbarSyncLabel');
  var resultModeSemantic= document.getElementById('resultModeSemantic');
  var resultModeOverlay = document.getElementById('resultModeOverlay');
  var newCompareBtn     = document.getElementById('newCompareBtn');

  // Overlay
  var overlayResults    = document.getElementById('overlayResults');
  var resultCanvas      = document.getElementById('resultCanvas');
  var matchPercentEl    = document.getElementById('matchPercent');
  var statsDetailEl     = document.getElementById('statsDetail');
  var prevPageBtn       = document.getElementById('prevPage');
  var nextPageBtn       = document.getElementById('nextPage');
  var pageInfoEl        = document.getElementById('pageInfo');
  var zoomInBtn         = document.getElementById('zoomIn');
  var zoomOutBtn        = document.getElementById('zoomOut');
  var zoomValueEl       = document.getElementById('zoomValue');
  var downloadBtn       = document.getElementById('downloadBtn');

  // Semantic
  var semanticResults        = document.getElementById('semanticResults');
  var semanticCanvas1        = document.getElementById('semanticCanvas1');
  var semanticCanvas2        = document.getElementById('semanticCanvas2');
  var semanticWrapper1       = document.getElementById('semanticWrapper1');
  var semanticWrapper2       = document.getElementById('semanticWrapper2');
  var semanticFilename1El    = document.getElementById('semanticFilename1');
  var semanticFilename2El    = document.getElementById('semanticFilename2');
  var semanticZoom1El        = document.getElementById('semanticZoom1');
  var semanticZoom2El        = document.getElementById('semanticZoom2');
  var semanticPrevPageBtn    = document.getElementById('semanticPrevPage');
  var semanticNextPageBtn    = document.getElementById('semanticNextPage');
  var semanticPageInfoEl     = document.getElementById('semanticPageInfo');
  var semanticPageDisplayEl  = document.getElementById('semanticPageDisplay');
  var changeReportCountEl    = document.getElementById('changeReportCount');
  var reportOldDiffEl        = document.getElementById('reportOldDiff');
  var reportNewDiffEl        = document.getElementById('reportNewDiff');
  var scrollSyncCheckbox     = document.getElementById('scrollSync');
  var downloadReportBtn      = document.getElementById('downloadReportBtn');

  var semanticHtml1          = document.getElementById('semanticHtml1');
  var semanticHtml2          = document.getElementById('semanticHtml2');
  var semanticPanelTitle1      = document.getElementById('semanticPanelTitle1');
  var semanticPanelTitle2      = document.getElementById('semanticPanelTitle2');
  var sidebarHeading           = document.getElementById('sidebarHeading');

  // ── State ───────────────────────────────────────────────

  var pdfDoc1 = null;
  var pdfDoc2 = null;
  var docxBuffer1 = null;
  var docxBuffer2 = null;
  var isDocxComparison = false;
  var file1Object = null;
  var file2Object = null;
  var totalPages = 0;
  var comparisonMode = 'semantic'; // 'overlay' | 'semantic'

  // Overlay state
  var currentPageIndex = 0;
  var resultCanvases = [];
  var zoomLevel = 1;

  // Semantic state
  var semanticResultsByPage = [];
  var semanticCurrentPageIndex = 0;
  var semanticZoom1 = 1;
  var semanticZoom2 = 1;

  // Page alignment: content-based mapping so missing/extra pages align correctly
  var pageAlignment = [];   // array of { pdf1: 1-based page or null, pdf2: 1-based page or null }

  // Cached results so switching modes doesn't re-compute if same PDFs
  var cachedOverlay = null;   // { resultCanvases, totalPages, currentPageIndex }
  var cachedSemantic = null;  // { semanticResultsByPage, totalPages, semanticCurrentPageIndex }

  // ── Helpers ─────────────────────────────────────────────

  function clearError() { errorBanner.hidden = true; errorText.textContent = ''; }

  function showError(msg) { errorText.textContent = msg; errorBanner.hidden = false; }

  function setLoading(vis) { loadingOverlay.classList.toggle('visible', vis); }

  function isPdfFile(f) {
    if (!f || !f.name) return false;
    return f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
  }

  function isDocxFile(f) {
    if (!f || !f.name) return false;
    return f.name.toLowerCase().endsWith('.docx') ||
      f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  function loadFile(file, which) {
    if (!file) return;
    if (isPdfFile(file)) loadPdf(file, which);
    else if (isDocxFile(file)) loadDocx(file, which);
    else showError('Please upload a PDF or Word (.docx) file.');
  }

  function resetPdfSemanticLabels() {
    if (semanticPanelTitle1) semanticPanelTitle1.textContent = 'Original (PDF 1)';
    if (semanticPanelTitle2) semanticPanelTitle2.textContent = 'Modified (PDF 2)';
    if (sidebarHeading) sidebarHeading.textContent = 'Compare PDF';
  }

  function applyDocxSemanticLabels() {
    if (semanticPanelTitle1) semanticPanelTitle1.textContent = 'Original (Word)';
    if (semanticPanelTitle2) semanticPanelTitle2.textContent = 'Modified (Word)';
    if (sidebarHeading) sidebarHeading.textContent = 'Compare Word';
  }

  function showDocxSemanticPanels(show) {
    if (!semanticHtml1 || !semanticHtml2 || !semanticCanvas1 || !semanticCanvas2) return;
    if (show) {
      semanticHtml1.hidden = false;
      semanticHtml2.hidden = false;
      semanticCanvas1.style.display = 'none';
      semanticCanvas2.style.display = 'none';
    } else {
      semanticHtml1.hidden = true;
      semanticHtml2.hidden = true;
      semanticHtml1.innerHTML = '';
      semanticHtml2.innerHTML = '';
      semanticCanvas1.style.display = '';
      semanticCanvas2.style.display = '';
    }
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('Failed to read file')); };
      r.readAsArrayBuffer(file);
    });
  }

  // ── Results visibility ──────────────────────────────────

  function showResultsView() {
    resultsSection.hidden = false;
    document.body.classList.add('has-results');
  }

  function hideResultsView() {
    resultsSection.hidden = true;
    document.body.classList.remove('has-results');
    overlayResults.hidden = true;
    semanticResults.hidden = true;
    showDocxSemanticPanels(false);
    resetPdfSemanticLabels();
    isDocxComparison = false;
  }

  // ── File loading ────────────────────────────────────────

  function loadPdf(file, which) {
    if (!isPdfFile(file)) { showError('Please select a PDF file (.pdf).'); return; }
    if (which === 1) docxBuffer1 = null; else docxBuffer2 = null;
    clearError();
    hideResultsView();
    cachedOverlay = null;
    cachedSemantic = null;
    setLoading(true);
    readFileAsArrayBuffer(file)
      .then(function (data) { return pdfjsLib.getDocument({ data: data }).promise; })
      .then(function (pdf) {
        if (which === 1) { pdfDoc1 = pdf; file1Object = file; filename1El.textContent = file.name; zone1.classList.add('has-file'); }
        else             { pdfDoc2 = pdf; file2Object = file; filename2El.textContent = file.name; zone2.classList.add('has-file'); }
        updateCompareButton();
      })
      .catch(function () {
        showError('Failed to load PDF. The file may be corrupted or password-protected.');
        if (which === 1) { pdfDoc1 = null; file1Object = null; filename1El.textContent = ''; zone1.classList.remove('has-file'); }
        else             { pdfDoc2 = null; file2Object = null; filename2El.textContent = ''; zone2.classList.remove('has-file'); }
        updateCompareButton();
      })
      .finally(function () { setLoading(false); });
  }

  function loadDocx(file, which) {
    if (!isDocxFile(file)) { showError('Please select a Word file (.docx).'); return; }
    if (which === 1) { pdfDoc1 = null; } else { pdfDoc2 = null; }
    clearError();
    hideResultsView();
    cachedOverlay = null;
    cachedSemantic = null;
    setLoading(true);
    readFileAsArrayBuffer(file)
      .then(function (data) {
        return mammoth.convertToHtml({ arrayBuffer: data.slice(0) }).then(function () { return data; });
      })
      .then(function (data) {
        if (which === 1) {
          docxBuffer1 = data;
          file1Object = file;
          filename1El.textContent = file.name;
          zone1.classList.add('has-file');
        } else {
          docxBuffer2 = data;
          file2Object = file;
          filename2El.textContent = file.name;
          zone2.classList.add('has-file');
        }
        updateCompareButton();
      })
      .catch(function () {
        showError('Failed to load Word document. The file may be corrupted.');
        if (which === 1) {
          docxBuffer1 = null;
          file1Object = null;
          filename1El.textContent = '';
          zone1.classList.remove('has-file');
        } else {
          docxBuffer2 = null;
          file2Object = null;
          filename2El.textContent = '';
          zone2.classList.remove('has-file');
        }
        updateCompareButton();
      })
      .finally(function () { setLoading(false); });
  }

  function updateCompareButton() {
    var bothPdf = pdfDoc1 && pdfDoc2;
    var bothDocx = docxBuffer1 && docxBuffer2;
    compareBtn.disabled = !(bothPdf || bothDocx);
    compareBtn.textContent = bothDocx ? 'Compare Word documents' : 'Compare PDFs';
  }

  // ── Upload zones ────────────────────────────────────────

  function setupUploadZone(zoneEl, inputEl, which) {
    zoneEl.addEventListener('click', function (e) {
      if (e.target.classList.contains('browse-btn')) inputEl.click();
    });
    zoneEl.addEventListener('dragover', function (e) { e.preventDefault(); zoneEl.classList.add('drag-over'); });
    zoneEl.addEventListener('dragleave', function (e) { e.preventDefault(); zoneEl.classList.remove('drag-over'); });
    zoneEl.addEventListener('drop', function (e) {
      e.preventDefault(); zoneEl.classList.remove('drag-over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadFile(f, which);
    });
    inputEl.addEventListener('change', function () {
      var f = inputEl.files && inputEl.files[0];
      if (f) loadFile(f, which);
    });
  }

  setupUploadZone(zone1, fileInput1, 1);
  setupUploadZone(zone2, fileInput2, 2);

  // ── Result mode tabs (switch within results view) ───────

  function activateResultMode(mode) {
    if (mode === 'overlay' && isDocxComparison) {
      showError('Content overlay is not available for Word (.docx) comparisons. Semantic text comparison is available.');
      return;
    }
    comparisonMode = mode;
    resultModeOverlay.classList.toggle('active', mode === 'overlay');
    resultModeSemantic.classList.toggle('active', mode === 'semantic');
    toolbarSyncLabel.style.display = mode === 'semantic' ? '' : 'none';

    overlayResults.hidden = true;
    semanticResults.hidden = true;
    hideSemanticLoading();

    if (mode === 'overlay') {
      overlayResults.hidden = false;
      if (!cachedOverlay) { runOverlayComparison(); }
      else { restoreOverlay(); }
    } else {
      semanticResults.hidden = false;
      if (!cachedSemantic) {
        showSemanticLoading();
        setTimeout(function () { runSemanticComparison(); }, 30);
      } else {
        showSemanticLoading();
        setTimeout(function () {
          restoreSemantic();
          hideSemanticLoading();
        }, 30);
      }
    }
  }

  resultModeOverlay.addEventListener('click', function () { activateResultMode('overlay'); });
  resultModeSemantic.addEventListener('click', function () { activateResultMode('semantic'); });

  // ── New comparison button ───────────────────────────────

  newCompareBtn.addEventListener('click', function () {
    hideResultsView();
  });

  // ── Progress bar ────────────────────────────────────────

  var progressBarFill = document.getElementById('progressBarFill');
  var progressText = document.getElementById('progressText');

  function setProgress(pct, text) {
    if (progressBarFill) progressBarFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    if (progressText && text) progressText.textContent = text;
  }

  // ── Semantic loading overlay (mode switch buffer) ──────

  var semanticLoadingEl = document.getElementById('semanticLoading');

  function showSemanticLoading() { if (semanticLoadingEl) semanticLoadingEl.hidden = false; }
  function hideSemanticLoading() { if (semanticLoadingEl) semanticLoadingEl.hidden = true; }

  // ── Compare button ──────────────────────────────────────

  compareBtn.addEventListener('click', function () {
    if (docxBuffer1 && docxBuffer2) {
      runDocxCompareFlow();
      return;
    }
    if (!pdfDoc1 || !pdfDoc2) return;
    isDocxComparison = false;
    comparisonMode = 'semantic';
    clearError();

    var numPages1 = pdfDoc1.numPages;
    var numPages2 = pdfDoc2.numPages;
    if (numPages1 === 0 && numPages2 === 0) {
      showError('No pages found in one or both PDFs.');
      return;
    }

    cachedOverlay = null;
    cachedSemantic = null;
    showResultsView();
    overlayResults.hidden = true;
    semanticResults.hidden = true;
    setProgress(0, 'Aligning pages…');
    setLoading(true);

    Promise.all([getDocFingerprints(pdfDoc1), getDocFingerprints(pdfDoc2)])
      .then(function (arr) {
        var fp1 = arr[0], fp2 = arr[1];
        setProgress(10, 'Aligning pages…');
        pageAlignment = computePageAlignment(fp1, fp2);
        pageAlignment = expandWeakPairsToBlanks(fp1, fp2, pageAlignment);
        totalPages = pageAlignment.length;
        if (totalPages === 0) {
          showError('Could not align any pages.');
          setLoading(false);
          return;
        }
        resultModeSemantic.classList.add('active');
        resultModeOverlay.classList.remove('active');
        toolbarSyncLabel.style.display = '';
        semanticResults.hidden = false;
        setProgress(15, 'Comparing pages…');
        runSemanticComparison();
      })
      .catch(function (e) {
        showError(e && e.message || 'Page alignment failed.');
        setLoading(false);
      });
  });

  // ===== OVERLAY COMPARISON ===============================

  function renderPdfPage(pdfDoc, pageNum) {
    return pdfDoc.getPage(pageNum).then(function (page) {
      var vp = page.getViewport({ scale: DPI_SCALE });
      var c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      var ctx = c.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, c.width, c.height);
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return { canvas: c, width: c.width, height: c.height };
      });
    });
  }

  function normalizeToSameSize(r1, r2) {
    var w = Math.max(r1.width, r2.width);
    var h = Math.max(r1.height, r2.height);
    function norm(src) {
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d');
      ctx.fillStyle = 'white'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src.canvas, 0, 0);
      return c;
    }
    return { canvas1: norm(r1), canvas2: norm(r2), width: w, height: h };
  }

  function comparePixels(c1, c2, w, h) {
    var d1 = c1.getContext('2d').getImageData(0, 0, w, h).data;
    var d2 = c2.getContext('2d').getImageData(0, 0, w, h).data;
    var out = document.createElement('canvas'); out.width = w; out.height = h;
    var outCtx = out.getContext('2d');
    var img = outCtx.createImageData(w, h);
    var o = img.data;
    var matchCount = 0, whiteCount = 0, diffCount = 0;
    for (var i = 0; i < d1.length; i += 4) {
      var r1 = d1[i], g1 = d1[i+1], b1 = d1[i+2];
      var r2 = d2[i], g2 = d2[i+1], b2 = d2[i+2];
      var bw = r1>WHITE_THRESHOLD && g1>WHITE_THRESHOLD && b1>WHITE_THRESHOLD &&
               r2>WHITE_THRESHOLD && g2>WHITE_THRESHOLD && b2>WHITE_THRESHOLD;
      if (bw) { o[i]=255; o[i+1]=255; o[i+2]=255; whiteCount++; matchCount++; }
      else if (r1===r2 && g1===g2 && b1===b2) {
        var gray = Math.round(0.299*r1+0.587*g1+0.114*b1);
        o[i]=gray; o[i+1]=gray; o[i+2]=gray; matchCount++;
      } else { o[i]=255; o[i+1]=0; o[i+2]=0; diffCount++; }
      o[i+3] = 255;
    }
    outCtx.putImageData(img, 0, 0);
    return { resultCanvas: out, stats: { total: w*h, match: matchCount, white: whiteCount, diff: diffCount } };
  }

  function compareOnePage(pageNum1, pageNum2) {
    return Promise.all([renderPdfPage(pdfDoc1, pageNum1), renderPdfPage(pdfDoc2, pageNum2)])
      .then(function (arr) {
        var n = normalizeToSameSize(arr[0], arr[1]);
        var r = comparePixels(n.canvas1, n.canvas2, n.width, n.height);
        return { result: r.resultCanvas, stats: r.stats, type: 'both' };
      });
  }

  function compareOneSlot(slotIndex) {
    var slot = pageAlignment[slotIndex];
    if (!slot) return Promise.resolve(null);
    var p1 = slot.pdf1;
    var p2 = slot.pdf2;
    if (p1 !== null && p2 !== null) {
      return compareOnePage(p1, p2);
    }
    if (p1 !== null) {
      return renderPdfPage(pdfDoc1, p1).then(function (r) {
        var c = document.createElement('canvas');
        c.width = r.width;
        c.height = r.height;
        c.getContext('2d').drawImage(r.canvas, 0, 0);
        return { result: c, stats: null, type: 'pdf1-only' };
      });
    }
    if (p2 !== null) {
      return renderPdfPage(pdfDoc2, p2).then(function (r) {
        var c = document.createElement('canvas');
        c.width = r.width;
        c.height = r.height;
        c.getContext('2d').drawImage(r.canvas, 0, 0);
        return { result: c, stats: null, type: 'pdf2-only' };
      });
    }
    return Promise.resolve(null);
  }

  function runOverlayComparison() {
    resultCanvases = [];
    currentPageIndex = 0;
    zoomLevel = 1;
    setLoading(true);
    compareOneSlot(0)
      .then(function (p) {
        if (!p) return;
        resultCanvases[0] = p;
        drawOverlayPage(p);
        updateOverlayNav();
        cacheOverlay();
      })
      .catch(function (e) { showError(e && e.message || 'Overlay comparison failed.'); })
      .finally(function () { setLoading(false); });
  }

  function drawOverlayPage(p) {
    if (!p || !p.result) return;
    resultCanvas.width = p.result.width;
    resultCanvas.height = p.result.height;
    resultCanvas.getContext('2d').drawImage(p.result, 0, 0);
    updateOverlayStats(p.stats, p.type);
  }

  function updateOverlayStats(s, type) {
    if (type === 'pdf1-only' || type === 'pdf2-only' || !s) {
      matchPercentEl.textContent = '—';
      statsDetailEl.textContent = type === 'pdf1-only' ? 'Only in Original' : type === 'pdf2-only' ? 'Only in Modified' : '—';
    } else {
      var pct = s.total > 0 ? ((s.match / s.total) * 100).toFixed(2) : '0';
      matchPercentEl.textContent = pct + '%';
      statsDetailEl.textContent = s.match.toLocaleString() + ' match · ' + s.diff.toLocaleString() + ' differ';
    }
    zoomValueEl.textContent = Math.round(zoomLevel * 100) + '%';
  }

  function updateOverlayNav() {
    pageInfoEl.textContent = (currentPageIndex + 1) + ' / ' + totalPages;
    prevPageBtn.disabled = currentPageIndex <= 0;
    nextPageBtn.disabled = currentPageIndex >= totalPages - 1;
  }

  function showOverlayPage(idx) {
    if (idx < 0 || idx >= totalPages) return;
    currentPageIndex = idx;
    if (resultCanvases[idx]) {
      drawOverlayPage(resultCanvases[idx]);
      updateOverlayNav();
      cacheOverlay();
      return;
    }
    setLoading(true);
    compareOneSlot(idx)
      .then(function (p) {
        if (!p) return;
        resultCanvases[idx] = p;
        drawOverlayPage(p);
        updateOverlayNav();
        cacheOverlay();
      })
      .catch(function (e) { showError(e && e.message || 'Page comparison failed.'); })
      .finally(function () { setLoading(false); });
  }

  prevPageBtn.addEventListener('click', function () { if (currentPageIndex > 0) showOverlayPage(currentPageIndex - 1); });
  nextPageBtn.addEventListener('click', function () { if (currentPageIndex < totalPages - 1) showOverlayPage(currentPageIndex + 1); });

  zoomInBtn.addEventListener('click', function () { zoomLevel = Math.min(3, zoomLevel + 0.25); zoomValueEl.textContent = Math.round(zoomLevel * 100) + '%'; applyOverlayZoom(); });
  zoomOutBtn.addEventListener('click', function () { zoomLevel = Math.max(0.25, zoomLevel - 0.25); zoomValueEl.textContent = Math.round(zoomLevel * 100) + '%'; applyOverlayZoom(); });

  function applyOverlayZoom() {
    resultCanvas.style.maxWidth = zoomLevel === 1 ? '100%' : (zoomLevel * 100) + '%';
    if (zoomLevel === 1) {
      resultCanvas.style.maxHeight = '';
    } else {
      resultCanvas.style.maxHeight = (zoomLevel * 100) + '%';
    }
    resultCanvas.style.objectFit = zoomLevel === 1 ? 'contain' : '';
    var main = resultCanvas.parentElement;
    if (main) main.style.overflow = 'auto';
  }

  function cacheOverlay() {
    cachedOverlay = { resultCanvases: resultCanvases, totalPages: totalPages, currentPageIndex: currentPageIndex };
  }

  function restoreOverlay() {
    resultCanvases = cachedOverlay.resultCanvases;
    totalPages = cachedOverlay.totalPages;
    currentPageIndex = cachedOverlay.currentPageIndex;
    if (resultCanvases[currentPageIndex]) drawOverlayPage(resultCanvases[currentPageIndex]);
    updateOverlayNav();
  }

  // Overlay download
  downloadBtn.addEventListener('click', function () {
    if (totalPages === 0) return;
    downloadBtn.disabled = true;
    setLoading(true);
    var promises = [];
    for (var i = 0; i < totalPages; i++) {
      promises.push(resultCanvases[i] ? Promise.resolve(resultCanvases[i]) : compareOneSlot(i));
    }
    Promise.all(promises)
      .then(function (payloads) {
        resultCanvases = payloads;
        var valid = payloads.filter(function (p) { return p && p.result; });
        if (!valid.length) return;
        var jsPDF = window.jspdf.jsPDF;
        var first = valid[0].result;
        var doc = new jsPDF({ orientation: first.width > first.height ? 'landscape' : 'portrait', unit: 'px', format: [first.width, first.height] });
        doc.addImage(first.toDataURL('image/png'), 'PNG', 0, 0, first.width, first.height, undefined, 'FAST');
        for (var i = 1; i < valid.length; i++) {
          var c = valid[i].result;
          if (!c) continue;
          doc.addPage([c.width, c.height], 'p');
          doc.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, c.width, c.height, undefined, 'FAST');
        }
        doc.save('comparison_doc.pdf');
      })
      .catch(function (e) { showError(e && e.message || 'PDF download failed.'); })
      .finally(function () { setLoading(false); downloadBtn.disabled = false; });
  });

  function myersDiff(oldWords, newWords) {
    const n = oldWords.length;
    const m = newWords.length;
    const max = n + m;
    if (max === 0) return [];
    const v = new Array(2 * max + 1).fill(0);
    const trace = [];
    outer: for (let d = 0; d <= max; d++) {
      trace.push([...v]);
      for (let k = -d; k <= d; k += 2) {
        const idx = k + max;
        let x;
        if (k === -d || (k !== d && v[idx - 1] < v[idx + 1])) { x = v[idx + 1]; }
        else { x = v[idx - 1] + 1; }
        let y = x - k;
        while (x < n && y < m && oldWords[x] === newWords[y]) { x++; y++; }
        v[idx] = x;
        if (x >= n && y >= m) break outer;
      }
    }
    const ops = [];
    let x = n, y = m;
    for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
      const vSnap = trace[d];
      const k = x - y;
      const idx = k + max;
      let prevK;
      if (k === -d || (k !== d && vSnap[idx - 1] < vSnap[idx + 1])) { prevK = k + 1; }
      else { prevK = k - 1; }
      const prevX = vSnap[prevK + max];
      const prevY = prevX - prevK;
      while (x > prevX + (prevK === k - 1 ? 1 : 0) && y > prevY + (prevK === k + 1 ? 1 : 0)) {
        x--; y--;
        ops.unshift({ type: 'equal', value: oldWords[x] });
      }
      if (d > 0) {
        if (prevK === k - 1) { x--; ops.unshift({ type: 'remove', value: oldWords[x] }); }
        else { y--; ops.unshift({ type: 'add', value: newWords[y] }); }
      }
    }
    return ops;
  }

  // ===== DOCX SEMANTIC (Word only; PDF workflow unchanged) ===

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function docxHtmlToPlainWords(html) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html || '', 'text/html');
    var text = doc.body.textContent || '';
    return docxPlainTextToWords(text);
  }

  function docxPlainTextToWords(text) {
    var normalized = normText(text);
    if (!normalized) return [];
    return normalized.split(/\s+/).map(function (w) { return normalizeWordForDiff(w); }).filter(function (w) { return w.length > 0; });
  }

  function buildDocxHtmlGrouped(oldStrs, newStrs) {
    var wordOps = myersDiff(oldStrs, newStrs);
    var leftParts = [];
    var rightParts = [];
    var opIdx = 0;
    var i1 = 0;
    var i2 = 0;
    var remWords = 0;
    var addWords = 0;
    while (opIdx < wordOps.length) {
      if (wordOps[opIdx].type === 'equal') {
        var eq = escapeHtml(wordOps[opIdx].value);
        leftParts.push(eq);
        rightParts.push(eq);
        opIdx++;
        i1++;
        i2++;
        continue;
      }
      var runRem = [];
      var runAdd = [];
      while (opIdx < wordOps.length && wordOps[opIdx].type !== 'equal') {
        if (wordOps[opIdx].type === 'remove') { runRem.push(i1++); }
        else { runAdd.push(i2++); }
        opIdx++;
      }
      var remText = runRem.map(function (idx) { return oldStrs[idx]; }).join('');
      var addText = runAdd.map(function (idx) { return newStrs[idx]; }).join('');
      if (remText === addText) {
        var mid = escapeHtml(remText);
        leftParts.push(mid);
        rightParts.push(mid);
      } else {
        remWords += runRem.length;
        addWords += runAdd.length;
        leftParts.push('<span class="docx-diff-removed">' + runRem.map(function (idx) { return escapeHtml(oldStrs[idx]); }).join(' ') + '</span>');
        rightParts.push('<span class="docx-diff-added">' + runAdd.map(function (idx) { return escapeHtml(newStrs[idx]); }).join(' ') + '</span>');
      }
    }
    return {
      left: leftParts.join(' ').trim(),
      right: rightParts.join(' ').trim(),
      remWords: remWords,
      addWords: addWords
    };
  }

  function runDocxCompareFlow() {
    isDocxComparison = true;
    clearError();
    cachedOverlay = null;
    cachedSemantic = null;
    comparisonMode = 'semantic';
    showResultsView();
    overlayResults.hidden = true;
    semanticResults.hidden = false;
    resultModeSemantic.classList.add('active');
    resultModeOverlay.classList.remove('active');
    toolbarSyncLabel.style.display = '';
    setProgress(0, 'Reading Word documents…');
    setLoading(true);
    showSemanticLoading();
    Promise.all([
      mammoth.convertToHtml({ arrayBuffer: docxBuffer1.slice(0) }),
      mammoth.convertToHtml({ arrayBuffer: docxBuffer2.slice(0) })
    ])
      .then(function (results) {
        setProgress(35, 'Comparing text…');
        var html1 = results[0].value;
        var html2 = results[1].value;
        var wordsOld = docxHtmlToPlainWords(html1);
        var wordsNew = docxHtmlToPlainWords(html2);
        var oldStrs = wordsOld.map(function (w) { return w; });
        var newStrs = wordsNew.map(function (w) { return w; });

        var oldJoined = oldStrs.join('');
        var newJoined = newStrs.join('');
        var needsDiff = oldJoined !== newJoined;

        var oldBag = {};
        var newBag = {};
        var bagKey;
        var bi, bj, bk;
        for (bi = 0; bi < oldStrs.length; bi++) {
          bagKey = oldStrs[bi];
          oldBag[bagKey] = (oldBag[bagKey] || 0) + 1;
        }
        for (bj = 0; bj < newStrs.length; bj++) {
          bagKey = newStrs[bj];
          newBag[bagKey] = (newBag[bagKey] || 0) + 1;
        }
        var sameBag = false;
        var allKeys = Object.keys(oldBag);
        if (allKeys.length === Object.keys(newBag).length) {
          sameBag = true;
          for (bk = 0; bk < allKeys.length; bk++) {
            if (oldBag[allKeys[bk]] !== newBag[allKeys[bk]]) { sameBag = false; break; }
          }
        }
        if (sameBag) needsDiff = false;

        var leftHtml = '';
        var rightHtml = '';
        var remWords = 0;
        var addWords = 0;

        if (!needsDiff) {
          var parser0 = new DOMParser();
          var d1 = parser0.parseFromString(html1 || '', 'text/html');
          var d2 = parser0.parseFromString(html2 || '', 'text/html');
          var t1 = normText(d1.body.textContent || '');
          var t2 = normText(d2.body.textContent || '');
          leftHtml = escapeHtml(t1);
          rightHtml = escapeHtml(t2);
        } else {
          var built = buildDocxHtmlGrouped(oldStrs, newStrs);
          leftHtml = built.left;
          rightHtml = built.right;
          remWords = built.remWords;
          addWords = built.addWords;
        }

        semanticHtml1.innerHTML = leftHtml;
        semanticHtml2.innerHTML = rightHtml;
        showDocxSemanticPanels(true);
        applyDocxSemanticLabels();
        if (file1Object) semanticFilename1El.textContent = file1Object.name;
        if (file2Object) semanticFilename2El.textContent = file2Object.name;
        totalPages = 1;
        semanticResultsByPage = [{
          removedWordCount: remWords,
          addedWordCount: addWords
        }];
        updateSemanticReport();
        updateSemanticNav();
        semanticZoom1 = 1;
        semanticZoom2 = 1;
        applySemanticZoom();
        cacheSemantic();
        setProgress(100, 'Done');
      })
      .catch(function (e) {
        showError(e && e.message || 'Word comparison failed.');
        isDocxComparison = false;
        showDocxSemanticPanels(false);
        hideResultsView();
      })
      .finally(function () {
        setLoading(false);
        hideSemanticLoading();
      });
  }

  // ===== SEMANTIC COMPARISON ==============================

  var LINE_Y_TOLERANCE = 5;

  function normText(s) { return (s || '').trim().replace(/\s+/g, ' '); }

  function computeDynamicYTolerance(items) {
    var heights = [];
    for (var i = 0; i < items.length; i++) {
      var h = items[i].height || items[i].h || 0;
      if (h > 0) heights.push(h);
    }
    if (!heights.length) return LINE_Y_TOLERANCE;
    var avg = 0;
    for (var j = 0; j < heights.length; j++) avg += heights[j];
    avg /= heights.length;
    return Math.max(LINE_Y_TOLERANCE, avg * 0.5);
  }

  function joinWithImpliedSpaces(items) {
    if (!items.length) return '';
    var result = items[0].str;
    for (var i = 1; i < items.length; i++) {
      var prev = items[i - 1];
      var curr = items[i];
      var prevEnd = prev.x + prev.w;
      var gap = curr.x - prevEnd;
      var avgCharW = prev.w / Math.max(prev.str.length, 1);
      if (avgCharW <= 0) avgCharW = curr.w / Math.max(curr.str.length, 1);
      if (avgCharW > 0 && gap > avgCharW * 0.25 &&
          !/\s$/.test(prev.str) && !/^\s/.test(curr.str)) {
        result += ' ';
      }
      result += curr.str;
    }
    return result;
  }

  function getTextLinesFromPage(page) {
    return page.getTextContent().then(function (content) {
      var items = content.items || [];
      if (!items.length) return [];
      var arr = items.map(function (it) {
        var t = it.transform;
        return { str: it.str || '', x: t[4], y: t[5], w: it.width || 0, h: it.height || 0, pdfY: t[5], pdfBottom: t[5] - (it.height || 0) };
      });
      var lineYTol = computeDynamicYTolerance(arr);
      arr.sort(function (a, b) {
        if (Math.abs(a.pdfY - b.pdfY) <= lineYTol) return a.x - b.x;
        return b.pdfY - a.pdfY;
      });
      var lines = [], cur = [], curY = null;
      arr.forEach(function (r) {
        if (r.str === '') return;
        if (curY === null || Math.abs(r.pdfY - curY) <= lineYTol) {
          cur.push(r);
          if (curY === null) curY = r.pdfY;
        } else {
          if (cur.length) {
            var txt = joinWithImpliedSpaces(cur);
            var rects = cur.map(function (i) { return { x: i.x, y: i.pdfY, w: i.w, h: i.h }; });
            var itemStrs = cur.map(function (i) { return i.str; });
            lines.push({ text: txt, normalized: normText(txt), rects: rects, itemStrs: itemStrs });
          }
          cur = [r]; curY = r.pdfY;
        }
      });
      if (cur.length) {
        var txt = joinWithImpliedSpaces(cur);
        var rects = cur.map(function (i) { return { x: i.x, y: i.pdfY, w: i.w, h: i.h }; });
        var itemStrs = cur.map(function (i) { return i.str; });
        lines.push({ text: txt, normalized: normText(txt), rects: rects, itemStrs: itemStrs });
      }
      return lines;
    });
  }

  var FINGERPRINT_MAX_CHARS = 2000;

  function getPageFingerprint(page) {
    return getTextLinesFromPage(page).then(function (lines) {
      var text = lines.map(function (l) { return l.normalized; }).join(' ').trim();
      return normText(text).substring(0, FINGERPRINT_MAX_CHARS);
    });
  }

  function getDocFingerprints(pdfDoc) {
    var n = pdfDoc.numPages;
    var promises = [];
    for (var i = 1; i <= n; i++) {
      promises.push(pdfDoc.getPage(i).then(getPageFingerprint));
    }
    return Promise.all(promises);
  }

  /**
   * Compare two page fingerprints using character 4-gram overlap.
   * Immune to word-splitting differences (e.g. "INST I T U T I O NAL"
   * vs "INSTITUTIONAL" produce identical n-grams after joining).
   */
  function fingerprintSimilarityDetail(a, b) {
    if (!a || !b) return { matchCount: 0, ratio: 0 };
    var textA = normalizeWordForDiff(a).replace(/\s+/g, '').toLowerCase();
    var textB = normalizeWordForDiff(b).replace(/\s+/g, '').toLowerCase();
    if (!textA && !textB) return { matchCount: 0, ratio: 1 };
    if (!textA || !textB) return { matchCount: 0, ratio: 0 };
    var N = 4, i;
    var gramsA = new Set();
    for (i = 0; i <= textA.length - N; i++) gramsA.add(textA.substring(i, i + N));
    var gramsB = new Set();
    for (i = 0; i <= textB.length - N; i++) gramsB.add(textB.substring(i, i + N));
    if (!gramsA.size && !gramsB.size) return { matchCount: 0, ratio: 1 };
    if (!gramsA.size || !gramsB.size) return { matchCount: 0, ratio: 0 };
    var match = 0;
    gramsA.forEach(function (g) { if (gramsB.has(g)) match++; });
    var ratio = match / Math.max(gramsA.size, gramsB.size);
    return { matchCount: match, ratio: ratio };
  }

  var ALIGN_MATCH_THRESHOLD = 0.55;
  var ALIGN_MIN_MATCH_WORDS = 2;

  /**
   * Expand alignment: any slot that has both pages but low similarity is split into two slots
   * (page on one side, blank on the other) so unique slides always show with blank opposite.
   */
  function expandWeakPairsToBlanks(fp1, fp2, slots) {
    var out = [];
    for (var s = 0; s < slots.length; s++) {
      var slot = slots[s];
      if (slot.pdf1 !== null && slot.pdf2 !== null) {
        var d = fingerprintSimilarityDetail(fp1[slot.pdf1 - 1], fp2[slot.pdf2 - 1]);
        if (d.matchCount < ALIGN_MIN_MATCH_WORDS || d.ratio < ALIGN_MATCH_THRESHOLD) {
          out.push({ pdf1: slot.pdf1, pdf2: null });
          out.push({ pdf1: null, pdf2: slot.pdf2 });
        } else {
          out.push(slot);
        }
      } else {
        out.push(slot);
      }
    }
    return out;
  }

  function computePageAlignment(fp1, fp2) {
    var n1 = fp1.length;
    var n2 = fp2.length;
    var sim = function (i, j) {
      var d = fingerprintSimilarityDetail(fp1[i], fp2[j]);
      if (d.matchCount < ALIGN_MIN_MATCH_WORDS || d.ratio < ALIGN_MATCH_THRESHOLD) return 0;
      return d.ratio;
    };
    var M = [];
    var P = [];
    var i, j;
    for (i = 0; i <= n1; i++) {
      M[i] = [];
      P[i] = [];
      for (j = 0; j <= n2; j++) {
        M[i][j] = -1;
        P[i][j] = null;
      }
    }
    M[0][0] = 0;
    for (i = 0; i <= n1; i++) {
      for (j = 0; j <= n2; j++) {
        if (M[i][j] < 0) continue;
        if (i < n1 && j < n2) {
          var s = sim(i, j);
          var score = M[i][j] + (s > 0 ? 1 + s : 0);
          if (score > M[i + 1][j + 1]) {
            M[i + 1][j + 1] = score;
            P[i + 1][j + 1] = 'match';
          }
        }
        if (i < n1 && M[i][j] > M[i + 1][j]) {
          M[i + 1][j] = M[i][j];
          P[i + 1][j] = 'only1';
        }
        if (j < n2 && M[i][j] > M[i][j + 1]) {
          M[i][j + 1] = M[i][j];
          P[i][j + 1] = 'only2';
        }
      }
    }
    var slots = [];
    i = n1;
    j = n2;
    while (i > 0 || j > 0) {
      var p = P[i] && P[i][j];
      if (p === 'match') {
        slots.unshift({ pdf1: i, pdf2: j });
        i--;
        j--;
      } else if (p === 'only1') {
        slots.unshift({ pdf1: i, pdf2: null });
        i--;
      } else if (p === 'only2') {
        slots.unshift({ pdf1: null, pdf2: j });
        j--;
      } else {
        if (i > 0) {
          slots.unshift({ pdf1: i, pdf2: null });
          i--;
        } else {
          slots.unshift({ pdf1: null, pdf2: j });
          j--;
        }
      }
    }
    return slots;
  }

  function pdfRectToViewport(rect, vp) {
    var s = vp.scale, vh = vp.height;
    return { x: rect.x * s, y: vh - (rect.y + rect.h) * s, w: rect.w * s, h: rect.h * s };
  }

  /**
   * Normalize text for comparison so "same" words are not flagged different (text-based diff).
   * - Unicode NFKC; ligatures → plain (ﬁ→fi, ﬂ→fl, etc.); fancy quotes/dashes → plain
   * - Zero-width / joiners / BOM removed; ellipsis, non-breaking hyphen; whitespace normalized
   */
  function normalizeWordForDiff(str) {
    if (typeof str !== 'string') return '';
    var s = str.normalize('NFKC');
    s = s.replace(/[\u200B-\u200D\uFEFF\u2060\u00AD\u034F\u061C\u180E\uFFF9-\uFFFB]/g, '');
    s = s.replace(/\uFB01/g, 'fi').replace(/\uFB02/g, 'fl').replace(/\uFB00/g, 'ff')
      .replace(/\uFB03/g, 'ffi').replace(/\uFB04/g, 'ffl');
    s = s.replace(/[\u2018\u2019\u02BC\u0060\u00B4\u2032\u275B\u275C]/g, "'")
      .replace(/[\u201C\u201D\u00AB\u00BB\u2033\u275D\u275E\u301D\u301E]/g, '"');
    s = s.replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-');
    s = s.replace(/\u2026/g, '...');
    s = s.replace(/\u00D7/g, 'x');
    s = s.replace(/\uF0A7/g, '\u00A7');
    s = s.replace(/[\u00D8\u00F8\u2022\u2023\u25E6\u2043\u204C\u204D\u2219\u00B7\u2981\u26AB\u25AA\u25AB\u25FE\u25FD\u25FC\u25FB\u25A0\u25A1\u2B25\u2B26\u25B8\u25B9\u25BA\u25BB\u25B6\u25B7\u27A2\u25C6\u25C7\u25CF\u25CB\u25D8\u2605\u2606\u2756\u29BE\u29BF\u2713\u2714]/g, '');
    s = s.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000\u1680]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  /** Normalize a full line string for diffing (same rules as normalizeWordForDiff for consistency). */
  function normalizeLineForDiff(str) {
    if (typeof str !== 'string') return '';
    return normalizeWordForDiff(str);
  }

  function getWordRectsFlat(page) {
    return page.getTextContent().then(function (content) {
      var words = [];
      var items = (content.items || []).slice();
      var yTol = computeDynamicYTolerance(items);
      items.sort(function (a, b) {
        var ay = a.transform[5], by = b.transform[5];
        var ax = a.transform[4], bx = b.transform[4];
        if (Math.abs(ay - by) > yTol) return by - ay;
        return ax - bx;
      });
      items.forEach(function (item) {
        if (!item.str || !item.str.trim()) return;
        var t = item.transform;
        var itemX = t[4], itemY = t[5];
        var itemH = item.height || 12;
        var itemW = item.width || 0;
        var totalChars = item.str.length;
        var chunks = item.str.split(/(\s+)/);
        var offsetX = 0;
        chunks.forEach(function (chunk) {
          var chunkW = (chunk.length / Math.max(totalChars, 1)) * itemW;
          if (!chunk.trim()) { offsetX += chunkW; return; }
          var normalized = normalizeWordForDiff(chunk);
          if (normalized === '') { offsetX += chunkW; return; }
          words.push({
            word: normalized,
            rect: { x: itemX + offsetX, y: itemY, w: chunkW, h: itemH }
          });
          offsetX += chunkW;
        });
      });
      return words;
    });
  }

  function renderPageWithHighlights(page, vp, rects, fill) {
    var c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    var ctx = c.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, c.width, c.height);
    return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
      ctx.fillStyle = fill;
      rects.forEach(function (r) { var v = pdfRectToViewport(r, vp); ctx.fillRect(v.x, v.y, v.w, v.h); });
      return { canvas: c, width: c.width, height: c.height };
    });
  }

  /** Assign each word to the first line it overlaps vertically. Returns array of word arrays per line. */
  function assignWordsToLines(lines, words) {
    var wordsPerLine = lines.map(function () { return []; });
    if (!lines.length) return wordsPerLine;
    words.forEach(function (w) {
      var wBottom = w.rect.y, wTop = w.rect.y + w.rect.h;
      for (var i = 0; i < lines.length; i++) {
        var rects = lines[i].rects;
        if (!rects.length) continue;
        var lBottom = rects[0].y, lTop = rects[0].y + rects[0].h;
        for (var j = 1; j < rects.length; j++) {
          var r = rects[j];
          if (r.y < lBottom) lBottom = r.y;
          if (r.y + (r.h || 0) > lTop) lTop = r.y + (r.h || 0);
        }
        if (wTop > lBottom && wBottom < lTop) {
          wordsPerLine[i].push(w);
          break;
        }
      }
    });
    return wordsPerLine;
  }

  /**
   * Extract words from a page sorted by visual reading order (top-to-bottom,
   * left-to-right).  Items are grouped into lines using an adaptive Y tolerance
   * based on the max font height of each item pair, so mixed-size pages
   * (headers vs body) group correctly.  This makes the word order independent
   * of the PDF content-stream order, which can differ between PDF generators.
   */
  function extractTextWords(page) {
    return page.getTextContent().then(function (content) {
      var items = (content.items || []).slice();
      if (!items.length) return [];

      items.sort(function (a, b) {
        var ay = a.transform[5], by = b.transform[5];
        if (ay !== by) return by - ay;
        return a.transform[4] - b.transform[4];
      });

      var lines = [];
      var curLine = [items[0]];
      var curY = items[0].transform[5];
      for (var i = 1; i < items.length; i++) {
        var it = items[i];
        var maxH = Math.max(curLine[0].height || 12, it.height || 12);
        var tol = Math.max(3, maxH * 0.45);
        if (Math.abs(curY - it.transform[5]) <= tol) {
          curLine.push(it);
        } else {
          curLine.sort(function (a, b) { return a.transform[4] - b.transform[4]; });
          lines.push(curLine);
          curLine = [it];
          curY = it.transform[5];
        }
      }
      if (curLine.length) {
        curLine.sort(function (a, b) { return a.transform[4] - b.transform[4]; });
        lines.push(curLine);
      }

      var words = [];
      lines.forEach(function (line) {
        line.forEach(function (item) {
          if (!item.str || !item.str.trim()) return;
          var t = item.transform;
          var itemX = t[4], itemY = t[5];
          var itemH = item.height || 12;
          var itemW = item.width || 0;
          var totalChars = item.str.length;
          var chunks = item.str.split(/(\s+)/);
          var offsetX = 0;
          chunks.forEach(function (chunk) {
            var chunkW = (chunk.length / Math.max(totalChars, 1)) * itemW;
            if (!chunk.trim()) { offsetX += chunkW; return; }
            var normalized = normalizeWordForDiff(chunk);
            if (normalized === '') { offsetX += chunkW; return; }
            words.push({
              word: normalized,
              rect: { x: itemX + offsetX, y: itemY, w: chunkW, h: itemH }
            });
            offsetX += chunkW;
          });
        });
      });
      return words;
    });
  }

  /**
   * Semantic page comparison.
   * 1. Extract words sorted by visual position (reading order).
   * 2. Fast-path: if concatenated text matches, zero differences.
   * 3. Myers word diff, with run-level boundary dedup so different word-item
   *    splits (e.g. "INST"+"I"+"T"+"U"... vs "INSTITUTIONAL") are not flagged.
   * 4. Map diff results to rects for highlight rendering.
   */
  function runSemanticOnePage(pdf1PageNum, pdf2PageNum) {
    return Promise.all([pdfDoc1.getPage(pdf1PageNum), pdfDoc2.getPage(pdf2PageNum)])
      .then(function (pages) {
        var vp1 = pages[0].getViewport({ scale: DPI_SCALE });
        var vp2 = pages[1].getViewport({ scale: DPI_SCALE });
        var pageH1 = pages[0].getViewport({ scale: 1 }).height;
        var pageH2 = pages[1].getViewport({ scale: 1 }).height;
        return Promise.all([
          extractTextWords(pages[0]),
          extractTextWords(pages[1])
        ]).then(function (arr) {
          var MARGIN_PCT = 0.02;
          function stripHeaderFooter(words, pageH) {
            var yMin = pageH * MARGIN_PCT;
            var yMax = pageH * (1 - MARGIN_PCT);
            return words.filter(function (w) {
              var baseY = w.rect.y + w.rect.h;
              return baseY >= yMin && baseY <= yMax;
            });
          }
          var wordsOld = stripHeaderFooter(arr[0], pageH1);
          var wordsNew = stripHeaderFooter(arr[1], pageH2);

          var oldStrs = wordsOld.map(function (w) { return w.word; });
          var newStrs = wordsNew.map(function (w) { return w.word; });

          var removedRects = [], addedRects = [];
          var removedWordCount = 0, addedWordCount = 0;

          var oldJoined = oldStrs.join('');
          var newJoined = newStrs.join('');

          var needsDiff = oldJoined !== newJoined;

          var oldBag = {}, newBag = {}, bagKey;
          for (var bi = 0; bi < oldStrs.length; bi++) { bagKey = oldStrs[bi]; oldBag[bagKey] = (oldBag[bagKey] || 0) + 1; }
          for (var bj = 0; bj < newStrs.length; bj++) { bagKey = newStrs[bj]; newBag[bagKey] = (newBag[bagKey] || 0) + 1; }
          var sameBag = false;
          var allKeys = Object.keys(oldBag);
          if (allKeys.length === Object.keys(newBag).length) {
            sameBag = true;
            for (var bk = 0; bk < allKeys.length; bk++) {
              if (oldBag[allKeys[bk]] !== newBag[allKeys[bk]]) { sameBag = false; break; }
            }
          }
          if (sameBag) needsDiff = false;

          if (needsDiff) {
            var wordOps = myersDiff(oldStrs, newStrs);
            var i1 = 0, i2 = 0, opIdx = 0;

            while (opIdx < wordOps.length) {
              if (wordOps[opIdx].type === 'equal') {
                i1++; i2++; opIdx++;
                continue;
              }
              var runRem = [], runAdd = [];
              while (opIdx < wordOps.length && wordOps[opIdx].type !== 'equal') {
                if (wordOps[opIdx].type === 'remove') { runRem.push(i1++); }
                else { runAdd.push(i2++); }
                opIdx++;
              }
              var remText = runRem.map(function (i) { return wordsOld[i].word; }).join('');
              var addText = runAdd.map(function (i) { return wordsNew[i].word; }).join('');
              if (remText !== addText) {
                runRem.forEach(function (i) { removedRects.push(wordsOld[i].rect); removedWordCount++; });
                runAdd.forEach(function (i) { addedRects.push(wordsNew[i].rect); addedWordCount++; });
              }
            }
          }

          return Promise.all([
            renderPageWithHighlights(pages[0], vp1, removedRects, 'rgba(220,53,69,0.4)'),
            renderPageWithHighlights(pages[1], vp2, addedRects, 'rgba(40,167,69,0.4)')
          ]).then(function (out) {
            return {
              canvasOld: out[0].canvas,
              canvasNew: out[1].canvas,
              removedCount: removedWordCount,
              addedCount: addedWordCount,
              removedWordCount: removedWordCount,
              addedWordCount: addedWordCount,
              removedLines: [],
              addedLines: []
            };
          });
        });
      });
  }

  function createBlankCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, w, h);
    return c;
  }

  function runSemanticOneSlot(slotIndex) {
    var slot = pageAlignment[slotIndex];
    if (!slot) {
      var empty = createBlankCanvas(100, 100);
      return Promise.resolve({
        canvasOld: empty,
        canvasNew: empty,
        removedCount: 0,
        addedCount: 0,
        removedLines: [],
        addedLines: []
      });
    }
    var p1 = slot.pdf1;
    var p2 = slot.pdf2;
    if (p1 !== null && p2 !== null) {
      return runSemanticOnePage(p1, p2);
    }
    if (p1 !== null) {
      return pdfDoc1.getPage(p1).then(function (page) {
        var vp = page.getViewport({ scale: DPI_SCALE });
        return getTextLinesFromPage(page).then(function (lines) {
          var removedRects = lines.reduce(function (a, l) { return a.concat(l.rects); }, []);
          var removedWordCount = lines.reduce(function (sum, l) {
            return sum + (l.normalized || '').split(/\s+/).filter(function (w) { return w.length > 0; }).length;
          }, 0);
          return renderPageWithHighlights(page, vp, removedRects, 'rgba(220,53,69,0.35)').then(function (out) {
            var placeholder = createBlankCanvas(out.width, out.height);
            return {
              canvasOld: out.canvas,
              canvasNew: placeholder,
              removedCount: removedWordCount,
              addedCount: 0,
              removedWordCount: removedWordCount,
              addedWordCount: 0,
              removedLines: [],
              addedLines: []
            };
          });
        });
      });
    }
    if (p2 !== null) {
      return pdfDoc2.getPage(p2).then(function (page) {
        var vp = page.getViewport({ scale: DPI_SCALE });
        return getTextLinesFromPage(page).then(function (lines) {
          var addedRects = lines.reduce(function (a, l) { return a.concat(l.rects); }, []);
          var addedWordCount = lines.reduce(function (sum, l) {
            return sum + (l.normalized || '').split(/\s+/).filter(function (w) { return w.length > 0; }).length;
          }, 0);
          return renderPageWithHighlights(page, vp, addedRects, 'rgba(40,167,69,0.35)').then(function (out) {
            var placeholder = createBlankCanvas(out.width, out.height);
            return {
              canvasOld: placeholder,
              canvasNew: out.canvas,
              removedCount: 0,
              addedCount: addedWordCount,
              removedWordCount: 0,
              addedWordCount: addedWordCount,
              removedLines: [],
              addedLines: []
            };
          });
        });
      });
    }
    var empty = createBlankCanvas(100, 100);
    return Promise.resolve({
      canvasOld: empty,
      canvasNew: empty,
      removedCount: 0,
      addedCount: 0,
      removedLines: [],
      addedLines: []
    });
  }

  function runSemanticComparison() {
    isDocxComparison = false;
    showDocxSemanticPanels(false);
    resetPdfSemanticLabels();
    semanticResultsByPage = [];
    semanticCurrentPageIndex = 0;
    semanticZoom1 = 1;
    semanticZoom2 = 1;
    if (file1Object) semanticFilename1El.textContent = file1Object.name;
    if (file2Object) semanticFilename2El.textContent = file2Object.name;
    setLoading(true);
    showSemanticLoading();
    setProgress(15, 'Comparing page 1 of ' + totalPages + '…');

    var completed = 0;
    function trackProgress(promise) {
      return promise.then(function (result) {
        completed++;
        var pct = 15 + Math.round((completed / totalPages) * 75);
        setProgress(pct, 'Comparing page ' + completed + ' of ' + totalPages + '…');
        return result;
      });
    }

    var promises = [];
    for (var i = 0; i < totalPages; i++) {
      promises.push(trackProgress(runSemanticOneSlot(i)));
    }

    Promise.all(promises)
      .then(function (allPages) {
        setProgress(92, 'Rendering…');
        semanticResultsByPage = allPages;
        drawSemanticAllPages(allPages);
        updateSemanticReport();
        updateSemanticNav();
        cacheSemantic();
        setProgress(100, 'Done');
      })
      .catch(function (e) { showError(e && e.message || 'Semantic comparison failed.'); })
      .finally(function () { setLoading(false); hideSemanticLoading(); });
  }

  function drawSemanticAllPages(allPages) {
    if (!allPages || !allPages.length) return;
    
    // Calculate total height and max width
    var maxWidth = 0;
    var totalHeight = 0;
    allPages.forEach(function (p) {
      maxWidth = Math.max(maxWidth, p.canvasOld.width, p.canvasNew.width);
      totalHeight += Math.max(p.canvasOld.height, p.canvasNew.height);
    });
    
    // Create continuous canvases
    var c1 = document.createElement('canvas');
    c1.width = maxWidth;
    c1.height = totalHeight;
    var ctx1 = c1.getContext('2d');
    ctx1.fillStyle = 'white';
    ctx1.fillRect(0, 0, c1.width, c1.height);
    
    var c2 = document.createElement('canvas');
    c2.width = maxWidth;
    c2.height = totalHeight;
    var ctx2 = c2.getContext('2d');
    ctx2.fillStyle = 'white';
    ctx2.fillRect(0, 0, c2.width, c2.height);
    
    // Stack pages vertically with consistent row height per slot so both panels match (scroll sync)
    var y1 = 0, y2 = 0;
    allPages.forEach(function (p) {
      var rowHeight = Math.max(p.canvasOld.height, p.canvasNew.height);
      ctx1.drawImage(p.canvasOld, 0, y1);
      ctx2.drawImage(p.canvasNew, 0, y2);
      y1 += rowHeight;
      y2 += rowHeight;
    });
    
    // Update display canvases
    semanticCanvas1.width = c1.width;
    semanticCanvas1.height = c1.height;
    semanticCanvas1.getContext('2d').drawImage(c1, 0, 0);
    
    semanticCanvas2.width = c2.width;
    semanticCanvas2.height = c2.height;
    semanticCanvas2.getContext('2d').drawImage(c2, 0, 0);
    
    applySemanticZoom();
  }

  function countWords(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).filter(function (w) { return w.length > 0; }).length;
  }

  function updateSemanticReport() {
    var remWords = 0, addWords = 0;
    semanticResultsByPage.forEach(function (p) {
      if (p.removedWordCount != null && p.addedWordCount != null) {
        remWords += p.removedWordCount;
        addWords += p.addedWordCount;
      } else {
        if (p.removedLines) {
          p.removedLines.forEach(function (line) {
            remWords += countWords(line.text);
          });
        }
        if (p.addedLines) {
          p.addedLines.forEach(function (line) {
            addWords += countWords(line.text);
          });
        }
      }
    });
    
    var totalChanges = remWords + addWords;
    changeReportCountEl.textContent = '(' + totalChanges + ')';
    reportOldDiffEl.innerHTML = '&minus;' + remWords;
    reportNewDiffEl.textContent = '+' + addWords;
    if (semanticPageDisplayEl) semanticPageDisplayEl.textContent = 'All pages';
  }

  function updateSemanticNav() {
    if (isDocxComparison) {
      semanticPageInfoEl.textContent = 'Word document';
      semanticPrevPageBtn.disabled = true;
      semanticNextPageBtn.disabled = true;
      return;
    }
    // Show total pages since we're displaying all pages continuously
    semanticPageInfoEl.textContent = totalPages + ' pages';
    semanticPrevPageBtn.disabled = true;  // No page nav needed for continuous scroll
    semanticNextPageBtn.disabled = true;
  }

  // Semantic scroll sync
  if (scrollSyncCheckbox && semanticWrapper1 && semanticWrapper2) {
    var syncing = false;
    function sync(src, tgt) {
      if (syncing) return;
      syncing = true;
      tgt.scrollTop = src.scrollTop;
      tgt.scrollLeft = src.scrollLeft;
      syncing = false;
    }
    semanticWrapper1.addEventListener('scroll', function () { if (scrollSyncCheckbox.checked) sync(semanticWrapper1, semanticWrapper2); });
    semanticWrapper2.addEventListener('scroll', function () { if (scrollSyncCheckbox.checked) sync(semanticWrapper2, semanticWrapper1); });
  }

  // Semantic per-panel zoom
  function applySemanticZoom() {
    semanticCanvas1.style.width = (semanticZoom1 * 100) + '%';
    semanticCanvas2.style.width = (semanticZoom2 * 100) + '%';
    if (semanticHtml1) semanticHtml1.style.width = (semanticZoom1 * 100) + '%';
    if (semanticHtml2) semanticHtml2.style.width = (semanticZoom2 * 100) + '%';
    semanticZoom1El.textContent = Math.round(semanticZoom1 * 100) + '%';
    semanticZoom2El.textContent = Math.round(semanticZoom2 * 100) + '%';
  }

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.panel-zoom-btn');
    if (!btn) return;
    var target = btn.getAttribute('data-target');
    var dir = Number(btn.getAttribute('data-dir'));
    if (target === '1') { semanticZoom1 = Math.min(3, Math.max(0.25, semanticZoom1 + dir * 0.25)); }
    else                { semanticZoom2 = Math.min(3, Math.max(0.25, semanticZoom2 + dir * 0.25)); }
    applySemanticZoom();
  });

  function cacheSemantic() {
    if (isDocxComparison) {
      cachedSemantic = {
        isDocx: true,
        docxHtmlLeft: semanticHtml1 ? semanticHtml1.innerHTML : '',
        docxHtmlRight: semanticHtml2 ? semanticHtml2.innerHTML : '',
        docxRemovedCount: semanticResultsByPage[0] ? semanticResultsByPage[0].removedWordCount : 0,
        docxAddedCount: semanticResultsByPage[0] ? semanticResultsByPage[0].addedWordCount : 0,
        totalPages: 1,
        semanticCurrentPageIndex: 0
      };
    } else {
      cachedSemantic = { semanticResultsByPage: semanticResultsByPage, totalPages: totalPages, semanticCurrentPageIndex: semanticCurrentPageIndex };
    }
  }

  function restoreSemantic() {
    if (!cachedSemantic) return;
    totalPages = cachedSemantic.totalPages;
    semanticCurrentPageIndex = cachedSemantic.semanticCurrentPageIndex;
    if (file1Object) semanticFilename1El.textContent = file1Object.name;
    if (file2Object) semanticFilename2El.textContent = file2Object.name;
    if (cachedSemantic.isDocx) {
      isDocxComparison = true;
      semanticResultsByPage = [{
        removedWordCount: cachedSemantic.docxRemovedCount || 0,
        addedWordCount: cachedSemantic.docxAddedCount || 0
      }];
      if (semanticHtml1) semanticHtml1.innerHTML = cachedSemantic.docxHtmlLeft || '';
      if (semanticHtml2) semanticHtml2.innerHTML = cachedSemantic.docxHtmlRight || '';
      showDocxSemanticPanels(true);
      applyDocxSemanticLabels();
      applySemanticZoom();
    } else {
      isDocxComparison = false;
      showDocxSemanticPanels(false);
      resetPdfSemanticLabels();
      semanticResultsByPage = cachedSemantic.semanticResultsByPage;
      if (semanticResultsByPage && semanticResultsByPage.length) {
        drawSemanticAllPages(semanticResultsByPage);
      }
    }
    updateSemanticNav();
    updateSemanticReport();
  }

  downloadReportBtn.addEventListener('click', function () {
    if (!semanticResultsByPage.length) return;
    downloadReportBtn.disabled = true;
    downloadReportBtn.textContent = 'Generating…';
    setLoading(true);

    if (isDocxComparison && semanticHtml1 && semanticHtml2 && typeof html2canvas !== 'undefined') {
      Promise.all([
        html2canvas(semanticHtml1, { scale: 1, backgroundColor: '#ffffff', logging: false }),
        html2canvas(semanticHtml2, { scale: 1, backgroundColor: '#ffffff', logging: false })
      ])
        .then(function (canvases) {
          var jsPDF = window.jspdf.jsPDF;
          var GAP = 8;
          var LABEL_H = 18;
          var MARGIN = 12;
          var firstOld = canvases[0];
          var firstNew = canvases[1];
          var refW = Math.max(firstOld.width, firstNew.width);
          var refH = Math.max(firstOld.height, firstNew.height);
          var pageW = MARGIN + refW + GAP + refW + MARGIN;
          var pageH = MARGIN + LABEL_H + refH + MARGIN;
          var doc = new jsPDF({
            orientation: pageW > pageH ? 'landscape' : 'portrait',
            unit: 'px',
            format: [pageW, pageH],
            compress: true
          });
          var slotW = (pageW - MARGIN * 2 - GAP) / 2;
          var slotH = pageH - MARGIN * 2 - LABEL_H;
          doc.setFillColor(255, 255, 255);
          doc.rect(0, 0, pageW, pageH, 'F');
          doc.setFontSize(9);
          doc.setTextColor(120, 120, 120);
          doc.text('Original (Word)', MARGIN, MARGIN + 10);
          doc.text('Modified (Word)', MARGIN + slotW + GAP, MARGIN + 10);
          var yOff = MARGIN + LABEL_H;
          var scaleOld = Math.min(slotW / firstOld.width, slotH / firstOld.height, 1);
          var oldW = firstOld.width * scaleOld;
          var oldH = firstOld.height * scaleOld;
          doc.addImage(firstOld.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, yOff, oldW, oldH, 'wold', 'FAST');
          var scaleNew = Math.min(slotW / firstNew.width, slotH / firstNew.height, 1);
          var newW = firstNew.width * scaleNew;
          var newH = firstNew.height * scaleNew;
          doc.addImage(firstNew.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN + slotW + GAP, yOff, newW, newH, 'wnew', 'FAST');
          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.5);
          doc.line(MARGIN + slotW + GAP / 2, MARGIN, MARGIN + slotW + GAP / 2, pageH - MARGIN);
          doc.setFontSize(7);
          doc.setTextColor(160, 160, 160);
          doc.text('Word comparison', pageW / 2, pageH - 4, { align: 'center' });
          var name1 = file1Object ? file1Object.name.replace(/\.(pdf|docx)$/i, '') : 'Doc1';
          var name2 = file2Object ? file2Object.name.replace(/\.(pdf|docx)$/i, '') : 'Doc2';
          doc.save(name1 + '_vs_' + name2 + '_comparison.pdf');
        })
        .catch(function (e) {
          showError(e && e.message || 'Could not generate PDF from Word comparison.');
        })
        .finally(function () {
          setLoading(false);
          downloadReportBtn.disabled = false;
          downloadReportBtn.textContent = 'Download comparison';
        });
      return;
    }

    setTimeout(function () {
      try {
        var jsPDF = window.jspdf.jsPDF;
        var GAP = 8;
        var LABEL_H = 18;
        var MARGIN = 12;

        var firstOld = semanticResultsByPage[0].canvasOld;
        var firstNew = semanticResultsByPage[0].canvasNew;
        var refW = Math.max(firstOld.width, firstNew.width);
        var refH = Math.max(firstOld.height, firstNew.height);
        var pageW = MARGIN + refW + GAP + refW + MARGIN;
        var pageH = MARGIN + LABEL_H + refH + MARGIN;

        var doc = new jsPDF({
          orientation: pageW > pageH ? 'landscape' : 'portrait',
          unit: 'px',
          format: [pageW, pageH],
          compress: true
        });

        for (var i = 0; i < semanticResultsByPage.length; i++) {
          var pg = semanticResultsByPage[i];
          var cOld = pg.canvasOld;
          var cNew = pg.canvasNew;
          var slotW = (pageW - MARGIN * 2 - GAP) / 2;
          var slotH = pageH - MARGIN * 2 - LABEL_H;

          if (i > 0) doc.addPage([pageW, pageH], pageW > pageH ? 'l' : 'p');

          doc.setFillColor(255, 255, 255);
          doc.rect(0, 0, pageW, pageH, 'F');

          doc.setFontSize(9);
          doc.setTextColor(120, 120, 120);
          doc.text('Original (PDF 1)', MARGIN, MARGIN + 10);
          doc.text('Modified (PDF 2)', MARGIN + slotW + GAP, MARGIN + 10);

          var yOff = MARGIN + LABEL_H;

          var scaleOld = Math.min(slotW / cOld.width, slotH / cOld.height, 1);
          var oldW = cOld.width * scaleOld;
          var oldH = cOld.height * scaleOld;
          doc.addImage(cOld.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN, yOff, oldW, oldH, 'pg' + i + 'old', 'FAST');

          var scaleNew = Math.min(slotW / cNew.width, slotH / cNew.height, 1);
          var newW = cNew.width * scaleNew;
          var newH = cNew.height * scaleNew;
          doc.addImage(cNew.toDataURL('image/jpeg', 0.92), 'JPEG', MARGIN + slotW + GAP, yOff, newW, newH, 'pg' + i + 'new', 'FAST');

          doc.setDrawColor(200, 200, 200);
          doc.setLineWidth(0.5);
          doc.line(MARGIN + slotW + GAP / 2, MARGIN, MARGIN + slotW + GAP / 2, pageH - MARGIN);

          doc.setFontSize(7);
          doc.setTextColor(160, 160, 160);
          doc.text('Page ' + (i + 1) + ' / ' + semanticResultsByPage.length, pageW / 2, pageH - 4, { align: 'center' });
        }

        var name1 = file1Object ? file1Object.name.replace(/\.pdf$/i, '') : 'PDF1';
        var name2 = file2Object ? file2Object.name.replace(/\.pdf$/i, '') : 'PDF2';
        doc.save(name1 + '_vs_' + name2 + '_comparison.pdf');
      } catch (e) {
        showError(e && e.message || 'PDF generation failed.');
      } finally {
        setLoading(false);
        downloadReportBtn.disabled = false;
        downloadReportBtn.textContent = 'Download comparison';
      }
    }, 50);
  });

})();