import {
    db, state, toast, escapeHtml, fmtMoney, fmtNum, fmtPct,
    parseDateValue, isoDate, startOfDay, addDays,
} from './shared.js';

let chart = null;
let rangeDays = 30;
let els = null;
let data = { sold: [], stock: [], loans: [] };

const $ = (s, r = document) => r.querySelector(s);

export async function initOverview() {
    els = {
        rangeSwitch: $('#rangeSwitch'),
        exportBtn: $('#exportOverviewBtn'),
        kpiRevenue: $('#kpiRevenue'),
        kpiProfit: $('#kpiProfit'),
        kpiUnits: $('#kpiUnits'),
        kpiLoans: $('#kpiLoans'),
        dRevenue: $('#kpiRevenueDelta'),
        dProfit: $('#kpiProfitDelta'),
        dUnits: $('#kpiUnitsDelta'),
        dLoans: $('#kpiLoansDelta'),
        chartRange: $('#chartRangeLabel'),
        topBody: $('#topProductsBody'),
        insights: $('#insights'),
    };

    els.rangeSwitch.addEventListener('click', (e) => {
        const btn = e.target.closest('.range-btn');
        if (!btn) return;
        els.rangeSwitch.querySelectorAll('.range-btn').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        rangeDays = Number(btn.dataset.range) || 30;
        refreshOverview();
    });

    els.exportBtn.addEventListener('click', exportReport);

    await refreshOverview();
}

export async function refreshOverview() {
    const [soldSnap, stockSnap, loansSnap] = await Promise.all([
        db.collection('sold').where('userId', '==', state.uid).get(),
        db.collection('stock').where('userId', '==', state.uid).get(),
        db.collection('loans').where('userId', '==', state.uid).get(),
    ]);

    data.sold = soldSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    data.stock = stockSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    data.loans = loansSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    compute();
}

/* ---------- compute ---------- */
function saleDateOf(s) {
    return parseDateValue(s.saleDate) || parseDateValue(s.recordedAt) || null;
}

function costOf(s) {
    if (s.costBasis != null) return Number(s.costBasis) || 0;
    if (s.unitCost != null) return (Number(s.unitCost) || 0) * (Number(s.quantity) || 0);
    return 0;
}

function inRange(s, start, end) {
    const d = saleDateOf(s);
    return d && d >= start && d < end;
}

function summarize(list) {
    let revenue = 0, cost = 0, units = 0;
    for (const s of list) {
        revenue += Number(s.totalAmount) || 0;
        cost += costOf(s);
        units += Number(s.quantity) || 0;
    }
    return { revenue, cost, profit: revenue - cost, units };
}

function compute() {
    if (!els) return;

    const now = new Date();
    const start = startOfDay(addDays(now, -(rangeDays - 1)));
    const end = addDays(startOfDay(now), 1);
    const prevStart = addDays(start, -rangeDays);
    const prevEnd = start;

    const current = data.sold.filter(s => inRange(s, start, end));
    const previous = data.sold.filter(s => inRange(s, prevStart, prevEnd));

    const cur = summarize(current);
    const prev = summarize(previous);

    const activeLoans = data.loans.filter(l => l.status !== 'paid').length;
    const overdueLoans = data.loans.filter(l => {
        if (l.status === 'paid') return false;
        const d = parseDateValue(l.dueDate);
        return d && d < startOfDay(now);
    }).length;

    // ---- KPIs ----
    els.kpiRevenue.textContent = fmtMoney(cur.revenue);
    els.kpiProfit.textContent = fmtMoney(cur.profit);
    els.kpiProfit.className = 'kpi-value ' + (cur.profit < 0 ? 'neg' : '');
    els.kpiUnits.textContent = fmtNum(cur.units);
    els.kpiLoans.textContent = fmtNum(activeLoans);

    setDelta(els.dRevenue, cur.revenue, prev.revenue, fmtMoney);
    setDelta(els.dProfit, cur.profit, prev.profit, fmtMoney);
    setDelta(els.dUnits, cur.units, prev.units, fmtNum);

    if (overdueLoans > 0) {
        els.dLoans.className = 'kpi-delta down';
        els.dLoans.textContent = `${overdueLoans} overdue`;
    } else {
        els.dLoans.className = 'kpi-delta';
        els.dLoans.textContent = activeLoans > 0 ? 'on track' : 'none open';
    }

    // ---- chart ----
    const series = bucketize(current, rangeDays);
    els.chartRange.textContent = `${rangeDays} day${rangeDays === 1 ? '' : 's'} · ${current.length} sale${current.length === 1 ? '' : 's'}`;
    renderChart(series);

    // ---- top products ----
    renderTopProducts(current);

    // ---- insights ----
    renderInsights(cur, prev, current, activeLoans, overdueLoans);
}

function setDelta(el, curVal, prevVal, fmtFn) {
    if (prevVal === 0 && curVal === 0) {
        el.className = 'kpi-delta';
        el.textContent = '—';
        return;
    }
    if (prevVal === 0) {
        el.className = 'kpi-delta up';
        el.textContent = 'new this period';
        return;
    }
    const pct = ((curVal - prevVal) / Math.abs(prevVal)) * 100;
    const up = pct >= 0;
    el.className = 'kpi-delta ' + (up ? 'up' : 'down');
    el.textContent = `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% vs prev.`;
}

