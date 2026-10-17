"use strict";

/*
 * Restaurant Billing Software
 * File: js/dashboard.js
 *
 * Phase 1:
 * - Dashboard demo data
 * - Sales chart rendering
 * - Hourly heatmap interaction
 * - CSV report export
 *
 * Firebase integration will be added in a later phase.
 */

(() => {
  const DEMO_DATA = {
    business: {
      name: "Spice Garden Restaurant",
      tagline: "Restaurant Billing & Analytics",
      owner: "Restaurant Owner",
      role: "Administrator"
    },

    target: {
      amount: 30000,
      achieved: 24850
    },

    kpis: {
      revenue: 24850,
      invoices: 86,
      paid: 83,
      pending: 3,
      averageBill: 289,
      drafts: 3
    },

    weeklySales: {
      current: [
        { day: "Mon", revenue: 5800 },
        { day: "Tue", revenue: 7200 },
        { day: "Wed", revenue: 6400 },
        { day: "Thu", revenue: 8800 },
        { day: "Fri", revenue: 7600 },
        { day: "Sat", revenue: 9600 },
        { day: "Sun", revenue: 7000 }
      ],

      previous: [
        { day: "Mon", revenue: 4600 },
        { day: "Tue", revenue: 5500 },
        { day: "Wed", revenue: 6000 },
        { day: "Thu", revenue: 7000 },
        { day: "Fri", revenue: 6600 },
        { day: "Sat", revenue: 8200 },
        { day: "Sun", revenue: 6200 }
      ]
    },

    paymentSplit: {
      upi: 12900,
      cash: 11950
    },

    monthlySales: [
      { month: "May", revenue: 85000 },
      { month: "Jun", revenue: 97000 },
      { month: "Jul", revenue: 108000 },
      { month: "Aug", revenue: 96000 },
      { month: "Sep", revenue: 124000 },
      { month: "Oct", revenue: 139000 }
    ],

    categories: [
      { name: "Starters", revenue: 42500, share: 32 },
      { name: "Main Course", revenue: 37200, share: 28 },
      { name: "Beverages", revenue: 23900, share: 18 },
      { name: "Desserts", revenue: 15900, share: 12 },
      { name: "Others", revenue: 13300, share: 10 }
    ],

    products: [
      { name: "Chicken Biryani", quantity: 145, revenue: 21750 },
      { name: "Paneer Butter Masala", quantity: 112, revenue: 16800 },
      { name: "Masala Dosa", quantity: 98, revenue: 9800 },
      { name: "Cold Coffee", quantity: 85, revenue: 10200 },
      { name: "Gulab Jamun", quantity: 72, revenue: 3600 }
    ],

    hourlyOrders: {
      today: [2, 4, 7, 12, 18, 22, 17, 12, 8, 14, 20, 19],
      week:  [5, 8, 12, 16, 21, 24, 19, 15, 11, 18, 23, 20]
    },

    invoices: [
      {
        number: "INV-0041",
        customer: "Amit Sharma",
        detail: "Table 04",
        date: "Today, 10:45 AM",
        amount: 1250,
        status: "Paid"
      },
      {
        number: "INV-0040",
        customer: "Priya Das",
        detail: "Walk-in",
        date: "Today, 10:20 AM",
        amount: 680,
        status: "Paid"
      },
      {
        number: "INV-0039",
        customer: "Rahul Das",
        detail: "Table 02",
        date: "Today, 09:55 AM",
        amount: 940,
        status: "Pending"
      },
      {
        number: "INV-0038",
        customer: "Neha Sharma",
        detail: "Table 06",
        date: "Today, 09:30 AM",
        amount: 1570,
        status: "Paid"
      },
      {
        number: "INV-0037",
        customer: "Walk-in Customer",
        detail: "Walk-in",
        date: "Today, 09:10 AM",
        amount: 420,
        status: "Draft"
      }
    ]
  };

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const formatMoney = (amount) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(amount);

  const formatNumber = (number) =>
    new Intl.NumberFormat("en-IN").format(number);

  function setText(element, value) {
    if (element) {
      element.textContent = String(value);
    }
  }

  function setPlaceholder(element, value) {
    if (!element) return;

    const placeholder = $(".ph", element);

    if (placeholder) {
      placeholder.textContent = String(value);
    } else {
      element.textContent = String(value);
    }
  }

  function setProgress(element, percent) {
    if (!element) return;

    const safePercent = Math.max(0, Math.min(100, percent));

    element.style.width = `${safePercent}%`;
    element.setAttribute("aria-valuenow", String(safePercent));
  }

  function renderBusinessDetails() {
    $$(".brand-text h1 .ph").forEach((element) => {
      setText(element, DEMO_DATA.business.name);
    });

    $$(".brand-text > span .ph").forEach((element) => {
      setText(element, DEMO_DATA.business.tagline);
    });

    $$(".profile .name .ph").forEach((element) => {
      setText(element, DEMO_DATA.business.owner);
    });

    $$(".profile .role .ph").forEach((element) => {
      setText(element, DEMO_DATA.business.role);
    });

    $$(".page-footer > span:first-child .ph:first-child").forEach(
      (element) => {
        setText(element, DEMO_DATA.business.name);
      }
    );
  }

  function renderTarget() {
    const { amount, achieved } = DEMO_DATA.target;
    const remaining = Math.max(0, amount - achieved);
    const percentage = amount > 0
      ? Math.round((achieved / amount) * 100)
      : 0;

    const card = $(".target-card");

    if (!card) return;

    setPlaceholder($(".value", card), formatMoney(amount));
    setPlaceholder(
      $(".target-meta span:first-child", card)?.closest("span"),
      `${percentage}% achieved`
    );

    const meta = $$(".target-meta span", card);

    if (meta[0]) {
      meta[0].textContent = `${percentage}% achieved`;
    }

    if (meta[1]) {
      meta[1].textContent = `${formatMoney(remaining)} left`;
    }

    setProgress($(".target-fill", card), percentage);
  }

  function renderKpis() {
    const values = [
      formatMoney(DEMO_DATA.kpis.revenue),
      formatNumber(DEMO_DATA.kpis.invoices),
      formatMoney(DEMO_DATA.kpis.averageBill),
      formatNumber(DEMO_DATA.kpis.drafts)
    ];

    $$(".kpi .kpi-value").forEach((element, index) => {
      if (values[index] !== undefined) {
        setPlaceholder(element, values[index]);
      }
    });

    const subtitles = $$(".kpi .kpi-sub");

    if (subtitles[0]) {
      subtitles[0].textContent = "Demo data · daily revenue";
    }

    if (subtitles[1]) {
      subtitles[1].textContent =
        `${DEMO_DATA.kpis.paid} paid · ` +
        `${DEMO_DATA.kpis.pending} pending`;
    }

    if (subtitles[2]) {
      subtitles[2].textContent = "Based on today's demo invoices";
    }

    if (subtitles[3]) {
      subtitles[3].textContent = "Demo unfinished invoices";
    }
  }

  function renderWeeklySales() {
    const columns = $$(".chart .chart-col");
    const { current, previous } = DEMO_DATA.weeklySales;

    columns.forEach((column, index) => {
      const bars = $$(".bar", column);
      const currentDay = current[index];
      const previousDay = previous[index];

      if (!currentDay || !previousDay) return;

      const maxRevenue = Math.max(
        ...current.map((item) => item.revenue),
        ...previous.map((item) => item.revenue)
      );

      const currentHeight = (currentDay.revenue / maxRevenue) * 100;
      const previousHeight = (previousDay.revenue / maxRevenue) * 100;

      if (bars[0]) {
        setProgress(bars[0], currentHeight);
        bars[0].title =
          `${currentDay.day}: ${formatMoney(currentDay.revenue)}`;
        bars[0].setAttribute(
          "aria-label",
          `${currentDay.day} current week sales ${formatMoney(currentDay.revenue)}`
        );
      }

      if (bars[1]) {
        setProgress(bars[1], previousHeight);
        bars[1].title =
          `${previousDay.day}: ${formatMoney(previousDay.revenue)}`;
        bars[1].setAttribute(
          "aria-label",
          `${previousDay.day} previous week sales ${formatMoney(previousDay.revenue)}`
        );
      }

      setText($(".chart-day", column), currentDay.day);
    });
  }

  function renderPaymentSplit() {
    const { upi, cash } = DEMO_DATA.paymentSplit;
    const total = upi + cash;

    const upiPercent = total > 0 ? (upi / total) * 100 : 0;
    const cashPercent = total > 0 ? (cash / total) * 100 : 0;

    const card = $$(".row-2 .card").find((element) =>
      $("h3", element)?.textContent.trim() === "Payment Split"
    );

    if (!card) return;

    const segments = $$(".split-seg", card);
    const legendValues = $$(".sl-val", card);

    setProgress(segments[0], upiPercent);
    setProgress(segments[1], cashPercent);

    if (legendValues[0]) {
      legendValues[0].textContent =
        `${formatMoney(upi)} · ${Math.round(upiPercent)}%`;
    }

    if (legendValues[1]) {
      legendValues[1].textContent =
        `${formatMoney(cash)} · ${Math.round(cashPercent)}%`;
    }

    const subtitle = $("p", $(".card-head", card));

    if (subtitle) {
      subtitle.textContent = `Total collection: ${formatMoney(total)}`;
    }
  }

  function renderPerformanceReport() {
    const currentMonth = DEMO_DATA.monthlySales.at(-1);
    const previousMonth = DEMO_DATA.monthlySales.at(-2);

    const growth = previousMonth && previousMonth.revenue > 0
      ? (
          (currentMonth.revenue - previousMonth.revenue) /
          previousMonth.revenue
        ) * 100
      : 0;

    const hero = $(".report-hero");

    if (!hero) return;

    const values = $$(".rs-value", hero);

    if (values[0]) {
      setPlaceholder(values[0], formatMoney(currentMonth.revenue));
    }

    if (values[1]) {
      setPlaceholder(values[1], formatNumber(DEMO_DATA.kpis.invoices));
    }

    if (values[2]) {
      setPlaceholder(values[2], `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`);
    }
  }

  function renderMonthlySales() {
    const salesCard = $$(".row-3 .card").find((card) =>
      $("h3", card)?.textContent.trim() === "Monthly Trend"
    );

    if (!salesCard) return;

    const rows = $$(".cat-item", salesCard);
    const maxValue = Math.max(
      ...DEMO_DATA.monthlySales.map((item) => item.revenue)
    );

    rows.forEach((row, index) => {
      const item = DEMO_DATA.monthlySales[index];

      if (!item) return;

      setText($(".cat-name", row), item.month);
      setPlaceholder($(".cat-val", row), formatMoney(item.revenue));

      setProgress(
        $(".cat-fill", row),
        (item.revenue / maxValue) * 100
      );
    });
  }

  function renderCategories() {
    const categoryCard = $$(".row-3 .card").find((card) =>
      $("h3", card)?.textContent.trim() === "Top Categories"
    );

    if (!categoryCard) return;

    const rows = $$(".cat-item", categoryCard);
    const maxRevenue = Math.max(
      ...DEMO_DATA.categories.map((item) => item.revenue)
    );

    rows.forEach((row, index) => {
      const item = DEMO_DATA.categories[index];

      if (!item) return;

      setText($(".cat-name", row), item.name);

      const value = $(".cat-val", row);

      if (value) {
        value.textContent =
          `${formatMoney(item.revenue)} · ${item.share}%`;
      }

      setProgress(
        $(".cat-fill", row),
        (item.revenue / maxRevenue) * 100
      );
    });
  }

  function renderKeyMetrics() {
    const metricsCard = $$(".row-3 .card").find((card) =>
      $("h3", card)?.textContent.trim() === "Key Metrics"
    );

    if (!metricsCard) return;

    const values = $$(".metric-value", metricsCard);

    if (values[0]) setPlaceholder(values[0], "38.5%");
    if (values[1]) setPlaceholder(values[1], "42%");
    if (values[2]) setPlaceholder(values[2], "7–9 PM");

    const labels = $$(".metric-label", metricsCard);

    if (labels[2]) {
      const parent = labels[2].closest(".metric");
      const delta = $(".metric-delta", parent);

      if (delta) {
        delta.textContent = "Highest order volume";
      }
    }
  }

  function renderProducts() {
    const productCard = $$(".row-2 .card").find((card) =>
      $("h3", card)?.textContent.trim() === "Top Selling Products"
    );

    if (!productCard) return;

    const rows = $$(".prod-item", productCard);
    const maxQuantity = Math.max(
      ...DEMO_DATA.products.map((item) => item.quantity)
    );

    rows.forEach((row, index) => {
      const item = DEMO_DATA.products[index];

      if (!item) return;

      const name = $(".p-name span:first-child", row);
      const quantity = $(".p-name span:last-child", row);

      setText(name, item.name);
      setText(quantity, `${item.quantity} sold`);

      setProgress(
        $(".prod-fill", row),
        (item.quantity / maxQuantity) * 100
      );

      row.title = `${item.name}: ${formatMoney(item.revenue)} sales`;
    });
  }

  function renderComparisonMetrics() {
    const section = $(".row-2-even");

    if (!section) return;

    const comparisonCard = $$(".card", section).find((card) =>
      $("h3", card)?.textContent.trim() === "This Week vs Last Week"
    );

    if (!comparisonCard) return;

    const thisWeek = DEMO_DATA.weeklySales.current.reduce(
      (sum, item) => sum + item.revenue,
      0
    );

    const lastWeek = DEMO_DATA.weeklySales.previous.reduce(
      (sum, item) => sum + item.revenue,
      0
    );

    const change = lastWeek > 0
      ? ((thisWeek - lastWeek) / lastWeek) * 100
      : 0;

    const values = $$(".metric-value", comparisonCard);

    if (values[0]) setPlaceholder(values[0], formatMoney(thisWeek));
    if (values[1]) setPlaceholder(values[1], formatMoney(lastWeek));

    const delta = $(".metric-delta", comparisonCard);

    if (delta) {
      delta.textContent =
        `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs last week`;
    }
  }

  function renderCustomerInsights() {
    const section = $(".row-2-even");

    if (!section) return;

    const customerCard = $$(".card", section).find((card) =>
      $("h3", card)?.textContent.trim() === "Customer Insight"
    );

    if (!customerCard) return;

    const segments = $$(".split-seg", customerCard);
    const legendValues = $$(".sl-val", customerCard);

    setProgress(segments[0], 62);
    setProgress(segments[1], 38);

    if (legendValues[0]) legendValues[0].textContent = "62% · 124";
    if (legendValues[1]) legendValues[1].textContent = "38% · 76";
  }

  function renderInvoices() {
    const table = $(".inv-table tbody");

    if (!table) return;

    const rows = $$("tr", table);

    rows.forEach((row, index) => {
      const invoice = DEMO_DATA.invoices[index];

      if (!invoice) return;

      const cells = $$("td", row);

      setText(cells[0], invoice.number);

      const customer = $(".cust-name", cells[1]);
      const detail = $(".cust-sub", cells[1]);

      setText(customer, invoice.customer);
      setText(detail, invoice.detail);
      setText(cells[2], invoice.date);
      setText(cells[3], formatMoney(invoice.amount));

      const status = $(".pill", cells[4]);

      if (status) {
        status.textContent = invoice.status;
        status.className = "pill";

        if (invoice.status === "Paid") {
          status.classList.add("paid");
        } else if (invoice.status === "Pending") {
          status.classList.add("pending");
        } else {
          status.classList.add("draft");
        }
      }
    });
  }

  function getHourlyCard() {
    return $$(".row-2 .card").find((card) =>
      $("h3", card)?.textContent.trim() === "Hourly Sales Heatmap"
    );
  }

  function renderHourlyHeatmap(period = "today") {
    const card = getHourlyCard();

    if (!card) return;

    const values = DEMO_DATA.hourlyOrders[period];
    const cells = $$(".hour-cell", card);

    if (!values || cells.length === 0) return;

    const maxValue = Math.max(...values);

    cells.forEach((cell, index) => {
      const value = values[index] ?? 0;

      cell.classList.remove(
        "level-1",
        "level-2",
        "level-3",
        "level-4",
        "level-5"
      );

      const level = maxValue > 0
        ? Math.min(5, Math.max(1, Math.ceil((value / maxValue) * 5)))
        : 1;

      cell.classList.add(`level-${level}`);
      cell.title = `${cell.textContent}:00 — ${value} demo orders`;
      cell.setAttribute(
        "aria-label",
        `${cell.textContent}:00, ${value} demo orders`
      );
    });

    const subtitle = $(".card-head p", card);

    if (subtitle) {
      subtitle.textContent = period === "today"
        ? "Demo orders per hour today"
        : "Demo average orders per hour this week";
    }

    const peakIndex = values.indexOf(maxValue);
    const peakCell = cells[peakIndex];

    const summary = card.querySelector(
      ".card-body > div:last-child"
    );

    if (summary) {
      const spans = $$("span", summary);

      if (spans[0]) {
        spans[0].textContent =
          `Peak: ${peakCell?.textContent ?? "—"} · ${maxValue} orders`;
      }

      const minValue = Math.min(...values);
      const slowIndex = values.indexOf(minValue);

      if (spans[1]) {
        spans[1].textContent =
          `Slow: ${cells[slowIndex]?.textContent ?? "—"} · ${minValue} orders`;
      }
    }

    $$(".report-tab", card).forEach((button) => {
      const selected =
        (period === "today" && button.textContent.trim() === "Today") ||
        (period === "week" && button.textContent.trim() === "Week");

      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  function exportDashboardCsv() {
    const lines = [
      ["Restaurant Dashboard Demo Report"],
      ["Report generated", new Date().toLocaleString("en-IN")],
      [],
      ["Daily KPI", "Value"],
      ["Today's revenue", DEMO_DATA.kpis.revenue],
      ["Invoices today", DEMO_DATA.kpis.invoices],
      ["Paid invoices", DEMO_DATA.kpis.paid],
      ["Pending invoices", DEMO_DATA.kpis.pending],
      ["Average bill value", DEMO_DATA.kpis.averageBill],
      [],
      ["Weekly Sales", "Day", "Current Week Revenue", "Previous Week Revenue"]
    ];

    DEMO_DATA.weeklySales.current.forEach((item, index) => {
      lines.push([
        "Weekly Sales",
        item.day,
        item.revenue,
        DEMO_DATA.weeklySales.previous[index]?.revenue ?? 0
      ]);
    });

    lines.push(
      [],
      ["Payment Method", "Amount"],
      ["UPI", DEMO_DATA.paymentSplit.upi],
      ["Cash", DEMO_DATA.paymentSplit.cash],
      [],
      ["Category", "Revenue", "Share (%)"]
    );

    DEMO_DATA.categories.forEach((item) => {
      lines.push([item.name, item.revenue, item.share]);
    });

    lines.push(
      [],
      ["Top Selling Product", "Quantity Sold", "Revenue"]
    );

    DEMO_DATA.products.forEach((item) => {
      lines.push([item.name, item.quantity, item.revenue]);
    });

    lines.push(
      [],
      ["Invoice Number", "Customer", "Date", "Amount", "Status"]
    );

    DEMO_DATA.invoices.forEach((item) => {
      lines.push([
        item.number,
        item.customer,
        item.date,
        item.amount,
        item.status
      ]);
    });

    const csv = lines
      .map((row) =>
        row
          .map((value) => {
            const safeValue = String(value ?? "");

            return `"${safeValue.replace(/"/g, '""')}"`;
          })
          .join(",")
      )
      .join("\r\n");

    const blob = new Blob(
      ["\uFEFF", csv],
      { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `dashboard-demo-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    URL.revokeObjectURL(url);
  }

  function bindDashboardEvents() {
    const exportButton = $(".page-actions .btn-soft");

    if (exportButton) {
      exportButton.addEventListener("click", exportDashboardCsv);
      exportButton.setAttribute("type", "button");
    }

    const heatmapCard = getHourlyCard();

    if (heatmapCard) {
      $$(".report-tab", heatmapCard).forEach((button) => {
        button.addEventListener("click", () => {
          const period = button.textContent.trim().toLowerCase();

          if (period === "today" || period === "week") {
            renderHourlyHeatmap(period);
          }
        });
      });
    }

    // Chart tooltips are also available on keyboard focus.
    $$(".chart .bar").forEach((bar) => {
      if (!bar.hasAttribute("tabindex")) {
        bar.setAttribute("tabindex", "0");
      }
    });
  }

  function initDashboard() {
    if (!$(".app") || !$(".kpis")) return;

    renderBusinessDetails();
    renderTarget();
    renderKpis();
    renderWeeklySales();
    renderPaymentSplit();
    renderPerformanceReport();
    renderMonthlySales();
    renderCategories();
    renderKeyMetrics();
    renderProducts();
    renderComparisonMetrics();
    renderCustomerInsights();
    renderInvoices();
    renderHourlyHeatmap("today");
    bindDashboardEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboard);
  } else {
    initDashboard();
  }
})();
