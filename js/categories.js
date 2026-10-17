
"use strict";

/*
 * Restaurant Billing Software
 * File: js/categories.js
 *
 * Firebase Realtime Database integration.
 * No demo categories or local category persistence.
 *
 * Database paths:
 * restaurantBilling/categories
 * restaurantBilling/products
 */

(() => {
  // --------------------------------------------------
  // CONFIGURATION
  // --------------------------------------------------

  const ADMIN_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const CATEGORIES_PATH = "restaurantBilling/categories";
  const PRODUCTS_PATH = "restaurantBilling/products";

  // --------------------------------------------------
  // DOM REFERENCES
  // --------------------------------------------------

  const table = document.getElementById("categoriesTable");
  const tbody = document.getElementById("categoriesTableBody");

  if (!table || !tbody) {
    console.error("Categories: Category table was not found.");
    return;
  }

  const $ = id => document.getElementById(id);

  const addCategoryButton = $("addCategoryBtn");
  const exportButton = $("exportCategoriesBtn");
  const searchInput = $("categorySearch");
  const statusFilter = $("categoryStatusFilter");
  const filtersForm = $("categoryFilters");
  const selectAllCheckbox = $("selectAllCategories");

  const totalOutput = $("totalCategoriesValue");
  const activeOutput = $("activeCategoriesValue");
  const assignedOutput = $("assignedProductsValue");
  const emptyOutput = $("emptyCategoriesValue");
  const recordCountLabel = $("categoryRecordCount");
  const paginationInfo = $("categoryPaginationInfo");

  const bulkActionSelect = $("categoryBulkAction");
  const applyBulkActionButton = $("applyCategoryBulkAction");

  // --------------------------------------------------
  // STATE
  // --------------------------------------------------

  let db = null;
  let databaseSDK = null;

  let categories = [];
  let products = [];

  let categoriesLoaded = false;
  let productsLoaded = false;
  let loading = true;
  let databaseError = null;
  let saving = false;
  let syncingCategories = false;

  let unsubscribeCategories = null;
  let unsubscribeProducts = null;

  let categoryDialog = null;

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

  function showMessage(message, type = "info") {
    let element = $("categoryMessage");

    if (!element) {
      element = document.createElement("div");
      element.id = "categoryMessage";
      element.setAttribute("role", "status");
      element.setAttribute("aria-live", "polite");
      element.style.cssText =
        "margin:12px 0;padding:12px 14px;border:1px solid #d1d5db;border-radius:5px;background:#fff;color:#111827;font-size:13px;line-height:1.6;";

      const pageHead = document.querySelector(".page-head");

      if (pageHead) {
        pageHead.insertAdjacentElement("afterend", element);
      } else {
        table.insertAdjacentElement("beforebegin", element);
      }
    }

    element.textContent = message;
    element.dataset.type = type;
    element.hidden = false;
  }

  function clearMessage() {
    const element = $("categoryMessage");

    if (element) {
      element.textContent = "";
      element.hidden = true;
      delete element.dataset.type;
    }
  }

  function showTableMessage(message) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;padding:32px 16px;">
          ${escapeHTML(message)}
        </td>
      </tr>
    `;
  }

  function createTimestamp() {
    return new Date().toISOString();
  }

  function validCategoryRecord(record) {
    return Boolean(
      record &&
      typeof record.name === "string" &&
      record.name.trim()
    );
  }

  function getProductCount(categoryName) {
    return products.filter(product =>
      normalise(product.category) === normalise(categoryName)
    ).length;
  }

  function categoryNameExists(name, exceptId = "") {
    return categories.some(category =>
      category.id !== exceptId &&
      normalise(category.name) === normalise(name)
    );
  }

  function setButtonBusy(button, busy, busyText, normalText) {
    if (!button) return;

    button.disabled = busy;
    button.textContent = busy ? busyText : normalText;
  }

  // --------------------------------------------------
  // FIREBASE INITIALISATION
  // --------------------------------------------------

  async function initialiseFirebase() {
    showTableMessage("Connecting to Firebase...");

    try {
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
          unsubscribeCategories?.();
          unsubscribeProducts?.();

          unsubscribeCategories = null;
          unsubscribeProducts = null;

          categories = [];
          products = [];
          loading = false;

          renderCategories();

          showMessage(
            "Administrator authentication is required.",
            "error"
          );

          return;
        }

        startDatabaseListeners();
      });
    } catch (error) {
      console.error("Categories: Firebase initialisation failed.", error);

      databaseError = error;
      loading = false;

      categories = [];
      products = [];

      renderCategories();

      showMessage(
        "Unable to connect to Firebase. Check your internet connection and configuration.",
        "error"
      );
    }
  }

  // --------------------------------------------------
  // LIVE DATABASE LISTENERS
  // --------------------------------------------------

  function startDatabaseListeners() {
    if (
      !db ||
      !databaseSDK ||
      unsubscribeCategories ||
      unsubscribeProducts
    ) {
      return;
    }

    const categoriesRef = databaseSDK.ref(db, CATEGORIES_PATH);
    const productsRef = databaseSDK.ref(db, PRODUCTS_PATH);

    unsubscribeCategories = databaseSDK.onValue(
      categoriesRef,
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

        categoriesLoaded = true;
        refreshDatabaseState();
      },
      handleDatabaseError
    );

    unsubscribeProducts = databaseSDK.onValue(
      productsRef,
      snapshot => {
        const data = snapshot.val() || {};

        products = Object.entries(data)
          .filter(([, record]) =>
            record &&
            typeof record === "object" &&
            typeof record.category === "string" &&
            record.category.trim()
          )
          .map(([id, record]) => ({
            id,
            category: record.category.trim()
          }));

        productsLoaded = true;
        refreshDatabaseState();
      },
      handleDatabaseError
    );
  }

  function handleDatabaseError(error) {
    console.error("Categories: Database operation failed.", error);

    databaseError = error;
    loading = false;

    renderCategories();

    showMessage(
      "Firebase could not load or update the records. Check database Rules and administrator sign-in.",
      "error"
    );
  }

  function refreshDatabaseState() {
    if (!categoriesLoaded || !productsLoaded) {
      loading = true;
      renderCategories();
      return;
    }

    loading = false;
    databaseError = null;

    // Existing real products may have been saved before category
    // records were introduced. Create records only from actual data.
    renderCategories();
    syncMissingProductCategories();
  }

  // --------------------------------------------------
  // SYNC CATEGORIES FROM ACTUAL PRODUCTS
  // --------------------------------------------------

  async function syncMissingProductCategories() {
    if (
      syncingCategories ||
      !categoriesLoaded ||
      !productsLoaded ||
      !db ||
      !databaseSDK
    ) {
      return;
    }

    const knownNames = new Set(
      categories.map(category => normalise(category.name))
    );

    const missingNames = [
      ...new Set(
        products
          .map(product => product.category.trim())
          .filter(name => name && !knownNames.has(normalise(name)))
      )
    ];

    if (!missingNames.length) {
      return;
    }

    syncingCategories = true;

    try {
      const categoriesRef = databaseSDK.ref(db, CATEGORIES_PATH);
      const updates = {};
      const now = createTimestamp();

      for (const name of missingNames) {
        // Avoid creating two records for case-insensitive duplicate names.
        const key = normalise(name);

        if (knownNames.has(key)) continue;

        const newCategoryRef = databaseSDK.push(categoriesRef);

        updates[newCategoryRef.key] = {
          name,
          description: "",
          active: true,
          createdAt: now,
          updatedAt: now
        };

        knownNames.add(key);
      }

      if (Object.keys(updates).length) {
        await databaseSDK.update(categoriesRef, updates);
      }
    } catch (error) {
      console.error("Categories: Existing product categories could not be synchronised.", error);

      showMessage(
        "Some existing product categories could not be registered. Check Firebase access.",
        "error"
      );
    } finally {
      syncingCategories = false;
    }
  }

  // --------------------------------------------------
  // SUMMARY
  // --------------------------------------------------

  function updateSummary() {
    const total = categories.length;

    const active = categories.filter(
      category => category.active
    ).length;

    const assigned = categories.reduce(
      (sum, category) => sum + getProductCount(category.name),
      0
    );

    const empty = categories.filter(
      category => getProductCount(category.name) === 0
    ).length;

    if (totalOutput) {
      totalOutput.textContent = total.toLocaleString("en-IN");
    }

    if (activeOutput) {
      activeOutput.textContent = active.toLocaleString("en-IN");
    }

    if (assignedOutput) {
      assignedOutput.textContent = assigned.toLocaleString("en-IN");
    }

    if (emptyOutput) {
      emptyOutput.textContent = empty.toLocaleString("en-IN");
    }

    if (recordCountLabel) {
      recordCountLabel.textContent =
        `${total} Record${total === 1 ? "" : "s"}`;
    }
  }

  // --------------------------------------------------
  // SEARCH AND STATUS FILTERS
  // --------------------------------------------------

  function getFilteredCategories() {
    const search = normalise(searchInput?.value);
    const selectedStatus = statusFilter?.value || "";

    return categories.filter(category => {
      const searchable = [
        category.id,
        category.name,
        category.description
      ].map(normalise).join(" ");

      const matchesSearch =
        !search || searchable.includes(search);

      const matchesStatus =
        !selectedStatus ||
        (selectedStatus === "active" && category.active) ||
        (selectedStatus === "inactive" && !category.active);

      return matchesSearch && matchesStatus;
    });
  }

  // --------------------------------------------------
  // SELECTION
  // --------------------------------------------------

  function getSelectedCategories() {
    const selectedIds = new Set(
      Array.from(tbody.querySelectorAll(".category-select:checked"))
        .map(checkbox => checkbox.closest("tr")?.dataset.categoryId)
        .filter(Boolean)
    );

    return categories.filter(category => selectedIds.has(category.id));
  }

  function updateSelectAllState() {
    if (!selectAllCheckbox) return;

    const checkboxes = Array.from(
      tbody.querySelectorAll("tr[data-category-id] .category-select")
    );

    const selectedCount = checkboxes.filter(
      checkbox => checkbox.checked
    ).length;

    selectAllCheckbox.checked =
      checkboxes.length > 0 &&
      selectedCount === checkboxes.length;

    selectAllCheckbox.indeterminate =
      selectedCount > 0 &&
      selectedCount < checkboxes.length;
  }

  // --------------------------------------------------
  // RENDER CATEGORIES
  // --------------------------------------------------

  function renderCategories() {
    if (loading) {
      showTableMessage("Loading categories from Firebase...");
      updateSummary();
      updatePaginationLabels(0);
      return;
    }

    if (databaseError) {
      showTableMessage("Categories could not be loaded from Firebase.");
      updateSummary();
      updatePaginationLabels(0);
      return;
    }

    const filtered = getFilteredCategories();

    if (!filtered.length) {
      showTableMessage(
        categories.length
          ? "No matching categories found. Change your search or filters."
          : "No categories yet. Add a category or create a product with a category."
      );

      updateSummary();
      updatePaginationLabels(0);
      return;
    }

    tbody.innerHTML = filtered.map(category => {
      const productCount = getProductCount(category.name);
      const statusClass = category.active ? "paid" : "cancelled";
      const statusText = category.active ? "Active" : "Inactive";

      return `
        <tr
          data-category-id="${escapeHTML(category.id)}"
          data-category-name="${escapeHTML(category.name)}"
          data-status="${category.active ? "active" : "inactive"}"
          data-product-count="${productCount}"
        >
          <td>
            <input
              type="checkbox"
              class="category-select"
              aria-label="Select ${escapeHTML(category.name)}"
            >
          </td>

          <td>
            <div class="cust">
              <div class="cust-avatar">
                ${escapeHTML(category.name.charAt(0).toUpperCase())}
              </div>

              <div>
                <div class="cust-name">${escapeHTML(category.name)}</div>
                <div class="cust-sub">${escapeHTML(category.id)}</div>
              </div>
            </div>
          </td>

          <td>${escapeHTML(category.description || "—")}</td>

          <td>${productCount.toLocaleString("en-IN")}</td>

          <td>
            <span class="pill ${statusClass}">
              ${statusText}
            </span>
          </td>

          <td>
            <div class="page-actions">
              <button
                class="btn-icon"
                type="button"
                data-action="edit"
                data-category-id="${escapeHTML(category.id)}"
                aria-label="Edit ${escapeHTML(category.name)}"
                title="Edit category"
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
                data-category-id="${escapeHTML(category.id)}"
                aria-label="Delete ${escapeHTML(category.name)}"
                title="Delete category"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 6h18"/>
                  <path d="M8 6V4h8v2"/>
                  <path d="M19 6l-1 14H6L5 6"/>
                  <path d="M10 11v5M14 11v5"/>
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    updateSummary();
    updatePaginationLabels(filtered.length);
    updateSelectAllState();
  }

  function updatePaginationLabels(count) {
    if (paginationInfo) {
      paginationInfo.textContent =
        count === 0
          ? "No matching categories"
          : `Showing ${count} categor${count === 1 ? "y" : "ies"}`;
    }

    const previous = $("previousCategoryPage");
    const next = $("nextCategoryPage");
    const current = $("currentCategoryPage");

    if (previous) previous.disabled = true;
    if (next) next.disabled = true;
    if (current) current.textContent = count ? "1" : "—";
  }

  // --------------------------------------------------
  // CATEGORY DIALOG
  // --------------------------------------------------

  function createCategoryDialog() {
    const dialog = document.createElement("dialog");

    dialog.id = "categoryDialog";
    dialog.setAttribute("aria-labelledby", "categoryDialogTitle");

    dialog.style.cssText = `
      width:min(520px,calc(100% - 28px));
      max-width:520px;
      max-height:90vh;
      overflow-y:auto;
      border:1px solid #e5e7eb;
      border-radius:8px;
      padding:24px;
      color:#111827;
      background:#fff;
    `;

    dialog.innerHTML = `
      <div class="card-head">
        <div>
          <h3 id="categoryDialogTitle">Add Category</h3>
          <p id="categoryDialogDescription">Create a product category.</p>
        </div>

        <button
          type="button"
          class="btn-icon"
          id="closeCategoryDialog"
          aria-label="Close dialog"
        >×</button>
      </div>

      <form id="categoryForm">
        <input type="hidden" id="editCategoryId">

        <div style="display:grid;gap:16px;margin-top:20px;">
          <label>
            Category Name *
            <input
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              type="text"
              id="categoryName"
              maxlength="80"
              required
              autocomplete="off"
              placeholder="e.g. Breakfast"
            >
          </label>

          <label>
            Description
            <textarea
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;min-height:100px;resize:vertical;"
              id="categoryDescription"
              maxlength="250"
              placeholder="Describe this category"
            ></textarea>
          </label>

          <label>
            Status
            <select
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              id="categoryStatus"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          <p id="categoryFormMessage" role="alert" aria-live="polite"
            style="margin:0;font-size:13px;"></p>
        </div>

        <div class="page-actions" style="justify-content:flex-end;margin-top:24px;">
          <button class="btn btn-soft" type="button" id="cancelCategoryDialog">
            Cancel
          </button>

          <button class="btn btn-primary" type="submit" id="saveCategoryButton">
            Save Category
          </button>
        </div>
      </form>
    `;

    document.body.appendChild(dialog);
    return dialog;
  }

  categoryDialog = createCategoryDialog();

  function openCategoryDialog(category = null) {
    $("categoryForm").reset();

    $("editCategoryId").value = category?.id || "";
    $("categoryName").value = category?.name || "";
    $("categoryDescription").value = category?.description || "";
    $("categoryStatus").value =
      category?.active === false ? "inactive" : "active";

    $("categoryFormMessage").textContent = "";

    $("categoryDialogTitle").textContent =
      category ? "Edit Category" : "Add Category";

    $("categoryDialogDescription").textContent =
      category
        ? "Update the category details."
        : "Create a new product category.";

    $("saveCategoryButton").textContent =
      category ? "Update Category" : "Save Category";

    if (typeof categoryDialog.showModal !== "function") {
      showMessage("This browser does not support the category dialog.", "error");
      return;
    }

    categoryDialog.showModal();
    $("categoryName").focus();
  }

  function closeCategoryDialog() {
    if (categoryDialog?.open) {
      categoryDialog.close();
    }
  }

  $("closeCategoryDialog").addEventListener("click", closeCategoryDialog);
  $("cancelCategoryDialog").addEventListener("click", closeCategoryDialog);

  categoryDialog.addEventListener("click", event => {
    if (event.target === categoryDialog) {
      closeCategoryDialog();
    }
  });

  addCategoryButton?.addEventListener("click", () => {
    clearMessage();
    openCategoryDialog();
  });

  // --------------------------------------------------
  // SAVE / UPDATE CATEGORY
  // --------------------------------------------------

  $("categoryForm").addEventListener("submit", async event => {
    event.preventDefault();

    if (saving || !db || !databaseSDK) return;

    const message = $("categoryFormMessage");
    const id = $("editCategoryId").value;
    const name = $("categoryName").value.trim();
    const description = $("categoryDescription").value.trim();
    const active = $("categoryStatus").value === "active";

    message.textContent = "";

    if (!name) {
      message.textContent = "Category name is required.";
      return;
    }

    if (name.length > 80 || description.length > 250) {
      message.textContent = "Please check the allowed field lengths.";
      return;
    }

    if (categoryNameExists(name, id)) {
      message.textContent = "A category with this name already exists.";
      return;
    }

    const oldCategory = categories.find(category => category.id === id);

    if (oldCategory && normalise(oldCategory.name) !== normalise(name)) {
      const usedBy = products.filter(product =>
        normalise(product.category) === normalise(oldCategory.name)
      );

      if (usedBy.length) {
        const confirmed = window.confirm(
          `Rename "${oldCategory.name}" to "${name}"?\n\n` +
          `${usedBy.length} saved product(s) will also be updated to use the new category name.`
        );

        if (!confirmed) return;
      }
    }

    const now = createTimestamp();

    const record = {
      name,
      description,
      active,
      createdAt: oldCategory?.createdAt || now,
      updatedAt: now
    };

    saving = true;

    setButtonBusy(
      $("saveCategoryButton"),
      true,
      "Saving...",
      oldCategory ? "Update Category" : "Save Category"
    );

    try {
      if (oldCategory) {
        /*
         * Apply a category rename and update matching product records
         * in one multi-location database update.
         */
        const updates = {};
        updates[`categories/${id}`] = record;

        if (normalise(oldCategory.name) !== normalise(name)) {
          products
            .filter(product =>
              normalise(product.category) === normalise(oldCategory.name)
            )
            .forEach(product => {
              updates[`products/${product.id}/category`] = name;
              updates[`products/${product.id}/updatedAt`] = now;
            });
        }

        await databaseSDK.update(
          databaseSDK.ref(db, "restaurantBilling"),
          updates
        );
      } else {
        const categoriesRef = databaseSDK.ref(db, CATEGORIES_PATH);
        const newCategoryRef = databaseSDK.push(categoriesRef);

        await databaseSDK.set(newCategoryRef, record);
      }

      closeCategoryDialog();
      clearMessage();

      showMessage(
        oldCategory
          ? "Category updated successfully."
          : "Category saved successfully.",
        "success"
      );
    } catch (error) {
      console.error("Categories: Save failed.", error);

      message.textContent =
        "Unable to save the category. Check your database Rules and internet connection.";
    } finally {
      saving = false;

      setButtonBusy(
        $("saveCategoryButton"),
        false,
        "Saving...",
        oldCategory ? "Update Category" : "Save Category"
      );
    }
  });

  // --------------------------------------------------
  // DELETE CATEGORY
  // --------------------------------------------------

  async function deleteCategory(category) {
    if (saving || !db || !databaseSDK) return;

    const productCount = getProductCount(category.name);

    if (productCount > 0) {
      showMessage(
        `Cannot delete "${category.name}" because ${productCount} product(s) use it. Reassign those products first.`,
        "error"
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete the category "${category.name}"?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await databaseSDK.remove(
        databaseSDK.ref(db, `${CATEGORIES_PATH}/${category.id}`)
      );

      showMessage("Category deleted successfully.", "success");
    } catch (error) {
      console.error("Categories: Delete failed.", error);

      showMessage(
        "Unable to delete the category. Check your database Rules.",
        "error"
      );
    }
  }

  tbody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const category = categories.find(
      item => item.id === button.dataset.categoryId
    );

    if (!category) {
      showMessage("Category not found. Refresh the page and try again.", "error");
      return;
    }

    clearMessage();

    if (button.dataset.action === "edit") {
      openCategoryDialog(category);
    } else if (button.dataset.action === "delete") {
      deleteCategory(category);
    }
  });

  // --------------------------------------------------
  // SEARCH AND FILTER EVENTS
  // --------------------------------------------------

  searchInput?.addEventListener("input", renderCategories);
  statusFilter?.addEventListener("change", renderCategories);

  filtersForm?.addEventListener("reset", () => {
    window.setTimeout(renderCategories, 0);
  });

  // --------------------------------------------------
  // SELECT ALL
  // --------------------------------------------------

  selectAllCheckbox?.addEventListener("change", () => {
    tbody.querySelectorAll(".category-select").forEach(checkbox => {
      checkbox.checked = selectAllCheckbox.checked;
    });

    updateSelectAllState();
  });

  tbody.addEventListener("change", event => {
    if (event.target.matches(".category-select")) {
      updateSelectAllState();
    }
  });

  // --------------------------------------------------
  // BULK ACTIONS
  // --------------------------------------------------

  applyBulkActionButton?.addEventListener("click", async () => {
    if (saving || !db || !databaseSDK) return;

    const action = bulkActionSelect?.value;
    const selected = getSelectedCategories();

    if (!["activate", "deactivate", "delete"].includes(action)) {
      showMessage("Select a supported bulk action.", "error");
      return;
    }

    if (!selected.length) {
      showMessage("Select at least one category.", "error");
      return;
    }

    if (action === "delete") {
      const assigned = selected.filter(
        category => getProductCount(category.name) > 0
      );

      if (assigned.length) {
        showMessage(
          `Cannot delete selected categories because products use: ${
            assigned.map(category => category.name).join(", ")
          }. Reassign those products first.`,
          "error"
        );
        return;
      }

      if (!window.confirm(`Delete ${selected.length} selected category record(s)?`)) {
        return;
      }
    }

    applyBulkActionButton.disabled = true;

    try {
      const updates = {};
      const now = createTimestamp();

      selected.forEach(category => {
        if (action === "delete") {
          updates[`categories/${category.id}`] = null;
        } else {
          updates[`categories/${category.id}/active`] =
            action === "activate";

          updates[`categories/${category.id}/updatedAt`] = now;
        }
      });

      await databaseSDK.update(
        databaseSDK.ref(db, "restaurantBilling"),
        updates
      );

      if (bulkActionSelect) {
        bulkActionSelect.value = "";
      }

      showMessage("Bulk action completed successfully.", "success");
    } catch (error) {
      console.error("Categories: Bulk action failed.", error);

      showMessage(
        "Bulk action failed. Check Firebase permissions.",
        "error"
      );
    } finally {
      applyBulkActionButton.disabled = false;
    }
  });

  // --------------------------------------------------
  // CSV EXPORT
  // --------------------------------------------------

  function csvCell(value) {
    let text = String(value ?? "");

    // Reduce CSV formula-injection risk in spreadsheet software.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCategories(records, filename) {
    if (!records.length) {
      showMessage("There are no categories to export.", "info");
      return;
    }

    const headers = [
      "Category ID",
      "Category Name",
      "Description",
      "Product Count",
      "Status"
    ];

    const rows = records.map(category => [
      category.id,
      category.name,
      category.description,
      getProductCount(category.name),
      category.active ? "Active" : "Inactive"
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
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    showMessage(
      `${records.length} category record(s) exported successfully.`,
      "success"
    );
  }

  exportButton?.addEventListener("click", () => {
    if (loading || databaseError) {
      showMessage("Wait for categories to load before exporting.", "error");
      return;
    }

    exportCategories(
      getFilteredCategories(),
      "restaurant-categories.csv"
    );
  });

  // --------------------------------------------------
  // CLEAR EXISTING HTML DEMO ROWS AND START
  // --------------------------------------------------

  tbody.replaceChildren();

  if (totalOutput) totalOutput.textContent = "0";
  if (activeOutput) activeOutput.textContent = "0";
  if (assignedOutput) assignedOutput.textContent = "0";
  if (emptyOutput) emptyOutput.textContent = "0";

  initialiseFirebase();

  console.info("Categories: Firebase integration starting.");
})();