/* ---------- bucketing ---------- */
function bucketize(list, days) {
    const now = new Date();
    const byDay = new Map();

    for (const s of list) {
        const d = saleDateOf(s);
        if (!d) continue;
        const k = isoDate(d);
        const agg = byDay.get(k) || { rev: 0, cost: 0 };
        agg.rev += Number(s.totalAmount) || 0;
        agg.cost += costOf(s);
        byDay.set(k, agg);
    }

    if (days <= 31) {
        const labels = [], rev = [], cost = [];
        for (let i = days - 1; i >= 0; i--) {
            const d = startOfDay(addDays(now, -i));
            const k = isoDate(d);
            const agg = byDay.get(k) || { rev: 0, cost: 0 };
            labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            rev.push(Math.round(agg.rev));
            cost.push(Math.round(agg.cost));
        }
        return { labels, rev, cost };
    }

    if (days <= 180) {
        // weekly buckets, Monday start
        const labels = [], rev = [], cost = [];
        const start = startOfDay(addDays(now, -(days - 1)));
        let cur = new Date(start);
        while (cur <= now) {
            const weekEnd = addDays(cur, 7);
            let r = 0, c = 0;
            for (const [k, v] of byDay) {
                const d = new Date(k + 'T00:00:00');
                if (d >= cur && d < weekEnd) { r += v.rev; c += v.cost; }
            }
            labels.push(cur.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            rev.push(Math.round(r));
            cost.push(Math.round(c));
            cur = weekEnd;
        }
        return { labels, rev, cost };
    }

    // monthly buckets
    const byMonth = new Map();
    for (const [k, v] of byDay) {
        const d = new Date(k + 'T00:00:00');
        const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const agg = byMonth.get(mk) || { rev: 0, cost: 0 };
        agg.rev += v.rev;
        agg.cost += v.cost;
        byMonth.set(mk, agg);
    }
    const keys = [...byMonth.keys()].sort();
    return {
        labels: keys.map(k => {
            const [y, m] = k.split('-');
            return new Date(Number(y), Number(m) - 1, 1)
                .toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        }),
        rev: keys.map(k => Math.round(byMonth.get(k).rev)),
        cost: keys.map(k => Math.round(byMonth.get(k).cost)),
    };
}

/* ---------- chart ---------- */
function renderChart({ labels, rev, cost }) {
    const ctx = document.getElementById('revenueChart');
    if (!ctx || typeof Chart === 'undefined') return;

    if (chart) chart.destroy();

    chart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Revenue',
                    data: rev,
                    backgroundColor: '#2563eb',
                    borderRadius: 6,
                    barPercentage: 0.7,
                    categoryPercentage: 0.7,
                },
                {
                    label: 'Cost',
                    data: cost,
                    backgroundColor: '#cbd5e1',
                    borderRadius: 6,
                    barPercentage: 0.7,
                    categoryPercentage: 0.7,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 16 },
                },
                tooltip: {
                    callbacks: {
                        label: (c) => ` ${c.dataset.label}: ${fmtMoney(c.raw)}`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10, font: { size: 11 } },
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#eef1f6' },
                    ticks: {
                        font: { size: 11 },
                        callback: (v) => {
                            if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
                            if (v >= 1_000) return (v / 1_000).toFixed(0) + 'K';
                            return v;
                        },
                    },
                },
            },
        },
    });
}

