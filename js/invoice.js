"use strict";

/*
 * Restaurant Billing Software
 * File: js/invoice.js
 *
 * Phase 1: Frontend demo.
 *
 * Features:
 * - Product selection
 * - Add, update and remove invoice items
 * - Quantity validation
 * - Automatic subtotal, discount, tax and grand total
 * - Cash / UPI payment selection
 * - Invoice validation
 * - A4 invoice preview and printing
 *
 * Important:
 * - Demo products come from new-invoice.html.
 * - Invoice data is not permanently saved.
 * - Firebase Realtime Database integration comes later.
 */

(() => {
  // --------------------------------------------------
  // DOM REFERENCES
  // --------------------------------------------------

  const form = document.getElementById("invoiceForm");

  if (!form) {
    console.error("Invoice: invoiceForm was not found.");
    return;
  }

  const invoiceNumberInput = document.getElementById("invoiceNumber");
  const invoiceDateInput = document.getElementById("invoiceDate");
  const invoiceTimeInput = document.getElementById("invoiceTime");

  const customerNameInput = document.getElementById("customerName");
  const customerPhoneInput = document.getElementById("customerPhone");
  const orderTypeInput = document.getElementById("orderType");

  const productSelect = document.getElementById("productSelect");
  const quantityInput = document.getElementById("itemQuantity");
  const addItemButton = document.getElementById("addItemBtn");

  const itemsTable = document.getElementById("invoiceItemsTable");
  const itemsBody = document.getElementById("invoiceItemsBody");
  const emptyItemsRow = document.getElementById("emptyItemsRow");

  const itemCountLabel = document.getElementById("itemCount");
  const clearItemsButton = document.getElementById("clearItemsBtn");

  const discountInput = document.getElementById("invoiceDiscount");
  const taxRateInput = document.getElementById("invoiceTaxRate");
  const notesInput = document.getElementById("invoiceNotes");

  const subtotalOutput = document.getElementById("subtotalAmount");
  const discountOutput = document.getElementById("discountAmount");
  const taxOutput = document.getElementById("taxAmount");
  const grandTotalOutput = document.getElementById("grandTotalAmount");

  const invoiceMessage = document.getElementById("invoiceMessage");
  const invoiceStatus = document.getElementById("invoiceStatus");

  const resetButton = document.getElementById("resetInvoiceBtn");
  const previewButton = document.getElementById("previewInvoiceBtn");
  const generateButton = document.getElementById("generateInvoiceBtn");

  // --------------------------------------------------
  // CONSTANTS
  // --------------------------------------------------

  const MAX_QUANTITY = 9999;
  const MAX_PRICE = 99999999;
  const MAX_DISCOUNT = 99999999;
  const MAX_TAX_RATE = 100;

  const currency = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  /*
   * Map of product IDs to invoice line items.
   *
   * Each entry keeps a snapshot of the product name and price.
   * Later, saved invoices must retain these snapshots even if
   * the original product is renamed or its price changes.
   */

  const cart = new Map();

  // --------------------------------------------------
  // GENERAL HELPERS
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

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function formatMoney(value) {
    return currency.format(roundMoney(value));
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function localTimeString(date = new Date()) {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");

    return `${hours}:${minutes}`;
  }

  function generateDemoInvoiceNumber() {
    const date = localDateString().replace(/-/g, "");

    const suffix = Math.random()
      .toString(36)
      .slice(2, 7)
      .toUpperCase();

    return `DEMO-${date}-${suffix}`;
  }

  function showMessage(message, type = "info") {
    invoiceMessage.textContent = message;
    invoiceMessage.dataset.type = type;
    invoiceMessage.hidden = !message;

    if (message) {
      invoiceMessage.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  }

  function clearMessage() {
    invoiceMessage.textContent = "";
    invoiceMessage.hidden = true;
    delete invoiceMessage.dataset.type;
  }

  // --------------------------------------------------
  // INITIAL INVOICE DETAILS
  // --------------------------------------------------

  function initialiseInvoiceDetails() {
    const now = new Date();

    invoiceNumberInput.value = generateDemoInvoiceNumber();
    invoiceDateInput.value = localDateString(now);
    invoiceTimeInput.value = localTimeString(now);

    invoiceStatus.textContent = "Draft";
    invoiceStatus.className = "pill pending";
  }

  // --------------------------------------------------
  // READ PRODUCT INFORMATION
  // --------------------------------------------------

  function readSelectedProduct() {
    const option = productSelect.selectedOptions[0];

    if (!option || !option.value) {
      return null;
    }

    if (option.disabled) {
      showMessage(
        "This product is unavailable. Select another product.",
        "error"
      );

      return null;
    }

    const label = option.textContent.trim();

    const priceMatch = label.match(
      /₹\s*([\d,]+(?:\.\d{1,2})?)/
    );

    if (!priceMatch) {
      showMessage(
        "The selected product has no valid demo price.",
        "error"
      );

      return null;
    }

    const price = Number(priceMatch[1].replace(/,/g, ""));

    const name = label
      .replace(/\s*[—–-]\s*₹[\d,.]+\s*$/, "")
      .trim();

    if (
      !name ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > MAX_PRICE
    ) {
      showMessage("The selected product details are invalid.", "error");
      return null;
    }

    return {
      id: option.value,
      name,
      price
    };
  }

  // --------------------------------------------------
  // CART HELPERS
  // --------------------------------------------------

  function getCartQuantity() {
    let total = 0;

    for (const item of cart.values()) {
      total += item.quantity;
    }

    return total;
  }

  function getSubtotal() {
    let subtotal = 0;

    for (const item of cart.values()) {
      subtotal += item.price * item.quantity;
    }

    return roundMoney(subtotal);
  }

  function getDiscount() {
    const entered = Number(discountInput.value);

    if (!Number.isFinite(entered) || entered < 0) {
      return 0;
    }

    return roundMoney(Math.min(entered, getSubtotal()));
  }

  function getTaxRate() {
    const entered = Number(taxRateInput.value);

    if (!Number.isFinite(entered) || entered < 0) {
      return 0;
    }

    return Math.min(entered, MAX_TAX_RATE);
  }

  function calculateTotals() {
    const subtotal = getSubtotal();
    const discount = getDiscount();

    const taxableAmount = Math.max(
      0,
      roundMoney(subtotal - discount)
    );

    const taxRate = getTaxRate();

    const tax = roundMoney(
      taxableAmount * taxRate / 100
    );

    const grandTotal = roundMoney(
      taxableAmount + tax
    );

    return {
      subtotal,
      discount,
      taxableAmount,
      taxRate,
      tax,
      grandTotal,
      itemCount: getCartQuantity()
    };
  }

  // --------------------------------------------------
  // RENDER CART
  // --------------------------------------------------

  function renderCart() {
    const items = Array.from(cart.values());

    if (items.length === 0) {
      itemsBody.innerHTML = `
        <tr id="emptyItemsRow">
          <td colspan="5" style="text-align:center;padding:36px 16px;">
            <strong>No items added yet</strong>

            <div style="margin-top:6px;">
              Select a product above to start the invoice.
            </div>
          </td>
        </tr>
      `;
    } else {
      itemsBody.innerHTML = items.map(item => {
        const amount = roundMoney(item.price * item.quantity);

        return `
          <tr data-product-id="${escapeHTML(item.id)}">

            <td>
              <div class="cust-name">
                ${escapeHTML(item.name)}
              </div>
            </td>

            <td class="num">
              ${formatMoney(item.price)}
            </td>

            <td>
              <input
                type="number"
                class="invoice-line-quantity"
                data-product-id="${escapeHTML(item.id)}"
                aria-label="Quantity for ${escapeHTML(item.name)}"
                min="1"
                max="${MAX_QUANTITY}"
                step="1"
                value="${item.quantity}"
                style="width:88px;max-width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:5px;"
                inputmode="numeric"
                required
              >
            </td>

            <td class="num">
              <strong>${formatMoney(amount)}</strong>
            </td>

            <td>
              <button
                type="button"
                class="btn-icon"
                data-action="remove-item"
                data-product-id="${escapeHTML(item.id)}"
                aria-label="Remove ${escapeHTML(item.name)}"
                title="Remove item"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18"/>
                  <path d="M8 6V4h8v2"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v5M14 11v5"/>
                </svg>
              </button>
            </td>

          </tr>
        `;
      }).join("");
    }

    const quantity = getCartQuantity();

    itemCountLabel.textContent =
      `${quantity} item${quantity === 1 ? "" : "s"} added`;

    updateTotals();
  }

  // --------------------------------------------------
  // UPDATE BILLING TOTALS
  // --------------------------------------------------

  function updateTotals() {
    const totals = calculateTotals();

    subtotalOutput.textContent = formatMoney(totals.subtotal);
    discountOutput.textContent = `−${formatMoney(totals.discount)}`;
    taxOutput.textContent = formatMoney(totals.tax);
    grandTotalOutput.textContent = formatMoney(totals.grandTotal);

    return totals;
  }

  // --------------------------------------------------
  // ADD PRODUCT
  // --------------------------------------------------

  function addSelectedProduct() {
    clearMessage();

    const product = readSelectedProduct();

    if (!product) {
      if (!productSelect.value) {
        showMessage("Please select a product first.", "error");
      }

      return;
    }

    const quantity = Number(quantityInput.value);

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      showMessage(
        `Quantity must be a whole number between 1 and ${MAX_QUANTITY}.`,
        "error"
      );

      quantityInput.focus();
      return;
    }

    const existing = cart.get(product.id);
    const updatedQuantity = (existing?.quantity || 0) + quantity;

    if (updatedQuantity > MAX_QUANTITY) {
      showMessage(
        `The maximum quantity per product is ${MAX_QUANTITY}.`,
        "error"
      );

      return;
    }

    if (existing) {
      existing.quantity = updatedQuantity;
    } else {
      cart.set(product.id, {
        id: product.id,
        name: product.name,
        price: product.price,
        quantity
      });
    }

    renderCart();

    productSelect.value = "";
    quantityInput.value = "1";
    productSelect.focus();
  }

  addItemButton.addEventListener("click", addSelectedProduct);

  productSelect.addEventListener("change", () => {
    clearMessage();
  });

  // --------------------------------------------------
  // EDIT QUANTITY OR REMOVE CART ITEM
  // --------------------------------------------------

  itemsBody.addEventListener("change", event => {
    const input = event.target.closest(".invoice-line-quantity");

    if (!input) {
      return;
    }

    const id = input.dataset.productId;
    const item = cart.get(id);

    if (!item) {
      return;
    }

    const quantity = Number(input.value);

    if (
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_QUANTITY
    ) {
      showMessage(
        `Enter a whole-number quantity between 1 and ${MAX_QUANTITY}.`,
        "error"
      );

      renderCart();
      return;
    }

    item.quantity = quantity;

    clearMessage();
    renderCart();
  });

  itemsBody.addEventListener("click", event => {
    const button = event.target.closest(
      'button[data-action="remove-item"]'
    );

    if (!button) {
      return;
    }

    const id = button.dataset.productId;
    const item = cart.get(id);

    if (!item) {
      return;
    }

    cart.delete(id);

    clearMessage();
    renderCart();
  });

  // --------------------------------------------------
  // CLEAR CART
  // --------------------------------------------------

  clearItemsButton.addEventListener("click", () => {
    if (cart.size === 0) {
      return;
    }

    const confirmed = window.confirm(
      "Remove all items from this invoice?"
    );

    if (!confirmed) {
      return;
    }

    cart.clear();

    clearMessage();
    renderCart();
  });

  // --------------------------------------------------
  // DISCOUNT AND TAX INPUTS
  // --------------------------------------------------

  function handleCalculationInput() {
    clearMessage();
    updateTotals();
  }

  discountInput.addEventListener("input", handleCalculationInput);
  taxRateInput.addEventListener("input", handleCalculationInput);

  // --------------------------------------------------
  // PAYMENT METHOD
  // --------------------------------------------------

  function getPaymentMethod() {
    const selected = form.querySelector(
      'input[name="paymentMethod"]:checked'
    );

    if (!selected) {
      return "";
    }

    const method = selected.value.toLowerCase();

    if (method !== "cash" && method !== "upi") {
      return "";
    }

    return method;
  }

  form.querySelectorAll('input[name="paymentMethod"]').forEach(input => {
    input.addEventListener("change", clearMessage);
  });

  // --------------------------------------------------
  // VALIDATE INVOICE
  // --------------------------------------------------

  function validateInvoice() {
    clearMessage();

    if (cart.size === 0) {
      showMessage(
        "Add at least one product before continuing.",
        "error"
      );

      productSelect.focus();
      return false;
    }

    if (!invoiceDateInput.value) {
      showMessage("Please select the invoice date.", "error");
      invoiceDateInput.focus();
      return false;
    }

    if (!invoiceTimeInput.value) {
      showMessage("Please select the invoice time.", "error");
      invoiceTimeInput.focus();
      return false;
    }

    const date = new Date(
      `${invoiceDateInput.value}T${invoiceTimeInput.value}`
    );

    if (Number.isNaN(date.getTime())) {
      showMessage("Please enter a valid invoice date and time.", "error");
      invoiceDateInput.focus();
      return false;
    }

    const customerName = customerNameInput.value.trim();

    if (customerName.length > 100) {
      showMessage("Customer name is too long.", "error");
      customerNameInput.focus();
      return false;
    }

    const customerPhone = customerPhoneInput.value.trim();

    if (customerPhone.length > 20) {
      showMessage("Phone number must not exceed 20 characters.", "error");
      customerPhoneInput.focus();
      return false;
    }

    const discount = Number(discountInput.value);

    if (
      !Number.isFinite(discount) ||
      discount < 0 ||
      discount > MAX_DISCOUNT
    ) {
      showMessage("Enter a valid discount amount.", "error");
      discountInput.focus();
      return false;
    }

    if (discount > getSubtotal()) {
      showMessage(
        "The discount cannot be greater than the subtotal.",
        "error"
      );

      discountInput.focus();
      return false;
    }

    const taxRate = Number(taxRateInput.value);

    if (
      !Number.isFinite(taxRate) ||
      taxRate < 0 ||
      taxRate > MAX_TAX_RATE
    ) {
      showMessage(
        `Tax rate must be between 0 and ${MAX_TAX_RATE}%.`,
        "error"
      );

      taxRateInput.focus();
      return false;
    }

    if (notesInput.value.length > 500) {
      showMessage("Invoice notes must not exceed 500 characters.", "error");
      notesInput.focus();
      return false;
    }

    const paymentMethod = getPaymentMethod();

    if (!paymentMethod) {
      showMessage(
        "Please select Cash or UPI as the payment method.",
        "error"
      );

      return false;
    }

    return true;
  }

  // --------------------------------------------------
  // BUILD AN INVOICE DATA SNAPSHOT
  // --------------------------------------------------

  function buildInvoiceData() {
    const totals = calculateTotals();

    const dateParts = invoiceDateInput.value.split("-");

    const formattedDate = dateParts.length === 3
      ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`
      : invoiceDateInput.value;

    const items = Array.from(cart.values()).map(item => ({
      id: item.id,
      name: item.name,
      price: item.price,
      quantity: item.quantity,
      amount: roundMoney(item.price * item.quantity)
    }));

    return {
      invoiceNumber: invoiceNumberInput.value,
      invoiceDate: invoiceDateInput.value,
      formattedDate,
      invoiceTime: invoiceTimeInput.value,

      customerName: customerNameInput.value.trim() || "Walk-in Customer",
      customerPhone: customerPhoneInput.value.trim(),

      orderType: orderTypeInput.value,
      paymentMethod: getPaymentMethod(),

      items,
      notes: notesInput.value.trim(),

      subtotal: totals.subtotal,
      discount: totals.discount,
      taxRate: totals.taxRate,
      tax: totals.tax,
      grandTotal: totals.grandTotal
    };
  }

  // --------------------------------------------------
  // INVOICE PREVIEW STYLES
  // --------------------------------------------------

  function getInvoiceStyles() {
    return `
      * {
        box-sizing: border-box;
      }

      html {
        background: #f3f4f6;
      }

      body {
        margin: 0;
        padding: 24px;
        color: #111111;
        background: #f3f4f6;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 12px;
        line-height: 1.5;
      }

      .toolbar {
        width: 210mm;
        max-width: 100%;
        margin: 0 auto 16px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }

      .toolbar button {
        padding: 10px 18px;
        border: 1px solid #111111;
        border-radius: 4px;
        background: #111111;
        color: #ffffff;
        font-weight: 600;
        cursor: pointer;
      }

      .toolbar .secondary {
        background: #ffffff;
        color: #111111;
      }

      .sheet {
        width: 210mm;
        min-height: 297mm;
        max-width: 100%;
        margin: 0 auto;
        padding: 17mm 15mm 15mm;
        background: #ffffff;
        overflow-wrap: anywhere;
      }

      .business-header {
        padding-bottom: 18px;
        border-bottom: 2px solid #111111;
      }

      .business-name {
        margin: 0;
        font-size: 25px;
        line-height: 1.2;
        font-weight: 800;
        letter-spacing: -0.5px;
      }

      .business-meta {
        margin-top: 7px;
        color: #555555;
        font-size: 11px;
      }

      .invoice-heading {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 20px;
        margin: 23px 0;
      }

      .invoice-heading h2 {
        margin: 0;
        font-size: 20px;
      }

      .invoice-number {
        text-align: right;
      }

      .invoice-number strong {
        display: block;
        font-size: 13px;
      }

      .section-title {
        margin: 22px 0 9px;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .details-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px 28px;
        padding: 15px;
        border: 1px solid #dddddd;
      }

      .detail-label {
        display: block;
        margin-bottom: 3px;
        color: #666666;
        font-size: 10px;
        text-transform: uppercase;
      }

      .detail-value {
        font-size: 12px;
        font-weight: 600;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
      }

      thead {
        display: table-header-group;
      }

      th {
        padding: 10px 7px;
        border-top: 1px solid #111111;
        border-bottom: 1px solid #111111;
        background: #f5f5f5;
        font-size: 10px;
        font-weight: 700;
        text-align: left;
      }

      td {
        padding: 10px 7px;
        border-bottom: 1px solid #e5e5e5;
        vertical-align: top;
      }

      tr {
        break-inside: avoid;
      }

      .right {
        text-align: right;
      }

      .center {
        text-align: center;
      }

      .summary {
        width: 100%;
        margin-top: 20px;
        margin-left: auto;
        page-break-inside: avoid;
      }

      .summary-row {
        display: flex;
        justify-content: flex-end;
        gap: 35px;
        margin: 7px 0;
      }

      .summary-label {
        width: 140px;
        text-align: right;
        color: #555555;
      }

      .summary-value {
        width: 110px;
        text-align: right;
        font-weight: 600;
      }

      .grand-total {
        display: flex;
        justify-content: flex-end;
        gap: 35px;
        margin-top: 12px;
        padding: 13px 0;
        border-top: 2px solid #111111;
        border-bottom: 2px solid #111111;
        font-size: 16px;
        font-weight: 800;
      }

      .grand-total span:first-child {
        width: 140px;
        text-align: right;
      }

      .grand-total span:last-child {
        width: 110px;
        text-align: right;
      }

      .payment-info {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 17px;
        padding: 11px 12px;
        border: 1px solid #dddddd;
      }

      .payment-label {
        color: #666666;
      }

      .payment-value {
        font-weight: 700;
        text-transform: uppercase;
      }

      .notes {
        margin-top: 20px;
        padding: 12px;
        border: 1px solid #dddddd;
      }

      .notes-title {
        margin-bottom: 5px;
        font-size: 10px;
        font-weight: 800;
        text-transform: uppercase;
      }

      .qr-row {
        width: 100%;
        display: flex;
        justify-content: flex-end;
        align-items: flex-start;
        padding-top: 15px;
        margin-top: 8px;
      }

      .qr-placeholder {
        width: 31mm;
        height: 31mm;
        padding: 3px;
        border: 1px solid #cccccc;
        background: #ffffff;
        display: grid;
        grid-template-columns: repeat(13, 1fr);
        grid-template-rows: repeat(13, 1fr);
        gap: 0;
      }

      .qr-cell {
        background: #ffffff;
      }

      .qr-cell.dark {
        background: #111111;
      }

      .footer {
        margin-top: 32px;
        padding-top: 12px;
        border-top: 1px solid #cccccc;
        text-align: center;
        color: #555555;
        font-size: 10px;
      }

      .footer strong {
        display: block;
        margin-bottom: 4px;
        color: #111111;
        font-size: 11px;
      }

      .empty-value {
        color: #777777;
        font-weight: 400;
      }

      @page {
        size: A4 portrait;
        margin: 0;
      }

      @media print {
        html,
        body {
          width: 210mm;
          min-height: 297mm;
          padding: 0;
          margin: 0;
          background: #ffffff;
        }

        .toolbar {
          display: none !important;
        }

        .sheet {
          width: 210mm;
          max-width: none;
          min-height: 297mm;
          margin: 0;
          padding: 15mm 15mm 13mm;
          overflow: visible;
          box-shadow: none;
        }

        * {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
      }

      @media screen and (max-width: 620px) {
        body {
          padding: 10px;
        }

        .sheet {
          width: 100%;
          padding: 22px 16px;
        }

        .details-grid {
          grid-template-columns: 1fr;
        }

        .business-name {
          font-size: 21px;
        }

        .invoice-heading {
          flex-direction: column;
          gap: 10px;
        }

        .invoice-number {
          text-align: left;
        }
      }
    `;
  }

  // --------------------------------------------------
  // QR PLACEHOLDER
  // --------------------------------------------------

  /*
   * This creates a visual QR-style placeholder only.
   * It is NOT a scannable or payment-capable QR code.
   *
   * A real UPI QR must be created later using the business's
   * verified UPI payment details.
   *
   * No text is displayed inside the QR placeholder.
   */

  function makeQRPlaceholder(seed) {
    const size = 13;

    function isFinderCell(row, column) {
      const boxes = [
        [0, 0],
        [0, 8],
        [8, 0]
      ];

      return boxes.some(([startRow, startColumn]) => (
        row >= startRow &&
        row < startRow + 5 &&
        column >= startColumn &&
        column < startColumn + 5
      ));
    }

    function finderValue(row, column) {
      const localRow = row % 8;
      const localColumn = column % 8;

      const edge =
        localRow === 0 ||
        localRow === 4 ||
        localColumn === 0 ||
        localColumn === 4;

      const centre =
        localRow >= 2 &&
        localRow <= 3 &&
        localColumn >= 2 &&
        localColumn <= 3;

      return edge || centre;
    }

    let cells = "";
    let hash = 0;

    for (const character of String(seed)) {
      hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    }

    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        let dark;

        if (isFinderCell(row, column)) {
          dark = finderValue(row, column);
        } else {
          hash = (hash * 1664525 + 1013904223) >>> 0;
          dark = ((hash >>> 28) & 1) === 1;
        }

        cells += `<span class="qr-cell${dark ? " dark" : ""}"></span>`;
      }
    }

    return `
      <div
        class="qr-placeholder"
        role="img"
        aria-label="Non-scannable QR placeholder"
      >
        ${cells}
      </div>
    `;
  }

  // --------------------------------------------------
  // BUILD INVOICE HTML
  // --------------------------------------------------

  function buildPrintableInvoice(data) {
    const businessName = "[Business Name]";

    const orderTypeLabels = {
      "dine-in": "Dine In",
      "takeaway": "Takeaway",
      "delivery": "Delivery"
    };

    const paymentLabels = {
      cash: "Cash",
      upi: "UPI"
    };

    const itemRows = data.items.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHTML(item.name)}</td>
        <td class="right">${formatMoney(item.price)}</td>
        <td class="center">${item.quantity}</td>
        <td class="right">${formatMoney(item.amount)}</td>
      </tr>
    `).join("");

    const notesMarkup = data.notes
      ? `
        <div class="notes">
          <div class="notes-title">Notes</div>
          <div>${escapeHTML(data.notes).replace(/\n/g, "<br>")}</div>
        </div>
      `
      : "";

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        >

        <title>Invoice ${escapeHTML(data.invoiceNumber)}</title>

        <style>
          ${getInvoiceStyles()}
        </style>
      </head>

      <body>

        <div class="toolbar">
          <button type="button" class="secondary" id="closePreview">
            Close
          </button>

          <button type="button" id="printInvoice">
            Print Invoice
          </button>
        </div>

        <main class="sheet">

          <header class="business-header">
            <h1 class="business-name">
              ${escapeHTML(businessName)}
            </h1>

            <div class="business-meta">
              Restaurant Billing
            </div>
          </header>

          <section class="invoice-heading">
            <div>
              <h2>Invoice</h2>

              <div style="margin-top:5px;color:#666;">
                Thank you for your order.
              </div>
            </div>

            <div class="invoice-number">
              <strong>${escapeHTML(data.invoiceNumber)}</strong>

              <div style="margin-top:4px;color:#555;">
                Date: ${escapeHTML(data.formattedDate)}
              </div>

              <div style="color:#555;">
                Time: ${escapeHTML(data.invoiceTime)}
              </div>
            </div>
          </section>

          <div class="section-title">
            Billing Details
          </div>

          <section class="details-grid">

            <div>
              <span class="detail-label">Customer Name</span>

              <div class="detail-value">
                ${escapeHTML(data.customerName)}
              </div>
            </div>

            <div>
              <span class="detail-label">Phone Number</span>

              <div class="detail-value">
                ${data.customerPhone
                  ? escapeHTML(data.customerPhone)
                  : '<span class="empty-value">Not provided</span>'}
              </div>
            </div>

            <div>
              <span class="detail-label">Order Type</span>

              <div class="detail-value">
                ${escapeHTML(orderTypeLabels[data.orderType] || "Dine In")}
              </div>
            </div>

            <div>
              <span class="detail-label">Payment Method</span>

              <div class="detail-value">
                ${escapeHTML(paymentLabels[data.paymentMethod] || "Cash")}
              </div>
            </div>

          </section>

          <div class="section-title">
            Order Items
          </div>

          <table>
            <thead>
              <tr>
                <th style="width:34px;">#</th>
                <th>Product</th>
                <th class="right">Unit Price</th>
                <th class="center">Qty</th>
                <th class="right">Amount</th>
              </tr>
            </thead>

            <tbody>
              ${itemRows}
            </tbody>
          </table>

          <section class="summary">

            <div class="summary-row">
              <span class="summary-label">Subtotal</span>

              <span class="summary-value">
                ${formatMoney(data.subtotal)}
              </span>
            </div>

            <div class="summary-row">
              <span class="summary-label">Discount</span>

              <span class="summary-value">
                −${formatMoney(data.discount)}
              </span>
            </div>

            <div class="summary-row">
              <span class="summary-label">
                Tax (${data.taxRate.toFixed(2)}%)
              </span>

              <span class="summary-value">
                ${formatMoney(data.tax)}
              </span>
            </div>

            <div class="grand-total">
              <span>Grand Total</span>

              <span>
                ${formatMoney(data.grandTotal)}
              </span>
            </div>

          </section>

          <div class="qr-row">
            ${makeQRPlaceholder(data.invoiceNumber)}
          </div>

          ${notesMarkup}

          <div class="footer">
            <strong>Thank you for visiting!</strong>
            We appreciate your business.
          </div>

        </main>

        <script>
          document.getElementById("closePreview")
            .addEventListener("click", () => window.close());

          document.getElementById("printInvoice")
            .addEventListener("click", () => window.print());
        <\/script>

      </body>
      </html>
    `;
  }

  // --------------------------------------------------
  // OPEN INVOICE PREVIEW
  // --------------------------------------------------

  function openInvoicePreview(data) {
    const previewWindow = window.open("", "_blank");

    if (!previewWindow) {
      showMessage(
        "The invoice preview was blocked. Allow pop-ups for this site and try again.",
        "error"
      );

      return false;
    }

    try {
      previewWindow.document.open();
      previewWindow.document.write(buildPrintableInvoice(data));
      previewWindow.document.close();

      return true;
    } catch (error) {
      console.error("Unable to open invoice preview:", error);

      previewWindow.close();

      showMessage(
        "Unable to create the invoice preview. Please try again.",
        "error"
      );

      return false;
    }
  }

  // --------------------------------------------------
  // PREVIEW BUTTON
  // --------------------------------------------------

  previewButton.addEventListener("click", () => {
    if (!validateInvoice()) {
      return;
    }

    const data = buildInvoiceData();

    if (openInvoicePreview(data)) {
      showMessage(
        "Invoice preview opened. This demo invoice has not been saved.",
        "success"
      );
    }
  });

  // --------------------------------------------------
  // GENERATE INVOICE
  // --------------------------------------------------

  form.addEventListener("submit", event => {
    event.preventDefault();

    if (!validateInvoice()) {
      return;
    }

    const data = buildInvoiceData();

    if (!openInvoicePreview(data)) {
      return;
    }

    invoiceStatus.textContent = "Preview Generated";
    invoiceStatus.className = "pill paid";

    showMessage(
      "Invoice preview generated successfully. It is not permanently saved in this demo version.",
      "success"
    );
  });

  // --------------------------------------------------
  // RESET THE FORM
  // --------------------------------------------------

  resetButton.addEventListener("click", () => {
    const hasData =
      cart.size > 0 ||
      customerNameInput.value.trim() !== "" ||
      customerPhoneInput.value.trim() !== "" ||
      notesInput.value.trim() !== "" ||
      Number(discountInput.value) !== 0 ||
      Number(taxRateInput.value) !== 0;

    if (
      hasData &&
      !window.confirm(
        "Reset the invoice form and remove all currently entered details?"
      )
    ) {
      return;
    }

    form.reset();
    cart.clear();

    quantityInput.value = "1";
    discountInput.value = "0";
    taxRateInput.value = "0";

    initialiseInvoiceDetails();

    clearMessage();
    renderCart();

    productSelect.value = "";
    customerNameInput.focus();
  });

  // --------------------------------------------------
  // INITIALISE
  // --------------------------------------------------

  initialiseInvoiceDetails();

  if (itemsTable && emptyItemsRow) {
    renderCart();
  }

  invoiceMessage.hidden = true;

  console.info("Invoice module initialised successfully.");
})();
