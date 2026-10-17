
"use strict";

/*
 * Restaurant Billing Software
 * File: js/products.js
 *
 * Firebase Realtime Database integration.
 * No demo products or local product persistence.
 */

(() => {
  const ADMIN_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const PRODUCTS_PATH = "restaurantBilling/products";

  const table = document.getElementById("productsTable");
  const tbody = table?.querySelector("tbody");

  if (!table || !tbody) {
    console.error("Products: Product table was not found.");
    return;
  }

  const $ = id => document.getElementById(id);

  const searchInput = $("productSearch");
  const categoryFilter = $("categoryFilter");
  const availabilityFilter = $("availabilityFilter");
  const filtersForm = $("productFilters");
  const addProductButton = $("addProductBtn");
  const exportButton = $("exportProductsBtn");
  const selectAllCheckbox = $("selectAllProducts");
  const bulkActionSelect = $("bulkAction");
  const applyBulkActionButton = $("applyBulkAction");

  const currency = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  });

  let db = null;
  let databaseSDK = null;
  let products = [];
  let unsubscribeProducts = null;
  let dialog = null;
  let saving = false;
  let loading = true;
  let databaseError = null;

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function normalise(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function formatMoney(value) {
    return currency.format(Number(value) || 0);
  }

  function validProduct(product) {
    return Boolean(
      product &&
      typeof product.name === "string" &&
      product.name.trim() &&
      typeof product.category === "string" &&
      product.category.trim() &&
      Number.isFinite(Number(product.price)) &&
      Number(product.price) >= 0 &&
      Number.isSafeInteger(Number(product.stock)) &&
      Number(product.stock) >= 0 &&
      typeof product.active === "boolean"
    );
  }

  function showMessage(message, type = "info") {
    let element = $("productsFeedback");

    if (!element) {
      element = document.createElement("p");
      element.id = "productsFeedback";
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
      element.style.cssText =
        "margin:12px 0;padding:10px 12px;border:1px solid #d1d5db;border-radius:5px;font-size:13px;";
      table.closest(".card")?.prepend(element);
    }

    element.textContent = message;
    element.dataset.type = type;
  }

  function showTableMessage(message) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:32px 16px;">
          ${escapeHTML(message)}
        </td>
      </tr>
    `;
  }

  function setButtonBusy(button, busy, busyText, normalText) {
    if (!button) return;

    button.disabled = busy;
    button.textContent = busy ? busyText : normalText;
  }

  function isLowStock(product) {
    return product.stock > 0 && product.stock <= 10;
  }

  function createFallbackSku() {
    return `SKU-${Date.now().toString(36).toUpperCase()}`;
  }

  function categoriesFromProducts() {
    return [...new Set(
      products.map(product => product.category.trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));
  }

  // --------------------------------------------------
  // REALTIME DATABASE INITIALISATION
  // --------------------------------------------------

  async function initialiseFirebase() {
    try {
      showTableMessage("Connecting to Firebase...");

      if (!window.restaurantFirebase?.ready) {
        throw new Error("Firebase configuration is unavailable.");
      }

      const firebase = await window.restaurantFirebase.ready;

      if (!firebase?.db) {
        throw new Error("Firebase Realtime Database is unavailable.");
      }

      if (!window.restaurantAuth?.watchAuth) {
        throw new Error("Authentication service is unavailable.");
      }

      db = firebase.db;

      databaseSDK = await import(
        "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js"
      );

      await window.restaurantAuth.watchAuth(user => {
        if (!user || user.uid !== ADMIN_UID) {
          unsubscribeProducts?.();
          unsubscribeProducts = null;
          products = [];
          loading = false;

          renderProducts();
          showMessage("Administrator authentication is required.", "error");
          return;
        }

        startProductsListener();
      });
    } catch (error) {
      console.error("Products: Firebase initialisation failed.", error);

      loading = false;
      databaseError = error;
      products = [];

      renderProducts();

      showMessage(
        "Unable to connect to Firebase. Check your connection and database configuration.",
        "error"
      );
    }
  }

  function startProductsListener() {
    if (unsubscribeProducts || !db || !databaseSDK) return;

    const productsRef = databaseSDK.ref(db, PRODUCTS_PATH);

    unsubscribeProducts = databaseSDK.onValue(
      productsRef,
      snapshot => {
        const data = snapshot.val();

        products = data && typeof data === "object"
          ? Object.entries(data)
              .filter(([, value]) => validProduct(value))
              .map(([id, value]) => ({
                id,
                name: value.name.trim(),
                description: String(value.description || ""),
                category: value.category.trim(),
                sku: String(value.sku || ""),
                price: Number(value.price),
                stock: Number(value.stock),
                active: value.active,
                createdAt: value.createdAt || null,
                updatedAt: value.updatedAt || null
              }))
          : [];

        loading = false;
        databaseError = null;

        updateCategoryOptions();
        updateFormCategories();
        renderProducts();
      },
      error => {
        console.error("Products: Database read failed.", error);

        loading = false;
        databaseError = error;
        products = [];

        renderProducts();

        showMessage(
          "Could not load products. Verify your Firebase Rules and admin sign-in.",
          "error"
        );
      }
    );
  }

  // --------------------------------------------------
  // SUMMARY CARDS
  // --------------------------------------------------

  function updateSummary() {
    const values = document.querySelectorAll(".kpi .kpi-value");

    const summary = [
      products.length,
      products.filter(product => product.active).length,
      products.filter(product => product.active && product.stock <= 10).length,
      categoriesFromProducts().length
    ];

    values.forEach((element, index) => {
      if (index < summary.length) {
        element.textContent = summary[index].toLocaleString("en-IN");
      }
    });
  }

  // --------------------------------------------------
  // DYNAMIC CATEGORY FILTER
  // --------------------------------------------------

  function updateCategoryOptions() {
    if (!categoryFilter) return;

    const previousValue = categoryFilter.value;
    const categories = categoriesFromProducts();

    categoryFilter.innerHTML = `
      <option value="">All Categories</option>
      ${categories.map(category => `
        <option value="${escapeHTML(category)}">${escapeHTML(category)}</option>
      `).join("")}
    `;

    if (categories.includes(previousValue)) {
      categoryFilter.value = previousValue;
    }
  }

  function updateFormCategories() {
    const datalist = $("productCategoryOptions");

    if (!datalist) return;

    datalist.innerHTML = categoriesFromProducts().map(category => `
      <option value="${escapeHTML(category)}"></option>
    `).join("");
  }

  // --------------------------------------------------
  // SEARCH AND FILTERS
  // --------------------------------------------------

  function getFilteredProducts() {
    const search = normalise(searchInput?.value);
    const category = categoryFilter?.value || "";
    const availability = availabilityFilter?.value || "";

    return products.filter(product => {
      const searchable = [
        product.name,
        product.description,
        product.category,
        product.sku
      ].map(normalise).join(" ");

      const matchesSearch = !search || searchable.includes(search);
      const matchesCategory = !category || product.category === category;

      const matchesAvailability =
        !availability ||
        (availability === "active" && product.active) ||
        (availability === "inactive" && !product.active);

      return matchesSearch && matchesCategory && matchesAvailability;
    });
  }

  // --------------------------------------------------
  // RENDER DATABASE PRODUCTS
  // --------------------------------------------------

  function renderProducts() {
    if (loading) {
      showTableMessage("Loading products...");
      updateSummary();
      return;
    }

    if (databaseError) {
      showTableMessage("Products could not be loaded from Firebase.");
      updateSummary();
      return;
    }

    const filtered = getFilteredProducts();

    if (!filtered.length) {
      showTableMessage(
        products.length
          ? "No matching products found. Change your search or filters."
          : "No products yet. Select Add Product to create your first product."
      );

      updateSummary();
      return;
    }

    tbody.innerHTML = filtered.map(product => {
      const statusClass = product.active ? "paid" : "cancelled";
      const statusText = product.active ? "Active" : "Inactive";

      let stockHTML = String(product.stock);

      if (product.active && product.stock === 0) {
        stockHTML = '<span class="pill cancelled">Out of Stock</span>';
      } else if (product.active && isLowStock(product)) {
        stockHTML = `
          ${product.stock}
          <span class="pill pending">Low Stock</span>
        `;
      }

      return `
        <tr data-product-id="${escapeHTML(product.id)}">
          <td>
            <input
              type="checkbox"
              class="product-select"
              aria-label="Select ${escapeHTML(product.name)}"
            >
          </td>

          <td>
            <div class="cust">
              <div class="cust-avatar">
                ${escapeHTML(product.name.charAt(0).toUpperCase())}
              </div>
              <div>
                <div class="cust-name">${escapeHTML(product.name)}</div>
                <div class="cust-sub">
                  ${escapeHTML(product.description || "No description")}
                </div>
              </div>
            </div>
          </td>

          <td>${escapeHTML(product.category)}</td>
          <td class="mono">${escapeHTML(product.sku || "—")}</td>
          <td class="num">${formatMoney(product.price)}</td>
          <td>${stockHTML}</td>
          <td><span class="pill ${statusClass}">${statusText}</span></td>

          <td>
            <button
              class="btn-icon"
              type="button"
              data-action="edit"
              data-product-id="${escapeHTML(product.id)}"
              aria-label="Edit ${escapeHTML(product.name)}"
              title="Edit product"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>
              </svg>
            </button>

            <button
              class="btn-icon"
              type="button"
              data-action="delete"
              data-product-id="${escapeHTML(product.id)}"
              aria-label="Delete ${escapeHTML(product.name)}"
              title="Delete product"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }

    updateSummary();
  }

  // --------------------------------------------------
  // PRODUCT EDITOR
  // --------------------------------------------------

  function createProductDialog() {
    const element = document.createElement("dialog");

    element.id = "productDialog";
    element.setAttribute("aria-labelledby", "productDialogTitle");
    element.style.cssText = `
      width:min(560px,calc(100% - 28px));
      max-width:560px;
      max-height:90vh;
      overflow-y:auto;
      border:1px solid #e5e7eb;
      border-radius:8px;
      padding:24px;
      color:#111827;
      background:#fff;
    `;

    element.innerHTML = `
      <div class="card-head">
        <div>
          <h3 id="productDialogTitle">Add Product</h3>
          <p>Enter the product details.</p>
        </div>
        <button type="button" class="btn-icon" id="closeProductDialog"
          aria-label="Close dialog">×</button>
      </div>

      <form id="productForm">
        <input type="hidden" id="editProductId">

        <div style="display:grid;gap:16px;margin-top:20px;">
          <label>
            Product Name *
            <input class="btn btn-outline" style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text" id="productName" maxlength="100" required autocomplete="off">
          </label>

          <label>
            Description
            <input class="btn btn-outline" style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text" id="productDescription" maxlength="200">
          </label>

          <label>
            Category *
            <input class="btn btn-outline" style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text" id="productCategory" list="productCategoryOptions"
              maxlength="60" required autocomplete="off">
            <datalist id="productCategoryOptions"></datalist>
          </label>

          <label>
            SKU
            <input class="btn btn-outline" style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text" id="productSKU" maxlength="50" autocomplete="off">
          </label>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <label>
              Price (₹) *
              <input class="btn btn-outline" style="display:block;width:100%;margin-top:6px;text-align:left;"
                type="number" id="productPrice" min="0" max="99999999"
                step="0.01" required>
            </label>

            <label>
              Stock Quantity *
              <input class="btn btn-outline" style="display:block;width:100%;margin-top:6px;text-align:left;"
                type="number" id="productStock" min="0" max="999999999"
                step="1" required>
            </label>
          </div>

          <label>
            Availability
            <select class="btn btn-outline" style="display:block;width:100%;margin-top:6px;text-align:left;"
              id="productStatus">
              <option value="active">Active — Available for billing</option>
              <option value="inactive">Inactive — Hidden from billing</option>
            </select>
          </label>
        </div>

        <p id="productFormMessage" role="alert" aria-live="polite"
          style="margin-top:12px;"></p>

        <div class="page-actions" style="justify-content:flex-end;margin-top:20px;">
          <button type="button" class="btn btn-soft" id="cancelProductDialog">Cancel</button>
          <button type="submit" class="btn btn-primary" id="saveProductButton">Save Product</button>
        </div>
      </form>
    `;

    document.body.appendChild(element);
    return element;
  }

  function openProductDialog(product = null) {
    const form = $("productForm");
    form.reset();

    $("productFormMessage").textContent = "";
    $("editProductId").value = product?.id || "";
    $("productDialogTitle").textContent = product ? "Edit Product" : "Add Product";
    $("saveProductButton").textContent = product ? "Update Product" : "Save Product";

    $("productName").value = product?.name || "";
    $("productDescription").value = product?.description || "";
    $("productCategory").value = product?.category || "";
    $("productSKU").value = product?.sku || "";
    $("productPrice").value = product?.price ?? "";
    $("productStock").value = product?.stock ?? 0;
    $("productStatus").value = product?.active === false ? "inactive" : "active";

    updateFormCategories();

    if (!dialog.open) dialog.showModal();
    $("productName").focus();
  }

  function closeProductDialog() {
    if (dialog?.open) dialog.close();
  }

  dialog = createProductDialog();

  $("closeProductDialog").addEventListener("click", closeProductDialog);
  $("cancelProductDialog").addEventListener("click", closeProductDialog);

  addProductButton?.addEventListener("click", () => openProductDialog());

  // --------------------------------------------------
  // SAVE / UPDATE
  // --------------------------------------------------

  async function saveProduct(event) {
    event.preventDefault();

    if (saving || !db || !databaseSDK) return;

    const id = $("editProductId").value;
    const name = $("productName").value.trim();
    const description = $("productDescription").value.trim();
    const category = $("productCategory").value.trim();
    let sku = $("productSKU").value.trim();

    const price = Number($("productPrice").value);
    const stock = Number($("productStock").value);
    const active = $("productStatus").value === "active";
    const message = $("productFormMessage");

    message.textContent = "";

    if (!name || !category) {
      message.textContent = "Product name and category are required.";
      return;
    }

    if (!Number.isFinite(price) || price < 0 || price > 99999999) {
      message.textContent = "Enter a valid product price.";
      return;
    }

    if (!Number.isSafeInteger(stock) || stock < 0 || stock > 999999999) {
      message.textContent = "Enter a valid whole-number stock quantity.";
      return;
    }

    const duplicateName = products.some(product =>
      product.id !== id &&
      normalise(product.name) === normalise(name) &&
      normalise(product.category) === normalise(category)
    );

    if (duplicateName) {
      message.textContent = "This product already exists in the same category.";
      return;
    }

    if (!sku) sku = createFallbackSku();

    const duplicateSku = products.some(product =>
      product.id !== id &&
      product.sku &&
      normalise(product.sku) === normalise(sku)
    );

    if (duplicateSku) {
      message.textContent = "This SKU is already assigned to another product.";
      return;
    }

    const now = new Date().toISOString();
    const existingProduct = products.find(product => product.id === id);

    const record = {
      name,
      description,
      category,
      sku,
      price,
      stock,
      active,
      createdAt: existingProduct?.createdAt || now,
      updatedAt: now
    };

    saving = true;
    setButtonBusy(
      $("saveProductButton"),
      true,
      "Saving...",
      id ? "Update Product" : "Save Product"
    );

    try {
      if (id) {
        await databaseSDK.update(
          databaseSDK.ref(db, `${PRODUCTS_PATH}/${id}`),
          record
        );
      } else {
        const newRef = databaseSDK.push(
          databaseSDK.ref(db, PRODUCTS_PATH)
        );

        await databaseSDK.set(newRef, record);
      }

      closeProductDialog();
      showMessage(id ? "Product updated successfully." : "Product saved successfully.", "success");
    } catch (error) {
      console.error("Products: Save failed.", error);

      message.textContent =
        "Could not save the product. Check your connection and database Rules.";
    } finally {
      saving = false;
      setButtonBusy(
        $("saveProductButton"),
        false,
        "Saving...",
        id ? "Update Product" : "Save Product"
      );
    }
  }

  $("productForm").addEventListener("submit", saveProduct);

  // --------------------------------------------------
  // EDIT / DELETE
  // --------------------------------------------------

  tbody.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const product = products.find(
      item => item.id === button.dataset.productId
    );

    if (!product) {
      showMessage("Product not found. Refresh the list and try again.", "error");
      return;
    }

    if (button.dataset.action === "edit") {
      openProductDialog(product);
      return;
    }

    if (button.dataset.action === "delete") {
      const confirmed = window.confirm(
        `Delete "${product.name}"?\n\nPreviously issued invoices must retain their saved product details.`
      );

      if (!confirmed) return;

      button.disabled = true;

      try {
        await databaseSDK.remove(
          databaseSDK.ref(db, `${PRODUCTS_PATH}/${product.id}`)
        );

        showMessage("Product deleted successfully.", "success");
      } catch (error) {
        console.error("Products: Delete failed.", error);
        showMessage("Product could not be deleted. Check Firebase access.", "error");
        button.disabled = false;
      }
    }
  });

  // --------------------------------------------------
  // SEARCH / FILTERS
  // --------------------------------------------------

  searchInput?.addEventListener("input", renderProducts);
  categoryFilter?.addEventListener("change", renderProducts);
  availabilityFilter?.addEventListener("change", renderProducts);

  filtersForm?.addEventListener("reset", () => {
    window.setTimeout(renderProducts, 0);
  });

  // --------------------------------------------------
  // SELECTION
  // --------------------------------------------------

  selectAllCheckbox?.addEventListener("change", () => {
    tbody.querySelectorAll(".product-select").forEach(checkbox => {
      checkbox.checked = selectAllCheckbox.checked;
    });

    selectAllCheckbox.indeterminate = false;
  });

  tbody.addEventListener("change", event => {
    if (!event.target.matches(".product-select")) return;

    const checkboxes = [...tbody.querySelectorAll(".product-select")];
    const count = checkboxes.filter(item => item.checked).length;

    if (selectAllCheckbox) {
      selectAllCheckbox.checked =
        checkboxes.length > 0 && count === checkboxes.length;

      selectAllCheckbox.indeterminate =
        count > 0 && count < checkboxes.length;
    }
  });

  // --------------------------------------------------
  // BULK ACTIONS
  // --------------------------------------------------

  applyBulkActionButton?.addEventListener("click", async () => {
    if (!db || !databaseSDK || saving) return;

    const action = bulkActionSelect?.value;

    if (!["activate", "deactivate", "delete"].includes(action)) {
      showMessage("Select a valid bulk action.", "error");
      return;
    }

    const selectedIds = [...tbody.querySelectorAll(".product-select:checked")]
      .map(checkbox => checkbox.closest("tr")?.dataset.productId)
      .filter(Boolean);

    if (!selectedIds.length) {
      showMessage("Select at least one product.", "error");
      return;
    }

    if (action === "delete" && !window.confirm(
      `Delete ${selectedIds.length} selected product(s)?`
    )) {
      return;
    }

    applyBulkActionButton.disabled = true;

    try {
      const updates = {};

      selectedIds.forEach(id => {
        if (action === "delete") {
          updates[id] = null;
        } else {
          const product = products.find(item => item.id === id);
          if (product) {
            updates[`${id}/active`] = action === "activate";
            updates[`${id}/updatedAt`] = new Date().toISOString();
          }
        }
      });

      await databaseSDK.update(
        databaseSDK.ref(db, PRODUCTS_PATH),
        updates
      );

      bulkActionSelect.value = "";
      showMessage("Bulk action completed successfully.", "success");
    } catch (error) {
      console.error("Products: Bulk action failed.", error);
      showMessage("Bulk action failed. Check Firebase access.", "error");
    } finally {
      applyBulkActionButton.disabled = false;
    }
  });

  // --------------------------------------------------
  // CSV EXPORT
  // --------------------------------------------------

  exportButton?.addEventListener("click", () => {
    if (loading || databaseError) {
      showMessage("Load products successfully before exporting.", "error");
      return;
    }

    const filtered = getFilteredProducts();

    if (!filtered.length) {
      showMessage("There are no products to export.", "info");
      return;
    }

    function csvCell(value) {
      let text = String(value ?? "");

      if (/^[\s]*[=+\-@]/.test(text)) {
        text = "'" + text;
      }

      return `"${text.replace(/"/g, '""')}"`;
    }

    const headers = [
      "Product ID",
      "Product Name",
      "Description",
      "Category",
      "SKU",
      "Price INR",
      "Stock",
      "Availability"
    ];

    const rows = filtered.map(product => [
      product.id,
      product.name,
      product.description,
      product.category,
      product.sku,
      product.price.toFixed(2),
      product.stock,
      product.active ? "Active" : "Inactive"
    ]);

    const csv = [
      headers.map(csvCell).join(","),
      ...rows.map(row => row.map(csvCell).join(","))
    ].join("\r\n");

    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // --------------------------------------------------
  // START
  // --------------------------------------------------

  // Remove the static sample product rows immediately.
  tbody.replaceChildren();

  // Replace hardcoded category filter options with database categories.
  updateCategoryOptions();

  // Show empty summaries until real records load.
  updateSummary();

  console.info("Products: Firebase integration starting.");
  initialiseFirebase();
})();
