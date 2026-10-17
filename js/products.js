"use strict";

/*
 * Restaurant Billing Software
 * File: js/products.js
 *
 * Phase 1: Frontend demo functionality.
 * Data temporarily stays in memory and resets after page reload.
 * Firebase Realtime Database integration will replace this demo data later.
 */

(() => {
  const table = document.getElementById("productsTable");
  const tbody = table?.querySelector("tbody");

  if (!table || !tbody) {
    console.error("Product Management: Products table was not found.");
    return;
  }

  // --------------------------------------------------
  // DOM REFERENCES
  // --------------------------------------------------

  const searchInput = document.getElementById("productSearch");
  const categoryFilter = document.getElementById("categoryFilter");
  const availabilityFilter = document.getElementById("availabilityFilter");
  const filtersForm = document.getElementById("productFilters");
  const resetFiltersButton = document.getElementById("resetProductFilters");

  const addProductButton = document.getElementById("addProductBtn");
  const exportButton = document.getElementById("exportProductsBtn");

  const selectAllCheckbox = document.getElementById("selectAllProducts");
  const bulkActionSelect = document.getElementById("bulkAction");
  const applyBulkActionButton = document.getElementById("applyBulkAction");

  // --------------------------------------------------
  // HELPERS
  // --------------------------------------------------

  const currency = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2
  });

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

  function formatMoney(amount) {
    return currency.format(Number(amount) || 0);
  }

  function normalise(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function createProductId() {
    return `P-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function createSKU() {
    let sequence = 1;
    let sku;

    do {
      sku = `SKU-${String(sequence).padStart(3, "0")}`;
      sequence++;
    } while (
      products.some(product => normalise(product.sku) === normalise(sku))
    );

    return sku;
  }

  function isLowStock(product) {
    return product.stock > 0 && product.stock <= 10;
  }

  // --------------------------------------------------
  // LOAD EXISTING DEMO PRODUCTS FROM HTML
  // --------------------------------------------------

  function readInitialProducts() {
    return Array.from(tbody.querySelectorAll("tr[data-product-id]"))
      .map(row => {
        const cells = row.querySelectorAll("td");

        if (cells.length < 8) {
          return null;
        }

        const name = cells[1].querySelector(".cust-name")?.textContent.trim();
        const description = cells[1].querySelector(".cust-sub")?.textContent.trim();
        const category = cells[2].textContent.trim();
        const sku = cells[3].textContent.trim();

        const priceText = cells[4].textContent.replace(/[₹,\s]/g, "");
        const stockText = cells[5].textContent.trim();

        const statusText = cells[6].textContent.trim().toLowerCase();

        const price = Number.parseFloat(priceText);
        const stock = Number.parseInt(stockText, 10);

        if (
          !name ||
          !category ||
          !Number.isFinite(price) ||
          !Number.isFinite(stock)
        ) {
          return null;
        }

        return {
          id: row.dataset.productId || createProductId(),
          name,
          description: description || "",
          category,
          sku: sku === "—" ? "" : sku,
          price,
          stock: Math.max(0, stock),
          active: statusText !== "inactive"
        };
      })
      .filter(Boolean);
  }

  let products = readInitialProducts();

  // --------------------------------------------------
  // PRODUCT SUMMARY
  // --------------------------------------------------

  function updateSummary() {
    const kpiValues = document.querySelectorAll(".kpi .kpi-value");

    const activeCount = products.filter(product => product.active).length;

    const lowStockCount = products.filter(
      product => product.active && product.stock <= 10
    ).length;

    const categoryCount = new Set(
      products.map(product => product.category)
    ).size;

    const summary = [
      products.length,
      activeCount,
      lowStockCount,
      categoryCount
    ];

    kpiValues.forEach((element, index) => {
      if (index < summary.length) {
        element.textContent = summary[index].toLocaleString("en-IN");
      }
    });
  }

  // --------------------------------------------------
  // CATEGORY FILTERS
  // --------------------------------------------------

  function updateCategoryOptions() {
    if (!categoryFilter) return;

    const currentValue = categoryFilter.value;

    const categories = [
      ...new Set(products.map(product => product.category))
    ].sort((a, b) => a.localeCompare(b));

    categoryFilter.innerHTML = `
      <option value="">All Categories</option>
      ${categories.map(category => `
        <option value="${escapeHTML(category)}">
          ${escapeHTML(category)}
        </option>
      `).join("")}
    `;

    if (categories.includes(currentValue)) {
      categoryFilter.value = currentValue;
    }
  }

  // --------------------------------------------------
  // FILTER PRODUCTS
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

      const matchesCategory =
        !category || product.category === category;

      const matchesAvailability =
        !availability ||
        (availability === "active" && product.active) ||
        (availability === "inactive" && !product.active);

      return matchesSearch && matchesCategory && matchesAvailability;
    });
  }

  // --------------------------------------------------
  // PRODUCT TABLE
  // --------------------------------------------------

  function renderProducts() {
    const filteredProducts = getFilteredProducts();

    if (filteredProducts.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:32px 16px;">
            <strong>No products found</strong>
            <div style="margin-top:6px;">
              Try another search or change your filters.
            </div>
          </td>
        </tr>
      `;
    } else {
      tbody.innerHTML = filteredProducts.map(product => {
        const initial = product.name.charAt(0).toUpperCase();

        let statusClass = "paid";
        let statusText = "Active";

        if (!product.active) {
          statusClass = "cancelled";
          statusText = "Inactive";
        }

        let stockHTML = String(product.stock);

        if (product.active && product.stock === 0) {
          stockHTML = `
            <span class="pill cancelled">Out of Stock</span>
          `;
        } else if (isLowStock(product) && product.active) {
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
                <div class="cust-avatar">${escapeHTML(initial)}</div>

                <div>
                  <div class="cust-name">
                    ${escapeHTML(product.name)}
                  </div>

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

            <td>
              <span class="pill ${statusClass}">${statusText}</span>
            </td>

            <td>
              <button
                class="btn-icon"
                type="button"
                data-action="edit"
                data-product-id="${escapeHTML(product.id)}"
                aria-label="Edit ${escapeHTML(product.name)}"
                title="Edit product"
              >
                <svg viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round">
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
                <svg viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2"
                  stroke-linecap="round" stroke-linejoin="round">
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

    if (selectAllCheckbox) {
      selectAllCheckbox.checked = false;
      selectAllCheckbox.indeterminate = false;
    }

    updateSummary();
  }

  // --------------------------------------------------
  // ADD / EDIT PRODUCT DIALOG
  // --------------------------------------------------

  function createProductDialog() {
    const dialog = document.createElement("dialog");

    dialog.id = "productDialog";
    dialog.setAttribute("aria-labelledby", "productDialogTitle");

    dialog.style.cssText = `
      width: min(560px, calc(100% - 28px));
      max-width: 560px;
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
          <h3 id="productDialogTitle">Add Product</h3>
          <p id="productDialogDescription">
            Enter the product details below.
          </p>
        </div>

        <button
          type="button"
          class="btn-icon"
          id="closeProductDialog"
          aria-label="Close dialog"
        >&#10005;</button>
      </div>

      <form id="productForm">

        <input type="hidden" id="editProductId">

        <div style="display:grid;gap:16px;margin-top:20px;">

          <label>
            Product Name *
            <input
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text"
              id="productName"
              name="name"
              maxlength="100"
              required
              autocomplete="off"
              placeholder="e.g. Chicken Biryani"
            >
          </label>

          <label>
            Description
            <input
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text"
              id="productDescription"
              name="description"
              maxlength="200"
              placeholder="Optional product description"
            >
          </label>

          <label>
            Category *
            <input
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text"
              id="productCategory"
              name="category"
              list="productCategoryOptions"
              maxlength="60"
              required
              autocomplete="off"
              placeholder="Enter or select a category"
            >
            <datalist id="productCategoryOptions"></datalist>
          </label>

          <label>
            SKU
            <input
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text"
              id="productSKU"
              name="sku"
              maxlength="50"
              autocomplete="off"
              placeholder="Optional product code"
            >
          </label>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">

            <label>
              Price (₹) *
              <input
                class="btn btn-outline"
                style="display:block;width:100%;margin-top:6px;text-align:left;"
                type="number"
                id="productPrice"
                name="price"
                min="0"
                max="99999999"
                step="0.01"
                required
                placeholder="0.00"
              >
            </label>

            <label>
              Stock Quantity *
              <input
                class="btn btn-outline"
                style="display:block;width:100%;margin-top:6px;text-align:left;"
                type="number"
                id="productStock"
                name="stock"
                min="0"
                max="999999999"
                step="1"
                required
                placeholder="0"
              >
            </label>

          </div>

          <label>
            Availability
            <select
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              id="productStatus"
              name="status"
            >
              <option value="active">Active — Available for billing</option>
              <option value="inactive">Inactive — Hidden from billing</option>
            </select>
          </label>

        </div>

        <div class="page-actions" style="justify-content:flex-end;margin-top:24px;">
          <button type="button" class="btn btn-soft" id="cancelProductDialog">
            Cancel
          </button>

          <button type="submit" class="btn btn-primary" id="saveProductButton">
            Save Product
          </button>
        </div>

        <p
          id="productFormMessage"
          role="alert"
          style="margin-top:12px;"
        ></p>

      </form>
    `;

    document.body.appendChild(dialog);

    return dialog;
  }

  const productDialog = createProductDialog();
  const productForm = document.getElementById("productForm");

  function updateFormCategories() {
    const datalist = document.getElementById("productCategoryOptions");

    const categories = [
      ...new Set(products.map(product => product.category))
    ].sort((a, b) => a.localeCompare(b));

    datalist.innerHTML = categories.map(category => `
      <option value="${escapeHTML(category)}"></option>
    `).join("");
  }

  function openProductDialog(product = null) {
    productForm.reset();

    document.getElementById("productFormMessage").textContent = "";
    document.getElementById("editProductId").value = product?.id || "";

    document.getElementById("productDialogTitle").textContent =
      product ? "Edit Product" : "Add Product";

    document.getElementById("productDialogDescription").textContent =
      product
        ? "Update the product information."
        : "Enter the new product information.";

    document.getElementById("saveProductButton").textContent =
      product ? "Update Product" : "Save Product";

    document.getElementById("productName").value =
      product?.name || "";

    document.getElementById("productDescription").value =
      product?.description || "";

    document.getElementById("productCategory").value =
      product?.category || "";

    document.getElementById("productSKU").value =
      product?.sku || "";

    document.getElementById("productPrice").value =
      product?.price ?? "";

    document.getElementById("productStock").value =
      product?.stock ?? 0;

    document.getElementById("productStatus").value =
      product?.active === false ? "inactive" : "active";

    updateFormCategories();

    if (typeof productDialog.showModal === "function") {
      productDialog.showModal();
    } else {
      alert("Your browser does not support the product dialog.");
    }

    document.getElementById("productName").focus();
  }

  function closeProductDialog() {
    if (productDialog.open) {
      productDialog.close();
    }
  }

  document.getElementById("closeProductDialog").addEventListener(
    "click",
    closeProductDialog
  );

  document.getElementById("cancelProductDialog").addEventListener(
    "click",
    closeProductDialog
  );

  // --------------------------------------------------
  // SAVE NEW PRODUCT / UPDATE EXISTING PRODUCT
  // --------------------------------------------------

  productForm.addEventListener("submit", event => {
    event.preventDefault();

    const id = document.getElementById("editProductId").value;

    const name = document.getElementById("productName").value.trim();

    const description = document
      .getElementById("productDescription")
      .value.trim();

    const category = document
      .getElementById("productCategory")
      .value.trim();

    let sku = document.getElementById("productSKU").value.trim();

    const price = Number(
      document.getElementById("productPrice").value
    );

    const stock = Number(
      document.getElementById("productStock").value
    );

    const active =
      document.getElementById("productStatus").value === "active";

    const message = document.getElementById("productFormMessage");

    message.textContent = "";

    if (!name || !category) {
      message.textContent = "Product name and category are required.";
      return;
    }

    if (
      !Number.isFinite(price) ||
      price < 0 ||
      price > 99999999
    ) {
      message.textContent = "Enter a valid product price.";
      return;
    }

    if (
      !Number.isSafeInteger(stock) ||
      stock < 0 ||
      stock > 999999999
    ) {
      message.textContent = "Enter a valid whole-number stock quantity.";
      return;
    }

    const duplicateName = products.some(product =>
      product.id !== id &&
      normalise(product.name) === normalise(name) &&
      normalise(product.category) === normalise(category)
    );

    if (duplicateName) {
      message.textContent =
        "A product with this name already exists in this category.";
      return;
    }

    if (!sku) {
      sku = createSKU();
    }

    const duplicateSKU = products.some(product =>
      product.id !== id &&
      normalise(product.sku) === normalise(sku)
    );

    if (duplicateSKU) {
      message.textContent = "This SKU is already assigned to another product.";
      return;
    }

    if (id) {
      const product = products.find(item => item.id === id);

      if (!product) {
        message.textContent = "Product not found. Refresh and try again.";
        return;
      }

      Object.assign(product, {
        name,
        description,
        category,
        sku,
        price,
        stock,
        active
      });
    } else {
      products.push({
        id: createProductId(),
        name,
        description,
        category,
        sku,
        price,
        stock,
        active
      });
    }

    updateCategoryOptions();
    renderProducts();
    closeProductDialog();

    console.info(
      id ? "Product updated." : "Product added."
    );
  });

  // --------------------------------------------------
  // EDIT / DELETE PRODUCT
  // --------------------------------------------------

  tbody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const { action, productId } = button.dataset;

    const product = products.find(item => item.id === productId);

    if (!product) {
      alert("Product not found. Refresh and try again.");
      return;
    }

    if (action === "edit") {
      openProductDialog(product);
      return;
    }

    if (action === "delete") {
      const confirmed = window.confirm(
        `Delete "${product.name}"?\n\n` +
        "This removes it from the current product list. " +
        "Previously issued invoices must retain their saved product details."
      );

      if (!confirmed) return;

      products = products.filter(item => item.id !== productId);

      updateCategoryOptions();
      renderProducts();
    }
  });

  // --------------------------------------------------
  // SEARCH AND FILTERS
  // --------------------------------------------------

  searchInput?.addEventListener("input", renderProducts);
  categoryFilter?.addEventListener("change", renderProducts);
  availabilityFilter?.addEventListener("change", renderProducts);

  filtersForm?.addEventListener("reset", () => {
    window.setTimeout(renderProducts, 0);
  });

  resetFiltersButton?.addEventListener("click", () => {
    // The form's native reset event handles rendering.
  });

  // --------------------------------------------------
  // SELECT ALL VISIBLE PRODUCTS
  // --------------------------------------------------

  selectAllCheckbox?.addEventListener("change", () => {
    tbody.querySelectorAll(".product-select").forEach(checkbox => {
      checkbox.checked = selectAllCheckbox.checked;
    });

    selectAllCheckbox.indeterminate = false;
  });

  tbody.addEventListener("change", event => {
    if (!event.target.matches(".product-select")) return;

    const checkboxes = Array.from(
      tbody.querySelectorAll(".product-select")
    );

    const selectedCount = checkboxes.filter(
      checkbox => checkbox.checked
    ).length;

    if (selectAllCheckbox) {
      selectAllCheckbox.checked =
        checkboxes.length > 0 &&
        selectedCount === checkboxes.length;

      selectAllCheckbox.indeterminate =
        selectedCount > 0 &&
        selectedCount < checkboxes.length;
    }
  });

  // --------------------------------------------------
  // BULK ACTIONS
  // --------------------------------------------------

  applyBulkActionButton?.addEventListener("click", () => {
    const action = bulkActionSelect?.value;

    if (!action) {
      alert("Please select a bulk action first.");
      return;
    }

    const selectedIds = Array.from(
      tbody.querySelectorAll(".product-select:checked")
    ).map(checkbox => (
      checkbox.closest("tr")?.dataset.productId
    )).filter(Boolean);

    if (selectedIds.length === 0) {
      alert("Please select at least one product.");
      return;
    }

    if (action === "delete") {
      const confirmed = window.confirm(
        `Delete ${selectedIds.length} selected product(s)?\n\n` +
        "Previously issued invoices must retain their saved product details."
      );

      if (!confirmed) return;

      const selectedSet = new Set(selectedIds);

      products = products.filter(
        product => !selectedSet.has(product.id)
      );
    }

    if (action === "activate") {
      products.forEach(product => {
        if (selectedIds.includes(product.id)) {
          product.active = true;
        }
      });
    }

    if (action === "deactivate") {
      products.forEach(product => {
        if (selectedIds.includes(product.id)) {
          product.active = false;
        }
      });
    }

    bulkActionSelect.value = "";

    updateCategoryOptions();
    renderProducts();
  });

  // --------------------------------------------------
  // EXPORT FILTERED PRODUCTS TO CSV
  // --------------------------------------------------

  exportButton?.addEventListener("click", () => {
    const exportProducts = getFilteredProducts();

    if (exportProducts.length === 0) {
      alert("There are no products to export.");
      return;
    }

    function csvCell(value) {
      let text = String(value ?? "");

      // Protect spreadsheet users from formula injection.
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
      "Price (INR)",
      "Stock Quantity",
      "Availability"
    ];

    const rows = exportProducts.map(product => [
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

    const blob = new Blob(
      ["\uFEFF", csv],
      { type: "text/csv;charset=utf-8;" }
    );

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

  updateCategoryOptions();
  renderProducts();

  // Allow the Add Product button to open the dialog.
  addProductButton?.addEventListener("click", () => {
    openProductDialog();
  });

  console.info("Product Management initialised successfully.");
})();
