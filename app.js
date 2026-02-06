/**
 * PDF Pixel Comparison Tool
 * Client-side only: compares two PDFs and shows black/white/red overlay.
 * Files never leave the browser.
 */

(function () {
  'use strict';

  // PDF.js: set worker before any getDocument calls
  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const DPI_SCALE = 1.5; // ~108 DPI at 72 base
  const WHITE_THRESHOLD = 250;

  // DOM elements
  const zone1 = document.getElementById('zone1');
  const zone2 = document.getElementById('zone2');
  const fileInput1 = document.getElementById('file1');
  const fileInput2 = document.getElementById('file2');
  const filename1El = document.getElementById('filename1');
  const filename2El = document.getElementById('filename2');
  const compareBtn = document.getElementById('compareBtn');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const errorBanner = document.getElementById('errorBanner');
  const errorText = document.getElementById('errorText');
  const resultsSection = document.getElementById('resultsSection');
  const resultCanvas = document.getElementById('resultCanvas');
  const matchPercentEl = document.getElementById('matchPercent');
  const statsDetailEl = document.getElementById('statsDetail');
  const zoomValueEl = document.getElementById('zoomValue');
  const zoomInBtn = document.getElementById('zoomIn');
  const zoomOutBtn = document.getElementById('zoomOut');
  const canvasWrapper = document.getElementById('canvasWrapper');
  const prevPageBtn = document.getElementById('prevPage');
  const nextPageBtn = document.getElementById('nextPage');
  const pageInfoEl = document.getElementById('pageInfo');
  const downloadBtn = document.getElementById('downloadBtn');

  // State
  let pdfDoc1 = null;
  let pdfDoc2 = null;
  let file1Object = null;
  let file2Object = null;
  let totalPages = 0;
  let currentPageIndex = 0; // 0-based
  let resultCanvases = []; // one canvas per page for download
  let zoomLevel = 1;

  function clearError() {
    errorBanner.hidden = true;
    errorText.textContent = '';
  }

  function showError(message) {
    errorText.textContent = message;
    errorBanner.hidden = false;
  }

  function setLoading(visible) {
    loadingOverlay.classList.toggle('visible', visible);
  }

  function isPdfFile(file) {
    if (!file || !file.name) return false;
    const name = file.name.toLowerCase();
    return name.endsWith('.pdf') || file.type === 'application/pdf';
  }

  function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  function loadPdf(file, which) {
    if (!isPdfFile(file)) {
      showError('Please select a PDF file (extension .pdf).');
      return;
    }
    clearError();
    resultsSection.hidden = true; // clear previous comparison when new file selected
    setLoading(true);
    readFileAsArrayBuffer(file)
      .then(function (data) {
        const loadingTask = pdfjsLib.getDocument({ data: data });
        return loadingTask.promise;
      })
      .then(function (pdf) {
        if (which === 1) {
          pdfDoc1 = pdf;
          file1Object = file;
          filename1El.textContent = file.name;
          zone1.classList.add('has-file');
        } else {
          pdfDoc2 = pdf;
          file2Object = file;
          filename2El.textContent = file.name;
          zone2.classList.add('has-file');
        }
        updateCompareButton();
      })
      .catch(function (err) {
        const msg =
          err?.message || ''
            .toLowerCase()
            .includes('password')
            ? 'This PDF may be password-protected or corrupted. Try another file.'
            : 'Failed to load PDF. The file may be corrupted or invalid.';
        showError(msg);
        if (which === 1) {
          pdfDoc1 = null;
          file1Object = null;
          filename1El.textContent = '';
          zone1.classList.remove('has-file');
        } else {
          pdfDoc2 = null;
          file2Object = null;
          filename2El.textContent = '';
          zone2.classList.remove('has-file');
        }
        updateCompareButton();
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function updateCompareButton() {
    compareBtn.disabled = !(pdfDoc1 && pdfDoc2);
  }

  function setupUploadZone(zoneEl, inputEl, filenameEl, which) {
    zoneEl.addEventListener('click', function (e) {
      if (!e.target.classList.contains('browse-btn')) return;
      inputEl.click();
    });

    zoneEl.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.add('drag-over');
    });
    zoneEl.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.remove('drag-over');
    });
    zoneEl.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      zoneEl.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file) loadPdf(file, which);
    });

    inputEl.addEventListener('change', function () {
      const file = inputEl.files?.[0];
      if (file) loadPdf(file, which);
    });
  }

  setupUploadZone(zone1, fileInput1, filename1El, 1);
  setupUploadZone(zone2, fileInput2, filename2El, 2);

  /**
   * Render a single PDF page to a canvas at the given scale.
   * Returns Promise<{ canvas, width, height }>.
   */
  function renderPdfPage(pdfDoc, pageNum) {
    return pdfDoc.getPage(pageNum).then(function (page) {
      const viewport = page.getViewport({ scale: DPI_SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return page
        .render({
          canvasContext: ctx,
          viewport: viewport,
        })
        .promise.then(function () {
          return { canvas, width: canvas.width, height: canvas.height };
        });
    });
  }

  /**
   * Normalize two canvases to the same size (max width, max height),
   * white background, content pasted top-left.
   */
  function normalizeToSameSize(result1, result2) {
    const w = Math.max(result1.width, result2.width);
    const h = Math.max(result1.height, result2.height);

    function makeNormalized(src) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src.canvas, 0, 0);
      return c;
    }

    return {
      canvas1: makeNormalized(result1),
      canvas2: makeNormalized(result2),
      width: w,
      height: h,
    };
  }

  /**
   * Compare two same-size canvases pixel-by-pixel.
   * Returns { resultCanvas, stats: { total, match, white, diff } }.
   */
  function comparePixels(canvas1, canvas2, width, height) {
    const ctx1 = canvas1.getContext('2d');
    const ctx2 = canvas2.getContext('2d');
    const imageData1 = ctx1.getImageData(0, 0, width, height);
    const imageData2 = ctx2.getImageData(0, 0, width, height);
    const data1 = imageData1.data;
    const data2 = imageData2.data;

    const outCanvas = document.createElement('canvas');
    outCanvas.width = width;
    outCanvas.height = height;
    const outCtx = outCanvas.getContext('2d');
    const outImageData = outCtx.createImageData(width, height);
    const out = outImageData.data;

    let matchCount = 0;
    let whiteCount = 0;
    let diffCount = 0;

    for (let i = 0; i < data1.length; i += 4) {
      const r1 = data1[i];
      const g1 = data1[i + 1];
      const b1 = data1[i + 2];
      const r2 = data2[i];
      const g2 = data2[i + 1];
      const b2 = data2[i + 2];

      const bothWhite =
        r1 > WHITE_THRESHOLD &&
        g1 > WHITE_THRESHOLD &&
        b1 > WHITE_THRESHOLD &&
        r2 > WHITE_THRESHOLD &&
        g2 > WHITE_THRESHOLD &&
        b2 > WHITE_THRESHOLD;

      const exactMatch = r1 === r2 && g1 === g2 && b1 === b2;

      if (bothWhite) {
        out[i] = 255;
        out[i + 1] = 255;
        out[i + 2] = 255;
        whiteCount++;
        matchCount++;
      } else if (exactMatch) {
        const gray = Math.round(0.299 * r1 + 0.587 * g1 + 0.114 * b1);
        out[i] = gray;
        out[i + 1] = gray;
        out[i + 2] = gray;
        matchCount++;
      } else {
        out[i] = 255;
        out[i + 1] = 0;
        out[i + 2] = 0;
        diffCount++;
      }
      out[i + 3] = 255;
    }

    outCtx.putImageData(outImageData, 0, 0);

    const total = (width * height);
    return {
      resultCanvas: outCanvas,
      stats: {
        total,
        match: matchCount,
        white: whiteCount,
        diff: diffCount,
      },
    };
  }

  /**
   * Build comparison for one page (1-based page number).
   */
  function compareOnePage(pageNum) {
    return Promise.all([
      renderPdfPage(pdfDoc1, pageNum),
      renderPdfPage(pdfDoc2, pageNum),
    ]).then(function ([r1, r2]) {
      const { canvas1, canvas2, width, height } = normalizeToSameSize(r1, r2);
      const { resultCanvas: result, stats } = comparePixels(
        canvas1,
        canvas2,
        width,
        height
      );
      return { result, stats };
    });
  }

  function runComparison() {
    if (!pdfDoc1 || !pdfDoc2) return;
    clearError();
    setLoading(true);
    resultCanvases = [];
    currentPageIndex = 0;

    const numPages1 = pdfDoc1.numPages;
    const numPages2 = pdfDoc2.numPages;
    totalPages = Math.min(numPages1, numPages2);

    if (totalPages === 0) {
      setLoading(false);
      showError('No pages found in one or both PDFs.');
      return;
    }

    compareOnePage(1)
      .then(function (payload) {
        resultCanvases[0] = payload;
        resultCanvas.width = payload.result.width;
        resultCanvas.height = payload.result.height;
        resultCanvas.getContext('2d').drawImage(payload.result, 0, 0);
        updateStats(payload.stats);
        resultsSection.hidden = false;
        updatePageNav();
        zoomLevel = 1;
        applyZoom();
      })
      .catch(function (err) {
        showError(
          err?.message || 'Something went wrong while comparing. Try different PDFs.'
        );
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function updateStats(stats) {
    const pct =
      stats.total > 0
        ? ((stats.match / stats.total) * 100).toFixed(2)
        : '0';
    matchPercentEl.textContent = pct + '%';
    statsDetailEl.textContent =
      stats.total.toLocaleString() +
      ' pixels total · ' +
      stats.match.toLocaleString() +
      ' match · ' +
      stats.diff.toLocaleString() +
      ' differ';
  }

  function updatePageNav() {
    pageInfoEl.textContent = 'Page ' + (currentPageIndex + 1) + ' of ' + totalPages;
    prevPageBtn.disabled = currentPageIndex <= 0;
    nextPageBtn.disabled = currentPageIndex >= totalPages - 1;
  }

  function showPage(pageIndex) {
    if (pageIndex < 0 || pageIndex >= totalPages) return;
    currentPageIndex = pageIndex;
    const pageNum = pageIndex + 1;

    if (resultCanvases[pageIndex]) {
      const payload = resultCanvases[pageIndex];
      resultCanvas.width = payload.result.width;
      resultCanvas.height = payload.result.height;
      resultCanvas.getContext('2d').drawImage(payload.result, 0, 0);
      updateStats(payload.stats);
      applyZoom();
    } else {
      setLoading(true);
      compareOnePage(pageNum)
        .then(function (payload) {
          resultCanvases[pageIndex] = payload;
          resultCanvas.width = payload.result.width;
          resultCanvas.height = payload.result.height;
          resultCanvas.getContext('2d').drawImage(payload.result, 0, 0);
          updateStats(payload.stats);
          applyZoom();
        })
        .catch(function (err) {
          showError(err?.message || 'Failed to compare this page.');
        })
        .finally(function () {
          setLoading(false);
        });
    }
    updatePageNav();
  }

  prevPageBtn.addEventListener('click', function () {
    if (currentPageIndex > 0) showPage(currentPageIndex - 1);
  });
  nextPageBtn.addEventListener('click', function () {
    if (currentPageIndex < totalPages - 1) showPage(currentPageIndex + 1);
  });

  function applyZoom() {
    zoomValueEl.textContent = Math.round(zoomLevel * 100) + '%';
    if (canvasWrapper && resultCanvas.width && resultCanvas.height) {
      canvasWrapper.style.width = Math.round(resultCanvas.width * zoomLevel) + 'px';
      canvasWrapper.style.height = Math.round(resultCanvas.height * zoomLevel) + 'px';
    }
  }

  zoomInBtn.addEventListener('click', function () {
    zoomLevel = Math.min(3, zoomLevel + 0.25);
    applyZoom();
  });
  zoomOutBtn.addEventListener('click', function () {
    zoomLevel = Math.max(0.5, zoomLevel - 0.25);
    applyZoom();
  });

  compareBtn.addEventListener('click', runComparison);

  downloadBtn.addEventListener('click', function () {
    if (totalPages === 0) return;
    downloadBtn.disabled = true;
    setLoading(true);

    function ensureAllPages() {
      const promises = [];
      for (let i = 0; i < totalPages; i++) {
        if (resultCanvases[i]) promises.push(Promise.resolve(resultCanvases[i]));
        else promises.push(compareOnePage(i + 1));
      }
      return Promise.all(promises);
    }

    ensureAllPages()
      .then(function (payloads) {
        resultCanvases = payloads;
        const { jsPDF } = window.jspdf;
        const first = payloads[0].result;
        const doc = new jsPDF({
          orientation: first.width > first.height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [first.width, first.height],
        });

        doc.addImage(
          first.toDataURL('image/png'),
          'PNG',
          0,
          0,
          first.width,
          first.height,
          undefined,
          'FAST'
        );

        for (let i = 1; i < payloads.length; i++) {
          const c = payloads[i].result;
          doc.addPage([c.width, c.height], 'p');
          doc.addImage(
            c.toDataURL('image/png'),
            'PNG',
            0,
            0,
            c.width,
            c.height,
            undefined,
            'FAST'
          );
        }

        doc.save('comparison_doc.pdf');
      })
      .catch(function (err) {
        showError(err?.message || 'Failed to generate PDF download.');
      })
      .finally(function () {
        setLoading(false);
        downloadBtn.disabled = false;
      });
  });

  // Clear previous results when new files are selected (optional: clear on new file)
  fileInput1.addEventListener('change', hideResultsIfCleared);
  fileInput2.addEventListener('change', hideResultsIfCleared);

  function hideResultsIfCleared() {
    if (!pdfDoc1 || !pdfDoc2) resultsSection.hidden = true;
  }
})();
