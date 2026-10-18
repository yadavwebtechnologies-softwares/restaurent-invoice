/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Live Dashboard
   Database root: restaurantBilling/
   No demo data, no hardcoded business secrets
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const PATHS = Object.freeze({
    invoices: "restaurantBilling/invoices",
    products: "restaurantBilling/products",
    categories: "restaurantBilling/categories",
    settings: "restaurantBilling/settings"
  });

  const el = function (id) {
    return document.getElementById(id);
  };

  const ui = window.restaurantUI;

  let database = null;
  let databaseAPI = null;
  let subscriptions = [];
  let stopped = false;

  const state = {
    invoices: [],
    products: [],
    categories: [],
    settings: null,
    loaded: {
      invoices: false,
      products: false,
      categories: false,
      settings: false
    },
    errors: []
  };

  /* ---------------------------------------------------------
     1. General helpers
     --------------------------------------------------------- */

  function setText(id, value) {
    if (ui && typeof ui.setText === "function") {
      ui.setText(id, value);
      return;
    }

    const node = el(id);

    if (node) {
      node.textContent = String(value ?? "");
    }
  }

  function formatMoney(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount)) {
      return "—";
    }

    if (ui && typeof ui.formatCurrency === "function") {
      return ui.formatCurrency(amount);
    }

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function formatDate(value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }

    const date = value instanceof Date
      ? value
      : new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function localDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function toDate(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
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

  function entries(data) {
    if (!data || typeof data !== "object") {
      return [];
    }

    if (Array.isArray(data)) {
      return data
        .map(function (value, index) {
          if (!value || typeof value !== "object") {
            return null;
          }

          return {
            ...value,
            _recordKey: value._recordKey || String(index)
          };
        })
        .filter(Boolean);
    }

    return Object.entries(data)
      .filter(function (entry) {
        return entry[1] && typeof entry[1] === "object";
      })
      .map(function (entry) {
        return {
          ...entry[1],
          _recordKey: entry[0]
        };
      });
  }

  function firstValue(object, keys) {
    for (const key of keys) {
      const value = object && object[key];

      if (
        value !== null &&
        value !== undefined &&
        value !== ""
      ) {
        return value;
      }
    }

    return null;
  }

  function numericValue(object, keys) {
    const value = firstValue(object, keys);

    if (value === null) {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function setStatus(message, type) {
    const target = el("dashboardStatus");

    if (!target) return;

    target.textContent = message;
    target.classList.remove(
      "is-connected",
      "is-error",
      "is-warning"
    );

    if (type) {
      target.classList.add("is-" + type);
    }
  }

  /* ---------------------------------------------------------
     2. Invoice normalization
     --------------------------------------------------------- */

  function invoiceAmount(invoice) {
    return numericValue(invoice, [
      "grandTotal",
      "grand_total",
      "totalAmount",
      "invoiceTotal",
      "total",
      "amount"
    ]) ?? 0;
  }

  function invoiceStatus(invoice) {
    return normalizeText(
      firstValue(invoice, [
        "recordStatus",
        "invoiceStatus",
        "status"
      ]) || "valid"
    ).toLowerCase();
  }

  function isCancelled(invoice) {
    const status = invoiceStatus(invoice);

    return [
      "cancelled",
      "canceled",
      "void",
      "deleted",
      "invalid"
    ].includes(status);
  }

  function invoiceDate(invoice) {
    const rawDate = firstValue(invoice, [
      "createdAtMs",
      "createdAt",
      "timestamp",
      "invoiceDate",
      "date"
    ]);

    let date = toDate(rawDate);

    if (!date && invoice.invoiceDate && invoice.invoiceTime) {
      date = toDate(
        String(invoice.invoiceDate) + " " +
        String(invoice.invoiceTime)
      );
    }

    return date;
  }

  function invoiceNumber(invoice) {
    return normalizeText(
      firstValue(invoice, [
        "invoiceNumber",
        "number",
        "invoiceNo",
        "invoiceId"
      ]) || invoice._recordKey
    );
  }

  function customerName(invoice) {
    return normalizeText(
      firstValue(invoice, [
        "customerName",
        "customer",
        "customer_name"
      ]) || ""
    ) || "—";
  }

  function paymentMethod(invoice) {
    return normalizeText(
      firstValue(invoice, [
        "paymentMethod",
        "paymentMode",
        "payment_method"
      ]) || ""
    ) || "—";
  }

  function sortInvoicesLatestFirst(invoices) {
    return invoices.slice().sort(function (a, b) {
      const aDate = invoiceDate(a);
      const bDate = invoiceDate(b);

      return (bDate ? bDate.getTime() : 0) -
        (aDate ? aDate.getTime() : 0);
    });
  }

  function getValidInvoices() {
    return state.invoices.filter(function (invoice) {
      return !isCancelled(invoice);
    });
  }

  /* ---------------------------------------------------------
     3. Settings and business profile
     --------------------------------------------------------- */

  function getSettingsObject() {
    return state.settings && typeof state.settings === "object"
      ? state.settings
      : {};
  }

  function getBusinessProfile() {
    const settings = getSettingsObject();

    return (
      settings.businessProfile ||
      settings.business ||
      settings.profile ||
      settings.forms?.businessProfileForm ||
      settings.forms?.businessProfile ||
      settings.businessProfileForm ||
      settings
    );
  }

  function getBusinessName() {
    const profile = getBusinessProfile();

    return normalizeText(
      firstValue(profile, [
        "businessName",
        "name",
        "business_name"
      ]) || ""
    );
  }

  function getBusinessTagline() {
    const profile = getBusinessProfile();

    return normalizeText(
      firstValue(profile, [
        "businessTagline",
        "tagline",
        "description"
      ]) || ""
    );
  }

  function updateBusinessBranding() {
    const name = getBusinessName();
    const tagline = getBusinessTagline();

    /*
     * Empty settings stay empty instead of showing fake
     * business details. HTML loading labels are not records.
     */
    if (name) {
      document.querySelectorAll("[data-business-name]").forEach(
        function (node) {
          node.textContent = name;
        }
      );

      setText("sidebarBusinessName", name);
      setText("businessFooterName", name);

      const mark = el("brandMark");

      if (mark) {
        mark.textContent = name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map(function (part) {
            return part.charAt(0).toUpperCase();
          })
          .join("");
      }
    } else {
      setText("sidebarBusinessName", "");
      setText("businessFooterName", "");
    }

    if (tagline) {
      document.querySelectorAll("[data-business-tagline]").forEach(
        function (node) {
          node.textContent = tagline;
        }
      );

      setText("sidebarBusinessTagline", tagline);
    } else {
      setText("sidebarBusinessTagline", "");
    }

    const authUser = window.restaurantAccess?.user;

    const profileName = normalizeText(
      authUser?.displayName ||
      authUser?.email ||
      ""
    );

    if (profileName) {
      setText("ownerDisplayName", profileName);

      const avatar = el("ownerAvatar");

      if (avatar) {
        avatar.textContent = profileName.charAt(0).toUpperCase();
      }
    } else {
      setText("ownerDisplayName", "");
      setText("ownerAvatar", "");
    }

    setText("ownerDisplayRole", "Owner");
  }

  function getDailyTarget() {
    const settings = getSettingsObject();

    const candidates = [
      settings.dailySalesTarget,
      settings.dailyTarget,
      settings.invoiceSettings?.dailySalesTarget,
      settings.forms?.invoiceSettingsForm?.dailySalesTarget,
      settings.forms?.businessProfileForm?.dailySalesTarget
    ];

    for (const value of candidates) {
      const amount = Number(value);

      if (value !== null && value !== undefined &&
          value !== "" && Number.isFinite(amount) && amount >= 0) {
        return amount;
      }
    }

    return null;
  }

  /* ---------------------------------------------------------
     4. Today's revenue and invoice count
     --------------------------------------------------------- */

  function isToday(invoice) {
    const date = invoiceDate(invoice);

    if (!date) return false;

    return localDateKey(date) === localDateKey(new Date());
  }

  function renderSalesSummary() {
    const validInvoices = getValidInvoices();

    const todayInvoices = validInvoices.filter(isToday);

    const todaySales = todayInvoices.reduce(function (total, invoice) {
      return total + invoiceAmount(invoice);
    }, 0);

    setText("dashboardTodaySales", formatMoney(todaySales));
    setText("dashboardTodayInvoices", String(todayInvoices.length));

    setText(
      "dashboardSalesDescription",
      state.loaded.invoices
        ? "Based on saved, non-cancelled invoices today"
        : "Loading invoice records"
    );

    setText(
      "dashboardInvoicesDescription",
      state.loaded.invoices
        ? "Saved invoices for today"
        : "Loading invoice records"
    );
  }

  /* ---------------------------------------------------------
     5. Products and categories summary
     --------------------------------------------------------- */

  function isActiveRecord(record) {
    if (record.isActive === false || record.active === false) {
      return false;
    }

    if (record.deleted === true || record.deletedAt) {
      return false;
    }

    return true;
  }

  function renderProductSummary() {
    const products = state.products.filter(isActiveRecord);
    const categories = state.categories.filter(isActiveRecord);

    setText(
      "dashboardProductCount",
      state.loaded.products ? String(products.length) : "—"
    );

    setText(
      "dashboardCategoryCount",
      state.loaded.categories ? String(categories.length) : "—"
    );
  }

  /* ---------------------------------------------------------
     6. Daily target progress
     --------------------------------------------------------- */

  function renderDailyTarget() {
    const target = getDailyTarget();

    const todaySales = getValidInvoices()
      .filter(isToday)
      .reduce(function (total, invoice) {
        return total + invoiceAmount(invoice);
      }, 0);

    const progressElement = el("dailyTargetProgress");
    const trackElement = el("dailyTargetTrack");

    if (target === null || target <= 0) {
      setText("dailyTargetValue", "Not set");
      setText("dailyTargetStatus", "Not configured");
      setText(
        "dailyTargetRemaining",
        "Set a daily sales target in Settings to track progress."
      );

      if (progressElement) {
        progressElement.style.width = "0%";
      }

      if (trackElement) {
        trackElement.setAttribute("aria-valuenow", "0");
      }

      return;
    }

    const percentage = Math.min(
      100,
      Math.max(0, (todaySales / target) * 100)
    );

    const remaining = Math.max(0, target - todaySales);

    setText("dailyTargetValue", formatMoney(target));
    setText("dailyTargetStatus", percentage.toFixed(1) + "%");

    setText(
      "dailyTargetRemaining",
      remaining > 0
        ? formatMoney(remaining) + " remaining to reach today's target"
        : "Today's target has been reached."
    );

    if (progressElement) {
      progressElement.style.width = percentage + "%";
    }

    if (trackElement) {
      trackElement.setAttribute(
        "aria-valuenow",
        String(Math.round(percentage))
      );
      trackElement.setAttribute(
        "aria-valuetext",
        percentage.toFixed(1) + "% complete"
      );
    }
  }

  /* ---------------------------------------------------------
     7. Recent invoices table
     --------------------------------------------------------- */

  function appendCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.appendChild(cell);

    return cell;
  }

  function showTableEmpty(body, colspan, message) {
    if (!body) return;

    body.replaceChildren();

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = colspan;
    cell.className = "table-empty";
    cell.textContent = message;

    row.appendChild(cell);
    body.appendChild(row);
  }

  function renderRecentInvoices() {
    const body = el("recentInvoicesTableBody");

    if (!body) return;

    if (!state.loaded.invoices) {
      showTableEmpty(body, 5, "Loading saved invoices.");
      setText("recentInvoicesSummary", "Loading invoice records");
      return;
    }

    const latest = sortInvoicesLatestFirst(getValidInvoices()).slice(0, 8);

    if (!latest.length) {
      showTableEmpty(body, 5, "No saved invoices available.");
      setText("recentInvoicesSummary", "No invoice records found");
      return;
    }

    body.replaceChildren();

    latest.forEach(function (invoice) {
      const row = document.createElement("tr");

      appendCell(row, invoiceNumber(invoice));
      appendCell(row, customerName(invoice));

      const date = invoiceDate(invoice);

      appendCell(row, date ? formatDate(date) : "—");
      appendCell(row, paymentMethod(invoice));
      appendCell(row, formatMoney(invoiceAmount(invoice)));

      body.appendChild(row);
    });

    setText(
      "recentInvoicesSummary",
      "Showing " + latest.length + " of " +
      getValidInvoices().length + " saved invoices"
    );
  }

  /* ---------------------------------------------------------
     8. Top-selling products
     --------------------------------------------------------- */

  function getInvoiceItems(invoice) {
    const items = firstValue(invoice, [
      "items",
      "lineItems",
      "invoiceItems",
      "products"
    ]);

    return Array.isArray(items) ? items : entries(items);
  }

  function getItemName(item) {
    return normalizeText(
      firstValue(item, [
        "productName",
        "itemName",
        "name",
        "title"
      ]) || ""
    );
  }

  function getItemQuantity(item) {
    const quantity = numericValue(item, [
      "quantity",
      "qty",
      "count"
    ]);

    return quantity !== null && quantity > 0 ? quantity : 0;
  }

  function renderTopProducts() {
    const list = el("topProductsList");

    if (!list) return;

    if (!state.loaded.invoices) {
      list.replaceChildren();

      const loading = document.createElement("p");
      loading.className = "empty-state";
      loading.textContent = "Loading invoice items.";

      list.appendChild(loading);
      return;
    }

    const totals = new Map();

    getValidInvoices().forEach(function (invoice) {
      getInvoiceItems(invoice).forEach(function (item) {
        const name = getItemName(item);

        if (!name) return;

        const key = name.toLowerCase();
        const previous = totals.get(key) || {
          name: name,
          quantity: 0
        };

        previous.quantity += getItemQuantity(item);
        totals.set(key, previous);
      });
    });

    const topItems = Array.from(totals.values())
      .sort(function (a, b) {
        return b.quantity - a.quantity;
      })
      .slice(0, 5);

    list.replaceChildren();

    if (!topItems.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No product sales available yet.";

      list.appendChild(empty);
      return;
    }

    topItems.forEach(function (item) {
      const row = document.createElement("div");
      row.className = "product-performance-row";

      const name = document.createElement("strong");
      name.textContent = item.name;

      const quantity = document.createElement("span");
      quantity.textContent =
        String(item.quantity) + " units recorded";

      row.appendChild(name);
      row.appendChild(quantity);

      list.appendChild(row);
    });
  }

  /* ---------------------------------------------------------
     9. Render page
     --------------------------------------------------------- */

  function renderDashboard() {
    if (stopped) return;

    const currentDate = new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    }).format(new Date());

    setText("dashboardCurrentDate", currentDate);

    updateBusinessBranding();
    renderSalesSummary();
    renderProductSummary();
    renderDailyTarget();
    renderRecentInvoices();
    renderTopProducts();

    if (state.errors.length) {
      setStatus(
        "Some database records could not be loaded. Check database permissions and connection.",
        "error"
      );

      setText("dashboardFooterStatus", "Some data unavailable");
      return;
    }

    const allLoaded = Object.values(state.loaded).every(Boolean);

    if (allLoaded) {
      setStatus("Dashboard connected. Live database updates are enabled.", "connected");
      setText("sidebarConnectionStatus", "Database connected");
      setText("dashboardFooterStatus", "Live data connected");

      const connection = el("sidebarConnectionStatus");

      if (connection) {
        connection.classList.add("is-connected");
      }
    } else {
      setStatus("Connecting to live business records...", "warning");
      setText("dashboardFooterStatus", "Loading business records");
    }
  }

  /* ---------------------------------------------------------
     10. Realtime Database subscriptions
     --------------------------------------------------------- */

  function subscribeTo(path, key, normalize) {
    const reference = databaseAPI.ref(database, path);

    const unsubscribe = databaseAPI.onValue(
      reference,

      function (snapshot) {
        if (stopped) return;

        const data = snapshot.exists() ? snapshot.val() : null;

        state[key] = normalize ? normalize(data) : data;
        state.loaded[key] = true;

        state.errors = state.errors.filter(function (error) {
          return error.path !== path;
        });

        renderDashboard();
      },

      function (error) {
        if (stopped) return;

        console.error(
          "Dashboard database read failed:",
          path,
          error && error.code ? error.code : "unknown"
        );

        state.errors = state.errors.filter(function (item) {
          return item.path !== path;
        });

        state.errors.push({
          path: path,
          code: error && error.code ? error.code : "unknown"
        });

        state.loaded[key] = false;

        renderDashboard();
      }
    );

    subscriptions.push(unsubscribe);
  }

  /* ---------------------------------------------------------
     11. Initialize
     --------------------------------------------------------- */

  async function initialize() {
    try {
      setStatus("Checking owner authorization...", "warning");

      const access = window.restaurantAccess;

      if (!access || !access.readyPromise) {
        throw new Error("Protected-page authorization is unavailable.");
      }

      const authorized = await access.readyPromise;

      if (!authorized || !access.authorized || !access.user) {
        stopped = true;
        return;
      }

      if (access.user.uid !== OWNER_UID) {
        throw new Error("The current account is not the configured owner.");
      }

      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.readyPromise) {
        throw new Error("Firebase configuration is unavailable.");
      }

      const ready = await firebase.readyPromise;

      if (!ready || !firebase.ready || !firebase.db || !firebase.sdk) {
        throw new Error(
          firebase.error?.message || "Firebase is not initialized."
        );
      }

      database = firebase.db;
      databaseAPI = firebase.sdk.database;

      if (
        typeof databaseAPI.ref !== "function" ||
        typeof databaseAPI.onValue !== "function"
      ) {
        throw new Error("Realtime Database methods are unavailable.");
      }

      subscribeTo(
        PATHS.invoices,
        "invoices",
        entries
      );

      subscribeTo(
        PATHS.products,
        "products",
        entries
      );

      subscribeTo(
        PATHS.categories,
        "categories",
        entries
      );

      subscribeTo(
        PATHS.settings,
        "settings",
        function (value) {
          return value && typeof value === "object" ? value : {};
        }
      );

      setText("sidebarConnectionStatus", "Loading database records");

    } catch (error) {
      console.error("Dashboard initialization failed:", error);

      setStatus(
        error instanceof Error
          ? error.message
          : "Dashboard could not initialize.",
        "error"
      );

      setText("dashboardFooterStatus", "Initialization failed");
    }
  }

  window.addEventListener("pagehide", function () {
    stopped = true;

    subscriptions.forEach(function (unsubscribe) {
      try {
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      } catch (error) {
        console.warn("Unable to remove a dashboard subscription.", error);
      }
    });

    subscriptions = [];
  });

  initialize();

})();
