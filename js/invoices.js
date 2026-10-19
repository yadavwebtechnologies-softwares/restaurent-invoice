
/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Invoice History, Filtering, Details and Printing
   Database root: restaurantBilling/
   Safe manual refresh preserves filters and current page
   No demo invoices, fake products or embedded secrets
   ========================================================= */

(() => {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const INVOICES_PATH = "restaurantBilling/invoices";
  const SETTINGS_PATH = "restaurantBilling/settings/businessProfile";
  const PAGE_SIZE = 10;

  const state = {
    api: null,
    invoices: [],
    filteredInvoices: [],
    currentPage: 1,
    selectedInvoice: null,
    unsubscribeInvoices: null,
    unsubscribeBusiness: null,
    unregisterPageRefresh: null,
    initialized: false,
    loading: true,
    error: "",
    businessProfile: {},
    disposed: false
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

  function formatDate(value) {
    const date = parseDate(value);

    if (!date) return "—";

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function formatTime(value) {
    const date = parseDate(value);

    if (!date) return "—";

    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    }).format(date);
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
    const timestamp =
      invoice.createdAtMs ??
      invoice.createdAt ??
      invoice.timestamp ??
      invoice.date ??
      null;

    return parseDate(timestamp);
  }

  function getInvoiceNumber(invoice) {
    return String(
      invoice.invoiceNumber ??
      invoice.number ??
      invoice.invoiceId ??
      invoice.id ??
      "Invoice"
    );
  }

  function getInvoiceStatus(invoice) {
    const rawStatus = String(
      invoice.recordStatus ??
      invoice.status ??
      "valid"
    ).trim().toLowerCase();

    if (["cancelled", "canceled", "void", "voided"].includes(rawStatus)) {
      return "cancelled";
    }

    return "valid";
  }

  function getInvoiceTotal(invoice) {
    const total = Number(
      invoice.grandTotal ??
      invoice.total ??
      invoice.amount ??
      0
    );

    return Number.isFinite(total) ? total : 0;
  }

  function getInvoiceItems(invoice) {
    return Array.isArray(invoice.items) ? invoice.items : [];
  }

  function getItemName(item) {
    return String(
      item.name ??
      item.productName ??
      item.itemName ??
      "Item"
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

    if (Number.isFinite(storedAmount)) {
      return storedAmount;
    }

    return getItemQuantity(item) * getItemPrice(item);
  }

  function setStatus(message, isError = false) {
    const status = $("invoicesPageStatus");

    if (!status) return;

    status.textContent = message;
    status.dataset.state = isError ? "error" : "normal";
    status.setAttribute("role", isError ? "alert" : "status");
  }

  function setConnectionStatus(message, isError = false) {
    const status = $("sidebarConnectionStatus");

    if (!status) return;

    status.textContent = message;
    status.dataset.state = isError ? "error" : "normal";
  }

  function setButtonBusy(button, busy, busyLabel = "Please wait…") {
    if (!button) return;

    if (busy) {
      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.textContent.trim();
      }

      button.disabled = true;
      button.textContent = busyLabel;
    } else {
      button.disabled = false;

      if (button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
      }
    }
  }

  function updateBusinessBranding(profile) {
    const name = String(profile?.businessName ?? "").trim();
    const tagline = String(profile?.tagline ?? "").trim();

    document.querySelectorAll("[data-business-name]").forEach((element) => {
      element.textContent = name || "Restaurant Billing";
    });

    document.querySelectorAll("[data-business-tagline]").forEach((element) => {
      element.textContent = tagline || "Billing and Invoice Software";
    });

    const sidebarName = $("sidebarBusinessName");
    const footerName = $("businessFooterName");

    if (sidebarName) {
      sidebarName.textContent = name || "Restaurant Billing";
    }

    if (footerName) {
      footerName.textContent = name || "Restaurant Billing";
    }
  }

  function normalizeInvoices(snapshotValue) {
    if (!snapshotValue || typeof snapshotValue !== "object") {
      return [];
    }

    return Object.entries(snapshotValue)
      .map(([key, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return null;
        }

        return {
          ...value,
          id: String(value.id ?? key),
          _databaseKey: key
        };
      })
      .filter(Boolean)
      .filter((invoice) => invoice.ownerUid === OWNER_UID)
      .sort((a, b) => {
        const dateA = getInvoiceDate(a)?.getTime() ?? 0;
        const dateB = getInvoiceDate(b)?.getTime() ?? 0;
        return dateB - dateA;
      });
  }

  function renderSummary() {
    const totalCount = state.invoices.length;

    const validInvoices = state.invoices.filter(
      (invoice) => getInvoiceStatus(invoice) === "valid"
    );

    const cancelledInvoices = state.invoices.filter(
      (invoice) => getInvoiceStatus(invoice) === "cancelled"
    );

    const totalValue = validInvoices.reduce(
      (sum, invoice) => sum + getInvoiceTotal(invoice),
      0
    );

    if ($("totalInvoicesCount")) {
      $("totalInvoicesCount").textContent = String(totalCount);
    }

    if ($("totalInvoiceValue")) {
      $("totalInvoiceValue").textContent = formatCurrency(totalValue);
    }

    if ($("generatedInvoicesCount")) {
      $("generatedInvoicesCount").textContent = String(validInvoices.length);
    }

    if ($("cancelledInvoicesCount")) {
      $("cancelledInvoicesCount").textContent = String(
        cancelledInvoices.length
      );
    }
  }

  function applyFilters(preservePage = false) {
    const searchText = String($("invoiceSearchInput")?.value ?? "")
      .trim()
      .toLowerCase();

    const statusFilter = String(
      $("invoiceStatusFilter")?.value || "all"
    ).toLowerCase();

    const startValue = $("invoiceStartDate")?.value ?? "";
    const endValue = $("invoiceEndDate")?.value ?? "";

    const startDate = startValue
      ? new Date(`${startValue}T00:00:00`)
      : null;

    const endDate = endValue
      ? new Date(`${endValue}T23:59:59.999`)
      : null;

    if (startDate && endDate && startDate > endDate) {
      setStatus("The start date cannot be after the end date.", true);
      return false;
    }

    state.filteredInvoices = state.invoices.filter((invoice) => {
      const number = getInvoiceNumber(invoice).toLowerCase();
      const notes = String(invoice.notes ?? "").toLowerCase();
      const status = getInvoiceStatus(invoice);
      const invoiceDate = getInvoiceDate(invoice);

      if (
        searchText &&
        !number.includes(searchText) &&
        !notes.includes(searchText)
      ) {
        return false;
      }

      if (statusFilter !== "all" && status !== statusFilter) {
        return false;
      }

      if (startDate && (!invoiceDate || invoiceDate < startDate)) {
        return false;
      }

      if (endDate && (!invoiceDate || invoiceDate > endDate)) {
        return false;
      }

      return true;
    });

    if (!preservePage) {
      state.currentPage = 1;
    }

    renderTable();

    return true;
  }

  function renderTable() {
    const tableBody = $("invoicesTableBody");

    if (!tableBody) return;

    const totalFiltered = state.filteredInvoices.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

    state.currentPage = Math.min(
      Math.max(1, state.currentPage),
      totalPages
    );

    const startIndex = (state.currentPage - 1) * PAGE_SIZE;

    const pageInvoices = state.filteredInvoices.slice(
      startIndex,
      startIndex + PAGE_SIZE
    );

    if (state.loading) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5">Loading invoices…</td>
        </tr>
      `;
    } else if (state.error) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5">Invoice history could not be loaded.</td>
        </tr>
      `;
    } else if (!pageInvoices.length) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5">No invoices match your search.</td>
        </tr>
      `;
    } else {
      tableBody.innerHTML = pageInvoices.map((invoice) => {
        const date = getInvoiceDate(invoice);
        const number = getInvoiceNumber(invoice);
        const status = getInvoiceStatus(invoice);

        const statusLabel =
          status === "cancelled" ? "Cancelled" : "Generated";

        return `
          <tr>
            <td>
              <button
                class="text-button invoice-number-button"
                type="button"
                data-invoice-action="view"
                data-invoice-key="${escapeHTML(invoice._databaseKey)}"
                aria-label="View invoice ${escapeHTML(number)}"
              >${escapeHTML(number)}</button>
            </td>

            <td>
              <span>${escapeHTML(formatDate(date))}</span>
              <span class="table-secondary">${escapeHTML(formatTime(date))}</span>
            </td>

            <td>${escapeHTML(formatCurrency(getInvoiceTotal(invoice)))}</td>

            <td>
              <span class="status-badge ${status === "cancelled" ? "status-cancelled" : "status-success"}">
                ${statusLabel}
              </span>
            </td>

            <td>
              <button
                class="secondary-button"
                type="button"
                data-invoice-action="view"
                data-invoice-key="${escapeHTML(invoice._databaseKey)}"
              >View</button>
            </td>
          </tr>
        `;
      }).join("");
    }

    const firstNumber = totalFiltered ? startIndex + 1 : 0;
    const lastNumber = Math.min(startIndex + PAGE_SIZE, totalFiltered);

    if ($("invoicePaginationInfo")) {
      $("invoicePaginationInfo").textContent =
        `${firstNumber}–${lastNumber} of ${totalFiltered} invoices`;
    }

    if ($("currentInvoicePage")) {
      $("currentInvoicePage").textContent =
        `Page ${state.currentPage} of ${totalPages}`;
    }

    if ($("previousInvoicePage")) {
      $("previousInvoicePage").disabled =
        state.currentPage <= 1 || state.loading;
    }

    if ($("nextInvoicePage")) {
      $("nextInvoicePage").disabled =
        state.currentPage >= totalPages || state.loading;
    }

    if (state.loading) {
      setStatus("Loading invoice history…");
    } else if (state.error) {
      setStatus(state.error, true);
    } else {
      setStatus(
        `${totalFiltered} invoice${totalFiltered === 1 ? "" : "s"} found.`
      );
    }
  }

  function renderInvoiceDetails(invoice) {
    const body = $("invoiceDetailsBody");
    const heading = $("invoiceDetailsHeading");

    if (!body || !invoice) return;

    const invoiceNumber = getInvoiceNumber(invoice);
    const date = getInvoiceDate(invoice);
    const items = getInvoiceItems(invoice);
    const status = getInvoiceStatus(invoice);

    if (heading) {
      heading.textContent = `Invoice ${invoiceNumber}`;
    }

    const itemRows = items.map((item) => `
      <tr>
        <td>${escapeHTML(getItemName(item))}</td>
        <td>${escapeHTML(String(getItemQuantity(item)))}</td>
        <td>${escapeHTML(formatCurrency(getItemPrice(item)))}</td>
        <td>${escapeHTML(formatCurrency(getItemAmount(item)))}</td>
      </tr>
    `).join("");

    const discount = Number(invoice.discount ?? invoice.discountAmount ?? 0);
    const taxAmount = Number(invoice.taxAmount ?? invoice.tax ?? 0);
    const subtotal = Number(invoice.subtotal ?? invoice.subTotal ?? 0);
    const grandTotal = getInvoiceTotal(invoice);
    const notes = String(invoice.notes ?? "").trim();

    body.innerHTML = `
      <div class="invoice-detail-sheet">
        <div class="invoice-detail-header">
          <div>
            <h3>${escapeHTML(getBusinessName())}</h3>
            <p>${escapeHTML(getBusinessAddress())}</p>
            <p>${escapeHTML(getBusinessContact())}</p>
          </div>

          <div class="invoice-detail-meta">
            <p><strong>Invoice:</strong> ${escapeHTML(invoiceNumber)}</p>
            <p><strong>Date:</strong> ${escapeHTML(formatDate(date))}</p>
            <p><strong>Time:</strong> ${escapeHTML(formatTime(date))}</p>
            <p><strong>Status:</strong> ${status === "cancelled" ? "Cancelled" : "Generated"}</p>
          </div>
        </div>

        <div class="table-wrap">
          <table class="data-table invoice-detail-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Amount</th>
              </tr>
            </thead>

            <tbody>
              ${itemRows || `<tr><td colspan="4">No item details available.</td></tr>`}
            </tbody>
          </table>
        </div>

        <div class="invoice-detail-totals">
          <p>
            <span>Subtotal</span>
            <strong>${escapeHTML(formatCurrency(subtotal))}</strong>
          </p>

          ${discount > 0 ? `
            <p>
              <span>Discount</span>
              <strong>−${escapeHTML(formatCurrency(discount))}</strong>
            </p>
          ` : ""}

          ${taxAmount > 0 ? `
            <p>
              <span>Tax</span>
              <strong>${escapeHTML(formatCurrency(taxAmount))}</strong>
            </p>
          ` : ""}

          <p class="invoice-detail-grand-total">
            <span>Total</span>
            <strong>${escapeHTML(formatCurrency(grandTotal))}</strong>
          </p>
        </div>

        ${notes ? `
          <div class="invoice-detail-notes">
            <strong>Notes</strong>
            <p>${escapeHTML(notes)}</p>
          </div>
        ` : ""}
      </div>
    `;

    state.selectedInvoice = invoice;

    const dialog = $("invoiceDetailsDialog");

    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === "function") {
        dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
    }
  }

  function getBusinessName() {
    return String(
      document.querySelector("[data-business-name]")?.textContent ??
      $("sidebarBusinessName")?.textContent ??
      "Restaurant Billing"
    ).trim();
  }

  function getBusinessAddress() {
    const profile = state.businessProfile || {};
    return String(
      profile.businessAddress ?? profile.address ?? ""
    ).trim();
  }

  function getBusinessContact() {
    const profile = state.businessProfile ?? {};
    const phone = profile.businessPhone ?? profile.phone;
    const email = profile.businessEmail ?? profile.email;
    const values = [phone, email].filter(Boolean);

    return values.join(" · ");
  }

  function printSelectedInvoice() {
    const invoice = state.selectedInvoice;

    if (!invoice) {
      setStatus("Select an invoice before printing.", true);
      return;
    }

    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      setStatus(
        "The print window was blocked. Allow pop-ups for this site and try again.",
        true
      );
      return;
    }

    const date = getInvoiceDate(invoice);
    const items = getInvoiceItems(invoice);
    const number = getInvoiceNumber(invoice);
    const status = getInvoiceStatus(invoice);
    const discount = Number(invoice.discount ?? invoice.discountAmount ?? 0);
    const taxAmount = Number(invoice.taxAmount ?? invoice.tax ?? 0);
    const subtotal = Number(invoice.subtotal ?? invoice.subTotal ?? 0);
    const grandTotal = getInvoiceTotal(invoice);
    const notes = String(invoice.notes ?? "").trim();

    const itemRows = items.map((item) => `
      <tr>
        <td>${escapeHTML(getItemName(item))}</td>
        <td>${escapeHTML(String(getItemQuantity(item)))}</td>
        <td>${escapeHTML(formatCurrency(getItemPrice(item)))}</td>
        <td>${escapeHTML(formatCurrency(getItemAmount(item)))}</td>
      </tr>
    `).join("");

    const businessAddress = getBusinessAddress();
    const businessContact = getBusinessContact();

    const printDocument = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Invoice ${escapeHTML(number)}</title>
        <link rel="stylesheet" href="style.css">
      </head>

      <body>
        <main id="invoicePreviewSection" class="invoice-preview-section">
          <header class="invoice-print-header">
            <h1>${escapeHTML(getBusinessName())}</h1>
            ${businessAddress ? `<p>${escapeHTML(businessAddress)}</p>` : ""}
            ${businessContact ? `<p>${escapeHTML(businessContact)}</p>` : ""}
            <h2>INVOICE</h2>
          </header>

          <section class="invoice-print-meta">
            <p><strong>Invoice number:</strong> ${escapeHTML(number)}</p>
            <p><strong>Date:</strong> ${escapeHTML(formatDate(date))}</p>
            <p><strong>Time:</strong> ${escapeHTML(formatTime(date))}</p>
            <p><strong>Status:</strong> ${status === "cancelled" ? "Cancelled" : "Generated"}</p>
          </section>

          <table class="data-table invoice-detail-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Amount</th>
              </tr>
            </thead>

            <tbody>
              ${itemRows || `<tr><td colspan="4">No item details available.</td></tr>`}
            </tbody>
          </table>

          <section class="invoice-detail-totals">
            <p>
              <span>Subtotal</span>
              <strong>${escapeHTML(formatCurrency(subtotal))}</strong>
            </p>

            ${discount > 0 ? `
              <p>
                <span>Discount</span>
                <strong>−${escapeHTML(formatCurrency(discount))}</strong>
              </p>
            ` : ""}

            ${taxAmount > 0 ? `
              <p>
                <span>Tax</span>
                <strong>${escapeHTML(formatCurrency(taxAmount))}</strong>
              </p>
            ` : ""}

            <p class="invoice-detail-grand-total">
              <span>Total</span>
              <strong>${escapeHTML(formatCurrency(grandTotal))}</strong>
            </p>
          </section>

          ${notes ? `
            <section class="invoice-detail-notes">
              <strong>Notes</strong>
              <p>${escapeHTML(notes)}</p>
            </section>
          ` : ""}
        </main>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(printDocument);
    printWindow.document.close();

    printWindow.addEventListener("load", () => {
      printWindow.focus();
      printWindow.print();
    }, { once: true });
  }

  function handleTableClick(event) {
    const button = event.target.closest("[data-invoice-action='view']");

    if (!button) return;

    const key = button.dataset.invoiceKey;

    const invoice = state.invoices.find(
      (entry) => entry._databaseKey === key
    );

    if (invoice) {
      renderInvoiceDetails(invoice);
    }
  }

  function resetFilters() {
    if ($("invoiceSearchInput")) {
      $("invoiceSearchInput").value = "";
    }

    if ($("invoiceStatusFilter")) {
      $("invoiceStatusFilter").value = "all";
    }

    if ($("invoiceStartDate")) {
      $("invoiceStartDate").value = "";
    }

    if ($("invoiceEndDate")) {
      $("invoiceEndDate").value = "";
    }

    applyFilters();
  }

  /* ---------------------------------------------------------
     Manual refresh
     Reads fresh data without adding realtime listeners.
     Keeps active filters and current page where possible.
     --------------------------------------------------------- */

  async function refreshInvoiceHistory() {
    if (state.disposed || !state.api) {
      throw new Error("Invoice history is not ready to refresh.");
    }

    const shared = window.restaurantFirebase;

    if (
      !shared?.ready ||
      !shared.db ||
      typeof state.api.get !== "function"
    ) {
      throw new Error("Firebase database refresh is unavailable.");
    }

    const access = window.restaurantAccess;

    if (
      !access?.authorized ||
      access.user?.uid !== OWNER_UID
    ) {
      throw new Error("Owner access is required to refresh invoice history.");
    }

    setStatus("Refreshing invoice history…");

    /*
     * Fetch both paths before replacing the current in-memory data.
     * If either read fails, previously loaded data remains intact.
     */
    const snapshots = await Promise.all([
      state.api.get(state.api.ref(shared.db, INVOICES_PATH)),
      state.api.get(state.api.ref(shared.db, SETTINGS_PATH))
    ]);

    if (state.disposed) return;

    const refreshedInvoices = normalizeInvoices(
      snapshots[0].exists() ? snapshots[0].val() : null
    );

    const refreshedProfile = snapshots[1].exists()
      ? snapshots[1].val() || {}
      : {};

    state.invoices = refreshedInvoices;
    state.businessProfile = refreshedProfile;
    state.loading = false;
    state.error = "";

    updateBusinessBranding(state.businessProfile);
    renderSummary();

    /*
     * Retain search/date/status inputs and the current page,
     * clamping the page if the filtered result count has changed.
     */
    applyFilters(true);

    /*
     * Keep the open invoice details connected to the latest record
     * when that invoice still exists.
     */
    if (state.selectedInvoice) {
      const selectedKey = state.selectedInvoice._databaseKey;

      const updatedSelected = state.invoices.find(
        (invoice) => invoice._databaseKey === selectedKey
      );

      if (updatedSelected) {
        state.selectedInvoice = updatedSelected;

        if ($("invoiceDetailsDialog")?.open) {
          renderInvoiceDetails(updatedSelected);
        }
      }
    }

    setConnectionStatus("Database connected");
    setStatus(
      `Invoice history refreshed. ${state.filteredInvoices.length} matching records found.`
    );
  }

  /* ---------------------------------------------------------
     Initialize protected page
     --------------------------------------------------------- */

  async function initializePage() {
    if (state.initialized) return;

    state.initialized = true;

    const shared = window.restaurantFirebase;

    if (!shared?.readyPromise) {
      state.loading = false;
      state.error = "Firebase configuration is unavailable.";
      renderTable();
      setConnectionStatus("Configuration error", true);
      return;
    }

    setStatus("Connecting to invoice history…");

    try {
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
        throw new Error("Owner access is required to view invoice history.");
      }

      state.api = {
        ref: shared.sdk.database.ref,
        onValue: shared.sdk.database.onValue,
        get: shared.sdk.database.get
      };

      if (
        typeof state.api.ref !== "function" ||
        typeof state.api.onValue !== "function" ||
        typeof state.api.get !== "function"
      ) {
        throw new Error("Required Realtime Database methods are unavailable.");
      }

      if (
        window.restaurantUI &&
        typeof window.restaurantUI.registerPageRefresh === "function"
      ) {
        state.unregisterPageRefresh =
          window.restaurantUI.registerPageRefresh(refreshInvoiceHistory);
      }

      setConnectionStatus("Connecting to database");

      watchInvoices();
      watchBusinessProfile();

    } catch (error) {
      state.loading = false;
      state.error = error?.message || "Could not connect to invoice history.";

      setConnectionStatus("Connection error", true);
      renderTable();
    }
  }

  function watchInvoices() {
    const shared = window.restaurantFirebase;
    const reference = state.api.ref(shared.db, INVOICES_PATH);

    state.unsubscribeInvoices = state.api.onValue(
      reference,

      (snapshot) => {
        if (state.disposed) return;

        state.invoices = normalizeInvoices(snapshot.val());

        state.loading = false;
        state.error = "";

        renderSummary();
        applyFilters(true);
        setConnectionStatus("Database connected");
      },

      (error) => {
        if (state.disposed) return;

        state.loading = false;

        state.error =
          error?.code === "PERMISSION_DENIED" ||
          error?.code === "permission-denied"
            ? "Database permission denied. Check Firebase Realtime Database rules."
            : "Unable to load invoice history.";

        setConnectionStatus("Database error", true);
        renderTable();
      }
    );
  }

  function watchBusinessProfile() {
    const shared = window.restaurantFirebase;

    state.unsubscribeBusiness = state.api.onValue(
      state.api.ref(shared.db, SETTINGS_PATH),

      (snapshot) => {
        if (state.disposed) return;

        state.businessProfile = snapshot.val() || {};
        updateBusinessBranding(state.businessProfile);
      },

      () => {
        if (state.disposed) return;

        // Invoice history remains usable if optional settings fail.
        state.businessProfile = {};
        updateBusinessBranding({});
      }
    );
  }

  function bindEvents() {
    $("invoiceFiltersForm")?.addEventListener("submit", (event) => {
      event.preventDefault();

      const button = $("applyInvoiceFiltersBtn");

      setButtonBusy(button, true, "Applying…");

      try {
        applyFilters();
      } finally {
        setButtonBusy(button, false);
      }
    });

    $("resetInvoiceFiltersBtn")?.addEventListener(
      "click",
      resetFilters
    );

    $("invoicesTableBody")?.addEventListener(
      "click",
      handleTableClick
    );

    $("previousInvoicePage")?.addEventListener("click", () => {
      if (state.currentPage <= 1) return;

      state.currentPage -= 1;
      renderTable();
    });

    $("nextInvoicePage")?.addEventListener("click", () => {
      const totalPages = Math.max(
        1,
        Math.ceil(state.filteredInvoices.length / PAGE_SIZE)
      );

      if (state.currentPage >= totalPages) return;

      state.currentPage += 1;
      renderTable();
    });

    $("closeInvoiceDetailsBtn")?.addEventListener("click", () => {
      const dialog = $("invoiceDetailsDialog");

      if (dialog?.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog?.removeAttribute("open");
      }
    });

    $("invoiceDetailsDialog")?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) {
        event.currentTarget.close?.();
      }
    });

    $("printSelectedInvoiceBtn")?.addEventListener(
      "click",
      printSelectedInvoice
    );

    window.addEventListener("pagehide", () => {
      state.disposed = true;

      state.unsubscribeInvoices?.();
      state.unsubscribeBusiness?.();

      if (typeof state.unregisterPageRefresh === "function") {
        state.unregisterPageRefresh();
        state.unregisterPageRefresh = null;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    renderSummary();
    renderTable();
    initializePage();
  });
})();
