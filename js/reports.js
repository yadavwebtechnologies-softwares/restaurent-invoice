
(() => {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const INVOICES_PATH = "restaurantBilling/invoices";
  const PRODUCTS_PATH = "restaurantBilling/products";
  const CATEGORIES_PATH = "restaurantBilling/categories";
  const BUSINESS_PATH = "restaurantBilling/settings/businessProfile";

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
    unsubscribers: []
  };

  const $ = (id) => document.getElementById(id);

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

    return ["cancelled", "canceled", "void", "voided"].includes(status)
      ? "cancelled"
      : "valid";
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
    const storedAmount = Number(item.total ?? item.amount);

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
  }

  function setConnectionStatus(message, isError = false) {
    const element = $("sidebarConnectionStatus");
    if (!element) return;

    element.textContent = message;
    element.dataset.state = isError ? "error" : "normal";
  }

  function setText(id, value) {
    const element = $(id);
    if (element) element.textContent = String(value ?? "");
  }

  function updateBranding() {
    const businessName = String(
      state.businessProfile.businessName ?? ""
    ).trim();

    const tagline = String(
      state.businessProfile.tagline ?? ""
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
      user?.displayName ??
      user?.email ??
      "Owner"
    ).trim();

    setText("ownerDisplayName", name);

    const avatar = $("ownerAvatar");
    if (avatar) {
      avatar.textContent = name.charAt(0).toUpperCase() || "O";
    }
  }

  function normaliseRecords(raw) {
    if (!raw || typeof raw !== "object") return [];

    return Object.entries(raw)
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

    const result = {};

    Object.entries(raw).forEach(([key, value]) => {
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
        const key = String(item.productId ?? item.itemId ?? name.toLowerCase());

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

    return [...payments.values()].sort((a, b) => b.total - a.total);
  }

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

    const startLabel = state.startDate
      ? displayDate(state.startDate)
      : "All dates";

    const endLabel = state.endDate
      ? displayDate(state.endDate)
      : "Today and earlier";

    setText("reportPeriodDescription", `Report period: ${startLabel} – ${endLabel}`);
    setText("reportsFooterStatus", `${invoices.length} valid invoices included`);

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

    if ($("reportStartDate")) $("reportStartDate").value = state.startDate;
    if ($("reportEndDate")) $("reportEndDate").value = state.endDate;

    renderReport();
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadCSV(filename, rows) {
    const csv = "\uFEFF" + rows
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
      setStatus("Wait until the report has loaded before exporting.", true);
      return;
    }

    const invoices = getFilteredInvoices();
    const rows = [
      ["Date", "Invoice Count", "Sales (INR)", "Tax (INR)", "Discount (INR)", "Items Sold"]
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
      rows.push([product.name, product.quantity, product.revenue.toFixed(2)]);
    });

    rows.push([]);
    rows.push(["Payment Method", "Invoice Count", "Total Amount (INR)"]);

    buildPaymentReport(invoices).forEach((payment) => {
      rows.push([payment.method, payment.invoiceCount, payment.total.toFixed(2)]);
    });

    downloadCSV(`restaurant-sales-report-${localDateString(new Date())}.csv`, rows);
    setStatus("CSV report exported.");
  }

  function subscribe(path, handler, errorHandler) {
    const shared = window.restaurantFirebase;
    const reference = state.api.ref(shared.db, path);

    const unsubscribe = state.api.onValue(reference, handler, errorHandler);

    if (typeof unsubscribe === "function") {
      state.unsubscribers.push(unsubscribe);
    }
  }

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
      return;
    }

    try {
      setStatus("Connecting to report data…");
      await shared.readyPromise;

      if (shared.error || !shared.db || !shared.sdk?.database) {
        throw new Error("The database connection is unavailable.");
      }

      const access = window.restaurantAccess;

      if (access?.readyPromise) await access.readyPromise;

      if (!access?.authorized || access.user?.uid !== OWNER_UID) {
        throw new Error("Owner access is required to view reports.");
      }

      updateOwnerProfile(access.user);

      state.api = {
        ref: shared.sdk.database.ref,
        onValue: shared.sdk.database.onValue
      };

      setConnectionStatus("Connected");

      subscribe(
        INVOICES_PATH,
        (snapshot) => {
          state.invoices = normaliseRecords(snapshot.val());
          state.loading = false;
          state.error = "";
          renderReport();
        },
        handleDatabaseError
      );

      subscribe(PRODUCTS_PATH, (snapshot) => {
        state.products = normaliseLookup(snapshot.val());
      }, handleDatabaseError);

      subscribe(CATEGORIES_PATH, (snapshot) => {
        state.categories = normaliseLookup(snapshot.val());
      }, handleDatabaseError);

      subscribe(BUSINESS_PATH, (snapshot) => {
        state.businessProfile = snapshot.val() || {};
        updateBranding();
      }, () => {
        state.businessProfile = {};
        updateBranding();
      });
    } catch (error) {
      state.loading = false;
      state.error = error?.message || "Could not connect to reports.";

      setConnectionStatus("Connection error", true);
      setText("ownerDisplayName", "Account unavailable");
      renderReport();
    }
  }

  function handleDatabaseError(error) {
    state.loading = false;
    state.error = error?.code === "PERMISSION_DENIED"
      ? "Database permission denied. Check Firebase Realtime Database rules."
      : "Unable to load report data.";

    setConnectionStatus("Database error", true);
    renderReport();
  }

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
      state.unsubscribers.forEach((unsubscribe) => unsubscribe());
      state.unsubscribers = [];
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    updateBranding();
    renderReport();
    initializePage();
  });
})();
