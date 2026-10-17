"use strict";

/*
 * Restaurant Billing Software
 * File: js/invoices.js
 *
 * Live Firebase invoice management.
 *
 * Database:
 * restaurantBilling/invoices
 * restaurantBilling/settings (optional business profile)
 *
 * Features:
 * - Live invoice data using Firebase Realtime Database
 * - Owner authentication validation
 * - Search, status, payment and date filters
 * - Live summary cards
 * - Pagination
 * - Select and export invoices to CSV
 * - View saved invoice details and line items
 * - Print saved invoice with QR verification when available
 * - No demo/sample invoice records
 */

(() => {
  // --------------------------------------------------
  // 1. DOM REFERENCES
  // --------------------------------------------------

  const table = document.getElementById("invoicesTable");
  const tbody = document.getElementById("invoicesTableBody");

  if (!table || !tbody) {
    console.error("Invoices: Required invoice table was not found.");
    return;
  }

  const $ = (selector, parent = document) =>
    parent.querySelector(selector);

  const searchInput = $("#invoiceSearch");
  const statusFilter = $("#invoiceStatusFilter");
  const paymentFilter = $("#invoicePaymentFilter");
  const datePreset = $("#invoiceDatePreset");

  const filtersForm = $("#invoiceFilters");
  const customDateRange = $("#customDateRange");
  const dateFromInput = $("#invoiceDateFrom");
  const dateToInput = $("#invoiceDateTo");

  const selectAllCheckbox = $("#selectAllInvoices");
  const bulkActionSelect = $("#invoiceBulkAction");
  const applyBulkActionButton = $("#applyInvoiceBulkAction");
  const exportButton = $("#exportInvoicesBtn");

  const totalInvoicesOutput = $("#totalInvoicesValue");
  const invoiceValueOutput = $("#invoiceValueTotal");
  const generatedInvoicesOutput = $("#generatedInvoicesValue");
  const cancelledInvoicesOutput = $("#cancelledInvoicesValue");

  const recordCountLabel = $("#invoiceRecordCount");
  const paginationInfo = $("#invoicePaginationInfo");
  const previousPageButton = $("#previousInvoicePage");
  const nextPageButton = $("#nextInvoicePage");
  const currentPageButton = $("#currentInvoicePage");

  const pageStatus = $("#invoicesPageStatus");

  // --------------------------------------------------
  // 2. CONFIGURATION
  // --------------------------------------------------

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const INVOICES_PATH = "restaurantBilling/invoices";
  const SETTINGS_PATH = "restaurantBilling/settings";

  const PAGE_SIZE = 10;

  const currency = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const CSV_HEADERS = [
    "Invoice Number",
    "Customer",
    "Date",
    "Time",
    "Item Count",
    "Payment Method",
    "Subtotal",
    "Discount",
    "Tax Rate",
    "Tax",
    "Grand Total",
    "Status",
    "Verification URL"
  ];

  // --------------------------------------------------
  // 3. RUNTIME STATE
  // --------------------------------------------------

  let services = null;
  let currentUser = null;

  let allInvoices = [];
  let filteredInvoices = [];

  let currentPage = 1;
  let invoiceUnsubscribe = null;
  let settingsUnsubscribe = null;

  let businessSettings = {};
  let detailsDialog = null;
  let selectedInvoice = null;

  let firebaseInitialised = false;
  let invoiceLoadFailed = false;

  // --------------------------------------------------
  // 4. GENERAL HELPERS
  // --------------------------------------------------

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

  function normalise(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function formatMoney(value) {
    const amount = Number(value);

    return currency.format(
      Number.isFinite(amount) ? amount : 0
    );
  }

  function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function formatDate(dateString) {
    const value = String(dateString ?? "").trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value || "—";
    }

    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return value;
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function formatTime(value) {
    const time = String(value ?? "").trim();

    const match = time.match(/^(\d{1,2}):(\d{2})$/);

    if (!match) {
      return time || "—";
    }

    const hours = Number(match[1]);
    const minutes = Number(match[2]);

    if (hours > 23 || minutes > 59) {
      return time;
    }

    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    }).format(new Date(2000, 0, 1, hours, minutes));
  }

  function formatDateTime(dateString, timeString) {
    const date = formatDate(dateString);
    const time = formatTime(timeString);

    return `${date} · ${time}`;
  }

  function toNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
  }

  function normalisePayment(value) {
    const payment = normalise(value);

    if (payment === "cash") return "cash";
    if (payment === "upi") return "upi";

    return payment || "unknown";
  }

  function normaliseStatus(record) {
    const status = normalise(
      record?.status || record?.recordStatus || record?.invoiceStatus
    );

    if (
      status === "cancelled" ||
      status === "canceled" ||
      status === "void" ||
      status === "voided"
    ) {
      return "cancelled";
    }

    /*
     * Records created by the current invoice generator use
     * recordStatus: "valid". That represents a generated record.
     */

    if (
      status === "valid" ||
      status === "generated" ||
      status === "completed"
    ) {
      return "generated";
    }

    if (status === "draft" || status === "pending") {
      return "draft";
    }

    return record?.invoiceNumber ? "generated" : "draft";
  }

  function getInvoiceItems(record) {
    const items = record?.items;

    if (Array.isArray(items)) {
      return items.filter(item =>
        item && typeof item === "object"
      );
    }

    if (items && typeof items === "object") {
      return Object.values(items).filter(item =>
        item && typeof item === "object"
      );
    }

    return [];
  }

  function getItemCount(record) {
    return getInvoiceItems(record).reduce((total, item) => {
      const quantity = toNumber(item.quantity, 0);

      return total + (
        Number.isFinite(quantity) && quantity > 0
          ? quantity
          : 0
      );
    }, 0);
  }

  function getInvoiceNumber(record) {
    return String(
      record.invoiceNumber ||
      record.invoiceNo ||
      record.number ||
      record.id ||
      "—"
    );
  }

  function getInvoiceTotal(record) {
    return toNumber(
      record.grandTotal ??
      record.totalAmount ??
      record.total ??
      record.amount,
      0
    );
  }

  function getInvoiceDate(record) {
    const directDate = String(
      record.invoiceDate || record.date || ""
    );

    if (/^\d{4}-\d{2}-\d{2}$/.test(directDate)) {
      return directDate;
    }

    if (record.createdAt) {
      const parsed = new Date(record.createdAt);

      if (!Number.isNaN(parsed.getTime())) {
        return getLocalDateString(parsed);
      }
    }

    if (record.createdAtMs) {
      const parsed = new Date(Number(record.createdAtMs));

      if (!Number.isNaN(parsed.getTime())) {
        return getLocalDateString(parsed);
      }
    }

    return "";
  }

  function getInvoiceTime(record) {
    if (record.invoiceTime || record.time) {
      return String(record.invoiceTime || record.time);
    }

    const timestamp = record.createdAt
      ? new Date(record.createdAt)
      : record.createdAtMs
        ? new Date(Number(record.createdAtMs))
        : null;

    if (timestamp && !Number.isNaN(timestamp.getTime())) {
      return `${String(timestamp.getHours()).padStart(2, "0")}:${String(
        timestamp.getMinutes()
      ).padStart(2, "0")}`;
    }

    return "";
  }

  function getCustomerName(record) {
    return String(
      record.customerName ||
      record.customer ||
      "Walk-in Customer"
    );
  }

  function getPaymentMethod(record) {
    return normalisePayment(record.paymentMethod || record.payment);
  }

  function setPageStatus(message, type = "info") {
    if (!pageStatus) {
      console.log(message);
      return;
    }

    pageStatus.textContent = message;
    pageStatus.dataset.type = type;
    pageStatus.hidden = !message;
  }

  function clearPageStatus() {
    if (!pageStatus) return;

    pageStatus.textContent = "";
    pageStatus.hidden = true;
    delete pageStatus.dataset.type;
  }

  function createMessageElement() {
    let message = $("#invoiceManagementMessage");

    if (message) return message;

    message = document.createElement("div");
    message.id = "invoiceManagementMessage";
    message.setAttribute("role", "status");
    message.setAttribute("aria-live", "polite");
    message.className = "card-body";
    message.hidden = true;

    const pageHead = $(".page-head");

    if (pageHead) {
      pageHead.insertAdjacentElement("afterend", message);
    } else {
      table.insertAdjacentElement("beforebegin", message);
    }

    return message;
  }

  function showMessage(message, type = "info") {
    const element = createMessageElement();

    element.textContent = message;
    element.dataset.type = type;
    element.hidden = !message;
  }

  function clearMessage() {
    const element = $("#invoiceManagementMessage");

    if (element) {
      element.textContent = "";
      element.hidden = true;
      delete element.dataset.type;
    }
  }

  // --------------------------------------------------
  // 5. FIREBASE SERVICE INITIALISATION
  // --------------------------------------------------

  async function getFirebaseServices() {
    const firebase = window.restaurantFirebase;

    if (!firebase || !firebase.ready) {
      throw new Error(
        "Firebase is not initialised. Check js/firebase-config.js and its script order."
      );
    }

    await firebase.ready;

    if (firebase.error) {
      throw new Error(
        firebase.error.message || "Firebase initialisation failed."
      );
    }

    const sdk = firebase.sdk;

    if (
      !sdk ||
      !sdk.auth ||
      !sdk.database ||
      !firebase.app
    ) {
      throw new Error(
        "Shared Firebase Authentication or Database services are unavailable."
      );
    }

    return {
      app: firebase.app,
      auth: firebase.auth || sdk.auth.getAuth(firebase.app),
      db: firebase.db || sdk.database.getDatabase(firebase.app),
      authSDK: sdk.auth,
      dbSDK: sdk.database,
      config: firebase.config
    };
  }

  function waitForAuthenticatedOwner() {
    const { auth, authSDK } = services;

    if (auth.currentUser) {
      if (auth.currentUser.uid !== OWNER_UID) {
        return Promise.reject(
          new Error("This account is not authorised to view invoices.")
        );
      }

      return Promise.resolve(auth.currentUser);
    }

    return new Promise((resolve, reject) => {
      let unsubscribe = null;
      let settled = false;
      let timeout = null;

      const finish = (callback, value) => {
        if (settled) return;

        settled = true;

        if (timeout) {
          window.clearTimeout(timeout);
        }

        if (typeof unsubscribe === "function") {
          unsubscribe();
        }

        callback(value);
      };

      timeout = window.setTimeout(() => {
        finish(
          reject,
          new Error("Authentication timed out. Please sign in again.")
        );
      }, 12000);

      unsubscribe = authSDK.onAuthStateChanged(
        auth,
        user => {
          if (!user) {
            finish(
              reject,
              new Error("Please sign in to view invoice records.")
            );
            return;
          }

          if (user.uid !== OWNER_UID) {
            finish(
              reject,
              new Error("This account is not authorised to view invoices.")
            );
            return;
          }

          finish(resolve, user);
        },
        error => finish(reject, error)
      );
    });
  }

  // --------------------------------------------------
  // 6. NORMALISE DATABASE RECORDS
  // --------------------------------------------------

  function normaliseDatabaseInvoices(value) {
    if (!value) return [];

    const entries = Array.isArray(value)
      ? value.map((record, index) => [String(index), record])
      : Object.entries(value);

    return entries
      .filter(([, record]) =>
        record && typeof record === "object"
      )
      .map(([key, record]) => {
        const items = getInvoiceItems(record);

        const invoiceDate = getInvoiceDate(record);
        const invoiceTime = getInvoiceTime(record);

        return {
          ...record,

          // Firebase push key is the internal identity.
          key,

          invoiceNumber: getInvoiceNumber(record),
          customerName: getCustomerName(record),
          invoiceDate,
          invoiceTime,

          paymentMethod: getPaymentMethod(record),
          recordStatus: normaliseStatus(record),

          items,
          itemCount: getItemCount(record),
          grandTotal: getInvoiceTotal(record),

          subtotal: toNumber(record.subtotal, 0),
          discount: toNumber(record.discount, 0),
          taxRate: toNumber(record.taxRate, 0),
          tax: toNumber(record.tax, 0),

          verificationUrl: String(
            record.verificationUrl || ""
          ),

          verificationId: String(
            record.verificationId || ""
          )
        };
      })
      .sort((a, b) => {
        const dateA = `${a.invoiceDate} ${a.invoiceTime}`;
        const dateB = `${b.invoiceDate} ${b.invoiceTime}`;

        if (dateA !== dateB) {
          return dateB.localeCompare(dateA);
        }

        return b.key.localeCompare(a.key);
      });
  }

  // --------------------------------------------------
  // 7. LOAD SAVED BUSINESS SETTINGS (OPTIONAL)
  // --------------------------------------------------

  function getBusinessProfile(settings) {
    const data = settings && typeof settings === "object"
      ? settings
      : {};

    const forms = data.forms || {};

    const businessForm =
      forms.businessProfileForm ||
      data.businessProfile ||
      data.business ||
      {};

    const brandForm =
      forms.brandSettingsForm ||
      data.brandSettings ||
      data.brand ||
      {};

    const displayName =
      brandForm.displayName ||
      data.displayName ||
      "";

    return {
      name:
        displayName ||
        businessForm.businessName ||
        businessForm.name ||
        data.businessName ||
        data.name ||
        "",

      tagline:
        brandForm.tagline ||
        businessForm.tagline ||
        data.tagline ||
        "",

      address:
        businessForm.address ||
        businessForm.businessAddress ||
        data.address ||
        "",

      phone:
        businessForm.phone ||
        businessForm.contactNumber ||
        data.phone ||
        ""
    };
  }

  function updateBusinessIdentity() {
    const profile = getBusinessProfile(businessSettings);

    const businessName =
      profile.name || "Business name not configured";

    const tagline = profile.tagline || "Restaurant Billing";

    const nameElement = $("#sidebarBusinessName");
    const taglineElement = $("#sidebarBusinessTagline");
    const footerNameElement = $("#businessFooterName");

    if (nameElement) nameElement.textContent = businessName;
    if (taglineElement) taglineElement.textContent = tagline;
    if (footerNameElement) footerNameElement.textContent = businessName;

    const email =
      currentUser?.email ||
      "Authenticated owner";

    const ownerNameElement = $("#ownerDisplayName");
    const ownerRoleElement = $("#ownerDisplayRole");
    const ownerAvatarElement = $("#ownerAvatar");

    if (ownerNameElement) {
      ownerNameElement.textContent = email;
      ownerNameElement.title = email;
    }

    if (ownerRoleElement) {
      ownerRoleElement.textContent = "Owner";
    }

    if (ownerAvatarElement) {
      ownerAvatarElement.textContent =
        (email.trim().charAt(0) || "O").toUpperCase();
    }

    document.title = `${businessName} | Invoices`;
  }

  function subscribeToBusinessSettings() {
    const { db, dbSDK } = services;

    if (typeof settingsUnsubscribe === "function") {
      settingsUnsubscribe();
    }

    const settingsRef = dbSDK.ref(db, SETTINGS_PATH);

    settingsUnsubscribe = dbSDK.onValue(
      settingsRef,
      snapshot => {
        businessSettings = snapshot.exists()
          ? snapshot.val() || {}
          : {};

        updateBusinessIdentity();
      },
      error => {
        console.warn("Business settings could not be loaded:", error);

        businessSettings = {};
        updateBusinessIdentity();
      }
    );
  }

  // --------------------------------------------------
  // 8. LIVE INVOICE SUBSCRIPTION
  // --------------------------------------------------

  function subscribeToInvoices() {
    const { db, dbSDK } = services;

    if (typeof invoiceUnsubscribe === "function") {
      invoiceUnsubscribe();
    }

    const invoicesRef = dbSDK.ref(db, INVOICES_PATH);

    invoiceLoadFailed = false;
    setLoadingState("Loading invoice records from Firebase...");

    invoiceUnsubscribe = dbSDK.onValue(
      invoicesRef,
      snapshot => {
        invoiceLoadFailed = false;

        allInvoices = normaliseDatabaseInvoices(
          snapshot.exists() ? snapshot.val() : null
        );

        /*
         * Every database update refreshes the list and current filters.
         * This keeps records in sync after an invoice is generated.
         */

        applyFilters(false);
        setPageStatus("", "success");
      },
      error => {
        invoiceLoadFailed = true;
        allInvoices = [];
        filteredInvoices = [];

        console.error("Invoices: Firebase read failed.", error);

        renderTable();
        updateSummary([]);
        updatePagination();

        setPageStatus(
          "Invoice records could not be loaded. Check Firebase Realtime Database rules, authentication and the restaurantBilling/invoices path.",
          "error"
        );
      }
    );
  }

  // --------------------------------------------------
  // 9. EMPTY / LOADING TABLE STATES
  // --------------------------------------------------

  function setLoadingState(message) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:36px 16px;">
          ${escapeHTML(message)}
        </td>
      </tr>
    `;

    if (recordCountLabel) {
      recordCountLabel.textContent = "Loading...";
    }

    if (paginationInfo) {
      paginationInfo.textContent = message;
    }
  }

  function renderEmptyState(message, description = "") {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align:center;padding:36px 16px;">
          <strong>${escapeHTML(message)}</strong>
          ${
            description
              ? `<div style="margin-top:6px;">${escapeHTML(description)}</div>`
              : ""
          }
        </td>
      </tr>
    `;
  }

  // --------------------------------------------------
  // 10. DATE FILTERS
  // --------------------------------------------------

  function updateCustomDateVisibility() {
    if (!customDateRange || !datePreset) return;

    const shouldShow = datePreset.value === "custom";

    customDateRange.hidden = !shouldShow;

    if (dateFromInput) dateFromInput.required = shouldShow;
    if (dateToInput) dateToInput.required = shouldShow;
  }

  function getDateRange() {
    const preset = datePreset?.value || "all";
    const today = new Date();
    const todayString = getLocalDateString(today);

    if (preset === "all") {
      return { from: "", to: "", valid: true };
    }

    if (preset === "today") {
      return {
        from: todayString,
        to: todayString,
        valid: true
      };
    }

    if (preset === "7days" || preset === "30days") {
      const days = preset === "7days" ? 6 : 29;

      const start = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate()
      );

      start.setDate(start.getDate() - days);

      return {
        from: getLocalDateString(start),
        to: todayString,
        valid: true
      };
    }

    if (preset === "custom") {
      const from = dateFromInput?.value || "";
      const to = dateToInput?.value || "";

      if (!from || !to) {
        return {
          from,
          to,
          valid: false,
          message: "Select both the start date and end date."
        };
      }

      if (from > to) {
        return {
          from,
          to,
          valid: false,
          message: "The start date cannot be later than the end date."
        };
      }

      return { from, to, valid: true };
    }

    return { from: "", to: "", valid: true };
  }

  // --------------------------------------------------
  // 11. SEARCH AND FILTERS
  // --------------------------------------------------

  function getFilteredInvoices() {
    const search = normalise(searchInput?.value);
    const selectedStatus = statusFilter?.value || "";
    const selectedPayment = paymentFilter?.value || "";

    const dateRange = getDateRange();

    if (!dateRange.valid) {
      return {
        records: [],
        valid: false,
        message: dateRange.message
      };
    }

    const records = allInvoices.filter(invoice => {
      const searchableText = [
        invoice.invoiceNumber,
        invoice.customerName,
        invoice.paymentMethod,
        invoice.recordStatus,
        invoice.invoiceDate,
        invoice.invoiceTime,
        invoice.orderType,
        ...invoice.items.map(item => item.name || "")
      ].map(normalise).join(" ");

      const matchesSearch =
        !search || searchableText.includes(search);

      const matchesStatus =
        !selectedStatus ||
        invoice.recordStatus === selectedStatus;

      const matchesPayment =
        !selectedPayment ||
        invoice.paymentMethod === selectedPayment;

      const matchesFrom =
        !dateRange.from ||
        invoice.invoiceDate >= dateRange.from;

      const matchesTo =
        !dateRange.to ||
        invoice.invoiceDate <= dateRange.to;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPayment &&
        matchesFrom &&
        matchesTo
      );
    });

    return {
      records,
      valid: true,
      message: ""
    };
  }

  function applyFilters(resetPage = true) {
    clearMessage();

    if (resetPage) {
      currentPage = 1;
    }

    const result = getFilteredInvoices();

    if (!result.valid) {
      filteredInvoices = [];
      showMessage(result.message, "error");
    } else {
      filteredInvoices = result.records;
    }

    renderTable();
    updateSummary(filteredInvoices);
    updatePagination();
  }

  // --------------------------------------------------
  // 12. SUMMARY CARDS
  // --------------------------------------------------

  function updateSummary(records) {
    const totalCount = records.length;

    const generated = records.filter(
      invoice => invoice.recordStatus === "generated"
    );

    const cancelled = records.filter(
      invoice => invoice.recordStatus === "cancelled"
    );

    const invoiceValue = generated.reduce(
      (sum, invoice) => sum + invoice.grandTotal,
      0
    );

    if (totalInvoicesOutput) {
      totalInvoicesOutput.textContent =
        totalCount.toLocaleString("en-IN");
    }

    if (invoiceValueOutput) {
      invoiceValueOutput.textContent = formatMoney(invoiceValue);
    }

    if (generatedInvoicesOutput) {
      generatedInvoicesOutput.textContent =
        generated.length.toLocaleString("en-IN");
    }

    if (cancelledInvoicesOutput) {
      cancelledInvoicesOutput.textContent =
        cancelled.length.toLocaleString("en-IN");
    }

    const totalDescription = $("#totalInvoicesDescription");
    const valueDescription = $("#invoiceValueDescription");
    const generatedDescription = $("#generatedInvoicesDescription");
    const cancelledDescription = $("#cancelledInvoicesDescription");

    if (totalDescription) {
      totalDescription.textContent = "Matching saved invoice records";
    }

    if (valueDescription) {
      valueDescription.textContent = "Generated invoices only";
    }

    if (generatedDescription) {
      generatedDescription.textContent = "Generated invoice records";
    }

    if (cancelledDescription) {
      cancelledDescription.textContent = "Cancelled invoice records";
    }

    if (recordCountLabel) {
      recordCountLabel.textContent =
        `${totalCount} Record${totalCount === 1 ? "" : "s"}`;
    }
  }

  // --------------------------------------------------
  // 13. TABLE ROWS
  // --------------------------------------------------

  function getStatusLabel(status) {
    switch (status) {
      case "generated":
        return "Generated";
      case "cancelled":
        return "Cancelled";
      case "draft":
        return "Draft";
      default:
        return "Unknown";
    }
  }

  function getStatusClass(status) {
    switch (status) {
      case "generated":
        return "pill paid";
      case "cancelled":
        return "pill cancelled";
      default:
        return "pill pending";
    }
  }

  function getPaymentLabel(payment) {
    if (payment === "cash") return "Cash";
    if (payment === "upi") return "UPI";

    return payment === "unknown"
      ? "Not recorded"
      : payment.toUpperCase();
  }

  function renderInvoiceRow(invoice) {
    const number = invoice.invoiceNumber;
    const customer = invoice.customerName;
    const date = formatDate(invoice.invoiceDate);
    const time = formatTime(invoice.invoiceTime);
    const items = invoice.itemCount;
    const payment = invoice.paymentMethod;
    const status = invoice.recordStatus;

    const statusLabel = getStatusLabel(status);
    const paymentLabel = getPaymentLabel(payment);

    return `
      <tr
        data-invoice-key="${escapeHTML(invoice.key)}"
        data-invoice-id="${escapeHTML(number)}"
      >
        <td>
          <input
            type="checkbox"
            class="invoice-select"
            data-invoice-key="${escapeHTML(invoice.key)}"
            aria-label="Select invoice ${escapeHTML(number)}"
          >
        </td>

        <td>
          <div class="cust-name">${escapeHTML(number)}</div>
          <div class="cust-sub">${escapeHTML(invoice.orderType || "Invoice")}</div>
        </td>

        <td>
          <div class="cust-name">${escapeHTML(customer)}</div>
          <div class="cust-sub">${escapeHTML(invoice.customerPhone || "")}</div>
        </td>

        <td>
          <div>${escapeHTML(date)}</div>
          <div class="cust-sub">${escapeHTML(time)}</div>
        </td>

        <td>${items} item${items === 1 ? "" : "s"}</td>

        <td>
          <span class="${payment === "upi" ? "pill paid" : "pill pending"}">
            ${escapeHTML(paymentLabel)}
          </span>
        </td>

        <td class="num">${formatMoney(invoice.grandTotal)}</td>

        <td>
          <span class="${getStatusClass(status)}">
            ${escapeHTML(statusLabel)}
          </span>
        </td>

        <td>
          <div class="page-actions">
            <button
              class="btn-icon"
              type="button"
              data-action="view"
              data-invoice-key="${escapeHTML(invoice.key)}"
              aria-label="View invoice ${escapeHTML(number)}"
              title="View invoice"
            >
              <svg viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>

            <button
              class="btn-icon"
              type="button"
              data-action="print"
              data-invoice-key="${escapeHTML(invoice.key)}"
              aria-label="Print invoice ${escapeHTML(number)}"
              title="Print invoice"
            >
              <svg viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2"
                stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 9V2h12v7"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <path d="M6 14h12v8H6z"/>
              </svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderTable() {
    if (invoiceLoadFailed) {
      renderEmptyState(
        "Invoice data is unavailable",
        "Check your connection and Firebase permissions."
      );
      updateSelectAllState();
      return;
    }

    if (allInvoices.length === 0) {
      renderEmptyState(
        "No saved invoices yet",
        "Generate an invoice to see it listed here."
      );

      updateSelectAllState();
      return;
    }

    if (filteredInvoices.length === 0) {
      renderEmptyState(
        "No matching invoices found",
        "Try different search terms or filter settings."
      );

      updateSelectAllState();
      return;
    }

    const startIndex = (currentPage - 1) * PAGE_SIZE;

    const visibleRecords = filteredInvoices.slice(
      startIndex,
      startIndex + PAGE_SIZE
    );

    tbody.innerHTML = visibleRecords
      .map(renderInvoiceRow)
      .join("");

    updateSelectAllState();
  }

  // --------------------------------------------------
  // 14. PAGINATION
  // --------------------------------------------------

  function updatePagination() {
    const total = filteredInvoices.length;
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

    if (currentPage > pageCount) {
      currentPage = pageCount;
    }

    if (currentPage < 1) {
      currentPage = 1;
    }

    if (currentPageButton) {
      currentPageButton.textContent = String(currentPage);
    }

    if (previousPageButton) {
      previousPageButton.disabled =
        currentPage <= 1 || total === 0;
    }

    if (nextPageButton) {
      nextPageButton.disabled =
        currentPage >= pageCount || total === 0;
    }

    if (paginationInfo) {
      if (total === 0) {
        paginationInfo.textContent = "No matching invoice records";
      } else {
        const start = (currentPage - 1) * PAGE_SIZE + 1;
        const end = Math.min(currentPage * PAGE_SIZE, total);

        paginationInfo.textContent =
          `Showing ${start}–${end} of ${total} invoice record${total === 1 ? "" : "s"}`;
      }
    }
  }

  if (previousPageButton) {
    previousPageButton.addEventListener("click", () => {
      if (currentPage <= 1) return;

      currentPage -= 1;

      renderTable();
      updatePagination();
    });
  }

  if (nextPageButton) {
    nextPageButton.addEventListener("click", () => {
      const pageCount = Math.max(
        1,
        Math.ceil(filteredInvoices.length / PAGE_SIZE)
      );

      if (currentPage >= pageCount) return;

      currentPage += 1;

      renderTable();
      updatePagination();
    });
  }

  // --------------------------------------------------
  // 15. FILTER EVENTS
  // --------------------------------------------------

  if (searchInput) {
    searchInput.addEventListener("input", () => applyFilters());
  }

  if (statusFilter) {
    statusFilter.addEventListener("change", () => applyFilters());
  }

  if (paymentFilter) {
    paymentFilter.addEventListener("change", () => applyFilters());
  }

  if (datePreset) {
    datePreset.addEventListener("change", () => {
      updateCustomDateVisibility();
      applyFilters();
    });
  }

  if (dateFromInput) {
    dateFromInput.addEventListener("change", () => applyFilters());
  }

  if (dateToInput) {
    dateToInput.addEventListener("change", () => applyFilters());
  }

  if (filtersForm) {
    filtersForm.addEventListener("reset", () => {
      window.setTimeout(() => {
        currentPage = 1;
        updateCustomDateVisibility();
        applyFilters();
      }, 0);
    });
  }

  // --------------------------------------------------
  // 16. SELECT VISIBLE INVOICES
  // --------------------------------------------------

  function getVisibleRows() {
    return Array.from(
      tbody.querySelectorAll("tr[data-invoice-key]")
    );
  }

  function updateSelectAllState() {
    if (!selectAllCheckbox) return;

    const checkboxes = getVisibleRows()
      .map(row => $(".invoice-select", row))
      .filter(Boolean);

    const checked = checkboxes.filter(
      checkbox => checkbox.checked
    ).length;

    selectAllCheckbox.checked =
      checkboxes.length > 0 &&
      checked === checkboxes.length;

    selectAllCheckbox.indeterminate =
      checked > 0 &&
      checked < checkboxes.length;
  }

  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener("change", () => {
      getVisibleRows().forEach(row => {
        const checkbox = $(".invoice-select", row);

        if (checkbox) {
          checkbox.checked = selectAllCheckbox.checked;
        }
      });

      updateSelectAllState();
    });
  }

  tbody.addEventListener("change", event => {
    if (event.target.matches(".invoice-select")) {
      updateSelectAllState();
    }
  });

  function getSelectedInvoices() {
    const selectedKeys = new Set(
      Array.from(tbody.querySelectorAll(".invoice-select:checked"))
        .map(checkbox => checkbox.dataset.invoiceKey)
        .filter(Boolean)
    );

    return filteredInvoices.filter(invoice =>
      selectedKeys.has(invoice.key)
    );
  }

  // --------------------------------------------------
  // 17. CSV EXPORT
  // --------------------------------------------------

  function csvCell(value) {
    let text = String(value ?? "");

    // Protect spreadsheet users from formula injection.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function createCSV(records) {
    const rows = records.map(invoice => [
      invoice.invoiceNumber,
      invoice.customerName,
      invoice.invoiceDate,
      invoice.invoiceTime,
      invoice.itemCount,
      getPaymentLabel(invoice.paymentMethod),
      invoice.subtotal.toFixed(2),
      invoice.discount.toFixed(2),
      invoice.taxRate.toFixed(2),
      invoice.tax.toFixed(2),
      invoice.grandTotal.toFixed(2),
      getStatusLabel(invoice.recordStatus),
      invoice.verificationUrl
    ]);

    return [
      CSV_HEADERS.map(csvCell).join(","),
      ...rows.map(row => row.map(csvCell).join(","))
    ].join("\r\n");
  }

  function downloadCSV(records, filename) {
    if (records.length === 0) {
      showMessage("There are no saved invoice records to export.", "error");
      return;
    }

    const blob = new Blob(
      ["\uFEFF", createCSV(records)],
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

    showMessage(
      `${records.length} saved invoice record(s) exported.`,
      "success"
    );
  }

  if (exportButton) {
    exportButton.addEventListener("click", () => {
      if (invoiceLoadFailed) {
        showMessage("Invoices could not be loaded, so export is unavailable.", "error");
        return;
      }

      downloadCSV(
        filteredInvoices,
        `invoices-${getLocalDateString()}.csv`
      );
    });
  }

  if (applyBulkActionButton) {
    applyBulkActionButton.addEventListener("click", () => {
      const action = bulkActionSelect?.value || "";

      if (action !== "export") {
        showMessage("Select Export Selected to continue.", "error");
        return;
      }

      downloadCSV(
        getSelectedInvoices(),
        `selected-invoices-${getLocalDateString()}.csv`
      );

      if (bulkActionSelect) {
        bulkActionSelect.value = "";
      }
    });
  }

  // --------------------------------------------------
  // 18. INVOICE DETAILS DIALOG
  // --------------------------------------------------

  function ensureDetailsDialog() {
    let dialog = $("#invoiceDetailsDialog");

    if (dialog) return dialog;

    dialog = document.createElement("dialog");
    dialog.id = "invoiceDetailsDialog";
    dialog.setAttribute("aria-labelledby", "invoiceDetailsTitle");

    dialog.className = "invoice-details-dialog";

    dialog.innerHTML = `
      <div class="card-head">
        <div>
          <h3 id="invoiceDetailsTitle">Invoice Details</h3>
          <p id="invoiceDetailsSubtitle">Saved invoice record</p>
        </div>

        <button
          type="button"
          class="btn-icon"
          id="closeInvoiceDetails"
          aria-label="Close invoice details"
        >×</button>
      </div>

      <div class="card-body" id="invoiceDetailsContent"></div>

      <div class="card-head">
        <button
          type="button"
          class="btn btn-soft"
          id="closeInvoiceDetailsBottom"
        >Close</button>

        <button
          type="button"
          class="btn btn-primary"
          id="printInvoiceDetails"
        >Print Invoice</button>
      </div>
    `;

    document.body.appendChild(dialog);

    dialog.addEventListener("click", event => {
      if (event.target === dialog) {
        dialog.close();
      }
    });

    $("#closeInvoiceDetails", dialog).addEventListener(
      "click",
      () => dialog.close()
    );

    $("#closeInvoiceDetailsBottom", dialog).addEventListener(
      "click",
      () => dialog.close()
    );

    $("#printInvoiceDetails", dialog).addEventListener(
      "click",
      () => {
        if (selectedInvoice) {
          printInvoice(selectedInvoice);
        }
      }
    );

    return dialog;
  }

  function renderDetails(invoice) {
    const content = $("#invoiceDetailsContent", detailsDialog);

    const items = invoice.items;

    const itemRows = items.length
      ? items.map((item, index) => {
          const name = String(item.name || item.productName || "Item");
          const quantity = toNumber(item.quantity, 0);
          const price = toNumber(item.price, 0);
          const amount = toNumber(
            item.amount,
            price * quantity
          );

          return `
            <tr>
              <td>${escapeHTML(name)}</td>
              <td>${quantity}</td>
              <td>${formatMoney(price)}</td>
              <td>${formatMoney(amount)}</td>
            </tr>
          `;
        }).join("")
      : `
        <tr>
          <td colspan="4">No saved item details were found.</td>
        </tr>
      `;

    const profile = getBusinessProfile(businessSettings);

    const verificationMarkup = invoice.verificationUrl
      ? `
        <p>
          <strong>Verification:</strong>
          <a href="${escapeHTML(invoice.verificationUrl)}"
             target="_blank" rel="noopener noreferrer">
            Open invoice verification
          </a>
        </p>
      `
      : `
        <p>
          <strong>Verification:</strong>
          No verification URL is saved for this invoice.
        </p>
      `;

    content.innerHTML = `
      <section class="card" style="margin-bottom:16px;">
        <div class="card-body">
          <h3>${escapeHTML(profile.name || "Business name not configured")}</h3>
          <p><strong>Invoice:</strong> ${escapeHTML(invoice.invoiceNumber)}</p>
          <p><strong>Customer:</strong> ${escapeHTML(invoice.customerName)}</p>
          <p><strong>Date:</strong> ${escapeHTML(formatDate(invoice.invoiceDate))}</p>
          <p><strong>Time:</strong> ${escapeHTML(formatTime(invoice.invoiceTime))}</p>
          <p><strong>Order type:</strong> ${escapeHTML(invoice.orderType || "—")}</p>
          <p><strong>Payment:</strong> ${escapeHTML(getPaymentLabel(invoice.paymentMethod))}</p>
          <p><strong>Status:</strong> ${escapeHTML(getStatusLabel(invoice.recordStatus))}</p>
          ${invoice.customerPhone ? `<p><strong>Phone:</strong> ${escapeHTML(invoice.customerPhone)}</p>` : ""}
          ${verificationMarkup}
        </div>
      </section>

      <section class="card" style="margin-bottom:16px;">
        <div class="card-head">
          <div>
            <h3>Purchased Items</h3>
          </div>
        </div>

        <div class="table-wrap">
          <table class="inv-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-body">
          <p><strong>Subtotal:</strong> ${formatMoney(invoice.subtotal)}</p>
          <p><strong>Discount:</strong> −${formatMoney(invoice.discount)}</p>
          <p><strong>Tax (${invoice.taxRate.toFixed(2)}%):</strong> ${formatMoney(invoice.tax)}</p>
          <h3>Grand Total: ${formatMoney(invoice.grandTotal)}</h3>
          ${invoice.notes ? `<p><strong>Notes:</strong> ${escapeHTML(invoice.notes)}</p>` : ""}
        </div>
      </section>
    `;
  }

  function openInvoiceDetails(invoice) {
    selectedInvoice = invoice;
    detailsDialog = ensureDetailsDialog();

    const subtitle = $("#invoiceDetailsSubtitle", detailsDialog);

    if (subtitle) {
      subtitle.textContent = invoice.invoiceNumber;
    }

    renderDetails(invoice);

    if (typeof detailsDialog.showModal === "function") {
      detailsDialog.showModal();
    } else {
      showMessage("Invoice details are not supported by this browser.", "error");
    }
  }

  // --------------------------------------------------
  // 19. PRINT A SAVED INVOICE
  // --------------------------------------------------

  function getPrintableInvoiceHTML(invoice) {
    const profile = getBusinessProfile(businessSettings);

    const itemRows = invoice.items.map(item => {
      const name = String(item.name || item.productName || "Item");
      const quantity = toNumber(item.quantity, 0);
      const price = toNumber(item.price, 0);
      const amount = toNumber(item.amount, price * quantity);

      return `
        <tr>
          <td>${escapeHTML(name)}</td>
          <td class="center">${quantity}</td>
          <td class="right">${formatMoney(price)}</td>
          <td class="right">${formatMoney(amount)}</td>
        </tr>
      `;
    }).join("");

    const verifyURL = invoice.verificationUrl || "";

    const qrMarkup = verifyURL
      ? `<div id="invoiceQr" aria-label="Invoice verification QR code"></div>`
      : "";

    const paymentLabel = getPaymentLabel(invoice.paymentMethod);

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Invoice ${escapeHTML(invoice.invoiceNumber)}</title>

        <style>
          * { box-sizing: border-box; }

          body {
            margin: 0;
            padding: 18px;
            color: #222;
            background: #f2f2f2;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
          }

          .toolbar {
            max-width: 190mm;
            margin: 0 auto 12px;
            display: flex;
            justify-content: flex-end;
            gap: 8px;
          }

          button {
            border: 1px solid #333;
            border-radius: 5px;
            padding: 9px 14px;
            background: #222;
            color: #fff;
            cursor: pointer;
          }

          .invoice {
            max-width: 190mm;
            min-height: 277mm;
            margin: 0 auto;
            padding: 12mm;
            background: #fff;
            border: 1px solid #ccc;
          }

          header, section, footer {
            border: 1px solid #bbb;
            border-radius: 5px;
            padding: 12px;
            margin-bottom: 12px;
            break-inside: avoid;
          }

          header { text-align: center; padding: 22px 12px; }

          h1 {
            margin: 0 0 8px;
            font-size: 26px;
            overflow-wrap: anywhere;
          }

          h2 {
            margin: 14px 0 0;
            font-size: 20px;
            letter-spacing: 1px;
          }

          h3 {
            margin: 0 0 10px;
            padding-bottom: 8px;
            border-bottom: 1px solid #ddd;
            font-size: 14px;
          }

          p { line-height: 1.6; overflow-wrap: anywhere; }

          .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px 18px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
          }

          th, td {
            padding: 9px 7px;
            border-bottom: 1px solid #ddd;
            text-align: left;
            overflow-wrap: anywhere;
          }

          th { background: #f2f2f2; }

          .center { text-align: center; }
          .right { text-align: right; }

          .summary-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            padding: 9px 3px;
            border-bottom: 1px solid #e5e5e5;
          }

          .summary-row span:last-child {
            text-align: right;
            font-variant-numeric: tabular-nums;
          }

          .grand-total {
            margin-top: 8px;
            padding: 12px 3px;
            font-size: 18px;
            font-weight: 800;
            border-top: 2px solid #222;
          }

          .qr-section {
            display: flex;
            justify-content: flex-end;
          }

          #invoiceQr { width: 90px; height: 90px; }

          #invoiceQr img, #invoiceQr canvas {
            display: block;
            width: 90px !important;
            height: 90px !important;
          }

          footer {
            text-align: center;
            line-height: 1.7;
          }

          @page { size: A4 portrait; margin: 10mm; }

          @media print {
            body { padding: 0; background: #fff; }
            .toolbar { display: none !important; }

            .invoice {
              max-width: none;
              min-height: auto;
              margin: 0;
              padding: 0;
              border: none;
            }

            header, section, footer {
              border-radius: 0;
              break-inside: avoid;
            }

            thead { display: table-header-group; }
            tr { break-inside: avoid; }
          }

          @media screen and (max-width: 560px) {
            body { padding: 8px; }
            .invoice { min-height: auto; padding: 10px; }
            .grid { grid-template-columns: 1fr; }
            th, td { padding: 7px 4px; font-size: 11px; }
          }
        </style>
      </head>

      <body>
        <div class="toolbar">
          <button type="button" id="closeInvoice">Close</button>
          <button type="button" id="printInvoice">Print / Save PDF</button>
        </div>

        <main class="invoice">
          <header>
            <h1>${escapeHTML(profile.name || "Business name not configured")}</h1>
            ${profile.tagline ? `<p>${escapeHTML(profile.tagline)}</p>` : ""}
            ${profile.address ? `<p>${escapeHTML(profile.address)}</p>` : ""}
            ${profile.phone ? `<p>${escapeHTML(profile.phone)}</p>` : ""}
            <h2>INVOICE</h2>
          </header>

          <section>
            <h3>Invoice Details</h3>
            <div class="grid">
              <div><strong>Invoice No:</strong> ${escapeHTML(invoice.invoiceNumber)}</div>
              <div><strong>Date:</strong> ${escapeHTML(formatDate(invoice.invoiceDate))}</div>
              <div><strong>Time:</strong> ${escapeHTML(formatTime(invoice.invoiceTime))}</div>
              <div><strong>Order Type:</strong> ${escapeHTML(invoice.orderType || "—")}</div>
              <div><strong>Customer:</strong> ${escapeHTML(invoice.customerName)}</div>
              <div><strong>Contact:</strong> ${escapeHTML(invoice.customerPhone || "Not provided")}</div>
            </div>
          </section>

          <section style="padding:0;overflow:hidden;">
            <table>
              <thead>
                <tr>
                  <th style="width:40%;">Item</th>
                  <th style="width:12%;" class="center">Qty</th>
                  <th style="width:23%;" class="right">Price</th>
                  <th style="width:25%;" class="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                ${itemRows || `<tr><td colspan="4">No saved item details.</td></tr>`}
              </tbody>
            </table>
          </section>

          <section>
            <div class="summary-row">
              <span>Subtotal</span><span>${formatMoney(invoice.subtotal)}</span>
            </div>
            <div class="summary-row">
              <span>Discount</span><span>−${formatMoney(invoice.discount)}</span>
            </div>
            <div class="summary-row">
              <span>Tax (${invoice.taxRate.toFixed(2)}%)</span><span>${formatMoney(invoice.tax)}</span>
            </div>
            <div class="summary-row grand-total">
              <span>Grand Total</span><span>${formatMoney(invoice.grandTotal)}</span>
            </div>
          </section>

          <section>
            <h3>Payment Details</h3>
            <div class="grid">
              <div><strong>Payment Method:</strong> ${escapeHTML(paymentLabel)}</div>
              <div><strong>Status:</strong> ${escapeHTML(getStatusLabel(invoice.recordStatus))}</div>
            </div>
          </section>

          ${verifyURL ? `<section class="qr-section">${qrMarkup}</section>` : ""}

          ${invoice.notes ? `<section><h3>Notes</h3><div>${escapeHTML(invoice.notes).replace(/\n/g, "<br>")}</div></section>` : ""}

          <footer>
            <strong>Thank you for your business.</strong>
          </footer>
        </main>

        ${
          verifyURL
            ? `
              <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
              <script>
                (() => {
                  const url = ${JSON.stringify(verifyURL)};
                  const container = document.getElementById("invoiceQr");

                  if (window.QRCode && container) {
                    new QRCode(container, {
                      text: url,
                      width: 90,
                      height: 90,
                      correctLevel: QRCode.CorrectLevel.M
                    });
                  }
                })();
              <\/script>
            `
            : ""
        }

        <script>
          document.getElementById("closeInvoice")
            .addEventListener("click", () => window.close());

          document.getElementById("printInvoice")
            .addEventListener("click", () => window.print());
        <\/script>
      </body>
      </html>
    `;
  }

  function printInvoice(invoice) {
    if (invoice.recordStatus === "draft") {
      showMessage(
        "This record is marked as a draft and may not be a final invoice.",
        "error"
      );
      return;
    }

    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      showMessage(
        "Printing was blocked. Allow pop-ups for this site and try again.",
        "error"
      );
      return;
    }

    try {
      printWindow.document.open();
      printWindow.document.write(getPrintableInvoiceHTML(invoice));
      printWindow.document.close();
    } catch (error) {
      console.error("Unable to render saved invoice:", error);

      try {
        printWindow.close();
      } catch {
        // Ignore popup cleanup errors.
      }

      showMessage("Unable to prepare the invoice print view.", "error");
    }
  }

  // --------------------------------------------------
  // 20. ROW ACTIONS
  // --------------------------------------------------

  tbody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const key = button.dataset.invoiceKey;

    const invoice = allInvoices.find(
      item => item.key === key
    );

    if (!invoice) {
      showMessage(
        "This invoice is no longer available in the live database.",
        "error"
      );
      return;
    }

    switch (button.dataset.action) {
      case "view":
        openInvoiceDetails(invoice);
        break;

      case "print":
        printInvoice(invoice);
        break;

      default:
        break;
    }
  });

  // --------------------------------------------------
  // 21. CLEANUP
  // --------------------------------------------------

  window.addEventListener("beforeunload", () => {
    if (typeof invoiceUnsubscribe === "function") {
      invoiceUnsubscribe();
    }

    if (typeof settingsUnsubscribe === "function") {
      settingsUnsubscribe();
    }
  });

  // --------------------------------------------------
  // 22. STARTUP
  // --------------------------------------------------

  async function initialise() {
    setLoadingState("Connecting to Firebase...");

    try {
      services = await getFirebaseServices();
      currentUser = await waitForAuthenticatedOwner();

      firebaseInitialised = true;

      updateBusinessIdentity();
      subscribeToBusinessSettings();
      subscribeToInvoices();

      updateCustomDateVisibility();

      console.info("Invoices: Firebase connection initialised.");
    } catch (error) {
      console.error("Invoices: Initialisation failed.", error);

      invoiceLoadFailed = true;
      allInvoices = [];
      filteredInvoices = [];

      renderEmptyState(
        "Invoices could not be loaded",
        error.message || "Check your authentication and Firebase configuration."
      );

      updateSummary([]);
      updatePagination();

      setPageStatus(
        error.message || "Firebase initialisation failed.",
        "error"
      );
    }
  }

  void initialise();
})();
