
"use strict";

/*
 * Restaurant Billing Software
 * File: js/reports.js
 *
 * Real Firebase Realtime Database analytics.
 *
 * Reads:
 * restaurantBilling/invoices
 * restaurantBilling/products
 * restaurantBilling/categories
 *
 * Uses shared services from:
 * js/firebase-config.js
 * js/auth.js
 *
 * No generated demo transactions.
 * No hardcoded demo products.
 * Charts are responsive inline SVG.
 *
 * Revenue is not profit. Profit calculations require costs
 * and expense records.
 */

(() => {
  // ==================================================
  // 1. DOM AND STATE
  // ==================================================

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const filtersForm = $("#reportFilters");
  const periodSelect = $("#reportPeriod");
  const granularitySelect = $("#reportGranularity");
  const categorySelect = $("#reportCategory");
  const productSelect = $("#reportProduct");

  const customRange = $("#reportCustomRange");
  const dateFromInput = $("#reportDateFrom");
  const dateToInput = $("#reportDateTo");

  const refreshButton = $("#refreshReportsBtn");
  const exportButton = $("#exportReportsBtn");
  const exportProductsButton = $("#exportProductReportBtn");

  const filterMessage = $("#reportFilterMessage");
  const dataStatus = $("#reportDataStatus");

  const ADMIN_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const DATABASE_PATH = "restaurantBilling";

  const state = {
    root: {},
    invoices: [],
    products: [],
    categories: [],
    productMap: new Map(),
    categoryMap: new Map(),
    unsubscribe: null,
    latestReport: null,
    firebaseReady: false,
    destroyed: false
  };

  const moneyFormat = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const compactMoneyFormat = new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1
  });

  const integerFormat = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0
  });

  const percentFormat = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ];

  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

  // ==================================================
  // 2. GENERAL HELPERS
  // ==================================================

  function money(value) {
    return moneyFormat.format(Number(value) || 0);
  }

  function compactMoney(value) {
    return "₹" + compactMoneyFormat.format(Number(value) || 0);
  }

  function integer(value) {
    return integerFormat.format(Number(value) || 0);
  }

  function percentage(value) {
    return percentFormat.format(Number(value) || 0) + "%";
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function number(value, fallback = 0) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalise(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function setText(selector, value) {
    const element = typeof selector === "string"
      ? $(selector)
      : selector;

    if (element) {
      element.textContent = String(value ?? "");
    }
  }

  function setMessage(message, type = "info") {
    if (!filterMessage) {
      if (message) console.info("Reports:", message);
      return;
    }

    filterMessage.textContent = message;

    if (message) {
      filterMessage.dataset.type = type;
    } else {
      delete filterMessage.dataset.type;
    }
  }

  function setStatus(message, type = "info") {
    if (!dataStatus) return;

    dataStatus.textContent = message;
    dataStatus.dataset.type = type;
  }

  function clearMessage() {
    setMessage("");
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function parseLocalDate(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : new Date(value);
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const timestamp = value < 1e12 ? value * 1000 : value;
      const result = new Date(timestamp);

      return Number.isNaN(result.getTime()) ? null : result;
    }

    const text = String(value ?? "").trim();

    if (!text) return null;

    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (match) {
      const result = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3])
      );

      if (
        result.getFullYear() !== Number(match[1]) ||
        result.getMonth() !== Number(match[2]) - 1 ||
        result.getDate() !== Number(match[3])
      ) {
        return null;
      }

      return result;
    }

    const result = new Date(text);

    return Number.isNaN(result.getTime()) ? null : result;
  }

  function addDays(date, days) {
    const result = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    result.setDate(result.getDate() + days);

    return result;
  }

  function formatShortDate(dateKey) {
    const date = parseLocalDate(dateKey);

    if (!date) return String(dateKey ?? "");

    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short"
    }).format(date);
  }

  function formatMonth(dateKey) {
    const date = parseLocalDate(dateKey);

    if (!date) return String(dateKey ?? "");

    return new Intl.DateTimeFormat("en-IN", {
      month: "short",
      year: "2-digit"
    }).format(date);
  }

  function formatHour(hour) {
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;

    return `${displayHour} ${suffix}`;
  }

  function dateKeyFor(date) {
    return localDateString(date);
  }

  function recordsFrom(value) {
    if (!value || typeof value !== "object") {
      return [];
    }

    if (Array.isArray(value)) {
      return value
        .map((item, index) => {
          if (!item || typeof item !== "object") return null;

          return {
            ...item,
            id: item.id || item.key || String(index)
          };
        })
        .filter(Boolean);
    }

    return Object.entries(value)
      .map(([key, item]) => {
        if (!item || typeof item !== "object") return null;

        return {
          ...item,
          id: item.id || item.key || key
        };
      })
      .filter(Boolean);
  }

  function csvCell(value) {
    let text = String(value ?? "");

    // Reduce spreadsheet formula-injection risk.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCSV(rows, filename) {
    if (!rows.length) {
      setMessage("Export karne ke liye data available nahi hai.", "error");
      return;
    }

    const csv = rows
      .map(row => row.map(csvCell).join(","))
      .join("\r\n");

    const blob = new Blob(
      ["\uFEFF", csv],
      { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ==================================================
  // 3. FIREBASE CONNECTION
  // ==================================================

  async function getFirebase() {
    const firebase = window.restaurantFirebase;

    if (!firebase?.ready) {
      throw new Error(
        "Firebase service nahi mila. firebase-config.js check karein."
      );
    }

    const initialized = await firebase.ready;

    if (
      !initialized ||
      !firebase.auth ||
      !firebase.db ||
      !firebase.sdk?.auth ||
      !firebase.sdk?.database
    ) {
      throw new Error(
        "Firebase Authentication ya Realtime Database initialize nahi hua."
      );
    }

    return firebase;
  }

  async function waitForAdministrator(firebase) {
    const auth = firebase.auth;
    const authSDK = firebase.sdk.auth;

    if (auth.currentUser) {
      if (auth.currentUser.uid === ADMIN_UID) {
        return auth.currentUser;
      }

      throw new Error("Authorized administrator account se login karein.");
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = null;

      const timeout = window.setTimeout(() => {
        if (settled) return;

        settled = true;

        if (unsubscribe) unsubscribe();

        reject(
          new Error("Authentication check timeout ho gaya. Page reload karein.")
        );
      }, 15000);

      unsubscribe = authSDK.onAuthStateChanged(
        auth,
        user => {
          if (settled) return;

          settled = true;
          window.clearTimeout(timeout);
          unsubscribe?.();

          if (user?.uid === ADMIN_UID) {
            resolve(user);
          } else {
            reject(
              new Error(
                "Reports access ke liye authorized owner login zaroori hai."
              )
            );
          }
        },
        error => {
          if (settled) return;

          settled = true;
          window.clearTimeout(timeout);
          unsubscribe?.();

          reject(error);
        }
      );
    });
  }

  // ==================================================
  // 4. DATABASE RECORD NORMALIZATION
  // ==================================================

  function getProductId(product) {
    return String(
      product?.id ||
      product?.productId ||
      product?.productID ||
      ""
    );
  }

  function getProductName(product) {
    return String(
      product?.name ||
      product?.productName ||
      product?.title ||
      "Unnamed product"
    );
  }

  function getCategoryId(category) {
    return String(
      category?.id ||
      category?.categoryId ||
      category?.categoryID ||
      ""
    );
  }

  function getCategoryName(category) {
    return String(
      category?.name ||
      category?.categoryName ||
      category?.title ||
      "Uncategorized"
    );
  }

  function findProduct(item) {
    const itemId = String(
      item?.productId ||
      item?.productID ||
      item?.id ||
      ""
    );

    if (itemId && state.productMap.has(itemId)) {
      return state.productMap.get(itemId);
    }

    const itemName = normalise(
      item?.name ||
      item?.productName ||
      item?.title
    );

    if (!itemName) return null;

    return state.products.find(product =>
      normalise(getProductName(product)) === itemName
    ) || null;
  }

  function resolveCategory(item, product) {
    const directName =
      item?.categoryName ||
      item?.category ||
      product?.categoryName ||
      (typeof product?.category === "string" ? product.category : "");

    if (directName) {
      return String(directName);
    }

    const categoryId = String(
      item?.categoryId ||
      item?.categoryID ||
      product?.categoryId ||
      product?.categoryID ||
      (typeof product?.category === "object"
        ? product.category.id || product.category.categoryId || ""
        : "")
    );

    if (categoryId && state.categoryMap.has(categoryId)) {
      return getCategoryName(state.categoryMap.get(categoryId));
    }

    return "Uncategorized";
  }

  function getItemQuantity(item) {
    return Math.max(0, number(item?.quantity ?? item?.qty, 0));
  }

  function getItemPrice(item) {
    return Math.max(
      0,
      number(
        item?.price ??
        item?.unitPrice ??
        item?.rate,
        0
      )
    );
  }

  function getItemRevenue(item) {
    const value = item?.amount ?? item?.lineTotal ?? item?.revenue;

    if (value !== undefined && value !== null && value !== "") {
      const parsed = Number(value);

      if (Number.isFinite(parsed) && parsed >= 0) {
        return roundMoney(parsed);
      }
    }

    return roundMoney(getItemPrice(item) * getItemQuantity(item));
  }

  function getItems(invoice) {
    const value =
      invoice?.items ||
      invoice?.orderItems ||
      invoice?.products ||
      [];

    return recordsFrom(value);
  }

  function getInvoiceDate(invoice) {
    let date = parseLocalDate(
      invoice?.invoiceDate ||
      invoice?.date ||
      invoice?.createdAt ||
      invoice?.timestamp
    );

    if (!date) return null;

    // Combine an explicit invoice time with a date-only value.
    const time = String(
      invoice?.invoiceTime ||
      invoice?.time ||
      ""
    );

    const match = time.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);

    if (
      match &&
      date.getHours() === 0 &&
      date.getMinutes() === 0 &&
      date.getSeconds() === 0
    ) {
      const hours = Number(match[1]);
      const minutes = Number(match[2]);
      const seconds = Number(match[3] || 0);

      if (
        hours >= 0 && hours <= 23 &&
        minutes >= 0 && minutes <= 59 &&
        seconds >= 0 && seconds <= 59
      ) {
        date.setHours(hours, minutes, seconds, 0);
      }
    }

    return date;
  }

  function getInvoiceNumber(invoice) {
    return String(
      invoice?.invoiceNumber ||
      invoice?.number ||
      invoice?.id ||
      "Invoice"
    );
  }

  function getInvoiceCustomer(invoice) {
    return String(
      invoice?.customerName ||
      invoice?.customer ||
      "Walk-in Customer"
    );
  }

  function getInvoicePayment(invoice) {
    return normalise(
      invoice?.paymentMethod ||
      invoice?.payment ||
      ""
    );
  }

  function getInvoiceStatus(invoice) {
    return normalise(
      invoice?.status ||
      invoice?.invoiceStatus ||
      invoice?.recordStatus ||
      "generated"
    );
  }

  function isCancelled(invoice) {
    const status = getInvoiceStatus(invoice);

    return status.includes("cancel");
  }

  function isDraft(invoice) {
    return getInvoiceStatus(invoice).includes("draft");
  }

  function isIncludedInSales(invoice) {
    return !isCancelled(invoice) && !isDraft(invoice);
  }

  function getInvoiceTotal(invoice) {
    return Math.max(
      0,
      number(
        invoice?.grandTotal ??
        invoice?.total ??
        invoice?.amount ??
        invoice?.totals?.grandTotal,
        0
      )
    );
  }

  function normaliseInvoice(invoice) {
    const date = getInvoiceDate(invoice);
    const rawItems = getItems(invoice);

    const items = rawItems.map(item => {
      const product = findProduct(item);

      return {
        productId: String(
          item?.productId ||
          item?.productID ||
          item?.id ||
          getProductId(product) ||
          ""
        ),

        name: String(
          item?.name ||
          item?.productName ||
          getProductName(product)
        ),

        category: resolveCategory(item, product),

        quantity: getItemQuantity(item),
        price: getItemPrice(item),
        revenue: getItemRevenue(item)
      };
    });

    return {
      id: String(invoice?.id || invoice?.key || ""),
      number: getInvoiceNumber(invoice),
      customer: getInvoiceCustomer(invoice),
      date,
      dateKey: date ? dateKeyFor(date) : "",
      hour: date ? date.getHours() : null,
      payment: getInvoicePayment(invoice),
      status: getInvoiceStatus(invoice),
      cancelled: isCancelled(invoice),
      draft: isDraft(invoice),
      total: getInvoiceTotal(invoice),
      items,
      raw: invoice
    };
  }

  function loadDatabaseData(root) {
    state.root = root || {};

    /*
     * Standard paths:
     * restaurantBilling/invoices
     * restaurantBilling/products
     * restaurantBilling/categories
     *
     * Alternative invoice paths support older project schemas.
     */

    state.products = recordsFrom(
      state.root.products ||
      state.root.catalog?.products
    );

    state.categories = recordsFrom(
      state.root.categories ||
      state.root.catalog?.categories
    );

    state.productMap = new Map();

    state.products.forEach(product => {
      const id = getProductId(product);

      if (id) state.productMap.set(id, product);
    });

    state.categoryMap = new Map();

    state.categories.forEach(category => {
      const id = getCategoryId(category);

      if (id) state.categoryMap.set(id, category);
    });

    const invoiceRecords =
      state.root.invoices ||
      state.root.invoiceRecords ||
      state.root.sales ||
      state.root.billing?.invoices ||
      {};

    state.invoices = recordsFrom(invoiceRecords)
      .map(normaliseInvoice)
      .filter(invoice => invoice.dateKey);

    populateCategoryOptions();
    populateProductOptions();
  }

  // ==================================================
  // 5. CATEGORY AND PRODUCT FILTER OPTIONS
  // ==================================================

  function populateCategoryOptions() {
    if (!categorySelect) return;

    const previousValue = categorySelect.value;

    const names = [
      ...new Set([
        ...state.categories.map(getCategoryName),
        ...state.products.map(product => {
          const categoryId = String(
            product.categoryId ||
            product.categoryID ||
            (typeof product.category === "object"
              ? product.category.id || product.category.categoryId || ""
              : "")
          );

          if (product.categoryName) return product.categoryName;

          if (typeof product.category === "string" && product.category) {
            return product.category;
          }

          if (categoryId && state.categoryMap.has(categoryId)) {
            return getCategoryName(state.categoryMap.get(categoryId));
          }

          return "";
        })
      ].filter(name => name && name !== "Uncategorized")
    ].sort((a, b) => a.localeCompare(b));

    categorySelect.replaceChildren();

    categorySelect.add(new Option("All Categories", ""));

    names.forEach(name => {
      categorySelect.add(new Option(name, name));
    });

    if (names.includes(previousValue)) {
      categorySelect.value = previousValue;
    }
  }

  function populateProductOptions() {
    if (!productSelect) return;

    const previousValue = productSelect.value;
    const selectedCategory = categorySelect?.value || "";

    const products = state.products.filter(product => {
      if (!selectedCategory) return true;

      const category = resolveCategory({}, product);

      return category === selectedCategory;
    });

    productSelect.replaceChildren();
    productSelect.add(new Option("All Products", ""));

    products
      .sort((a, b) =>
        getProductName(a).localeCompare(getProductName(b))
      )
      .forEach(product => {
        const id = getProductId(product);

        if (id) {
          productSelect.add(
            new Option(getProductName(product), id)
          );
        }
      });

    if (products.some(product => getProductId(product) === previousValue)) {
      productSelect.value = previousValue;
    }
  }

  categorySelect?.addEventListener("change", populateProductOptions);

  // ==================================================
  // 6. REPORT DATE RANGE
  // ==================================================

  function getPeriodKey() {
    return normalise(periodSelect?.value || "30days");
  }

  function getSelectedDateRange() {
    const now = new Date();
    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const todayKey = localDateString(today);
    const period = getPeriodKey();

    if (["today"].includes(period)) {
      return {
        from: todayKey,
        to: todayKey,
        label: "Today",
        valid: true
      };
    }

    if (["yesterday"].includes(period)) {
      const day = addDays(today, -1);

      return {
        from: localDateString(day),
        to: localDateString(day),
        label: "Yesterday",
        valid: true
      };
    }

    if (["week", "thisweek", "this-week"].includes(period)) {
      const weekday = today.getDay();
      const monday = addDays(today, weekday === 0 ? -6 : 1 - weekday);

      return {
        from: localDateString(monday),
        to: todayKey,
        label: "This Week",
        valid: true
      };
    }

    if (["7days", "last7days", "last-7-days"].includes(period)) {
      return {
        from: localDateString(addDays(today, -6)),
        to: todayKey,
        label: "Last 7 Days",
        valid: true
      };
    }

    if (["30days", "last30days", "last-30-days"].includes(period)) {
      return {
        from: localDateString(addDays(today, -29)),
        to: todayKey,
        label: "Last 30 Days",
        valid: true
      };
    }

    if (["month", "thismonth", "this-month"].includes(period)) {
      return {
        from: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: todayKey,
        label: "This Month",
        valid: true
      };
    }

    if (["previousmonth", "lastmonth", "previous-month"].includes(period)) {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);

      return {
        from: localDateString(first),
        to: localDateString(last),
        label: "Previous Month",
        valid: true
      };
    }

    if (["year", "thisyear", "this-year"].includes(period)) {
      return {
        from: localDateString(new Date(now.getFullYear(), 0, 1)),
        to: todayKey,
        label: "This Year",
        valid: true
      };
    }

    if (["all", "alltime", "all-time"].includes(period)) {
      const available = state.invoices
        .map(invoice => invoice.dateKey)
        .filter(Boolean)
        .sort();

      return {
        from: available[0] || todayKey,
        to: available[available.length - 1] || todayKey,
        label: "All Available Data",
        valid: true
      };
    }

    if (["custom", "customrange", "custom-range"].includes(period)) {
      const from = dateFromInput?.value || "";
      const to = dateToInput?.value || "";

      if (!parseLocalDate(from) || !parseLocalDate(to)) {
        return {
          valid: false,
          message: "Custom range ke liye valid From aur To dates select karein."
        };
      }

      if (from > to) {
        return {
          valid: false,
          message: "From Date, To Date se aage nahi ho sakti."
        };
      }

      return {
        from,
        to,
        label: "Custom Range",
        valid: true
      };
    }

    return {
      valid: false,
      message: "Reporting period select karein."
    };
  }

  function updateCustomRangeVisibility() {
    if (!customRange) return;

    const visible = [
      "custom",
      "customrange",
      "custom-range"
    ].includes(getPeriodKey());

    customRange.hidden = !visible;

    if (dateFromInput) dateFromInput.required = visible;
    if (dateToInput) dateToInput.required = visible;
  }

  periodSelect.addEventListener("change", updateCustomRangeVisibility);

  dateFromInput?.addEventListener("change", clearMessage);
  dateToInput?.addEventListener("change", clearMessage);

  // ==================================================
  // 7. PREVIOUS PERIOD RANGE
  // ==================================================

  function getPreviousDateRange(range) {
    const period = getPeriodKey();

    if (["all", "alltime", "all-time"].includes(period)) {
      return null;
    }

    const fromDate = parseLocalDate(range.from);
    const toDate = parseLocalDate(range.to);

    if (!fromDate || !toDate) return null;

    if (["previousmonth", "lastmonth", "previous-month"].includes(period)) {
      const previousFrom = new Date(
        fromDate.getFullYear(),
        fromDate.getMonth() - 1,
        1
      );

      const previousTo = new Date(
        fromDate.getFullYear(),
        fromDate.getMonth(),
        0
      );

      return {
        from: localDateString(previousFrom),
        to: localDateString(previousTo),
        label: "Month Before Previous Month"
      };
    }

    const dayCount = Math.round(
      (toDate.getTime() - fromDate.getTime()) / 86400000
    ) + 1;

    const previousTo = addDays(fromDate, -1);
    const previousFrom = addDays(previousTo, -(dayCount - 1));

    return {
      from: localDateString(previousFrom),
      to: localDateString(previousTo),
      label: "Previous Comparable Period"
    };
  }

  // ==================================================
  // 8. FILTER INVOICES AND ITEMS
  // ==================================================

  function itemMatchesFilters(item) {
    const selectedCategory = categorySelect?.value || "";
    const selectedProduct = productSelect?.value || "";

    if (selectedCategory && item.category !== selectedCategory) {
      return false;
    }

    if (selectedProduct && item.productId !== selectedProduct) {
      return false;
    }

    return true;
  }

  function getFilteredTransactions(range) {
    if (!range) return [];

    const selectedCategory = categorySelect?.value || "";
    const selectedProduct = productSelect?.value || "";

    return state.invoices
      .filter(invoice => {
        if (!invoice.dateKey) return false;

        if (
          invoice.dateKey < range.from ||
          invoice.dateKey > range.to
        ) {
          return false;
        }

        if (invoice.cancelled || invoice.draft) {
          return false;
        }

        return true;
      })
      .map(invoice => {
        const matchingItems = invoice.items.filter(itemMatchesFilters);

        if (
          (selectedCategory || selectedProduct) &&
          matchingItems.length === 0
        ) {
          return null;
        }

        const filteredItemRevenue = roundMoney(
          matchingItems.reduce(
            (sum, item) => sum + item.revenue,
            0
          )
        );

        const hasItemFilter = Boolean(
          selectedCategory || selectedProduct
        );

        const revenue = hasItemFilter
          ? filteredItemRevenue
          : invoice.total || filteredItemRevenue;

        return {
          ...invoice,
          items: matchingItems,
          revenue: roundMoney(revenue)
        };
      })
      .filter(Boolean);
  }

  // ==================================================
  // 9. ANALYTICS CALCULATIONS
  // ==================================================

  function analyseTransactions(transactions) {
    let revenue = 0;
    let cash = 0;
    let upi = 0;
    let unitsSold = 0;

    const productStats = new Map();
    const categoryStats = new Map();

    transactions.forEach(invoice => {
      revenue += invoice.revenue;

      if (invoice.payment === "cash") {
        cash += invoice.revenue;
      } else if (invoice.payment === "upi") {
        upi += invoice.revenue;
      }

      invoice.items.forEach(item => {
        unitsSold += item.quantity;

        const productKey = item.productId || normalise(item.name);

        if (!productStats.has(productKey)) {
          productStats.set(productKey, {
            id: item.productId,
            name: item.name,
            category: item.category,
            units: 0,
            revenue: 0,
            invoices: 0
          });
        }

        const product = productStats.get(productKey);

        product.units += item.quantity;
        product.revenue += item.revenue;
        product.invoices += 1;

        if (!categoryStats.has(item.category)) {
          categoryStats.set(item.category, {
            name: item.category,
            productIds: new Set(),
            units: 0,
            revenue: 0
          });
        }

        const category = categoryStats.get(item.category);

        if (productKey) {
          category.productIds.add(productKey);
        }

        category.units += item.quantity;
        category.revenue += item.revenue;
      });
    });

    const products = Array.from(productStats.values())
      .map(product => ({
        ...product,
        revenue: roundMoney(product.revenue)
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const categories = Array.from(categoryStats.values())
      .map(category => ({
        name: category.name,
        productCount: category.productIds.size,
        units: category.units,
        revenue: roundMoney(category.revenue)
      }))
      .sort((a, b) => b.revenue - a.revenue);

    revenue = roundMoney(revenue);

    return {
      revenue,
      invoiceCount: transactions.length,
      unitsSold,
      averageOrderValue: transactions.length
        ? roundMoney(revenue / transactions.length)
        : 0,
      cash: roundMoney(cash),
      upi: roundMoney(upi),
      products,
      categories,
      transactions
    };
  }

  function share(value, total) {
    return total > 0 ? value / total * 100 : 0;
  }

  // ==================================================
  // 10. TIME-SERIES GROUPING
  // ==================================================

  function groupByTime(transactions, granularity) {
    const groups = new Map();

    if (granularity === "hour") {
      for (let hour = 0; hour < 24; hour++) {
        groups.set(String(hour), {
          key: String(hour),
          label: formatHour(hour),
          revenue: 0,
          count: 0
        });
      }

      transactions.forEach(invoice => {
        if (invoice.hour === null || invoice.hour === undefined) return;

        const group = groups.get(String(invoice.hour));

        group.revenue += invoice.revenue;
        group.count += 1;
      });

      return Array.from(groups.values()).map(item => ({
        ...item,
        revenue: roundMoney(item.revenue)
      }));
    }

    transactions.forEach(invoice => {
      const date = parseLocalDate(invoice.dateKey);

      if (!date) return;

      let key;
      let label;

      if (granularity === "week") {
        const day = date.getDay();
        const weekStart = addDays(date, day === 0 ? -6 : 1 - day);

        key = localDateString(weekStart);
        label = formatShortDate(key);
      } else if (granularity === "month") {
        key = invoice.dateKey.slice(0, 7);
        label = formatMonth(`${key}-01`);
      } else {
        key = invoice.dateKey;
        label = formatShortDate(key);
      }

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          revenue: 0,
          count: 0
        });
      }

      const group = groups.get(key);

      group.revenue += invoice.revenue;
      group.count += 1;
    });

    return Array.from(groups.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(item => ({
        ...item,
        revenue: roundMoney(item.revenue)
      }));
  }

  function groupByWeekday(transactions) {
    const groups = WEEKDAYS.map((day, index) => ({
      key: index,
      label: day.slice(0, 3),
      revenue: 0,
      count: 0
    }));

    transactions.forEach(invoice => {
      const date = parseLocalDate(invoice.dateKey);

      if (!date) return;

      groups[date.getDay()].revenue += invoice.revenue;
      groups[date.getDay()].count += 1;
    });

    return groups.map(item => ({
      ...item,
      revenue: roundMoney(item.revenue)
    }));
  }

  // ==================================================
  // 11. SVG CHART RENDERING
  // ==================================================

  function showChartMessage(container, message) {
    if (!container) return;

    container.replaceChildren();

    const notice = document.createElement("div");

    notice.textContent = message;
    notice.style.cssText = [
      "min-height:240px",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:24px",
      "text-align:center",
      "color:#6b7280",
      "font-size:13px",
      "line-height:1.7",
      "border:1px dashed #d1d5db",
      "border-radius:6px",
      "width:100%"
    ].join(";");

    container.appendChild(notice);
  }

  function prepareChartContainer(container) {
    if (!container) return false;

    container.style.width = "100%";
    container.style.minWidth = "0";
    container.style.minHeight = "240px";
    container.style.overflow = "hidden";

    return true;
  }

  function svgLabel(x, y, text, options = {}) {
    return `
      <text
        x="${x}"
        y="${y}"
        text-anchor="${options.anchor || "start"}"
        font-size="${options.size || 11}"
        font-weight="${options.weight || 400}"
        fill="${options.fill || "#6b7280"}"
      >${String(text).replace(/[&<>"]/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;"
      })[char])}</text>
    `;
  }

  function svgNumber(value) {
    return Number.isFinite(value) ? String(value) : "0";
  }

  function renderLineChart(container, points) {
    if (!prepareChartContainer(container)) return;

    if (!points.length) {
      showChartMessage(container, "Is reporting period mein data available nahi hai.");
      return;
    }

    if (!points.some(point => point.revenue > 0)) {
      showChartMessage(container, "Selected period mein recorded sales nahi hain.");
      return;
    }

    const width = 900;
    const height = 320;
    const left = 85;
    const right = 24;
    const top = 24;
    const bottom = 52;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    const maximum = Math.max(1, ...points.map(point => point.revenue));

    let svg = `
      <svg
        viewBox="0 0 ${width} ${height}"
        width="100%"
        role="img"
        aria-label="Sales revenue trend"
        xmlns="http://www.w3.org/2000/svg"
        style="display:block;height:auto;max-width:100%;"
      >
    `;

    for (let index = 0; index <= 4; index++) {
      const ratio = index / 4;
      const y = top + ratio * plotHeight;
      const value = maximum * (1 - ratio);

      svg += `
        <line
          x1="${left}"
          y1="${y}"
          x2="${width - right}"
          y2="${y}"
          stroke="#e5e7eb"
          stroke-width="1"
        />
      `;

      svg += svgLabel(
        left - 10,
        y + 4,
        compactMoney(value),
        { anchor: "end", size: 10 }
      );
    }

    const coordinates = points.map((point, index) => {
      const x = points.length === 1
        ? left + plotWidth / 2
        : left + (index / (points.length - 1)) * plotWidth;

      const y = top + plotHeight -
        (point.revenue / maximum) * plotHeight;

      return {
        x,
        y,
        point
      };
    });

    const linePath = coordinates
      .map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
      )
      .join(" ");

    const areaPath = [
      `M ${coordinates[0].x} ${top + plotHeight}`,
      ...coordinates.map(point => `L ${point.x} ${point.y}`),
      `L ${coordinates[coordinates.length - 1].x} ${top + plotHeight}`,
      "Z"
    ].join(" ");

    svg += `
      <path
        d="${areaPath}"
        fill="#d1d5db"
        fill-opacity="0.35"
        stroke="none"
      />

      <path
        d="${linePath}"
        fill="none"
        stroke="#111827"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    `;

    const maximumLabels = 8;
    const labelStep = Math.max(
      1,
      Math.ceil(points.length / maximumLabels)
    );

    coordinates.forEach((coordinate, index) => {
      svg += `
        <circle
          cx="${coordinate.x}"
          cy="${coordinate.y}"
          r="4"
          fill="#111827"
          stroke="#ffffff"
          stroke-width="1.5"
        >
          <title>${coordinate.point.label}: ${money(coordinate.point.revenue)}</title>
        </circle>
      `;

      if (
        index % labelStep === 0 ||
        index === coordinates.length - 1
      ) {
        svg += svgLabel(
          coordinate.x,
          height - 22,
          coordinate.point.label,
          { anchor: "middle", size: 10 }
        );
      }
    });

    svg += "</svg>";

    container.innerHTML = svg;
  }

  function renderHorizontalBarChart(
    container,
    items,
    labelKey,
    valueKey
  ) {
    if (!prepareChartContainer(container)) return;

    if (!items.length || !items.some(item => item[valueKey] > 0)) {
      showChartMessage(container, "Product ya category sales data available nahi hai.");
      return;
    }

    const width = 900;
    const rowHeight = 39;
    const height = Math.max(240, items.length * rowHeight + 28);

    const left = 200;
    const right = 105;
    const top = 12;
    const plotWidth = width - left - right;

    const maximum = Math.max(1, ...items.map(item => item[valueKey]));

    let svg = `
      <svg
        viewBox="0 0 ${width} ${height}"
        width="100%"
        role="img"
        aria-label="Ranked sales performance"
        xmlns="http://www.w3.org/2000/svg"
        style="display:block;height:auto;max-width:100%;"
      >
    `;

    items.forEach((item, index) => {
      const y = top + index * rowHeight;
      const barWidth = plotWidth * item[valueKey] / maximum;

      svg += svgLabel(
        left - 12,
        y + 20,
        item[labelKey],
        {
          anchor: "end",
          size: 11,
          fill: "#374151",
          weight: index === 0 ? 700 : 400
        }
      );

      svg += `
        <rect
          x="${left}"
          y="${y + 4}"
          width="${plotWidth}"
          height="19"
          rx="3"
          fill="#f3f4f6"
        />

        <rect
          x="${left}"
          y="${y + 4}"
          width="${Math.max(0, barWidth)}"
          height="19"
          rx="3"
          fill="${index === 0 ? "#111827" : "#6b7280"}"
        >
          <title>${String(item[labelKey])}: ${money(item[valueKey])}</title>
        </rect>
      `;

      svg += svgLabel(
        width - right + 12,
        y + 19,
        compactMoney(item[valueKey]),
        { size: 10, fill: "#111827" }
      );
    });

    svg += "</svg>";

    container.innerHTML = svg;
  }

  function renderVerticalBarChart(container, points) {
    if (!prepareChartContainer(container)) return;

    if (!points.length || !points.some(point => point.revenue > 0)) {
      showChartMessage(container, "Is chart ke liye sales data available nahi hai.");
      return;
    }

    const width = 900;
    const height = 300;

    const left = 75;
    const right = 22;
    const top = 24;
    const bottom = 52;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const maximum = Math.max(1, ...points.map(point => point.revenue));
    const gap = points.length > 16 ? 3 : 8;

    const barWidth = Math.max(
      2,
      (plotWidth - gap * points.length) / points.length
    );

    let svg = `
      <svg
        viewBox="0 0 ${width} ${height}"
        width="100%"
        role="img"
        aria-label="Revenue bar chart"
        xmlns="http://www.w3.org/2000/svg"
        style="display:block;height:auto;max-width:100%;"
      >
    `;

    for (let index = 0; index <= 4; index++) {
      const ratio = index / 4;
      const y = top + ratio * plotHeight;
      const value = maximum * (1 - ratio);

      svg += `
        <line
          x1="${left}"
          y1="${y}"
          x2="${width - right}"
          y2="${y}"
          stroke="#e5e7eb"
          stroke-width="1"
        />
      `;

      svg += svgLabel(
        left - 10,
        y + 4,
        compactMoney(value),
        { anchor: "end", size: 10 }
      );
    }

    const labelStep = Math.max(
      1,
      Math.ceil(points.length / 10)
    );

    points.forEach((point, index) => {
      const x = left + index * (barWidth + gap);
      const barHeight = point.revenue / maximum * plotHeight;
      const y = top + plotHeight - barHeight;

      svg += `
        <rect
          x="${svgNumber(x)}"
          y="${svgNumber(y)}"
          width="${svgNumber(barWidth)}"
          height="${svgNumber(barHeight)}"
          rx="2"
          fill="#4b5563"
        >
          <title>${point.label}: ${money(point.revenue)}</title>
        </rect>
      `;

      if (index % labelStep === 0 || index === points.length - 1) {
        svg += svgLabel(
          x + barWidth / 2,
          height - 22,
          point.label,
          { anchor: "middle", size: 9 }
        );
      }
    });

    svg += "</svg>";

    container.innerHTML = svg;
  }

  // ==================================================
  // 12. KPI UPDATES
  // ==================================================

  function growthText(current, previous) {
    if (!previous) {
      return "Previous period data nahi hai";
    }

    if (previous.revenue === 0) {
      return current.revenue === 0
        ? "No change"
        : "Previous period mein sales zero thi";
    }

    const change =
      ((current.revenue - previous.revenue) / previous.revenue) * 100;

    return `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs previous period`;
  }

  function growthValue(current, previous) {
    if (!previous) return "—";

    if (previous.revenue === 0) {
      return current.revenue === 0 ? "0%" : "N/A";
    }

    const change =
      ((current.revenue - previous.revenue) / previous.revenue) * 100;

    return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  }

  function updateExecutiveKPIs(current, previous) {
    setText("#reportRevenue", money(current.revenue));
    setText("#reportInvoiceCount", integer(current.invoiceCount));
    setText("#reportAverageOrder", money(current.averageOrderValue));
    setText("#reportGrowth", growthValue(current, previous));

    setText("#reportRevenueChange", growthText(current, previous));

    setText(
      "#reportInvoiceChange",
      previous
        ? `${current.invoiceCount - previous.invoiceCount} invoice difference`
        : "No comparable period"
    );

    setText(
      "#reportGrowthDescription",
      previous?.label || "No comparison data"
    );
  }

  // ==================================================
  // 13. PERFORMANCE TABLES
  // ==================================================

  function renderProductTable(analysis) {
    const body = $("#productPerformanceBody");

    if (!body) return;

    body.replaceChildren();

    if (!analysis.products.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 7;
      cell.textContent = "Selected period mein product sales available nahi hain.";
      cell.style.textAlign = "center";
      cell.style.padding = "24px";

      row.appendChild(cell);
      body.appendChild(row);

      return;
    }

    analysis.products.forEach((product, index) => {
      const row = document.createElement("tr");

      const values = [
        index + 1,
        product.name,
        product.category,
        integer(product.units),
        money(product.revenue),
        percentage(share(product.revenue, analysis.revenue)),
        index === 0 ? "Top Revenue" : "Recorded"
      ];

      values.forEach((value, cellIndex) => {
        const cell = document.createElement("td");

        if (cellIndex === 5 || cellIndex === 4) {
          cell.classList.add("num");
        }

        if (cellIndex === 6) {
          const badge = document.createElement("span");

          badge.className = `pill ${index === 0 ? "paid" : "pending"}`;
          badge.textContent = value;

          cell.appendChild(badge);
        } else {
          cell.textContent = String(value);
        }

        row.appendChild(cell);
      });

      body.appendChild(row);
    });
  }

  function renderCategoryTable(analysis) {
    const body = $("#categoryPerformanceBody");

    if (!body) return;

    body.replaceChildren();

    if (!analysis.categories.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 5;
      cell.textContent = "Selected period mein category sales nahi hain.";
      cell.style.textAlign = "center";
      cell.style.padding = "24px";

      row.appendChild(cell);
      body.appendChild(row);

      return;
    }

    analysis.categories.forEach(category => {
      const row = document.createElement("tr");

      const values = [
        category.name,
        integer(category.productCount),
        integer(category.units),
        money(category.revenue),
        percentage(share(category.revenue, analysis.revenue))
      ];

      values.forEach((value, index) => {
        const cell = document.createElement("td");

        cell.textContent = String(value);

        if (index === 3 || index === 4) {
          cell.classList.add("num");
        }

        row.appendChild(cell);
      });

      body.appendChild(row);
    });
  }

  function renderComparisonTable(current, previous) {
    const body = $("#periodComparisonBody");

    if (!body) return;

    body.replaceChildren();

    if (!previous) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 5;
      cell.textContent = "Comparable historical data available nahi hai.";
      cell.style.textAlign = "center";
      cell.style.padding = "24px";

      row.appendChild(cell);
      body.appendChild(row);

      return;
    }

    const metrics = [
      {
        name: "Sales Revenue",
        current: current.revenue,
        previous: previous.revenue,
        format: money
      },
      {
        name: "Invoices",
        current: current.invoiceCount,
        previous: previous.invoiceCount,
        format: integer
      },
      {
        name: "Average Order Value",
        current: current.averageOrderValue,
        previous: previous.averageOrderValue,
        format: money
      },
      {
        name: "Units Sold",
        current: current.unitsSold,
        previous: previous.unitsSold,
        format: integer
      }
    ];

    metrics.forEach(metric => {
      const row = document.createElement("tr");

      const difference = metric.current - metric.previous;

      const values = [
        metric.name,
        metric.format(metric.current),
        metric.format(metric.previous),
        `${difference > 0 ? "+" : ""}${metric.format(difference)}`,
        metric.previous === 0
          ? (metric.current === 0 ? "0%" : "N/A")
          : `${((difference / metric.previous) * 100).toFixed(1)}%`
      ];

      values.forEach(value => {
        const cell = document.createElement("td");

        cell.textContent = String(value);
        row.appendChild(cell);
      });

      body.appendChild(row);
    });
  }

  // ==================================================
  // 14. BUSINESS INSIGHTS
  // ==================================================

  function renderInsights(current, previous, hourly, weekdays) {
    setStatus(
      state.firebaseReady ? "Live Firebase Data" : "Connecting",
      state.firebaseReady ? "success" : "info"
    );

    setText(
      "#businessInsightsDisclaimer",
      "Insights saved invoice records par based hain. Missing invoice items ya category data se analysis incomplete ho sakta hai. Revenue profit nahi hota."
    );

    setText("#insightsStatus", "Database Insights");

    if (current.invoiceCount === 0) {
      setText("#insightSalesTitle", "No recorded sales");
      setText(
        "#insightSalesText",
        "Selected date range aur filters mein matching invoice records nahi mile."
      );

      setText("#insightProductTitle", "No product ranking");
      setText(
        "#insightProductText",
        "Product analysis ke liye saved invoices mein item-level records zaroori hain."
      );

      setText("#insightTimeTitle", "No peak hour identified");
      setText(
        "#insightTimeText",
        "Hourly pattern tab calculate hoga jab dated invoices available hon."
      );

      setText("#insightCategoryTitle", "No category activity");
      setText(
        "#insightCategoryText",
        "Category analysis ke liye invoice items ka category data zaroori hai."
      );

      return;
    }

    if (previous && previous.revenue > 0) {
      const change =
        ((current.revenue - previous.revenue) / previous.revenue) * 100;

      if (change > 5) {
        setText("#insightSalesTitle", "Revenue increased");
        setText(
          "#insightSalesText",
          `Revenue previous period ke comparison mein ${change.toFixed(1)}% badha.`
        );
      } else if (change < -5) {
        setText("#insightSalesTitle", "Revenue decreased");
        setText(
          "#insightSalesText",
          `Revenue previous period ke comparison mein ${Math.abs(change).toFixed(1)}% kam hua.`
        );
      } else {
        setText("#insightSalesTitle", "Revenue relatively stable");
        setText(
          "#insightSalesText",
          `Revenue mein ${change.toFixed(1)}% change record hua.`
        );
      }
    } else {
      setText("#insightSalesTitle", "Baseline established");
      setText(
        "#insightSalesText",
        "Growth compare karne ke liye previous period mein saved sales honi chahiye."
      );
    }

    const topProduct = current.products[0];

    setText(
      "#insightProductTitle",
      topProduct?.name || "No product data"
    );

    setText(
      "#insightProductText",
      topProduct
        ? `Highest product revenue ${money(topProduct.revenue)} hai, ${percentage(share(topProduct.revenue, current.revenue))} of filtered revenue.`
        : "Invoice records mein product-level sales detail available nahi hai."
    );

    const peakHour = hourly.reduce(
      (best, item) => !best || item.revenue > best.revenue ? item : best,
      null
    );

    setText(
      "#insightTimeTitle",
      peakHour && peakHour.revenue > 0
        ? `Peak hour: ${peakHour.label}`
        : "No peak hour identified"
    );

    setText(
      "#insightTimeText",
      peakHour && peakHour.revenue > 0
        ? `Is hour mein ${money(peakHour.revenue)} revenue record hua.`
        : "Is reporting period mein hourly sales data available nahi hai."
    );

    const topCategory = current.categories[0];

    setText(
      "#insightCategoryTitle",
      topCategory?.name || "No category data"
    );

    setText(
      "#insightCategoryText",
      topCategory
        ? `${topCategory.name} category ka revenue ${money(topCategory.revenue)} raha, yaani ${percentage(share(topCategory.revenue, current.revenue))} of filtered sales.`
        : "Invoice items ke category details available nahi hain."
    );
  }

  // ==================================================
  // 15. RENDER ALL ANALYTICS
  // ==================================================

  function getGranularity() {
    const value = normalise(granularitySelect?.value || "day");

    if (["hour", "hourly"].includes(value)) return "hour";
    if (["week", "weekly"].includes(value)) return "week";
    if (["month", "monthly"].includes(value)) return "month";

    return "day";
  }

  function renderAllReports() {
    clearMessage();

    const range = getSelectedDateRange();

    if (!range.valid) {
      setMessage(range.message, "error");
      return;
    }

    const currentTransactions = getFilteredTransactions(range);
    const current = analyseTransactions(currentTransactions);

    const previousRange = getPreviousDateRange(range);

    let previous = null;

    if (previousRange) {
      const previousTransactions = getFilteredTransactions(previousRange);

      previous = {
        ...analyseTransactions(previousTransactions),
        label: previousRange.label
      };
    }

    updateExecutiveKPIs(current, previous);

    renderProductTable(current);
    renderCategoryTable(current);
    renderComparisonTable(current, previous);

    const trend = groupByTime(
      currentTransactions,
      getGranularity()
    );

    const hourly = groupByTime(currentTransactions, "hour");
    const weekdays = groupByWeekday(currentTransactions);

    renderLineChart($("#salesTrendChart"), trend);

    renderHorizontalBarChart(
      $("#productRevenueChart"),
      current.products.slice(0, 10),
      "name",
      "revenue"
    );

    renderHorizontalBarChart(
      $("#categoryRevenueChart"),
      current.categories.slice(0, 10),
      "name",
      "revenue"
    );

    renderVerticalBarChart($("#hourlySalesChart"), hourly);
    renderVerticalBarChart($("#weekdaySalesChart"), weekdays);

    setText(
      "#salesTrendPeriodLabel",
      `${range.label} · ${range.from} to ${range.to}`
    );

    setText(
      "#salesTrendInsight",
      trend.length
        ? `Trend mein ${trend.length} reporting interval hain.`
        : "No sales intervals available."
    );

    const peakHour = hourly.reduce(
      (best, item) => !best || item.revenue > best.revenue ? item : best,
      null
    );

    setText(
      "#peakHourInsight",
      peakHour && peakHour.revenue > 0
        ? `Highest revenue hour: ${peakHour.label} (${money(peakHour.revenue)})`
        : "Hourly sales data available nahi hai."
    );

    const peakWeekday = weekdays.reduce(
      (best, item) => !best || item.revenue > best.revenue ? item : best,
      null
    );

    setText(
      "#weekdayInsight",
      peakWeekday && peakWeekday.revenue > 0
        ? `Highest revenue weekday: ${peakWeekday.label} (${money(peakWeekday.revenue)})`
        : "Weekday sales data available nahi hai."
    );

    renderInsights(current, previous, hourly, weekdays);

    state.latestReport = {
      range,
      current,
      previous,
      trend,
      hourly,
      weekdays
    };

    if (dataStatus) {
      dataStatus.textContent = "Live Firebase Data";
      dataStatus.dataset.type = "success";
    }
  }

  // ==================================================
  // 16. REPORT EXPORTS
  // ==================================================

  function exportFullReport() {
    const report = state.latestReport;

    if (!report) {
      setMessage("Pehle valid report filter apply karein.", "error");
      return;
    }

    const rows = [
      ["Restaurant Business Analytics Report"],
      ["Data Source", "Firebase Realtime Database"],
      ["Reporting Period", report.range.label],
      ["Start Date", report.range.from],
      ["End Date", report.range.to],
      ["Category", categorySelect?.value || "All Categories"],
      ["Product", productSelect?.selectedOptions?.[0]?.textContent || "All Products"],
      [],
      ["EXECUTIVE SUMMARY"],
      ["Metric", "Value"],
      ["Revenue INR", report.current.revenue.toFixed(2)],
      ["Invoice Count", report.current.invoiceCount],
      ["Units Sold", report.current.unitsSold],
      ["Average Order INR", report.current.averageOrderValue.toFixed(2)],
      ["Cash INR", report.current.cash.toFixed(2)],
      ["UPI INR", report.current.upi.toFixed(2)],
      [],
      ["SALES TREND"],
      ["Interval", "Revenue INR", "Invoices"]
    ];

    report.trend.forEach(point => {
      rows.push([
        point.label,
        point.revenue.toFixed(2),
        point.count
      ]);
    });

    rows.push(
      [],
      ["PRODUCT PERFORMANCE"],
      ["Rank", "Product", "Category", "Units", "Revenue INR", "Revenue Share"]
    );

    report.current.products.forEach((product, index) => {
      rows.push([
        index + 1,
        product.name,
        product.category,
        product.units,
        product.revenue.toFixed(2),
        share(product.revenue, report.current.revenue).toFixed(2)
      ]);
    });

    rows.push(
      [],
      ["CATEGORY PERFORMANCE"],
      ["Category", "Products", "Units", "Revenue INR", "Revenue Share"]
    );

    report.current.categories.forEach(category => {
      rows.push([
        category.name,
        category.productCount,
        category.units,
        category.revenue.toFixed(2),
        share(category.revenue, report.current.revenue).toFixed(2)
      ]);
    });

    rows.push(
      [],
      ["HOURLY PERFORMANCE"],
      ["Hour", "Revenue INR", "Invoices"]
    );

    report.hourly.forEach(point => {
      rows.push([
        point.label,
        point.revenue.toFixed(2),
        point.count
      ]);
    });

    rows.push(
      [],
      ["WEEKDAY PERFORMANCE"],
      ["Weekday", "Revenue INR", "Invoices"]
    );

    report.weekdays.forEach(point => {
      rows.push([
        point.label,
        point.revenue.toFixed(2),
        point.count
      ]);
    });

    downloadCSV(
      rows,
      `business-report-${localDateString()}.csv`
    );

    setMessage("Firebase report CSV export ho gaya.", "success");
  }

  function exportProductReport() {
    const report = state.latestReport;

    if (!report) {
      setMessage("Pehle report filter apply karein.", "error");
      return;
    }

    const rows = [
      [
        "Rank",
        "Product",
        "Category",
        "Units Sold",
        "Revenue INR",
        "Revenue Share Percent"
      ]
    ];

    report.current.products.forEach((product, index) => {
      rows.push([
        index + 1,
        product.name,
        product.category,
        product.units,
        product.revenue.toFixed(2),
        share(product.revenue, report.current.revenue).toFixed(2)
      ]);
    });

    downloadCSV(
      rows,
      `product-performance-${localDateString()}.csv`
    );
  }

  // ==================================================
  // 17. FILTER AND REFRESH EVENTS
  // ==================================================

  filtersForm.addEventListener("submit", event => {
    event.preventDefault();
    renderAllReports();
  });

  filtersForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      updateCustomRangeVisibility();
      populateProductOptions();
      renderAllReports();
    }, 0);
  });

  refreshButton?.addEventListener("click", () => {
    /*
     * Firebase onValue subscription refreshes automatically.
     * This button rerenders from the latest subscribed data.
     */
    renderAllReports();

    setMessage(
      "Report latest received Firebase data se refresh kiya gaya.",
      "success"
    );
  });

  granularitySelect?.addEventListener("change", renderAllReports);
  categorySelect?.addEventListener("change", renderAllReports);
  productSelect?.addEventListener("change", renderAllReports);

  exportButton?.addEventListener("click", exportFullReport);
  exportProductsButton?.addEventListener("click", exportProductReport);

  // ==================================================
  // 18. START LIVE DATABASE SUBSCRIPTION
  // ==================================================

  async function startReports() {
    try {
      setStatus("Connecting to Firebase...", "info");

      if (filterMessage) {
        filterMessage.textContent = "";
      }

      const firebase = await getFirebase();

      await waitForAdministrator(firebase);

      const databaseSDK = firebase.sdk.database;

      const reportReference = databaseSDK.ref(
        firebase.db,
        DATABASE_PATH
      );

      state.unsubscribe = databaseSDK.onValue(
        reportReference,
        snapshot => {
          loadDatabaseData(
            snapshot.exists() ? snapshot.val() : {}
          );

          state.firebaseReady = true;

          renderAllReports();

          setStatus("Live Firebase Data", "success");

          console.info("Reports updated from Firebase.", {
            invoices: state.invoices.length,
            products: state.products.length,
            categories: state.categories.length
          });

          if (state.invoices.length === 0) {
            setMessage(
              "Firebase connected hai, lekin restaurantBilling/invoices mein invoice records nahi mile. Sales charts abhi empty rahenge.",
              "info"
            );
          } else {
            clearMessage();
          }
        },
        error => {
          console.error("Reports database read failed:", error);

          setStatus("Database Error", "error");

          setMessage(
            `Firebase data read nahi ho saka: ${error.message}`,
            "error"
          );
        }
      );
    } catch (error) {
      console.error("Reports initialization failed:", error);

      setStatus("Connection Failed", "error");

      setMessage(
        error.message ||
        "Firebase reports initialize nahi ho paye.",
        "error"
      );

      // Do not generate demo data as a fallback.
      [
        "#salesTrendChart",
        "#productRevenueChart",
        "#categoryRevenueChart",
        "#hourlySalesChart",
        "#weekdaySalesChart"
      ].forEach(selector => {
        showChartMessage(
          $(selector),
          "Firebase data load nahi hua. Connection aur database rules check karein."
        );
      });
    }
  }

  // ==================================================
  // 19. CLEAN UP
  // ==================================================

  window.addEventListener("pagehide", () => {
    state.destroyed = true;

    if (typeof state.unsubscribe === "function") {
      state.unsubscribe();
      state.unsubscribe = null;
    }
  });

  // ==================================================
  // 20. INITIALISE
  // ==================================================

  updateCustomRangeVisibility();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startReports, {
      once: true
    });
  } else {
    startReports();
  }
})();
