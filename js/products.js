/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Products and Categories Management
   Database:
     restaurantBilling/products
     restaurantBilling/categories
     restaurantBilling/settings
   No demo data, secrets or localStorage persistence
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const PATHS = Object.freeze({
    products: "restaurantBilling/products",
    categories: "restaurantBilling/categories",
    settings: "restaurantBilling/settings"
  });

  const $ = function (id) {
    return document.getElementById(id);
  };

  const state = {
    db: null,
    api: null,

    products: [],
    categories: [],
    settings: {},

    productsLoaded: false,
    categoriesLoaded: false,
    settingsLoaded: false,

    loadingError: false,
    operationInProgress: false,
    disposed: false,

    subscriptions: [],
    editingProductId: null,
    editingCategoryId: null
  };

  /* ---------------------------------------------------------
     1. Common helpers
     --------------------------------------------------------- */

  function setText(id, value) {
    const node = $(id);
    if (!node) return;

    node.textContent =
      value === null || value === undefined ? "" : String(value);
  }

  function showMessage(id, message, type) {
    const node = $(id);
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
    const node = $("productsPageStatus");
    if (!node) return;

    node.textContent = message || "";

    node.classList.remove(
      "is-connected",
      "is-error",
      "is-warning"
    );

    if (type) {
      node.classList.add("is-" + type);
    }
  }

  function normalizeText(value) {
    return String(value ?? "").trim();
  }

  function normalizeSearch(value) {
    return normalizeText(value)
      .normalize("NFKC")
      .toLocaleLowerCase();
  }

  function readValue(object, keys) {
    for (const key of keys) {
      const value = object && object[key];

      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }

    return null;
  }

  function readNumber(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const number = Number(value);

    return Number.isFinite(number) ? number : null;
  }

  function money(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount)) return "—";

    if (
      window.restaurantUI &&
      typeof window.restaurantUI.formatCurrency === "function"
    ) {
      return window.restaurantUI.formatCurrency(amount);
    }

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function timestamp() {
    return {
      updatedAt: new Date().toISOString(),
      updatedAtMs: Date.now()
    };
  }

  function getEntries(data) {
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

  function isActive(record) {
    return record.isActive !== false &&
      record.active !== false &&
      record.deleted !== true &&
      !record.deletedAt;
  }

  function getProductName(product) {
    return normalizeText(
      readValue(product, [
        "productName",
        "name",
        "itemName",
        "title"
      ]) || ""
    );
  }

  function getProductPrice(product) {
    const value = readNumber(
      readValue(product, [
        "price",
        "unitPrice",
        "sellingPrice",
        "amount"
      ])
    );

    return value !== null && value >= 0 ? value : null;
  }

  function getProductCategoryId(product) {
    return normalizeText(
      readValue(product, [
        "categoryId",
        "categoryID",
        "categoryKey"
      ]) || ""
    );
  }

  function getProductCategoryName(product) {
    return normalizeText(
      readValue(product, [
        "categoryName",
        "category"
      ]) || ""
    );
  }

  function getCategoryName(category) {
    return normalizeText(
      readValue(category, [
        "categoryName",
        "name",
        "title"
      ]) || ""
    );
  }

  function getProductCategory(product) {
    const categoryId = getProductCategoryId(product);

    const match = state.categories.find(function (category) {
      return category._recordKey === categoryId;
    });

    if (match) return getCategoryName(match);

    return getProductCategoryName(product);
  }

  function getActiveProducts() {
    return state.products.filter(function (product) {
      return isActive(product) && getProductName(product);
    });
  }

  function getActiveCategories() {
    return state.categories.filter(function (category) {
      return isActive(category) && getCategoryName(category);
    });
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

    const api = firebase.sdk.database;

    [
      "ref",
      "get",
      "onValue",
      "push",
      "set",
      "update",
      "remove"
    ].forEach(function (method) {
      if (typeof api[method] !== "function") {
        throw new Error(
          "Required Firebase database method is unavailable: " + method
        );
      }
    });

    return {
      db: firebase.db,
      api: api
    };
  }

  function requireAuthorizedOwner() {
    const access = window.restaurantAccess;

    if (
      !access ||
      !access.ready ||
      !access.authorized ||
      !access.user ||
      access.user.uid !== OWNER_UID
    ) {
      throw new Error("Only the authorized owner may manage products.");
    }

    return access.user;
  }

  function safeErrorMessage(error, operation) {
    const code = error && error.code ? error.code : "";

    if (code === "PERMISSION_DENIED" || code === "permission-denied") {
      return "Database permission denied. Check Firebase Security Rules.";
    }

    if (code === "NETWORK_ERROR" || code === "unavailable") {
      return "Database connection failed. Check your internet connection.";
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return "Unable to " + operation + ". Please try again.";
  }

  /* ---------------------------------------------------------
     2. Settings and branding
     --------------------------------------------------------- */

  function getBusinessSettings() {
    const settings = state.settings || {};

    return (
      settings.businessProfile ||
      settings.business ||
      settings.profile ||
      settings.forms?.businessProfileForm ||
      settings.forms?.businessProfile ||
      settings
    );
  }

  function renderBranding() {
    const business = getBusinessSettings();

    const name = normalizeText(
      readValue(business, [
        "businessName",
        "name"
      ]) || ""
    );

    const tagline = normalizeText(
      readValue(business, [
        "businessTagline",
        "tagline",
        "description"
      ]) || ""
    );

    if (name) {
      document.querySelectorAll("[data-business-name]").forEach(function (node) {
        node.textContent = name;
      });

      setText("sidebarBusinessName", name);
      setText("businessFooterName", name);

      const mark = $("brandMark");

      if (mark) {
        mark.textContent = name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map(function (part) {
            return part.charAt(0).toUpperCase();
          })
          .join("");
      }
    } else {
      setText("sidebarBusinessName", "");
      setText("businessFooterName", "");
    }

    if (tagline) {
      document.querySelectorAll("[data-business-tagline]").forEach(function (node) {
        node.textContent = tagline;
      });

      setText("sidebarBusinessTagline", tagline);
    } else {
      setText("sidebarBusinessTagline", "");
    }

    const user = window.restaurantAccess?.user;
    const displayName = normalizeText(
      user?.displayName || user?.email || ""
    );

    setText("ownerDisplayName", displayName);
    setText(
      "ownerAvatar",
      displayName ? displayName.charAt(0).toUpperCase() : ""
    );
    setText("ownerDisplayRole", "Owner");
  }

  /* ---------------------------------------------------------
     3. Product and category select controls
     --------------------------------------------------------- */

  function populateCategorySelects() {
    const categorySelect = $("productCategory");
    const filterSelect = $("productCategoryFilter");

    if (categorySelect) {
      const previouslySelected = categorySelect.value;
      categorySelect.replaceChildren();

      const placeholder = document.createElement("option");
      placeholder.value = "";

      if (!state.categoriesLoaded) {
        placeholder.textContent = "Loading saved categories...";
        categorySelect.appendChild(placeholder);
        categorySelect.disabled = true;
      } else {
        const categories = getActiveCategories();

        placeholder.textContent = categories.length
          ? "Select a category"
          : "Add a category first";

        categorySelect.appendChild(placeholder);

        categories
          .slice()
          .sort(function (a, b) {
            return getCategoryName(a).localeCompare(getCategoryName(b));
          })
          .forEach(function (category) {
            const option = document.createElement("option");
            option.value = category._recordKey;
            option.textContent = getCategoryName(category);
            categorySelect.appendChild(option);
          });

        categorySelect.disabled =
          state.operationInProgress || categories.length === 0;

        if (
          previouslySelected &&
          categories.some(function (category) {
            return category._recordKey === previouslySelected;
          })
        ) {
          categorySelect.value = previouslySelected;
        }
      }
    }

    if (filterSelect) {
      const previousFilter = filterSelect.value;
      filterSelect.replaceChildren();

      const allOption = document.createElement("option");
      allOption.value = "";
      allOption.textContent = "All categories";
      filterSelect.appendChild(allOption);

      getActiveCategories()
        .slice()
        .sort(function (a, b) {
          return getCategoryName(a).localeCompare(getCategoryName(b));
        })
        .forEach(function (category) {
          const option = document.createElement("option");
          option.value = category._recordKey;
          option.textContent = getCategoryName(category);
          filterSelect.appendChild(option);
        });

      if (
        previousFilter &&
        getActiveCategories().some(function (category) {
          return category._recordKey === previousFilter;
        })
      ) {
        filterSelect.value = previousFilter;
      }
    }
  }

  /* ---------------------------------------------------------
     4. Safe table rendering
     --------------------------------------------------------- */

  function addTextCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = String(value ?? "");
    row.appendChild(cell);

    return cell;
  }

  function addActionButton(cell, label, className, callback) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.disabled = state.operationInProgress;

    button.addEventListener("click", callback);

    cell.appendChild(button);

    return button;
  }

  function showEmptyRow(body, colspan, text) {
    body.replaceChildren();

    const row = document.createElement("tr");
    const cell = document.createElement("td");

    cell.colSpan = colspan;
    cell.className = "table-empty";
    cell.textContent = text;

    row.appendChild(cell);
    body.appendChild(row);
  }

  function linkedProductCount(category) {
    return state.products.filter(function (product) {
      const productCategoryId = getProductCategoryId(product);

      if (productCategoryId) {
        return productCategoryId === category._recordKey;
      }

      return normalizeSearch(getProductCategoryName(product)) ===
        normalizeSearch(getCategoryName(category));
    }).length;
  }

  /* ---------------------------------------------------------
     5. Products table and filtering
     --------------------------------------------------------- */

  function renderProductsTable() {
    const body = $("productsTableBody");
    if (!body) return;

    if (!state.productsLoaded) {
      showEmptyRow(body, 4, "Loading saved products.");
      setText("productListSummary", "Loading product records.");
      return;
    }

    const search = normalizeSearch($("productSearch")?.value);
    const categoryFilter = normalizeText($("productCategoryFilter")?.value);

    const products = getActiveProducts()
      .filter(function (product) {
        const nameMatches = normalizeSearch(getProductName(product))
          .includes(search);

        const productCategoryId = getProductCategoryId(product);

        const categoryMatches = !categoryFilter ||
          productCategoryId === categoryFilter ||
          (
            !productCategoryId &&
            state.categories.some(function (category) {
              return category._recordKey === categoryFilter &&
                normalizeSearch(getProductCategoryName(product)) ===
                normalizeSearch(getCategoryName(category));
            })
          );

        return nameMatches && categoryMatches;
      })
      .sort(function (a, b) {
        return getProductName(a).localeCompare(getProductName(b));
      });

    body.replaceChildren();

    if (!products.length) {
      showEmptyRow(
        body,
        4,
        search || categoryFilter
          ? "No matching products found."
          : "No saved products yet."
      );

      setText("productListSummary", "0 matching products");
      return;
    }

    products.forEach(function (product) {
      const row = document.createElement("tr");

      addTextCell(row, getProductName(product));
      addTextCell(row, getProductCategory(product) || "Uncategorised");

      const price = getProductPrice(product);

      addTextCell(
        row,
        price === null ? "Invalid price" : money(price)
      );

      const actionCell = document.createElement("td");
      actionCell.className = "table-actions";

      addActionButton(
        actionCell,
        "Edit",
        "btn btn-secondary btn-small",
        function () {
          editProduct(product._recordKey);
        }
      );

      addActionButton(
        actionCell,
        "Delete",
        "btn btn-danger btn-small",
        function () {
          deleteProduct(product._recordKey);
        }
      );

      row.appendChild(actionCell);
      body.appendChild(row);
    });

    setText(
      "productListSummary",
      "Showing " + products.length + " of " +
      getActiveProducts().length + " active products"
    );
  }

  /* ---------------------------------------------------------
     6. Categories table
     --------------------------------------------------------- */

  function renderCategoriesTable() {
    const body = $("categoriesTableBody");
    if (!body) return;

    if (!state.categoriesLoaded) {
      showEmptyRow(body, 3, "Loading saved categories.");
      setText("categoryListSummary", "Loading category records.");
      return;
    }

    const categories = getActiveCategories()
      .slice()
      .sort(function (a, b) {
        return getCategoryName(a).localeCompare(getCategoryName(b));
      });

    body.replaceChildren();

    if (!categories.length) {
      showEmptyRow(body, 3, "No saved categories yet.");
      setText("categoryListSummary", "0 saved categories");
      return;
    }

    categories.forEach(function (category) {
      const row = document.createElement("tr");

      addTextCell(row, getCategoryName(category));
      addTextCell(row, String(linkedProductCount(category)));

      const actionCell = document.createElement("td");
      actionCell.className = "table-actions";

      addActionButton(
        actionCell,
        "Edit",
        "btn btn-secondary btn-small",
        function () {
          editCategory(category._recordKey);
        }
      );

      addActionButton(
        actionCell,
        "Delete",
        "btn btn-danger btn-small",
        function () {
          deleteCategory(category._recordKey);
        }
      );

      row.appendChild(actionCell);
      body.appendChild(row);
    });

    setText(
      "categoryListSummary",
      categories.length + " saved categories"
    );
  }

  function renderOverview() {
    setText(
      "totalProductCount",
      state.productsLoaded ? String(getActiveProducts().length) : "—"
    );

    setText(
      "totalCategoryCount",
      state.categoriesLoaded ? String(getActiveCategories().length) : "—"
    );
  }

  function renderAll() {
    if (state.disposed) return;

    populateCategorySelects();
    renderProductsTable();
    renderCategoriesTable();
    renderOverview();
    renderBranding();

    if (state.loadingError) {
      setPageStatus(
        "One or more data sources could not be loaded. Check database permissions and connection.",
        "error"
      );
      return;
    }

    if (
      state.productsLoaded &&
      state.categoriesLoaded &&
      state.settingsLoaded
    ) {
      setPageStatus(
        "Products, categories and settings are connected to the database.",
        "connected"
      );

      setText("sidebarConnectionStatus", "Database connected");
      setText("productsFooterStatus", "Live database connected");
    } else {
      setPageStatus("Loading live business records...", "warning");
    }
  }

  /* ---------------------------------------------------------
     7. Form state management
     --------------------------------------------------------- */

  function setOperationState(busy) {
    state.operationInProgress = busy;

    [
      "saveProductBtn",
      "resetProductFormBtn",
      "cancelProductEditBtn",
      "saveCategoryBtn",
      "resetCategoryFormBtn",
      "cancelCategoryEditBtn"
    ].forEach(function (id) {
      const node = $(id);
      if (node) node.disabled = busy;
    });

    populateCategorySelects();
    renderProductsTable();
    renderCategoriesTable();
  }

  function resetProductEditor() {
    state.editingProductId = null;

    if ($("productId")) {
      $("productId").value = "";
    }

    if ($("productForm")) {
      $("productForm").reset();
    }

    setText("saveProductBtn", "Save Product");

    if ($("cancelProductEditBtn")) {
      $("cancelProductEditBtn").hidden = true;
    }

    showMessage("productFormMessage", "");
  }

  function resetCategoryEditor() {
    state.editingCategoryId = null;

    if ($("categoryId")) {
      $("categoryId").value = "";
    }

    if ($("categoryForm")) {
      $("categoryForm").reset();
    }

    setText("saveCategoryBtn", "Add Category");

    if ($("cancelCategoryEditBtn")) {
      $("cancelCategoryEditBtn").hidden = true;
    }

    showMessage("categoryFormMessage", "");
  }

  /* ---------------------------------------------------------
     8. Product add and edit
     --------------------------------------------------------- */

  function productDuplicate(name, categoryId, excludeId) {
    const candidate = normalizeSearch(name);

    return getActiveProducts().some(function (product) {
      if (product._recordKey === excludeId) return false;

      const sameName = normalizeSearch(getProductName(product)) === candidate;
      const existingCategory = getProductCategoryId(product);

      return sameName && existingCategory === categoryId;
    });
  }

  async function saveProduct(event) {
    event.preventDefault();

    if (state.operationInProgress) return;

    showMessage("productFormMessage", "");

    const name = normalizeText($("productName")?.value);
    const price = readNumber($("productPrice")?.value);
    const categoryId = normalizeText($("productCategory")?.value);

    if (!name) {
      showMessage("productFormMessage", "Enter a product name.", "error");
      $("productName")?.focus();
      return;
    }

    if (name.length > 120) {
      showMessage("productFormMessage", "Product name is too long.", "error");
      return;
    }

    if (price === null || price <= 0 || price > 99999999) {
      showMessage("productFormMessage", "Enter a valid positive item price.", "error");
      $("productPrice")?.focus();
      return;
    }

    if (!categoryId) {
      showMessage("productFormMessage", "Select a saved category first.", "error");
      $("productCategory")?.focus();
      return;
    }

    const category = getActiveCategories().find(function (record) {
      return record._recordKey === categoryId;
    });

    if (!category) {
      showMessage(
        "productFormMessage",
        "The selected category is no longer available. Refresh and try again.",
        "error"
      );
      return;
    }

    const editId = state.editingProductId;

    if (productDuplicate(name, categoryId, editId)) {
      showMessage(
        "productFormMessage",
        "A product with this name already exists in this category.",
        "error"
      );
      return;
    }

    try {
      requireAuthorizedOwner();

      const record = {
        productName: name,
        name: name,
        price: Math.round(price * 100) / 100,
        categoryId: categoryId,
        categoryName: getCategoryName(category),
        isActive: true,
        ownerUid: OWNER_UID,
        ...timestamp()
      };

      setOperationState(true);

      if (editId) {
        await state.api.update(
          state.api.ref(state.db, PATHS.products + "/" + editId),
          record
        );

        showMessage("productFormMessage", "Product updated successfully.", "success");
      } else {
        const newRef = state.api.push(
          state.api.ref(state.db, PATHS.products)
        );

        await state.api.set(newRef, {
          ...record,
          createdAt: new Date().toISOString(),
          createdAtMs: Date.now()
        });

        showMessage("productFormMessage", "Product saved successfully.", "success");
      }

      resetProductEditor();

    } catch (error) {
      console.error("Product save failed:", {
        code: error && error.code ? error.code : "product-save-error"
      });

      showMessage(
        "productFormMessage",
        safeErrorMessage(error, "save the product"),
        "error"
      );
    } finally {
      setOperationState(false);
    }
  }

  function editProduct(productId) {
    const product = state.products.find(function (record) {
      return record._recordKey === productId;
    });

    if (!product) {
      showMessage("productFormMessage", "The selected product was not found.", "error");
      return;
    }

    state.editingProductId = productId;

    $("productId").value = productId;
    $("productName").value = getProductName(product);

    const price = getProductPrice(product);
    $("productPrice").value = price === null ? "" : String(price);

    $("productCategory").value = getProductCategoryId(product);

    setText("saveProductBtn", "Update Product");

    if ($("cancelProductEditBtn")) {
      $("cancelProductEditBtn").hidden = false;
    }

    showMessage(
      "productFormMessage",
      "Editing " + getProductName(product) + ".",
      "warning"
    );

    $("productForm")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    $("productName")?.focus();
  }

  async function deleteProduct(productId) {
    if (state.operationInProgress) return;

    const product = state.products.find(function (record) {
      return record._recordKey === productId;
    });

    if (!product) return;

    const name = getProductName(product);

    const confirmed = window.confirm(
      "Delete product \"" + name + "\"?\n\n" +
      "Previously recorded invoices keep their saved item details. " +
      "This removes the product from the saved product list."
    );

    if (!confirmed) return;

    try {
      requireAuthorizedOwner();
      setOperationState(true);

      await state.api.remove(
        state.api.ref(state.db, PATHS.products + "/" + productId)
      );

      if (state.editingProductId === productId) {
        resetProductEditor();
      }

      showMessage("productFormMessage", "Product deleted.", "success");

    } catch (error) {
      console.error("Product deletion failed:", {
        code: error && error.code ? error.code : "product-delete-error"
      });

      showMessage(
        "productFormMessage",
        safeErrorMessage(error, "delete the product"),
        "error"
      );
    } finally {
      setOperationState(false);
    }
  }

  /* ---------------------------------------------------------
     9. Category add and edit
     --------------------------------------------------------- */

  function categoryDuplicate(name, excludeId) {
    const candidate = normalizeSearch(name);

    return getActiveCategories().some(function (category) {
      if (category._recordKey === excludeId) return false;

      return normalizeSearch(getCategoryName(category)) === candidate;
    });
  }

  async function saveCategory(event) {
    event.preventDefault();

    if (state.operationInProgress) return;

    showMessage("categoryFormMessage", "");

    const name = normalizeText($("categoryName")?.value);

    if (!name) {
      showMessage("categoryFormMessage", "Enter a category name.", "error");
      $("categoryName")?.focus();
      return;
    }

    if (name.length > 100) {
      showMessage("categoryFormMessage", "Category name is too long.", "error");
      return;
    }

    const editId = state.editingCategoryId;

    if (categoryDuplicate(name, editId)) {
      showMessage(
        "categoryFormMessage",
        "A category with this name already exists.",
        "error"
      );
      return;
    }

    try {
      requireAuthorizedOwner();

      const record = {
        categoryName: name,
        name: name,
        isActive: true,
        ownerUid: OWNER_UID,
        ...timestamp()
      };

      setOperationState(true);

      if (editId) {
        await state.api.update(
          state.api.ref(state.db, PATHS.categories + "/" + editId),
          record
        );

        showMessage(
          "categoryFormMessage",
          "Category updated successfully.",
          "success"
        );
      } else {
        const newRef = state.api.push(
          state.api.ref(state.db, PATHS.categories)
        );

        await state.api.set(newRef, {
          ...record,
          createdAt: new Date().toISOString(),
          createdAtMs: Date.now()
        });

        showMessage(
          "categoryFormMessage",
          "Category saved successfully.",
          "success"
        );
      }

      resetCategoryEditor();

    } catch (error) {
      console.error("Category save failed:", {
        code: error && error.code ? error.code : "category-save-error"
      });

      showMessage(
        "categoryFormMessage",
        safeErrorMessage(error, "save the category"),
        "error"
      );
    } finally {
      setOperationState(false);
    }
  }

  function editCategory(categoryId) {
    const category = state.categories.find(function (record) {
      return record._recordKey === categoryId;
    });

    if (!category) {
      showMessage("categoryFormMessage", "The selected category was not found.", "error");
      return;
    }

    state.editingCategoryId = categoryId;

    $("categoryId").value = categoryId;
    $("categoryName").value = getCategoryName(category);

    setText("saveCategoryBtn", "Update Category");

    if ($("cancelCategoryEditBtn")) {
      $("cancelCategoryEditBtn").hidden = false;
    }

    showMessage(
      "categoryFormMessage",
      "Editing " + getCategoryName(category) + ".",
      "warning"
    );

    $("categoryForm")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    $("categoryName")?.focus();
  }

  async function deleteCategory(categoryId) {
    if (state.operationInProgress) return;

    const category = state.categories.find(function (record) {
      return record._recordKey === categoryId;
    });

    if (!category) return;

    const linkedCount = linkedProductCount(category);

    if (linkedCount > 0) {
      showMessage(
        "categoryFormMessage",
        "This category is used by " + linkedCount +
        " product(s). Reassign or delete those products first.",
        "warning"
      );

      $("categoryForm")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

      return;
    }

    const name = getCategoryName(category);

    if (!window.confirm("Delete category \"" + name + "\"?")) {
      return;
    }

    try {
      requireAuthorizedOwner();
      setOperationState(true);

      /*
       * Recheck the linked-product constraint against Firebase
       * immediately before deletion to reduce stale-data risk.
       */
      const productsSnapshot = await state.api.get(
        state.api.ref(state.db, PATHS.products)
      );

      const latestProducts = getEntries(
        productsSnapshot.exists() ? productsSnapshot.val() : null
      );

      const latestLinked = latestProducts.some(function (product) {
        if (!isActive(product)) return false;

        const productCategoryId = getProductCategoryId(product);

        if (productCategoryId) {
          return productCategoryId === categoryId;
        }

        return normalizeSearch(getProductCategoryName(product)) ===
          normalizeSearch(name);
      });

      if (latestLinked) {
        showMessage(
          "categoryFormMessage",
          "This category now has linked products. It cannot be deleted.",
          "warning"
        );
        return;
      }

      await state.api.remove(
        state.api.ref(state.db, PATHS.categories + "/" + categoryId)
      );

      if (state.editingCategoryId === categoryId) {
        resetCategoryEditor();
      }

      showMessage("categoryFormMessage", "Category deleted.", "success");

    } catch (error) {
      console.error("Category deletion failed:", {
        code: error && error.code ? error.code : "category-delete-error"
      });

      showMessage(
        "categoryFormMessage",
        safeErrorMessage(error, "delete the category"),
        "error"
      );
    } finally {
      setOperationState(false);
    }
  }

  /* ---------------------------------------------------------
     10. Live database subscriptions
     --------------------------------------------------------- */

  function subscribe(path, onSuccess, onError) {
    const reference = state.api.ref(state.db, path);

    const unsubscribe = state.api.onValue(
      reference,

      function (snapshot) {
        if (state.disposed) return;

        onSuccess(snapshot);
        renderAll();
      },

      function (error) {
        if (state.disposed) return;

        state.loadingError = true;

        console.error("Products page database read failed:", {
          path: path,
          code: error && error.code ? error.code : "unknown"
        });

        setPageStatus(
          "A database read failed. Check Firebase connection and Security Rules.",
          "error"
        );

        if (typeof onError === "function") {
          onError(error);
        }

        renderAll();
      }
    );

    state.subscriptions.push(unsubscribe);
  }

  /* ---------------------------------------------------------
     11. Event binding
     --------------------------------------------------------- */

  $("productForm")?.addEventListener("submit", saveProduct);

  $("categoryForm")?.addEventListener("submit", saveCategory);

  $("productSearch")?.addEventListener("input", renderProductsTable);

  $("productCategoryFilter")?.addEventListener(
    "change",
    renderProductsTable
  );

  $("cancelProductEditBtn")?.addEventListener(
    "click",
    resetProductEditor
  );

  $("cancelCategoryEditBtn")?.addEventListener(
    "click",
    resetCategoryEditor
  );

  $("resetProductFormBtn")?.addEventListener(
    "click",
    resetProductEditor
  );

  $("resetCategoryFormBtn")?.addEventListener(
    "click",
    resetCategoryEditor
  );

  /* ---------------------------------------------------------
     12. Initialization
     --------------------------------------------------------- */

  async function initialize() {
    try {
      setPageStatus("Checking owner authorization...", "warning");

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
        throw new Error("Only the authorized owner may manage products.");
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

      subscribe(
        PATHS.products,
        function (snapshot) {
          state.products = getEntries(
            snapshot.exists() ? snapshot.val() : null
          );

          state.productsLoaded = true;
          state.loadingError = false;
        }
      );

      subscribe(
        PATHS.categories,
        function (snapshot) {
          state.categories = getEntries(
            snapshot.exists() ? snapshot.val() : null
          );

          state.categoriesLoaded = true;
          state.loadingError = false;
        }
      );

      subscribe(
        PATHS.settings,
        function (snapshot) {
          state.settings = snapshot.exists()
            ? snapshot.val()
            : {};

          state.settingsLoaded = true;
          state.loadingError = false;
        }
      );

    } catch (error) {
      state.loadingError = true;

      console.error("Products page initialization failed:", {
        message: error instanceof Error
          ? error.message
          : "Unknown initialization error"
      });

      setPageStatus(
        safeErrorMessage(error, "initialize the products page"),
        "error"
      );
    }
  }

  window.addEventListener("pagehide", function () {
    state.disposed = true;

    state.subscriptions.forEach(function (unsubscribe) {
      try {
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      } catch (_) {
        /* No action is needed during page cleanup. */
      }
    });

    state.subscriptions = [];
  });

  renderAll();
  initialize();

})();
