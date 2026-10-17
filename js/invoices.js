"use strict";

/*
 * Restaurant Billing Software
 * File: js/invoices.js
 *
 * Phase 1: Frontend demo functionality.
 *
 * Features:
 * - Search invoices and customers
 * - Filter by status and payment method
 * - Today, 7-day, 30-day and custom date filters
 * - Dynamic invoice summary cards
 * - Select visible invoices
 * - Export filtered or selected invoices to CSV
 * - View invoice record details
 * - Print a demo invoice record summary
 *
 * Important:
 * - Invoice records are read from the demo HTML table.
 * - Data is not permanently stored.
 * - Full invoice printing requires complete invoice records.
 * - Firebase Realtime Database integration comes later.
 */

(() => {
  // --------------------------------------------------
  // DOM REFERENCES
  // --------------------------------------------------

  const table = document.getElementById("invoicesTable");
  const tbody = document.getElementById("invoicesTableBody");

  if (!table || !tbody) {
    console.error("Invoices: Invoice table was not found.");
    return;
  }

  const searchInput = document.getElementById("invoiceSearch");
  const statusFilter = document.getElementById("invoiceStatusFilter");
  const paymentFilter = document.getElementById("invoicePaymentFilter");
  const datePreset = document.getElementById("invoiceDatePreset");

  const filtersForm = document.getElementById("invoiceFilters");
  const resetFiltersButton = document.getElementById("resetInvoiceFilters");

  const customDateRange = document.getElementById("customDateRange");
  const dateFromInput = document.getElementById("invoiceDateFrom");
  const dateToInput = document.getElementById("invoiceDateTo");

  const selectAllCheckbox = document.getElementById("selectAllInvoices");
  const bulkActionSelect = document.getElementById("invoiceBulkAction");
  const applyBulkActionButton = document.getElementById("applyInvoiceBulkAction");

  const exportButton = document.getElementById("exportInvoicesBtn");

  const totalInvoicesOutput = document.getElementById("totalInvoicesValue");
  const invoiceValueOutput = document.getElementById("invoiceValueTotal");
  const generatedInvoicesOutput = document.getElementById("generatedInvoicesValue");
  const cancelledInvoicesOutput = document.getElementById("cancelledInvoicesValue");

  const recordCountLabel = document.getElementById("invoiceRecordCount");
  const paginationInfo = document.getElementById("invoicePaginationInfo");

  const previousPageButton = document.getElementById("previousInvoicePage");
  const nextPageButton = document.getElementById("nextInvoicePage");
  const currentPageButton = document.getElementById("currentInvoicePage");

  // --------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------

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
    "Total Amount",
    "Status"
  ];

  // --------------------------------------------------
  // HELPERS
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

  function formatMoney(amount) {
    return currency.format(Number(amount) || 0);
  }

  function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function formatDate(dateString) {
    if (!dateString) return "—";

    const parts = dateString.split("-");

    if (parts.length !== 3) {
      return dateString;
    }

    const date = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2])
    );

    if (Number.isNaN(date.getTime())) {
      return dateString;
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function showMessage(message, type = "info") {
    let messageElement = document.getElementById("invoiceManagementMessage");

    if (!messageElement) {
      messageElement = document.createElement("div");
      messageElement.id = "invoiceManagementMessage";
      messageElement.setAttribute("role", "status");
      messageElement.setAttribute("aria-live", "polite");

      messageElement.style.cssText = `
        margin: 12px 0;
        padding: 12px 14px;
        border: 1px solid #d1d5db;
        border-radius: 5px;
        background: #ffffff;
        color: #111827;
        font-size: 13px;
      `;

      const pageHead = document.querySelector(".page-head");

      if (pageHead) {
        pageHead.insertAdjacentElement("afterend", messageElement);
      } else {
        table.insertAdjacentElement("beforebegin", messageElement);
      }
    }

    messageElement.textContent = message;
    messageElement.dataset.type = type;
    messageElement.hidden = false;
  }

  function clearMessage() {
    const element = document.getElementById("invoiceManagementMessage");

    if (element) {
      element.textContent = "";
      element.hidden = true;
    }
  }

  // --------------------------------------------------
  // READ DEMO INVOICES FROM HTML
  // --------------------------------------------------

  function readInvoiceRecords() {
    return Array.from(tbody.querySelectorAll("tr[data-invoice-id]"))
      .map(row => {
        const id = row.dataset.invoiceId || "";

        const cells = row.querySelectorAll("td");

        if (cells.length < 9 || !id) {
          console.warn("Skipping an invalid invoice row.", row);
          return null;
        }

        const payment = normalise(row.dataset.payment);
        const status = normalise(row.dataset.status);

        const total = Number(row.dataset.total);
        const itemCount = Number(row.dataset.itemCount);

        const date = row.dataset.invoiceDate || "";

        const customer =
          row.dataset.customer ||
          cells[2].querySelector(".cust-name")?.textContent.trim() ||
          "";

        const time = cells[3].querySelector(".cust-sub")
          ?.textContent.trim() || "";

        if (
          !Number.isFinite(total) ||
          total < 0 ||
          !Number.isInteger(itemCount) ||
          itemCount < 0 ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          !["cash", "upi"].includes(payment) ||
          !["generated", "cancelled"].includes(status)
        ) {
          console.warn(`Skipping invalid invoice data: ${id}`);
          return null;
        }

        return {
          id,
          customer,
          date,
          time,
          itemCount,
          payment,
          total,
          status,
          row
        };
      })
      .filter(Boolean);
  }

  const invoices = readInvoiceRecords();

  // --------------------------------------------------
  // CUSTOM DATE FILTER VISIBILITY
  // --------------------------------------------------

  function updateCustomDateVisibility() {
    const shouldShow = datePreset.value === "custom";

    customDateRange.hidden = !shouldShow;

    dateFromInput.required = shouldShow;
    dateToInput.required = shouldShow;
  }

  datePreset.addEventListener("change", () => {
    updateCustomDateVisibility();
    clearMessage();
    applyFilters();
  });

  // --------------------------------------------------
  // DATE FILTER HELPERS
  // --------------------------------------------------

  function getDateRange() {
    const preset = datePreset.value;
    const today = new Date();

    const todayString = getLocalDateString(today);

    if (preset === "all") {
      return {
        from: "",
        to: "",
        valid: true
      };
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
      const from = dateFromInput.value;
      const to = dateToInput.value;

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

      return {
        from,
        to,
        valid: true
      };
    }

    return {
      from: "",
      to: "",
      valid: true
    };
  }

  // --------------------------------------------------
  // FILTER MATCHING
  // --------------------------------------------------

  function getFilteredInvoices() {
    const search = normalise(searchInput.value);
    const selectedStatus = statusFilter.value;
    const selectedPayment = paymentFilter.value;

    const dateRange = getDateRange();

    if (!dateRange.valid) {
      return {
        records: [],
        valid: false,
        message: dateRange.message
      };
    }

    const records = invoices.filter(invoice => {
      const searchableText = [
        invoice.id,
        invoice.customer,
        invoice.payment,
        invoice.status,
        invoice.date,
        invoice.time
      ].map(normalise).join(" ");

      const matchesSearch =
        !search || searchableText.includes(search);

      const matchesStatus =
        !selectedStatus || invoice.status === selectedStatus;

      const matchesPayment =
        !selectedPayment || invoice.payment === selectedPayment;

      const matchesFromDate =
        !dateRange.from || invoice.date >= dateRange.from;

      const matchesToDate =
        !dateRange.to || invoice.date <= dateRange.to;

      return (
        matchesSearch &&
        matchesStatus &&
        matchesPayment &&
        matchesFromDate &&
        matchesToDate
      );
    });

    return {
      records,
      valid: true,
      message: ""
    };
  }

  // --------------------------------------------------
  // SUMMARY CARDS
  // --------------------------------------------------

  function updateSummary(records) {
    const totalCount = records.length;

    const generated = records.filter(
      invoice => invoice.status === "generated"
    );

    const cancelled = records.filter(
      invoice => invoice.status === "cancelled"
    );

    /*
     * Cancelled invoices are excluded from invoice value.
     * This value is a summary of generated invoices, not a
     * permanent financial ledger.
     */

    const invoiceValue = generated.reduce(
      (sum, invoice) => sum + invoice.total,
      0
    );

    totalInvoicesOutput.textContent =
      totalCount.toLocaleString("en-IN");

    invoiceValueOutput.textContent =
      formatMoney(invoiceValue);

    generatedInvoicesOutput.textContent =
      generated.length.toLocaleString("en-IN");

    cancelledInvoicesOutput.textContent =
      cancelled.length.toLocaleString("en-IN");

    recordCountLabel.textContent =
      `${totalCount} Record${totalCount === 1 ? "" : "s"}`;

    paginationInfo.textContent =
      totalCount === 0
        ? "No matching invoice records"
        : `Showing ${totalCount} demo record${totalCount === 1 ? "" : "s"}`;

    // Pagination controls are display-only in this phase.
    previousPageButton.disabled = true;
    nextPageButton.disabled = true;
    currentPageButton.textContent = "1";
  }

  // --------------------------------------------------
  // UPDATE TABLE VISIBILITY
  // --------------------------------------------------

  function updateSelectAllState() {
    const visibleCheckboxes = Array.from(
      tbody.querySelectorAll("tr[data-invoice-id]")
    )
      .filter(row => !row.hidden)
      .map(row => row.querySelector(".invoice-select"))
      .filter(Boolean);

    const checkedCount = visibleCheckboxes.filter(
      checkbox => checkbox.checked
    ).length;

    selectAllCheckbox.checked =
      visibleCheckboxes.length > 0 &&
      checkedCount === visibleCheckboxes.length;

    selectAllCheckbox.indeterminate =
      checkedCount > 0 &&
      checkedCount < visibleCheckboxes.length;
  }

  function applyFilters() {
    const result = getFilteredInvoices();

    if (!result.valid) {
      showMessage(result.message, "error");
      updateSummary([]);
      invoices.forEach(invoice => {
        invoice.row.hidden = true;
      });
      updateSelectAllState();
      return;
    }

    clearMessage();

    const visibleIds = new Set(
      result.records.map(invoice => invoice.id)
    );

    invoices.forEach(invoice => {
      invoice.row.hidden = !visibleIds.has(invoice.id);
    });

    updateSummary(result.records);
    updateSelectAllState();

    let emptyRow = document.getElementById("noInvoiceResultsRow");

    if (result.records.length === 0) {
      if (!emptyRow) {
        emptyRow = document.createElement("tr");
        emptyRow.id = "noInvoiceResultsRow";

        emptyRow.innerHTML = `
          <td colspan="9" style="text-align:center;padding:32px 16px;">
            <strong>No invoices found</strong>
            <div style="margin-top:6px;">
              Try different search terms or filter settings.
            </div>
          </td>
        `;

        tbody.appendChild(emptyRow);
      }

      emptyRow.hidden = false;
    } else if (emptyRow) {
      emptyRow.hidden = true;
    }
  }

  // --------------------------------------------------
  // SEARCH AND FILTER EVENTS
  // --------------------------------------------------

  searchInput.addEventListener("input", applyFilters);

  statusFilter.addEventListener("change", applyFilters);

  paymentFilter.addEventListener("change", applyFilters);

  dateFromInput.addEventListener("change", applyFilters);

  dateToInput.addEventListener("change", applyFilters);

  filtersForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      updateCustomDateVisibility();
      clearMessage();
      applyFilters();
    }, 0);
  });

  resetFiltersButton.addEventListener("click", () => {
    // The form reset event handles filter updates.
  });

  // --------------------------------------------------
  // CSV GENERATION
  // --------------------------------------------------

  function csvCell(value) {
    let text = String(value ?? "");

    /*
     * Prevent spreadsheet formula injection when opening exports
     * in common spreadsheet applications.
     */

    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function createCSV(records) {
    const rows = records.map(invoice => [
      invoice.id,
      invoice.customer,
      invoice.date,
      invoice.time,
      invoice.itemCount,
      invoice.payment.toUpperCase(),
      invoice.total.toFixed(2),
      invoice.status.toUpperCase()
    ]);

    return [
      CSV_HEADERS.map(csvCell).join(","),
      ...rows.map(row => row.map(csvCell).join(","))
    ].join("\r\n");
  }

  function downloadCSV(records, filename) {
    if (records.length === 0) {
      showMessage("There are no invoice records to export.", "error");
      return;
    }

    const csv = createCSV(records);

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

    showMessage(
      `${records.length} invoice record(s) exported successfully.`,
      "success"
    );
  }

  // Export all currently filtered invoices.
  exportButton.addEventListener("click", () => {
    const result = getFilteredInvoices();

    if (!result.valid) {
      showMessage(result.message, "error");
      return;
    }

    const date = getLocalDateString();

    downloadCSV(
      result.records,
      `invoices-${date}.csv`
    );
  });

  // --------------------------------------------------
  // SELECT VISIBLE INVOICES
  // --------------------------------------------------

  selectAllCheckbox.addEventListener("change", () => {
    const visibleRows = Array.from(
      tbody.querySelectorAll("tr[data-invoice-id]")
    ).filter(row => !row.hidden);

    visibleRows.forEach(row => {
      const checkbox = row.querySelector(".invoice-select");

      if (checkbox) {
        checkbox.checked = selectAllCheckbox.checked;
      }
    });

    updateSelectAllState();
  });

  tbody.addEventListener("change", event => {
    if (!event.target.matches(".invoice-select")) {
      return;
    }

    updateSelectAllState();
  });

  function getSelectedVisibleInvoices() {
    const selectedIds = new Set(
      Array.from(
        tbody.querySelectorAll(".invoice-select:checked")
      )
        .filter(checkbox => !checkbox.closest("tr")?.hidden)
        .map(checkbox => checkbox.closest("tr")?.dataset.invoiceId)
        .filter(Boolean)
    );

    return invoices.filter(invoice => selectedIds.has(invoice.id));
  }

  // --------------------------------------------------
  // BULK EXPORT
  // --------------------------------------------------

  applyBulkActionButton.addEventListener("click", () => {
    const action = bulkActionSelect.value;

    if (!action) {
      showMessage("Please select a bulk action.", "error");
      return;
    }

    if (action !== "export") {
      showMessage("This bulk action is not supported.", "error");
      return;
    }

    const selected = getSelectedVisibleInvoices();

    if (selected.length === 0) {
      showMessage(
        "Select at least one visible invoice to export.",
        "error"
      );
      return;
    }

    downloadCSV(
      selected,
      `selected-invoices-${getLocalDateString()}.csv`
    );

    bulkActionSelect.value = "";
  });

  // --------------------------------------------------
  // INVOICE DETAILS DIALOG
  // --------------------------------------------------

  function createDetailsDialog() {
    const dialog = document.createElement("dialog");

    dialog.id = "invoiceDetailsDialog";
    dialog.setAttribute("aria-labelledby", "invoiceDetailsTitle");

    dialog.style.cssText = `
      width: min(540px, calc(100% - 28px));
      max-width: 540px;
      max-height: 90vh;
      overflow-y: auto;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 24px;
      color: #111827;
      background: #ffffff;
    `;

    dialog.innerHTML = `
      <div class="card-head">
        <div>
          <h3 id="invoiceDetailsTitle">Invoice Details</h3>
          <p>Demo invoice record information.</p>
        </div>

        <button
          type="button"
          class="btn-icon"
          id="closeInvoiceDetails"
          aria-label="Close invoice details"
        >&#10005;</button>
      </div>

      <div id="invoiceDetailsContent" style="margin-top:18px;"></div>

      <div class="page-actions" style="justify-content:flex-end;margin-top:24px;">
        <button class="btn btn-soft" type="button" id="closeInvoiceDetailsBottom">
          Close
        </button>

        <button class="btn btn-primary" type="button" id="printInvoiceDetails">
          Print Record
        </button>
      </div>
    `;

    document.body.appendChild(dialog);

    return dialog;
  }

  const detailsDialog = createDetailsDialog();

  const detailsContent = document.getElementById("invoiceDetailsContent");

  let currentlySelectedInvoice = null;

  function renderInvoiceDetails(invoice) {
    const statusLabel =
      invoice.status === "cancelled" ? "Cancelled" : "Generated";

    const paymentLabel = invoice.payment.toUpperCase();

    detailsContent.innerHTML = `
      <div style="display:grid;gap:16px;">

        <div style="padding:14px;border:1px solid #e5e7eb;border-radius:6px;">
          <div style="font-size:12px;color:#6b7280;">Invoice Number</div>
          <div style="margin-top:5px;font-weight:700;overflow-wrap:anywhere;">
            ${escapeHTML(invoice.id)}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

          <div>
            <div style="font-size:12px;color:#6b7280;">Customer</div>
            <div style="margin-top:5px;font-weight:600;overflow-wrap:anywhere;">
              ${escapeHTML(invoice.customer || "Walk-in Customer")}
            </div>
          </div>

          <div>
            <div style="font-size:12px;color:#6b7280;">Invoice Date</div>
            <div style="margin-top:5px;font-weight:600;">
              ${escapeHTML(formatDate(invoice.date))}
            </div>
          </div>

          <div>
            <div style="font-size:12px;color:#6b7280;">Time</div>
            <div style="margin-top:5px;font-weight:600;">
              ${escapeHTML(invoice.time || "—")}
            </div>
          </div>

          <div>
            <div style="font-size:12px;color:#6b7280;">Items</div>
            <div style="margin-top:5px;font-weight:600;">
              ${invoice.itemCount}
            </div>
          </div>

          <div>
            <div style="font-size:12px;color:#6b7280;">Payment Method</div>
            <div style="margin-top:5px;font-weight:600;">
              ${escapeHTML(paymentLabel)}
            </div>
          </div>

          <div>
            <div style="font-size:12px;color:#6b7280;">Status</div>
            <div style="margin-top:5px;font-weight:600;">
              ${escapeHTML(statusLabel)}
            </div>
          </div>

        </div>

        <div style="padding:16px;border:1px solid #e5e7eb;border-radius:6px;">
          <div style="font-size:12px;color:#6b7280;">Invoice Total</div>
          <div style="font-size:24px;font-weight:800;margin-top:6px;">
            ${formatMoney(invoice.total)}
          </div>
        </div>

        <p style="font-size:12px;color:#6b7280;line-height:1.6;">
          This demo record does not contain individual product names,
          quantities, discounts, tax details or the complete printed invoice.
        </p>

      </div>
    `;
  }

  function openInvoiceDetails(invoice) {
    currentlySelectedInvoice = invoice;

    renderInvoiceDetails(invoice);

    if (typeof detailsDialog.showModal === "function") {
      detailsDialog.showModal();
    } else {
      showMessage(
        "Your browser does not support invoice detail dialogs.",
        "error"
      );
    }
  }

  function closeDetailsDialog() {
    if (detailsDialog.open) {
      detailsDialog.close();
    }
  }

  document.getElementById("closeInvoiceDetails")
    .addEventListener("click", closeDetailsDialog);

  document.getElementById("closeInvoiceDetailsBottom")
    .addEventListener("click", closeDetailsDialog);

  detailsDialog.addEventListener("click", event => {
    if (event.target === detailsDialog) {
      closeDetailsDialog();
    }
  });

  // --------------------------------------------------
  // PRINT A DEMO INVOICE RECORD SUMMARY
  // --------------------------------------------------

  function printInvoiceRecord(invoice) {
    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      showMessage(
        "Printing was blocked. Allow pop-ups for this site and try again.",
        "error"
      );
      return;
    }

    const statusLabel =
      invoice.status === "cancelled" ? "Cancelled" : "Generated";

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

        <title>Invoice Record ${escapeHTML(invoice.id)}</title>

        <style>
          * { box-sizing: border-box; }

          body {
            margin: 0;
            padding: 24px;
            color: #111111;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
          }

          main {
            max-width: 800px;
            margin: 0 auto;
          }

          header {
            padding-bottom: 18px;
            border-bottom: 2px solid #111111;
          }

          h1 {
            margin: 0;
            font-size: 24px;
          }

          h2 {
            margin: 24px 0 10px;
            font-size: 18px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }

          th, td {
            padding: 12px;
            border: 1px solid #dddddd;
            text-align: left;
            overflow-wrap: anywhere;
          }

          th {
            width: 36%;
            background: #f5f5f5;
          }

          .amount {
            margin-top: 20px;
            padding: 16px;
            border: 2px solid #111111;
            font-size: 20px;
            font-weight: 700;
            text-align: right;
          }

          .note {
            margin-top: 24px;
            font-size: 11px;
            color: #666666;
          }

          .toolbar {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 20px;
          }

          button {
            padding: 10px 18px;
            border: 1px solid #111111;
            border-radius: 4px;
            background: #111111;
            color: #ffffff;
            cursor: pointer;
          }

          @media print {
            body { padding: 0; }
            .toolbar { display: none !important; }
          }
        </style>
      </head>

      <body>
        <main>

          <div class="toolbar">
            <button type="button" onclick="window.print()">
              Print Record
            </button>
          </div>

          <header>
            <h1>[Business Name]</h1>
            <div style="margin-top:6px;">Invoice Record Summary</div>
          </header>

          <h2>${escapeHTML(invoice.id)}</h2>

          <table>
            <tbody>
              <tr>
                <th>Customer</th>
                <td>${escapeHTML(invoice.customer || "Walk-in Customer")}</td>
              </tr>

              <tr>
                <th>Date</th>
                <td>${escapeHTML(formatDate(invoice.date))}</td>
              </tr>

              <tr>
                <th>Time</th>
                <td>${escapeHTML(invoice.time || "—")}</td>
              </tr>

              <tr>
                <th>Item Count</th>
                <td>${invoice.itemCount}</td>
              </tr>

              <tr>
                <th>Payment Method</th>
                <td>${escapeHTML(invoice.payment.toUpperCase())}</td>
              </tr>

              <tr>
                <th>Invoice Status</th>
                <td>${escapeHTML(statusLabel)}</td>
              </tr>
            </tbody>
          </table>

          <div class="amount">
            Total: ${formatMoney(invoice.total)}
          </div>

          <p class="note">
            This is a summary of a demo invoice record, not the complete
            customer invoice. Full invoice printing requires saved invoice
            line items and business settings.
          </p>

        </main>
      </body>
      </html>
    `;

    try {
      printWindow.document.open();
      printWindow.document.write(html);
      printWindow.document.close();

      printWindow.addEventListener("load", () => {
        printWindow.focus();
      }, { once: true });
    } catch (error) {
      console.error("Unable to prepare invoice record:", error);
      printWindow.close();

      showMessage("Unable to open the print view.", "error");
    }
  }

  // --------------------------------------------------
  // INVOICE TABLE ACTIONS
  // --------------------------------------------------

  tbody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");

    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const invoiceId = button.dataset.invoiceId;

    const invoice = invoices.find(
      item => item.id === invoiceId
    );

    if (!invoice) {
      showMessage("Invoice record not found.", "error");
      return;
    }

    if (action === "view") {
      openInvoiceDetails(invoice);
      return;
    }

    if (action === "print") {
      printInvoiceRecord(invoice);
    }
  });

  document.getElementById("printInvoiceDetails")
    .addEventListener("click", () => {
      if (!currentlySelectedInvoice) {
        showMessage("No invoice record is selected.", "error");
        return;
      }

      printInvoiceRecord(currentlySelectedInvoice);
    });

  // --------------------------------------------------
  // INITIALISE PAGE
  // --------------------------------------------------

  updateCustomDateVisibility();
  applyFilters();

  console.info(
    `Invoice Management initialised with ${invoices.length} demo records.`
  );
})();
