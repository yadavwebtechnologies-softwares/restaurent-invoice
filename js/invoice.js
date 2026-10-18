/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Invoice Creation, Calculation, Saving and Preview
   Database root: restaurantBilling/
   Reference-aligned invoice layout
   No demo invoices, fake products or embedded secrets
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

  const $ = function (id) {
    return document.getElementById(id);
  };

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
    ready: false,
    saving: false,
    disposed: false,
    nextItemId: 1
  };

  const ui = window.restaurantUI;

  /* ---------------------------------------------------------
     1. Shared helpers
     --------------------------------------------------------- */

  function setText(id, value) {
    const node = $(id);
    if (!node) return;

    node.textContent =
      value === null || value === undefined ? "" : String(value);
  }

  function setMessage(message, type) {
    const node = $("invoiceMessage");
    if (!node) return;

    node.textContent = message || "";

    node.classList.remove(
      "is-success",
      "is-error",
      "is-warning"
    );

    if (type) {
      node.classList.add("is-" + type);
    }
  }

  function setPageStatus(message, type) {
    const node = $("invoicePageStatus");
    if (!node) return;

    node.textContent = message || "";

    node.classList.remove(
      "is-connected",
      "is-error",
      "is-warning"
    );

    if (type === "connected") {
      node.classList.add("is-connected");
    } else if (type === "error") {
      node.classList.add("is-error");
    } else if (type === "warning") {
      node.classList.add("is-warning");
    }
  }

  function setFooterStatus(message) {
    setText("invoiceFooterStatus", message);
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

  function recordEntries(data) {
    if (!data || typeof data !== "object") {
      return [];
    }

    if (Array.isArray(data)) {
      return data
        .map(function (record, index) {
          if (!record || typeof record !== "object") return null;

          return {
            ...record,
            _recordKey: record._recordKey || String(index)
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

    if (Number.isNaN(date.getTime())) {
      return textValue(value);
    }

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

  function newLocalId() {
    state.nextItemId += 1;
    return "item-" + state.nextItemId;
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

  /* ---------------------------------------------------------
     2. Settings readers
     --------------------------------------------------------- */

  function settingsSections() {
    const settings = state.settings || {};

    return {
      business:
        settings.businessProfile ||
        settings.business ||
        settings.profile ||
        settings.forms?.businessProfileForm ||
        settings.forms?.businessProfile ||
        settings,

      invoice:
        settings.invoiceSettings ||
        settings.invoice ||
        settings.forms?.invoiceSettingsForm ||
        settings,

      tax:
        settings.taxSettings ||
        settings.tax ||
        settings.forms?.taxSettingsForm ||
        settings,

      payment:
        settings.paymentSettings ||
        settings.payment ||
        settings.forms?.paymentSettingsForm ||
        settings
    };
  }

  function booleanSetting(value) {
    return value === true ||
      value === 1 ||
      value === "true" ||
      value === "1";
  }

  /*
   * Reads an explicit display preference from Settings.
   * When no preference exists, the supplied default is used.
   * Settings-page switches must save matching preference keys
   * before they can control additional fields.
   */
  function settingFlag(keys, fallback) {
    const sections = settingsSections();

    const sources = [
      sections.invoice,
      sections.business,
      sections.tax,
      sections.payment
    ];

    for (const source of sources) {
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

  function getTaxSettings() {
    const sections = settingsSections();

    const taxEnabled = booleanSetting(
      firstValue(sections.tax, [
        "taxEnabled",
        "enabled",
        "enableTax"
      ])
    );

    const taxRate = toNumber(
      firstValue(sections.tax, [
        "taxRate",
        "rate",
        "taxPercentage"
      ])
    );

    return {
      enabled: taxEnabled,
      rate: taxRate === null
        ? 0
        : Math.min(100, Math.max(0, taxRate))
    };
  }

  function getDiscountSettings() {
    const sections = settingsSections();

    const enabled = booleanSetting(
      firstValue(sections.tax, [
        "discountEnabled",
        "enableDiscount"
      ])
    );

    const maximumPercent = toNumber(
      firstValue(sections.tax, [
        "maximumDiscount",
        "maxDiscount",
        "maximumDiscountPercent"
      ])
    );

    return {
      enabled: enabled,
      maximumPercent: maximumPercent === null
        ? 0
        : Math.min(100, Math.max(0, maximumPercent))
    };
  }

  function getInvoicePrefix() {
    const sections = settingsSections();

    const configured = textValue(
      firstValue(sections.invoice, [
        "invoicePrefix",
        "prefix"
      ]) || ""
    );

    const normalized = configured.replace(/[^A-Za-z0-9-]/g, "");

    return normalized || "INV";
  }

  /* ---------------------------------------------------------
     3. Product loading and selection
     --------------------------------------------------------- */

  function productName(product) {
    return textValue(
      firstValue(product, [
        "productName",
        "name",
        "itemName",
        "title"
      ]) || ""
    );
  }

  function productPrice(product) {
    const value = toNumber(
      firstValue(product, [
        "price",
        "unitPrice",
        "sellingPrice",
        "amount"
      ])
    );

    return value !== null && value >= 0
      ? roundMoney(value)
      : null;
  }

  function categoryName(category) {
    return textValue(
      firstValue(category, [
        "categoryName",
        "name",
        "title"
      ]) || ""
    );
  }

  function resolveCategory(product) {
    const categoryId = textValue(
      firstValue(product, [
        "categoryId",
        "categoryID",
        "categoryKey"
      ]) || ""
    );

    const categoryText = textValue(
      firstValue(product, [
        "categoryName",
        "category"
      ]) || ""
    );

    const match = state.categories.find(function (category) {
      return (
        (categoryId && category._recordKey === categoryId) ||
        (categoryText &&
          categoryName(category).toLowerCase() ===
            categoryText.toLowerCase())
      );
    });

    return match ? categoryName(match) : categoryText;
  }

  function populateProductSelect() {
    const select = $("productSelect");
    if (!select) return;

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

    const availableProducts = state.products.filter(function (product) {
      return recordIsActive(product) &&
        productName(product) &&
        productPrice(product) !== null;
    });

    if (!availableProducts.length) {
      firstOption.textContent = "No saved products available";
      select.appendChild(firstOption);
      select.disabled = true;
      return;
    }

    firstOption.textContent = "Select a product";
    select.appendChild(firstOption);

    availableProducts
      .slice()
      .sort(function (a, b) {
        return productName(a).localeCompare(productName(b));
      })
      .forEach(function (product) {
        const option = document.createElement("option");
        option.value = product._recordKey;
        option.textContent =
          productName(product) + " — " +
          formatMoney(productPrice(product));

        select.appendChild(option);
      });

    select.disabled = false;
  }

  function getSelectedProduct() {
    const select = $("productSelect");

    if (!select || !select.value) return null;

    return state.products.find(function (product) {
      return product._recordKey === select.value;
    }) || null;
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
      itemId: newLocalId(),
      productId: product._recordKey,
      name: productName(product),
      category: resolveCategory(product),
      unitPrice: unitPrice,
      quantity: quantity,
      custom: false
    });

    /*
     * Do not replace the select's textContent here:
     * doing so would remove all product options.
     */
    const productSelect = $("productSelect");
    if (productSelect) productSelect.value = "";

    if (quantityInput) quantityInput.value = "1";

    setMessage("");
    renderCart();
  }

  /* ---------------------------------------------------------
     4. Custom items
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
      itemId: newLocalId(),
      productId: null,
      name: name,
      category: "",
      unitPrice: roundMoney(unitPrice),
      quantity: quantity,
      custom: true
    });

    $("customItemForm")?.reset();

    const customQuantity = $("customItemQuantity");
    if (customQuantity) customQuantity.value = "1";

    setMessage("");
    renderCart();
  }

  function toggleCustomItem() {
    const panel = $("customItemPanel");
    const button = $("toggleCustomItemBtn");

    if (!panel || !button) return;

    const isOpening = panel.hidden;

    panel.hidden = !isOpening;
    button.setAttribute("aria-expanded", String(isOpening));

    if (isOpening) {
      $("customItemName")?.focus();
    }
  }

  /* ---------------------------------------------------------
     5. Invoice discount and calculations
     --------------------------------------------------------- */

  function getDiscountAmount(subtotal) {
    const settings = getDiscountSettings();
    const input = $("invoiceDiscountAmount");

    if (!settings.enabled || !input) {
      return 0;
    }

    const requested = toNumber(input.value);

    if (requested === null || requested <= 0 || subtotal <= 0) {
      return 0;
    }

    const maximumAmount =
      subtotal * settings.maximumPercent / 100;

    return roundMoney(
      Math.min(requested, maximumAmount, subtotal)
    );
  }

  function calculateTotals() {
    const subtotal = roundMoney(
      state.cart.reduce(function (total, item) {
        return total + item.unitPrice * item.quantity;
      }, 0)
    );

    const discount = getDiscountAmount(subtotal);
    const taxableAmount = roundMoney(
      Math.max(0, subtotal - discount)
    );

    const taxSettings = getTaxSettings();

    const taxAmount = taxSettings.enabled
      ? roundMoney(taxableAmount * taxSettings.rate / 100)
      : 0;

    const beforeRounding = roundMoney(
      taxableAmount + taxAmount
    );

    const roundOffEnabled = settingFlag([
      "roundOffEnabled",
      "enableRoundOff",
      "roundOff"
    ], false);

    const grandTotal = roundOffEnabled
      ? Math.round(beforeRounding)
      : beforeRounding;

    return {
      subtotal: subtotal,
      discount: discount,
      taxRate: taxSettings.enabled ? taxSettings.rate : 0,
      taxEnabled: taxSettings.enabled,
      taxAmount: taxAmount,
      roundOffEnabled: roundOffEnabled,
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

    state.cart = state.cart.filter(function (item) {
      return item.itemId !== itemId;
    });

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
      state.cart.forEach(function (item) {
        const row = document.createElement("tr");

        createTextCell(row, item.name);
        createTextCell(row, formatMoney(item.unitPrice));
        createTextCell(row, String(item.quantity));
        createTextCell(
          row,
          formatMoney(roundMoney(item.unitPrice * item.quantity))
        );

        const actionCell = document.createElement("td");
        const removeButton = document.createElement("button");

        removeButton.type = "button";
        removeButton.className = "btn btn-secondary btn-small";
        removeButton.textContent = "Remove";
        removeButton.disabled = state.saving;
        removeButton.setAttribute("aria-label", "Remove " + item.name);

        removeButton.addEventListener("click", function () {
          removeCartItem(item.itemId);
        });

        actionCell.appendChild(removeButton);
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
      discountRow.hidden =
        totals.discount <= 0 ||
        !settingFlag(["showDiscount", "showInvoiceDiscount"], true);
    }

    if (taxRow) {
      taxRow.hidden =
        !totals.taxEnabled ||
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
    const ids = [
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
    ];

    ids.forEach(function (id) {
      const node = $(id);
      if (node) node.disabled = disabled;
    });

    const customPanel = $("customItemPanel");

    if (customPanel) {
      customPanel.querySelectorAll("input, button").forEach(function (node) {
        node.disabled = disabled;
      });
    }

    renderCart();
  }

  function clearCart() {
    if (state.saving) return;

    state.cart = [];

    $("addInvoiceItemForm")?.reset();
    $("customItemForm")?.reset();

    if ($("itemQuantity")) {
      $("itemQuantity").value = "1";
    }

    if ($("customItemQuantity")) {
      $("customItemQuantity").value = "1";
    }

    if ($("invoiceDiscountAmount")) {
      $("invoiceDiscountAmount").value = "";
    }

    setMessage("");
    renderCart();
  }

  /* ---------------------------------------------------------
     6. Invoice number reservation
     --------------------------------------------------------- */

  async function reserveInvoiceNumber(date) {
    const year = String(date.getFullYear());

    const counterRef = state.api.ref(
      state.db,
      PATHS.counters + "/" + year
    );

    const result = await state.api.runTransaction(
      counterRef,
      function (currentValue) {
        const current = Number(currentValue) || 0;

        if (!Number.isSafeInteger(current) || current < 0) {
          return;
        }

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
     7. Business fields and Settings-based visibility
     --------------------------------------------------------- */

  function renderOptionalText(id, value, enabled) {
    const node = $(id);
    if (!node) return;

    const text = textValue(value);

    node.textContent = text;
    node.hidden = !enabled || !text;
  }

  function applyFormFieldVisibility() {
    const invoice = settingsSections().invoice;

    const visibility = [
      {
        id: "customerName",
        keys: ["showCustomerName", "showBillTo"],
        fallback: true
      },
      {
        id: "customerPhone",
        keys: ["showCustomerPhone"],
        fallback: true
      },
      {
        id: "tableNumber",
        keys: ["showTableNumber"],
        fallback: true
      },
      {
        id: "paymentMethod",
        keys: ["showPaymentMethod"],
        fallback: true
      },
      {
        id: "paymentStatus",
        keys: ["showPaymentStatus"],
        fallback: true
      },
      {
        id: "invoiceNotes",
        keys: ["showNotes", "showInvoiceNotes"],
        fallback: true
      }
    ];

    visibility.forEach(function (field) {
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

      if (wrapper) {
        wrapper.hidden = !visible;
      }

      input.required = visible && (
        field.id === "customerName" ||
        field.id === "paymentMethod" ||
        field.id === "paymentStatus"
      );
    });

    const customerFields = $("customerName")?.closest(
      ".invoice-customer-fields"
    );

    if (customerFields) {
      customerFields.hidden = ![
        "customerName",
        "customerPhone",
        "tableNumber",
        "paymentMethod",
        "paymentStatus"
      ].some(function (id) {
        const input = $(id);
        return input && !input.closest(".form-field")?.hidden;
      });
    }
  }

  function renderInvoiceBusinessDetails() {
    const sections = settingsSections();
    const business = sections.business;
    const invoice = sections.invoice;

    const name = textValue(
      firstValue(business, ["businessName", "name"]) || ""
    );

    const tagline = textValue(
      firstValue(business, [
        "tagline",
        "businessTagline",
        "description"
      ]) || ""
    );

    const address = textValue(
      firstValue(business, [
        "businessAddress",
        "address"
      ]) || ""
    );

    const phone = textValue(
      firstValue(business, [
        "businessPhone",
        "phone",
        "contactPhone"
      ]) || ""
    );

    const email = textValue(
      firstValue(business, [
        "businessEmail",
        "email"
      ]) || ""
    );

    const website = textValue(
      firstValue(business, [
        "website",
        "businessWebsite",
        "websiteUrl"
      ]) || ""
    );

    const logoURL = textValue(
      firstValue(business, [
        "logoImageUrl",
        "logoUrl",
        "businessLogoUrl"
      ]) || ""
    );

    const gstin = textValue(
      firstValue(business, [
        "gstin",
        "GSTIN",
        "gstNumber",
        "gstNo"
      ]) || ""
    );

    const fssai = textValue(
      firstValue(business, [
        "fssai",
        "fssaiNumber",
        "fssaiLicense",
        "fssaiLicenseNumber"
      ]) || ""
    );

    const footer = textValue(
      firstValue(invoice, [
        "invoiceFooter",
        "footerText",
        "footer"
      ]) || ""
    );

    const thankYou = textValue(
      firstValue(invoice, [
        "thankYouMessage",
        "invoiceThankYouMessage"
      ]) || ""
    );

    const signature = textValue(
      firstValue(invoice, [
        "authorisedSignatory",
        "authorizedSignatory",
        "signatureLabel"
      ]) || ""
    );

    setText("printBusinessName", name || "Business Profile");

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

    if (
      phone &&
      settingFlag(["showBusinessPhone", "showPhone"], true)
    ) {
      contactParts.push(phone);
    }

    if (
      email &&
      settingFlag(["showBusinessEmail", "showEmail"], true)
    ) {
      contactParts.push(email);
    }

    renderOptionalText(
      "printBusinessContact",
      contactParts.join(" | "),
      true
    );

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
        logo.alt = name ? name + " Logo" : "Business Logo";
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

    const taxIdParts = [];

    if (
      gstin &&
      settingFlag(["showGSTIN", "showGstin"], true)
    ) {
      taxIdParts.push("GSTIN: " + gstin);
    }

    if (
      fssai &&
      settingFlag(["showFSSAI", "showFssai"], true)
    ) {
      taxIdParts.push("FSSAI: " + fssai);
    }

    renderOptionalText(
      "printBusinessTaxIds",
      taxIdParts.join(" | "),
      taxIdParts.length > 0
    );

    renderOptionalText(
      "printInvoiceFooterText",
      footer,
      settingFlag(["showInvoiceFooter", "showTerms"], true)
    );

    renderOptionalText(
      "printThankYouMessage",
      thankYou,
      settingFlag(["showThankYouMessage", "showThankYou"], true)
    );

    renderOptionalText(
      "printSignatureLabel",
      signature,
      settingFlag(["showSignature", "showAuthorisedSignatory"], true)
    );

    const signatureSection = $("printSignatureSection");

    if (signatureSection) {
      signatureSection.hidden =
        !signature ||
        !settingFlag(["showSignature", "showAuthorisedSignatory"], true);
    }

    updatePaymentQRVisibility();
    applyFormFieldVisibility();
  }

  /* ---------------------------------------------------------
     8. Customer and payment fields
     --------------------------------------------------------- */

  function normalizePaymentMethod(value) {
    const raw = textValue(value);

    if (!raw) return "Cash";

    const normalized = raw.toLowerCase();

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

    return labels[normalized] || raw;
  }

  function getInvoiceFormDetails() {
    const customerName = textValue($("customerName")?.value) ||
      "Walk-in Customer";

    const customerPhone = textValue($("customerPhone")?.value);
    const tableNumber = textValue($("tableNumber")?.value);
    const paymentMethod = normalizePaymentMethod(
      $("paymentMethod")?.value || "Cash"
    );
    const paymentStatus = textValue(
      $("paymentStatus")?.value || "Paid"
    );

    return {
      customerName: customerName,
      customerPhone: customerPhone,
      tableNumber: tableNumber,
      paymentMethod: paymentMethod,
      paymentStatus: paymentStatus,
      notes: textValue($("invoiceNotes")?.value)
    };
  }

  /* ---------------------------------------------------------
     9. Static QR.jpg verification image
     --------------------------------------------------------- */

  function updatePaymentQRVisibility() {
    const section = $("printQrSection");
    const image = $("invoiceQrImage");

    if (!section || !image) return;

    const shouldShow = settingFlag([
      "showVerificationQR",
      "showQR",
      "showQRCode"
    ], true);

    section.hidden = !shouldShow;

    if (!shouldShow) return;

    image.alt = "QR code for invoice verification";

    image.onerror = function () {
      image.hidden = true;

      const caption = $("invoiceQrCaption");

      if (caption) {
        caption.textContent =
          "QR.jpg is unavailable. Add the QR image to the repository.";
      }

      console.error(
        "Invoice verification QR image failed to load: QR.jpg"
      );
    };

    image.onload = function () {
      image.hidden = false;

      const caption = $("invoiceQrCaption");

      if (caption) {
        caption.textContent = "Scan for Verification";
      }
    };

    /*
     * QR.jpg is the provided static verification asset.
     * It is not replaced with a generated payment QR.
     */
    if (!image.getAttribute("src")) {
      image.src = "QR.jpg";
    }
  }

  /* ---------------------------------------------------------
     10. Invoice preview rendering
     --------------------------------------------------------- */

  function createInvoicePrintRow(item, index) {
    const row = document.createElement("div");
    row.className = "inv-row";

    const values = [
      String(index + 1),
      item.name,
      String(item.quantity),
      formatMoney(item.unitPrice),
      formatMoney(item.lineTotal)
    ];

    const classNames = [
      "col-num",
      "col-item",
      "col-qty",
      "col-rate",
      "col-amt"
    ];

    values.forEach(function (value, indexValue) {
      const cell = document.createElement("span");

      cell.className = classNames[indexValue];
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

    const paymentMethodVisible = settingFlag(
      ["showPaymentMethod"],
      true
    );

    const paymentStatusVisible = settingFlag(
      ["showPaymentStatus"],
      true
    );

    setText("printPaymentMethod", invoice.paymentMethod);
    setText("printPaymentStatus", invoice.paymentStatus);

    const paymentMethodRow = $("printPaymentMethodRow");
    const paymentStatusRow = $("printPaymentStatusRow");

    if (paymentMethodRow) {
      paymentMethodRow.hidden = !paymentMethodVisible;
    }

    if (paymentStatusRow) {
      paymentStatusRow.hidden = !paymentStatusVisible;
    }

    const paymentBlock = $("printPaymentMethodRow")?.closest(
      ".inv-payment-block"
    );

    if (paymentBlock) {
      paymentBlock.hidden =
        !paymentMethodVisible && !paymentStatusVisible;
    }

    setText("printInvoiceSubtotal", formatMoney(invoice.subtotal));
    setText("printInvoiceDiscount", formatMoney(invoice.discount));
    setText("printInvoiceTax", formatMoney(invoice.taxAmount));
    setText("printInvoiceGrandTotal", formatMoney(invoice.grandTotal));
    setText("printInvoiceRoundOff", formatMoney(invoice.roundOff || 0));

    setText(
      "printInvoiceTaxLabel",
      "GST (" +
        Number(invoice.taxRate || 0).toFixed(2).replace(/\.00$/, "") +
        "%)"
    );

    const discountRow = $("printDiscountRow");
    const taxRow = $("printTaxRow");
    const roundOffRow = $("printRoundOffRow");

    if (discountRow) {
      discountRow.hidden =
        invoice.discount <= 0 ||
        !settingFlag(["showDiscount", "showInvoiceDiscount"], true);
    }

    if (taxRow) {
      taxRow.hidden =
        !invoice.taxEnabled ||
        !settingFlag(["showTax", "showInvoiceTax"], true);
    }

    if (roundOffRow) {
      roundOffRow.hidden =
        !invoice.roundOffEnabled ||
        !settingFlag(["showRoundOff"], true);
    }

    const notes = textValue(invoice.notes);
    const notesSection = $("printInvoiceNotesSection");

    if (notesSection) {
      notesSection.hidden =
        !notes ||
        !settingFlag(["showNotes", "showInvoiceNotes"], true);
    }

    setText("printInvoiceNotes", notes);

    const body = $("printInvoiceItemsBody");

    if (body) {
      body.replaceChildren();

      invoice.items.forEach(function (item, index) {
        body.appendChild(createInvoicePrintRow(item, index));
      });
    }

    renderInvoiceBusinessDetails();
    preview.hidden = false;

    updatePaymentQRVisibility();

    setMessage(
      "Invoice recorded successfully. Preview is ready.",
      "success"
    );

    setPageStatus(
      "Invoice saved to the business database.",
      "connected"
    );

    setFooterStatus("Invoice Recorded");

    preview.scrollIntoView({
      behavior: window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches ? "auto" : "smooth",
      block: "start"
    });
  }

  /* ---------------------------------------------------------
     11. Validation and Firebase persistence
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

      if (
        !Number.isFinite(item.unitPrice) ||
        item.unitPrice <= 0
      ) {
        throw new Error("An invoice item has an invalid unit price.");
      }
    }
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
        (!Number.isFinite(tax.rate) ||
          tax.rate < 0 ||
          tax.rate > 100)
      ) {
        throw new Error(
          "Check the tax rate in Settings before recording an invoice."
        );
      }

      const formDetails = getInvoiceFormDetails();

      if (
        settingFlag(["showCustomerName", "showBillTo"], true) &&
        !$("customerName")?.closest(".form-field")?.hidden &&
        !formDetails.customerName
      ) {
        throw new Error("Enter the customer name.");
      }

      state.saving = true;

      setMessage("");
      setPageStatus("Recording invoice...", "warning");
      setEditingDisabled(true);

      const submitButton = $("generateInvoiceBtn");

      if (submitButton) {
        submitButton.disabled = true;
      }

      const submitLabel = $("invoiceSubmitLabel");

      if (submitLabel) {
        submitLabel.textContent = "Recording Invoice...";
      }

      const createdAt = new Date();
      const totals = calculateTotals();
      const invoiceNumber = await reserveInvoiceNumber(createdAt);

      ensureOwnerAuthorized();

      const items = state.cart.map(function (item) {
        return {
          productId: item.productId,
          name: item.name,
          category: item.category || "",
          quantity: item.quantity,
          unitPrice: roundMoney(item.unitPrice),
          lineTotal: roundMoney(item.unitPrice * item.quantity),
          custom: Boolean(item.custom)
        };
      });

      const invoiceRecord = {
        ownerUid: OWNER_UID,

        invoiceNumber: invoiceNumber,
        invoiceDate: localDateString(createdAt),
        invoiceTime: localTimeString(createdAt),
        createdAt: createdAt.toISOString(),
        createdAtMs: createdAt.getTime(),

        customerName: formDetails.customerName,
        customerPhone: formDetails.customerPhone,
        tableNumber: formDetails.tableNumber,

        paymentMethod: formDetails.paymentMethod,
        paymentStatus: formDetails.paymentStatus,

        items: items,

        subtotal: totals.subtotal,
        discount: totals.discount,
        taxEnabled: totals.taxEnabled,
        taxRate: totals.taxRate,
        taxAmount: totals.taxAmount,
        roundOffEnabled: totals.roundOffEnabled,
        roundOff: totals.roundOff,
        grandTotal: totals.grandTotal,

        notes: formDetails.notes,

        recordStatus: "valid"
      };

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

      await state.api.set(newInvoiceRef, invoiceRecord);

      invoiceRecord._recordKey = newInvoiceRef.key;

      renderSavedInvoice(invoiceRecord);

      state.cart = [];
      renderCart();

      $("addInvoiceItemForm")?.reset();
      $("customItemForm")?.reset();

      if ($("itemQuantity")) {
        $("itemQuantity").value = "1";
      }

      if ($("customItemQuantity")) {
        $("customItemQuantity").value = "1";
      }

      if ($("invoiceDiscountAmount")) {
        $("invoiceDiscountAmount").value = "";
      }

      setText("itemCount", "0 items added");

    } catch (error) {
      console.error("Invoice recording failed:", {
        code: error && error.code
          ? error.code
          : "invoice-save-error",
        message: error instanceof Error
          ? error.message
          : "Unknown error"
      });

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to record the invoice. Please try again.",
        "error"
      );

      setPageStatus(
        "Invoice was not confirmed as saved.",
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
     12. Realtime database loading
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

    populateProductSelect();
    renderCart();
    checkReady();
  }

  function onCategories(snapshot) {
    state.categories = recordEntries(
      snapshot.exists() ? snapshot.val() : null
    );

    state.loaded.categories = true;

    populateProductSelect();
    renderCart();
    checkReady();
  }

  function onSettings(snapshot) {
    state.settings = snapshot.exists()
      ? snapshot.val()
      : {};

    state.loaded.settings = true;

    renderInvoiceBusinessDetails();
    renderCart();
    checkReady();
  }

  function onReadError(path, error) {
    console.error("Invoice data read failed:", {
      path: path,
      code: error && error.code
        ? error.code
        : "unknown"
    });

    setPageStatus(
      "Unable to load required billing data. Check the database connection and access rules.",
      "error"
    );

    setMessage(
      "Required data could not be loaded. Invoice recording is unavailable.",
      "error"
    );

    state.ready = false;
    renderCart();
  }

  function checkReady() {
    state.ready = Object.values(state.loaded).every(Boolean);

    if (state.ready) {
      setPageStatus("Billing data is ready.", "connected");
      setFooterStatus("Billing Data Loaded");
    }

    renderCart();
  }

  /* ---------------------------------------------------------
     13. Reset and preview controls
     --------------------------------------------------------- */

  function resetInvoice() {
    if (state.saving) return;

    clearCart();

    const preview = $("invoicePreviewSection");

    if (preview) {
      preview.hidden = true;
    }

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

    applyFormFieldVisibility();

    setMessage("");

    setPageStatus(
      state.ready
        ? "Billing data is ready."
        : "Loading billing data.",
      state.ready ? "connected" : "warning"
    );
  }

  function closePreview() {
    const preview = $("invoicePreviewSection");

    if (preview) {
      preview.hidden = true;
    }
  }

  function printInvoice() {
    if ($("invoicePreviewSection")?.hidden) {
      setMessage("Record an invoice before printing.", "warning");
      return;
    }

    window.print();
  }

  /* ---------------------------------------------------------
     14. Initialization
     --------------------------------------------------------- */

  async function initialize() {
    try {
      setPageStatus("Checking owner session...", "warning");

      const access = window.restaurantAccess;

      if (!access || !access.readyPromise) {
        throw new Error("Owner authorization is unavailable.");
      }

      const authorized = await access.readyPromise;

      if (
        !authorized ||
        !access.authorized ||
        !access.user ||
        access.user.uid !== OWNER_UID
      ) {
        throw new Error(
          "Only the authorized owner may create invoices."
        );
      }

      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.readyPromise) {
        throw new Error("Firebase configuration is unavailable.");
      }

      const ready = await firebase.readyPromise;

      if (!ready || !firebase.ready) {
        throw new Error(
          firebase.error?.message ||
          "Firebase initialization failed."
        );
      }

      const connected = getFirebase();

      state.db = connected.db;
      state.api = connected.api;

      if (
        typeof state.api.ref !== "function" ||
        typeof state.api.onValue !== "function" ||
        typeof state.api.push !== "function" ||
        typeof state.api.set !== "function" ||
        typeof state.api.runTransaction !== "function"
      ) {
        throw new Error(
          "Required Realtime Database methods are unavailable."
        );
      }

      subscribe(PATHS.products, onProducts, function (error) {
        onReadError(PATHS.products, error);
      });

      subscribe(PATHS.categories, onCategories, function (error) {
        onReadError(PATHS.categories, error);
      });

      subscribe(PATHS.settings, onSettings, function (error) {
        onReadError(PATHS.settings, error);
      });

    } catch (error) {
      state.ready = false;

      console.error(
        "Invoice page initialization failed:",
        error
      );

      setPageStatus(
        error instanceof Error
          ? error.message
          : "Invoice page initialization failed.",
        "error"
      );

      setMessage(
        "Invoice creation is unavailable until initialization succeeds.",
        "error"
      );
    }
  }

  /* ---------------------------------------------------------
     15. Event handlers
     --------------------------------------------------------- */

  $("addInvoiceItemForm")?.addEventListener(
    "submit",
    addSavedProduct
  );

  $("customItemForm")?.addEventListener(
    "submit",
    addCustomItem
  );

  $("toggleCustomItemBtn")?.addEventListener(
    "click",
    toggleCustomItem
  );

  $("clearItemsBtn")?.addEventListener(
    "click",
    clearCart
  );

  $("resetInvoiceBtn")?.addEventListener(
    "click",
    resetInvoice
  );

  $("invoiceForm")?.addEventListener(
    "submit",
    saveInvoice
  );

  $("closeInvoicePreviewBtn")?.addEventListener(
    "click",
    closePreview
  );

  $("printInvoiceBtn")?.addEventListener(
    "click",
    printInvoice
  );

  $("productSelect")?.addEventListener("change", function () {
    setMessage("");
  });

  $("invoiceDiscountAmount")?.addEventListener("input", renderCart);

  /* Initialize safe defaults for the newly added fields. */
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

  window.addEventListener("pagehide", function () {
    state.disposed = true;

    state.subscriptions.forEach(function (unsubscribe) {
      try {
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      } catch (error) {
        console.warn("Invoice subscription cleanup failed.");
      }
    });

    state.subscriptions = [];
  });
})();
