(() => {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const PATHS = {
    invoices: "restaurantBilling/invoices",
    products: "restaurantBilling/products",
    categories: "restaurantBilling/categories",
    business: "restaurantBilling/settings/businessProfile"
  };

  const state = {
    api: null,
    invoices: [],
    products: {},
    categories: {},
    businessProfile: {},
    startDate: "",
    endDate: "",
    trendMode: "daily",
    loading: true,
    error: "",
    optionalErrors: {},
    initialized: false,
    ready: {
      invoices: false,
      products: false,
      categories: false
    },
    unsubscribers: []
  };

  const $ = (id) => document.getElementById(id);

  function escapeHTML(value) {
    if (window.restaurantUI?.escapeHTML) {
      return window.restaurantUI.escapeHTML(String(value ?? ""));
    }

    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function formatCurrency(value) {
    const number = Number(value);

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2
    }).format(Number.isFinite(number) ? number : 0);
  }

  function formatNumber(value) {
    const number = Number(value);

    return new Intl.NumberFormat("en-IN", {
      maximumFractionDigits: 2
    }).format(Number.isFinite(number) ? number : 0);
  }

  function formatPercent(value) {
    return `${formatNumber(value)}%`;
  }

  function parseDate(value) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const text = value.trim();

    // Parse date-only Firebase values in local time.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

    if (dateOnly) {
      const date = new Date(
        Number(dateOnly[1]),
        Number(dateOnly[2]) - 1,
        Number(dateOnly[3])
      );

      return Number.isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function getInvoiceDate(invoice) {
    return parseDate(
      invoice.createdAtMs ??
      invoice.createdAt ??
      invoice.timestamp ??
      invoice.date ??
      null
    );
  }

  function getInvoiceStatus(invoice) {
    const status = String(
      invoice.recordStatus ?? invoice.status ?? "valid"
    ).trim().toLowerCase();

    return ["cancelled", "canceled", "void", "voided"].includes(status)
      ? "cancelled"
      : "valid";
  }

  function getInvoiceNumber(invoice) {
    return String(
      invoice.invoiceNumber ??
      invoice.number ??
      invoice.invoiceId ??
      invoice.id ??
      "Invoice"
    );
  }

  function getInvoiceTotal(invoice) {
    const total = Number(
      invoice.grandTotal ??
      invoice.total ??
      invoice.amount ??
      0
    );

    return Number.isFinite(total) ? total : 0;
  }

  function getItems(invoice) {
    return Array.isArray(invoice.items) ? invoice.items : [];
  }

  function getItemName(item) {
    return String(
      item.name ??
      item.productName ??
      item.itemName ??
      "Unnamed item"
    ).trim() || "Unnamed item";
  }

  function getItemQuantity(item) {
    const quantity = Number(item.quantity ?? item.qty ?? 0);
    return Number.isFinite(quantity) ? quantity : 0;
  }

  function getItemPrice(item) {
    const price = Number(item.price ?? item.unitPrice ?? 0);
    return Number.isFinite(price) ? price : 0;
  }

  function getItemAmount(item) {
    const storedAmount = Number(item.total ?? item.amount);

    if (
      item.total !== undefined &&
      item.total !== null &&
      Number.isFinite(storedAmount)
    ) {
      return storedAmount;
    }

    if (
      item.amount !== undefined &&
      item.amount !== null &&
      Number.isFinite(storedAmount)
    ) {
      return storedAmount;
    }

    return getItemQuantity(item) * getItemPrice(item);
  }

  function localDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function formatDate(value) {
    const date = parseDate(value);

    if (!date) return "—";

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent = String(value ?? "");
    }
  }

  function setStatus(message, isError = false) {
    const element = $("reportsPageStatus");

    if (!element) return;

    element.textContent = message;
    element.dataset.state = isError ? "error" : "normal";
    element.setAttribute("role", isError ? "alert" : "status");
  }

  function setConnectionStatus(message, isError = false) {
    const element = $("sidebarConnectionStatus");

    if (!element) return;

    element.textContent = message;
    element.dataset.state = isError ? "error" : "normal";
  }

  function updateBranding() {
    const profile = state.businessProfile;

    const name = String(profile.businessName ?? "").trim();
    const tagline = String(profile.tagline ?? "").trim();

    document.querySelectorAll("[data-business-name]").forEach((element) => {
      element.textContent = name || "Restaurant Billing";
    });

    document.querySelectorAll("[data-business-tagline]").forEach((element) => {
      element.textContent = tagline || "Billing and Invoice Software";
    });

    setText("sidebarBusinessName", name || "Restaurant Billing");
    setText("businessFooterName", name || "Restaurant Billing");
    setText("reportBusinessName", name || "Restaurant Billing");
  }

  function normalizeRecords(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return [];
    }

    return Object.entries(raw)
      .filter(([, value]) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
      )
      .map(([key, value]) => ({
        ...value,
        _databaseKey: key
      }))
      .filter((record) => record.ownerUid === OWNER_UID);
  }

  function normalizeLookup(raw) {
    const result = {};

    normalizeRecords(raw).forEach((record) => {
      result[record._databaseKey] = record;
    });

    return result;
  }

  function normalizeKey(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function getProductIdentifier(item) {
    return String(
      item.productId ??
      item.itemId ??
      item.productKey ??
      item.productRefId ??
      ""
    ).trim();
  }

  function getCategoryIdentifier(record) {
    return String(
      record.categoryId ??
      record.categoryKey ??
      record.category ??
      record.categoryName ??
      ""
    ).trim();
  }

  function getCategoryName(category) {
    return String(
      category.name ??
      category.categoryName ??
      category.title ??
      "Uncategorised"
    ).trim() || "Uncategorised";
  }

  function getProductName(product) {
    return String(
      product.name ??
      product.productName ??
      product.title ??
      "Unnamed product"
    ).trim() || "Unnamed product";
  }

  function buildLookupMaps() {
    const categoryById = new Map();
    const categoryByName = new Map();

    Object.entries(state.categories).forEach(([key, category]) => {
      const name = getCategoryName(category);

      categoryById.set(key, {
        id: key,
        name
      });

      if (category.id) {
        categoryById.set(String(category.id), {
          id: key,
          name
        });
      }

      categoryByName.set(normalizeKey(name), {
        id: key,
        name
      });
    });

    const productById = new Map();
    const productByName = new Map();

    Object.entries(state.products).forEach(([key, product]) => {
      const entry = {
        id: key,
        name: getProductName(product),
        categoryId: getCategoryIdentifier(product)
      };

      productById.set(key, entry);

      if (product.id) {
        productById.set(String(product.id), entry);
      }

      if (product.productId) {
        productById.set(String(product.productId), entry);
      }

      productByName.set(normalizeKey(entry.name), entry);
    });

    return {
      categoryById,
      categoryByName,
      productById,
      productByName
    };
  }

  function resolveCategory(item, maps) {
    const candidates = [
      item.categoryId,
      item.categoryKey,
      item.categoryName,
      item.category
    ].filter((value) => value !== undefined && value !== null && value !== "");

    for (const candidateValue of candidates) {
      const candidate = String(candidateValue).trim();

      if (maps.categoryById.has(candidate)) {
        return maps.categoryById.get(candidate);
      }

      if (maps.categoryByName.has(normalizeKey(candidate))) {
        return maps.categoryByName.get(normalizeKey(candidate));
      }
    }

    const productId = getProductIdentifier(item);
    const matchingProduct = productId
      ? maps.productById.get(productId)
      : maps.productByName.get(normalizeKey(getItemName(item)));

    if (matchingProduct?.categoryId) {
      const id = matchingProduct.categoryId;

      if (maps.categoryById.has(id)) {
        return maps.categoryById.get(id);
      }

      if (maps.categoryByName.has(normalizeKey(id))) {
        return maps.categoryByName.get(normalizeKey(id));
      }
    }

    return null;
  }

  function getFilteredInvoices() {
    const start = state.startDate
      ? new Date(`${state.startDate}T00:00:00`)
      : null;

    const end = state.endDate
      ? new Date(`${state.endDate}T23:59:59.999`)
      : null;

    return state.invoices.filter((invoice) => {
      // Cancelled invoices never count towards sales.
      if (getInvoiceStatus(invoice) !== "valid") {
        return false;
      }

      const date = getInvoiceDate(invoice);

      if (!date) {
        return !start && !end;
      }

      if (start && date < start) return false;
      if (end && date > end) return false;

      return true;
    });
  }

  function buildDailyReport(invoices) {
    const daily = new Map();

    invoices.forEach((invoice) => {
      const date = getInvoiceDate(invoice);

      if (!date) return;

      const key = localDateString(date);

      if (!daily.has(key)) {
        daily.set(key, {
          date: key,
          invoiceCount: 0,
          sales: 0,
          tax: 0,
          discount: 0,
          quantity: 0
        });
      }

      const row = daily.get(key);

      row.invoiceCount += 1;
      row.sales += getInvoiceTotal(invoice);
      row.tax += Number(invoice.taxAmount ?? invoice.tax ?? 0) || 0;
      row.discount += Number(
        invoice.discount ?? invoice.discountAmount ?? 0
      ) || 0;

      getItems(invoice).forEach((item) => {
        row.quantity += getItemQuantity(item);
      });
    });

    return [...daily.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
  }

  function buildProductReport(invoices) {
    const products = new Map();

    const maps = buildLookupMaps();

    invoices.forEach((invoice) => {
      getItems(invoice).forEach((item) => {
        const name = getItemName(item);
        const productId = getProductIdentifier(item);

        const matchingProduct = productId
          ? maps.productById.get(productId)
          : maps.productByName.get(normalizeKey(name));

        const key = matchingProduct
          ? `product:${matchingProduct.id}`
          : productId
            ? `id:${productId}`
            : `name:${normalizeKey(name)}`;

        if (!products.has(key)) {
          const category = resolveCategory(item, maps);

          products.set(key, {
            id: matchingProduct?.id ?? productId ?? "",
            name: matchingProduct?.name ?? name,
            quantity: 0,
            revenue: 0,
            invoiceEntries: 0,
            categoryId: category?.id ?? "",
            categoryName: category?.name ?? "Uncategorised"
          });
        }

        const product = products.get(key);

        product.quantity += getItemQuantity(item);
        product.revenue += getItemAmount(item);
        product.invoiceEntries += 1;

        if (product.categoryName === "Uncategorised") {
          const category = resolveCategory(item, maps);

          if (category) {
            product.categoryId = category.id;
            product.categoryName = category.name;
          }
        }
      });
    });

    return [...products.values()].sort((a, b) =>
      b.revenue - a.revenue
    );
  }

  function buildCategoryReport(products) {
    const categories = new Map();

    products.forEach((product) => {
      if (!product.categoryId || product.categoryName === "Uncategorised") {
        return;
      }

      const key = product.categoryId;

      if (!categories.has(key)) {
        categories.set(key, {
          id: key,
          name: product.categoryName,
          quantity: 0,
          revenue: 0
        });
      }

      const category = categories.get(key);

      category.quantity += product.quantity;
      category.revenue += product.revenue;
    });

    return [...categories.values()].sort((a, b) =>
      b.revenue - a.revenue
    );
  }

  function buildWeekdayReport(invoices) {
    const weekdays = Array.from({ length: 7 }, (_, index) => ({
      weekdayIndex: index,
      weekday: new Intl.DateTimeFormat("en-IN", {
        weekday: "long"
      }).format(new Date(2024, 0, 7 + index)),
      invoices: 0,
      sales: 0,
      activeDates: new Set()
    }));

    invoices.forEach((invoice) => {
      const date = getInvoiceDate(invoice);

      if (!date) return;

      const row = weekdays[date.getDay()];

      row.invoices += 1;
      row.sales += getInvoiceTotal(invoice);
      row.activeDates.add(localDateString(date));
    });

    return weekdays.map((row) => ({
      ...row,
      activeDays: row.activeDates.size,
      averageBill: row.invoices ? row.sales / row.invoices : 0
    }));
  }

  function getPeakAndLowestDay(daily) {
    if (!daily.length) {
      return {
        highest: null,
        lowest: null
      };
    }

    const bySales = [...daily].sort((a, b) => a.sales - b.sales);

    return {
      lowest: bySales[0],
      highest: bySales[bySales.length - 1]
    };
  }

  function groupTrends(daily, mode) {
    const groups = new Map();

    daily.forEach((row) => {
      const date = parseDate(row.date);

      if (!date) return;

      let key;
      let label;
      let sortKey;

      if (mode === "weekly") {
        const monday = new Date(date);
        const dayOffset = (monday.getDay() + 6) % 7;

        monday.setDate(monday.getDate() - dayOffset);

        key = localDateString(monday);
        label = `Week of ${formatDate(monday)}`;
        sortKey = key;
      } else if (mode === "monthly") {
        key = `${date.getFullYear()}-${String(
          date.getMonth() + 1
        ).padStart(2, "0")}`;

        label = new Intl.DateTimeFormat("en-IN", {
          month: "short",
          year: "numeric"
        }).format(date);

        sortKey = key;
      } else {
        key = row.date;
        label = formatDate(date);
        sortKey = key;
      }

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          sortKey,
          sales: 0,
          invoices: 0
        });
      }

      const group = groups.get(key);

      group.sales += row.sales;
      group.invoices += row.invoiceCount;
    });

    return [...groups.values()].sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey)
    );
  }

  function renderSummary(invoices, daily, products) {
    const totalSales = invoices.reduce(
      (sum, invoice) => sum + getInvoiceTotal(invoice),
      0
    );

    const totalTax = invoices.reduce(
      (sum, invoice) =>
        sum + (Number(invoice.taxAmount ?? invoice.tax ?? 0) || 0),
      0
    );

    const totalDiscount = invoices.reduce(
      (sum, invoice) =>
        sum + (
          Number(invoice.discount ?? invoice.discountAmount ?? 0) || 0
        ),
      0
    );

    const itemsSold = invoices.reduce((sum, invoice) => {
      return sum + getItems(invoice).reduce(
        (itemSum, item) => itemSum + getItemQuantity(item),
        0
      );
    }, 0);

    const averageInvoice = invoices.length
      ? totalSales / invoices.length
      : 0;

    setText("reportTotalSales", formatCurrency(totalSales));
    setText("reportInvoiceCount", formatNumber(invoices.length));
    setText("reportAverageInvoice", formatCurrency(averageInvoice));
    setText("reportItemsSold", formatNumber(itemsSold));
    setText("reportTaxCollected", formatCurrency(totalTax));
    setText("reportDiscountTotal", formatCurrency(totalDiscount));

    // Count distinct products that actually occur in selected-period sales.
    setText(
      "reportProductCount",
      formatNumber(products.filter((product) => product.quantity > 0).length)
    );

    setText("reportActiveDays", formatNumber(daily.length));

    // Compatibility with earlier report element IDs.
    setText("totalSalesValue", formatCurrency(totalSales));
    setText("totalInvoiceCount", formatNumber(invoices.length));
    setText("averageInvoiceValue", formatCurrency(averageInvoice));
    setText("totalItemsSold", formatNumber(itemsSold));
  }

  function renderTableRows(bodyId, rows, emptyMessage, columns) {
    const body = $(bodyId);

    if (!body) return;

    if (!rows.length) {
      body.innerHTML = `
        <tr>
          <td colspan="${columns}">${escapeHTML(emptyMessage)}</td>
        </tr>
      `;
      return;
    }

    body.innerHTML = rows.join("");
  }

  function renderDailyTable(daily) {
    const rows = [...daily]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((row) => `
        <tr>
          <td>${escapeHTML(formatDate(row.date))}</td>
          <td>${escapeHTML(formatNumber(row.invoiceCount))}</td>
          <td>${escapeHTML(formatCurrency(row.sales))}</td>
          <td>${escapeHTML(formatCurrency(row.tax))}</td>
          <td>${escapeHTML(formatCurrency(row.discount))}</td>
        </tr>
      `);

    renderTableRows(
      "salesReportTableBody",
      rows,
      "No sales data is available for this period.",
      5
    );
  }

  function renderProductTable(products) {
    const sorted = [...products].sort((a, b) =>
      b.revenue - a.revenue
    );

    const rows = sorted.map((product) => `
      <tr>
        <td>${escapeHTML(product.name)}</td>
        <td>${escapeHTML(formatNumber(product.quantity))}</td>
        <td>${escapeHTML(formatCurrency(product.revenue))}</td>
        <td>${escapeHTML(formatNumber(product.invoiceEntries))}</td>
      </tr>
    `);

    renderTableRows(
      "productReportTableBody",
      rows,
      "No product sales are available for this period.",
      4
    );

    // Compatibility with the older ID.
    renderTableRows(
      "topSellingProductsBody",
      rows,
      "No product sales are available for this period.",
      4
    );

    const topProduct = sorted[0] ?? null;
    const lowestProduct = sorted.length
      ? [...sorted].sort((a, b) => a.quantity - b.quantity)[0]
      : null;

    setText("topProductValue", topProduct?.name ?? "—");
    setText(
      "topProductDescription",
      topProduct
        ? `${formatNumber(topProduct.quantity)} units sold, contributing ${formatCurrency(topProduct.revenue)} in item revenue.`
        : "No product sales are available for this period."
    );

    setText("lowestProductValue", lowestProduct?.name ?? "—");
    setText(
      "lowestProductDescription",
      lowestProduct
        ? `${formatNumber(lowestProduct.quantity)} units recorded. This is the lowest quantity among products sold during this period.`
        : "No product sales are available for comparison."
    );
  }

  function renderCategoryTable(categories, products) {
    const body = $("categoryReportTableBody");

    if (!body) return;

    const totalCategorisedRevenue = categories.reduce(
      (sum, category) => sum + category.revenue,
      0
    );

    if (!categories.length) {
      const message = state.optionalErrors.categories
        ? "Category records could not be loaded. Check database permissions."
        : products.length
          ? "Category data is unavailable. Existing invoice items could not be matched to saved categories."
          : "No category sales are available for this period.";

      body.innerHTML = `
        <tr>
          <td colspan="4">${escapeHTML(message)}</td>
        </tr>
      `;

      const chart = $("categoryPerformanceChart");

      if (chart) {
        chart.textContent = message;
      }

      return;
    }

    body.innerHTML = categories.map((category) => {
      const share = totalCategorisedRevenue > 0
        ? (category.revenue / totalCategorisedRevenue) * 100
        : 0;

      return `
        <tr>
          <td>${escapeHTML(category.name)}</td>
          <td>${escapeHTML(formatNumber(category.quantity))}</td>
          <td>${escapeHTML(formatCurrency(category.revenue))}</td>
          <td>${escapeHTML(formatPercent(share))}</td>
        </tr>
      `;
    }).join("");

    const chart = $("categoryPerformanceChart");

    if (!chart) return;

    const maximum = Math.max(
      1,
      ...categories.map((category) => category.revenue)
    );

    chart.innerHTML = `
      <div class="category-chart-list">
        ${categories.map((category) => {
          const percentage = (category.revenue / maximum) * 100;

          return `
            <div class="category-chart-row">
              <div class="category-chart-label">
                <span>${escapeHTML(category.name)}</span>
                <strong>${escapeHTML(formatCurrency(category.revenue))}</strong>
              </div>
              <div class="category-chart-track" role="img"
                   aria-label="${escapeHTML(category.name)}: ${escapeHTML(formatCurrency(category.revenue))}">
                <div class="category-chart-fill"></div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    chart.querySelectorAll(".category-chart-fill").forEach((bar, index) => {
      bar.style.width = `${(
        categories[index].revenue / maximum
      ) * 100}%`;

      bar.style.height = "100%";
    });

    chart.querySelectorAll(".category-chart-track").forEach((track) => {
      track.style.height = "12px";
      track.style.background = "#eeeeee";
      track.style.borderRadius = "6px";
      track.style.overflow = "hidden";
    });

    chart.querySelectorAll(".category-chart-fill").forEach((bar) => {
      bar.style.background = "#222222";
      bar.style.borderRadius = "6px";
    });
  }

  function renderWeekdayTable(weekdayRows) {
    const rows = weekdayRows
      .filter((row) => row.invoices > 0)
      .sort((a, b) => b.sales - a.sales)
      .map((row) => `
        <tr>
          <td>${escapeHTML(row.weekday)}</td>
          <td>${escapeHTML(formatNumber(row.invoices))}</td>
          <td>${escapeHTML(formatCurrency(row.sales))}</td>
          <td>${escapeHTML(formatCurrency(row.averageBill))}</td>
        </tr>
      `);

    renderTableRows(
      "weekdayPerformanceBody",
      rows,
      "No weekday performance data is available for this period.",
      4
    );
  }

  function renderPeakInsights(daily, weekdayRows) {
    const { highest, lowest } = getPeakAndLowestDay(daily);

    setText(
      "peakSalesDayValue",
      highest ? formatCurrency(highest.sales) : "—"
    );

    setText(
      "peakSalesDayDescription",
      highest
        ? `${formatDate(highest.date)} · ${highest.invoiceCount} invoice(s)`
        : "No sales days are available for this period."
    );

    setText(
      "lowestSalesDayValue",
      lowest ? formatCurrency(lowest.sales) : "—"
    );

    setText(
      "lowestSalesDayDescription",
      lowest
        ? `${formatDate(lowest.date)} · ${lowest.invoiceCount} invoice(s). Lowest recorded sales among days with invoices.`
        : "No sales days are available for this period."
    );

    const qualifiedWeekdays = weekdayRows.filter(
      (row) => row.activeDays >= 2
    );

    const bestWeekday = [...qualifiedWeekdays].sort((a, b) => {
      const averageA = a.sales / a.activeDays;
      const averageB = b.sales / b.activeDays;

      return averageB - averageA;
    })[0];

    setText(
      "bestSalesWeekdayValue",
      bestWeekday ? bestWeekday.weekday : "Not enough data"
    );

    setText(
      "bestSalesWeekdayDescription",
      bestWeekday
        ? `${formatCurrency(bestWeekday.sales / bestWeekday.activeDays)} average sales per day across ${bestWeekday.activeDays} observed dates.`
        : "At least two dates for a weekday are needed for a useful comparison."
    );
  }

  function renderTrendChart(daily) {
    const container = $("salesTrendChart");

    if (!container) return;

    const groups = groupTrends(daily, state.trendMode);
    const modeLabels = {
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly"
    };

    const buttons = Object.entries(modeLabels).map(([mode, label]) => `
      <button
        class="secondary-button"
        type="button"
        data-trend-mode="${mode}"
        aria-pressed="${state.trendMode === mode ? "true" : "false"}"
      >${label}</button>
    `).join("");

    if (!groups.length) {
      container.innerHTML = `
        <div class="trend-mode-controls">${buttons}</div>
        <p class="empty-state">
          No sales trend data is available for this reporting period.
        </p>
      `;

      setText(
        "salesTrendSummary",
        "Sales trend analysis requires at least one valid dated invoice."
      );

      return;
    }

    const maximum = Math.max(1, ...groups.map((group) => group.sales));

    container.innerHTML = `
      <div class="trend-mode-controls">${buttons}</div>
      <div class="trend-chart-list" aria-label="${modeLabels[state.trendMode]} sales">
        ${groups.map((group) => `
          <div class="trend-chart-row">
            <div class="trend-chart-label">
              <span>${escapeHTML(group.label)}</span>
              <strong>${escapeHTML(formatCurrency(group.sales))}</strong>
            </div>
            <div
              class="trend-chart-track"
              role="img"
              aria-label="${escapeHTML(group.label)}: ${escapeHTML(formatCurrency(group.sales))}"
            >
              <div class="trend-chart-fill"></div>
            </div>
            <p class="trend-chart-caption">
              ${escapeHTML(formatNumber(group.invoices))}
              invoice(s)
            </p>
          </div>
        `).join("")}
      </div>
    `;

    container.querySelectorAll(".trend-chart-fill").forEach((bar, index) => {
      bar.style.width = `${(groups[index].sales / maximum) * 100}%`;
      bar.style.height = "100%";
      bar.style.background = "#222222";
      bar.style.borderRadius = "6px";
    });

    container.querySelectorAll(".trend-chart-track").forEach((track) => {
      track.style.height = "12px";
      track.style.background = "#eeeeee";
      track.style.borderRadius = "6px";
      track.style.overflow = "hidden";
    });

    container.querySelectorAll(".trend-chart-row").forEach((row) => {
      row.style.marginBottom = "16px";
    });

    container.querySelectorAll(".trend-chart-label").forEach((label) => {
      label.style.display = "flex";
      label.style.justifyContent = "space-between";
      label.style.gap = "12px";
      label.style.marginBottom = "6px";
    });

    container.querySelectorAll(".trend-mode-controls").forEach((controls) => {
      controls.style.display = "flex";
      controls.style.flexWrap = "wrap";
      controls.style.gap = "8px";
      controls.style.marginBottom = "18px";
    });

    const first = groups[0];
    const last = groups[groups.length - 1];

    let summary;

    if (groups.length === 1) {
      summary =
        `One ${state.trendMode} period is available, with sales of ${formatCurrency(first.sales)}. More historical data is needed to identify a trend.`;
    } else {
      const change = first.sales === 0
        ? null
        : ((last.sales - first.sales) / Math.abs(first.sales)) * 100;

      summary = change === null
        ? "The first comparison period has no sales, so a percentage change cannot be calculated reliably."
        : `Sales changed by ${formatPercent(change)} between the first and latest displayed ${state.trendMode} periods. This compares the selected periods and is not a forecast.`;
    }

    setText("salesTrendSummary", summary);
  }

  function renderBusinessInsights(invoices, daily, products, categories) {
    const container = $("businessInsightsList");

    if (!container) return;

    const insights = [];

    if (!invoices.length) {
      insights.push({
        title: "No recorded sales",
        detail: "There are no valid invoices in the selected reporting period. Choose another date range or record invoices before interpreting performance."
      });
    } else {
      const totalSales = invoices.reduce(
        (sum, invoice) => sum + getInvoiceTotal(invoice),
        0
      );

      const averageBill = totalSales / invoices.length;

      insights.push({
        title: "Average bill value",
        detail: `The average valid invoice is ${formatCurrency(averageBill)} across ${invoices.length} invoice(s).`
      });

      if (daily.length >= 4) {
        const midpoint = Math.floor(daily.length / 2);
        const firstHalf = daily.slice(0, midpoint);
        const secondHalf = daily.slice(midpoint);

        const firstAverage = firstHalf.reduce(
          (sum, row) => sum + row.sales,
          0
        ) / firstHalf.length;

        const secondAverage = secondHalf.reduce(
          (sum, row) => sum + row.sales,
          0
        ) / secondHalf.length;

        if (firstAverage > 0) {
          const change = (
            (secondAverage - firstAverage) / firstAverage
          ) * 100;

          insights.push({
            title: "Sales movement",
            detail: `Average sales per recorded active day in the later half of this period are ${formatPercent(Math.abs(change))} ${change >= 0 ? "higher" : "lower"} than in the earlier half. This comparison uses days with recorded invoices and is not a prediction.`
          });
        } else {
          insights.push({
            title: "Sales movement",
            detail: "The earlier comparison period has zero average sales, so a meaningful percentage change cannot be calculated."
          });
        }
      } else {
        insights.push({
          title: "Sales movement",
          detail: "More active sales days are needed to compare earlier and later performance reliably."
        });
      }

      const topProduct = products[0];

      if (topProduct) {
        insights.push({
          title: "Leading product by revenue",
          detail: `${topProduct.name} generated ${formatCurrency(topProduct.revenue)} in recorded item revenue, with ${formatNumber(topProduct.quantity)} unit(s) sold.`
        });
      } else {
        insights.push({
          title: "Product performance",
          detail: "No item-level sales are available in the selected invoices."
        });
      }

      const leadingCategory = categories[0];

      if (leadingCategory) {
        const categoryRevenue = categories.reduce(
          (sum, category) => sum + category.revenue,
          0
        );

        const share = categoryRevenue > 0
          ? (leadingCategory.revenue / categoryRevenue) * 100
          : 0;

        insights.push({
          title: "Leading category",
          detail: `${leadingCategory.name} contributed ${formatPercent(share)} of revenue from categories that could be identified in the recorded invoice items.`
        });
      } else {
        insights.push({
          title: "Category insight unavailable",
          detail: "Category performance cannot be calculated reliably because invoice items could not be matched to saved product categories."
        });
      }

      const peak = getPeakAndLowestDay(daily).highest;

      if (peak) {
        insights.push({
          title: "Highest recorded sales day",
          detail: `${formatDate(peak.date)} had the highest total among active sales days in the selected period, at ${formatCurrency(peak.sales)}.`
        });
      }

      if (state.optionalErrors.products) {
        insights.push({
          title: "Product catalog note",
          detail: "Saved product data could not be loaded. Product insights rely only on the product details stored in invoice items."
        });
      }
    }

    container.innerHTML = insights.map((insight) => `
      <article class="business-insight-item">
        <h3>${escapeHTML(insight.title)}</h3>
        <p>${escapeHTML(insight.detail)}</p>
      </article>
    `).join("");
  }

  function renderReport() {
    if (state.loading) {
      setStatus("Loading reports…");
      return;
    }

    if (state.error) {
      setStatus(state.error, true);
      return;
    }

    const invoices = getFilteredInvoices();
    const daily = buildDailyReport(invoices);
    const products = buildProductReport(invoices);
    const categories = buildCategoryReport(products);
    const weekdays = buildWeekdayReport(invoices);

    renderSummary(invoices, daily, products);
    renderTrendChart(daily);
    renderPeakInsights(daily, weekdays);
    renderWeekdayTable(weekdays);
    renderProductTable(products);
    renderCategoryTable(categories, products);
    renderDailyTable(daily);
    renderBusinessInsights(invoices, daily, products, categories);

    const startLabel = state.startDate
      ? formatDate(state.startDate)
      : "All available dates";

    const endLabel = state.endDate
      ? formatDate(state.endDate)
      : "Latest available date";

    setText(
      "reportGeneratedAt",
      `Report period: ${startLabel} – ${endLabel}`
    );

    setText(
      "reportsFooterStatus",
      `${invoices.length} valid invoice(s) included`
    );

    setStatus(
      `Reports updated using ${invoices.length} valid invoice(s).`
    );
  }

  function applyDateFilters() {
    const start = $("reportStartDate")?.value ?? "";
    const end = $("reportEndDate")?.value ?? "";

    if (start && end && start > end) {
      setStatus("The start date cannot be after the end date.", true);
      return;
    }

    state.startDate = start;
    state.endDate = end;

    renderReport();
  }

  function resetDateFilters() {
    if ($("reportStartDate")) $("reportStartDate").value = "";
    if ($("reportEndDate")) $("reportEndDate").value = "";
    if ($("reportPreset")) $("reportPreset").value = "";

    state.startDate = "";
    state.endDate = "";

    renderReport();
  }

  function setPreset(period) {
    const today = new Date();
    const end = localDateString(today);
    const start = new Date(today);

    if (period === "today") {
      state.startDate = end;
      state.endDate = end;
    } else if (period === "7days") {
      start.setDate(start.getDate() - 6);
      state.startDate = localDateString(start);
      state.endDate = end;
    } else if (period === "30days") {
      start.setDate(start.getDate() - 29);
      state.startDate = localDateString(start);
      state.endDate = end;
    } else {
      state.startDate = "";
      state.endDate = "";
    }

    if ($("reportStartDate")) {
      $("reportStartDate").value = state.startDate;
    }

    if ($("reportEndDate")) {
      $("reportEndDate").value = state.endDate;
    }

    renderReport();
  }

  function safeCsvCell(value) {
    let text = String(value ?? "");

    // Prevent spreadsheet formula execution for text data.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = `'${text}`;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCSV(filename, rows) {
    const csv = "\uFEFF" + rows
      .map((row) => row.map(safeCsvCell).join(","))
      .join("\r\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.hidden = true;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportReport() {
    if (state.loading || state.error) {
      setStatus("Wait until report data has loaded before exporting.", true);
      return;
    }

    const invoices = getFilteredInvoices();
    const daily = buildDailyReport(invoices);
    const products = buildProductReport(invoices);
    const categories = buildCategoryReport(products);

    const rows = [
      ["Restaurant Business Report"],
      ["Generated", new Date().toLocaleString("en-IN")],
      ["Start date", state.startDate || "All available dates"],
      ["End date", state.endDate || "Latest available date"],
      [],
      ["Daily Sales"],
      [
        "Date",
        "Invoice Count",
        "Sales INR",
        "Tax INR",
        "Discount INR",
        "Items Sold"
      ]
    ];

    [...daily]
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((row) => {
        rows.push([
          row.date,
          row.invoiceCount,
          row.sales.toFixed(2),
          row.tax.toFixed(2),
          row.discount.toFixed(2),
          row.quantity
        ]);
      });

    rows.push(
      [],
      ["Product Performance"],
      ["Product", "Quantity Sold", "Item Revenue INR", "Invoice Entries", "Category"]
    );

    products.forEach((product) => {
      rows.push([
        product.name,
        product.quantity,
        product.revenue.toFixed(2),
        product.invoiceEntries,
        product.categoryName
      ]);
    });

    rows.push(
      [],
      ["Category Performance"],
      ["Category", "Quantity Sold", "Item Revenue INR"]
    );

    categories.forEach((category) => {
      rows.push([
        category.name,
        category.quantity,
        category.revenue.toFixed(2)
      ]);
    });

    downloadCSV(
      `restaurant-report-${localDateString(new Date())}.csv`,
      rows
    );

    setStatus("CSV report exported.");
  }

  function subscribe(path, onData, onError) {
    const shared = window.restaurantFirebase;
    const reference = state.api.ref(shared.db, path);

    const unsubscribe = state.api.onValue(
      reference,
      onData,
      onError
    );

    if (typeof unsubscribe === "function") {
      state.unsubscribers.push(unsubscribe);
    }
  }

  function updateLoadingState() {
    state.loading = !(
      state.ready.invoices &&
      state.ready.products &&
      state.ready.categories
    );

    if (state.loading) {
      setStatus("Loading invoices and product information…");
      return;
    }

    renderReport();
  }

  function handleInvoiceError(error) {
    state.ready.invoices = true;
    state.error =
      error?.code === "PERMISSION_DENIED"
        ? "Invoice access denied. Check Firebase Realtime Database rules."
        : "Unable to load invoice records.";

    state.loading = false;
    setConnectionStatus("Database error", true);
    setStatus(state.error, true);
  }

  function handleOptionalError(section, error) {
    state.optionalErrors[section] =
      error?.code === "PERMISSION_DENIED"
        ? "permission"
        : "unavailable";

    state.ready[section] = true;

    updateLoadingState();
  }

  async function initializePage() {
    if (state.initialized) return;
    state.initialized = true;

    const shared = window.restaurantFirebase;

    if (!shared?.readyPromise) {
      state.loading = false;
      state.error = "Firebase configuration is unavailable.";
      setConnectionStatus("Configuration error", true);
      setStatus(state.error, true);
      return;
    }

    try {
      setStatus("Connecting to report data…");

      await shared.readyPromise;

      if (shared.error || !shared.db || !shared.sdk?.database) {
        throw new Error("The Firebase database connection is unavailable.");
      }

      const access = window.restaurantAccess;

      if (access?.readyPromise) {
        await access.readyPromise;
      }

      if (!access?.authorized || access.user?.uid !== OWNER_UID) {
        throw new Error("Owner access is required to view reports.");
      }

      state.api = {
        ref: shared.sdk.database.ref,
        onValue: shared.sdk.database.onValue
      };

      setConnectionStatus("Connected");

      subscribe(
        PATHS.invoices,
        (snapshot) => {
          state.invoices = normalizeRecords(snapshot.val());
          state.ready.invoices = true;
          state.error = "";

          updateLoadingState();
        },
        handleInvoiceError
      );

      subscribe(
        PATHS.products,
        (snapshot) => {
          state.products = normalizeLookup(snapshot.val());
          state.ready.products = true;

          updateLoadingState();
        },
        (error) => handleOptionalError("products", error)
      );

      subscribe(
        PATHS.categories,
        (snapshot) => {
          state.categories = normalizeLookup(snapshot.val());
          state.ready.categories = true;

          updateLoadingState();
        },
        (error) => handleOptionalError("categories", error)
      );

      subscribe(
        PATHS.business,
        (snapshot) => {
          state.businessProfile = snapshot.val() || {};
          updateBranding();
        },
        () => {
          state.businessProfile = {};
          updateBranding();
        }
      );
    } catch (error) {
      state.loading = false;
      state.error =
        error?.message || "Could not connect to report data.";

      setConnectionStatus("Connection error", true);
      setStatus(state.error, true);
    }
  }

  function bindEvents() {
    $("reportFiltersForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      applyDateFilters();
    });

    $("reportApplyFiltersBtn")?.addEventListener("click", (event) => {
      event.preventDefault();
      applyDateFilters();
    });

    $("reportResetFiltersBtn")?.addEventListener("click", (event) => {
      event.preventDefault();
      resetDateFilters();
    });

    $("reportExportBtn")?.addEventListener("click", exportReport);

    $("reportPreset")?.addEventListener("change", (event) => {
      setPreset(event.target.value);
    });

    $("salesTrendChart")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-trend-mode]");

      if (!button) return;

      const mode = button.dataset.trendMode;

      if (!["daily", "weekly", "monthly"].includes(mode)) {
        return;
      }

      state.trendMode = mode;

      if (!state.loading && !state.error) {
        renderTrendChart(buildDailyReport(getFilteredInvoices()));
      }
    });

    window.addEventListener("pagehide", () => {
      state.unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          // Cleanup errors should not prevent other listeners from closing.
        }
      });

      state.unsubscribers = [];
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    updateBranding();
    initializePage();
  });
})();
