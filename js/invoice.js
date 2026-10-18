/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Invoice Creation, Calculation, Saving and Preview
   Database root: restaurantBilling/
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
    }).format(value);
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
      rate: taxRate === null ? 0 : Math.min(100, Math.max(0, taxRate))
    };
  }

  /* ---------------------------------------------------------
     2. Product loading and selection
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

    return value !== null && value >= 0 ? roundMoney(value) : null;
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
      firstValue(product, ["categoryId", "categoryID", "categoryKey"]) || ""
    );

    const categoryText = textValue(
      firstValue(product, ["categoryName", "category"]) || ""
    );

    const match = state.categories.find(function (category) {
      return (
        (categoryId && category._recordKey === categoryId) ||
        (categoryText &&
          categoryName(category).toLowerCase() === categoryText.toLowerCase())
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

        const price = productPrice(product);

        option.textContent =
          productName(product) + " — " + formatMoney(price);

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

    if (unitPrice === null) {
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

    setText("productSelect", $("productSelect").value);
    if (quantityInput) quantityInput.value = "1";

    setMessage("");
    renderCart();
  }

  /* ---------------------------------------------------------
     3. Custom item
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

    $("customItemForm").reset();

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
     4. Cart rendering and totals
     --------------------------------------------------------- */

  function calculateTotals() {
    const subtotal = roundMoney(
      state.cart.reduce(function (total, item) {
        return total + item.unitPrice * item.quantity;
      }, 0)
    );

    const taxSettings = getTaxSettings();

    const taxAmount = taxSettings.enabled
      ? roundMoney(subtotal * taxSettings.rate / 100)
      : 0;

    return {
      subtotal: subtotal,
      discount: 0,
      taxRate: taxSettings.enabled ? taxSettings.rate : 0,
      taxEnabled: taxSettings.enabled,
      taxAmount: taxAmount,
      grandTotal: roundMoney(subtotal + taxAmount)
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
        removeButton.setAttribute(
          "aria-label",
          "Remove " + item.name
        );

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
      discountRow.hidden = totals.discount <= 0;
    }

    if (taxRow) {
      taxRow.hidden = !totals.taxEnabled;
    }

    setText(
      "invoiceTaxLabel",
      "Tax (" + totals.taxRate.toFixed(2).replace(/\.00$/, "") + "%)"
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
      "resetInvoiceBtn"
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

    if ($("addInvoiceItemForm")) {
      $("addInvoiceItemForm").reset();
    }

    if ($("customItemForm")) {
      $("customItemForm").reset();
    }

    if ($("itemQuantity")) {
      $("itemQuantity").value = "1";
    }

    if ($("customItemQuantity")) {
      $("customItemQuantity").value = "1";
    }

    setMessage("");
    renderCart();
  }

  /* ---------------------------------------------------------
     5. Invoice numbering
     --------------------------------------------------------- */

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
      {
        applyLocally: false
      }
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
     6. Business information for printed invoice
     --------------------------------------------------------- */

  function renderInvoiceBusinessDetails() {
    const sections = settingsSections();
    const business = sections.business;
    const invoice = sections.invoice;

    const name = textValue(
      firstValue(business, [
        "businessName",
        "name"
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

    const footer = textValue(
      firstValue(invoice, [
        "invoiceFooter",
        "footerText",
        "footer"
      ]) || ""
    );

    setText("printBusinessName", name);
    setText("printBusinessAddress", address);

    const contactParts = [];

    if (phone) contactParts.push(phone);
    if (email) contactParts.push(email);

    setText("printBusinessContact", contactParts.join(" | "));
    setText("printInvoiceFooterText", footer);
  }

  /* ---------------------------------------------------------
     7. QR payload
     --------------------------------------------------------- */

  function getPaymentQRPayload(invoice) {
    const payment = settingsSections().payment;

    const upiId = textValue(
      firstValue(payment, [
        "upiId",
        "upiID",
        "vpa"
      ]) || ""
    );

    const accountName = textValue(
      firstValue(payment, [
        "paymentAccountName",
        "accountName",
        "payeeName"
      ]) || ""
    );

    if (upiId) {
      const params = new URLSearchParams();

      params.set("pa", upiId);

      if (accountName) {
        params.set("pn", accountName);
      }

      params.set("am", invoice.grandTotal.toFixed(2));
      params.set("cu", "INR");
      params.set("tn", "Invoice " + invoice.invoiceNumber);

      return {
        payload: "upi://pay?" + params.toString(),
        caption: "Scan to pay " + formatMoney(invoice.grandTotal)
      };
    }

    return {
      payload: [
        "Invoice: " + invoice.invoiceNumber,
        "Date: " + invoice.invoiceDate,
        "Total: INR " + invoice.grandTotal.toFixed(2)
      ].join("\n"),
      caption: "Invoice details"
    };
  }

  async function renderInvoiceQR(invoice) {
    const container = $("invoiceQrCode");
    const caption = $("invoiceQrCaption");

    if (!container) return;

    container.replaceChildren();

    const qr = window.restaurantQR;
    const qrDetails = getPaymentQRPayload(invoice);

    if (caption) {
      caption.textContent = qrDetails.caption;
    }

    if (!qr || typeof qr.generate !== "function") {
      const note = document.createElement("p");

      note.textContent = "QR generator is unavailable.";
      note.className = "form-message is-warning";

      container.appendChild(note);
      return;
    }

    try {
      await qr.generate(container, qrDetails.payload, {
        width: 108,
        height: 108,
        margin: 1
      });
    } catch (error) {
      console.error("Invoice QR generation failed:", error);

      container.replaceChildren();

      const note = document.createElement("p");
      note.textContent = "QR code could not be generated.";
      note.className = "form-message is-warning";

      container.appendChild(note);
    }
  }

  /* ---------------------------------------------------------
     8. Saved invoice preview
     --------------------------------------------------------- */

  function renderSavedInvoice(invoice) {
    const preview = $("invoicePreviewSection");

    if (!preview) return;

    setText("printInvoiceNumber", invoice.invoiceNumber);
    setText("printInvoiceDate", invoice.invoiceDate);
    setText("printInvoiceTime", invoice.invoiceTime);

    setText("printInvoiceSubtotal", formatMoney(invoice.subtotal));
    setText("printInvoiceDiscount", formatMoney(invoice.discount));
    setText("printInvoiceTax", formatMoney(invoice.taxAmount));
    setText("printInvoiceGrandTotal", formatMoney(invoice.grandTotal));

    setText(
      "printInvoiceTaxLabel",
      invoice.taxEnabled
        ? "Tax (" + invoice.taxRate + "%)"
        : "Tax"
    );

    const discountRow = $("printDiscountRow");
    const taxRow = $("printTaxRow");

    if (discountRow) {
      discountRow.hidden = invoice.discount <= 0;
    }

    if (taxRow) {
      taxRow.hidden = !invoice.taxEnabled;
    }

    const notes = textValue(invoice.notes);
    const notesSection = $("printInvoiceNotesSection");

    if (notesSection) {
      notesSection.hidden = !notes;
    }

    setText("printInvoiceNotes", notes);

    const body = $("printInvoiceItemsBody");

    if (body) {
      body.replaceChildren();

      invoice.items.forEach(function (item) {
        const row = document.createElement("tr");

        createTextCell(row, item.name);
        createTextCell(row, String(item.quantity));
        createTextCell(row, formatMoney(item.unitPrice));
        createTextCell(row, formatMoney(item.lineTotal));

        body.appendChild(row);
      });
    }

    renderInvoiceBusinessDetails();

    preview.hidden = false;

    renderInvoiceQR(invoice);

    setMessage(
      "Invoice recorded successfully. Preview is ready.",
      "success"
    );

    setPageStatus(
      "Invoice saved to the business database.",
      "connected"
    );

    setFooterStatus("Invoice recorded");

    preview.scrollIntoView({
      behavior: window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches ? "auto" : "smooth",
      block: "start"
    });
  }

  /* ---------------------------------------------------------
     9. Invoice persistence
     --------------------------------------------------------- */

  function validateCart() {
    if (!state.cart.length) {
      throw new Error("Add at least one item before recording the invoice.");
    }

    for (const item of state.cart) {
      if (!item.name || !Number.isSafeInteger(item.quantity) ||
          item.quantity < 1) {
        throw new Error("One or more invoice items are invalid.");
      }

      if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
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
        throw new Error("Invoice data is still loading. Try again shortly.");
      }

      ensureOwnerAuthorized();
      validateCart();

      const tax = getTaxSettings();

      if (tax.enabled && (!Number.isFinite(tax.rate) ||
          tax.rate < 0 || tax.rate > 100)) {
        throw new Error("Check the tax rate in Settings before recording an invoice.");
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

        items: items,

        subtotal: totals.subtotal,
        discount: totals.discount,
        taxEnabled: totals.taxEnabled,
        taxRate: totals.taxRate,
        taxAmount: totals.taxAmount,
        grandTotal: totals.grandTotal,

        notes: textValue($("invoiceNotes")?.value),

        recordStatus: "valid",
        paymentStatus: "recorded"
      };

      const invoiceListRef = state.api.ref(
        state.db,
        PATHS.invoices
      );

      const newInvoiceRef = state.api.push(invoiceListRef);

      if (!newInvoiceRef || !newInvoiceRef.key) {
        throw new Error("Unable to create a database invoice reference.");
      }

      await state.api.set(newInvoiceRef, invoiceRecord);

      invoiceRecord._recordKey = newInvoiceRef.key;

      /*
       * Keep the recently recorded invoice locally available
       * for the preview. Realtime listeners on dashboard and
       * other pages will receive the same database record.
       */
      renderSavedInvoice(invoiceRecord);

      state.cart = [];
      renderCart();

      if ($("addInvoiceItemForm")) {
        $("addInvoiceItemForm").reset();
      }

      if ($("customItemForm")) {
        $("customItemForm").reset();
      }

      if ($("itemQuantity")) {
        $("itemQuantity").value = "1";
      }

      if ($("customItemQuantity")) {
        $("customItemQuantity").value = "1";
      }

      setText("itemCount", "0 items added");

    } catch (error) {
      console.error("Invoice recording failed:", {
        code: error && error.code ? error.code : "invoice-save-error",
        message: error instanceof Error ? error.message : "Unknown error"
      });

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to record the invoice. Please try again.",
        "error"
      );

      setPageStatus("Invoice was not confirmed as saved.", "error");

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
     10. Realtime loading
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

    setPageStatus("Products loaded.", "connected");
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
      code: error && error.code ? error.code : "unknown"
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
      setFooterStatus("Billing data loaded");
    }

    renderCart();
  }

  /* ---------------------------------------------------------
     11. Reset and preview controls
     --------------------------------------------------------- */

  function resetInvoice() {
    if (state.saving) return;

    clearCart();

    const preview = $("invoicePreviewSection");

    if (preview) {
      preview.hidden = true;
    }

    if ($("invoiceForm")) {
      $("invoiceForm").reset();
    }

    setMessage("");
    setPageStatus(
      state.ready ? "Billing data is ready." : "Loading billing data.",
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
     12. Initialization
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
        throw new Error("Only the authorized owner may create invoices.");
      }

      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.readyPromise) {
        throw new Error("Firebase configuration is unavailable.");
      }

      const ready = await firebase.readyPromise;

      if (!ready || !firebase.ready) {
        throw new Error(
          firebase.error?.message || "Firebase initialization failed."
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
        throw new Error("Required Realtime Database methods are unavailable.");
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

      console.error("Invoice page initialization failed:", error);

      setPageStatus(
        error instanceof Error
          ? error.message
          : "Invoice page initialization failed.",
        "error"
      );

      setMessage("Invoice creation is unavailable until initialization succeeds.", "error");
    }
  }

  /* ---------------------------------------------------------
     13. Event handlers
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

  /* Disable invoice submission before loading is complete. */
  renderCart();

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

  initialize();

})();
