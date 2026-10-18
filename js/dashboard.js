"use strict";

/*
 * Restaurant Billing Software
 * File: js/dashboard.js
 *
 * Firebase-connected owner dashboard.
 * Data source: restaurantBilling
 * No demo records or hardcoded sales figures.
 */

(() => {
  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const ROOT_PATH = "restaurantBilling";

  const state = {
    invoices: [],
    products: [],
    categories: [],
    settings: {},
    loaded: new Set(),
    errors: new Map(),
    unsubscribers: [],
    initialized: false
  };

  const $ = id => document.getElementById(id);

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value ?? "");
  }

  function setStatus(message, type = "info") {
    setText("dashboardStatus", message);

    const element = $("dashboardStatus");

    if (element) {
      element.dataset.state = type;
      element.setAttribute("role", type === "error" ? "alert" : "status");
    }

    setText(
      "dashboardFooterStatus",
      type === "error"
        ? "Database status: error"
        : type === "success"
          ? "Database status: live"
          : "Database status: connecting…"
    );
  }

  function money(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount)) return "—";

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2
    }).format(amount);
  }

  function number(value) {
    const amount = Number(value);

    return new Intl.NumberFormat("en-IN").format(
      Number.isFinite(amount) ? amount : 0
    );
  }

  function percent(value) {
    if (!Number.isFinite(value)) return "—";

    return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function objectToArray(value) {
    if (Array.isArray(value)) {
      return value.filter(item => item && typeof item === "object");
    }

    if (!value || typeof value !== "object") return [];

    return Object.entries(value)
      .filter(([, item]) => item && typeof item === "object")
      .map(([key, item]) => ({
        ...item,
        id: item.id || key
      }));
  }

  // --------------------------------------------------
  // INVOICE DATA NORMALISATION
  // --------------------------------------------------

  function readAmount(invoice) {
    const candidates = [
      invoice.grandTotal,
      invoice.totalAmount,
      invoice.total,
      invoice.amount,
      invoice.finalAmount
    ];

    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === "") {
        continue;
      }

      const amount = Number(candidate);

      if (Number.isFinite(amount)) return amount;
    }

    return 0;
  }

  function readInvoiceDate(invoice) {
    const dateValue =
      invoice.createdAtMs ||
      invoice.timestamp ||
      invoice.createdAt ||
      invoice.invoiceDate ||
      invoice.date;

    if (typeof dateValue === "number") {
      const parsed = new Date(dateValue);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof dateValue === "string" && dateValue.trim()) {
      const value = dateValue.trim();
      const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

      if (dateOnly) {
        const parsed = new Date(
          Number(dateOnly[1]),
          Number(dateOnly[2]) - 1,
          Number(dateOnly[3])
        );

        return Number.isNaN(parsed.getTime()) ? null : parsed;
      }

      const parsed = new Date(value);

      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
  }

  function readCustomer(invoice) {
    const customer =
      invoice.customerName ||
      invoice.customer?.name ||
      invoice.customer;

    return typeof customer === "string" && customer.trim()
      ? customer.trim()
      : "Customer not specified";
  }

  function readInvoiceNumber(invoice) {
    return (
      invoice.invoiceNumber ||
      invoice.number ||
      invoice.id ||
      "Invoice number unavailable"
    );
  }

  function readInvoiceStatus(invoice) {
    const raw = String(
      invoice.recordStatus ||
      invoice.status ||
      invoice.invoiceStatus ||
      ""
    ).toLowerCase();

    if (["cancelled", "canceled", "void", "deleted"].includes(raw)) {
      return "Cancelled";
    }

    if (["draft", "pending", "unpaid", "due"].includes(raw)) {
      return "Pending";
    }

    if (
      [
        "valid",
        "generated",
        "recorded",
        "complete",
        "completed",
        "paid"
      ].includes(raw)
    ) {
      return "Recorded";
    }

    return invoice.invoiceNumber ? "Recorded" : "Unclassified";
  }

  function isCancelled(invoice) {
    return readInvoiceStatus(invoice) === "Cancelled";
  }

  function validInvoices() {
    return state.invoices.filter(invoice =>
      invoice &&
      typeof invoice === "object" &&
      !isCancelled(invoice)
    );
  }

  function paymentStatus(invoice) {
    return String(
      invoice.paymentStatus ||
      invoice.payment?.status ||
      invoice.paymentState ||
      ""
    ).toLowerCase();
  }

  function isExplicitlyPaid(invoice) {
    return ["paid", "complete", "completed", "settled"].includes(
      paymentStatus(invoice)
    );
  }

  function isExplicitlyPending(invoice) {
    return [
      "pending",
      "unpaid",
      "due",
      "partial",
      "partially-paid"
    ].includes(paymentStatus(invoice));
  }

  function readPaymentMethod(invoice) {
    const method =
      invoice.paymentMethod ||
      invoice.payment?.method ||
      invoice.paymentType ||
      "Unspecified";

    return String(method).trim() || "Unspecified";
  }

  function readItems(invoice) {
    const items = invoice.items || invoice.lineItems || invoice.products;

    return Array.isArray(items) ? items : objectToArray(items);
  }

  function itemName(item) {
    return String(
      item.name ||
      item.productName ||
      item.itemName ||
      item.title ||
      "Unnamed item"
    );
  }

  function itemQuantity(item) {
    const quantity = Number(item.quantity ?? item.qty ?? 1);

    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function itemTotal(item) {
    const candidates = [
      item.total,
      item.lineTotal,
      item.subtotal,
      item.amount
    ];

    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === "") {
        continue;
      }

      const amount = Number(candidate);

      if (Number.isFinite(amount)) return amount;
    }

    const price = Number(item.price ?? item.unitPrice ?? item.rate ?? 0);

    return (Number.isFinite(price) ? price : 0) * itemQuantity(item);
  }

  // --------------------------------------------------
  // DATE HELPERS
  // --------------------------------------------------

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, count) {
    const result = new Date(date);
    result.setDate(result.getDate() + count);
    return result;
  }

  function startOfWeek(date) {
    const result = startOfDay(date);
    const weekday = (result.getDay() + 6) % 7;

    result.setDate(result.getDate() - weekday);

    return result;
  }

  function sameDay(a, b) {
    return Boolean(
      a &&
      b &&
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  function isBetween(date, start, end) {
    return Boolean(date && date >= start && date < end);
  }

  function sumInvoices(invoices) {
    return invoices.reduce(
      (total, invoice) => total + readAmount(invoice),
      0
    );
  }

  // --------------------------------------------------
  // BUSINESS SETTINGS
  // --------------------------------------------------

  function getForms() {
    const forms = state.settings?.forms;

    return forms && typeof forms === "object" ? forms : {};
  }

  function getSettingValue(formNames, fieldNames) {
    const forms = getForms();

    for (const formName of formNames) {
      const section = forms[formName];

      if (!section || typeof section !== "object") continue;

      for (const fieldName of fieldNames) {
        const value = section[fieldName];

        if (
          value !== undefined &&
          value !== null &&
          String(value).trim()
        ) {
          return value;
        }
      }
    }

    for (const fieldName of fieldNames) {
      const value = state.settings?.[fieldName];

      if (
        value !== undefined &&
        value !== null &&
        String(value).trim()
      ) {
        return value;
      }
    }

    return null;
  }

  function applyBusinessProfile() {
    const name = getSettingValue(
      ["brandSettingsForm", "businessProfileForm"],
      ["brandDisplayName", "businessName", "displayName"]
    );

    const tagline = getSettingValue(
      ["brandSettingsForm", "businessProfileForm"],
      ["tagline", "businessTagline"]
    );

    const displayName = name ? String(name).trim() : "Your Business";
    const displayTagline = tagline
      ? String(tagline).trim()
      : "Business billing";

    setText("dashboardBusinessName", displayName);
    setText("dashboardBusinessTagline", displayTagline);
    setText("businessFooterName", displayName);

    document.title = `Dashboard | ${displayName}`;

    const authUser = window.restaurantFirebase?.auth?.currentUser;

    const ownerName =
      state.settings?.ownerName ||
      state.settings?.ownerDisplayName ||
      state.settings?.userName ||
      authUser?.displayName ||
      "Owner";

    setText("ownerDisplayName", ownerName);
    setText("ownerDisplayRole", "Owner");

    setText(
      "ownerAvatar",
      String(ownerName).trim().charAt(0).toUpperCase() || "O"
    );
  }

  function renderDailyTarget(todayRevenue) {
    const targetValue = Number(getSettingValue(
      [
        "reportSettingsForm",
        "billingPreferencesForm",
        "businessProfileForm"
      ],
      ["dailySalesTarget", "dailyTarget", "salesTarget", "targetAmount"]
    ));

    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      setText("dailyTargetValue", "Not set");
      setText("dailyTargetPercent", "Target not configured");
      setText("dailyTargetRemaining", "—");
      return;
    }

    const achieved = Math.min(100, (todayRevenue / targetValue) * 100);
    const remaining = Math.max(0, targetValue - todayRevenue);

    setText("dailyTargetValue", money(targetValue));
    setText("dailyTargetPercent", `${achieved.toFixed(1)}% achieved`);
    setText(
      "dailyTargetRemaining",
      remaining > 0 ? `${money(remaining)} left` : "Target reached"
    );

    // Set the progress using a CSS class rather than a style attribute.
    const fill = $("dailyTargetFill");

    if (fill) {
      const level = Math.max(0, Math.min(10, Math.round(achieved / 10)));

      for (let i = 0; i <= 10; i += 1) {
        fill.classList.remove(`target-level-${i}`);
      }

      fill.classList.add(`target-level-${level}`);
    }
  }

  // --------------------------------------------------
  // SUMMARY CARDS
  // --------------------------------------------------

  function renderSummary(invoices, now) {
    const today = startOfDay(now);
    const yesterday = addDays(today, -1);

    const todaysInvoices = invoices.filter(invoice =>
      sameDay(readInvoiceDate(invoice), today)
    );

    const yesterdaysInvoices = invoices.filter(invoice =>
      sameDay(readInvoiceDate(invoice), yesterday)
    );

    const todaysRevenue = sumInvoices(todaysInvoices);
    const yesterdaysRevenue = sumInvoices(yesterdaysInvoices);
    const average = invoices.length
      ? sumInvoices(invoices) / invoices.length
      : 0;

    setText("todayRevenueValue", money(todaysRevenue));
    setText("invoicesTodayValue", number(todaysInvoices.length));

    setText(
      "paidInvoicesValue",
      number(todaysInvoices.filter(isExplicitlyPaid).length)
    );

    setText(
      "pendingInvoicesValue",
      number(todaysInvoices.filter(isExplicitlyPending).length)
    );

    setText("averageBillValue", money(average));
    setText("averageBillCount", number(invoices.length));
    setText("totalInvoicesValue", number(invoices.length));

    const change = yesterdaysRevenue > 0
      ? ((todaysRevenue - yesterdaysRevenue) / yesterdaysRevenue) * 100
      : null;

    setText(
      "todayRevenueTrend",
      change === null ? "—" : percent(change)
    );

    setText(
      "todayRevenueComparison",
      change === null
        ? `Yesterday: ${money(yesterdaysRevenue)}`
        : `${percent(change)} vs yesterday (${money(yesterdaysRevenue)})`
    );

    renderDailyTarget(todaysRevenue);
  }

  // --------------------------------------------------
  // WEEKLY SALES CHART
  // --------------------------------------------------

  function renderWeeklySales(invoices, now) {
    const thisWeekStart = startOfWeek(now);
    const nextWeekStart = addDays(thisWeekStart, 7);
    const lastWeekStart = addDays(thisWeekStart, -7);

    const thisWeekInvoices = invoices.filter(invoice =>
      isBetween(readInvoiceDate(invoice), thisWeekStart, nextWeekStart)
    );

    const lastWeekInvoices = invoices.filter(invoice =>
      isBetween(readInvoiceDate(invoice), lastWeekStart, thisWeekStart)
    );

    const thisWeekSales = sumInvoices(thisWeekInvoices);
    const lastWeekSales = sumInvoices(lastWeekInvoices);

    setText("thisWeekSalesValue", money(thisWeekSales));
    setText("lastWeekSalesValue", money(lastWeekSales));

    setText(
      "thisWeekInvoiceCount",
      `${number(thisWeekInvoices.length)} invoices`
    );

    setText(
      "weeklySalesChange",
      lastWeekSales > 0
        ? `${percent(((thisWeekSales - lastWeekSales) / lastWeekSales) * 100)} vs last week`
        : "No previous-week baseline"
    );

    setText(
      "weeklySalesSummary",
      `This week: ${money(thisWeekSales)} · Last week: ${money(lastWeekSales)}`
    );

    const chart = $("weeklySalesChart");

    if (!chart) return;

    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const days = [];

    for (let index = 0; index < 7; index += 1) {
      const start = addDays(thisWeekStart, index);
      const end = addDays(start, 1);

      const previousStart = addDays(lastWeekStart, index);
      const previousEnd = addDays(previousStart, 1);

      const currentSales = sumInvoices(invoices.filter(invoice =>
        isBetween(readInvoiceDate(invoice), start, end)
      ));

      const previousSales = sumInvoices(invoices.filter(invoice =>
        isBetween(readInvoiceDate(invoice), previousStart, previousEnd)
      ));

      days.push({
        label: labels[index],
        currentSales,
        previousSales
      });
    }

    const maxValue = Math.max(
      1,
      ...days.flatMap(day => [day.currentSales, day.previousSales])
    );

    const width = 700;
    const height = 230;
    const top = 18;
    const bottom = 178;
    const plotHeight = bottom - top;
    const groupWidth = 100;
    const barWidth = 24;

    const gridLines = [0, 1, 2, 3, 4].map(index => {
      const y = top + (plotHeight / 4) * index;

      return `<line x1="24" y1="${y}" x2="690" y2="${y}" class="dashboard-chart-grid-line"/>`;
    }).join("");

    const bars = days.map((day, index) => {
      const x = 34 + (index * groupWidth);
      const currentHeight = (day.currentSales / maxValue) * plotHeight;
      const previousHeight = (day.previousSales / maxValue) * plotHeight;

      const currentY = bottom - currentHeight;
      const previousY = bottom - previousHeight;

      return `
        <g class="dashboard-chart-day">
          <rect
            class="dashboard-chart-current"
            x="${x}"
            y="${currentY}"
            width="${barWidth}"
            height="${Math.max(0, currentHeight)}"
            rx="3"
          >
            <title>${escapeHTML(day.label)} this week: ${escapeHTML(money(day.currentSales))}</title>
          </rect>

          <rect
            class="dashboard-chart-previous"
            x="${x + barWidth + 5}"
            y="${previousY}"
            width="${barWidth}"
            height="${Math.max(0, previousHeight)}"
            rx="3"
          >
            <title>${escapeHTML(day.label)} last week: ${escapeHTML(money(day.previousSales))}</title>
          </rect>

          <text class="dashboard-chart-label" x="${x + 26}" y="199" text-anchor="middle">
            ${escapeHTML(day.label)}
          </text>
        </g>
      `;
    }).join("");

    chart.innerHTML = `
      <svg
        class="dashboard-sales-svg"
        viewBox="0 0 ${width} ${height}"
        role="img"
        aria-label="Daily sales comparison for this week and last week"
        xmlns="http://www.w3.org/2000/svg"
      >
        ${gridLines}
        ${bars}
      </svg>
    `;
  }

  // --------------------------------------------------
  // PAYMENT METHOD SPLIT
  // --------------------------------------------------

  function renderPaymentSplit(invoices, now) {
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);

    const todaysInvoices = invoices.filter(invoice =>
      isBetween(readInvoiceDate(invoice), today, tomorrow)
    );

    const totals = new Map();

    for (const invoice of todaysInvoices) {
      const method = readPaymentMethod(invoice);
      totals.set(method, (totals.get(method) || 0) + readAmount(invoice));
    }

    const entries = [...totals.entries()]
      .sort((a, b) => b[1] - a[1]);

    const total = entries.reduce((sum, [, amount]) => sum + amount, 0);

    const bar = $("paymentSplitBar");

    if (bar) {
      let start = 0;

      const segments = entries.slice(0, 5).map(([method, amount], index) => {
        const share = total > 0 ? (amount / total) * 100 : 0;
        const x = start;
        const segmentWidth = Math.max(0, share * 10);

        start += segmentWidth;

        return `
          <rect
            class="dashboard-payment-segment payment-segment-${index + 1}"
            x="${x}"
            y="0"
            width="${segmentWidth}"
            height="22"
          >
            <title>${escapeHTML(method)}: ${escapeHTML(money(amount))}</title>
          </rect>
        `;
      }).join("");

      bar.innerHTML = entries.length
        ? `
          <svg
            class="dashboard-payment-svg"
            viewBox="0 0 1000 22"
            role="img"
            aria-label="Today's payment method distribution"
            xmlns="http://www.w3.org/2000/svg"
          >
            ${segments}
          </svg>
        `
        : "<span>No payment data recorded today.</span>";
    }

    const legend = $("paymentSplitLegend");

    if (legend) {
      legend.innerHTML = entries.length
        ? entries.map(([method, amount]) => {
            const share = total > 0 ? (amount / total) * 100 : 0;

            return `
              <div class="split-legend-item">
                <div class="sl-left">
                  <span class="sl-name">${escapeHTML(method)}</span>
                </div>
                <span class="sl-val">
                  ${escapeHTML(money(amount))} · ${share.toFixed(1)}%
                </span>
              </div>
            `;
          }).join("")
        : "<p>No invoice payment methods found for today.</p>";
    }
  }

  // --------------------------------------------------
  // MONTHLY REPORT
  // --------------------------------------------------

  function renderMonthlyTrend(invoices, now) {
    const rows = [];

    for (let offset = 5; offset >= 0; offset -= 1) {
      const start = new Date(
        now.getFullYear(),
        now.getMonth() - offset,
        1
      );

      const end = new Date(
        now.getFullYear(),
        now.getMonth() - offset + 1,
        1
      );

      const selected = invoices.filter(invoice =>
        isBetween(readInvoiceDate(invoice), start, end)
      );

      rows.push({
        label: start.toLocaleDateString("en-IN", {
          month: "short",
          year: "numeric"
        }),
        sales: sumInvoices(selected)
      });
    }

    const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const currentInvoices = invoices.filter(invoice =>
      isBetween(readInvoiceDate(invoice), currentMonth, nextMonth)
    );

    const previousInvoices = invoices.filter(invoice =>
      isBetween(readInvoiceDate(invoice), previousMonth, currentMonth)
    );

    const currentSales = sumInvoices(currentInvoices);
    const previousSales = sumInvoices(previousInvoices);

    setText(
      "monthlyReportPeriod",
      currentMonth.toLocaleDateString("en-IN", {
        month: "long",
        year: "numeric"
      })
    );

    setText("monthlySalesValue", money(currentSales));
    setText("monthlyInvoicesValue", number(currentInvoices.length));

    setText(
      "monthlySalesChange",
      previousSales > 0
        ? percent(((currentSales - previousSales) / previousSales) * 100)
        : "No previous-month baseline"
    );

    const list = $("monthlyTrendList");

    if (list) {
      list.innerHTML = rows.map(row => `
        <div class="cat-item">
          <div class="cat-row">
            <span class="cat-name">${escapeHTML(row.label)}</span>
            <span class="cat-val">${escapeHTML(money(row.sales))}</span>
          </div>
        </div>
      `).join("");
    }
  }

  // --------------------------------------------------
  // TOP CATEGORIES
  // --------------------------------------------------

  function resolveCategory(item, productLookup, categoryLookup) {
    const productId = String(
      item.productId || item.id || item.productKey || ""
    );

    const product = productLookup.get(productId);

    const categoryValue =
      product?.categoryId ||
      product?.categoryName ||
      product?.category ||
      item.categoryId ||
      item.categoryName ||
      item.category ||
      "";

    const categoryId = String(categoryValue);

    if (categoryLookup.has(categoryId)) {
      const category = categoryLookup.get(categoryId);

      return String(
        category.name ||
        category.categoryName ||
        categoryId
      );
    }

    return categoryId.trim() || "Uncategorised";
  }

  function renderTopCategories(invoices) {
    const productLookup = new Map(
      state.products.map(product => [
        String(product.id || product.key || product.productId || ""),
        product
      ])
    );

    const categoryLookup = new Map(
      state.categories.map(category => [
        String(category.id || category.key || category.categoryId || ""),
        category
      ])
    );

    const sales = new Map();

    for (const invoice of invoices) {
      for (const item of readItems(invoice)) {
        const category = resolveCategory(item, productLookup, categoryLookup);

        sales.set(
          category,
          (sales.get(category) || 0) + itemTotal(item)
        );
      }
    }

    const entries = [...sales.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const total = entries.reduce((sum, [, amount]) => sum + amount, 0);
    const list = $("topCategoriesList");

    if (!list) return;

    list.innerHTML = entries.length
      ? entries.map(([name, amount]) => {
          const share = total > 0 ? (amount / total) * 100 : 0;

          return `
            <div class="cat-item">
              <div class="cat-row">
                <span class="cat-name">${escapeHTML(name)}</span>
                <span class="cat-val">${escapeHTML(money(amount))}</span>
              </div>
              <div class="cat-row">
                <span class="cat-val">${share.toFixed(1)}% of listed category sales</span>
              </div>
            </div>
          `;
        }).join("")
      : "<p>No category sales can be calculated from the recorded invoice items.</p>";
  }

  // --------------------------------------------------
  // TOP PRODUCTS
  // --------------------------------------------------

  function renderTopProducts(invoices) {
    const productsByName = new Map();

    for (const invoice of invoices) {
      for (const item of readItems(invoice)) {
        const name = itemName(item);

        const entry = productsByName.get(name) || {
          quantity: 0,
          sales: 0
        };

        entry.quantity += itemQuantity(item);
        entry.sales += itemTotal(item);

        productsByName.set(name, entry);
      }
    }

    const entries = [...productsByName.entries()]
      .sort((a, b) => b[1].quantity - a[1].quantity)
      .slice(0, 5);

    const list = $("topProductsList");

    if (!list) return;

    list.innerHTML = entries.length
      ? entries.map(([name, values], index) => `
          <div class="prod-item">
            <div class="prod-rank">${index + 1}</div>
            <div class="prod-info">
              <div class="p-name">
                <span>${escapeHTML(name)}</span>
                <span>${number(values.quantity)} sold</span>
              </div>
              <div class="p-name">
                <span>${escapeHTML(money(values.sales))} sales</span>
              </div>
            </div>
          </div>
        `).join("")
      : "<p>No product sales found in saved invoice line items.</p>";
  }

  // --------------------------------------------------
  // HOURLY ACTIVITY
  // --------------------------------------------------

  function renderHourlyActivity(invoices, now) {
    const today = startOfDay(now);
    const tomorrow = addDays(today, 1);

    const todaysInvoices = invoices.filter(invoice =>
      isBetween(readInvoiceDate(invoice), today, tomorrow)
    );

    const counts = Array(24).fill(0);

    for (const invoice of todaysInvoices) {
      const date = readInvoiceDate(invoice);

      if (date) counts[date.getHours()] += 1;
    }

    const hours = [
      8, 9, 10, 11, 12, 13, 14, 15,
      16, 17, 18, 19, 20, 21, 22, 23
    ];

    const activeHours = counts
      .map((count, hour) => ({ count, hour }))
      .filter(item => item.count > 0);

    const peak = activeHours.length
      ? activeHours.reduce((best, current) =>
          current.count > best.count ? current : best
        )
      : null;

    const heatmap = $("hourlySalesHeatmap");

    if (heatmap) {
      const max = Math.max(1, ...hours.map(hour => counts[hour]));

      heatmap.innerHTML = hours.map(hour => {
        const level = counts[hour] === 0
          ? 0
          : Math.min(5, Math.ceil((counts[hour] / max) * 5));

        const label = `${String(hour).padStart(2, "0")}:00 — ${counts[hour]} invoices`;

        return `
          <div
            class="hour-cell${level ? ` level-${level}` : ""}"
            title="${escapeHTML(label)}"
            aria-label="${escapeHTML(label)}"
          >
            ${hour}
          </div>
        `;
      }).join("");
    }

    setText(
      "hourlySalesSummary",
      peak
        ? `Peak activity: ${String(peak.hour).padStart(2, "0")}:00 (${number(peak.count)} invoices).`
        : "No timestamped invoices found for today."
    );

    setText("hourlySalesLabels", "Hours shown in 24-hour format");
  }

  // --------------------------------------------------
  // RECENT INVOICES
  // --------------------------------------------------

  function renderRecentInvoices(invoices) {
    const body = $("recentInvoicesBody");

    if (!body) return;

    const recent = [...invoices]
      .sort((a, b) => {
        const dateA = readInvoiceDate(a)?.getTime() || 0;
        const dateB = readInvoiceDate(b)?.getTime() || 0;

        return dateB - dateA;
      })
      .slice(0, 8);

    if (!recent.length) {
      body.innerHTML = `
        <tr>
          <td colspan="5">No invoices have been recorded yet.</td>
        </tr>
      `;

      setText("recentInvoicesStatus", "No invoice records found.");

      return;
    }

    body.innerHTML = recent.map(invoice => {
      const date = readInvoiceDate(invoice);
      const status = readInvoiceStatus(invoice);

      const dateLabel = date
        ? date.toLocaleString("en-IN", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })
        : "Date unavailable";

      const statusClass = status === "Cancelled"
        ? "pending"
        : status === "Recorded"
          ? "paid"
          : "draft";

      const customer = readCustomer(invoice);
      const firstLetter =
        customer.trim().charAt(0).toUpperCase() || "—";

      return `
        <tr>
          <td class="mono">${escapeHTML(readInvoiceNumber(invoice))}</td>
          <td>
            <div class="cust">
              <div class="cust-avatar">${escapeHTML(firstLetter)}</div>
              <div>
                <div class="cust-name">${escapeHTML(customer)}</div>
                <div class="cust-sub">${escapeHTML(readPaymentMethod(invoice))}</div>
              </div>
            </div>
          </td>
          <td>${escapeHTML(dateLabel)}</td>
          <td class="num">${escapeHTML(money(readAmount(invoice)))}</td>
          <td><span class="pill ${statusClass}">${escapeHTML(status)}</span></td>
        </tr>
      `;
    }).join("");

    setText(
      "recentInvoicesStatus",
      `Showing ${recent.length} most recent invoice records.`
    );
  }

  // --------------------------------------------------
  // DASHBOARD RENDERING
  // --------------------------------------------------

  function renderAll() {
    const invoices = validInvoices();
    const now = new Date();

    applyBusinessProfile();

    setText(
      "dashboardDateLabel",
      now.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric"
      })
    );

    renderSummary(invoices, now);
    renderWeeklySales(invoices, now);
    renderPaymentSplit(invoices, now);
    renderMonthlyTrend(invoices, now);
    renderTopCategories(invoices);
    renderTopProducts(invoices);
    renderHourlyActivity(invoices, now);
    renderRecentInvoices(invoices);

    if (state.errors.size > 0) {
      const failedPaths = [...state.errors.keys()].join(", ");

      setStatus(
        `Database read failed for: ${failedPaths}. Check Firebase Rules and Console.`,
        "error"
      );

      return;
    }

    if (
      ["invoices", "products", "categories", "settings"].every(
        name => state.loaded.has(name)
      )
    ) {
      setStatus(
        "Dashboard connected. Live database updates are enabled.",
        "success"
      );
    } else {
      setStatus("Reading live business records…", "info");
    }
  }

  // --------------------------------------------------
  // REALTIME DATABASE LISTENERS
  // --------------------------------------------------

  function setNodeData(name, value) {
    state.loaded.add(name);
    state.errors.delete(name);

    if (name === "invoices") {
      state.invoices = objectToArray(value);
    }

    if (name === "products") {
      state.products = objectToArray(value);
    }

    if (name === "categories") {
      state.categories = objectToArray(value);
    }

    if (name === "settings") {
      state.settings =
        value && typeof value === "object" ? value : {};
    }

    renderAll();
  }

  function setNodeError(name, error) {
    state.errors.set(name, error);
    state.loaded.add(name);

    console.error(`[Dashboard] Cannot read ${name}:`, error);

    renderAll();
  }

  function subscribe(dbSdk, db, path, name) {
    const databaseRef = dbSdk.ref(db, path);

    const unsubscribe = dbSdk.onValue(
      databaseRef,
      snapshot => setNodeData(name, snapshot.val()),
      error => setNodeError(name, error)
    );

    if (typeof unsubscribe === "function") {
      state.unsubscribers.push(unsubscribe);
    }
  }

  // --------------------------------------------------
  // FIREBASE INITIALIZATION
  // --------------------------------------------------

  function waitForFirstAuthState(authSdk, auth) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = null;

      const timeout = window.setTimeout(() => {
        if (settled) return;

        settled = true;

        if (typeof unsubscribe === "function") {
          unsubscribe();
        }

        reject(new Error("Timed out while checking the signed-in account."));
      }, 15000);

      const finish = (callback, value) => {
        if (settled) return;

        settled = true;
        window.clearTimeout(timeout);

        if (typeof unsubscribe === "function") {
          unsubscribe();
        }

        callback(value);
      };

      unsubscribe = authSdk.onAuthStateChanged(
        auth,
        user => finish(resolve, user),
        error => finish(reject, error)
      );
    });
  }

  async function waitForFirebase() {
    const firebase = window.restaurantFirebase;

    if (!firebase) {
      throw new Error("window.restaurantFirebase was not initialized.");
    }

    if (firebase.ready && typeof firebase.ready.then === "function") {
      await firebase.ready;
    }

    if (firebase.error) {
      throw firebase.error;
    }

    const auth = firebase.auth;
    const db = firebase.db;
    const authSdk = firebase.sdk?.auth;
    const dbSdk = firebase.sdk?.database;

    if (!auth || !db || !authSdk || !dbSdk) {
      throw new Error("Firebase Auth or Realtime Database is unavailable.");
    }

    if (
      typeof authSdk.onAuthStateChanged !== "function" ||
      typeof dbSdk.ref !== "function" ||
      typeof dbSdk.onValue !== "function"
    ) {
      throw new Error("A required Firebase SDK method is unavailable.");
    }

    return { auth, db, authSdk, dbSdk };
  }

  async function initialize() {
    if (state.initialized) return;

    state.initialized = true;

    try {
      setStatus("Initializing Firebase connection…", "info");

      const { auth, db, authSdk, dbSdk } = await waitForFirebase();
      const user = await waitForFirstAuthState(authSdk, auth);

      if (!user) {
        setStatus(
          "Sign-in required. Please sign in to access the dashboard.",
          "error"
        );

        return;
      }

      if (user.uid !== OWNER_UID) {
        setStatus("Access denied for this account.", "error");

        console.error(
          "[Dashboard] Signed-in user is not the configured owner."
        );

        return;
      }

      setStatus("Reading live business records…", "info");

      subscribe(dbSdk, db, `${ROOT_PATH}/invoices`, "invoices");
      subscribe(dbSdk, db, `${ROOT_PATH}/products`, "products");
      subscribe(dbSdk, db, `${ROOT_PATH}/categories`, "categories");
      subscribe(dbSdk, db, `${ROOT_PATH}/settings`, "settings");
    } catch (error) {
      console.error("[Dashboard] Initialization failed:", error);

      setStatus(
        `Dashboard initialization failed: ${error?.message || "Unknown error"}`,
        "error"
      );
    }
  }

  // --------------------------------------------------
  // EXPORT INVOICE SUMMARY
  // --------------------------------------------------

  function bindExport() {
    const button = $("exportDashboardBtn");

    if (!button) return;

    button.addEventListener("click", () => {
      const rows = validInvoices();

      if (!rows.length) {
        setStatus("There are no invoice records to export.", "info");
        return;
      }

      const columns = [
        "Invoice Number",
        "Customer",
        "Invoice Date",
        "Payment Method",
        "Grand Total",
        "Status"
      ];

      const csvCell = value =>
        `"${String(value ?? "").replace(/"/g, '""')}"`;

      const csvRows = rows.map(invoice => [
        readInvoiceNumber(invoice),
        readCustomer(invoice),
        invoice.invoiceDate || invoice.createdAt || invoice.date || "",
        readPaymentMethod(invoice),
        readAmount(invoice),
        readInvoiceStatus(invoice)
      ]);

      const csv = [
        columns.map(csvCell).join(","),
        ...csvRows.map(row => row.map(csvCell).join(","))
      ].join("\r\n");

      const blob = new Blob(["\uFEFF", csv], {
        type: "text/csv;charset=utf-8;"
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download =
        `invoice-dashboard-${new Date().toISOString().slice(0, 10)}.csv`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);
    });
  }

  // --------------------------------------------------
  // MOBILE SIDEBAR
  // --------------------------------------------------

  function bindNavigation() {
    const menu = $("menuBtn");
    const sidebar = $("sidebar");
    const overlay = $("overlay");

    if (!menu || !sidebar || !overlay) return;

    function closeMenu() {
      sidebar.classList.remove("open");
      overlay.classList.remove("open");
      menu.setAttribute("aria-expanded", "false");
    }

    menu.addEventListener("click", () => {
      const open = sidebar.classList.toggle("open");

      overlay.classList.toggle("open", open);
      menu.setAttribute("aria-expanded", String(open));
    });

    overlay.addEventListener("click", closeMenu);

    sidebar.querySelectorAll("a.nav-item").forEach(link => {
      link.addEventListener("click", closeMenu);
    });
  }

  // --------------------------------------------------
  // CLEANUP
  // --------------------------------------------------

  window.addEventListener("pagehide", () => {
    for (const unsubscribe of state.unsubscribers) {
      try {
        unsubscribe();
      } catch (error) {
        console.warn(
          "[Dashboard] Listener cleanup warning:",
          error
        );
      }
    }

    state.unsubscribers = [];
  });

  // --------------------------------------------------
  // STARTUP
  // --------------------------------------------------

  bindExport();
  bindNavigation();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, {
      once: true
    });
  } else {
    initialize();
  }
})();