/* ---------- top products ---------- */
function renderTopProducts(current) {
    const map = new Map();
    for (const s of current) {
        const id = s.productId || s.productName || 'unknown';
        const agg = map.get(id) || {
            name: s.productName || 'Product',
            units: 0, revenue: 0, cost: 0,
        };
        agg.units += Number(s.quantity) || 0;
        agg.revenue += Number(s.totalAmount) || 0;
        agg.cost += costOf(s);
        map.set(id, agg);
    }

    const rows = [...map.values()]
        .map(x => ({ ...x, profit: x.revenue - x.cost, margin: x.revenue > 0 ? (x.revenue - x.cost) / x.revenue * 100 : 0 }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 5);

    if (!rows.length) {
        els.topBody.innerHTML = `<tr><td colspan="5" class="empty">No sales in this period</td></tr>`;
        return;
    }

    els.topBody.innerHTML = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.name)}</td>
      <td>${fmtNum(r.units)}</td>
      <td>${fmtMoney(r.revenue)}</td>
      <td class="${r.profit >= 0 ? 'pos' : 'neg'}">${fmtMoney(r.profit)}</td>
      <td>${fmtPct(r.margin)}</td>
    </tr>`).join('');
}

/* ---------- insights ---------- */
function renderInsights(cur, prev, current, activeLoans, overdueLoans) {
    const out = [];

    if (current.length === 0) {
        out.push({
            type: 'warning',
            title: 'No sales in this period',
            body: 'Record a sale from the Transactions tab to start seeing analytics here.',
        });
    } else {
        // best seller
        const best = [...data.sold]
            .filter(s => inRange(s, startOfDay(addDays(new Date(), -(rangeDays - 1))), addDays(startOfDay(new Date()), 1)))
            .reduce((acc, s) => {
                acc[s.productName] = (acc[s.productName] || 0) + (Number(s.totalAmount) || 0);
                return acc;
            }, {});
        const top = Object.entries(best).sort((a, b) => b[1] - a[1])[0];
        if (top) {
            out.push({
                type: 'positive',
                title: `Best seller: ${top[0]}`,
                body: `Brought in ${fmtMoney(top[1])} this period.`,
            });
        }

        // margin
        const margin = cur.revenue > 0 ? (cur.profit / cur.revenue) * 100 : 0;
        if (margin >= 30) {
            out.push({ type: 'positive', title: `Healthy margin: ${fmtPct(margin)}`, body: 'You are keeping a strong share of every sale.' });
        } else if (margin > 0) {
            out.push({ type: 'warning', title: `Thin margin: ${fmtPct(margin)}`, body: 'Consider reviewing your unit costs or raising prices slightly.' });
        } else if (cur.revenue > 0) {
            out.push({ type: 'critical', title: `Selling below cost`, body: `You are losing ${fmtMoney(Math.abs(cur.profit))} this period. Check the selling price against unit cost.` });
        }

        // trend
        if (prev.revenue > 0) {
            const delta = ((cur.revenue - prev.revenue) / prev.revenue) * 100;
            if (delta >= 10) {
                out.push({ type: 'positive', title: `Up ${delta.toFixed(0)}% vs previous period`, body: 'Momentum is building — keep it going.' });
            } else if (delta <= -10) {
                out.push({ type: 'critical', title: `Down ${Math.abs(delta).toFixed(0)}% vs previous period`, body: 'Sales are slowing. A promotion or a follow-up on regulars may help.' });
            }
        }
    }

    // low stock
    const low = data.stock.filter(p => {
        const q = Number(p.quantity) || 0;
        return q > 0 && q < 5;
    });
    const outOfStock = data.stock.filter(p => (Number(p.quantity) || 0) === 0);
    if (outOfStock.length) {
        out.push({
            type: 'critical',
            title: `${outOfStock.length} product${outOfStock.length === 1 ? '' : 's'} out of stock`,
            body: outOfStock.map(p => p.name).slice(0, 4).join(', ') + (outOfStock.length > 4 ? '…' : ''),
        });
    }
    if (low.length) {
        out.push({
            type: 'warning',
            title: `${low.length} product${low.length === 1 ? '' : 's'} running low`,
            body: low.map(p => `${p.name} (${p.quantity})`).slice(0, 4).join(', '),
        });
    }

    // loans
    if (overdueLoans > 0) {
        out.push({
            type: 'critical',
            title: `${overdueLoans} overdue loan${overdueLoans === 1 ? '' : 's'}`,
            body: 'Follow up on overdue borrowers to protect your cash flow.',
        });
    } else if (activeLoans > 0) {
        out.push({
            type: 'warning',
            title: `${activeLoans} active loan${activeLoans === 1 ? '' : 's'}`,
            body: 'All within schedule — keep an eye on due dates.',
        });
    }

    if (!out.length) {
        out.push({ type: 'positive', title: 'All good', body: 'No issues to flag right now.' });
    }

    els.insights.innerHTML = out.map(i => `
    <div class="insight ${i.type}">
      <i class="fas fa-${i.type === 'positive' ? 'circle-check' : i.type === 'warning' ? 'triangle-exclamation' : 'circle-exclamation'}"></i>
      <div>
        <strong>${escapeHtml(i.title)}</strong>
        <p>${escapeHtml(i.body)}</p>
      </div>
    </div>`).join('');
}

/* ---------- export ---------- */
function exportReport() {
    if (typeof XLSX === 'undefined') {
        toast('Export library not loaded', 'error');
        return;
    }

    const now = new Date();
    const start = startOfDay(addDays(now, -(rangeDays - 1)));
    const end = addDays(startOfDay(now), 1);
    const current = data.sold.filter(s => inRange(s, start, end));
    const cur = summarize(current);

    const summary = [{
        Period: `Last ${rangeDays} days`,
        Revenue: cur.revenue,
        Cost: cur.cost,
        Profit: cur.profit,
        'Units sold': cur.units,
        'Active loans': data.loans.filter(l => l.status !== 'paid').length,
    }];

    const sales = current.map(s => ({
        Date: s.saleDate || '',
        Product: s.productName || '',
        Quantity: Number(s.quantity) || 0,
        'Unit price': Number(s.price) || 0,
        Revenue: Number(s.totalAmount) || 0,
        'Cost basis': costOf(s),
        Profit: (Number(s.totalAmount) || 0) - costOf(s),
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sales), 'Sales');
    XLSX.writeFile(wb, `Genzura_Overview_${isoDate(now)}.xlsx`);
}