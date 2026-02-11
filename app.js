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
  var modeOverlay       = document.getElementById('modeOverlay');
  var modeSemantic      = document.getElementById('modeSemantic');
  var modeDesc          = document.getElementById('modeDesc');
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

  // ── State ───────────────────────────────────────────────

  var pdfDoc1 = null;
  var pdfDoc2 = null;
  var file1Object = null;
  var file2Object = null;
  var totalPages = 0;
  var comparisonMode = 'overlay'; // 'overlay' | 'semantic'

  // Overlay state
  var currentPageIndex = 0;
  var resultCanvases = [];
  var zoomLevel = 1;

  // Semantic state
  var semanticResultsByPage = [];
  var semanticCurrentPageIndex = 0;
  var semanticZoom1 = 1;
  var semanticZoom2 = 1;

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
  }

  // ── File loading ────────────────────────────────────────

  function loadPdf(file, which) {
    if (!isPdfFile(file)) { showError('Please select a PDF file (.pdf).'); return; }
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

  function updateCompareButton() { compareBtn.disabled = !(pdfDoc1 && pdfDoc2); }

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
      if (f) loadPdf(f, which);
    });
    inputEl.addEventListener('change', function () {
      var f = inputEl.files && inputEl.files[0];
      if (f) loadPdf(f, which);
    });
  }

  setupUploadZone(zone1, fileInput1, 1);
  setupUploadZone(zone2, fileInput2, 2);

  // ── Setup mode tabs ─────────────────────────────────────

  function setSetupMode(mode) {
    comparisonMode = mode;
    modeOverlay.classList.toggle('active', mode === 'overlay');
    modeSemantic.classList.toggle('active', mode === 'semantic');
    modeDesc.textContent = mode === 'overlay'
      ? 'Pixel-by-pixel overlay: black/white = match, red = differ.'
      : 'Compare text changes between two PDFs. Red = removed, Green = added.';
  }

  modeOverlay.addEventListener('click', function () { setSetupMode('overlay'); });
  modeSemantic.addEventListener('click', function () { setSetupMode('semantic'); });

  // ── Result mode tabs (switch within results view) ───────

  function activateResultMode(mode) {
    comparisonMode = mode;
    resultModeOverlay.classList.toggle('active', mode === 'overlay');
    resultModeSemantic.classList.toggle('active', mode === 'semantic');
    toolbarSyncLabel.style.display = mode === 'semantic' ? '' : 'none';

    /* Always hide the other mode first so only one is ever visible */
    overlayResults.hidden = true;
    semanticResults.hidden = true;
    if (mode === 'overlay') {
      overlayResults.hidden = false;
      if (!cachedOverlay) { runOverlayComparison(); }
      else { restoreOverlay(); }
    } else {
      semanticResults.hidden = false;
      if (!cachedSemantic) { runSemanticComparison(); }
      else { restoreSemantic(); }
    }
  }

  resultModeOverlay.addEventListener('click', function () { activateResultMode('overlay'); });
  resultModeSemantic.addEventListener('click', function () { activateResultMode('semantic'); });

  // ── New comparison button ───────────────────────────────

  newCompareBtn.addEventListener('click', function () {
    hideResultsView();
  });

  // ── Compare button ──────────────────────────────────────

  compareBtn.addEventListener('click', function () {
    if (!pdfDoc1 || !pdfDoc2) return;
    clearError();

    var numPages1 = pdfDoc1.numPages;
    var numPages2 = pdfDoc2.numPages;
    totalPages = Math.min(numPages1, numPages2);
    if (totalPages === 0) { showError('No pages found in one or both PDFs.'); return; }

    cachedOverlay = null;
    cachedSemantic = null;

    showResultsView();

    /* Show only the selected mode; the other stays hidden */
    overlayResults.hidden = true;
    semanticResults.hidden = true;
    if (comparisonMode === 'overlay') {
      resultModeOverlay.classList.add('active');
      resultModeSemantic.classList.remove('active');
      toolbarSyncLabel.style.display = 'none';
      overlayResults.hidden = false;
      runOverlayComparison();
    } else {
      resultModeSemantic.classList.add('active');
      resultModeOverlay.classList.remove('active');
      toolbarSyncLabel.style.display = '';
      semanticResults.hidden = false;
      runSemanticComparison();
    }
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

  function compareOnePage(pageNum) {
    return Promise.all([renderPdfPage(pdfDoc1, pageNum), renderPdfPage(pdfDoc2, pageNum)])
      .then(function (arr) {
        var n = normalizeToSameSize(arr[0], arr[1]);
        var r = comparePixels(n.canvas1, n.canvas2, n.width, n.height);
        return { result: r.resultCanvas, stats: r.stats };
      });
  }

  function runOverlayComparison() {
    resultCanvases = [];
    currentPageIndex = 0;
    zoomLevel = 1;
    setLoading(true);
    compareOnePage(1)
      .then(function (p) {
        resultCanvases[0] = p;
        drawOverlayPage(p);
        updateOverlayNav();
        cacheOverlay();
      })
      .catch(function (e) { showError(e && e.message || 'Overlay comparison failed.'); })
      .finally(function () { setLoading(false); });
  }

  function drawOverlayPage(p) {
    resultCanvas.width = p.result.width;
    resultCanvas.height = p.result.height;
    resultCanvas.getContext('2d').drawImage(p.result, 0, 0);
    updateOverlayStats(p.stats);
  }

  function updateOverlayStats(s) {
    var pct = s.total > 0 ? ((s.match / s.total) * 100).toFixed(2) : '0';
    matchPercentEl.textContent = pct + '%';
    statsDetailEl.textContent = s.match.toLocaleString() + ' match · ' + s.diff.toLocaleString() + ' differ';
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
    if (resultCanvases[idx]) { drawOverlayPage(resultCanvases[idx]); updateOverlayNav(); cacheOverlay(); return; }
    setLoading(true);
    compareOnePage(idx + 1)
      .then(function (p) { resultCanvases[idx] = p; drawOverlayPage(p); updateOverlayNav(); cacheOverlay(); })
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
      promises.push(resultCanvases[i] ? Promise.resolve(resultCanvases[i]) : compareOnePage(i + 1));
    }
    Promise.all(promises)
      .then(function (payloads) {
        resultCanvases = payloads;
        var jsPDF = window.jspdf.jsPDF;
        var first = payloads[0].result;
        var doc = new jsPDF({ orientation: first.width > first.height ? 'landscape' : 'portrait', unit: 'px', format: [first.width, first.height] });
        doc.addImage(first.toDataURL('image/png'), 'PNG', 0, 0, first.width, first.height, undefined, 'FAST');
        for (var i = 1; i < payloads.length; i++) {
          var c = payloads[i].result;
          doc.addPage([c.width, c.height], 'p');
          doc.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, c.width, c.height, undefined, 'FAST');
        }
        doc.save('comparison_doc.pdf');
      })
      .catch(function (e) { showError(e && e.message || 'PDF download failed.'); })
      .finally(function () { setLoading(false); downloadBtn.disabled = false; });
  });

  // ===== SEMANTIC COMPARISON ==============================

  var LINE_Y_TOLERANCE = 3;

  function normText(s) { return (s || '').trim().replace(/\s+/g, ' '); }

  function getTextLinesFromPage(page) {
    return page.getTextContent().then(function (content) {
      var items = content.items || [];
      if (!items.length) return [];
      var arr = items.map(function (it) {
        var t = it.transform;
        return { str: it.str || '', x: t[4], y: t[5], w: it.width || 0, h: it.height || 0, pdfY: t[5], pdfBottom: t[5] - (it.height || 0) };
      });
      arr.sort(function (a, b) {
        if (Math.abs(a.pdfY - b.pdfY) <= LINE_Y_TOLERANCE) return a.x - b.x;
        return b.pdfY - a.pdfY;
      });
      var lines = [], cur = [], curY = null;
      arr.forEach(function (r) {
        if (r.str === '') return;
        if (curY === null || Math.abs(r.pdfY - curY) <= LINE_Y_TOLERANCE) {
          cur.push(r);
          if (curY === null) curY = r.pdfY;
        } else {
          if (cur.length) {
            var txt = cur.map(function (i) { return i.str; }).join('');
            var rects = cur.map(function (i) { return { x: i.x, y: i.pdfBottom, w: i.w, h: i.h }; });
            lines.push({ text: txt, normalized: normText(txt), rects: rects });
          }
          cur = [r]; curY = r.pdfY;
        }
      });
      if (cur.length) {
        var txt = cur.map(function (i) { return i.str; }).join('');
        var rects = cur.map(function (i) { return { x: i.x, y: i.pdfBottom, w: i.w, h: i.h }; });
        lines.push({ text: txt, normalized: normText(txt), rects: rects });
      }
      return lines;
    });
  }

  function pdfRectToViewport(rect, vp) {
    var s = vp.scale, vh = vp.height;
    return { x: rect.x * s, y: vh - (rect.y + rect.h) * s, w: rect.w * s, h: rect.h * s };
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

  function runSemanticOnePage(pageNum) {
    return Promise.all([pdfDoc1.getPage(pageNum), pdfDoc2.getPage(pageNum)])
      .then(function (pages) {
        var vp1 = pages[0].getViewport({ scale: DPI_SCALE });
        var vp2 = pages[1].getViewport({ scale: DPI_SCALE });
        return Promise.all([getTextLinesFromPage(pages[0]), getTextLinesFromPage(pages[1])])
          .then(function (arr) {
            var linesOld = arr[0], linesNew = arr[1];
            var oldSet = new Set(linesOld.map(function (l) { return l.normalized; }));
            var newSet = new Set(linesNew.map(function (l) { return l.normalized; }));
            var removed = linesOld.filter(function (l) { return l.normalized !== '' && !newSet.has(l.normalized); });
            var added = linesNew.filter(function (l) { return l.normalized !== '' && !oldSet.has(l.normalized); });
            var removedRects = removed.reduce(function (a, l) { return a.concat(l.rects); }, []);
            var addedRects = added.reduce(function (a, l) { return a.concat(l.rects); }, []);
            return Promise.all([
              renderPageWithHighlights(pages[0], vp1, removedRects, 'rgba(220,53,69,0.35)'),
              renderPageWithHighlights(pages[1], vp2, addedRects, 'rgba(40,167,69,0.35)')
            ]).then(function (out) {
              return {
                canvasOld: out[0].canvas,
                canvasNew: out[1].canvas,
                removedCount: removed.length,
                addedCount: added.length,
                removedLines: removed,  // Store lines for word counting
                addedLines: added        // Store lines for word counting
              };
            });
          });
      });
  }

  function runSemanticComparison() {
    semanticResultsByPage = [];
    semanticCurrentPageIndex = 0;
    semanticZoom1 = 1;
    semanticZoom2 = 1;
    if (file1Object) semanticFilename1El.textContent = file1Object.name;
    if (file2Object) semanticFilename2El.textContent = file2Object.name;
    setLoading(true);
    
    // Process ALL pages and stack them vertically for continuous scroll
    var promises = [];
    for (var i = 1; i <= totalPages; i++) {
      promises.push(runSemanticOnePage(i));
    }
    
    Promise.all(promises)
      .then(function (allPages) {
        semanticResultsByPage = allPages;
        // Stack all pages vertically into continuous canvases
        drawSemanticAllPages(allPages);
        updateSemanticReport();
        updateSemanticNav();
        cacheSemantic();
      })
      .catch(function (e) { showError(e && e.message || 'Semantic comparison failed.'); })
      .finally(function () { setLoading(false); });
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
    
    // Stack pages vertically
    var y1 = 0, y2 = 0;
    allPages.forEach(function (p) {
      ctx1.drawImage(p.canvasOld, 0, y1);
      ctx2.drawImage(p.canvasNew, 0, y2);
      y1 += p.canvasOld.height;
      y2 += p.canvasNew.height;
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
      // Count words in removed lines
      if (p.removedLines) {
        p.removedLines.forEach(function (line) {
          remWords += countWords(line.text);
        });
      }
      // Count words in added lines
      if (p.addedLines) {
        p.addedLines.forEach(function (line) {
          addWords += countWords(line.text);
        });
      }
    });
    
    var totalChanges = remWords + addWords;
    changeReportCountEl.textContent = '(' + totalChanges + ')';
    reportOldDiffEl.innerHTML = '&minus;' + remWords;
    reportNewDiffEl.textContent = '+' + addWords;
    if (semanticPageDisplayEl) semanticPageDisplayEl.textContent = 'All pages';
  }

  function updateSemanticNav() {
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
    cachedSemantic = { semanticResultsByPage: semanticResultsByPage, totalPages: totalPages, semanticCurrentPageIndex: semanticCurrentPageIndex };
  }

  function restoreSemantic() {
    semanticResultsByPage = cachedSemantic.semanticResultsByPage;
    totalPages = cachedSemantic.totalPages;
    semanticCurrentPageIndex = cachedSemantic.semanticCurrentPageIndex;
    if (file1Object) semanticFilename1El.textContent = file1Object.name;
    if (file2Object) semanticFilename2El.textContent = file2Object.name;
    if (semanticResultsByPage && semanticResultsByPage.length) {
      drawSemanticAllPages(semanticResultsByPage);
    }
    updateSemanticNav();
    updateSemanticReport();
  }

  // Download report
  downloadReportBtn.addEventListener('click', function () {
    if (!semanticResultsByPage.length) return;
    var remWords = 0, addWords = 0;
    semanticResultsByPage.forEach(function (p) {
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
    });
    var lines = [
      'PDF Comparison Report (Semantic Text)',
      'Original: ' + (file1Object ? file1Object.name : 'PDF 1'),
      'Modified: ' + (file2Object ? file2Object.name : 'PDF 2'),
      '', 'Summary (across all pages):',
      '  Words removed from Modified: ' + remWords,
      '  Words added in Modified: ' + addWords,
      '  Total word changes: ' + (remWords + addWords)
    ];
    var blob = new Blob([lines.join('\r\n')], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'comparison_report.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // ── Disclaimer Review (API) ─────────────────────────────
  var DISCLAIMER_API = 'https://comply1-pink.vercel.app';
  var disclaimerZone = document.getElementById('disclaimerZone');
  var disclaimerFileInput = document.getElementById('disclaimerFileInput');
  var disclaimerBrowseBtn = document.getElementById('disclaimerBrowseBtn');
  var disclaimerFilename = document.getElementById('disclaimerFilename');
  var disclaimerAnalyzeBtn = document.getElementById('disclaimerAnalyzeBtn');
  var disclaimerError = document.getElementById('disclaimerError');
  var disclaimerErrorText = document.getElementById('disclaimerErrorText');
  var disclaimerModal = document.getElementById('disclaimerModal');
  var disclaimerModalContent = document.getElementById('disclaimerModalContent');
  var disclaimerModalBuffering = document.getElementById('disclaimerModalBuffering');
  var disclaimerModalStatus = document.getElementById('disclaimerModalStatus');
  var disclaimerModalStatusLeft = document.getElementById('disclaimerModalStatusLeft');
  var disclaimerModalStatusSummary = document.getElementById('disclaimerModalStatusSummary');
  var disclaimerModalPdf = document.getElementById('disclaimerModalPdf');
  var disclaimerModalCommentsTitle = document.getElementById('disclaimerModalCommentsTitle');
  var disclaimerModalCommentsList = document.getElementById('disclaimerModalCommentsList');
  var disclaimerModalError = document.getElementById('disclaimerModalError');
  var disclaimerModalErrorText = document.getElementById('disclaimerModalErrorText');
  var disclaimerModalClose = document.getElementById('disclaimerModalClose');

  var disclaimerSelectedFile = null;
  var disclaimerAnnotatedBlobUrl = null;

  function openDisclaimerModal() {
    if (disclaimerModal) {
      disclaimerModal.hidden = false;
      disclaimerModal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeDisclaimerModal() {
    if (disclaimerModal) {
      disclaimerModal.hidden = true;
      disclaimerModal.setAttribute('aria-hidden', 'true');
    }
    if (disclaimerAnnotatedBlobUrl) {
      URL.revokeObjectURL(disclaimerAnnotatedBlobUrl);
      disclaimerAnnotatedBlobUrl = null;
    }
    if (disclaimerModalPdf) disclaimerModalPdf.src = '';
  }

  function showDisclaimerError(msg) {
    if (disclaimerErrorText) disclaimerErrorText.textContent = msg || '';
    if (disclaimerError) disclaimerError.hidden = !msg;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  if (disclaimerZone) {
    disclaimerZone.addEventListener('click', function (e) {
      if (e.target === disclaimerBrowseBtn || e.target.closest('.browse-btn')) disclaimerFileInput && disclaimerFileInput.click();
    });
    disclaimerZone.addEventListener('dragover', function (e) { e.preventDefault(); disclaimerZone.classList.add('drag-over'); });
    disclaimerZone.addEventListener('dragleave', function (e) { e.preventDefault(); disclaimerZone.classList.remove('drag-over'); });
    disclaimerZone.addEventListener('drop', function (e) {
      e.preventDefault();
      disclaimerZone.classList.remove('drag-over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f && (f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf')) {
        disclaimerSelectedFile = f;
        disclaimerFilename.textContent = f.name;
        disclaimerZone.classList.add('has-file');
        disclaimerAnalyzeBtn.disabled = false;
        showDisclaimerError('');
      }
    });
  }

  if (disclaimerFileInput) {
    disclaimerFileInput.addEventListener('change', function () {
      var f = disclaimerFileInput.files && disclaimerFileInput.files[0];
      if (f) {
        disclaimerSelectedFile = f;
        disclaimerFilename.textContent = f.name;
        if (disclaimerZone) disclaimerZone.classList.add('has-file');
        if (disclaimerAnalyzeBtn) disclaimerAnalyzeBtn.disabled = false;
        showDisclaimerError('');
      }
    });
  }

  function populateDisclaimerModal(data) {
    var r = data.result || {};
    var approved = r.is_approved === true;
    var summary = (r.summary_blurb || 'No summary.').toString();

    if (disclaimerModalStatus) {
      disclaimerModalStatus.className = 'disclaimer-modal-status ' + (approved ? 'approved' : 'not-approved');
    }
    if (disclaimerModalStatusLeft) {
      disclaimerModalStatusLeft.textContent = approved ? '✓ APPROVED' : 'NOT APPROVED';
    }
    if (disclaimerModalStatusSummary) {
      disclaimerModalStatusSummary.textContent = summary;
    }

    if (data.annotated_pdf_base64 && disclaimerModalPdf) {
      var blob = base64ToBlob(data.annotated_pdf_base64, 'application/pdf');
      disclaimerAnnotatedBlobUrl = URL.createObjectURL(blob);
      disclaimerModalPdf.src = disclaimerAnnotatedBlobUrl;
    } else if (disclaimerModalPdf) {
      disclaimerModalPdf.src = '';
    }

    var comments = data.comments || [];
    if (disclaimerModalCommentsTitle) {
      disclaimerModalCommentsTitle.textContent = 'COMMENTS (' + comments.length + ')';
    }
    if (disclaimerModalCommentsList) {
      var html = '';
      comments.forEach(function (c) {
        var type = (c.type || 'Comment').toString();
        var color = (c.color || '#999').toString().replace(/^#/, '');
        if (!/^[0-9A-Fa-f]{6}$/.test(color)) color = '999999';
        var page = c.page != null ? 'Page ' + (Number(c.page) + 1) : '';
        var desc = (c.text || c.description || '').toString();
        var quote = (c.quoted_text || c.quote || '').toString();
        html += '<div class="disclaimer-comment-card">';
        html += '<div class="comment-type"><span class="comment-dot" style="background:#' + color + '"></span>' + escapeHtml(type) + '</div>';
        if (page) html += '<div class="comment-page">' + escapeHtml(page) + '</div>';
        if (desc) html += '<div>' + escapeHtml(desc) + '</div>';
        if (quote) html += '<div class="comment-text">' + escapeHtml(quote) + '</div>';
        html += '</div>';
      });
      disclaimerModalCommentsList.innerHTML = html || '<p class="comment-page">No comments.</p>';
    }
  }

  if (disclaimerAnalyzeBtn) {
    disclaimerAnalyzeBtn.addEventListener('click', function () {
      if (!disclaimerSelectedFile) return;
      showDisclaimerError('');
      openDisclaimerModal();

      if (disclaimerAnnotatedBlobUrl) {
        URL.revokeObjectURL(disclaimerAnnotatedBlobUrl);
        disclaimerAnnotatedBlobUrl = null;
      }
      if (disclaimerModalPdf) disclaimerModalPdf.src = '';

      if (disclaimerModalContent) {
        disclaimerModalContent.hidden = false;
        if (disclaimerModalStatusLeft) disclaimerModalStatusLeft.textContent = '—';
        if (disclaimerModalStatusSummary) disclaimerModalStatusSummary.textContent = '—';
        if (disclaimerModalCommentsTitle) disclaimerModalCommentsTitle.textContent = 'COMMENTS (0)';
        if (disclaimerModalCommentsList) disclaimerModalCommentsList.innerHTML = '';
        if (disclaimerModalStatus) disclaimerModalStatus.className = 'disclaimer-modal-status unknown';
      }
      if (disclaimerModalBuffering) disclaimerModalBuffering.hidden = false;
      if (disclaimerModalError) disclaimerModalError.hidden = true;

      var formData = new FormData();
      formData.append('file', disclaimerSelectedFile);

      fetch(DISCLAIMER_API + '/api/analyze/', {
        method: 'POST',
        body: formData
      })
        .then(function (res) {
          if (!res.ok) {
            return res.json().then(function (j) { throw new Error(j.detail || j.message || 'Analysis failed'); }).catch(function () {
              throw new Error('Analysis failed: ' + res.status);
            });
          }
          return res.json();
        })
        .then(function (data) {
          if (disclaimerModalBuffering) disclaimerModalBuffering.hidden = true;
          if (disclaimerModalError) disclaimerModalError.hidden = true;
          populateDisclaimerModal(data);
        })
        .catch(function (err) {
          if (disclaimerModalBuffering) disclaimerModalBuffering.hidden = true;
          if (disclaimerModalError) {
            disclaimerModalError.hidden = false;
            if (disclaimerModalErrorText) disclaimerModalErrorText.textContent = err.message || 'Request failed. Try again.';
          }
        });
    });
  }

  if (disclaimerModalClose) {
    disclaimerModalClose.addEventListener('click', closeDisclaimerModal);
  }
  if (disclaimerModal) {
    disclaimerModal.addEventListener('click', function (e) {
      if (e.target === disclaimerModal) closeDisclaimerModal();
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && disclaimerModal && !disclaimerModal.hidden) closeDisclaimerModal();
  });

  function base64ToBlob(base64, mime) {
    if (!base64) return new Blob([], { type: mime || 'application/pdf' });
    var slice = (base64.indexOf(',') >= 0 ? base64.split(',')[1] : base64).replace(/\s/g, '');
    var bin = atob(slice);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime || 'application/pdf' });
  }

  // ── Init mode tab state ─────────────────────────────────
  setSetupMode('overlay');

  // ── Top bar: tool selection ─────────────────────────────
  var toolComparePdf = document.getElementById('toolComparePdf');
  var toolDisclaimerReview = document.getElementById('toolDisclaimerReview');
  var toolPanelCompare = document.getElementById('toolPanelCompare');
  var toolPanelDisclaimer = document.getElementById('toolPanelDisclaimer');

  function setActiveTool(tool) {
    toolComparePdf.classList.toggle('active', tool === 'compare');
    toolDisclaimerReview.classList.toggle('active', tool === 'disclaimer');
    if (toolPanelCompare) toolPanelCompare.hidden = tool !== 'compare';
    if (toolPanelDisclaimer) toolPanelDisclaimer.hidden = tool !== 'disclaimer';
  }

  if (toolComparePdf) {
    toolComparePdf.addEventListener('click', function (e) {
      e.preventDefault();
      setActiveTool('compare');
    });
  }
  if (toolDisclaimerReview) {
    toolDisclaimerReview.addEventListener('click', function (e) {
      e.preventDefault();
      setActiveTool('disclaimer');
    });
  }

})();
