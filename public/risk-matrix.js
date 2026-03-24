/* ------------------------------------------------------------------ */
/*  ICAO 5x5 Risk Matrix Widget                                      */
/*  Usage: createRiskMatrix(container, { probability, severity,       */
/*         readOnly, onChange })                                       */
/* ------------------------------------------------------------------ */
(function () {
  'use strict';

  /* ---- inject styles once ---- */
  var STYLE_ID = 'risk-matrix-styles';
  if (!document.getElementById(STYLE_ID)) {
    var css = [
      '.risk-matrix { display:inline-block; border-collapse:collapse; user-select:none; }',
      '.risk-matrix td, .risk-matrix th { text-align:center; padding:0; margin:0; }',
      '.risk-matrix th { font-size:.75rem; font-weight:600; padding:4px 6px; color:var(--text,#333); }',
      '.risk-matrix th.rm-row-hdr { text-align:right; padding-right:8px; white-space:nowrap; }',
      '.risk-matrix th.rm-col-hdr { padding-bottom:4px; font-size:.7rem; max-width:60px; word-wrap:break-word; }',
      '.risk-matrix th.rm-corner { }',
      '.risk-cell { width:44px; height:44px; border:2px solid rgba(255,255,255,.25); border-radius:4px; cursor:pointer; transition:transform .1s,box-shadow .1s; position:relative; font-size:.7rem; font-weight:700; color:#fff; }',
      '.risk-cell:hover { transform:scale(1.12); z-index:1; box-shadow:0 0 6px rgba(0,0,0,.3); }',
      '.risk-matrix.read-only .risk-cell { cursor:default; }',
      '.risk-matrix.read-only .risk-cell:hover { transform:none; box-shadow:none; }',
      '.risk-cell--green  { background:#22c55e; }',
      '.risk-cell--amber  { background:#eab308; }',
      '.risk-cell--orange { background:#f97316; }',
      '.risk-cell--red    { background:#ef4444; }',
      '.risk-cell--selected { outline:3px solid var(--text,#111); outline-offset:-1px; transform:scale(1.12); z-index:2; box-shadow:0 0 8px rgba(0,0,0,.35); }',
      '.risk-matrix.read-only .risk-cell--selected { transform:none; box-shadow:none; }',
      '@media(prefers-color-scheme:dark){ .risk-cell--selected{outline-color:#fff;} .risk-matrix th{color:#ddd;} }'
    ].join('\n');
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---- constants ---- */
  // Y-axis: Wahrscheinlichkeit (rows, top=5 to bottom=1)
  var PROB_ROWS = [
    { label: '5 - Häufig',              value: 5 },
    { label: '4 - Gelegentlich',        value: 4 },
    { label: '3 - Gering',              value: 3 },
    { label: '2 - Unwahrscheinlich',    value: 2 },
    { label: '1 - Extrem unwahrsch.',   value: 1 }
  ];
  // X-axis: Schwere (columns, left=1 to right=5)
  var SEV_COLS = [
    { label: '1\nGeringfügig', value: 1 },
    { label: '2\nGering',      value: 2 },
    { label: '3\nBedeutend',   value: 3 },
    { label: '4\nGefährlich',  value: 4 },
    { label: '5\nKatastrophal', value: 5 }
  ];

  function colorClass(p, s) {
    var score = p * s;
    if (score >= 12) return 'risk-cell--red';
    if (score >= 4)  return 'risk-cell--amber';
    return 'risk-cell--green';
  }

  function riskLevel(score) {
    if (score >= 12) return 'Nicht akzeptabel';
    if (score >= 4)  return 'Akzeptabel';
    return 'Gering oder kein Risiko';
  }

  window.riskLevel = riskLevel;

  /* ---- public factory ---- */
  window.createRiskMatrix = function (container, opts) {
    opts = opts || {};
    var prob     = opts.probability || null;
    var sev      = opts.severity    || null;
    var readOnly = !!opts.readOnly;
    var onChange  = typeof opts.onChange === 'function' ? opts.onChange : null;
    var cells    = {};  // key "p,s" -> td element

    /* build table */
    var table = document.createElement('table');
    table.className = 'risk-matrix' + (readOnly ? ' read-only' : '');

    /* header row: Schwere columns (1-5) */
    var thead = document.createElement('thead');
    var hRow  = document.createElement('tr');
    var corner = document.createElement('th');
    corner.className = 'rm-corner';
    hRow.appendChild(corner);
    SEV_COLS.forEach(function (col) {
      var th = document.createElement('th');
      th.className = 'rm-col-hdr';
      th.innerHTML = col.label.replace(/\n/g, '<br>');
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    /* body: Wahrscheinlichkeit rows (5-1) */
    var tbody = document.createElement('tbody');
    PROB_ROWS.forEach(function (row) {
      var tr = document.createElement('tr');
      var th = document.createElement('th');
      th.className = 'rm-row-hdr';
      th.textContent = row.label;
      tr.appendChild(th);

      SEV_COLS.forEach(function (col) {
        var td = document.createElement('td');
        var score = row.value * col.value;
        td.className = 'risk-cell ' + colorClass(row.value, col.value);
        td.textContent = score;
        td.dataset.prob = row.value;
        td.dataset.sev  = col.value;
        cells[row.value + ',' + col.value] = td;

        if (!readOnly) {
          td.addEventListener('click', function () {
            select(row.value, col.value);
            if (onChange) onChange({ probability: prob, severity: sev });
          });
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);

    /* highlight helper */
    function clearSelection() {
      Object.keys(cells).forEach(function (k) {
        cells[k].classList.remove('risk-cell--selected');
      });
    }
    function select(p, s) {
      clearSelection();
      prob = p;
      sev  = s;
      var cell = cells[p + ',' + s];
      if (cell) cell.classList.add('risk-cell--selected');
    }

    /* apply initial selection */
    if (prob && sev) select(prob, sev);

    /* public API */
    return {
      getValues: function () {
        return { probability: prob, severity: sev, score: prob && sev ? prob * sev : null };
      },
      setValues: function (p, s) {
        select(p, s);
      },
      destroy: function () {
        container.removeChild(table);
      }
    };
  };
})();
