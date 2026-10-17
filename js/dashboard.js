
"use strict";

/*
 * Restaurant Billing Software
 * File: js/dashboard.js
 *
 * Firebase integration:
 * - Reads restaurantBilling from Firebase Realtime Database.
 * - Calculates dashboard KPIs from saved invoices.
 * - Builds sales trends, payment split, top products and categories.
 * - Updates the dashboard when Firebase data changes.
 * - Exports real invoice data as CSV.
 *
 * Expected database paths:
 * restaurantBilling/invoices
 * restaurantBilling/products
 * restaurantBilling/categories
 * restaurantBilling/settings
 *
 * Requires firebase-config.js, auth.js and guard.js.
 */

(() => {
  const ADMIN_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const state = {
    root: {},
    settings: {},
    invoices: [],
    products: [],
    categories: [],
    monthlySales: [],
    weeklySales: {
      current: [],
      previous: []
    },
    paymentSplit: {
      upi: 0,
      cash: 0
    },
    hourlyOrders: {
      today: [],
      week: []
    },
    categorySales: [],
    productSales: [],
    todayInvoices: [],
    todayRevenue: 0,
    todayTarget: 0,
    lastUpdated: null,
    unsubscribe: null
  };

  const moneyFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const numberFormatter = new Intl.NumberFormat("en-IN");

  function formatMoney(value) {
    return moneyFormatter.format(Number(value) || 0);
  }

  function formatNumber(value) {
    return numberFormatter.format(Number(value) || 0);
  }

  function setText(element, value) {
    if (element) {
      element.textContent = String(value ?? "");
    }
  }

  function setPlaceholder(element, value) {
    if (!element) return;

    const placeholder = $(".ph", element);

    if (placeholder) {
      placeholder.textContent = String(value ?? "");
    } else {
      element.textContent = String(value ?? "");
    }
  }

  function setProgress(element, percentage) {
    if (!element) return;

    const value = Number(percentage);
    const safeValue = Number.isFinite(value)
      ? Math.max(0, Math.min(100, value))
      : 0;

    element.style.width = `${safeValue}%`;
    element.setAttribute("aria-valuenow", String(safeValue));
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => {
      const entities = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };

      return entities[character];
    });
  }

  function toRecords(value) {
    if (!value || typeof value !== "object") {
      return [];
    }

    if (Array.isArray(value)) {
      return value.filter(item =>
        item && typeof item === "object"
      );
    }

    return Object.entries(value).map(([key, item]) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      return {
        id: item.id || key,
        ...item
      };
    }).filter(Boolean);
  }

  function numeric(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
      ? number
      : fallback;
  }

  function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function parseDate(value) {
    if (!value) return null;

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "number") {
      const date = new Date(value);

      return Number.isNaN(date.getTime()) ? null : date;
    }

    const text = String(value).trim();

    const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (isoDate) {
      const date = new Date(
        Number(isoDate[1]),
        Number(isoDate[2]) - 1,
        Number(isoDate[3])
      );

      return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(text);

    return Number.isNaN(parsed.getTime())
      ? null
      : parsed;
  }

  function getInvoiceDate(invoice) {
    return parseDate(
      invoice.invoiceDate ||
      invoice.date ||
      invoice.createdAt ||
      invoice.timestamp
    );
  }

  function getInvoiceNumber(invoice) {
    return String(
      invoice.invoiceNumber ||
      invoice.number ||
      invoice.id ||
      "Invoice"
    );
  }

  function getInvoiceAmount(invoice) {
    return Math.max(0, numeric(
      invoice.grandTotal ??
      invoice.total ??
      invoice.amount ??
      invoice.totals?.grandTotal,
      0
    ));
  }

  function getInvoiceStatus(invoice) {
    const status = String(
      invoice.status ||
      invoice.invoiceStatus ||
      "generated"
    ).toLowerCase();

    if (status.includes("cancel")) return "Cancelled";
    if (status.includes("draft")) return "Draft";
    if (status.includes("pending")) return "Pending";
    if (status === "paid" || status.includes("paid")) return "Paid";

    return "Generated";
  }

  function isCancelled(invoice) {
    return getInvoiceStatus(invoice) === "Cancelled";
  }

  function isDraft(invoice) {
    return getInvoiceStatus(invoice) === "Draft";
  }

  function isCountable(invoice) {
    return !isCancelled(invoice) && !isDraft(invoice);
  }

  function getInvoiceItems(invoice) {
    const items = invoice.items || invoice.orderItems || [];

    if (Array.isArray(items)) {
      return items;
    }

    if (items && typeof items === "object") {
      return Object.values(items);
    }

    return [];
  }

  function getItemQuantity(item) {
    return Math.max(0, numeric(item.quantity ?? item.qty, 0));
  }

  function getItemPrice(item) {
    return Math.max(0, numeric(
      item.price ??
      item.unitPrice ??
      item.rate,
      0
    ));
  }

  function getItemAmount(item) {
    const amount = item.amount ?? item.lineTotal;

    if (amount !== undefined && Number.isFinite(Number(amount))) {
      return Math.max(0, Number(amount));
    }

    return getItemPrice(item) * getItemQuantity(item);
  }

  function getItemName(item) {
    return String(
      item.name ||
      item.productName ||
      item.title ||
      "Unknown product"
    );
  }

  function getInvoiceCustomer(invoice) {
    return String(
      invoice.customerName ||
      invoice.customer ||
      "Walk-in Customer"
    );
  }

  function getInvoicePayment(invoice) {
    return String(
      invoice.paymentMethod ||
      invoice.payment ||
      ""
    ).toLowerCase();
  }

  function getInvoiceTime(invoice) {
    const raw = invoice.invoiceTime || invoice.time;

    if (raw) {
      const match = String(raw).match(/^(\d{1,2}):(\d{2})/);

      if (match) {
        const hour = Number(match[1]);

        if (hour >= 0 && hour <= 23) {
          return hour;
        }
      }
    }

    const createdAt = parseDate(invoice.createdAt);

    return createdAt ? createdAt.getHours() : null;
  }

  function getMonday(date) {
    const result = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    const day = result.getDay();
    const offset = day === 0 ? -6 : 1 - day;

    result.setDate(result.getDate() + offset);

    return result;
  }

  function sameDate(first, second) {
    return !!first &&
      !!second &&
      getLocalDateKey(first) === getLocalDateKey(second);
  }

  // --------------------------------------------------
  // FIREBASE ACCESS
  // --------------------------------------------------

  async function getFirebase() {
    const firebase = window.restaurantFirebase;

    if (!firebase?.ready) {
      throw new Error(
        "Firebase is unavailable. Check js/firebase-config.js."
      );
    }

    const initialized = await firebase.ready;

    if (
      !initialized ||
      !firebase.auth ||
      !firebase.db ||
      !firebase.sdk?.database
    ) {
      throw new Error(
        "Firebase Authentication or Realtime Database is not ready."
      );
    }

    return firebase;
  }

  async function waitForAdmin(firebase) {
    const auth = firebase.auth;
    const authSDK = firebase.sdk.auth;

    if (auth.currentUser?.uid === ADMIN_UID) {
      return auth.currentUser;
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = null;

      const timeout = window.setTimeout(() => {
        if (settled) return;

        settled = true;

        if (unsubscribe) {
          unsubscribe();
        }

        reject(
          new Error("Administrator authentication timed out.")
        );
      }, 15000);

      authSDK.onAuthStateChanged(
        auth,
        user => {
          if (settled) return;

          if (user?.uid === ADMIN_UID) {
            settled = true;
            window.clearTimeout(timeout);

            if (unsubscribe) {
              unsubscribe();
            }

            resolve(user);
          } else if (!user) {
            settled = true;
            window.clearTimeout(timeout);

            if (unsubscribe) {
              unsubscribe();
            }

            reject(
              new Error(
                "Please sign in with the authorized administrator account."
              )
            );
          }
        },
        error => {
          if (settled) return;

          settled = true;
          window.clearTimeout(timeout);

          if (unsubscribe) {
            unsubscribe();
          }

          reject(error);
        }
      ).then(unsubscriber => {
        unsubscribe = unsubscriber;

        if (settled && unsubscribe) {
          unsubscribe();
        }
      }).catch(error => {
        if (settled) return;

        settled = true;
        window.clearTimeout(timeout);
        reject(error);
      });
    });
  }

  // --------------------------------------------------
  // NORMALIZE DATABASE DATA
  // --------------------------------------------------

  function loadCollections(root) {
    state.root = root || {};

    state.settings =
      state.root.settings ||
      state.root.businessProfile ||
      state.root.profile ||
      {};

    state.invoices = toRecords(
      state.root.invoices ||
      state.root.invoiceRecords ||
      state.root.sales
    );

    state.products = toRecords(
      state.root.products ||
      state.root.catalog?.products
    );

    state.categories = toRecords(
      state.root.categories ||
      state.root.catalog?.categories
    );

    calculateAnalytics();
  }

  // --------------------------------------------------
  // BUILD ANALYTICS FROM SAVED INVOICES
  // --------------------------------------------------

  function calculateAnalytics() {
    const now = new Date();
    const todayKey = getLocalDateKey(now);
    const monday = getMonday(now);
    const previousMonday = new Date(monday);

    previousMonday.setDate(previousMonday.getDate() - 7);

    const nextMonday = new Date(monday);
    nextMonday.setDate(nextMonday.getDate() + 7);

    const productsById = new Map();
    const productsByName = new Map();
    const categoriesById = new Map();

    state.products.forEach(product => {
      const id = product.id || product.productId;

      if (id) {
        productsById.set(String(id), product);
      }

      const name = String(
        product.name || product.productName || ""
      ).toLowerCase();

      if (name) {
        productsByName.set(name, product);
      }
    });

    state.categories.forEach(category => {
      const id = category.id || category.categoryId;

      if (id) {
        categoriesById.set(String(id), category);
      }
    });

    const validInvoices = state.invoices.filter(isCountable);

    state.todayInvoices = validInvoices.filter(invoice => {
      return getInvoiceDate(invoice) &&
        getLocalDateKey(getInvoiceDate(invoice)) === todayKey;
    });

    state.todayRevenue = state.todayInvoices.reduce(
      (sum, invoice) => sum + getInvoiceAmount(invoice),
      0
    );

    const invoicesToday = state.todayInvoices;

    const currentWeek = [];
    const previousWeek = [];

    const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    for (let index = 0; index < 7; index += 1) {
      const currentDate = new Date(monday);
      currentDate.setDate(currentDate.getDate() + index);

      const previousDate = new Date(previousMonday);
      previousDate.setDate(previousDate.getDate() + index);

      currentWeek.push({
        day: weekdayLabels[index],
        date: getLocalDateKey(currentDate),
        revenue: 0
      });

      previousWeek.push({
        day: weekdayLabels[index],
        date: getLocalDateKey(previousDate),
        revenue: 0
      });
    }

    const sixMonthSales = [];

    for (let offset = 5; offset >= 0; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);

      sixMonthSales.push({
        year: date.getFullYear(),
        monthNumber: date.getMonth(),
        month: date.toLocaleString("en-IN", { month: "short" }),
        revenue: 0
      });
    }

    const paymentSplit = {
      upi: 0,
      cash: 0
    };

    const todayHours = Array(24).fill(0);
    const weekHours = Array(24).fill(0);

    const categoryTotals = new Map();
    const productTotals = new Map();

    for (const invoice of validInvoices) {
      const date = getInvoiceDate(invoice);
      const amount = getInvoiceAmount(invoice);

      if (!date) continue;

      const invoiceDateKey = getLocalDateKey(date);

      const weekIndex = currentWeek.findIndex(
        item => item.date === invoiceDateKey
      );

      if (weekIndex >= 0) {
        currentWeek[weekIndex].revenue += amount;
      }

      const previousWeekIndex = previousWeek.findIndex(
        item => item.date === invoiceDateKey
      );

      if (previousWeekIndex >= 0) {
        previousWeek[previousWeekIndex].revenue += amount;
      }

      const monthEntry = sixMonthSales.find(
        item =>
          item.year === date.getFullYear() &&
          item.monthNumber === date.getMonth()
      );

      if (monthEntry) {
        monthEntry.revenue += amount;
      }

      if (invoiceDateKey === todayKey) {
        const hour = getInvoiceTime(invoice);

        if (hour !== null) {
          todayHours[hour] += 1;
        }

        const payment = getInvoicePayment(invoice);

        if (payment === "upi") {
          paymentSplit.upi += amount;
        } else if (payment === "cash") {
          paymentSplit.cash += amount;
        }
      }

      if (date >= monday && date < nextMonday) {
        const hour = getInvoiceTime(invoice);

        if (hour !== null) {
          weekHours[hour] += 1;
        }
      }

      for (const item of getInvoiceItems(invoice)) {
        if (!item || typeof item !== "object") continue;

        const itemName = getItemName(item);
        const quantity = getItemQuantity(item);
        const itemRevenue = getItemAmount(item);

        const productId = String(
          item.productId || item.productID || item.id || ""
        );

        const product =
          productsById.get(productId) ||
          productsByName.get(itemName.toLowerCase());

        const productKey = productId || itemName.toLowerCase();

        const existingProduct = productTotals.get(productKey) || {
          name: product?.name || product?.productName || itemName,
          quantity: 0,
          revenue: 0
        };

        existingProduct.quantity += quantity;
        existingProduct.revenue += itemRevenue;

        productTotals.set(productKey, existingProduct);

        const categoryId = String(
          item.categoryId ||
          item.categoryID ||
          product?.categoryId ||
          ""
        );

        const categoryName =
          item.categoryName ||
          product?.categoryName ||
          categoriesById.get(categoryId)?.name ||
          categoriesById.get(categoryId)?.categoryName ||
          (typeof product?.category === "string" ? product.category : "") ||
          "Uncategorized";

        const existingCategory = categoryTotals.get(categoryName) || {
          name: categoryName,
          revenue: 0,
          quantity: 0
        };

        existingCategory.revenue += itemRevenue;
        existingCategory.quantity += quantity;

        categoryTotals.set(categoryName, existingCategory);
      }
    }

    const totalSalesForPayments =
      paymentSplit.upi + paymentSplit.cash;

    state.paymentSplit = paymentSplit;
    state.weeklySales = {
      current: currentWeek,
      previous: previousWeek
    };

    state.monthlySales = sixMonthSales;

    state.hourlyOrders = {
      today: todayHours,
      week: weekHours
    };

    state.productSales = Array.from(productTotals.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    state.categorySales = Array.from(categoryTotals.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map(item => ({
        ...item,
        share: 0
      }));

    const categoryRevenue = state.categorySales.reduce(
      (sum, item) => sum + item.revenue,
      0
    );

    state.categorySales.forEach(item => {
      item.share = categoryRevenue > 0
        ? Math.round(item.revenue / categoryRevenue * 100)
        : 0;
    });

    state.todayTarget = Math.max(
      0,
      numeric(
        state.settings.dailyTarget ??
        state.settings.targetAmount ??
        state.settings.target?.amount,
        0
      )
    );

    state.lastUpdated = new Date();

    // Keep calculated values available for page-specific features.
    state.metrics = {
      todayRevenue: state.todayRevenue,
      todayInvoiceCount: invoicesToday.length,
      generatedInvoices: validInvoices.length,
      cancelledInvoices: state.invoices.filter(isCancelled).length,
      draftInvoices: state.invoices.filter(isDraft).length,
      averageBill: invoicesToday.length
        ? state.todayRevenue / invoicesToday.length
        : 0,
      paymentTotal: totalSalesForPayments
    };
  }

  // --------------------------------------------------
  // BUSINESS PROFILE AND DAILY TARGET
  // --------------------------------------------------

  function renderBusinessDetails() {
    const businessName = state.settings.businessName ||
      state.settings.name ||
      "[Business Name]";

    const tagline = state.settings.tagline ||
      "Restaurant Billing & Analytics";

    const ownerName = state.settings.ownerName ||
      state.settings.owner ||
      "[Owner Name]";

    $$(".brand-text h1 .ph").forEach(element => {
      setText(element, businessName);
    });

    $$(".brand-text > span .ph").forEach(element => {
      setText(element, tagline);
    });

    $$(".profile .name .ph").forEach(element => {
      setText(element, ownerName);
    });

    $$(".profile .role .ph").forEach(element => {
      setText(element, "Administrator");
    });

    $$(".page-footer > span:first-child .ph:first-child").forEach(element => {
      setText(element, businessName);
    });
  }

  function renderTarget() {
    const card = $(".target-card");

    if (!card) return;

    const target = state.todayTarget;
    const achieved = state.todayRevenue;

    const percentage = target > 0
      ? Math.min(100, Math.round(achieved / target * 100))
      : 0;

    const remaining = Math.max(0, target - achieved);

    setPlaceholder($(".value", card), formatMoney(target));

    const meta = $$(".target-meta span", card);

    if (meta[0]) {
      meta[0].textContent = target > 0
        ? `${percentage}% achieved`
        : "Target not set";
    }

    if (meta[1]) {
      meta[1].textContent = target > 0
        ? `${formatMoney(remaining)} left`
        : "Configure in Settings";
    }

    setProgress($(".target-fill", card), percentage);
  }

  // --------------------------------------------------
  // KPI CARDS
  // --------------------------------------------------

  function renderKpis() {
    const metrics = state.metrics || {};
    const values = [
      formatMoney(metrics.todayRevenue),
      formatNumber(metrics.todayInvoiceCount),
      formatMoney(metrics.averageBill),
      formatNumber(metrics.draftInvoices)
    ];

    $$(".kpi .kpi-value").forEach((element, index) => {
      if (values[index] !== undefined) {
        setPlaceholder(element, values[index]);
      }
    });

    const subtitles = $$(".kpi .kpi-sub");

    if (subtitles[0]) {
      subtitles[0].textContent = "Today's saved invoice revenue";
    }

    if (subtitles[1]) {
      subtitles[1].textContent =
        `${metrics.generatedInvoices || 0} generated · ` +
        `${metrics.cancelledInvoices || 0} cancelled`;
    }

    if (subtitles[2]) {
      subtitles[2].textContent = "Based on today's saved invoices";
    }

    if (subtitles[3]) {
      subtitles[3].textContent = "Invoices currently marked as drafts";
    }
  }

  // --------------------------------------------------
  // WEEKLY SALES CHART
  // --------------------------------------------------

  function renderWeeklySales() {
    const columns = $$(".chart .chart-col");
    const current = state.weeklySales.current;
    const previous = state.weeklySales.previous;

    const maxRevenue = Math.max(
      1,
      ...current.map(item => item.revenue),
      ...previous.map(item => item.revenue)
    );

    columns.forEach((column, index) => {
      const bars = $$(".bar", column);
      const currentDay = current[index];
      const previousDay = previous[index];

      const currentHeight = currentDay
        ? currentDay.revenue / maxRevenue * 100
        : 0;

      const previousHeight = previousDay
        ? previousDay.revenue / maxRevenue * 100
        : 0;

      if (bars[0]) {
        setProgress(bars[0], currentHeight);

        bars[0].title = currentDay
          ? `${currentDay.day}: ${formatMoney(currentDay.revenue)}`
          : "No data";

        bars[0].setAttribute(
          "aria-label",
          currentDay
            ? `${currentDay.day} current week sales ${formatMoney(currentDay.revenue)}`
            : "No sales data"
        );
      }

      if (bars[1]) {
        setProgress(bars[1], previousHeight);

        bars[1].title = previousDay
          ? `${previousDay.day}: ${formatMoney(previousDay.revenue)}`
          : "No data";

        bars[1].setAttribute(
          "aria-label",
          previousDay
            ? `${previousDay.day} previous week sales ${formatMoney(previousDay.revenue)}`
            : "No sales data"
        );
      }

      setText(
        $(".chart-day", column),
        currentDay?.day || ""
      );
    });
  }

  // --------------------------------------------------
  // PAYMENT SPLIT
  // --------------------------------------------------

  function renderPaymentSplit() {
    const upi = state.paymentSplit.upi;
    const cash = state.paymentSplit.cash;
    const total = upi + cash;

    const upiPercent = total > 0 ? upi / total * 100 : 0;
    const cashPercent = total > 0 ? cash / total * 100 : 0;

    const card = $$(".row-2 .card").find(element =>
      $("h3", element)?.textContent.trim() === "Payment Split"
    );

    if (!card) return;

    const segments = $$(".split-seg", card);
    const values = $$(".sl-val", card);

    setProgress(segments[0], upiPercent);
    setProgress(segments[1], cashPercent);

    if (values[0]) {
      values[0].textContent =
        `${formatMoney(upi)} · ${Math.round(upiPercent)}%`;
    }

    if (values[1]) {
      values[1].textContent =
        `${formatMoney(cash)} · ${Math.round(cashPercent)}%`;
    }

    const subtitle = $("p", $(".card-head", card));

    if (subtitle) {
      subtitle.textContent =
        `Today's recorded cash and UPI: ${formatMoney(total)}`;
    }
  }

  // --------------------------------------------------
  // PERFORMANCE REPORT
  // --------------------------------------------------

  function renderPerformanceReport() {
    const hero = $(".report-hero");

    if (!hero) return;

    const months = state.monthlySales;
    const currentMonth = months[months.length - 1];
    const previousMonth = months[months.length - 2];

    const growth = previousMonth && previousMonth.revenue > 0
      ? (
          (currentMonth.revenue - previousMonth.revenue) /
          previousMonth.revenue
        ) * 100
      : null;

    const values = $$(".rs-value", hero);

    if (values[0]) {
      setPlaceholder(
        values[0],
        formatMoney(currentMonth?.revenue || 0)
      );
    }

    if (values[1]) {
      const firstDay = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        1
      );

      const currentMonthInvoices = state.invoices.filter(invoice => {
        const date = getInvoiceDate(invoice);

        return date &&
          date >= firstDay &&
          !isCancelled(invoice) &&
          !isDraft(invoice);
      });

      setPlaceholder(values[1], formatNumber(currentMonthInvoices.length));
    }

    if (values[2]) {
      setPlaceholder(
        values[2],
        growth === null
          ? "—"
          : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`
      );
    }
  }

  // --------------------------------------------------
  // MONTHLY SALES
  // --------------------------------------------------

  function renderMonthlySales() {
    const card = $$(".row-3 .card").find(element =>
      $("h3", element)?.textContent.trim() === "Monthly Trend"
    );

    if (!card) return;

    const rows = $$(".cat-item", card);
    const months = state.monthlySales;
    const maxValue = Math.max(
      1,
      ...months.map(item => item.revenue)
    );

    rows.forEach((row, index) => {
      const item = months[index];

      setText($(".cat-name", row), item?.month || "—");
      setPlaceholder(
        $(".cat-val", row),
        item ? formatMoney(item.revenue) : "—"
      );

      setProgress(
        $(".cat-fill", row),
        item ? item.revenue / maxValue * 100 : 0
      );
    });
  }

  // --------------------------------------------------
  // TOP CATEGORIES
  // --------------------------------------------------

  function renderCategories() {
    const card = $$(".row-3 .card").find(element =>
      $("h3", element)?.textContent.trim() === "Top Categories"
    );

    if (!card) return;

    const rows = $$(".cat-item", card);
    const categories = state.categorySales;
    const maxRevenue = Math.max(
      1,
      ...categories.map(item => item.revenue)
    );

    rows.forEach((row, index) => {
      const item = categories[index];

      setText($(".cat-name", row), item?.name || "—");

      const value = $(".cat-val", row);

      if (value) {
        value.textContent = item
          ? `${formatMoney(item.revenue)} · ${item.share}%`
          : "—";
      }

      setProgress(
        $(".cat-fill", row),
        item ? item.revenue / maxRevenue * 100 : 0
      );
    });
  }

  // --------------------------------------------------
  // DATA-BASED KEY METRICS
  // --------------------------------------------------

  function renderKeyMetrics() {
    const card = $$(".row-3 .card").find(element =>
      $("h3", element)?.textContent.trim() === "Key Metrics"
    );

    if (!card) return;

    const values = $$(".metric-value", card);
    const labels = $$(".metric-label", card);

    const totalCategoryRevenue = state.categorySales.reduce(
      (sum, item) => sum + item.revenue,
      0
    );

    const topCategory = state.categorySales[0];
    const categoryShare = totalCategoryRevenue > 0 && topCategory
      ? topCategory.revenue / totalCategoryRevenue * 100
      : null;

    const totalPayment =
      state.paymentSplit.upi + state.paymentSplit.cash;

    const upiShare = totalPayment > 0
      ? state.paymentSplit.upi / totalPayment * 100
      : null;

    const todayHours = state.hourlyOrders.today;
    const peakOrders = Math.max(0, ...todayHours);
    const peakHour = todayHours.indexOf(peakOrders);

    if (values[0]) {
      setPlaceholder(
        values[0],
        categoryShare === null ? "—" : `${categoryShare.toFixed(1)}%`
      );
    }

    if (values[1]) {
      setPlaceholder(
        values[1],
        upiShare === null ? "—" : `${upiShare.toFixed(1)}%`
      );
    }

    if (values[2]) {
      setPlaceholder(
        values[2],
        peakOrders > 0
          ? `${String(peakHour).padStart(2, "0")}:00`
          : "—"
      );
    }

    const thirdMetric = labels[2]?.closest(".metric");
    const delta = thirdMetric
      ? $(".metric-delta", thirdMetric)
      : null;

    if (delta) {
      delta.textContent = peakOrders > 0
        ? `${peakOrders} recorded invoices`
        : "No hourly invoice data";
    }
  }

  // --------------------------------------------------
  // TOP SELLING PRODUCTS
  // --------------------------------------------------

  function renderProducts() {
    const card = $$(".row-2 .card").find(element =>
      $("h3", element)?.textContent.trim() === "Top Selling Products"
    );

    if (!card) return;

    const rows = $$(".prod-item", card);
    const products = state.productSales;
    const maxQuantity = Math.max(
      1,
      ...products.map(item => item.quantity)
    );

    rows.forEach((row, index) => {
      const item = products[index];

      const name = $(".p-name span:first-child", row);
      const quantity = $(".p-name span:last-child", row);

      setText(name, item?.name || "—");
      setText(
        quantity,
        item ? `${formatNumber(item.quantity)} sold` : "—"
      );

      setProgress(
        $(".prod-fill", row),
        item ? item.quantity / maxQuantity * 100 : 0
      );

      row.title = item
        ? `${item.name}: ${formatMoney(item.revenue)} sales`
        : "No product sales data";
    });
  }

  // --------------------------------------------------
  // THIS WEEK VS LAST WEEK
  // --------------------------------------------------

  function renderComparisonMetrics() {
    const section = $(".row-2-even");

    if (!section) return;

    const card = $$(".card", section).find(element =>
      $("h3", element)?.textContent.trim() === "This Week vs Last Week"
    );

    if (!card) return;

    const currentWeek = state.weeklySales.current.reduce(
      (sum, item) => sum + item.revenue,
      0
    );

    const previousWeek = state.weeklySales.previous.reduce(
      (sum, item) => sum + item.revenue,
      0
    );

    const change = previousWeek > 0
      ? (
          (currentWeek - previousWeek) /
          previousWeek
        ) * 100
      : null;

    const values = $$(".metric-value", card);

    if (values[0]) {
      setPlaceholder(values[0], formatMoney(currentWeek));
    }

    if (values[1]) {
      setPlaceholder(values[1], formatMoney(previousWeek));
    }

    const delta = $(".metric-delta", card);

    if (delta) {
      delta.textContent = change === null
        ? "No previous-week comparison data"
        : `${change >= 0 ? "+" : ""}${change.toFixed(1)}% vs last week`;
    }
  }

  // --------------------------------------------------
  // CUSTOMER INSIGHTS
  // --------------------------------------------------

  function renderCustomerInsights() {
    const section = $(".row-2-even");

    if (!section) return;

    const card = $$(".card", section).find(element =>
      $("h3", element)?.textContent.trim() === "Customer Insight"
    );

    if (!card) return;

    const counts = new Map();

    state.invoices
      .filter(isCountable)
      .forEach(invoice => {
        const customer = getInvoiceCustomer(invoice).trim();

        if (
          !customer ||
          customer.toLowerCase() === "walk-in customer" ||
          customer.toLowerCase() === "walk-in"
        ) {
          return;
        }

        const key = customer.toLowerCase();

        counts.set(key, (counts.get(key) || 0) + 1);
      });

    const customers = Array.from(counts.values());

    const repeatCount = customers.filter(count => count > 1).length;
    const newCount = customers.filter(count => count === 1).length;
    const total = repeatCount + newCount;

    const repeatPercent = total > 0
      ? repeatCount / total * 100
      : 0;

    const newPercent = total > 0
      ? newCount / total * 100
      : 0;

    const segments = $$(".split-seg", card);
    const values = $$(".sl-val", card);

    setProgress(segments[0], repeatPercent);
    setProgress(segments[1], newPercent);

    if (values[0]) {
      values[0].textContent =
        `${Math.round(repeatPercent)}% · ${repeatCount}`;
    }

    if (values[1]) {
      values[1].textContent =
        `${Math.round(newPercent)}% · ${newCount}`;
    }

    const subtitle = $("p", $(".card-head", card));

    if (subtitle) {
      subtitle.textContent =
        "Based on customer names in saved invoices; not a complete customer account history.";
    }
  }

  // --------------------------------------------------
  // RECENT INVOICES
  // --------------------------------------------------

  function renderInvoices() {
    const table = $(".inv-table tbody");

    if (!table) return;

    const invoices = [...state.invoices]
      .sort((a, b) => {
        const first = getInvoiceDate(a)?.getTime() || 0;
        const second = getInvoiceDate(b)?.getTime() || 0;

        return second - first;
      })
      .slice(0, 5);

    table.replaceChildren();

    if (invoices.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 5;
      cell.textContent = "No saved invoices found.";

      row.appendChild(cell);
      table.appendChild(row);

      return;
    }

    for (const invoice of invoices) {
      const row = document.createElement("tr");
      const date = getInvoiceDate(invoice);
      const customer = getInvoiceCustomer(invoice);

      const cells = [
        getInvoiceNumber(invoice),
        "",
        date
          ? date.toLocaleString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit"
            })
          : "—",
        formatMoney(getInvoiceAmount(invoice)),
        ""
      ];

      cells.forEach((value, index) => {
        const cell = document.createElement("td");

        if (index === 1) {
          const name = document.createElement("div");
          name.className = "cust-name";
          name.textContent = customer;

          const detail = document.createElement("div");
          detail.className = "cust-sub";
          detail.textContent = String(
            invoice.orderType || invoice.detail || ""
          );

          cell.append(name, detail);
        } else if (index === 4) {
          const badge = document.createElement("span");
          const status = getInvoiceStatus(invoice);

          badge.className = "pill";

          if (status === "Paid") {
            badge.classList.add("paid");
          } else if (status === "Pending") {
            badge.classList.add("pending");
          } else if (status === "Cancelled") {
            badge.classList.add("cancelled");
          } else {
            badge.classList.add("draft");
          }

          badge.textContent = status;
          cell.appendChild(badge);
        } else {
          cell.textContent = String(value);
        }

        row.appendChild(cell);
      });

      table.appendChild(row);
    }
  }

  // --------------------------------------------------
  // HOURLY SALES / ORDER HEATMAP
  // --------------------------------------------------

  function getHourlyCard() {
    return $$(".row-2 .card").find(element =>
      $("h3", element)?.textContent.trim() === "Hourly Sales Heatmap"
    );
  }

  function renderHourlyHeatmap(period = "today") {
    const card = getHourlyCard();

    if (!card) return;

    const values = state.hourlyOrders[period];
    const cells = $$(".hour-cell", card);

    if (!values || cells.length === 0) return;

    const visibleValues = cells.map(cell => {
      const hour = Number(cell.textContent.trim());

      return Number.isInteger(hour) && hour >= 0 && hour <= 23
        ? values[hour] || 0
        : 0;
    });

    const maxValue = Math.max(1, ...visibleValues);

    cells.forEach((cell, index) => {
      const value = visibleValues[index];

      cell.classList.remove(
        "level-1",
        "level-2",
        "level-3",
        "level-4",
        "level-5"
      );

      const level = value > 0
        ? Math.min(5, Math.max(1, Math.ceil(value / maxValue * 5)))
        : 0;

      if (level > 0) {
        cell.classList.add(`level-${level}`);
      }

      cell.title = `${cell.textContent}:00 — ${value} invoices`;
      cell.setAttribute(
        "aria-label",
        `${cell.textContent}:00, ${value} invoices`
      );
    });

    const subtitle = $(".card-head p", card);

    if (subtitle) {
      subtitle.textContent = period === "today"
        ? "Saved invoices by hour today"
        : "Saved invoices by hour this week";
    }

    const peak = Math.max(0, ...visibleValues);
    const peakIndex = visibleValues.indexOf(peak);
    const slow = Math.min(...visibleValues);
    const slowIndex = visibleValues.indexOf(slow);

    const summary = card.querySelector(".card-body > div:last-child");

    if (summary) {
      const spans = $$("span", summary);

      if (spans[0]) {
        spans[0].textContent = peak > 0
          ? `Peak: ${cells[peakIndex]?.textContent ?? "—"} · ${peak} invoices`
          : "Peak: —";
      }

      if (spans[1]) {
        spans[1].textContent = slow > 0
          ? `Lowest: ${cells[slowIndex]?.textContent ?? "—"} · ${slow} invoices`
          : "No hourly data";
      }
    }

    $$(".report-tab", card).forEach(button => {
      const selected =
        (period === "today" && button.textContent.trim() === "Today") ||
        (period === "week" && button.textContent.trim() === "Week");

      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  // --------------------------------------------------
  // EXPORT REAL DATABASE DATA
  // --------------------------------------------------

  function exportDashboardCsv() {
    const lines = [
      ["Restaurant Dashboard Report"],
      ["Generated at", new Date().toLocaleString("en-IN")],
      [],
      ["Metric", "Value"],
      ["Today's revenue", state.todayRevenue],
      ["Today's invoices", state.todayInvoices.length],
      ["Daily target", state.todayTarget],
      [],
      ["Weekly Sales", "Day", "Current Week Revenue", "Previous Week Revenue"]
    ];

    state.weeklySales.current.forEach((item, index) => {
      lines.push([
        "Weekly Sales",
        item.day,
        item.revenue,
        state.weeklySales.previous[index]?.revenue || 0
      ]);
    });

    lines.push(
      [],
      ["Payment Method", "Amount"],
      ["UPI", state.paymentSplit.upi],
      ["Cash", state.paymentSplit.cash],
      [],
      ["Category", "Revenue", "Share (%)"]
    );

    state.categorySales.forEach(item => {
      lines.push([item.name, item.revenue, item.share]);
    });

    lines.push(
      [],
      ["Product", "Quantity Sold", "Revenue"]
    );

    state.productSales.forEach(item => {
      lines.push([item.name, item.quantity, item.revenue]);
    });

    lines.push(
      [],
      ["Invoice Number", "Customer", "Date", "Amount", "Status"]
    );

    state.invoices.forEach(invoice => {
      const date = getInvoiceDate(invoice);

      lines.push([
        getInvoiceNumber(invoice),
        getInvoiceCustomer(invoice),
        date ? getLocalDateKey(date) : "",
        getInvoiceAmount(invoice),
        getInvoiceStatus(invoice)
      ]);
    });

    const csv = lines.map(row =>
      row.map(value => {
        const text = String(value ?? "");

        return `"${text.replace(/"/g, '""')}"`;
      }).join(",")
    ).join("\r\n");

    const blob = new Blob(
      ["\uFEFF", csv],
      { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download =
      `dashboard-report-${getLocalDateKey()}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --------------------------------------------------
  // EVENTS
  // --------------------------------------------------

  function bindDashboardEvents() {
    const exportButton = $(".page-actions .btn-soft");

    if (exportButton) {
      exportButton.addEventListener("click", exportDashboardCsv);
      exportButton.setAttribute("type", "button");
    }

    const heatmapCard = getHourlyCard();

    if (heatmapCard) {
      $$(".report-tab", heatmapCard).forEach(button => {
        button.addEventListener("click", () => {
          const period = button.textContent.trim().toLowerCase();

          if (period === "today" || period === "week") {
            renderHourlyHeatmap(period);
          }
        });
      });
    }

    $$(".chart .bar").forEach(bar => {
      if (!bar.hasAttribute("tabindex")) {
        bar.setAttribute("tabindex", "0");
      }
    });
  }

  // --------------------------------------------------
  // RENDER DASHBOARD
  // --------------------------------------------------

  function renderDashboard() {
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
  }

  function showDashboardError(message) {
    console.error("Dashboard:", message);

    const heading = $(".page-head");

    if (!heading) return;

    let notice = $("#dashboardDataNotice");

    if (!notice) {
      notice = document.createElement("div");
      notice.id = "dashboardDataNotice";
      notice.setAttribute("role", "status");
      notice.style.cssText =
        "margin-top:12px;padding:12px;border:1px solid #d0d0d0;border-radius:5px;";

      heading.appendChild(notice);
    }

    notice.textContent = message;
  }

  function clearDashboardError() {
    $("#dashboardDataNotice")?.remove();
  }

  // --------------------------------------------------
  // LIVE FIREBASE SUBSCRIPTION
  // --------------------------------------------------

  async function startDashboard() {
    if (!$(".app") || !$(".kpis")) {
      return;
    }

    try {
      const firebase = await getFirebase();

      await waitForAdmin(firebase);

      const databaseSDK = firebase.sdk.database;
      const rootReference = databaseSDK.ref(
        firebase.db,
        "restaurantBilling"
      );

      state.unsubscribe = databaseSDK.onValue(
        rootReference,
        snapshot => {
          const data = snapshot.exists()
            ? snapshot.val()
            : {};

          loadCollections(data);
          renderDashboard();
          clearDashboardError();

          console.info(
            "Dashboard refreshed from Firebase.",
            {
              invoices: state.invoices.length,
              products: state.products.length,
              categories: state.categories.length,
              updatedAt: state.lastUpdated?.toISOString()
            }
          );
        },
        error => {
          showDashboardError(
            `Unable to read dashboard data from Firebase: ${error.message}`
          );
        }
      );

      bindDashboardEvents();
    } catch (error) {
      showDashboardError(
        error.message ||
        "Unable to initialize the Firebase dashboard."
      );
    }
  }

  // --------------------------------------------------
  // CLEAN UP
  // --------------------------------------------------

  window.addEventListener("pagehide", () => {
    if (typeof state.unsubscribe === "function") {
      state.unsubscribe();
      state.unsubscribe = null;
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startDashboard);
  } else {
    startDashboard();
  }
})();
