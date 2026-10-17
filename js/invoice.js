"use strict";

/*
 * Restaurant Billing Software
 * File: js/invoice.js
 *
 * Features:
 * - Product selection and cart management
 * - Automatic subtotal, discount, tax and grand total
 * - Cash / UPI selection
 * - Dynamic A4 invoice with approved layout
 * - Sequential Firebase invoice numbers: INV-YYYY-0001
 * - Full invoice records in restaurantBilling/invoices
 * - Public verification records for QR scanning
 * - Atomic invoice counter using Firebase transactions
 *
 * Requirements:
 * - js/firebase-config.js must load before this file.
 * - Firebase Authentication is required.
 * - The owner UID must be permitted by Realtime Database rules.
 */

(() => {
  "use strict";

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

  const itemsBody = document.getElementById("invoiceItemsBody");
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

  if (
    !invoiceNumberInput ||
    !invoiceDateInput ||
    !invoiceTimeInput ||
    !customerNameInput ||
    !customerPhoneInput ||
    !orderTypeInput ||
    !productSelect ||
    !quantityInput ||
    !addItemButton ||
    !itemsBody ||
    !itemCountLabel ||
    !clearItemsButton ||
    !discountInput ||
    !taxRateInput ||
    !notesInput ||
    !subtotalOutput ||
    !discountOutput ||
    !taxOutput ||
    !grandTotalOutput ||
    !resetButton ||
    !previewButton
  ) {
    console.error("Invoice: One or more required HTML elements are missing.");
    return;
  }

  // --------------------------------------------------
  // CONFIGURATION
  // --------------------------------------------------

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const INVOICES_PATH = "restaurantBilling/invoices";
  const COUNTERS_PATH = "restaurantBilling/invoiceCounters";
  const VERIFICATION_PATH = "publicInvoiceVerification";

  const VERIFICATION_PAGE = new URL(
    "verify-invoice.html",
    window.location.href
  ).href.split("?")[0];

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

  const cart = new Map();

  let firebaseServicesPromise = null;

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

  function generateVerificationId() {
    if (
      !window.crypto ||
      typeof window.crypto.getRandomValues !== "function"
    ) {
      throw new Error(
        "Secure verification IDs require HTTPS. Open the website using its secure URL."
      );
    }

    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);

    return Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function showMessage(message, type = "info") {
    if (!invoiceMessage) {
      console.log(message);
      return;
    }

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
    if (!invoiceMessage) return;

    invoiceMessage.textContent = "";
    invoiceMessage.hidden = true;
    delete invoiceMessage.dataset.type;
  }

  function setInvoiceStatus(message, className = "pill pending") {
    if (!invoiceStatus) return;

    invoiceStatus.textContent = message;
    invoiceStatus.className = className;
  }

  // --------------------------------------------------
  // INITIALISE INVOICE DETAILS
  // --------------------------------------------------

  function initialiseInvoiceDetails() {
    const now = new Date();

    /*
     * A final invoice number is allocated from Firebase
     * when the owner generates and saves the invoice.
     * Preview drafts do not consume invoice numbers.
     */

    invoiceNumberInput.value = "Assigned when saved";
    invoiceNumberInput.readOnly = true;

    invoiceDateInput.value = localDateString(now);
    invoiceTimeInput.value = localTimeString(now);

    setInvoiceStatus("Draft");
  }

  // --------------------------------------------------
  // READ SELECTED PRODUCT
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
    const priceMatch = label.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/);

    if (!priceMatch) {
      showMessage(
        "The selected product has no valid price.",
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
  // CART AND CALCULATIONS
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

  function updateTotals() {
    const totals = calculateTotals();

    subtotalOutput.textContent = formatMoney(totals.subtotal);
    discountOutput.textContent = `−${formatMoney(totals.discount)}`;
    taxOutput.textContent = formatMoney(totals.tax);
    grandTotalOutput.textContent = formatMoney(totals.grandTotal);

    return totals;
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
              <div class="cust-name">${escapeHTML(item.name)}</div>
            </td>

            <td class="num">${formatMoney(item.price)}</td>

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
  productSelect.addEventListener("change", clearMessage);

  // --------------------------------------------------
  // EDIT QUANTITY / REMOVE PRODUCT
  // --------------------------------------------------

  itemsBody.addEventListener("change", event => {
    const input = event.target.closest(".invoice-line-quantity");

    if (!input) return;

    const item = cart.get(input.dataset.productId);

    if (!item) return;

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

    if (!button) return;

    cart.delete(button.dataset.productId);

    clearMessage();
    renderCart();
  });

  // --------------------------------------------------
  // CLEAR CART
  // --------------------------------------------------

  clearItemsButton.addEventListener("click", () => {
    if (cart.size === 0) return;

    if (!window.confirm("Remove all items from this invoice?")) {
      return;
    }

    cart.clear();

    clearMessage();
    renderCart();
  });

  // --------------------------------------------------
  // DISCOUNT AND TAX
  // --------------------------------------------------

  discountInput.addEventListener("input", () => {
    clearMessage();
    updateTotals();
  });

  taxRateInput.addEventListener("input", () => {
    clearMessage();
    updateTotals();
  });

  // --------------------------------------------------
  // PAYMENT METHOD
  // --------------------------------------------------

  function getPaymentMethod() {
    const selected = form.querySelector(
      'input[name="paymentMethod"]:checked'
    );

    if (!selected) return "";

    const method = selected.value.toLowerCase();

    return ["cash", "upi"].includes(method) ? method : "";
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
      showMessage("Add at least one product before continuing.", "error");
      productSelect.focus();
      return false;
    }

    if (!invoiceDateInput.value || !invoiceTimeInput.value) {
      showMessage("Please enter the invoice date and time.", "error");
      invoiceDateInput.focus();
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

    if (customerNameInput.value.trim().length > 100) {
      showMessage("Customer name is too long.", "error");
      customerNameInput.focus();
      return false;
    }

    if (customerPhoneInput.value.trim().length > 20) {
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

    if (!getPaymentMethod()) {
      showMessage(
        "Please select Cash or UPI as the payment method.",
        "error"
      );

      return false;
    }

    return true;
  }

  // --------------------------------------------------
  // BUILD INVOICE SNAPSHOT
  // --------------------------------------------------

  function buildInvoiceData(invoiceNumber = "DRAFT") {
    const totals = calculateTotals();
    const dateParts = invoiceDateInput.value.split("-");

    const formattedDate = dateParts.length === 3
      ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`
      : invoiceDateInput.value;

    return {
      invoiceNumber,
      invoiceDate: invoiceDateInput.value,
      formattedDate,
      invoiceTime: invoiceTimeInput.value,

      customerName:
        customerNameInput.value.trim() || "Walk-in Customer",

      customerPhone: customerPhoneInput.value.trim(),

      orderType: orderTypeInput.value || "dine-in",
      paymentMethod: getPaymentMethod(),

      items: Array.from(cart.values()).map(item => ({
        id: item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        amount: roundMoney(item.price * item.quantity)
      })),

      notes: notesInput.value.trim(),

      subtotal: totals.subtotal,
      discount: totals.discount,
      taxableAmount: totals.taxableAmount,
      taxRate: totals.taxRate,
      tax: totals.tax,
      grandTotal: totals.grandTotal
    };
  }

  // --------------------------------------------------
  // FIREBASE SHARED SERVICES
  // --------------------------------------------------

  async function getFirebaseServices() {
    if (firebaseServicesPromise) {
      return firebaseServicesPromise;
    }

    firebaseServicesPromise = (async () => {
      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.ready) {
        throw new Error(
          "Firebase is not initialised. Check js/firebase-config.js."
        );
      }

      await firebase.ready;

      if (firebase.error) {
        throw new Error(
          firebase.error.message || "Firebase failed to initialise."
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
          "The shared Firebase Authentication or Database SDK is unavailable."
        );
      }

      const auth = firebase.auth || sdk.auth.getAuth(firebase.app);
      const db = firebase.db || sdk.database.getDatabase(firebase.app);

      return {
        app: firebase.app,
        config: firebase.config,
        auth,
        db,
        authSDK: sdk.auth,
        dbSDK: sdk.database
      };
    })();

    try {
      return await firebaseServicesPromise;
    } catch (error) {
      firebaseServicesPromise = null;
      throw error;
    }
  }

  // --------------------------------------------------
  // GET AUTHENTICATED OWNER
  // --------------------------------------------------

  async function getAuthenticatedUser(services) {
    const { auth, authSDK } = services;

    function validateOwner(user) {
      if (!user) {
        throw new Error(
          "Please sign in before generating a verified invoice."
        );
      }

      if (user.uid !== OWNER_UID) {
        throw new Error(
          "This account is not authorised to generate invoices."
        );
      }

      return user;
    }

    if (auth.currentUser) {
      return validateOwner(auth.currentUser);
    }

    return new Promise((resolve, reject) => {
      let unsubscribe = null;
      let settled = false;

      const finish = (callback, value) => {
        if (settled) return;

        settled = true;
        window.clearTimeout(timeout);

        if (typeof unsubscribe === "function") {
          unsubscribe();
        }

        callback(value);
      };

      const timeout = window.setTimeout(() => {
        finish(
          reject,
          new Error(
            "Authentication timed out. Please sign in and try again."
          )
        );
      }, 10000);

      unsubscribe = authSDK.onAuthStateChanged(
        auth,
        user => {
          try {
            finish(resolve, validateOwner(user));
          } catch (error) {
            finish(reject, error);
          }
        },
        error => finish(reject, error)
      );
    });
  }

  // --------------------------------------------------
  // READ EXISTING INVOICES TO PREVENT NUMBER REUSE
  // --------------------------------------------------

  async function getHighestExistingSequence(services, year) {
    const { db, dbSDK } = services;

    const invoicesRef = dbSDK.ref(db, INVOICES_PATH);
    const snapshot = await dbSDK.get(invoicesRef);

    if (!snapshot.exists()) {
      return 0;
    }

    const value = snapshot.val();

    const records = Array.isArray(value)
      ? value
      : Object.values(value || {});

    let highest = 0;

    const numberPattern = new RegExp(
      `^INV-${year}-(\\d+)$`,
      "i"
    );

    for (const record of records) {
      if (!record || typeof record !== "object") {
        continue;
      }

      const number = String(
        record.invoiceNumber || record.invoiceNo || ""
      ).trim();

      const match = number.match(numberPattern);

      if (!match) continue;

      const sequence = Number(match[1]);

      if (Number.isSafeInteger(sequence)) {
        highest = Math.max(highest, sequence);
      }
    }

    return highest;
  }

  // --------------------------------------------------
  // ATOMIC SEQUENTIAL INVOICE NUMBER
  // --------------------------------------------------

  async function allocateInvoiceNumber(services, invoiceDate) {
    const { db, dbSDK } = services;

    const year = String(invoiceDate).slice(0, 4);

    if (!/^\d{4}$/.test(year)) {
      throw new Error("A valid invoice year is required.");
    }

    /*
     * Scan saved invoice records in case invoices already exist
     * but the sequence counter has not yet been created.
     */

    const highestExisting = await getHighestExistingSequence(
      services,
      year
    );

    const counterRef = dbSDK.ref(
      db,
      `${COUNTERS_PATH}/${year}`
    );

    /*
     * runTransaction atomically increments the counter.
     * Concurrent invoice generation requests will not receive
     * the same sequence number.
     */

    const result = await dbSDK.runTransaction(
      counterRef,
      currentValue => {
        const current = Number(currentValue);

        const safeCurrent =
          Number.isSafeInteger(current) && current >= 0
            ? current
            : 0;

        return Math.max(safeCurrent, highestExisting) + 1;
      },
      {
        applyLocally: false
      }
    );

    if (!result.committed || !result.snapshot) {
      throw new Error(
        "Firebase could not allocate a unique invoice number. Please try again."
      );
    }

    const sequence = Number(result.snapshot.val());

    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("Firebase returned an invalid invoice sequence.");
    }

    return `INV-${year}-${String(sequence).padStart(4, "0")}`;
  }

  // --------------------------------------------------
  // SAVE COMPLETE INVOICE TO FIREBASE
  // --------------------------------------------------

  async function saveInvoiceRecord(
    services,
    user,
    data,
    verificationId,
    verificationUrl
  ) {
    const { db, dbSDK } = services;

    const invoicesRef = dbSDK.ref(db, INVOICES_PATH);
    const newInvoiceRef = dbSDK.push(invoicesRef);

    const createdAt = new Date().toISOString();

    const record = {
      ...data,

      id: newInvoiceRef.key,
      verificationId,
      verificationUrl,

      recordStatus: "valid",
      paymentStatus: "recorded",

      ownerUid: user.uid,
      createdAt,
      createdAtMs: Date.now()
    };

    await dbSDK.set(newInvoiceRef, record);

    return {
      key: newInvoiceRef.key,
      record
    };
  }

  // --------------------------------------------------
  // SAVE MINIMAL PUBLIC VERIFICATION RECORD
  // --------------------------------------------------

  async function saveVerificationRecord(
    services,
    user,
    data,
    verificationId
  ) {
    const { config, auth } = services;

    const idToken = await user.getIdToken();

    const publicRecord = {
      verificationId,

      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate,
      invoiceTime: data.invoiceTime,
      orderType: data.orderType,
      paymentMethod: data.paymentMethod,

      items: data.items.map(item => ({
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        amount: item.amount
      })),

      totals: {
        subtotal: data.subtotal,
        discount: data.discount,
        taxRate: data.taxRate,
        tax: data.tax,
        grandTotal: data.grandTotal
      },

      recordStatus: "valid",
      createdAt: new Date().toISOString()
    };

    if (!auth.currentUser || auth.currentUser.uid !== user.uid) {
      throw new Error(
        "Your login session changed. Please sign in again."
      );
    }

    const databaseUrl = String(config.databaseURL || "")
      .replace(/\/+$/, "");

    if (!databaseUrl) {
      throw new Error("Firebase Database URL is missing.");
    }

    const recordUrl =
      `${databaseUrl}/${VERIFICATION_PATH}/${encodeURIComponent(verificationId)}.json` +
      `?auth=${encodeURIComponent(idToken)}`;

    const response = await fetch(recordUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(publicRecord)
    });

    if (!response.ok) {
      let errorMessage =
        "Firebase could not save the verification record.";

      try {
        const errorData = await response.json();

        if (errorData.error === "Permission denied") {
          errorMessage =
            "Firebase denied the verification write. Check your Realtime Database rules.";
        }
      } catch {
        // Keep the general error message.
      }

      throw new Error(errorMessage);
    }

    const savedRecord = await response.json();

    if (
      !savedRecord ||
      savedRecord.verificationId !== verificationId ||
      savedRecord.invoiceNumber !== data.invoiceNumber
    ) {
      throw new Error(
        "Firebase did not confirm the correct verification record."
      );
    }

    return {
      verificationId,
      verificationUrl:
        `${VERIFICATION_PAGE}?vid=${encodeURIComponent(verificationId)}`
    };
  }

  // --------------------------------------------------
  // LOCKED A4 INVOICE CSS
  // --------------------------------------------------

  function getInvoiceStyles() {
    return `
      * {
        box-sizing: border-box;
      }

      html {
        background: #eeeeee;
      }

      body {
        margin: 0;
        padding: 20px;
        background: #eeeeee;
        color: #222222;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 13px;
      }

      .toolbar {
        width: 100%;
        max-width: 210mm;
        margin: 0 auto 15px;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .toolbar button {
        padding: 10px 20px;
        background: #222222;
        color: #ffffff;
        border: 1px solid #222222;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
      }

      .toolbar .secondary {
        background: #ffffff;
        color: #222222;
      }

      .invoice {
        width: 100%;
        max-width: 210mm;
        min-height: 297mm;
        margin: 0 auto;
        padding: 10mm;
        background: #ffffff;
        border: 1px solid #d5d5d5;
        border-radius: 8px;
        overflow-wrap: anywhere;
      }

      .section {
        width: 100%;
        padding: 12px;
        margin-bottom: 12px;
        border: 1px solid #bdbdbd;
        border-radius: 7px;
        break-inside: avoid;
      }

      .business-header {
        padding: 22px 12px;
        text-align: center;
      }

      .business-name {
        margin: 0 0 9px;
        font-size: 30px;
        line-height: 1.25;
        font-weight: 800;
        overflow-wrap: anywhere;
      }

      .business-details {
        margin: 4px 0;
        font-size: 12px;
        line-height: 1.5;
      }

      .invoice-title {
        margin: 14px 0 0;
        font-size: 21px;
        font-weight: 700;
        letter-spacing: 1px;
      }

      .section-title {
        margin: 0 0 10px;
        padding-bottom: 8px;
        border-bottom: 1px solid #dddddd;
        font-size: 14px;
        font-weight: 700;
      }

      .info-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px 20px;
      }

      .info-item {
        min-width: 0;
        line-height: 1.6;
        overflow-wrap: anywhere;
      }

      .label {
        font-weight: 700;
      }

      .table-section {
        padding: 0;
        overflow: hidden;
      }

      table {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
      }

      th,
      td {
        padding: 11px 8px;
        border-bottom: 1px solid #dddddd;
        vertical-align: top;
        overflow-wrap: anywhere;
      }

      th {
        background: #f2f2f2;
        font-size: 12px;
        font-weight: 700;
        text-align: left;
      }

      tbody tr:last-child td {
        border-bottom: none;
      }

      .center {
        text-align: center;
      }

      .right {
        text-align: right;
      }

      .item-col {
        width: 39%;
      }

      .qty-col {
        width: 12%;
      }

      .price-col {
        width: 23%;
      }

      .amount-col {
        width: 26%;
      }

      .summary-inner {
        width: 100%;
        max-width: none;
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 11px 10px;
        border-bottom: 1px solid #e2e2e2;
        line-height: 1.4;
      }

      .summary-row span:first-child {
        flex: 1;
      }

      .summary-row span:last-child {
        min-width: 95px;
        text-align: right;
        font-variant-numeric: tabular-nums;
      }

      .grand-total {
        margin-top: 8px;
        padding: 15px 10px;
        border: 1px solid #999999;
        border-radius: 6px;
        font-size: 19px;
        font-weight: 800;
      }

      .payment-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px 20px;
        line-height: 1.6;
      }

      .payment-item {
        min-width: 0;
        overflow-wrap: anywhere;
      }

      .qr-section {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        width: 100%;
        margin: 0 0 12px;
        padding: 0;
        break-inside: avoid;
      }

      .qr-code {
        width: 90px;
        height: 90px;
        flex: 0 0 90px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .qr-code canvas,
      .qr-code img {
        display: block;
        width: 90px !important;
        height: 90px !important;
        max-width: 100%;
        image-rendering: pixelated;
      }

      .qr-pending {
        width: 90px;
        height: 90px;
        border: 1px dashed #888888;
        border-radius: 6px;
      }

      .footer {
        width: 100%;
        margin-top: 8px;
        padding: 14px 12px;
        text-align: center;
        font-size: 12px;
        line-height: 1.7;
      }

      .footer strong {
        font-size: 14px;
      }

      @page {
        size: A4 portrait;
        margin: 0;
      }

      @media print {
        html,
        body {
          width: 210mm;
          margin: 0;
          padding: 0;
          background: #ffffff;
        }

        .toolbar {
          display: none !important;
        }

        .invoice {
          width: 210mm;
          max-width: none;
          min-height: 297mm;
          margin: 0;
          padding: 10mm;
          border: none;
          border-radius: 0;
          box-shadow: none;
          overflow: visible;
        }

        .section {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }

        .table-section {
          overflow: visible;
        }

        thead {
          display: table-header-group;
        }

        tr {
          break-inside: avoid;
        }
      }

      @media screen and (max-width: 600px) {
        body {
          padding: 8px;
        }

        .invoice {
          min-height: auto;
          padding: 12px;
        }

        .business-name {
          font-size: 24px;
        }

        .info-grid,
        .payment-grid {
          grid-template-columns: 1fr;
        }

        th,
        td {
          padding: 8px 4px;
          font-size: 11px;
        }

        .summary-row {
          padding: 10px 5px;
        }

        .grand-total {
          font-size: 17px;
        }
      }
    `;
  }

  // --------------------------------------------------
  // PRINTABLE INVOICE HTML
  // --------------------------------------------------

  function buildPrintableInvoice(data, verification = null) {
    const orderTypeLabels = {
      "dine-in": "Dine In",
      takeaway: "Takeaway",
      delivery: "Delivery"
    };

    const paymentLabels = {
      cash: "Cash",
      upi: "UPI"
    };

    const itemRows = data.items.map(item => `
      <tr>
        <td>${escapeHTML(item.name)}</td>
        <td class="center">${item.quantity}</td>
        <td class="right">${formatMoney(item.price)}</td>
        <td class="right">${formatMoney(item.amount)}</td>
      </tr>
    `).join("");

    const qrMarkup = verification
      ? `<div id="invoiceQr" class="qr-code" aria-label="Invoice verification QR code"></div>`
      : `<div class="qr-pending" aria-hidden="true"></div>`;

    const notesMarkup = data.notes
      ? `
        <section class="section">
          <h3 class="section-title">Notes</h3>
          <div>${escapeHTML(data.notes).replace(/\n/g, "<br>")}</div>
        </section>
      `
      : "";

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice ${escapeHTML(data.invoiceNumber)}</title>
        <style>${getInvoiceStyles()}</style>
      </head>

      <body>
        <div class="toolbar">
          <button type="button" class="secondary" id="closePreview">
            Close
          </button>

          <button type="button" id="printInvoice">
            Print / Save as PDF
          </button>
        </div>

        <main class="invoice">

          <header class="section business-header">
            <h1 class="business-name">[Business Name]</h1>
            <p class="business-details">Business Address</p>
            <p class="business-details">Contact Number</p>
            <h2 class="invoice-title">INVOICE</h2>
          </header>

          <section class="section">
            <h3 class="section-title">Invoice Details</h3>

            <div class="info-grid">
              <div class="info-item">
                <span class="label">Invoice No:</span>
                ${escapeHTML(data.invoiceNumber)}
              </div>

              <div class="info-item">
                <span class="label">Date:</span>
                ${escapeHTML(data.formattedDate)}
              </div>

              <div class="info-item">
                <span class="label">Time:</span>
                ${escapeHTML(data.invoiceTime)}
              </div>

              <div class="info-item">
                <span class="label">Order Type:</span>
                ${escapeHTML(orderTypeLabels[data.orderType] || "Dine In")}
              </div>
            </div>
          </section>

          <section class="section">
            <h3 class="section-title">Customer Details</h3>

            <div class="info-grid">
              <div class="info-item">
                <span class="label">Customer:</span>
                ${escapeHTML(data.customerName)}
              </div>

              <div class="info-item">
                <span class="label">Contact:</span>
                ${data.customerPhone
                  ? escapeHTML(data.customerPhone)
                  : "Not provided"}
              </div>
            </div>
          </section>

          <section class="section table-section">
            <table>
              <colgroup>
                <col class="item-col">
                <col class="qty-col">
                <col class="price-col">
                <col class="amount-col">
              </colgroup>

              <thead>
                <tr>
                  <th>Item Description</th>
                  <th class="center">Qty</th>
                  <th class="right">Price</th>
                  <th class="right">Amount</th>
                </tr>
              </thead>

              <tbody>
                ${itemRows}
              </tbody>
            </table>
          </section>

          <section class="section">
            <div class="summary-inner">

              <div class="summary-row">
                <span>Subtotal</span>
                <span>${formatMoney(data.subtotal)}</span>
              </div>

              <div class="summary-row">
                <span>Discount</span>
                <span>−${formatMoney(data.discount)}</span>
              </div>

              <div class="summary-row">
                <span>Tax (${data.taxRate.toFixed(2)}%)</span>
                <span>${formatMoney(data.tax)}</span>
              </div>

              <div class="summary-row grand-total">
                <span>Grand Total</span>
                <span>${formatMoney(data.grandTotal)}</span>
              </div>

            </div>
          </section>

          <section class="section">
            <h3 class="section-title">Payment Details</h3>

            <div class="payment-grid">
              <div class="payment-item">
                <span class="label">Payment Method:</span>
                ${escapeHTML(paymentLabels[data.paymentMethod] || "Cash")}
              </div>

              <div class="payment-item">
                <span class="label">Payment Status:</span>
                Recorded
              </div>
            </div>
          </section>

          <section class="qr-section">
            ${qrMarkup}
          </section>

          ${notesMarkup}

          <footer class="section footer">
            <strong>Thank you for visiting!</strong>
            We appreciate your business.
          </footer>

        </main>

        ${
          verification
            ? `
              <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
              <script>
                (() => {
                  const verifyUrl = ${JSON.stringify(verification.verificationUrl)};
                  const container = document.getElementById("invoiceQr");

                  if (window.QRCode && container) {
                    new QRCode(container, {
                      text: verifyUrl,
                      width: 90,
                      height: 90,
                      colorDark: "#111111",
                      colorLight: "#ffffff",
                      correctLevel: QRCode.CorrectLevel.M
                    });
                  } else if (container) {
                    container.textContent = "";
                    container.className = "qr-pending";
                    container.setAttribute(
                      "aria-label",
                      "QR code could not be loaded"
                    );
                  }
                })();
              <\/script>
            `
            : ""
        }

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
  // DISPLAY THE INVOICE
  // --------------------------------------------------

  function writeInvoiceToWindow(
    previewWindow,
    data,
    verification = null
  ) {
    try {
      previewWindow.document.open();

      previewWindow.document.write(
        buildPrintableInvoice(data, verification)
      );

      previewWindow.document.close();

      return true;
    } catch (error) {
      console.error("Unable to render invoice:", error);

      try {
        previewWindow.close();
      } catch {
        // Ignore window closing errors.
      }

      showMessage(
        "Unable to create the invoice preview. Please try again.",
        "error"
      );

      return false;
    }
  }

  // --------------------------------------------------
  // PREVIEW WITHOUT SAVING
  // --------------------------------------------------

  previewButton.addEventListener("click", () => {
    if (!validateInvoice()) return;

    const data = buildInvoiceData("DRAFT");
    const previewWindow = window.open("", "_blank");

    if (!previewWindow) {
      showMessage(
        "The invoice preview was blocked. Allow pop-ups for this site and try again.",
        "error"
      );

      return;
    }

    writeInvoiceToWindow(previewWindow, data, null);

    showMessage(
      "Draft preview opened. A permanent invoice number is assigned when you generate and save the invoice.",
      "info"
    );
  });

  // --------------------------------------------------
  // GENERATE AND SAVE VERIFIED INVOICE
  // --------------------------------------------------

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!validateInvoice()) return;

    /*
     * Open the window before awaiting Firebase,
     * preventing most browser popup-blocking issues.
     */

    const previewWindow = window.open("", "_blank");

    if (!previewWindow) {
      showMessage(
        "The invoice preview was blocked. Allow pop-ups for this site and try again.",
        "error"
      );

      return;
    }

    previewWindow.document.open();
    previewWindow.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head><title>Generating invoice</title></head>
      <body style="font-family:Arial;padding:30px">
        Saving invoice and creating verification record...
      </body>
      </html>
    `);
    previewWindow.document.close();

    const submitButton = form.querySelector(
      'button[type="submit"]'
    );

    if (submitButton) {
      submitButton.disabled = true;
    }

    setInvoiceStatus("Saving");

    let savedInvoiceKey = null;
    let verificationId = null;

    try {
      const services = await getFirebaseServices();
      const user = await getAuthenticatedUser(services);

      /*
       * Build the invoice from the current cart, then assign
       * its number through the atomic Firebase counter.
       */

      const data = buildInvoiceData("PENDING");

      data.invoiceNumber = await allocateInvoiceNumber(
        services,
        data.invoiceDate
      );

      invoiceNumberInput.value = data.invoiceNumber;

      verificationId = generateVerificationId();

      const verificationUrl =
        `${VERIFICATION_PAGE}?vid=${encodeURIComponent(verificationId)}`;

      /*
       * Save the canonical invoice first.
       * The public QR record is written afterwards.
       */

      const saved = await saveInvoiceRecord(
        services,
        user,
        data,
        verificationId,
        verificationUrl
      );

      savedInvoiceKey = saved.key;

      const verification = await saveVerificationRecord(
        services,
        user,
        data,
        verificationId
      );

      /*
       * Confirm both records refer to the same invoice number.
       */

      if (!verification.verificationId || !data.invoiceNumber) {
        throw new Error(
          "Invoice verification could not be confirmed."
        );
      }

      const opened = writeInvoiceToWindow(
        previewWindow,
        data,
        verification
      );

      if (!opened) {
        throw new Error(
          "The invoice was saved, but the printable preview could not be rendered. Check the invoice record before retrying."
        );
      }

      setInvoiceStatus("Generated", "pill paid");

      showMessage(
        `Invoice ${data.invoiceNumber} generated and saved successfully.`,
        "success"
      );
    } catch (error) {
      console.error("Invoice generation failed:", error);

      /*
       * If the public verification write fails after saving the
       * invoice, try to remove the incomplete invoice record.
       * The allocated sequence number is intentionally not reused.
       */

      if (savedInvoiceKey && !verificationId) {
        try {
          const services = await getFirebaseServices();

          await services.dbSDK.remove(
            services.dbSDK.ref(
              services.db,
              `${INVOICES_PATH}/${savedInvoiceKey}`
            )
          );
        } catch (rollbackError) {
          console.error(
            "Could not remove the incomplete invoice:",
            rollbackError
          );
        }
      }

      try {
        previewWindow.close();
      } catch {
        // Ignore closing errors.
      }

      setInvoiceStatus("Draft");

      showMessage(
        error.message ||
          "Unable to save the invoice. Please check Firebase and try again.",
        "error"
      );
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

  // --------------------------------------------------
  // RESET INVOICE
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
    productSelect.value = "";

    initialiseInvoiceDetails();
    clearMessage();
    renderCart();

    customerNameInput.focus();
  });

  // --------------------------------------------------
  // INITIALISE
  // --------------------------------------------------

  initialiseInvoiceDetails();
  renderCart();

  if (invoiceMessage) {
    invoiceMessage.hidden = true;
  }

  console.info("Invoice module initialised successfully.");
})();
