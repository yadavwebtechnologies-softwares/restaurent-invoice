"use strict";

/*
 * Restaurant Billing Software
 * File: js/categories.js
 *
 * Phase 1: Frontend demo.
 *
 * Features:
 * - Add and edit categories
 * - Delete empty categories
 * - Search and status filters
 * - Select visible categories
 * - Export filtered or selected categories to CSV
 * - Automatic KPI updates
 *
 * Important:
 * - Demo data is initially loaded from categories.html.
 * - Changes remain in memory only and reset after page reload.
 * - Firebase Realtime Database integration comes later.
 * - Categories with assigned products cannot be deleted.
 */

(() => {
  // --------------------------------------------------
  // DOM REFERENCES
  // --------------------------------------------------

  const table = document.getElementById("categoriesTable");
  const tbody = document.getElementById("categoriesTableBody");

  if (!table || !tbody) {
    console.error("Categories: Category table was not found.");
    return;
  }

  const addCategoryButton = document.getElementById("addCategoryBtn");
  const exportButton = document.getElementById("exportCategoriesBtn");

  const searchInput = document.getElementById("categorySearch");
  const statusFilter = document.getElementById("categoryStatusFilter");
  const filtersForm = document.getElementById("categoryFilters");

  const selectAllCheckbox = document.getElementById("selectAllCategories");

  const totalCategoriesOutput =
    document.getElementById("totalCategoriesValue");

  const activeCategoriesOutput =
    document.getElementById("activeCategoriesValue");

  const assignedProductsOutput =
    document.getElementById("assignedProductsValue");

  const emptyCategoriesOutput =
    document.getElementById("emptyCategoriesValue");

  const recordCountLabel =
    document.getElementById("categoryRecordCount");

  const paginationInfo =
    document.getElementById("categoryPaginationInfo");

  const bulkActionSelect = document.getElementById("categoryBulkAction");
  const applyBulkActionButton = document.getElementById(
    "applyCategoryBulkAction"
  );

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

  function normalise(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function generateCategoryId() {
    return [
      "CAT",
      Date.now().toString(36).toUpperCase(),
      Math.random().toString(36).slice(2, 7).toUpperCase()
    ].join("-");
  }

  function showMessage(message, type = "info") {
    let messageElement = document.getElementById("categoryMessage");

    if (!messageElement) {
      messageElement = document.createElement("div");
      messageElement.id = "categoryMessage";
      messageElement.setAttribute("role", "status");
      messageElement.setAttribute("aria-live", "polite");

      messageElement.style.cssText = `
        margin: 12px 0;
        padding: 12px 14px;
        border: 1px solid #d1d5db;
        border-radius: 5px;
        background: #ffffff;
        color: #111827;
        font-size: 13px;
        line-height: 1.5;
      `;

      const pageHead = document.querySelector(".page-head");

      if (pageHead) {
        pageHead.insertAdjacentElement("afterend", messageElement);
      } else {
        table.insertAdjacentElement("beforebegin", messageElement);
      }
    }

    messageElement.textContent = message;
    messageElement.dataset.type = type;
    messageElement.hidden = false;
  }

  function clearMessage() {
    const messageElement = document.getElementById("categoryMessage");

    if (messageElement) {
      messageElement.textContent = "";
      messageElement.hidden = true;
      delete messageElement.dataset.type;
    }
  }

  // --------------------------------------------------
  // READ INITIAL DEMO DATA
  // --------------------------------------------------

  function readInitialCategories() {
    return Array.from(tbody.querySelectorAll("tr[data-category-id]"))
      .map(row => {
        const cells = row.querySelectorAll("td");

        if (cells.length < 6) {
          return null;
        }

        const id = row.dataset.categoryId || "";
        const name = row.dataset.categoryName || "";
        const status = row.dataset.status || "active";
        const productCount = Number(row.dataset.productCount);

        const description =
          cells[2].textContent.trim();

        if (
          !id ||
          !name.trim() ||
          !["active", "inactive"].includes(status) ||
          !Number.isSafeInteger(productCount) ||
          productCount < 0
        ) {
          console.warn("Skipping invalid category row.", row);
          return null;
        }

        return {
          id,
          name: name.trim(),
          description,
          productCount,
          active: status === "active"
        };
      })
      .filter(Boolean);
  }

  let categories = readInitialCategories();

  // --------------------------------------------------
  // KPI SUMMARY
  // --------------------------------------------------

  function updateSummary() {
    const total = categories.length;

    const active = categories.filter(
      category => category.active
    ).length;

    const assignedProducts = categories.reduce(
      (sum, category) => sum + category.productCount,
      0
    );

    const empty = categories.filter(
      category => category.productCount === 0
    ).length;

    totalCategoriesOutput.textContent =
      total.toLocaleString("en-IN");

    activeCategoriesOutput.textContent =
      active.toLocaleString("en-IN");

    assignedProductsOutput.textContent =
      assignedProducts.toLocaleString("en-IN");

    emptyCategoriesOutput.textContent =
      empty.toLocaleString("en-IN");

    recordCountLabel.textContent =
      `${total} Record${total === 1 ? "" : "s"}`;
  }

  // --------------------------------------------------
  // CATEGORY FILTERING
  // --------------------------------------------------

  function getFilteredCategories() {
    const search = normalise(searchInput.value);
    const selectedStatus = statusFilter.value;

    return categories.filter(category => {
      const searchableText = [
        category.id,
        category.name,
        category.description
      ].map(normalise).join(" ");

      const matchesSearch =
        !search || searchableText.includes(search);

      const matchesStatus =
        !selectedStatus ||
        (selectedStatus === "active" && category.active) ||
        (selectedStatus === "inactive" && !category.active);

      return matchesSearch && matchesStatus;
    });
  }

  // --------------------------------------------------
  // SELECT ALL STATE
  // --------------------------------------------------

  function updateSelectAllState() {
    const visibleCheckboxes = Array.from(
      tbody.querySelectorAll("tr[data-category-id]")
    )
      .filter(row => !row.hidden)
      .map(row => row.querySelector(".category-select"))
      .filter(Boolean);

    const selectedCount = visibleCheckboxes.filter(
      checkbox => checkbox.checked
    ).length;

    selectAllCheckbox.checked =
      visibleCheckboxes.length > 0 &&
      selectedCount === visibleCheckboxes.length;

    selectAllCheckbox.indeterminate =
      selectedCount > 0 &&
      selectedCount < visibleCheckboxes.length;
  }

  // --------------------------------------------------
  // RENDER CATEGORY TABLE
  // --------------------------------------------------

  function renderCategories() {
    const filteredCategories = getFilteredCategories();

    tbody.innerHTML = filteredCategories.map(category => {
      const initial = category.name.charAt(0).toUpperCase();

      const statusClass = category.active
        ? "paid"
        : "cancelled";

      const statusText = category.active
        ? "Active"
        : "Inactive";

      return `
        <tr
          data-category-id="${escapeHTML(category.id)}"
          data-category-name="${escapeHTML(category.name)}"
          data-status="${category.active ? "active" : "inactive"}"
          data-product-count="${category.productCount}"
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
                ${escapeHTML(initial)}
              </div>

              <div>
                <div class="cust-name">
                  ${escapeHTML(category.name)}
                </div>

                <div class="cust-sub">
                  ${escapeHTML(category.id)}
                </div>
              </div>

            </div>
          </td>

          <td>
            ${escapeHTML(category.description || "—")}
          </td>

          <td>
            ${category.productCount.toLocaleString("en-IN")}
          </td>

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
                aria-label="Edit ${escapeHTML(category.name)} category"
                title="Edit category"
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
                data-category-id="${escapeHTML(category.id)}"
                aria-label="Delete ${escapeHTML(category.name)} category"
                title="Delete category"
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

            </div>
          </td>

        </tr>
      `;
    }).join("");

    let emptyRow = document.getElementById("noCategoriesRow");

    if (filteredCategories.length === 0) {
      if (!emptyRow) {
        emptyRow = document.createElement("tr");
        emptyRow.id = "noCategoriesRow";

        emptyRow.innerHTML = `
          <td colspan="6" style="text-align:center;padding:32px 16px;">
            <strong>No categories found</strong>

            <div style="margin-top:6px;">
              Try a different search or filter.
            </div>
          </td>
        `;

        tbody.appendChild(emptyRow);
      }

      emptyRow.hidden = false;
    } else if (emptyRow) {
      emptyRow.hidden = true;
    }

    const count = filteredCategories.length;

    paginationInfo.textContent = count === 0
      ? "No matching categories"
      : `Showing ${count} demo categor${count === 1 ? "y" : "ies"}`;

    // Pagination is display-only in this phase.
    document.getElementById("previousCategoryPage").disabled = true;
    document.getElementById("nextCategoryPage").disabled = true;
    document.getElementById("currentCategoryPage").textContent = "1";

    updateSummary();
    updateSelectAllState();
  }

  // --------------------------------------------------
  // ADD / EDIT CATEGORY DIALOG
  // --------------------------------------------------

  function createCategoryDialog() {
    const dialog = document.createElement("dialog");

    dialog.id = "categoryDialog";
    dialog.setAttribute("aria-labelledby", "categoryDialogTitle");

    dialog.style.cssText = `
      width: min(520px, calc(100% - 28px));
      max-width: 520px;
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
          <h3 id="categoryDialogTitle">Add Category</h3>
          <p id="categoryDialogDescription">
            Create a new product category.
          </p>
        </div>

        <button
          type="button"
          class="btn-icon"
          id="closeCategoryDialog"
          aria-label="Close dialog"
        >&#10005;</button>

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
              name="name"
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
              name="description"
              maxlength="250"
              placeholder="Describe this menu category"
            ></textarea>
          </label>

          <label>
            Status

            <select
              class="btn btn-outline"
              style="display:block;width:100%;margin-top:6px;text-align:left;"
              id="categoryStatus"
              name="status"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>

          <p
            id="categoryFormMessage"
            role="alert"
            style="margin:0;font-size:13px;"
          ></p>

        </div>

        <div class="page-actions" style="justify-content:flex-end;margin-top:24px;">

          <button
            class="btn btn-soft"
            type="button"
            id="cancelCategoryDialog"
          >
            Cancel
          </button>

          <button
            class="btn btn-primary"
            type="submit"
            id="saveCategoryButton"
          >
            Save Category
          </button>

        </div>

      </form>
    `;

    document.body.appendChild(dialog);

    return dialog;
  }

  const categoryDialog = createCategoryDialog();
  const categoryForm = document.getElementById("categoryForm");

  function openCategoryDialog(category = null) {
    categoryForm.reset();

    document.getElementById("editCategoryId").value =
      category?.id || "";

    document.getElementById("categoryName").value =
      category?.name || "";

    document.getElementById("categoryDescription").value =
      category?.description || "";

    document.getElementById("categoryStatus").value =
      category?.active === false ? "inactive" : "active";

    document.getElementById("categoryDialogTitle").textContent =
      category ? "Edit Category" : "Add Category";

    document.getElementById("categoryDialogDescription").textContent =
      category
        ? "Update category information."
        : "Create a new product category.";

    document.getElementById("saveCategoryButton").textContent =
      category ? "Update Category" : "Save Category";

    document.getElementById("categoryFormMessage").textContent = "";

    if (typeof categoryDialog.showModal !== "function") {
      showMessage(
        "Your browser does not support the category dialog.",
        "error"
      );

      return;
    }

    categoryDialog.showModal();
    document.getElementById("categoryName").focus();
  }

  function closeCategoryDialog() {
    if (categoryDialog.open) {
      categoryDialog.close();
    }
  }

  document.getElementById("closeCategoryDialog")
    .addEventListener("click", closeCategoryDialog);

  document.getElementById("cancelCategoryDialog")
    .addEventListener("click", closeCategoryDialog);

  categoryDialog.addEventListener("click", event => {
    if (event.target === categoryDialog) {
      closeCategoryDialog();
    }
  });

  // --------------------------------------------------
  // SAVE / UPDATE CATEGORY
  // --------------------------------------------------

  categoryForm.addEventListener("submit", event => {
    event.preventDefault();

    const message = document.getElementById("categoryFormMessage");

    const id = document.getElementById("editCategoryId").value;

    const name = document
      .getElementById("categoryName")
      .value.trim();

    const description = document
      .getElementById("categoryDescription")
      .value.trim();

    const active =
      document.getElementById("categoryStatus").value === "active";

    message.textContent = "";

    if (!name) {
      message.textContent = "Category name is required.";
      return;
    }

    if (name.length > 80) {
      message.textContent =
        "Category name cannot exceed 80 characters.";
      return;
    }

    if (description.length > 250) {
      message.textContent =
        "Description cannot exceed 250 characters.";
      return;
    }

    const duplicate = categories.some(category =>
      category.id !== id &&
      normalise(category.name) === normalise(name)
    );

    if (duplicate) {
      message.textContent =
        "A category with this name already exists.";
      return;
    }

    if (id) {
      const category = categories.find(item => item.id === id);

      if (!category) {
        message.textContent =
          "Category not found. Refresh the page and try again.";
        return;
      }

      category.name = name;
      category.description = description;
      category.active = active;
    } else {
      categories.push({
        id: generateCategoryId(),
        name,
        description,
        productCount: 0,
        active
      });
    }

    clearMessage();
    closeCategoryDialog();
    renderCategories();
  });

  // --------------------------------------------------
  // EDIT / DELETE ACTIONS
  // --------------------------------------------------

  tbody.addEventListener("click", event => {
    const button = event.target.closest("button[data-action]");

    if (!button) {
      return;
    }

    const action = button.dataset.action;
    const categoryId = button.dataset.categoryId;

    const category = categories.find(
      item => item.id === categoryId
    );

    if (!category) {
      showMessage(
        "Category not found. Refresh the page and try again.",
        "error"
      );

      return;
    }

    if (action === "edit") {
      clearMessage();
      openCategoryDialog(category);
      return;
    }

    if (action === "delete") {
      /*
       * Categories with assigned products cannot be deleted.
       * The real database version must first reassign products
       * or require the user to handle product relationships.
       */

      if (category.productCount > 0) {
        showMessage(
          `Cannot delete "${category.name}" because ` +
          `${category.productCount} product(s) are assigned to it. ` +
          "Reassign those products to another category first.",
          "error"
        );

        return;
      }

      const confirmed = window.confirm(
        `Delete the category "${category.name}"?\n\n` +
        "This action removes the category from the current demo list."
      );

      if (!confirmed) {
        return;
      }

      categories = categories.filter(
        item => item.id !== categoryId
      );

      clearMessage();
      renderCategories();
    }
  });

  // --------------------------------------------------
  // SEARCH / STATUS FILTERS
  // --------------------------------------------------

  searchInput.addEventListener("input", () => {
    clearMessage();
    renderCategories();
  });

  statusFilter.addEventListener("change", () => {
    clearMessage();
    renderCategories();
  });

  filtersForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      clearMessage();
      renderCategories();
    }, 0);
  });

  // --------------------------------------------------
  // SELECT VISIBLE CATEGORIES
  // --------------------------------------------------

  selectAllCheckbox.addEventListener("change", () => {
    Array.from(
      tbody.querySelectorAll("tr[data-category-id]")
    )
      .filter(row => !row.hidden)
      .forEach(row => {
        const checkbox = row.querySelector(".category-select");

        if (checkbox) {
          checkbox.checked = selectAllCheckbox.checked;
        }
      });

    updateSelectAllState();
  });

  tbody.addEventListener("change", event => {
    if (!event.target.matches(".category-select")) {
      return;
    }

    updateSelectAllState();
  });

  function getSelectedVisibleCategories() {
    const selectedIds = new Set(
      Array.from(
        tbody.querySelectorAll(".category-select:checked")
      )
        .filter(checkbox => !checkbox.closest("tr")?.hidden)
        .map(checkbox => checkbox.closest("tr")?.dataset.categoryId)
        .filter(Boolean)
    );

    return categories.filter(category => selectedIds.has(category.id));
  }

  // --------------------------------------------------
  // CSV EXPORT
  // --------------------------------------------------

  function csvCell(value) {
    let text = String(value ?? "");

    // Reduce spreadsheet formula-injection risk.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCSV(records, filename) {
    if (records.length === 0) {
      showMessage("There are no categories to export.", "error");
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
      category.productCount,
      category.active ? "Active" : "Inactive"
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

  // Export currently filtered categories.
  exportButton.addEventListener("click", () => {
    downloadCSV(
      getFilteredCategories(),
      "restaurant-categories.csv"
    );
  });

  // --------------------------------------------------
  // OPTIONAL BULK EXPORT SUPPORT
  // --------------------------------------------------

  /*
   * The current categories.html does not yet contain bulk-action
   * controls. This section activates them automatically if the
   * matching controls are added later.
   */

  if (bulkActionSelect && applyBulkActionButton) {
    applyBulkActionButton.addEventListener("click", () => {
      if (bulkActionSelect.value !== "export") {
        showMessage(
          "Please select a supported bulk action.",
          "error"
        );

        return;
      }

      const selected = getSelectedVisibleCategories();

      downloadCSV(
        selected,
        "selected-restaurant-categories.csv"
      );

      bulkActionSelect.value = "";
    });
  }

  // --------------------------------------------------
  // INITIALISE
  // --------------------------------------------------

  renderCategories();

  console.info(
    `Category Management initialised with ${categories.length} demo categories.`
  );
})();
