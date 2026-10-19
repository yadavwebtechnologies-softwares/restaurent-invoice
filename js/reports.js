/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Reports, Statistics, Sales Graph and CSV Export
   Database root: restaurantBilling/
   Safe manual refresh; preserves date filters
   SVG graph uses real invoice data; no external chart library
   Shared dashboard loading animation
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const PATHS = Object.freeze({
    invoices: "restaurantBilling/invoices",
    products: "restaurantBilling/products",
    categories: "restaurantBilling/categories",
    business: "restaurantBilling/settings/businessProfile"
  });

  const LOADING_REVEAL_MS = 270;

  const $ = (id) => document.getElementById(id);

  const state = {
    api: null,
    invoices: [],
    products: {},
    categories: {},
    businessProfile: {},
    startDate: "",
    endDate: "",
    loading: true,
    error: "",
    initialized: false,
    disposed: false,
    databaseConnected: false,
    unsubscribers: [],
    unregisterPageRefresh: null,

    // Shared loading animation state
    loadingPhase: "loading",
    revealTimer: null
  };

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* ---------------------------------------------------------
     1. Shared dashboard loading animation
     --------------------------------------------------------- */

  function revealReportsPage() {
    if (
      state.disposed ||
      state.loadingPhase !== "loading"
    ) {
      return;
    }

    state.loadingPhase = "revealing";

    document.body.classList.remove("is-dashboard-loading");
    document.body.classList.add("is-dashboard-revealing");

    clearTimeout(state.revealTimer);

    state.revealTimer = window.setTimeout(() => {
      document.body.classList.remove("is-dashboard-revealing");

      state.loadingPhase = "complete";
      state.revealTimer = null;
    }, LOADING_REVEAL_MS);
  }

  function finishReportsLoadingImmediately() {
    clearTimeout(state.revealTimer);
    state.revealTimer = null;

    document.body.classList.remove(
      "is-dashboard-loading",
      "is-dashboard-revealing"
    );

    state.loadingPhase = "complete";
  }

  /* ---------------------------------------------------------
     2. Common helpers
     --------------------------------------------------------- */

  function escapeHTML(value) {
    if (window.restaurantUI?.escapeHTML) {
      return window.restaurantUI.escapeHTML(String(value ?? ""));
    }

    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function formatCurrency(value) {
    const amount = Number(value);

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2
    }).format(Number.isFinite(amount) ? amount : 0);
  }

  function formatNumber(value) {
    const number = Number(value);

    return new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 2
    }).format(Number.isFinite(number) ? number : 0);
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value === "string" && value.trim()) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  function getInvoiceDate(invoice) {
    return parseDate(
      invoice.createdAtMs ??
      invoice.createdAt ??
      invoice.timestamp ??
      invoice.date ??
      null
    );
  }

  function getInvoiceStatus(invoice) {
    const status = String(
      invoice.recordStatus ?? invoice.status ?? "valid"
    ).trim().toLowerCase();

    return [
      "cancelled",
      "canceled",
      "void",
      "voided"
    ].includes(status) ? "cancelled" : "valid";
  }

  function getInvoiceTotal(invoice) {
    const total = Number(
      invoice.grandTotal ?? invoice.total ?? invoice.amount ?? 0
    );

    return Number.isFinite(total) ? total : 0;
  }

  function getItems(invoice) {
    return Array.isArray(invoice.items) ? invoice.items : [];
  }

  function getItemName(item) {
    return String(
      item.name ?? item.productName ?? item.itemName ?? "Unnamed item"
    );
  }

  function getItemQuantity(item) {
    const quantity = Number(item.quantity ?? item.qty ?? 0);
    return Number.isFinite(quantity) ? quantity : 0;
  }

  function getItemPrice(item) {
    const price = Number(item.price ?? item.unitPrice ?? 0);
    return Number.isFinite(price) ? price : 0;
  }

  function getItemAmount(item) {
    const storedAmount = Number(item.lineTotal ?? item.total ?? item.amount);

    return Number.isFinite(storedAmount)
      ? storedAmount
      : getItemQuantity(item) * getItemPrice(item);
  }

  function getTax(invoice) {
    return Number(invoice.taxAmount ?? invoice.tax ?? 0) || 0;
  }

  function getDiscount(invoice) {
    return Number(
      invoice.discountAmount ?? invoice.discount ?? 0
    ) || 0;
  }

  function getPaymentMethod(invoice) {
    return String(
      invoice.paymentMethod ??
      invoice.paymentType ??
      invoice.paymentMode ??
      ""
    ).trim();
  }

  function localDateString(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function displayDate(value) {
    const date = parseDate(value);
    if (!date) return "—";

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function setStatus(message, isError = false) {
    const element = $("reportsPageStatus");
    if (!element) return;

    element.textContent = message;
    element.dataset.state = isError ? "error" : "normal";
    element.classList.remove("is-connected", "is-error", "is-warning");

    if (isError) {
      element.classList.add("is-error");
      element.setAttribute("role", "alert");
    } else {
      element.setAttribute("role", "status");
    }
  }

  function setConnectionStatus(message, isError = false) {
    const element = $("sidebarConnectionStatus");
    if (!element) return;

    element.textContent = message;
    element.dataset.state = isError ? "error" : "normal";

    element.classList.remove("is-connected", "is-error", "is-warning");

    if (isError) {
      element.classList.add("is-error");
    } else if (state.databaseConnected) {
      element.classList.add("is-connected");
    } else {
      element.classList.add("is-warning");
    }
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value ?? "");
  }

  /* ---------------------------------------------------------
     3. Branding and data normalization
     --------------------------------------------------------- */

  function updateBranding() {
    const profile = state.businessProfile || {};

    const businessName = String(
      profile.businessName ?? profile.name ?? ""
    ).trim();

    const tagline = String(
      profile.businessTagline ?? profile.tagline ?? ""
    ).trim();

    const name = businessName || "Restaurant Billing";

    document.querySelectorAll("[data-business-name]").forEach((element) => {
      element.textContent = name;
    });

    document.querySelectorAll("[data-business-tagline]").forEach((element) => {
      element.textContent = tagline || "Billing and Invoice Software";
    });

    setText("sidebarBusinessName", name);
    setText("businessFooterName", name);

    const mark = $("brandMark");
    if (mark) mark.textContent = name.charAt(0).toUpperCase();
  }

  function updateOwnerProfile(user) {
    const name = String(
      user?.displayName ?? user?.email ?? "Owner"
    ).trim();

    setText("ownerDisplayName", name);

    const avatar = $("ownerAvatar");
    if (avatar) {
      avatar.textContent = name.charAt(0).toUpperCase() || "O";
    }
  }

  function normaliseRecords(raw) {
    if (!raw || typeof raw !== "object") return [];

    const records = Array.isArray(raw)
      ? raw.map((value, index) => [String(index), value])
      : Object.entries(raw);

    return records
      .filter(([, value]) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      )
      .map(([key, value]) => ({
        ...value,
        _databaseKey: key
      }))
      .filter((record) => record.ownerUid === OWNER_UID);
  }

  function normaliseLookup(raw) {
    if (!raw || typeof raw !== "object") return {};

    const records = Array.isArray(raw)
      ? raw.map((value, index) => [String(index), value])
      : Object.entries(raw);

    const result = {};

    records.forEach(([key, value]) => {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        value.ownerUid === OWNER_UID
      ) {
        result[key] = value;
      }
    });

    return result;
  }

  function getFilteredInvoices() {
    const start = state.startDate
      ? new Date(`${state.startDate}T00:00:00`)
      : null;

    const end = state.endDate
      ? new Date(`${state.endDate}T23:59:59.999`)
      : null;

    return state.invoices.filter((invoice) => {
      if (getInvoiceStatus(invoice) !== "valid") return false;

      const date = getInvoiceDate(invoice);

      if (!date) return !start && !end;
      if (start && date < start) return false;
      if (end && date > end) return false;

      return true;
    });
  }

  function getCancelledCount() {
    const start = state.startDate
      ? new Date(`${state.startDate}T00:00:00`)
      : null;

    const end = state.endDate
      ? new Date(`${state.endDate}T23:59:59.999`)
      : null;

    return state.invoices.filter((invoice) => {
      if (getInvoiceStatus(invoice) !== "cancelled") return false;

      const date = getInvoiceDate(invoice);
      if (!date) return !start && !end;
      if (start && date < start) return false;
      if (end && date > end) return false;

      return true;
    }).length;
  }

  /* ---------------------------------------------------------
     4. Report calculations
     --------------------------------------------------------- */

  function buildDailyReport(invoices) {
    const daily = new Map();

    invoices.forEach((invoice) => {
      const date = getInvoiceDate(invoice);
      if (!date) return;

      const key = localDateString(date);

      if (!daily.has(key)) {
        daily.set(key, {
          date: key,
          invoiceCount: 0,
          sales: 0,
          tax: 0,
          discount: 0,
          quantity: 0
        });
      }

      const entry = daily.get(key);

      entry.invoiceCount += 1;
      entry.sales += getInvoiceTotal(invoice);
      entry.tax += getTax(invoice);
      entry.discount += getDiscount(invoice);

      getItems(invoice).forEach((item) => {
        entry.quantity += getItemQuantity(item);
      });
    });

    return [...daily.values()].sort((a, b) =>
      b.date.localeCompare(a.date)
    );
  }

  function buildProductReport(invoices) {
    const products = new Map();

    invoices.forEach((invoice) => {
      getItems(invoice).forEach((item) => {
        const name = getItemName(item).trim() || "Unnamed item";
        const key = String(
          item.productId ?? item.itemId ?? name.toLowerCase()
        );

        if (!products.has(key)) {
          products.set(key, {
            name,
            quantity: 0,
            revenue: 0
          });
        }

        const product = products.get(key);

        product.quantity += getItemQuantity(item);
        product.revenue += getItemAmount(item);
      });
    });

    return [...products.values()].sort((a, b) =>
      b.revenue - a.revenue
    );
  }

  function buildPaymentReport(invoices) {
    const payments = new Map();

    invoices.forEach((invoice) => {
      const method = getPaymentMethod(invoice) || "Not recorded";

      if (!payments.has(method)) {
        payments.set(method, {
          method,
          invoiceCount: 0,
          total: 0
        });
      }

      const entry = payments.get(method);

      entry.invoiceCount += 1;
      entry.total += getInvoiceTotal(invoice);
    });

    return [...payments.values()].sort((a, b) =>
      b.total - a.total
    );
  }

  /* ---------------------------------------------------------
     5. Summary cards
     --------------------------------------------------------- */

  function renderSummary(invoices, daily, products) {
    const totalSales = invoices.reduce(
      (sum, invoice) => sum + getInvoiceTotal(invoice), 0
    );

    const totalTax = invoices.reduce(
      (sum, invoice) => sum + getTax(invoice), 0
    );

    const totalDiscount = invoices.reduce(
      (sum, invoice) => sum + getDiscount(invoice), 0
    );

    const itemsSold = invoices.reduce((sum, invoice) =>
      sum + getItems(invoice).reduce(
        (itemSum, item) => itemSum + getItemQuantity(item), 0
      ), 0
    );

    setText("reportTotalSales", formatCurrency(totalSales));
    setText("reportInvoiceCount", formatNumber(invoices.length));

    setText(
      "reportAverageInvoice",
      formatCurrency(invoices.length ? totalSales / invoices.length : 0)
    );

    setText("reportCancelledCount", formatNumber(getCancelledCount()));
    setText("reportItemsSold", formatNumber(itemsSold));
    setText("reportTaxCollected", formatCurrency(totalTax));
    setText("reportDiscountTotal", formatCurrency(totalDiscount));
    setText("reportProductCount", formatNumber(products.length));
    setText("reportActiveDays", formatNumber(daily.length));
  }

  /* ---------------------------------------------------------
     6. Sales trend graph (native SVG, real report data)
     --------------------------------------------------------- */

  function createSVGElement(tag, attributes, text) {
    const element = document.createElementNS(SVG_NS, tag);

    Object.entries(attributes || {}).forEach(([key, value]) => {
      element.setAttribute(key, String(value));
    });

    if (text !== undefined) {
      element.textContent = String(text);
    }

    return element;
  }

  function ensureStatisticsSection() {
    let section = $("reportStatisticsGraphSection");

    if (section) return section;

    section = document.createElement("section");
    section.id = "reportStatisticsGraphSection";
    section.className = "dashboard-section report-statistics-section";
    section.setAttribute("aria-labelledby", "reportStatisticsGraphHeading");
    section.setAttribute("data-loading-surface", "");

    const heading = document.createElement("div");
    heading.className = "section-heading";

    const headingText = document.createElement("div");

    const title = document.createElement("h2");
    title.id = "reportStatisticsGraphHeading";
    title.textContent = "Daily Sales Trend";

    const description = document.createElement("p");
    description.className = "muted-text";
    description.textContent =
      "Daily sales based on valid invoices in the selected report period.";

    headingText.append(title, description);
    heading.appendChild(headingText);

    const panel = document.createElement("div");
    panel.className = "panel report-chart-panel";

    const chartContainer = document.createElement("div");
    chartContainer.id = "reportSalesChart";
    chartContainer.className = "report-chart-viewport";

    chartContainer.setAttribute("role", "group");
    chartContainer.setAttribute(
      "aria-label",
      "Daily sales trend graph"
    );

    const note = document.createElement("p");
    note.id = "reportSalesChartNote";
    note.className = "muted-text report-chart-note";

    panel.append(chartContainer, note);
    section.append(heading, panel);

    /*
     * Insert the graph before the daily-sales table when possible.
     * Otherwise put it near the beginning of the report content.
     */
    const dailyTableBody = $("dailySalesTableBody");
    const targetSection = dailyTableBody?.closest("section");
    const content = document.querySelector("main.content") ||
      document.querySelector(".content") ||
      document.querySelector("main");

    if (targetSection?.parentNode) {
      targetSection.parentNode.insertBefore(section, targetSection);
    } else if (content) {
      content.appendChild(section);
    }

    return section;
  }

  function renderSalesTrendChart(daily) {
    ensureStatisticsSection();

    const container = $("reportSalesChart");
    const note = $("reportSalesChartNote");

    if (!container) return;

    container.replaceChildren();

    if (!daily.length) {
      const message = document.createElement("p");
      message.className = "empty-state";
      message.textContent =
        "No daily sales data is available for the selected period.";

      container.appendChild(message);

      if (note) {
        note.textContent =
          "The graph will appear when valid invoice data is available.";
      }

      return;
    }

    /*
     * Display up to 14 most recent dates in chronological order.
     * All summary values and tables continue to use the full filter.
     */
    const chartData = daily
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);

    const width = 900;
    const height = 330;

    const margin = {
      top: 24,
      right: 30,
      bottom: 58,
      left: 88
    };

    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;

    const maximumSales = Math.max(
      1,
      ...chartData.map((entry) => Math.max(0, entry.sales))
    );

    const svg = createSVGElement("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height: "auto",
      role: "img",
      "aria-labelledby": "reportSalesChartTitle reportSalesChartDescription",
      preserveAspectRatio: "xMidYMid meet"
    });

    svg.appendChild(
      createSVGElement(
        "title",
        { id: "reportSalesChartTitle" },
        "Daily sales trend"
      )
    );

    svg.appendChild(
      createSVGElement(
        "desc",
        { id: "reportSalesChartDescription" },
        "Line graph showing daily sales from valid invoices for up to 14 recent dates in the selected period."
      )
    );

    const compactCurrency = (value) =>
      "₹" + new Intl.NumberFormat("en-IN", {
        notation: "compact",
        maximumFractionDigits: 1
      }).format(value);

    /* Horizontal grid and Y-axis labels. */
    for (let i = 0; i <= 4; i++) {
      const fraction = i / 4;
      const y = margin.top + fraction * plotHeight;
      const value = maximumSales * (1 - fraction);

      svg.appendChild(
        createSVGElement("line", {
          x1: margin.left,
          y1: y,
          x2: width - margin.right,
          y2: y,
          stroke: "#d1d5db",
          "stroke-width": 1
        })
      );

      svg.appendChild(
        createSVGElement("text", {
          x: margin.left - 12,
          y: y + 4,
          fill: "#4b5563",
          "font-size": 12,
          "text-anchor": "end"
        }, compactCurrency(value))
      );
    }

    const xForIndex = (index) => {
      if (chartData.length === 1) {
        return margin.left + plotWidth / 2;
      }

      return margin.left +
        (index / (chartData.length - 1)) * plotWidth;
    };

    const yForSales = (sales) =>
      margin.top +
      (1 - Math.max(0, sales) / maximumSales) * plotHeight;

    const points = chartData.map((entry, index) => ({
      x: xForIndex(index),
      y: yForSales(entry.sales),
      entry
    }));

    const pathData = points.map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
    ).join(" ");

    svg.appendChild(
      createSVGElement("path", {
        d: pathData,
        fill: "none",
        stroke: "#202124",
        "stroke-width": 3,
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    );

    points.forEach((point) => {
      const circle = createSVGElement("circle", {
        cx: point.x,
        cy: point.y,
        r: 5,
        fill: "#ffffff",
        stroke: "#202124",
        "stroke-width": 2
      });

      circle.appendChild(
        createSVGElement(
          "title",
          {},
          `${displayDate(point.entry.date)}: ${formatCurrency(point.entry.sales)}`
        )
      );

      svg.appendChild(circle);
    });

    /*
     * Limit labels on wider date ranges so that dates do not overlap.
     */
    const labelStep = chartData.length <= 7
      ? 1
      : Math.ceil(chartData.length / 7);

    points.forEach((point, index) => {
      const isLast = index === points.length - 1;

      if (
        index % labelStep !== 0 &&
        !isLast
      ) {
        return;
      }

      const labelDate = parseDate(point.entry.date);
      const label = labelDate
        ? new Intl.DateTimeFormat("en-IN", {
            day: "2-digit",
            month: "short"
          }).format(labelDate)
        : point.entry.date;

      svg.appendChild(
        createSVGElement("text", {
          x: point.x,
          y: height - margin.bottom + 24,
          fill: "#4b5563",
          "font-size": 12,
          "text-anchor": "middle"
        }, label)
      );
    });

    /* Axes */
    svg.appendChild(
      createSVGElement("line", {
        x1: margin.left,
        y1: margin.top,
        x2: margin.left,
        y2: height - margin.bottom,
        stroke: "#6b7280",
        "stroke-width": 1
      })
    );

    svg.appendChild(
      createSVGElement("line", {
        x1: margin.left,
        y1: height - margin.bottom,
        x2: width - margin.right,
        y2: height - margin.bottom,
        stroke: "#6b7280",
        "stroke-width": 1
      })
    );

    container.appendChild(svg);

    if (note) {
      note.textContent =
        `Showing ${chartData.length} recent day(s). ` +
        "Sales are calculated from valid invoices; cancelled invoices are excluded.";
    }
  }

  /* ---------------------------------------------------------
     7. Report tables
     --------------------------------------------------------- */

  function renderDailyTable(daily) {
    const body = $("dailySalesTableBody");
    if (!body) return;

    if (!daily.length) {
      body.innerHTML = `
        <tr><td colspan="3" class="table-empty">
          No sales data is available for this period.
        </td></tr>`;
      return;
    }

    body.innerHTML = daily.map((entry) => `
      <tr>
        <td>${escapeHTML(displayDate(entry.date))}</td>
        <td>${escapeHTML(formatNumber(entry.invoiceCount))}</td>
        <td>${escapeHTML(formatCurrency(entry.sales))}</td>
      </tr>
    `).join("");
  }

  function renderProductTable(products) {
    const body = $("productReportTableBody");
    if (!body) return;

    if (!products.length) {
      body.innerHTML = `
        <tr><td colspan="3" class="table-empty">
          No product sales are available for this period.
        </td></tr>`;
      return;
    }

    body.innerHTML = products.map((product) => `
      <tr>
        <td>${escapeHTML(product.name)}</td>
        <td>${escapeHTML(formatNumber(product.quantity))}</td>
        <td>${escapeHTML(formatCurrency(product.revenue))}</td>
      </tr>
    `).join("");
  }

  function renderPaymentTable(payments) {
    const body = $("paymentReportTableBody");
    if (!body) return;

    if (!payments.length) {
      body.innerHTML = `
        <tr><td colspan="3" class="table-empty">
          No payment records are available for this period.
        </td></tr>`;
      return;
    }

    body.innerHTML = payments.map((payment) => `
      <tr>
        <td>${escapeHTML(payment.method)}</td>
        <td>${escapeHTML(formatNumber(payment.invoiceCount))}</td>
        <td>${escapeHTML(formatCurrency(payment.total))}</td>
      </tr>
    `).join("");
  }

  /* ---------------------------------------------------------
     8. Render report and graph
     --------------------------------------------------------- */

  function renderReport() {
    if (state.loading) {
      setStatus("Loading saved invoice records…");
      return;
    }

    if (state.error) {
      setStatus(state.error, true);
      return;
    }

    const invoices = getFilteredInvoices();
    const daily = buildDailyReport(invoices);
    const products = buildProductReport(invoices);
    const payments = buildPaymentReport(invoices);

    renderSummary(invoices, daily, products);
    renderDailyTable(daily);
    renderProductTable(products);
    renderPaymentTable(payments);
    renderSalesTrendChart(daily);

    const startLabel = state.startDate
      ? displayDate(state.startDate)
      : "All dates";

    const endLabel = state.endDate
      ? displayDate(state.endDate)
      : "Today and earlier";

    setText(
      "reportPeriodDescription",
      `Report period: ${startLabel} – ${endLabel}`
    );

    setText(
      "reportsFooterStatus",
      `${invoices.length} valid invoices included`
    );

    setStatus(
      `Report updated. ${invoices.length} valid invoice${invoices.length === 1 ? "" : "s"} included.`
    );
  }

  function applyDateFilters() {
    const start = $("reportStartDate")?.value ?? "";
    const end = $("reportEndDate")?.value ?? "";

    if (start && end && start > end) {
      setStatus("The start date cannot be after the end date.", true);
      return;
    }

    state.startDate = start;
    state.endDate = end;

    renderReport();
  }

  function setPreset(period) {
    const today = new Date();
    const end = localDateString(today);
    const startDate = new Date(today);

    if (period === "today") {
      state.startDate = end;
      state.endDate = end;
    } else if (period === "month") {
      startDate.setDate(1);
      state.startDate = localDateString(startDate);
      state.endDate = end;
    } else {
      state.startDate = "";
      state.endDate = "";
    }

    if ($("reportStartDate")) {
      $("reportStartDate").value = state.startDate;
    }

    if ($("reportEndDate")) {
      $("reportEndDate").value = state.endDate;
    }

    renderReport();
  }

  /* ---------------------------------------------------------
     9. CSV export
     --------------------------------------------------------- */

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadCSV(filename, rows) {
    const csv = "\uFEFF" + rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.hidden = true;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportDailyReport() {
    if (state.loading || state.error) {
      setStatus(
        "Wait until the report has loaded before exporting.",
        true
      );
      return;
    }

    const invoices = getFilteredInvoices();

    const rows = [
      [
        "Date",
        "Invoice Count",
        "Sales (INR)",
        "Tax (INR)",
        "Discount (INR)",
        "Items Sold"
      ]
    ];

    buildDailyReport(invoices).forEach((entry) => {
      rows.push([
        entry.date,
        entry.invoiceCount,
        entry.sales.toFixed(2),
        entry.tax.toFixed(2),
        entry.discount.toFixed(2),
        entry.quantity
      ]);
    });

    rows.push([]);
    rows.push(["Product", "Quantity Sold", "Revenue (INR)"]);

    buildProductReport(invoices).forEach((product) => {
      rows.push([
        product.name,
        product.quantity,
        product.revenue.toFixed(2)
      ]);
    });

    rows.push([]);
    rows.push(["Payment Method", "Invoice Count", "Total Amount (INR)"]);

    buildPaymentReport(invoices).forEach((payment) => {
      rows.push([
        payment.method,
        payment.invoiceCount,
        payment.total.toFixed(2)
      ]);
    });

    downloadCSV(
      `restaurant-sales-report-${localDateString(new Date())}.csv`,
      rows
    );

    setStatus("CSV report exported.");
  }

  /* ---------------------------------------------------------
     10. Firebase subscriptions
     --------------------------------------------------------- */

  function subscribe(path, handler, errorHandler) {
    const shared = window.restaurantFirebase;
    const reference = state.api.ref(shared.db, path);

    const unsubscribe = state.api.onValue(
      reference,
      handler,
      errorHandler
    );

    if (typeof unsubscribe === "function") {
      state.unsubscribers.push(unsubscribe);
    }
  }

  function watchDatabaseConnection() {
    const shared = window.restaurantFirebase;
    const reference = state.api.ref(shared.db, ".info/connected");

    subscribe(
      ".info/connected",
      (snapshot) => {
        if (state.disposed) return;

        state.databaseConnected = snapshot.val() === true;

        setConnectionStatus(
          state.databaseConnected
            ? "Database connected"
            : "Connecting to database"
        );
      },
      () => {
        if (state.disposed) return;

        state.databaseConnected = false;
        setConnectionStatus("Connection status unavailable", true);
      }
    );
  }

  /* ---------------------------------------------------------
     11. Manual refresh
     --------------------------------------------------------- */

  async function refreshReports() {
    if (state.disposed || !state.api) {
      throw new Error("Reports page is not ready to refresh.");
    }

    const shared = window.restaurantFirebase;
    const access = window.restaurantAccess;

    if (
      !shared?.ready ||
      !shared.db ||
      !access?.authorized ||
      access.user?.uid !== OWNER_UID
    ) {
      throw new Error("Authorized Firebase access is unavailable.");
    }

    if (typeof state.api.get !== "function") {
      throw new Error("Firebase data refresh is unavailable.");
    }

    setStatus("Refreshing report data…");

    /*
     * Fetch all source paths concurrently.
     * Update in-memory state only when every read succeeds.
     * Existing realtime listeners are not duplicated.
     */
    const paths = [
      PATHS.invoices,
      PATHS.products,
      PATHS.categories,
      PATHS.business
    ];

    const snapshots = await Promise.all(
      paths.map((path) =>
        state.api.get(state.api.ref(shared.db, path))
      )
    );

    if (state.disposed) return;

    const refreshedInvoices = normaliseRecords(
      snapshots[0].exists() ? snapshots[0].val() : null
    );

    const refreshedProducts = normaliseLookup(
      snapshots[1].exists() ? snapshots[1].val() : null
    );

    const refreshedCategories = normaliseLookup(
      snapshots[2].exists() ? snapshots[2].val() : null
    );

    const refreshedBusiness = snapshots[3].exists()
      ? snapshots[3].val() || {}
      : {};

    state.invoices = refreshedInvoices;
    state.products = refreshedProducts;
    state.categories = refreshedCategories;
    state.businessProfile = refreshedBusiness;
    state.loading = false;
    state.error = "";

    updateBranding();
    renderReport();

    setConnectionStatus(
      state.databaseConnected
        ? "Database connected"
        : "Connecting to database"
    );
  }

  /* ---------------------------------------------------------
     12. Database error handling
     --------------------------------------------------------- */

  function handleDatabaseError(error) {
    if (state.disposed) return;

    state.loading = false;

    state.error =
      error?.code === "PERMISSION_DENIED" ||
      error?.code === "permission-denied"
        ? "Database permission denied. Check Firebase Realtime Database rules."
        : "Unable to load report data.";

    setConnectionStatus(
      state.databaseConnected
        ? "Database connected"
        : "Database connection unavailable",
      !state.databaseConnected
    );

    renderReport();

    // Prevent loading animation from remaining indefinitely on error.
    revealReportsPage();
  }

  /* ---------------------------------------------------------
     13. Page initialization
     --------------------------------------------------------- */

  async function initializePage() {
    if (state.initialized) return;

    state.initialized = true;

    const shared = window.restaurantFirebase;

    if (!shared?.readyPromise) {
      state.loading = false;
      state.error = "Firebase configuration is unavailable.";

      renderReport();
      setConnectionStatus("Configuration error", true);
      setText("ownerDisplayName", "Account unavailable");
      finishReportsLoadingImmediately();

      return;
    }

    try {
      setStatus("Connecting to report data…");

      const initialized = await shared.readyPromise;

      if (
        !initialized ||
        shared.error ||
        !shared.db ||
        !shared.sdk?.database
      ) {
        throw new Error("The database connection is unavailable.");
      }

      const access = window.restaurantAccess;

      if (access?.readyPromise) {
        await access.readyPromise;
      }

      if (!access?.authorized || access.user?.uid !== OWNER_UID) {
        throw new Error("Owner access is required to view reports.");
      }

      updateOwnerProfile(access.user);

      const databaseAPI = shared.sdk.database;

      if (
        typeof databaseAPI.ref !== "function" ||
        typeof databaseAPI.onValue !== "function" ||
        typeof databaseAPI.get !== "function"
      ) {
        throw new Error("Required Realtime Database methods are unavailable.");
      }

      state.api = {
        ref: databaseAPI.ref,
        onValue: databaseAPI.onValue,
        get: databaseAPI.get
      };

      if (
        window.restaurantUI &&
        typeof window.restaurantUI.registerPageRefresh === "function"
      ) {
        state.unregisterPageRefresh =
          window.restaurantUI.registerPageRefresh(refreshReports);
      }

      watchDatabaseConnection();

      subscribe(
        PATHS.invoices,
        (snapshot) => {
          if (state.disposed) return;

          state.invoices = normaliseRecords(snapshot.val());
          state.loading = false;
          state.error = "";

          renderReport();

          // Initial invoice data is ready; reveal the report smoothly.
          revealReportsPage();
        },
        handleDatabaseError
      );

      subscribe(
        PATHS.products,
        (snapshot) => {
          if (state.disposed) return;

          state.products = normaliseLookup(snapshot.val());

          if (!state.loading) renderReport();
        },
        handleDatabaseError
      );

      subscribe(
        PATHS.categories,
        (snapshot) => {
          if (state.disposed) return;

          state.categories = normaliseLookup(snapshot.val());

          if (!state.loading) renderReport();
        },
        handleDatabaseError
      );

      subscribe(
        PATHS.business,
        (snapshot) => {
          if (state.disposed) return;

          state.businessProfile = snapshot.val() || {};
          updateBranding();
        },
        (error) => {
          if (state.disposed) return;

          console.warn(
            "Optional business profile could not be loaded:",
            error?.code || "unknown"
          );

          state.businessProfile = {};
          updateBranding();
        }
      );

    } catch (error) {
      if (state.disposed) return;

      state.loading = false;
      state.error = error?.message || "Could not connect to reports.";

      setConnectionStatus("Connection error", true);
      setText("ownerDisplayName", "Account unavailable");

      renderReport();
      finishReportsLoadingImmediately();
    }
  }

  /* ---------------------------------------------------------
     14. Events and cleanup
     --------------------------------------------------------- */

  function bindEvents() {
    $("reportFiltersForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      applyDateFilters();
    });

    $("currentDayReportBtn")?.addEventListener("click", () => {
      setPreset("today");
    });

    $("currentMonthReportBtn")?.addEventListener("click", () => {
      setPreset("month");
    });

    $("exportReportBtn")?.addEventListener("click", exportDailyReport);

    window.addEventListener("pagehide", () => {
      state.disposed = true;

      clearTimeout(state.revealTimer);
      state.revealTimer = null;

      state.unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (_) {
          /* Best-effort listener cleanup. */
        }
      });

      state.unsubscribers = [];

      if (typeof state.unregisterPageRefresh === "function") {
        state.unregisterPageRefresh();
        state.unregisterPageRefresh = null;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    updateBranding();
    renderReport();
    initializePage();
  });
})();
