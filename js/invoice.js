/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Invoice Creation, Calculation, Saving and Preview
   Database root: restaurantBilling/
   Static restaurant-location QR only
   Safe manual refresh preserves the current invoice draft
   Lightweight initial loading and reveal animation
   Dynamic Amount in Words — Indian Numbering System
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const PATHS = Object.freeze({
    products: "restaurantBilling/products",
    categories: "restaurantBilling/categories",
    settings: "restaurantBilling/settings",
    invoices: "restaurantBilling/invoices",
    counters: "restaurantBilling/invoiceCounters"
  });

  const $ = (id) => document.getElementById(id);
  const ui = window.restaurantUI;

  const state = {
    db: null,
    api: null,
    settings: {},
    products: [],
    categories: [],
    cart: [],
    loaded: {
      products: false,
      categories: false,
      settings: false
    },
    subscriptions: [],
    unregisterPageRefresh: null,
    ready: false,
    saving: false,
    nextItemId: 1,
    disposed: false,
    initialResolved: {
      products: false,
      categories: false,
      settings: false
    }
  };

  /* ---------------------------------------------------------
     1. Lightweight initial loading animation
     --------------------------------------------------------- */

  let loadingPhase = "loading";
  let revealTimer = null;

  function resolveInitialSource(path) {
    const key = Object.keys(PATHS).find(
      (name) => PATHS[name] === path
    );

    if (
      key &&
      Object.prototype.hasOwnProperty.call(
        state.initialResolved,
        key
      )
    ) {
      state.initialResolved[key] = true;
    }
  }

  function allInitialSourcesResolved() {
    return Object.values(state.initialResolved).every(Boolean);
  }

  function finishInvoiceLoadingImmediately() {
    if (revealTimer !== null) {
      window.clearTimeout(revealTimer);
      revealTimer = null;
    }

    document.body.classList.remove(
      "is-dashboard-loading",
      "is-dashboard-revealing"
    );

    loadingPhase = "complete";
  }

  function revealInvoicePageWhenReady() {
    if (
      state.disposed ||
      loadingPhase !== "loading" ||
      !allInitialSourcesResolved()
    ) {
      return;
    }

    loadingPhase = "revealing";

    document.body.classList.remove("is-dashboard-loading");
    document.body.classList.add("is-dashboard-revealing");

    revealTimer = window.setTimeout(function () {
      revealTimer = null;

      if (state.disposed) return;

      document.body.classList.remove("is-dashboard-revealing");
      loadingPhase = "complete";
    }, 270);
  }

  /* ---------------------------------------------------------
     2. General helpers
     --------------------------------------------------------- */

  function setText(id, value) {
    const element = $(id);
    if (!element) return;

    element.textContent =
      value === null || value === undefined ? "" : String(value);
  }

  function setMessage(message, type) {
    const element = $("invoiceMessage");
    if (!element) return;

    element.textContent = message || "";
    element.classList.remove("is-success", "is-error", "is-warning");

    if (type) element.classList.add("is-" + type);
  }

  function setPageStatus(message, type) {
    const element = $("invoicePageStatus");
    if (!element) return;

    element.textContent = message || "";
    element.classList.remove("is-connected", "is-error", "is-warning");

    if (type) element.classList.add("is-" + type);
  }

  function formatMoney(value) {
    if (ui && typeof ui.formatCurrency === "function") {
      return ui.formatCurrency(value);
    }

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(value) || 0);
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function toNumber(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function textValue(value) {
    return String(value ?? "").trim();
  }

  function firstValue(object, keys) {
    for (const key of keys) {
      const value = object && object[key];

      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }

    return null;
  }

  function storedValue(object, keys) {
    for (const key of keys) {
      if (
        object &&
        Object.prototype.hasOwnProperty.call(object, key) &&
        object[key] !== null &&
        object[key] !== undefined
      ) {
        return object[key];
      }
    }

    return "";
  }

  function recordEntries(data) {
    if (!data || typeof data !== "object") return [];

    if (Array.isArray(data)) {
      return data.map((record, index) => {
        if (!record || typeof record !== "object") return null;

        return {
          ...record,
          _recordKey: record._recordKey || String(index)
        };
      }).filter(Boolean);
    }

    return Object.entries(data)
      .filter(([, value]) => value && typeof value === "object")
      .map(([key, value]) => ({
        ...value,
        _recordKey: key
      }));
  }

  function recordIsActive(record) {
    return record.isActive !== false &&
      record.active !== false &&
      record.deleted !== true &&
      !record.deletedAt;
  }

  function localDateString(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function localTimeString(date) {
    return [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  function displayDate(value) {
    if (!value) return "";

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return textValue(value);

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function displayTime(value) {
    if (!value) return "";

    const parts = String(value).split(":");
    if (parts.length < 2) return textValue(value);

    const hour = Number(parts[0]);
    const minute = Number(parts[1]);

    if (
      !Number.isInteger(hour) ||
      !Number.isInteger(minute) ||
      hour < 0 || hour > 23 ||
      minute < 0 || minute > 59
    ) {
      return textValue(value);
    }

    const date = new Date();
    date.setHours(hour, minute, 0, 0);

    return new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    }).format(date);
  }

  function getFirebase() {
    const firebase = window.restaurantFirebase;

    if (
      !firebase ||
      !firebase.ready ||
      !firebase.db ||
      !firebase.sdk ||
      !firebase.sdk.database
    ) {
      throw new Error("Firebase Realtime Database is unavailable.");
    }

    return {
      db: firebase.db,
      api: firebase.sdk.database
    };
  }

  function ensureOwnerAuthorized() {
    const access = window.restaurantAccess;

    if (
      !access ||
      !access.ready ||
      !access.authorized ||
      !access.user ||
      access.user.uid !== OWNER_UID
    ) {
      throw new Error("The authorized owner session is required.");
    }
  }

  /* ---------------------------------------------------------
     2A. Dynamic Amount in Words
     Indian numbering: Thousand, Lakh, Crore
     --------------------------------------------------------- */

  function numberBelowHundred(number) {
    const ones = [
      "Zero", "One", "Two", "Three", "Four",
      "Five", "Six", "Seven", "Eight", "Nine",
      "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
      "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
    ];

    const tens = [
      "", "", "Twenty", "Thirty", "Forty",
      "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
    ];

    if (number < 20) return ones[number];

    const ten = Math.floor(number / 10);
    const one = number % 10;

    return tens[ten] + (one ? " " + ones[one] : "");
  }

  function numberToWordsIndian(number) {
    number = Math.floor(Number(number));

    if (!Number.isFinite(number) || number < 0) {
      return "Zero";
    }

    if (number === 0) return "Zero";

    if (number > 999999999999) {
      return String(number);
    }

    const parts = [];

    const crore = Math.floor(number / 10000000);
    number %= 10000000;

    const lakh = Math.floor(number / 100000);
    number %= 100000;

    const thousand = Math.floor(number / 1000);
    number %= 1000;

    const hundred = Math.floor(number / 100);
    number %= 100;

    if (crore) {
      parts.push(numberToWordsIndian(crore) + " Crore");
    }

    if (lakh) {
      parts.push(numberToWordsIndian(lakh) + " Lakh");
    }

    if (thousand) {
      parts.push(numberToWordsIndian(thousand) + " Thousand");
    }

    if (hundred) {
      parts.push(numberBelowHundred(hundred) + " Hundred");
    }

    if (number) {
      parts.push(numberBelowHundred(number));
    }

    return parts.join(" ");
  }

  function amountToWordsIndian(amount) {
    const safeAmount = Math.max(0, roundMoney(Number(amount) || 0));

    const rupees = Math.floor(safeAmount);
    const paise = Math.round((safeAmount - rupees) * 100);

    let result = numberToWordsIndian(rupees) + " Rupees";

    if (paise > 0) {
      result += " and " + numberToWordsIndian(paise) + " Paise";
    }

    return result + " Only";
  }

  function ensureAmountWordsElement() {
    let element = $("printInvoiceAmountWords");

    if (element) return element;

    const totalElement = $("printInvoiceGrandTotal");

    if (!totalElement) return null;

    const container =
      totalElement.closest(".inv-total-row") ||
      totalElement.closest(".inv-totals") ||
      totalElement.parentElement;

    if (!container || !container.parentElement) return null;

    element = document.createElement("div");
    element.id = "printInvoiceAmountWords";
    element.className = "invoice-amount-words";

    const label = document.createElement("strong");
    label.textContent = "Amount in Words: ";

    const value = document.createElement("span");
    value.id = "printInvoiceAmountWordsText";

    element.append(label, value);

    container.parentElement.insertBefore(
      element,
      container.nextSibling
    );

    return element;
  }

  function updateInvoiceAmountWords(amount) {
    const words = amountToWordsIndian(amount);
    const element = ensureAmountWordsElement();

    if (!element) return;

    const textElement = $("printInvoiceAmountWordsText");

    if (textElement) {
      textElement.textContent = words;
    } else {
      element.textContent = "Amount in Words: " + words;
    }

    element.hidden = false;
  }

  /* ---------------------------------------------------------
     3. Settings
     --------------------------------------------------------- */

  function settingsSections() {
    const settings = state.settings || {};
    const forms = settings.forms || {};

    return {
      business:
        settings.businessProfile ||
        settings.business ||
        settings.profile ||
        forms.businessProfileForm ||
        forms.businessProfile ||
        settings,

      invoice:
        settings.invoiceSettings ||
        settings.invoice ||
        forms.invoiceSettingsForm ||
        settings,

      tax:
        settings.taxSettings ||
        settings.tax ||
        forms.taxSettingsForm ||
        settings,

      payment:
        settings.paymentSettings ||
        settings.payment ||
        forms.paymentSettingsForm ||
        settings
    };
  }

  function booleanSetting(value) {
    return value === true ||
      value === 1 ||
      value === "true" ||
      value === "1";
  }

  function settingFlag(keys, fallback) {
    const sections = settingsSections();

    for (const source of [
      sections.invoice,
      sections.business,
      sections.tax,
      sections.payment
    ]) {
      for (const key of keys) {
        if (
          source &&
          source[key] !== null &&
          source[key] !== undefined &&
          source[key] !== ""
        ) {
          return booleanSetting(source[key]);
        }
      }
    }

    return fallback;
  }

  function getBusinessName() {
    const business = settingsSections().business;

    return textValue(firstValue(business, [
      "businessName",
      "name"
    ]) || "") || "Business Profile";
  }

  function getTaxSettings() {
    const tax = settingsSections().tax;

    const enabled = booleanSetting(firstValue(tax, [
      "taxEnabled",
      "enableTax",
      "enabled"
    ]));

    const rate = toNumber(firstValue(tax, [
      "taxRate",
      "rate",
      "taxPercentage"
    ]));

    return {
      enabled,
      rate: rate === null ? 0 : Math.min(100, Math.max(0, rate))
    };
  }

  function getDiscountSettings() {
    const tax = settingsSections().tax;

    const enabled = booleanSetting(firstValue(tax, [
      "discountEnabled",
      "enableDiscount"
    ]));

    const maximumPercent = toNumber(firstValue(tax, [
      "maximumDiscount",
      "maxDiscount",
      "maximumDiscountPercent"
    ]));

    return {
      enabled,
      maximumPercent: maximumPercent === null
        ? 0
        : Math.min(100, Math.max(0, maximumPercent))
    };
  }

  function getInvoicePrefix() {
    const configured = textValue(firstValue(
      settingsSections().invoice,
      ["invoicePrefix", "prefix"]
    ) || "");

    return configured.replace(/[^A-Za-z0-9-]/g, "") || "INV";
  }

  /* ---------------------------------------------------------
     4. Products and categories
     --------------------------------------------------------- */

  function productName(product) {
    return textValue(firstValue(product, [
      "productName",
      "name",
      "itemName",
      "title"
    ]) || "");
  }

  function productPrice(product) {
    const value = toNumber(firstValue(product, [
      "price",
      "unitPrice",
      "sellingPrice",
      "amount"
    ]));

    return value !== null && value >= 0 ? roundMoney(value) : null;
  }

  function categoryName(category) {
    return textValue(firstValue(category, [
      "categoryName",
      "name",
      "title"
    ]) || "");
  }

  function resolveCategory(product) {
    const categoryId = textValue(firstValue(product, [
      "categoryId",
      "categoryID",
      "categoryKey"
    ]) || "");

    const categoryText = textValue(firstValue(product, [
      "categoryName",
      "category"
    ]) || "");

    const match = state.categories.find((category) =>
      (categoryId && category._recordKey === categoryId) ||
      (
        categoryText &&
        categoryName(category).toLowerCase() === categoryText.toLowerCase()
      )
    );

    return match ? categoryName(match) : categoryText;
  }

  function populateProductSelect() {
    const select = $("productSelect");
    if (!select) return;

    const previouslySelected = select.value;
    select.replaceChildren();

    const firstOption = document.createElement("option");
    firstOption.value = "";

    if (!state.loaded.products) {
      firstOption.textContent = "Loading saved products...";
      select.appendChild(firstOption);
      select.disabled = true;
      return;
    }

    if (!state.loaded.categories) {
      firstOption.textContent = "Loading saved categories...";
      select.appendChild(firstOption);
      select.disabled = true;
      return;
    }

    const products = state.products.filter((product) =>
      recordIsActive(product) &&
      productName(product) &&
      productPrice(product) !== null &&
      productPrice(product) > 0
    );

    if (!products.length) {
      firstOption.textContent = "No saved products available";
      select.appendChild(firstOption);
      select.disabled = true;
      return;
    }

    firstOption.textContent = "Select a product";
    select.appendChild(firstOption);

    products.slice().sort((a, b) =>
      productName(a).localeCompare(productName(b))
    ).forEach((product) => {
      const option = document.createElement("option");
      option.value = product._recordKey;
      option.textContent =
        productName(product) + " — " + formatMoney(productPrice(product));
      select.appendChild(option);
    });

    select.disabled = false;

    if (
      previouslySelected &&
      products.some((product) =>
        product._recordKey === previouslySelected
      )
    ) {
      select.value = previouslySelected;
    }
  }

  function getSelectedProduct() {
    const select = $("productSelect");
    if (!select || !select.value) return null;

    return state.products.find((product) =>
      product._recordKey === select.value
    ) || null;
  }

  function addSavedProduct(event) {
    event.preventDefault();

    if (!state.ready || state.saving) return;

    const product = getSelectedProduct();
    const quantityInput = $("itemQuantity");
    const quantity = Number(quantityInput?.value);

    if (!product || !recordIsActive(product)) {
      setMessage("Select a valid saved product first.", "warning");
      return;
    }

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      setMessage("Enter a valid whole-number quantity.", "error");
      quantityInput?.focus();
      return;
    }

    const unitPrice = productPrice(product);

    if (unitPrice === null || unitPrice <= 0) {
      setMessage("This product does not have a valid saved price.", "error");
      return;
    }

    state.cart.push({
      itemId: "item-" + (++state.nextItemId),
      productId: product._recordKey,
      name: productName(product),
      category: resolveCategory(product),
      unitPrice,
      quantity,
      custom: false
    });

    $("productSelect").value = "";
    if (quantityInput) quantityInput.value = "1";

    setMessage("");
    renderCart();
  }

  /* ---------------------------------------------------------
     5. Custom items
     --------------------------------------------------------- */

  function addCustomItem(event) {
    event.preventDefault();

    if (!state.ready || state.saving) return;

    const name = textValue($("customItemName")?.value);
    const unitPrice = toNumber($("customItemPrice")?.value);
    const quantity = Number($("customItemQuantity")?.value);

    if (!name) {
      setMessage("Enter the custom item name.", "warning");
      $("customItemName")?.focus();
      return;
    }

    if (unitPrice === null || unitPrice <= 0) {
      setMessage("Enter a valid custom item price.", "error");
      $("customItemPrice")?.focus();
      return;
    }

    if (!Number.isSafeInteger(quantity) || quantity < 1) {
      setMessage("Enter a valid whole-number quantity.", "error");
      $("customItemQuantity")?.focus();
      return;
    }

    state.cart.push({
      itemId: "item-" + (++state.nextItemId),
      productId: null,
      name,
      category: "",
      unitPrice: roundMoney(unitPrice),
      quantity,
      custom: true
    });

    $("customItemForm")?.reset();
    if ($("customItemQuantity")) $("customItemQuantity").value = "1";

    setMessage("");
    renderCart();
  }

  function toggleCustomItem() {
    const panel = $("customItemPanel");
    const button = $("toggleCustomItemBtn");

    if (!panel || !button) return;

    const opening = panel.hidden;
    panel.hidden = !opening;
    button.setAttribute("aria-expanded", String(opening));

    if (opening) $("customItemName")?.focus();
  }

  /* ---------------------------------------------------------
     6. Discount and invoice totals
     --------------------------------------------------------- */

  function ensureDiscountInput() {
    const settings = getDiscountSettings();
    const form = $("invoiceForm");

    if (!form) return;

    let wrapper = $("invoiceDiscountField");

    if (!settings.enabled || settings.maximumPercent <= 0) {
      if (wrapper) wrapper.hidden = true;
      return;
    }

    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = "invoiceDiscountField";
      wrapper.className = "form-field";

      const label = document.createElement("label");
      label.htmlFor = "invoiceDiscountAmount";
      label.textContent = "Discount Amount (₹)";

      const input = document.createElement("input");
      input.id = "invoiceDiscountAmount";
      input.name = "discountAmount";
      input.type = "number";
      input.min = "0";
      input.step = "0.01";
      input.inputMode = "decimal";
      input.autocomplete = "off";
      input.addEventListener("input", renderCart);

      wrapper.append(label, input);

      const notes = $("invoiceNotes")?.closest(".form-field");

      if (notes) {
        form.insertBefore(wrapper, notes);
      } else {
        form.appendChild(wrapper);
      }
    }

    wrapper.hidden = false;
  }

  function getDiscountAmount(subtotal) {
    const settings = getDiscountSettings();
    const input = $("invoiceDiscountAmount");

    if (!settings.enabled || !input) return 0;

    const requested = toNumber(input.value);
    if (requested === null || requested <= 0 || subtotal <= 0) return 0;

    const maximum = subtotal * settings.maximumPercent / 100;

    return roundMoney(Math.min(requested, maximum, subtotal));
  }

  function calculateTotals() {
    const subtotal = roundMoney(state.cart.reduce(
      (total, item) => total + item.unitPrice * item.quantity,
      0
    ));

    const discount = getDiscountAmount(subtotal);
    const taxableAmount = roundMoney(Math.max(0, subtotal - discount));
    const taxSettings = getTaxSettings();

    const taxAmount = taxSettings.enabled
      ? roundMoney(taxableAmount * taxSettings.rate / 100)
      : 0;

    const beforeRounding = roundMoney(taxableAmount + taxAmount);

    const roundOffEnabled = settingFlag([
      "roundOffEnabled",
      "enableRoundOff",
      "roundOff"
    ], false);

    const grandTotal = roundOffEnabled
      ? Math.round(beforeRounding)
      : beforeRounding;

    return {
      subtotal,
      discount,
      taxEnabled: taxSettings.enabled,
      taxRate: taxSettings.enabled ? taxSettings.rate : 0,
      taxAmount,
      roundOffEnabled,
      roundOff: roundOffEnabled
        ? roundMoney(grandTotal - beforeRounding)
        : 0,
      grandTotal: roundMoney(grandTotal)
    };
  }

  function createTextCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "");
    row.appendChild(cell);
    return cell;
  }

  function removeCartItem(itemId) {
    if (state.saving) return;

    state.cart = state.cart.filter((item) => item.itemId !== itemId);
    renderCart();
  }

  function renderCart() {
    const body = $("invoiceItemsBody");
    if (!body) return;

    body.replaceChildren();

    if (!state.cart.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");

      cell.colSpan = 5;
      cell.className = "table-empty";
      cell.textContent = "No items added yet.";

      row.appendChild(cell);
      body.appendChild(row);
    } else {
      state.cart.forEach((item) => {
        const row = document.createElement("tr");

        createTextCell(row, item.name);
        createTextCell(row, formatMoney(item.unitPrice));
        createTextCell(row, String(item.quantity));
        createTextCell(
          row,
          formatMoney(roundMoney(item.unitPrice * item.quantity))
        );

        const actionCell = document.createElement("td");
        const button = document.createElement("button");

        button.type = "button";
        button.className = "btn btn-secondary btn-small";
        button.textContent = "Remove";
        button.disabled = state.saving;
        button.setAttribute("aria-label", "Remove " + item.name);
        button.addEventListener("click", () => removeCartItem(item.itemId));

        actionCell.appendChild(button);
        row.appendChild(actionCell);
        body.appendChild(row);
      });
    }

    setText(
      "itemCount",
      state.cart.length === 1
        ? "1 item added"
        : state.cart.length + " items added"
    );

    const totals = calculateTotals();

    setText("invoiceSubtotal", formatMoney(totals.subtotal));
    setText("invoiceDiscount", formatMoney(totals.discount));
    setText("invoiceTax", formatMoney(totals.taxAmount));
    setText("invoiceGrandTotal", formatMoney(totals.grandTotal));

    const discountRow = $("discountTotalRow");
    const taxRow = $("taxTotalRow");

    if (discountRow) {
      discountRow.hidden = totals.discount <= 0 ||
        !settingFlag(["showDiscount", "showInvoiceDiscount"], true);
    }

    if (taxRow) {
      taxRow.hidden = !totals.taxEnabled ||
        !settingFlag(["showTax", "showInvoiceTax"], true);
    }

    setText(
      "invoiceTaxLabel",
      "GST (" + totals.taxRate.toFixed(2).replace(/\.00$/, "") + "%)"
    );

    const submitButton = $("generateInvoiceBtn");

    if (submitButton) {
      submitButton.disabled =
        !state.ready || state.saving || state.cart.length === 0;
    }
  }

  function setEditingDisabled(disabled) {
    [
      "productSelect",
      "itemQuantity",
      "addItemBtn",
      "toggleCustomItemBtn",
      "clearItemsBtn",
      "resetInvoiceBtn",
      "customerName",
      "customerPhone",
      "tableNumber",
      "paymentMethod",
      "paymentStatus",
      "invoiceDiscountAmount",
      "invoiceNotes"
    ].forEach((id) => {
      const node = $(id);
      if (node) node.disabled = disabled;
    });

    $("customItemPanel")?.querySelectorAll("input, button").forEach((node) => {
      node.disabled = disabled;
    });

    renderCart();
  }

  function clearCart() {
    if (state.saving) return;

    state.cart = [];
    $("addInvoiceItemForm")?.reset();
    $("customItemForm")?.reset();

    if ($("itemQuantity")) $("itemQuantity").value = "1";
    if ($("customItemQuantity")) $("customItemQuantity").value = "1";
    if ($("invoiceDiscountAmount")) $("invoiceDiscountAmount").value = "";

    setMessage("");
    renderCart();
  }

  /* ---------------------------------------------------------
     7. Invoice number reservation
     --------------------------------------------------------- */

  async function reserveInvoiceNumber(date) {
    const year = String(date.getFullYear());

    const reference = state.api.ref(
      state.db,
      PATHS.counters + "/" + year
    );

    const result = await state.api.runTransaction(
      reference,
      function (currentValue) {
        const current = Number(currentValue) || 0;

        if (!Number.isSafeInteger(current) || current < 0) return;

        return current + 1;
      },
      { applyLocally: false }
    );

    if (!result.committed || !result.snapshot) {
      throw new Error("Unable to reserve an invoice number.");
    }

    const sequence = Number(result.snapshot.val());

    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("The invoice counter returned an invalid value.");
    }

    return getInvoicePrefix() + "-" + year + "-" +
      String(sequence).padStart(4, "0");
  }

  /* ---------------------------------------------------------
     8. Business profile and invoice footer
     --------------------------------------------------------- */

  function renderOptionalText(id, value, enabled) {
    const node = $(id);
    if (!node) return;

    const content = textValue(value);

    node.textContent = content;
    node.hidden = !enabled || !content;
  }

  function applyFormFieldVisibility() {
    const invoice = settingsSections().invoice;

    const fields = [
      {
        id: "customerName",
        keys: ["showCustomerName", "showBillTo"],
        fallback: true,
        required: true
      },
      {
        id: "customerPhone",
        keys: ["showCustomerPhone"],
        fallback: true,
        required: false
      },
      {
        id: "tableNumber",
        keys: ["showTableNumber"],
        fallback: true,
        required: false
      },
      {
        id: "paymentMethod",
        keys: ["showPaymentMethod"],
        fallback: true,
        required: true
      },
      {
        id: "paymentStatus",
        keys: ["showPaymentStatus"],
        fallback: true,
        required: true
      },
      {
        id: "invoiceNotes",
        keys: ["showNotes", "showInvoiceNotes"],
        fallback: true,
        required: false
      }
    ];

    fields.forEach((field) => {
      const input = $(field.id);
      if (!input) return;

      let visible = field.fallback;

      for (const key of field.keys) {
        if (
          invoice &&
          invoice[key] !== null &&
          invoice[key] !== undefined &&
          invoice[key] !== ""
        ) {
          visible = booleanSetting(invoice[key]);
          break;
        }
      }

      const wrapper = input.closest(".form-field");
      if (wrapper) wrapper.hidden = !visible;

      input.required = visible && field.required;
    });

    const group = $("customerName")?.closest(".invoice-customer-fields");

    if (group) {
      group.hidden = !fields.some((field) => {
        const input = $(field.id);
        return input && !input.closest(".form-field")?.hidden;
      });
    }
  }

  function renderInvoiceFooterContent() {
    const invoice = settingsSections().invoice;

    const footer = textValue(storedValue(invoice, [
      "invoiceFooter",
      "footerText",
      "footer"
    ]));

    const thankYou = textValue(storedValue(invoice, [
      "thankYouMessage",
      "invoiceThankYouMessage"
    ]));

    const termsLine1 = textValue(storedValue(invoice, [
      "termsLine1",
      "invoiceTermsLine1"
    ]));

    const termsLine2 = textValue(storedValue(invoice, [
      "termsLine2",
      "invoiceTermsLine2"
    ]));

    const signatory = textValue(storedValue(invoice, [
      "authorisedSignatory",
      "authorizedSignatory",
      "signatureLabel"
    ]));

    renderOptionalText(
      "printThankYouMessage",
      thankYou,
      settingFlag(["showThankYouMessage", "showThankYou"], true)
    );

    const termsContainer = $("printInvoiceFooterText");

    if (termsContainer) {
      termsContainer.replaceChildren();

      [
        {
          value: termsLine1,
          visible: settingFlag(["showTermsLine1", "showTerms"], true)
        },
        {
          value: termsLine2,
          visible: settingFlag(["showTermsLine2", "showTerms"], true)
        },
        {
          value: footer,
          visible: settingFlag(["showInvoiceFooter", "showTerms"], true)
        }
      ].forEach((line) => {
        if (!line.value || !line.visible) return;

        const paragraph = document.createElement("p");
        paragraph.textContent = line.value;
        termsContainer.appendChild(paragraph);
      });

      termsContainer.hidden = termsContainer.childElementCount === 0;
    }

    renderOptionalText(
      "printSignatureLabel",
      signatory,
      settingFlag(["showSignature", "showAuthorisedSignatory"], true)
    );

    const signature = $("printSignatureSection");

    if (signature) {
      signature.hidden = !signatory ||
        !settingFlag(["showSignature", "showAuthorisedSignatory"], true);
    }
  }

  function renderInvoiceBusinessDetails() {
    const sections = settingsSections();
    const business = sections.business;
    const name = getBusinessName();

    const tagline = textValue(firstValue(business, [
      "businessTagline",
      "tagline",
      "description"
    ]) || "");

    const address = textValue(firstValue(business, [
      "businessAddress",
      "address"
    ]) || "");

    const phone = textValue(firstValue(business, [
      "businessPhone",
      "phone",
      "contactPhone"
    ]) || "");

    const email = textValue(firstValue(business, [
      "businessEmail",
      "email"
    ]) || "");

    const website = textValue(firstValue(business, [
      "website",
      "businessWebsite",
      "websiteUrl"
    ]) || "");

    const logoURL = textValue(firstValue(business, [
      "businessLogoUrl",
      "logoImageUrl",
      "logoUrl",
      "logo"
    ]) || "");

    const gstin = textValue(firstValue(business, [
      "gstin",
      "GSTIN",
      "gstNumber",
      "gstNo"
    ]) || "");

    const fssai = textValue(firstValue(business, [
      "fssai",
      "fssaiNumber",
      "fssaiLicense",
      "fssaiLicenseNumber"
    ]) || "");

    setText("printBusinessName", name);

    renderOptionalText(
      "printBusinessTagline",
      tagline,
      settingFlag(["showTagline", "showBusinessTagline"], true)
    );

    renderOptionalText(
      "printBusinessAddress",
      address,
      settingFlag(["showBusinessAddress"], true)
    );

    const contactParts = [];

    if (phone && settingFlag(["showBusinessPhone", "showPhone"], true)) {
      contactParts.push(phone);
    }

    if (email && settingFlag(["showBusinessEmail", "showEmail"], true)) {
      contactParts.push(email);
    }

    renderOptionalText("printBusinessContact", contactParts.join(" | "), true);

    renderOptionalText(
      "printBusinessWebsite",
      website,
      settingFlag(["showWebsite", "showBusinessWebsite"], true)
    );

    const logo = $("printBusinessLogo");

    if (logo) {
      const showLogo = Boolean(logoURL) &&
        settingFlag(["showLogo", "showBusinessLogo"], true);

      if (showLogo) {
        logo.hidden = false;
        logo.alt = name + " Logo";

        logo.onerror = function () {
          logo.hidden = true;
          logo.removeAttribute("src");
        };

        logo.src = logoURL;
      } else {
        logo.hidden = true;
        logo.removeAttribute("src");
      }
    }

    const taxIds = [];

    if (gstin && settingFlag(["showGSTIN", "showGstin"], true)) {
      taxIds.push("GSTIN: " + gstin);
    }

    if (fssai && settingFlag(["showFSSAI", "showFssai"], true)) {
      taxIds.push("FSSAI: " + fssai);
    }

    renderOptionalText(
      "printBusinessTaxIds",
      taxIds.join(" | "),
      taxIds.length > 0
    );

    renderInvoiceFooterContent();
    applyFormFieldVisibility();
    ensureDiscountInput();
    updatePaymentQRVisibility();
  }

  /* ---------------------------------------------------------
     9. Customer and payment details
     --------------------------------------------------------- */

  function normalizePaymentMethod(value) {
    const raw = textValue(value);
    if (!raw) return "Cash";

    const labels = {
      cash: "Cash",
      upi: "UPI",
      card: "Card",
      "credit card": "Credit Card",
      "debit card": "Debit Card",
      "bank transfer": "Bank Transfer",
      "net banking": "Net Banking",
      other: "Other"
    };

    return labels[raw.toLowerCase()] || raw;
  }

  function getInvoiceFormDetails() {
    return {
      customerName:
        textValue($("customerName")?.value) || "Walk-in Customer",

      customerPhone: textValue($("customerPhone")?.value),
      tableNumber: textValue($("tableNumber")?.value),

      paymentMethod: normalizePaymentMethod(
        $("paymentMethod")?.value || "Cash"
      ),

      paymentStatus: textValue($("paymentStatus")?.value || "Paid"),
      notes: textValue($("invoiceNotes")?.value)
    };
  }

  /* ---------------------------------------------------------
     10. Static restaurant-location QR visibility
     --------------------------------------------------------- */

  function updatePaymentQRVisibility() {
    const section = $("printQrSection");
    if (!section) return;

    /*
     * Static location QR only:
     * business-location-qr.png -> business-location.html
     * No QR generation and no invoice verification.
     */
    section.hidden = !settingFlag([
      "showBusinessLocationQR",
      "showQR",
      "showQRCode"
    ], true);
  }

  /* ---------------------------------------------------------
     11. Invoice preview
     --------------------------------------------------------- */

  function createInvoicePrintRow(item, index) {
    const row = document.createElement("div");
    row.className = "inv-row";

    [
      ["col-num", String(index + 1)],
      ["col-item", item.name],
      ["col-qty", String(item.quantity)],
      ["col-rate", formatMoney(item.unitPrice)],
      ["col-amt", formatMoney(item.lineTotal)]
    ].forEach(([className, value]) => {
      const cell = document.createElement("span");
      cell.className = className;
      cell.textContent = value;
      row.appendChild(cell);
    });

    return row;
  }

  function renderSavedInvoice(invoice) {
    const preview = $("invoicePreviewSection");
    if (!preview) return;

    setText("printInvoiceNumber", invoice.invoiceNumber);
    setText("printInvoiceDate", displayDate(invoice.invoiceDate));
    setText("printInvoiceTime", displayTime(invoice.invoiceTime));
    setText("printCustomerName", invoice.customerName);

    renderOptionalText(
      "printCustomerPhone",
      invoice.customerPhone,
      settingFlag(["showCustomerPhone"], true)
    );

    renderOptionalText(
      "printTableNumber",
      invoice.tableNumber,
      settingFlag(["showTableNumber"], true)
    );

    const showMethod = settingFlag(["showPaymentMethod"], true);
    const showStatus = settingFlag(["showPaymentStatus"], true);

    setText("printPaymentMethod", invoice.paymentMethod);
    setText("printPaymentStatus", invoice.paymentStatus);

    const methodRow = $("printPaymentMethodRow");
    const statusRow = $("printPaymentStatusRow");

    if (methodRow) methodRow.hidden = !showMethod;
    if (statusRow) statusRow.hidden = !showStatus;

    const paymentBlock = methodRow?.closest(".inv-payment-block");

    if (paymentBlock) {
      paymentBlock.hidden = !showMethod && !showStatus;
    }

    setText("printInvoiceSubtotal", formatMoney(invoice.subtotal));
    setText("printInvoiceDiscount", formatMoney(invoice.discount));
    setText("printInvoiceTax", formatMoney(invoice.taxAmount));
    setText("printInvoiceRoundOff", formatMoney(invoice.roundOff || 0));
    setText("printInvoiceGrandTotal", formatMoney(invoice.grandTotal));

    /* Dynamic amount in words for the saved invoice */
    updateInvoiceAmountWords(invoice.grandTotal);

    setText(
      "printInvoiceTaxLabel",
      "GST (" + Number(invoice.taxRate || 0)
        .toFixed(2).replace(/\.00$/, "") + "%)"
    );

    const discountRow = $("printDiscountRow");
    const taxRow = $("printTaxRow");
    const roundOffRow = $("printRoundOffRow");

    if (discountRow) {
      discountRow.hidden = invoice.discount <= 0 ||
        !settingFlag(["showDiscount", "showInvoiceDiscount"], true);
    }

    if (taxRow) {
      taxRow.hidden = !invoice.taxEnabled ||
        !settingFlag(["showTax", "showInvoiceTax"], true);
    }

    if (roundOffRow) {
      roundOffRow.hidden = !invoice.roundOffEnabled ||
        !settingFlag(["showRoundOff"], true);
    }

    const notes = textValue(invoice.notes);
    const notesSection = $("printInvoiceNotesSection");

    if (notesSection) {
      notesSection.hidden = !notes ||
        !settingFlag(["showNotes", "showInvoiceNotes"], true);
    }

    setText("printInvoiceNotes", notes);

    const body = $("printInvoiceItemsBody");

    if (body) {
      body.replaceChildren();

      invoice.items.forEach((item, index) => {
        body.appendChild(createInvoicePrintRow(item, index));
      });
    }

    renderInvoiceBusinessDetails();

    preview.hidden = false;
    updatePaymentQRVisibility();

    setMessage(
      "Invoice Recorded Successfully. Preview Is Ready.",
      "success"
    );

    setPageStatus(
      "Invoice Saved To The Business Database.",
      "connected"
    );

    setText("invoiceFooterStatus", "Invoice Recorded");

    preview.scrollIntoView({
      behavior: window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches ? "auto" : "smooth",
      block: "start"
    });
  }

  /* ---------------------------------------------------------
     12. Validation and Firebase invoice saving
     --------------------------------------------------------- */

  function validateCart() {
    if (!state.cart.length) {
      throw new Error(
        "Add at least one item before recording the invoice."
      );
    }

    for (const item of state.cart) {
      if (
        !item.name ||
        !Number.isSafeInteger(item.quantity) ||
        item.quantity < 1
      ) {
        throw new Error("One or more invoice items are invalid.");
      }

      if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
        throw new Error("An invoice item has an invalid unit price.");
      }
    }
  }

  async function saveInvoice(event) {
    event.preventDefault();

    if (state.saving) return;

    try {
      if (!state.ready) {
        throw new Error(
          "Invoice data is still loading. Try again shortly."
        );
      }

      ensureOwnerAuthorized();
      validateCart();

      const tax = getTaxSettings();

      if (
        tax.enabled &&
        (!Number.isFinite(tax.rate) || tax.rate < 0 || tax.rate > 100)
      ) {
        throw new Error(
          "Check the tax rate in Settings before recording an invoice."
        );
      }

      const details = getInvoiceFormDetails();

      if (
        settingFlag(["showCustomerName", "showBillTo"], true) &&
        !$("customerName")?.closest(".form-field")?.hidden &&
        !details.customerName
      ) {
        throw new Error("Enter the customer name.");
      }

      state.saving = true;

      setMessage("");
      setPageStatus("Recording Invoice...", "warning");
      setEditingDisabled(true);

      const submitLabel = $("invoiceSubmitLabel");
      if (submitLabel) {
        submitLabel.textContent = "Recording Invoice...";
      }

      const createdAt = new Date();
      const totals = calculateTotals();
      const invoiceNumber = await reserveInvoiceNumber(createdAt);

      ensureOwnerAuthorized();

      const items = state.cart.map((item) => ({
        productId: item.productId,
        name: item.name,
        category: item.category || "",
        quantity: item.quantity,
        unitPrice: roundMoney(item.unitPrice),
        lineTotal: roundMoney(item.unitPrice * item.quantity),
        custom: Boolean(item.custom)
      }));

      const invoiceRecord = {
        ownerUid: OWNER_UID,

        invoiceNumber: invoiceNumber,
        invoiceDate: localDateString(createdAt),
        invoiceTime: localTimeString(createdAt),
        createdAt: createdAt.toISOString(),
        createdAtMs: createdAt.getTime(),

        customerName: details.customerName,
        customerPhone: details.customerPhone,
        tableNumber: details.tableNumber,

        paymentMethod: details.paymentMethod,
        paymentStatus: details.paymentStatus,

        items: items,

        subtotal: totals.subtotal,
        discount: totals.discount,
        taxEnabled: totals.taxEnabled,
        taxRate: totals.taxRate,
        taxAmount: totals.taxAmount,
        roundOffEnabled: totals.roundOffEnabled,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,

        notes: details.notes,
        recordStatus: "valid"
      };

      /*
       * Save only the invoice record.
       * No public invoice verification record is created.
       */
      const invoiceListRef = state.api.ref(
        state.db,
        PATHS.invoices
      );

      const newInvoiceRef = state.api.push(invoiceListRef);

      if (!newInvoiceRef || !newInvoiceRef.key) {
        throw new Error(
          "Unable to create a database invoice reference."
        );
      }

      ensureOwnerAuthorized();

      await state.api.set(newInvoiceRef, invoiceRecord);

      invoiceRecord._recordKey = newInvoiceRef.key;

      renderSavedInvoice(invoiceRecord);

      state.cart = [];
      renderCart();

      $("addInvoiceItemForm")?.reset();
      $("customItemForm")?.reset();

      if ($("itemQuantity")) $("itemQuantity").value = "1";
      if ($("customItemQuantity")) $("customItemQuantity").value = "1";
      if ($("invoiceDiscountAmount")) $("invoiceDiscountAmount").value = "";

      setText("itemCount", "0 Items Added");

    } catch (error) {
      console.error("Invoice recording failed:", {
        code: error && error.code
          ? error.code
          : "invoice-save-error",
        message: error instanceof Error
          ? error.message
          : "Unknown Error"
      });

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable To Record The Invoice. Please Try Again.",
        "error"
      );

      setPageStatus(
        "Invoice Was Not Confirmed As Saved.",
        "error"
      );

    } finally {
      state.saving = false;
      setEditingDisabled(false);

      const submitLabel = $("invoiceSubmitLabel");
      if (submitLabel) {
        submitLabel.textContent = "Record / Save Invoice";
      }

      renderCart();
    }
  }

  /* ---------------------------------------------------------
     13. Realtime Database subscriptions
     --------------------------------------------------------- */

  function subscribe(path, callback, errorCallback) {
    const reference = state.api.ref(state.db, path);

    const unsubscribe = state.api.onValue(
      reference,
      callback,
      errorCallback
    );

    state.subscriptions.push(unsubscribe);
  }

  function onProducts(snapshot) {
    state.products = recordEntries(
      snapshot.exists() ? snapshot.val() : null
    );

    state.loaded.products = true;
    resolveInitialSource(PATHS.products);

    populateProductSelect();
    renderCart();
    checkReady();
  }

  function onCategories(snapshot) {
    state.categories = recordEntries(
      snapshot.exists() ? snapshot.val() : null
    );

    state.loaded.categories = true;
    resolveInitialSource(PATHS.categories);

    populateProductSelect();
    renderCart();
    checkReady();
  }

  function onSettings(snapshot) {
    state.settings = snapshot.exists()
      ? snapshot.val()
      : {};

    state.loaded.settings = true;
    resolveInitialSource(PATHS.settings);

    renderInvoiceBusinessDetails();
    renderCart();
    checkReady();
  }

  function onReadError(path, error) {
    console.error("Invoice data read failed:", {
      path: path,
      code: error && error.code ? error.code : "unknown"
    });

    resolveInitialSource(path);

    setPageStatus(
      "Unable To Load Required Billing Data. Check The Database Connection And Access Rules.",
      "error"
    );

    setMessage(
      "Required Data Could Not Be Loaded. Invoice Recording Is Unavailable.",
      "error"
    );

    state.ready = false;
    renderCart();

    revealInvoicePageWhenReady();
  }

  function checkReady() {
    state.ready = Object.values(state.loaded).every(Boolean);

    if (state.ready) {
      setPageStatus("Billing Data Is Ready.", "connected");
      setText("invoiceFooterStatus", "Billing Data Loaded");
    }

    renderCart();
    revealInvoicePageWhenReady();
  }

  /* ---------------------------------------------------------
     14. Manual refresh
     --------------------------------------------------------- */

  async function refreshInvoicePage() {
    if (state.disposed || !state.db || !state.api) {
      throw new Error("Invoice page is not ready to refresh.");
    }

    if (state.saving) {
      throw new Error(
        "An invoice is being saved. Refresh after the save completes."
      );
    }

    ensureOwnerAuthorized();

    if (typeof state.api.get !== "function") {
      throw new Error("Firebase data refresh is unavailable.");
    }

    setPageStatus("Refreshing billing data...", "warning");

    const sources = [
      PATHS.products,
      PATHS.categories,
      PATHS.settings
    ];

    const snapshots = await Promise.all(
      sources.map(function (path) {
        return state.api.get(
          state.api.ref(state.db, path)
        );
      })
    );

    if (state.disposed) return;

    const selectedProductId = $("productSelect")?.value || "";

    state.products = recordEntries(
      snapshots[0].exists() ? snapshots[0].val() : null
    );

    state.categories = recordEntries(
      snapshots[1].exists() ? snapshots[1].val() : null
    );

    state.settings = snapshots[2].exists()
      ? snapshots[2].val() || {}
      : {};

    state.loaded.products = true;
    state.loaded.categories = true;
    state.loaded.settings = true;

    populateProductSelect();

    if (
      selectedProductId &&
      state.products.some(function (product) {
        return product._recordKey === selectedProductId &&
          recordIsActive(product);
      })
    ) {
      $("productSelect").value = selectedProductId;
    }

    renderInvoiceBusinessDetails();
    checkReady();

    setPageStatus("Billing data refreshed successfully.", "connected");
    setText("invoiceFooterStatus", "Billing Data Refreshed");
  }

  /* ---------------------------------------------------------
     15. Reset, close and print
     --------------------------------------------------------- */

  function resetInvoice() {
    if (state.saving) return;

    clearCart();

    const preview = $("invoicePreviewSection");
    if (preview) preview.hidden = true;

    $("invoiceForm")?.reset();

    if ($("customerName")) {
      $("customerName").value = "Walk-in Customer";
    }

    if ($("paymentMethod")) {
      $("paymentMethod").value = "Cash";
    }

    if ($("paymentStatus")) {
      $("paymentStatus").value = "Paid";
    }

    if ($("invoiceDiscountAmount")) {
      $("invoiceDiscountAmount").value = "";
    }

    applyFormFieldVisibility();
    setMessage("");

    setPageStatus(
      state.ready ? "Billing Data Is Ready." : "Loading Billing Data.",
      state.ready ? "connected" : "warning"
    );
  }

  function closePreview() {
    const preview = $("invoicePreviewSection");
    if (preview) preview.hidden = true;
  }

  function printInvoice() {
    const preview = $("invoicePreviewSection");

    if (!preview || preview.hidden) {
      setMessage(
        "Record An Invoice Before Printing.",
        "warning"
      );
      return;
    }

    const printExport = window.restaurantPrintExport;

    if (
      printExport &&
      typeof printExport.print === "function"
    ) {
      printExport.print();
      return;
    }

    // Fallback if the separate export module is unavailable.
    window.print();
  }

  /* ---------------------------------------------------------
     16. Initialize
     --------------------------------------------------------- */

  async function initialize() {
    try {
      setPageStatus("Checking Owner Session...", "warning");

      const access = window.restaurantAccess;

      if (!access || !access.readyPromise) {
        throw new Error("Owner Authorization Is Unavailable.");
      }

      const authorized = await access.readyPromise;

      if (
        !authorized ||
        !access.authorized ||
        !access.user ||
        access.user.uid !== OWNER_UID
      ) {
        throw new Error(
          "Only The Authorized Owner May Create Invoices."
        );
      }

      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.readyPromise) {
        throw new Error("Firebase Configuration Is Unavailable.");
      }

      const ready = await firebase.readyPromise;

      if (!ready || !firebase.ready) {
        throw new Error(
          firebase.error?.message || "Firebase Initialization Failed."
        );
      }

      const connected = getFirebase();

      state.db = connected.db;
      state.api = connected.api;

      if (
        typeof state.api.ref !== "function" ||
        typeof state.api.onValue !== "function" ||
        typeof state.api.get !== "function" ||
        typeof state.api.push !== "function" ||
        typeof state.api.set !== "function" ||
        typeof state.api.runTransaction !== "function"
      ) {
        throw new Error(
          "Required Realtime Database methods are unavailable."
        );
      }

      if (
        ui &&
        typeof ui.registerPageRefresh === "function"
      ) {
        state.unregisterPageRefresh =
          ui.registerPageRefresh(refreshInvoicePage);
      }

      subscribe(PATHS.products, onProducts, (error) =>
        onReadError(PATHS.products, error)
      );

      subscribe(PATHS.categories, onCategories, (error) =>
        onReadError(PATHS.categories, error)
      );

      subscribe(PATHS.settings, onSettings, (error) =>
        onReadError(PATHS.settings, error)
      );

    } catch (error) {
      state.ready = false;

      finishInvoiceLoadingImmediately();

      console.error("Invoice page initialization failed:", error);

      setPageStatus(
        error instanceof Error
          ? error.message
          : "Invoice Page Initialization Failed.",
        "error"
      );

      setMessage(
        "Invoice Creation Is Unavailable Until Initialization Succeeds.",
        "error"
      );
    }
  }

  /* ---------------------------------------------------------
     17. Event handlers
     --------------------------------------------------------- */

  $("addInvoiceItemForm")?.addEventListener("submit", addSavedProduct);
  $("customItemForm")?.addEventListener("submit", addCustomItem);
  $("toggleCustomItemBtn")?.addEventListener("click", toggleCustomItem);
  $("clearItemsBtn")?.addEventListener("click", clearCart);
  $("resetInvoiceBtn")?.addEventListener("click", resetInvoice);
  $("invoiceForm")?.addEventListener("submit", saveInvoice);
  $("closeInvoicePreviewBtn")?.addEventListener("click", closePreview);
  $("printInvoiceBtn")?.addEventListener("click", printInvoice);

  $("productSelect")?.addEventListener("change", () => setMessage(""));

  if ($("customerName") && !$("customerName").value.trim()) {
    $("customerName").value = "Walk-in Customer";
  }

  if ($("paymentMethod") && !$("paymentMethod").value) {
    $("paymentMethod").value = "Cash";
  }

  if ($("paymentStatus") && !$("paymentStatus").value) {
    $("paymentStatus").value = "Paid";
  }

  updatePaymentQRVisibility();
  renderCart();
  initialize();

  /* ---------------------------------------------------------
     18. Cleanup
     --------------------------------------------------------- */

  window.addEventListener("pagehide", function () {
    state.disposed = true;
    finishInvoiceLoadingImmediately();

    state.subscriptions.forEach((unsubscribe) => {
      try {
        if (typeof unsubscribe === "function") unsubscribe();
      } catch (_) {
        console.warn("Invoice subscription cleanup failed.");
      }
    });

    state.subscriptions = [];

    if (typeof state.unregisterPageRefresh === "function") {
      state.unregisterPageRefresh();
      state.unregisterPageRefresh = null;
    }
  });

})();
