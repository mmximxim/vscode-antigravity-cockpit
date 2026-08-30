/**
 * Antigravity Cockpit - Stats Tab
 * Chart rendering and interaction for the analytics dashboard.
 */
(function () {
    'use strict';

    // ─── State ───────────────────────────────────────────────────
    let vscode = window.__vscodeApi || (window.__vscodeApi = acquireVsCodeApi());
    let currentRange = '7d';
    let statsData = null;
    let trendChart = null;
    let donutChart = null;
    let hiddenModels = new Set();

    // ─── Tooltip ─────────────────────────────────────────────────
    let tooltipEl = null;
    function getTooltip() {
        if (!tooltipEl) {
            tooltipEl = document.getElementById('stats-global-tooltip');
            if (!tooltipEl) {
                tooltipEl = document.createElement('div');
                tooltipEl.className = 'stats-tooltip';
                document.body.appendChild(tooltipEl);
            }
        }
        return tooltipEl;
    }

    function showTooltip(e, text) {
        let tooltip = getTooltip();
        tooltip.innerHTML = text;
        tooltip.classList.add('visible');

        let tooltipWidth = tooltip.offsetWidth || 140;
        let tooltipHeight = tooltip.offsetHeight || 50;
        let winWidth = window.innerWidth;
        let winHeight = window.innerHeight;

        let left = e.clientX + 12;
        let top = e.clientY + 12;

        // If overflowing right edge, flip to left of cursor
        if (left + tooltipWidth > winWidth - 12) {
            left = e.clientX - tooltipWidth - 12;
        }
        if (left < 8) {
            left = 8;
        }

        // If overflowing bottom edge, flip above cursor
        if (top + tooltipHeight > winHeight - 12) {
            top = e.clientY - tooltipHeight - 12;
        }
        if (top < 8) {
            top = 8;
        }

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    }

    function hideTooltip() {
        let tooltip = getTooltip();
        if (tooltip) { tooltip.classList.remove('visible'); }
    }

    // ─── Number formatting ────────────────────────────────────────
    function formatTokens(n) {
        if (n === null || n === undefined || isNaN(n)) { return '0'; }
        if (n >= 100000000) { return (n / 100000000).toFixed(1) + '亿'; }
        if (n >= 10000)     { return (n / 10000).toFixed(1) + '万'; }
        if (n >= 1000)      { return (n / 1000).toFixed(1) + 'k'; }
        return String(Math.round(n));
    }

    // ─── Summary Cards ────────────────────────────────────────────
    function renderSummaryCards(cards) {
        if (!cards) { return; }
        let totalEl  = document.getElementById('stats-total-tokens');
        let peakEl   = document.getElementById('stats-peak-tokens');
        let streakEl = document.getElementById('stats-streak');
        let recordEl = document.getElementById('stats-record-streak');

        if (totalEl)  { totalEl.textContent  = formatTokens(cards.totalConsumed); }
        if (peakEl)   { peakEl.textContent   = formatTokens(cards.peakDailyConsumed); }
        if (streakEl) { streakEl.textContent = (cards.currentStreak || 0) + ' 天'; }
        if (recordEl) { recordEl.textContent = '最长 ' + (cards.longestStreak || 0) + ' 天'; }
    }

    let currentHeatmapMode = 'daily';

    // ─── Heatmap ─────────────────────────────────────────────────
    function renderHeatmap(heatmap, mode) {
        mode = mode || currentHeatmapMode || 'daily';
        let container = document.getElementById('stats-heatmap-container');
        if (!container || !heatmap || heatmap.length === 0) { return; }

        let containerWidth = container.clientWidth || 600;
        let dayLabelsWidth = 20;
        let availableWidth = Math.max(containerWidth - dayLabelsWidth - 16, 200);
        let cellStep = 13; // 10px cell + 3px gap
        let maxWeeks = Math.floor(availableWidth / cellStep);
        let numWeeks = Math.min(Math.max(maxWeeks, 10), 53);
        let numDays = numWeeks * 7;

        // Take the most recent numDays so today is always rightmost and visible!
        let rawSlice = heatmap.slice(Math.max(0, heatmap.length - numDays));

        let data = [];
        if (mode === 'daily') {
            data = rawSlice.map(function (d) {
                return { date: d.date, value: d.value, desc: formatTokens(d.value) };
            });
        } else if (mode === 'weekly') {
            let weekSums = [];
            for (let i = 0; i < rawSlice.length; i += 7) {
                let sum = 0;
                for (let j = i; j < Math.min(i + 7, rawSlice.length); j++) {
                    sum += (rawSlice[j].value || 0);
                }
                weekSums.push(sum);
            }
            data = rawSlice.map(function (d, idx) {
                let weekIdx = Math.floor(idx / 7);
                let wVal = weekSums[weekIdx] || 0;
                return {
                    date: d.date,
                    value: wVal,
                    desc: '周计 ' + formatTokens(wVal) + (d.value > 0 ? (' (当日 ' + formatTokens(d.value) + ')') : ''),
                };
            });
        } else if (mode === 'cumulative') {
            let sum = 0;
            data = rawSlice.map(function (d) {
                sum += (d.value || 0);
                return {
                    date: d.date,
                    value: sum,
                    desc: '累计 ' + formatTokens(sum) + (d.value > 0 ? (' (当日 ' + formatTokens(d.value) + ')') : ''),
                };
            });
        }

        // Compute quartile thresholds for coloring
        let nonZero = data.map(function (d) { return d.value; }).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
        let q1 = nonZero[Math.floor(nonZero.length * 0.25)] || 0;
        let q2 = nonZero[Math.floor(nonZero.length * 0.50)] || 0;
        let q3 = nonZero[Math.floor(nonZero.length * 0.75)] || 0;

        function getLevel(value) {
            if (value === 0) { return 0; }
            if (value <= q1) { return 1; }
            if (value <= q2) { return 2; }
            if (value <= q3) { return 3; }
            return 4;
        }

        // Build grid
        container.innerHTML = '';
        let wrapper = document.createElement('div');
        wrapper.className = 'stats-heatmap-wrapper';

        // Day labels (Mon–Sun abbreviated, show every other)
        let dayLabels = document.createElement('div');
        dayLabels.className = 'stats-heatmap-day-labels';
        let days = ['M', '', 'W', '', 'F', '', 'S'];
        days.forEach(function (d) {
            let el = document.createElement('div');
            el.className = 'stats-heatmap-day-label';
            el.textContent = d;
            dayLabels.appendChild(el);
        });

        let scrollArea = document.createElement('div');
        scrollArea.className = 'stats-heatmap-scroll';

        let grid = document.createElement('div');
        grid.className = 'stats-heatmap-grid';

        data.forEach(function (d) {
            let cell = document.createElement('div');
            cell.className = 'stats-heatmap-cell';
            cell.setAttribute('data-level', getLevel(d.value));
            cell.setAttribute('data-date', d.date);
            cell.setAttribute('data-value', d.value);

            cell.addEventListener('mouseenter', function (e) {
                showTooltip(e, '<strong>' + d.date + '</strong><br>' + d.desc);
            });
            cell.addEventListener('mouseleave', hideTooltip);
            grid.appendChild(cell);
        });

        scrollArea.appendChild(grid);
        wrapper.appendChild(dayLabels);
        wrapper.appendChild(scrollArea);
        container.appendChild(wrapper);
    }

    // ─── Trend Chart (Chart.js line chart) ───────────────────────
    function renderTrendChart(trendLines, modelLabels) {
        let canvas = document.getElementById('stats-trend-canvas');
        let emptyState = document.getElementById('stats-trend-empty');
        let legendContainer = document.getElementById('stats-trend-legend');

        if (!canvas || !window.Chart) { return; }

        // trendLines: Array<{ date: string; models: Record<string, number> }>
        if (!trendLines || trendLines.length === 0) {
            canvas.style.display = 'none';
            if (emptyState) { emptyState.classList.remove('hidden'); }
            if (legendContainer) { legendContainer.innerHTML = ''; }
            return;
        }

        // Collect all model IDs
        let modelSet = {};
        trendLines.forEach(function (row) {
            if (row.models) {
                Object.keys(row.models).forEach(function (m) { modelSet[m] = true; });
            }
        });
        let modelIds = Object.keys(modelSet);

        let hasData = trendLines.some(function (row) {
            return row.models && Object.values(row.models).some(function (v) { return v > 0; });
        });

        if (!hasData) {
            canvas.style.display = 'none';
            if (emptyState) { emptyState.classList.remove('hidden'); }
            if (legendContainer) { legendContainer.innerHTML = ''; }
            return;
        }

        canvas.style.display = 'block';
        if (emptyState) { emptyState.classList.add('hidden'); }

        let palette = ['#2f81f7', '#3fb950', '#f78166', '#d2a8ff', '#ffa657', '#79c0ff', '#56d364', '#ff7b72'];
        let style = getComputedStyle(document.body);
        let textColor = style.getPropertyValue('--vscode-descriptionForeground').trim() || '#888';
        let gridColor = 'rgba(255,255,255,0.06)';

        let dates = trendLines.map(function (r) { return r.date; });

        let datasets = modelIds.map(function (modelId, i) {
            let color = palette[i % palette.length];
            let data = trendLines.map(function (row) { return (row.models && row.models[modelId]) || 0; });
            let displayName = (modelLabels && modelLabels[modelId]) || modelId;

            return {
                label: displayName,
                data: data,
                borderColor: color,
                backgroundColor: 'rgba(128,128,128,0.1)',
                fill: true,
                tension: 0.4,
                hidden: hiddenModels.has(modelId),
                pointRadius: 2,
                pointHoverRadius: 5,
                borderWidth: 2,
            };
        });

        if (trendChart) { trendChart.destroy(); }

        trendChart = new window.Chart(canvas, {
            type: 'line',
            data: { labels: dates, datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        filter: function (tooltipItem) {
                            // Only show lines with non-zero consumption on that day to prevent tooltip clutter
                            return tooltipItem.raw > 0;
                        },
                    },
                },
                scales: {
                    x: {
                        grid: { color: gridColor, display: false },
                        ticks: { color: textColor, maxTicksLimit: 7 },
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, callback: function (val) { return formatTokens(val); } },
                        beginAtZero: true,
                    },
                },
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
            },
        });

        // Custom legend
        if (legendContainer) {
            legendContainer.innerHTML = '';
            modelIds.forEach(function (modelId, i) {
                let color = palette[i % palette.length];
                let displayName = (modelLabels && modelLabels[modelId]) || modelId;

                let item = document.createElement('div');
                item.className = 'stats-legend-item' + (hiddenModels.has(modelId) ? ' dimmed' : '');

                let dot = document.createElement('span');
                dot.className = 'stats-legend-dot';
                dot.style.backgroundColor = color;

                let label = document.createElement('span');
                label.textContent = displayName;

                item.appendChild(dot);
                item.appendChild(label);

                item.addEventListener('click', function () {
                    if (hiddenModels.has(modelId)) {
                        hiddenModels.delete(modelId);
                        item.classList.remove('dimmed');
                    } else {
                        hiddenModels.add(modelId);
                        item.classList.add('dimmed');
                    }
                    if (trendChart) {
                        trendChart.data.datasets[i].hidden = hiddenModels.has(modelId);
                        trendChart.update();
                    }
                });

                legendContainer.appendChild(item);
            });
        }
    }

    // ─── Donut Chart (Chart.js doughnut chart) ───────────────────
    function renderDonutChart(donut) {
        let canvas = document.getElementById('stats-donut-canvas');
        let centerValue = document.getElementById('stats-donut-center-value');
        let centerLabel = document.getElementById('stats-donut-center-label');
        let legendContainer = document.getElementById('stats-donut-legend');

        if (!canvas || !window.Chart) { return; }

        // donut: Array<{ modelId, label, consumed, pct, color }>
        if (!donut || donut.length === 0) {
            canvas.style.display = 'none';
            if (legendContainer) { legendContainer.innerHTML = ''; }
            if (centerValue) { centerValue.textContent = '–'; }
            return;
        }

        canvas.style.display = 'block';

        let labels = donut.map(function (d) { return d.label || d.modelId; });
        let values = donut.map(function (d) { return d.consumed || 0; });
        let colors = donut.map(function (d, i) { return d.color || ('hsl(' + (i * 60 + 30) + ',70%,50%)'); });
        let total = values.reduce(function (a, b) { return a + b; }, 0);

        if (centerValue) { centerValue.textContent = formatTokens(total); }
        if (centerLabel) { centerLabel.textContent = '消耗量'; }

        if (donutChart) { donutChart.destroy(); }

        donutChart = new window.Chart(canvas, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 0,
                    hoverOffset: 4,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                let val = context.raw;
                                let pct = total > 0 ? Math.round((val / total) * 100) : 0;
                                return context.label + ': ' + formatTokens(val) + ' (' + pct + '%)';
                            },
                        },
                    },
                },
            },
        });

        // Legend list
        if (legendContainer) {
            legendContainer.innerHTML = '';
            donut.forEach(function (d, i) {
                let item = document.createElement('div');
                item.className = 'stats-donut-legend-item';

                let dot = document.createElement('span');
                dot.className = 'stats-donut-legend-dot';
                dot.style.backgroundColor = colors[i];

                let name = document.createElement('span');
                name.className = 'stats-donut-legend-name';
                name.textContent = d.label || d.modelId;
                name.title = d.label || d.modelId;

                let tokens = document.createElement('span');
                tokens.className = 'stats-donut-legend-tokens';
                tokens.textContent = formatTokens(d.consumed || 0);

                let pct = document.createElement('span');
                pct.className = 'stats-donut-legend-pct';
                pct.textContent = (d.pct || 0) + '%';

                item.appendChild(dot);
                item.appendChild(name);
                item.appendChild(tokens);
                item.appendChild(pct);
                legendContainer.appendChild(item);
            });
        }
    }

    // ─── Update All ───────────────────────────────────────────────
    function renderAll(data) {
        if (!data) { return; }
        renderSummaryCards(data.summaryCards);
        renderHeatmap(data.heatmap, currentHeatmapMode);
        renderTrendChart(data.trendLines, data.modelLabels);
        renderDonutChart(data.donut);
    }

    // ─── Message listener ─────────────────────────────────────────
    window.addEventListener('message', function (event) {
        let msg = event.data;
        if (msg && msg.type === 'stats_update') {
            statsData = msg.data;
            renderAll(statsData);
        }
    });

    // ─── Request Data ─────────────────────────────────────────────
    function requestStats() {
        // WebviewMessage uses 'command' field (not 'type') for host-bound messages
        vscode.postMessage({ command: 'stats_request', range: currentRange });
    }

    // ─── Init & DOM Events ────────────────────────────────────────
    function init() {
        // Range filter buttons
        let btn7d  = document.getElementById('stats-range-7d');
        let btn30d = document.getElementById('stats-range-30d');

        if (btn7d) {
            btn7d.addEventListener('click', function () {
                currentRange = '7d';
                btn7d.classList.add('active');
                if (btn30d) { btn30d.classList.remove('active'); }
                requestStats();
            });
        }
        if (btn30d) {
            btn30d.addEventListener('click', function () {
                currentRange = '30d';
                btn30d.classList.add('active');
                if (btn7d) { btn7d.classList.remove('active'); }
                requestStats();
            });
        }

        // Heatmap mode toggle buttons
        ['daily', 'weekly', 'cumulative'].forEach(function (mode) {
            let btn = document.getElementById('stats-heatmap-' + mode);
            if (btn) {
                btn.addEventListener('click', function () {
                    currentHeatmapMode = mode;
                    ['daily', 'weekly', 'cumulative'].forEach(function (m) {
                        let b = document.getElementById('stats-heatmap-' + m);
                        if (b) { b.classList.toggle('active', m === mode); }
                    });
                    if (statsData) {
                        renderHeatmap(statsData.heatmap, currentHeatmapMode);
                    }
                });
            }
        });

        // Tab click → request stats
        document.querySelectorAll('[data-tab="stats"]').forEach(function (btn) {
            btn.addEventListener('click', function () { requestStats(); });
        });

        // MutationObserver: watch when #tab-stats gets 'active' class
        let tabStats = document.getElementById('tab-stats');
        if (tabStats) {
            let observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                        if (tabStats.classList.contains('active')) {
                            requestStats();
                        }
                    }
                });
            });
            observer.observe(tabStats, { attributes: true, attributeFilter: ['class'] });

            // Immediate request if already active (e.g. restored from serializer)
            if (tabStats.classList.contains('active')) {
                requestStats();
            }
        }

        // On window resize, re-render heatmap to adjust weeks
        window.addEventListener('resize', function () {
            if (statsData) {
                renderHeatmap(statsData.heatmap, currentHeatmapMode);
            }
        });
    }

    // Run init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
