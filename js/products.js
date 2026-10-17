
"use strict";

/*
 * Restaurant Billing Software
 * File: js/products.js
 *
 * Firebase Realtime Database integration.
 * No demo products or local product persistence.
 *
 * Products:   restaurantBilling/products
 * Categories: restaurantBilling/categories
 */

(() => {
  const ADMIN_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const PRODUCTS_PATH = "restaurantBilling/products";
  const CATEGORIES_PATH = "restaurantBilling/categories";

  const $ = id => document.getElementById(id);

  const table = $("productsTable");
  const tbody = table?.querySelector("tbody");

  if (!table || !tbody) {
    console.error("Products: Product table was not found.");
    return;
  }

  // --------------------------------------------------
  // DOM REFERENCES
  // --------------------------------------------------

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

  // --------------------------------------------------
  // STATE
  // --------------------------------------------------

  let db = null;
  let databaseSDK = null;

  let products = [];
  let categories = [];

  let loadingProducts = true;
  let loadingCategories = true;
  let databaseError = null;
  let saving = false;

  let unsubscribeAuth = null;
  let unsubscribeProducts = null;
  let unsubscribeCategories = null;

  let authStarted = false;
  let currentUser = null;
  let dialog = null;

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

  function isLowStock(product) {
    return product.stock <= 10;
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

  function validProductRecord(product) {
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

  function validCategoryRecord(category) {
    return Boolean(
      category &&
      typeof category.name === "string" &&
      category.name.trim()
    );
  }

  function getActiveCategories() {
    return categories
      .filter(category => category.active)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getCategoryByName(name) {
    return categories.find(
      category => normalise(category.name) === normalise(name)
    );
  }

  function createSKU() {
    const prefix = `SKU-${Date.now().toString(36).toUpperCase()}`;
    const existing = new Set(products.map(product => normalise(product.sku)));

    if (!existing.has(normalise(prefix))) {
      return prefix;
    }

    return `${prefix}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  // --------------------------------------------------
  // FIREBASE INITIALISATION
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
        throw new Error("Firebase Authentication is unavailable.");
      }

      db = firebase.db;

      databaseSDK = await import(
        "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js"
      );

      if (authStarted) return;
      authStarted = true;

      const result = await window.restaurantAuth.watchAuth(user => {
        if (!user || user.uid !== ADMIN_UID) {
          stopDatabaseListeners();

          currentUser = null;
          products = [];
          categories = [];

          loadingProducts = false;
          loadingCategories = false;

          renderProducts();
          showMessage("Administrator authentication is required.", "error");
          return;
        }

        currentUser = user;
        startDatabaseListeners();
      });

      if (typeof result === "function") {
        unsubscribeAuth = result;
      }
    } catch (error) {
      console.error("Products: Firebase initialisation failed.", error);

      databaseError = error;
      loadingProducts = false;
      loadingCategories = false;

      products = [];
      categories = [];

      renderProducts();

      showMessage(
        "Unable to connect to Firebase. Check your connection and database configuration.",
        "error"
      );
    }
  }

  function stopDatabaseListeners() {
    unsubscribeProducts?.();
    unsubscribeCategories?.();

    unsubscribeProducts = null;
    unsubscribeCategories = null;

    loadingProducts = true;
    loadingCategories = true;
  }

  // --------------------------------------------------
  // LIVE PRODUCT DATA
  // --------------------------------------------------

  function startDatabaseListeners() {
    if (!db || !databaseSDK || !currentUser) return;

    if (unsubscribeProducts || unsubscribeCategories) return;

    loadingProducts = true;
    loadingCategories = true;
    databaseError = null;

    unsubscribeProducts = databaseSDK.onValue(
      databaseSDK.ref(db, PRODUCTS_PATH),
      snapshot => {
        const data = snapshot.val() || {};

        products = Object.entries(data)
          .filter(([, record]) => validProductRecord(record))
          .map(([id, record]) => ({
            id,
            name: record.name.trim(),
            description: String(record.description || ""),
            category: record.category.trim(),
            sku: String(record.sku || ""),
            price: Number(record.price),
            stock: Number(record.stock),
            active: record.active,
            createdAt: record.createdAt || null,
            updatedAt: record.updatedAt || null
          }));

        loadingProducts = false;

        updateCategoryFilter();
        updateCategoryDropdown();
        renderProducts();
      },
      handleDatabaseError
    );

    // Listen to the master category collection independently.
    unsubscribeCategories = databaseSDK.onValue(
      databaseSDK.ref(db, CATEGORIES_PATH),
      snapshot => {
        const data = snapshot.val() || {};

        categories = Object.entries(data)
          .filter(([, record]) => validCategoryRecord(record))
          .map(([id, record]) => ({
            id,
            name: record.name.trim(),
            description: String(record.description || ""),
            active: record.active !== false,
            createdAt: record.createdAt || null,
            updatedAt: record.updatedAt || null
          }));

        loadingCategories = false;

        updateCategoryFilter();
        updateCategoryDropdown();
        renderProducts();
      },
      handleDatabaseError
    );
  }

  function handleDatabaseError(error) {
    console.error("Products: Firebase database error.", error);

    databaseError = error;

    renderProducts();

    showMessage(
      "Unable to read or update Firebase data. Check your connection and database Rules.",
      "error"
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
      products.filter(product => product.active && isLowStock(product)).length,
      categories.length
    ];

    values.forEach((element, index) => {
      if (index < summary.length) {
        element.textContent = summary[index].toLocaleString("en-IN");
      }
    });
  }

  // --------------------------------------------------
  // FILTER DROPDOWN
  // --------------------------------------------------

  function updateCategoryFilter() {
    if (!categoryFilter) return;

    const previousValue = categoryFilter.value;

    const names = [...new Set(
      categories.map(category => category.name)
    )].sort((a, b) => a.localeCompare(b));

    categoryFilter.innerHTML = `
      <option value="">All Categories</option>
      ${names.map(name => `
        <option value="${escapeHTML(name)}">${escapeHTML(name)}</option>
      `).join("")}
    `;

    if (names.includes(previousValue)) {
      categoryFilter.value = previousValue;
    }
  }

  // --------------------------------------------------
  // ADD / EDIT DIALOG
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
          <p id="productDialogDescription">Enter the product details.</p>
        </div>

        <button type="button" class="btn-icon" id="closeProductDialog"
          aria-label="Close dialog">×</button>
      </div>

      <form id="productForm">
        <input type="hidden" id="editProductId">

        <div style="display:grid;gap:16px;margin-top:20px;">
          <label for="productName">
            Product Name *
            <input class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text" id="productName" maxlength="100"
              required autocomplete="off" placeholder="Enter product name">
          </label>

          <label for="productDescription">
            Description
            <input class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text" id="productDescription" maxlength="200"
              placeholder="Optional description">
          </label>

          <label for="productCategory">
            Category *
            <select class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              id="productCategory" required>
              <option value="">Loading categories...</option>
            </select>
            <small id="productCategoryHelp"
              style="display:block;margin-top:6px;color:#6b7280;font-size:12px;">
              Categories are loaded from Firebase.
            </small>
          </label>

          <label for="productSKU">
            SKU
            <input class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text" id="productSKU" maxlength="50"
              autocomplete="off" placeholder="Optional product code">
          </label>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
            <label for="productPrice">
              Price (₹) *
              <input class="btn btn-outline"
                style="display:block;width:100%;margin-top:6px;text-align:left;"
                type="number" id="productPrice" min="0"
                max="99999999" step="0.01" required placeholder="0.00">
            </label>

            <label for="productStock">
              Stock Quantity *
              <input class="btn btn-outline"
                style="display:block;width:100%;margin-top:6px;text-align:left;"
                type="number" id="productStock" min="0"
                max="999999999" step="1" required value="0">
            </label>
          </div>

          <label for="productStatus">
            Availability
            <select class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              id="productStatus">
              <option value="active">Active — Available for billing</option>
              <option value="inactive">Inactive — Hidden from billing</option>
            </select>
          </label>

          <p id="productFormMessage" role="alert" aria-live="polite"
            style="margin:0;font-size:13px;"></p>
        </div>

        <div class="page-actions" style="justify-content:flex-end;margin-top:24px;">
          <button type="button" class="btn btn-soft" id="cancelProductDialog">
            Cancel
          </button>

          <button type="submit" class="btn btn-primary" id="saveProductButton">
            Save Product
          </button>
        </div>
      </form>
    `;

    document.body.appendChild(element);
    return element;
  }

  dialog = createProductDialog();

  const productForm = $("productForm");

  // --------------------------------------------------
  // MASTER CATEGORY DROPDOWN
  // --------------------------------------------------

  function updateCategoryDropdown(currentProductCategory = "") {
    const select = $("productCategory");
    const help = $("productCategoryHelp");

    if (!select) return;

    const previousValue = select.value;

    select.innerHTML = "";

    const placeholder = document.createElement("option");
    placeholder.value = "";

    if (loadingCategories) {
      placeholder.textContent = "Loading categories...";
    } else if (databaseError) {
      placeholder.textContent = "Categories could not be loaded";
    } else {
      placeholder.textContent = "Select a category";
    }

    select.appendChild(placeholder);

    const activeCategories = getActiveCategories();
    const currentCategory = currentProductCategory
      ? getCategoryByName(currentProductCategory)
      : null;

    // Show all active master categories when creating a product.
    activeCategories.forEach(category => {
      const option = document.createElement("option");
      option.value = category.name;
      option.textContent = category.name;
      select.appendChild(option);
    });

    // When editing an older product, preserve its existing category
    // even if the category has since been deactivated.
    if (
      currentCategory &&
      !currentCategory.active &&
      !activeCategories.some(category =>
        normalise(category.name) === normalise(currentCategory.name)
      )
    ) {
      const option = document.createElement("option");
      option.value = currentCategory.name;
      option.textContent = `${currentCategory.name} (Inactive — current product)`;
      select.appendChild(option);
    }

    if (currentProductCategory) {
      const matchingOption = Array.from(select.options).find(
        option => normalise(option.value) === normalise(currentProductCategory)
      );

      if (matchingOption) {
        select.value = matchingOption.value;
      }
    } else if (
      previousValue &&
      Array.from(select.options).some(option => option.value === previousValue)
    ) {
      select.value = previousValue;
    }

    select.disabled = loadingCategories || Boolean(databaseError);

    if (loadingCategories) {
      help.textContent = "Loading master categories from Firebase.";
    } else if (databaseError) {
      help.textContent = "Unable to load categories. Check Firebase access.";
    } else if (activeCategories.length === 0) {
      help.textContent = "No active categories found. Add one on the Categories page first.";
    } else {
      help.textContent = "Choose an active category from the Categories page.";
    }
  }

  function openProductDialog(product = null) {
    productForm.reset();

    $("productFormMessage").textContent = "";
    $("editProductId").value = product?.id || "";

    $("productDialogTitle").textContent =
      product ? "Edit Product" : "Add Product";

    $("productDialogDescription").textContent =
      product ? "Update the product details." : "Create a new product.";

    $("saveProductButton").textContent =
      product ? "Update Product" : "Save Product";

    $("productName").value = product?.name || "";
    $("productDescription").value = product?.description || "";
    $("productSKU").value = product?.sku || "";
    $("productPrice").value = product?.price ?? "";
    $("productStock").value = product?.stock ?? 0;

    $("productStatus").value =
      product?.active === false ? "inactive" : "active";

    updateCategoryDropdown(product?.category || "");

    if (typeof dialog.showModal !== "function") {
      showMessage("This browser does not support the product dialog.", "error");
      return;
    }

    dialog.showModal();
    $("productName").focus();
  }

  function closeProductDialog() {
    if (dialog?.open) {
      dialog.close();
    }
  }

  $("closeProductDialog").addEventListener("click", closeProductDialog);
  $("cancelProductDialog").addEventListener("click", closeProductDialog);

  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      closeProductDialog();
    }
  });

  addProductButton?.addEventListener("click", () => {
    openProductDialog();
  });

  // --------------------------------------------------
  // SEARCH AND FILTERS
  // --------------------------------------------------

  function getFilteredProducts() {
    const search = normalise(searchInput?.value);
    const category = categoryFilter?.value || "";
    const availability = availabilityFilter?.value || "";

    return products.filter(product => {
      const searchableText = [
        product.name,
        product.description,
        product.category,
        product.sku
      ].map(normalise).join(" ");

      const matchesSearch = !search || searchableText.includes(search);
      const matchesCategory = !category || product.category === category;

      const matchesAvailability =
        !availability ||
        (availability === "active" && product.active) ||
        (availability === "inactive" && !product.active);

      return matchesSearch && matchesCategory && matchesAvailability;
    });
  }

  // --------------------------------------------------
  // RENDER PRODUCTS
  // --------------------------------------------------

  function renderProducts() {
    if (loadingProducts || loadingCategories) {
      showTableMessage("Loading products and categories from Firebase...");
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
        stockHTML = `${product.stock} <span class="pill pending">Low Stock</span>`;
      }

      return `
        <tr data-product-id="${escapeHTML(product.id)}">
          <td>
            <input type="checkbox" class="product-select"
              aria-label="Select ${escapeHTML(product.name)}">
          </td>

          <td>
            <div class="cust">
              <div class="cust-avatar">${escapeHTML(product.name.charAt(0).toUpperCase())}</div>
              <div>
                <div class="cust-name">${escapeHTML(product.name)}</div>
                <div class="cust-sub">${escapeHTML(product.description || "No description")}</div>
              </div>
            </div>
          </td>

          <td>${escapeHTML(product.category)}</td>
          <td class="mono">${escapeHTML(product.sku || "—")}</td>
          <td class="num">${formatMoney(product.price)}</td>
          <td>${stockHTML}</td>
          <td><span class="pill ${statusClass}">${statusText}</span></td>

          <td>
            <button class="btn-icon" type="button"
              data-action="edit" data-product-id="${escapeHTML(product.id)}"
              aria-label="Edit ${escapeHTML(product.name)}" title="Edit product">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/>
              </svg>
            </button>

            <button class="btn-icon" type="button"
              data-action="delete" data-product-id="${escapeHTML(product.id)}"
              aria-label="Delete ${escapeHTML(product.name)}" title="Delete product">
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
  // SAVE / UPDATE PRODUCT
  // --------------------------------------------------

  productForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (saving || !db || !databaseSDK || !currentUser) return;

    const id = $("editProductId").value;
    const existingProduct = products.find(product => product.id === id);

    const name = $("productName").value.trim();
    const description = $("productDescription").value.trim();
    const categoryName = $("productCategory").value;
    let sku = $("productSKU").value.trim();

    const price = Number($("productPrice").value);
    const stock = Number($("productStock").value);
    const active = $("productStatus").value === "active";

    const message = $("productFormMessage");
    message.textContent = "";

    if (!name || !categoryName) {
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

    // The selected category must exist in the master Categories list.
    const selectedCategory = getCategoryByName(categoryName);

    if (!selectedCategory) {
      message.textContent =
        "This category no longer exists. Refresh the list and choose another category.";
      return;
    }

    // New products must use active categories.
    // Existing products can retain their unchanged inactive category.
    const keepingExistingInactiveCategory = Boolean(
      existingProduct &&
      !selectedCategory.active &&
      normalise(existingProduct.category) === normalise(selectedCategory.name)
    );

    if (!selectedCategory.active && !keepingExistingInactiveCategory) {
      message.textContent =
        "This category is inactive. Choose an active category or activate it on the Categories page.";
      return;
    }

    const duplicateName = products.some(product =>
      product.id !== id &&
      normalise(product.name) === normalise(name) &&
      normalise(product.category) === normalise(categoryName)
    );

    if (duplicateName) {
      message.textContent =
        "A product with this name already exists in this category.";
      return;
    }

    if (!sku) sku = createSKU();

    const duplicateSKU = products.some(product =>
      product.id !== id &&
      product.sku &&
      normalise(product.sku) === normalise(sku)
    );

    if (duplicateSKU) {
      message.textContent = "This SKU is already assigned to another product.";
      return;
    }

    const now = new Date().toISOString();

    const record = {
      name,
      description,
      category: selectedCategory.name,
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
        const newProductRef = databaseSDK.push(
          databaseSDK.ref(db, PRODUCTS_PATH)
        );

        await databaseSDK.set(newProductRef, record);
      }

      closeProductDialog();

      showMessage(
        id ? "Product updated successfully." : "Product saved successfully.",
        "success"
      );
    } catch (error) {
      console.error("Products: Save failed.", error);

      message.textContent =
        "Could not save the product. Check your connection and Firebase Rules.";
    } finally {
      saving = false;

      setButtonBusy(
        $("saveProductButton"),
        false,
        "Saving...",
        id ? "Update Product" : "Save Product"
      );
    }
  });

  // --------------------------------------------------
  // EDIT / DELETE PRODUCT
  // --------------------------------------------------

  tbody.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const product = products.find(
      item => item.id === button.dataset.productId
    );

    if (!product) {
      showMessage("Product not found. Refresh and try again.", "error");
      return;
    }

    if (button.dataset.action === "edit") {
      openProductDialog(product);
      return;
    }

    if (button.dataset.action === "delete") {
      const confirmed = window.confirm(
        `Delete "${product.name}"?\n\nPreviously issued invoices should retain their saved product details.`
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
  // SEARCH AND FILTER EVENTS
  // --------------------------------------------------

  searchInput?.addEventListener("input", renderProducts);
  categoryFilter?.addEventListener("change", renderProducts);
  availabilityFilter?.addEventListener("change", renderProducts);

  filtersForm?.addEventListener("reset", () => {
    window.setTimeout(renderProducts, 0);
  });

  // --------------------------------------------------
  // SELECT ALL
  // --------------------------------------------------

  selectAllCheckbox?.addEventListener("change", () => {
    tbody.querySelectorAll(".product-select").forEach(checkbox => {
      checkbox.checked = selectAllCheckbox.checked;
    });

    selectAllCheckbox.indeterminate = false;
  });

  tbody.addEventListener("change", event => {
    if (!event.target.matches(".product-select")) return;

    const boxes = [...tbody.querySelectorAll(".product-select")];
    const selectedCount = boxes.filter(box => box.checked).length;

    if (selectAllCheckbox) {
      selectAllCheckbox.checked =
        boxes.length > 0 && selectedCount === boxes.length;

      selectAllCheckbox.indeterminate =
        selectedCount > 0 && selectedCount < boxes.length;
    }
  });

  // --------------------------------------------------
  // BULK ACTIONS
  // --------------------------------------------------

  applyBulkActionButton?.addEventListener("click", async () => {
    if (!db || !databaseSDK || saving || !currentUser) return;

    const action = bulkActionSelect?.value;

    if (!["activate", "deactivate", "delete"].includes(action)) {
      showMessage("Choose a supported bulk action.", "error");
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
      const now = new Date().toISOString();

      selectedIds.forEach(id => {
        if (action === "delete") {
          updates[id] = null;
        } else {
          updates[`${id}/active`] = action === "activate";
          updates[`${id}/updatedAt`] = now;
        }
      });

      await databaseSDK.update(
        databaseSDK.ref(db, PRODUCTS_PATH),
        updates
      );

      if (bulkActionSelect) bulkActionSelect.value = "";

      showMessage("Bulk action completed successfully.", "success");
    } catch (error) {
      console.error("Products: Bulk action failed.", error);
      showMessage("Bulk action failed. Check Firebase access.", "error");
    } finally {
      applyBulkActionButton.disabled = false;
    }
  });

  // --------------------------------------------------
  // EXPORT PRODUCTS TO CSV
  // --------------------------------------------------

  exportButton?.addEventListener("click", () => {
    if (loadingProducts || loadingCategories || databaseError) {
      showMessage("Wait for Firebase data to load before exporting.", "error");
      return;
    }

    const records = getFilteredProducts();

    if (!records.length) {
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

    const rows = records.map(product => [
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
  // INITIALISE PAGE
  // --------------------------------------------------

  tbody.replaceChildren();
  updateSummary();
  updateCategoryFilter();
  updateCategoryDropdown();

  console.info("Products: Firebase integration starting.");

  initialiseFirebase();

  window.addEventListener("beforeunload", () => {
    unsubscribeProducts?.();
    unsubscribeCategories?.();
    unsubscribeAuth?.();
  });
})();
