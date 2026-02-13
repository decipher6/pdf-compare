/**
 * PDF Comparison Tool
 * Overlay mode: client-side pixel diff (files stay in browser).
 * Semantic mode: word-level diff via Diffchecker API (red = removed, green = added).
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
  var modeEmailWrap     = document.getElementById('modeEmailWrap');
  var diffcheckerEmail  = document.getElementById('diffcheckerEmail');
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
  var semanticPanelsWrap    = document.getElementById('semanticPanelsWrap');
  var semanticDiffApi       = document.getElementById('semanticDiffApi');
  var semanticDiffApiStyle   = document.getElementById('semanticDiffApiStyle');
  var semanticDiffApiContent = document.getElementById('semanticDiffApiContent');

  // Diffchecker API for PDF text diff (red = removed, green = added)
  var DIFFCHECKER_PDF_API = 'https://api.diffchecker.com/public/pdf';

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

  // Page alignment: content-based mapping so missing/extra pages align correctly
  var pageAlignment = [];   // array of { pdf1: 1-based page or null, pdf2: 1-based page or null }

  // Cached results so switching modes doesn't re-compute if same PDFs
  var cachedOverlay = null;   // { resultCanvases, totalPages, currentPageIndex }
  var cachedSemantic = null;  // { type: 'api', html, css, added, removed } from Diffchecker API

  // ── Helpers ─────────────────────────────────────────────

  function clearError() { errorBanner.hidden = true; errorText.textContent = ''; }

  function showError(msg) { errorText.textContent = msg; errorBanner.hidden = false; }

  function setLoading(vis) { loadingOverlay.classList.toggle('visible', vis); }

  function isPdfFile(f) {
    if (!f || !f.name) return false;
    return f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';
  }

  /**
   * Call Diffchecker API for PDF word diff. Returns { html, css, added, removed }.
   * Uses html_json for display and json for added/removed counts.
   * email: required by the API (query param).
   */
  function fetchDiffcheckerPdf(leftFile, rightFile, email) {
    var q = 'output_type=html_json&diff_level=word&input_type=form';
    if (email && (email = (email + '').trim())) q += '&email=' + encodeURIComponent(email);
    var baseUrl = DIFFCHECKER_PDF_API + '?' + q;
    var form = new FormData();
    form.append('left_pdf', leftFile, leftFile.name || 'left.pdf');
    form.append('right_pdf', rightFile, rightFile.name || 'right.pdf');

    return fetch(baseUrl, { method: 'POST', body: form })
      .then(function (res) {
        if (!res.ok) throw new Error('Diff API failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var html = data.html || '';
        var css = data.css || '';
        var q2 = 'output_type=json&diff_level=word&input_type=form';
        if (email) q2 += '&email=' + encodeURIComponent(email);
        var form2 = new FormData();
        form2.append('left_pdf', leftFile, leftFile.name || 'left.pdf');
        form2.append('right_pdf', rightFile, rightFile.name || 'right.pdf');
        return fetch(DIFFCHECKER_PDF_API + '?' + q2, {
          method: 'POST',
          body: form2
        })
          .then(function (r) { return r.ok ? r.json() : {}; })
          .catch(function () { return {}; })
          .then(function (json) {
            return {
              html: html,
              css: css,
              added: (json && typeof json.added === 'number') ? json.added : null,
              removed: (json && typeof json.removed === 'number') ? json.removed : null
            };
          });
      });
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
    if (modeEmailWrap) modeEmailWrap.hidden = mode !== 'semantic';
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
    if (numPages1 === 0 && numPages2 === 0) {
      showError('No pages found in one or both PDFs.');
      return;
    }

    cachedOverlay = null;
    cachedSemantic = null;
    showResultsView();
    overlayResults.hidden = true;
    semanticResults.hidden = true;
    setLoading(true);

    Promise.all([getDocFingerprints(pdfDoc1), getDocFingerprints(pdfDoc2)])
      .then(function (arr) {
        pageAlignment = computePageAlignment(arr[0], arr[1]);
        totalPages = pageAlignment.length;
        if (totalPages === 0) {
          showError('Could not align any pages.');
          setLoading(false);
          return;
        }
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

  // ===== SEMANTIC COMPARISON ==============================

  var LINE_Y_TOLERANCE = 3;

  function normText(s) { return (s || '').trim().replace(/\s+/g, ' '); }

  /**
   * Normalize word for comparison so the same visual word from both PDFs always matches.
   * Lowercase, collapse all whitespace (including nbsp), strip zero-width/invisible chars, Unicode NFKC, then strip leading/trailing punctuation.
   */
  function normWord(w) {
    if (!w || !(w + '').length) return '';
    var s = (w + '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/[\u200b-\u200d\ufeff\u00ad]/g, '');
    if (typeof s.normalize === 'function') s = s.normalize('NFKC');
    var start = 0, end = s.length;
    while (start < end && /[^\w\u00c0-\u024f]/.test(s[start])) start++;
    while (end > start && /[^\w\u00c0-\u024f]/.test(s[end - 1])) end--;
    return end > start ? s.substring(start, end) : s;
  }

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
            var itemStrs = cur.map(function (i) { return i.str; });
            lines.push({ text: txt, normalized: normText(txt), rects: rects, itemStrs: itemStrs });
          }
          cur = [r]; curY = r.pdfY;
        }
      });
      if (cur.length) {
        var txt = cur.map(function (i) { return i.str; }).join('');
        var rects = cur.map(function (i) { return { x: i.x, y: i.pdfBottom, w: i.w, h: i.h }; });
        var itemStrs = cur.map(function (i) { return i.str; });
        lines.push({ text: txt, normalized: normText(txt), rects: rects, itemStrs: itemStrs });
      }
      return lines;
    });
  }

  var FINGERPRINT_MAX_CHARS = 800;

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

  function fingerprintSimilarity(a, b) {
    if (!a || !b) return 0;
    var wordsA = a.split(/\s+/).filter(function (w) { return w.length > 0; });
    var wordsB = b.split(/\s+/).filter(function (w) { return w.length > 0; });
    if (wordsA.length === 0 && wordsB.length === 0) return 1;
    if (wordsA.length === 0 || wordsB.length === 0) return 0;
    var setB = new Set(wordsB);
    var match = 0;
    wordsA.forEach(function (w) { if (setB.has(w)) match++; });
    return match / Math.max(wordsA.length, wordsB.length);
  }

  var ALIGN_MATCH_THRESHOLD = 0.5;

  function computePageAlignment(fp1, fp2) {
    var n1 = fp1.length;
    var n2 = fp2.length;
    var sim = function (i, j) {
      return fingerprintSimilarity(fp1[i], fp2[j]);
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
          var score = M[i][j] + (s >= ALIGN_MATCH_THRESHOLD ? 1 + s : 0);
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

  function runSemanticComparison() {
    if (!file1Object || !file2Object) {
      showError('No files selected.');
      setLoading(false);
      return;
    }
    var email = diffcheckerEmail ? (diffcheckerEmail.value || '').trim() : '';
    if (!email) {
      showError('Please enter your email above. The Diffchecker API requires it for Semantic comparison.');
      return;
    }
    if (semanticFilename1El) semanticFilename1El.textContent = file1Object.name;
    if (semanticFilename2El) semanticFilename2El.textContent = file2Object.name;
    setLoading(true);
    if (semanticPanelsWrap) semanticPanelsWrap.hidden = true;
    if (semanticDiffApi) semanticDiffApi.hidden = true;
    if (semanticDiffApiContent) semanticDiffApiContent.innerHTML = '';
    if (semanticDiffApiStyle) semanticDiffApiStyle.textContent = '';

    fetchDiffcheckerPdf(file1Object, file2Object, email)
      .then(function (result) {
        if (semanticDiffApiStyle) {
          semanticDiffApiStyle.textContent = (result.css || '') +
            '\n\n/* Force readable text (black on white) */\n' +
            '.semantic-diff-api-content, .semantic-diff-api-content * { color: #1a1a1a !important; }\n';
        }
        if (semanticDiffApiContent) semanticDiffApiContent.innerHTML = result.html || '';
        if (semanticDiffApi) semanticDiffApi.hidden = false;
        updateSemanticReportFromApi(result.added, result.removed);
        cachedSemantic = {
          type: 'api',
          html: result.html,
          css: result.css,
          added: result.added,
          removed: result.removed
        };
      })
      .catch(function (e) {
        showError(e && e.message ? e.message : 'Semantic comparison failed. The Diffchecker API may be unavailable or CORS may block this request.');
        if (semanticPanelsWrap) semanticPanelsWrap.hidden = false;
      })
      .finally(function () { setLoading(false); });
  }

  function updateSemanticReportFromApi(added, removed) {
    if (changeReportCountEl) {
      var total = (added != null && removed != null) ? (added + removed) : 0;
      changeReportCountEl.textContent = '(' + total + ')';
    }
    if (reportOldDiffEl) reportOldDiffEl.textContent = removed != null ? '−' + removed : '−0';
    if (reportNewDiffEl) reportNewDiffEl.textContent = added != null ? '+' + added : '+0';
  }

  // Semantic scroll sync (used when canvas panels are shown; hidden when using API diff)
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

  function restoreSemantic() {
    if (!cachedSemantic || cachedSemantic.type !== 'api') return;
    if (file1Object) semanticFilename1El.textContent = file1Object.name;
    if (file2Object) semanticFilename2El.textContent = file2Object.name;
    if (semanticPanelsWrap) semanticPanelsWrap.hidden = true;
    if (semanticDiffApiStyle) {
      semanticDiffApiStyle.textContent = (cachedSemantic.css || '') +
        '\n\n/* Force readable text (black on white) */\n' +
        '.semantic-diff-api-content, .semantic-diff-api-content * { color: #1a1a1a !important; }\n';
    }
    if (semanticDiffApiContent) semanticDiffApiContent.innerHTML = cachedSemantic.html || '';
    if (semanticDiffApi) semanticDiffApi.hidden = false;
    updateSemanticReportFromApi(cachedSemantic.added, cachedSemantic.removed);
  }

  // Download report
  downloadReportBtn.addEventListener('click', function () {
    var remWords = 0, addWords = 0;
    if (cachedSemantic && cachedSemantic.type === 'api') {
      remWords = cachedSemantic.removed != null ? cachedSemantic.removed : 0;
      addWords = cachedSemantic.added != null ? cachedSemantic.added : 0;
    } else {
      if (!semanticResultsByPage.length) return;
      semanticResultsByPage.forEach(function (p) {
        if (p.removedWordCount != null && p.addedWordCount != null) {
          remWords += p.removedWordCount;
          addWords += p.addedWordCount;
        }
      });
    }
    var lines = [
      'PDF Comparison Report (Semantic Text – Diffchecker API)',
      'Original: ' + (file1Object ? file1Object.name : 'PDF 1'),
      'Modified: ' + (file2Object ? file2Object.name : 'PDF 2'),
      '',
      'Summary:',
      '  Words removed (red): ' + remWords,
      '  Words added (green): ' + addWords,
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
