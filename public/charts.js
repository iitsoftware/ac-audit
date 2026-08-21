/* ------------------------------------------------------------------ */
/*  Dashboard-Charts — handgeschriebenes SVG, keine Dependency         */
/*                                                                      */
/*  createDonutChart(container, opts)   Anteile + Legende               */
/*  createBarChart(container, opts)     Kategorien mit Werten           */
/*  createProgressBar(container, opts)  Wert gegen Zielwert             */
/*                                                                      */
/*  Idiom von public/risk-matrix.js: eine IIFE, die Styles einmalig     */
/*  injiziert und Factories an window hängt, die einen Knoten in den    */
/*  übergebenen Container schreiben und { setData, destroy } liefern.   */
/* ------------------------------------------------------------------ */
(function () {
  'use strict';

  /* ---- inject styles once ---- */
  // Die Chart-KARTE (Rahmen, Gitter, Überschrift der Dashboard-Kacheln) gehört
  // nicht hierher, die wohnt in style.css. Hier steht nur, was das Widget
  // selbst zum Funktionieren braucht — Legende, Zahlen, leerer Zustand —,
  // damit ein Aufrufer es ohne Stylesheet-Änderung einsetzen kann. Alle Farben
  // kommen aus den :root-Variablen, damit der Dunkelmodus ohne eigene
  // Media-Query mitzieht.
  var STYLE_ID = 'charts-styles';
  if (!document.getElementById(STYLE_ID)) {
    var css = [
      '.chart { display:flex; flex-direction:column; gap:10px; min-width:0; }',
      '.chart-title { font-size:.85rem; font-weight:600; color:var(--text,#1e293b); }',
      '.chart-body { display:flex; align-items:center; gap:16px; flex-wrap:wrap; min-width:0; }',
      '.chart-svg { display:block; overflow:visible; }',
      '.chart-empty { font-size:.8rem; color:var(--text-muted,#64748b); font-style:italic; padding:8px 0; }',
      // flex-basis 120px statt flex:1: in einer schmalen Chart-Karte rutscht die
      // Legende unter den Donut, statt auf die Breite ihrer Wertespalten
      // zusammengedrückt zu werden — dort blieb von "überfällig" ein "ü…" übrig.
      '.chart-legend { list-style:none; display:flex; flex-direction:column; gap:6px; min-width:0; flex:1 1 120px; }',
      '.chart-legend li { display:flex; align-items:baseline; gap:8px; font-size:.8rem; color:var(--text,#1e293b); min-width:0; }',
      '.chart-legend .chart-swatch { width:10px; height:10px; border-radius:2px; flex:none; }',
      // Die Kategorie bricht um, statt gekürzt zu werden: ihr Name ist das, was
      // die Legende überhaupt zu sagen hat. overflow-wrap fängt den Fall ab,
      // dass ein einzelnes Wort (ein Change-Request-Status) breiter ist als die
      // Spalte und sonst über die Kachel hinausliefe.
      '.chart-legend .chart-legend-label { flex:1; min-width:0; overflow-wrap:anywhere; }',
      '.chart-legend .chart-legend-value { font-variant-numeric:tabular-nums; font-weight:600; flex:none; }',
      '.chart-legend .chart-legend-pct { font-variant-numeric:tabular-nums; color:var(--text-muted,#64748b); flex:none; }',
      '.chart-progress-caption { display:flex; align-items:baseline; justify-content:space-between; gap:12px; font-size:.8rem; color:var(--text-muted,#64748b); }',
      '.chart-progress-caption .chart-progress-value { font-variant-numeric:tabular-nums; font-weight:600; color:var(--text,#1e293b); }'
    ].join('\n');
    var styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* ---- Farbpalette ---- */
  // Benannte Farben statt Hex-Literale im Aufrufer: das Dashboard sagt
  // CHART_COLORS.danger für "überfällig" und muss nicht wissen, welches Rot
  // das Haus fährt. Die Töne sind die von risk-matrix.js, damit zwei
  // handgeschriebene Widgets derselben App nicht zwei Paletten tragen.
  var CHART_COLORS = {
    info: '#2563eb',
    ok: '#22c55e',
    warn: '#eab308',
    attention: '#f97316',
    danger: '#ef4444',
    muted: '#94a3b8'
  };
  window.CHART_COLORS = CHART_COLORS;

  // Fallback für Aufrufer, die keine Farbe mitgeben — etwa Change Requests
  // nach Status, wo erst die Daten entscheiden, welche Kategorien es gibt.
  var PALETTE = [
    CHART_COLORS.info,
    CHART_COLORS.attention,
    CHART_COLORS.ok,
    CHART_COLORS.warn,
    '#a855f7',
    '#14b8a6',
    CHART_COLORS.danger,
    CHART_COLORS.muted
  ];

  function paletteColor(item, index) {
    return (item && item.color) || PALETTE[index % PALETTE.length];
  }

  /* ---- kleine DOM-Helfer ---- */
  function svgEl(name, attrs) {
    var node = document.createElementNS(SVG_NS, name);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        node.setAttribute(key, attrs[key]);
      });
    }
    return node;
  }

  function htmlEl(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    // Durchweg textContent und nie innerHTML: Kategorien kommen aus der
    // Datenbank (Change-Request-Status, Abteilungsnamen) und sind damit
    // Benutzereingabe.
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function svgText(x, y, text, attrs) {
    var node = svgEl('text', attrs);
    node.setAttribute('x', x);
    node.setAttribute('y', y);
    node.textContent = String(text);
    return node;
  }

  /* ---- Zahlen ---- */
  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  function fmtNum(value) {
    return toNumber(value).toLocaleString('de-DE');
  }

  // Gerundete Prozente können sich auf 99 oder 101 summieren. Das ist in einer
  // Legende hinnehmbar, weil daneben der absolute Wert steht — der ist die
  // Aussage, der Prozentsatz die Einordnung.
  function fmtPct(value, total) {
    if (!total) return '';
    return Math.round((toNumber(value) / total) * 100) + ' %';
  }

  function sumValues(items) {
    return items.reduce(function (sum, item) {
      return sum + toNumber(item.value);
    }, 0);
  }

  // Ein Aufrufer darf null/undefined durchreichen (ein Endpunkt, der noch
  // lädt, oder eine Abteilung ohne Sicherheitsjahr) — das ist ein Zustand und
  // kein Fehler, also normalisieren statt werfen.
  function normalizeItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map(function (item) {
      return {
        label: item && item.label !== undefined && item.label !== null ? String(item.label) : '',
        value: toNumber(item && item.value),
        color: item && item.color
      };
    });
  }

  /* ---- gemeinsamer Rahmen ---- */
  // Titel + Körper + der eine leere Zustand für alle drei Helfer. Ohne ihn
  // stünde die "keine Daten"-Regel dreimal im Modul und driftete beim ersten
  // Nachbessern auseinander.
  function createFrame(container, opts, extraClass) {
    var root = htmlEl('div', 'chart' + (extraClass ? ' ' + extraClass : ''));
    if (opts.title) root.appendChild(htmlEl('h3', 'chart-title', opts.title));
    var body = htmlEl('div', 'chart-body');
    root.appendChild(body);
    container.appendChild(root);

    return {
      root: root,
      body: body,
      clear: function () {
        while (body.firstChild) body.removeChild(body.firstChild);
      },
      empty: function () {
        body.appendChild(htmlEl('div', 'chart-empty', opts.emptyText || 'Keine Daten vorhanden'));
      },
      destroy: function () {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  // Zusammenfassung für Screenreader: das SVG selbst ist für sie stumm, also
  // trägt der Knoten die Kategorien als Text — dieselbe Information, die das
  // Auge aus dem Bild liest.
  function ariaSummary(title, items, total) {
    var parts = items.map(function (item) {
      return item.label + ': ' + fmtNum(item.value);
    });
    var prefix = title ? title + '. ' : '';
    return prefix + 'Gesamt ' + fmtNum(total) + '. ' + parts.join(', ');
  }

  /* ------------------------------------------------------------------ */
  /*  Donut — Anteile mit Legende (z. B. CAP-Fristen)                    */
  /* ------------------------------------------------------------------ */
  // Gezeichnet als EIN Kreis je Segment mit stroke-dasharray statt als
  // Bogen-Pfad: der Vollkreis (ein Topf trägt alles) ist damit der Normalfall
  // und keine Sonderbehandlung — ein <path> mit dem A-Kommando zeichnet bei
  // identischem Start- und Endpunkt gar nichts.
  window.createDonutChart = function (container, opts) {
    opts = opts || {};
    var size = opts.size || 140;
    var thickness = opts.thickness || 18;
    var radius = (size - thickness) / 2;
    var circumference = 2 * Math.PI * radius;
    var center = size / 2;
    var showLegend = opts.legend !== false;

    var frame = createFrame(container, opts, 'chart-donut');

    function render(items) {
      frame.clear();
      var data = normalizeItems(items);
      var total = sumValues(data);
      if (!data.length || total <= 0) {
        frame.empty();
        return;
      }

      var svg = svgEl('svg', {
        'class': 'chart-svg',
        viewBox: '0 0 ' + size + ' ' + size,
        width: size,
        height: size,
        role: 'img',
        'aria-label': ariaSummary(opts.title, data, total)
      });

      // Bei 12 Uhr beginnen und im Uhrzeigersinn laufen.
      var ring = svgEl('g', { transform: 'rotate(-90 ' + center + ' ' + center + ')' });

      ring.appendChild(svgEl('circle', {
        cx: center, cy: center, r: radius,
        fill: 'none',
        stroke: 'var(--border, #e2e8f0)',
        'stroke-width': thickness
      }));

      var offset = 0;
      data.forEach(function (item, index) {
        // Ein Topf mit 0 bleibt in der Legende stehen, wird aber nicht
        // gezeichnet: eine Kategorie darf nicht verschwinden, nur weil sie
        // gerade leer ist, und ein Segment der Länge 0 wäre trotzdem ein
        // sichtbarer Strich.
        if (item.value <= 0) return;
        var length = (item.value / total) * circumference;
        ring.appendChild(svgEl('circle', {
          cx: center, cy: center, r: radius,
          fill: 'none',
          stroke: paletteColor(item, index),
          'stroke-width': thickness,
          'stroke-linecap': 'butt',
          'stroke-dasharray': length + ' ' + (circumference - length),
          'stroke-dashoffset': -offset
        }));
        offset += length;
      });
      svg.appendChild(ring);

      // Mitte: die Gesamtzahl, darunter ihr Substantiv ("offene CAPs").
      var hasCaption = !!opts.centerLabel;
      svg.appendChild(svgText(center, hasCaption ? center - 2 : center + 6, fmtNum(total), {
        'text-anchor': 'middle',
        'font-size': '22',
        'font-weight': '700',
        fill: 'var(--text, #1e293b)'
      }));
      if (hasCaption) {
        svg.appendChild(svgText(center, center + 16, opts.centerLabel, {
          'text-anchor': 'middle',
          'font-size': '11',
          fill: 'var(--text-muted, #64748b)'
        }));
      }
      frame.body.appendChild(svg);

      if (showLegend) {
        var legend = htmlEl('ul', 'chart-legend');
        data.forEach(function (item, index) {
          var li = htmlEl('li');
          var swatch = htmlEl('span', 'chart-swatch');
          swatch.style.background = paletteColor(item, index);
          li.appendChild(swatch);
          li.appendChild(htmlEl('span', 'chart-legend-label', item.label));
          li.appendChild(htmlEl('span', 'chart-legend-value', fmtNum(item.value)));
          li.appendChild(htmlEl('span', 'chart-legend-pct', fmtPct(item.value, total)));
          legend.appendChild(li);
        });
        // Die Legende wiederholt, was das aria-label des SVG schon sagt.
        frame.body.appendChild(legend);
        legend.setAttribute('aria-hidden', 'true');
      }
    }

    render(opts.data);

    return {
      setData: function (items) { render(items); },
      destroy: frame.destroy
    };
  };

  /* ------------------------------------------------------------------ */
  /*  Balken — Kategorien mit Werten (z. B. Findings nach Level)          */
  /* ------------------------------------------------------------------ */
  window.createBarChart = function (container, opts) {
    opts = opts || {};
    var vertical = opts.orientation === 'vertical';
    var width = opts.width || 320;
    var frame = createFrame(container, opts, 'chart-bar');

    function render(items) {
      frame.clear();
      var data = normalizeItems(items);
      var total = sumValues(data);
      if (!data.length || total <= 0) {
        frame.empty();
        return;
      }

      // Skaliert wird auf den größten Wert, nicht auf die Summe: der Balken
      // zeigt den Vergleich der Kategorien, nicht ihren Anteil — dafür ist
      // der Donut da.
      var max = data.reduce(function (m, item) { return Math.max(m, item.value); }, 0);
      var svg = vertical ? renderVertical(data, max, width) : renderHorizontal(data, max, width);
      svg.setAttribute('class', 'chart-svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', ariaSummary(opts.title, data, total));
      frame.body.appendChild(svg);
    }

    function renderHorizontal(data, max, w) {
      var labelW = opts.labelWidth || 104;
      var valueW = 40;
      var rowH = 24;
      var gap = 6;
      var trackX = labelW;
      var trackW = Math.max(20, w - labelW - valueW);
      var height = data.length * rowH + (data.length - 1) * gap;

      var svg = svgEl('svg', {
        viewBox: '0 0 ' + w + ' ' + height,
        width: '100%',
        height: height
      });

      data.forEach(function (item, index) {
        var y = index * (rowH + gap);
        var barH = 14;
        var barY = y + (rowH - barH) / 2;
        var barW = max > 0 ? (item.value / max) * trackW : 0;

        svg.appendChild(svgText(labelW - 8, barY + barH - 2, item.label, {
          'text-anchor': 'end',
          'font-size': '11',
          fill: 'var(--text, #1e293b)'
        }));
        svg.appendChild(svgEl('rect', {
          x: trackX, y: barY, width: trackW, height: barH,
          rx: 3, fill: 'var(--border, #e2e8f0)'
        }));
        // Ein Wert 0 bekommt keinen Balken, seine Zeile und seine 0 bleiben
        // aber stehen — dieselbe Regel wie beim Donut.
        if (barW > 0) {
          svg.appendChild(svgEl('rect', {
            x: trackX, y: barY, width: barW, height: barH,
            rx: 3, fill: paletteColor(item, index)
          }));
        }
        svg.appendChild(svgText(trackX + trackW + 8, barY + barH - 2, fmtNum(item.value), {
          'font-size': '11',
          'font-weight': '600',
          fill: 'var(--text, #1e293b)'
        }));
      });
      return svg;
    }

    function renderVertical(data, max, w) {
      var topPad = 16;      // Platz für die Wertebeschriftung über dem Balken
      var plotH = opts.plotHeight || 96;
      var labelH = 18;
      var height = topPad + plotH + labelH;
      var slot = w / data.length;
      var barW = Math.min(opts.barWidth || 34, slot * 0.6);
      var baseY = topPad + plotH;

      var svg = svgEl('svg', {
        viewBox: '0 0 ' + w + ' ' + height,
        width: '100%',
        height: height
      });

      data.forEach(function (item, index) {
        var cx = slot * index + slot / 2;
        var barH = max > 0 ? (item.value / max) * plotH : 0;

        svg.appendChild(svgEl('rect', {
          x: cx - barW / 2, y: topPad, width: barW, height: plotH,
          rx: 3, fill: 'var(--border, #e2e8f0)'
        }));
        if (barH > 0) {
          svg.appendChild(svgEl('rect', {
            x: cx - barW / 2, y: baseY - barH, width: barW, height: barH,
            rx: 3, fill: paletteColor(item, index)
          }));
        }
        svg.appendChild(svgText(cx, baseY - barH - 5, fmtNum(item.value), {
          'text-anchor': 'middle',
          'font-size': '11',
          'font-weight': '600',
          fill: 'var(--text, #1e293b)'
        }));
        svg.appendChild(svgText(cx, baseY + 13, item.label, {
          'text-anchor': 'middle',
          'font-size': '11',
          fill: 'var(--text-muted, #64748b)'
        }));
      });

      // Grundlinie, damit die Balken auf etwas stehen.
      svg.appendChild(svgEl('line', {
        x1: 0, y1: baseY + 0.5, x2: w, y2: baseY + 0.5,
        stroke: 'var(--border, #e2e8f0)', 'stroke-width': 1
      }));
      return svg;
    }

    render(opts.data);

    return {
      setData: function (items) { render(items); },
      destroy: frame.destroy
    };
  };

  /* ------------------------------------------------------------------ */
  /*  Fortschritt — Wert gegen Zielwert (z. B. geplant vs. durchgeführt)  */
  /* ------------------------------------------------------------------ */
  window.createProgressBar = function (container, opts) {
    opts = opts || {};
    var width = opts.width || 320;
    var barH = opts.height || 12;
    var frame = createFrame(container, opts, 'chart-progress');
    // Der Körper stapelt hier statt nebeneinander zu laufen: Balken oben,
    // Beschriftung darunter.
    frame.body.style.flexDirection = 'column';
    frame.body.style.alignItems = 'stretch';

    function render(data) {
      frame.clear();
      data = data || {};
      var value = toNumber(data.value);
      var max = toNumber(data.max);
      if (max <= 0) {
        frame.empty();
        return;
      }

      // Mehr durchgeführt als geplant ist ein echter Zustand (ein anlassbezogenes
      // Audit zählt mit, stand aber in keinem Plan): der Balken wird bei 100 %
      // gekappt, die Beschriftung nennt trotzdem die wahren Zahlen.
      var ratio = Math.min(1, Math.max(0, value / max));
      var fillW = ratio * width;
      var label = opts.valueLabel || (fmtNum(value) + ' / ' + fmtNum(max));

      var svg = svgEl('svg', {
        'class': 'chart-svg',
        viewBox: '0 0 ' + width + ' ' + barH,
        width: '100%',
        height: barH,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': (opts.title ? opts.title + ': ' : '') + label +
          ' (' + Math.round(ratio * 100) + ' %)'
      });
      svg.appendChild(svgEl('rect', {
        x: 0, y: 0, width: width, height: barH,
        rx: barH / 2, fill: 'var(--border, #e2e8f0)'
      }));
      if (fillW > 0) {
        svg.appendChild(svgEl('rect', {
          x: 0, y: 0, width: fillW, height: barH,
          rx: barH / 2, fill: opts.color || CHART_COLORS.info
        }));
      }
      frame.body.appendChild(svg);

      var caption = htmlEl('div', 'chart-progress-caption');
      caption.appendChild(htmlEl('span', null, opts.caption || ''));
      var right = htmlEl('span', 'chart-progress-value', label);
      caption.appendChild(right);
      caption.setAttribute('aria-hidden', 'true');
      frame.body.appendChild(caption);
    }

    render(opts.data);

    return {
      setData: function (data) { render(data); },
      destroy: frame.destroy
    };
  };
})();
