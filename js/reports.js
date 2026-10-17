"use strict";

/*
 * Restaurant Billing Software
 * File: js/reports.js
 *
 * Phase 1: Frontend analytics with clearly identified demo data.
 *
 * Features:
 * - Executive KPIs
 * - Sales trends by hour, day, week and month
 * - Product and category revenue analysis
 * - Hourly and weekday sales analytics
 * - Current vs previous period comparisons
 * - Automated business insights
 * - Category, product and date filters
 * - Product performance and category tables
 * - CSV report exports
 *
 * Important:
 * The dataset below is illustrative demo data, not actual sales.
 * Firebase Realtime Database integration will replace the demo
 * dataset with real invoice and invoice-item records.
 *
 * Sales revenue is not profit.
 * Profit analysis requires costs and expenses.
 */

(() => {
  // ==================================================
  // 1. DOM REFERENCES
  // ==================================================

  const $ = (selector, parent = document) =>
    parent.querySelector(selector);

  const $$ = (selector, parent = document) =>
    Array.from(parent.querySelectorAll(selector));

  const filtersForm = $("#reportFilters");
  const periodSelect = $("#reportPeriod");
  const granularitySelect = $("#reportGranularity");
  const categorySelect = $("#reportCategory");
  const productSelect = $("#reportProduct");

  const customRange = $("#reportCustomRange");
  const dateFromInput = $("#reportDateFrom");
  const dateToInput = $("#reportDateTo");

  const refreshButton = $("#refreshReportsBtn");
  const exportButton = $("#exportReportsBtn");
  const exportProductsButton = $("#exportProductReportBtn");

  const filterMessage = $("#reportFilterMessage");
  const dataStatus = $("#reportDataStatus");

  if (!filtersForm || !periodSelect) {
    console.error("Reports: Required filter elements were not found.");
    return;
  }

  // ==================================================
  // 2. CONSTANTS
  // ==================================================

  const MAX_DAYS = 120;

  const moneyFormat = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  const compactMoneyFormat = new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: 1
  });

  const integerFormat = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 0
  });

  const percentFormat = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  const WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday"
  ];

  // ==================================================
  // 3. DEMO PRODUCT CATALOG
  // ==================================================

  const demoProducts = [
    {
      id: "P001",
      name: "Chicken Biryani",
      category: "Biryani",
      price: 180
    },
    {
      id: "P002",
      name: "Paneer Butter Masala",
      category: "Main Course",
      price: 160
    },
    {
      id: "P003",
      name: "French Fries",
      category: "Starters",
      price: 90
    },
    {
      id: "P004",
      name: "Cold Coffee",
      category: "Beverages",
      price: 100
    },
    {
      id: "P005",
      name: "Chocolate Brownie",
      category: "Desserts",
      price: 120
    },
    {
      id: "P006",
      name: "Veg Biryani",
      category: "Biryani",
      price: 140
    },
    {
      id: "P007",
      name: "Chicken Soup",
      category: "Soups",
      price: 110
    },
    {
      id: "P008",
      name: "Family Meal Combo",
      category: "Combos",
      price: 450
    },
    {
      id: "P009",
      name: "Masala Tea",
      category: "Beverages",
      price: 30
    },
    {
      id: "P010",
      name: "Paneer Tikka",
      category: "Starters",
      price: 190
    },
    {
      id: "P011",
      name: "Seasonal Special Thali",
      category: "Seasonal Specials",
      price: 250
    },
    {
      id: "P012",
      name: "Gulab Jamun",
      category: "Desserts",
      price: 60
    }
  ];

  const productMap = new Map(
    demoProducts.map(product => [product.id, product])
  );

  // ==================================================
  // 4. GENERAL HELPERS
  // ==================================================

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

  function money(value) {
    return moneyFormat.format(Number(value) || 0);
  }

  function compactMoney(value) {
    return "₹" + compactMoneyFormat.format(Number(value) || 0);
  }

  function integer(value) {
    return integerFormat.format(Number(value) || 0);
  }

  function percentage(value) {
    return percentFormat.format(Number(value) || 0) + "%";
  }

  function roundMoney(value) {
    return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  }

  function normalise(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function localDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function parseLocalDate(dateString) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString))) {
      return null;
    }

    const [year, month, day] = dateString.split("-").map(Number);

    const date = new Date(year, month - 1, day);

    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }

    return date;
  }

  function addDays(date, days) {
    const result = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    result.setDate(result.getDate() + days);

    return result;
  }

  function formatShortDate(dateString) {
    const date = parseLocalDate(dateString);

    if (!date) return dateString;

    return new Intl.DateTimeFormat("en-IN", {
      day: "numeric",
      month: "short"
    }).format(date);
  }

  function formatMonth(dateString) {
    const date = parseLocalDate(dateString);

    if (!date) return dateString;

    return new Intl.DateTimeFormat("en-IN", {
      month: "short",
      year: "2-digit"
    }).format(date);
  }

  function formatHour(hour) {
    const suffix = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;

    return `${displayHour} ${suffix}`;
  }

  function showMessage(message, isError = false) {
    filterMessage.textContent = message;

    filterMessage.dataset.type = isError ? "error" : "info";
  }

  function clearMessage() {
    filterMessage.textContent = "";
    delete filterMessage.dataset.type;
  }

  // ==================================================
  // 5. GENERATE CLEARLY LABELLED DEMO TRANSACTIONS
  // ==================================================

  /*
   * These records are generated for demonstrating the analytics.
   * They are NOT actual restaurant transactions.
   *
   * Each invoice contains:
   * - Local date and timestamp
   * - Cash or UPI
   * - Product-level line items
   * - Quantities, unit prices and line revenue
   * - Generated/cancelled status
   */

  let randomState = 0x4a2f18b7;

  function seededRandom() {
    randomState = (
      Math.imul(randomState, 1664525) + 1013904223
    ) >>> 0;

    return randomState / 4294967296;
  }

  function choose(items) {
    return items[Math.floor(seededRandom() * items.length)];
  }

  function generateDemoTransactions() {
    randomState = 0x4a2f18b7;

    const transactions = [];
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const popularHours = [
      8, 9, 10, 11, 12, 12, 13, 13,
      14, 15, 17, 18, 18, 19, 19, 20, 21, 21, 22
    ];

    for (let daysAgo = MAX_DAYS - 1; daysAgo >= 0; daysAgo--) {
      const date = addDays(today, -daysAgo);

      const isoDate = localDateString(date);

      /*
       * Vary daily activity to create a non-flat demonstration
       * dataset with busy and quiet trading days.
       */

      const dayIndex = MAX_DAYS - 1 - daysAgo;

      const weekendBonus =
        date.getDay() === 0 || date.getDay() === 6 ? 2 : 0;

      const invoiceCount =
        4 + (dayIndex % 7) + weekendBonus;

      for (let index = 0; index < invoiceCount; index++) {
        const hour = choose(popularHours);

        const minute = Math.floor(seededRandom() * 60);
        const second = Math.floor(seededRandom() * 60);

        const timestamp = new Date(date);

        timestamp.setHours(hour, minute, second, 0);

        const itemCount = 1 + Math.floor(seededRandom() * 4);

        const selectedProducts = new Set();
        const items = [];

        while (selectedProducts.size < itemCount) {
          const product = choose(demoProducts);
          selectedProducts.add(product.id);
        }

        for (const productId of selectedProducts) {
          const product = productMap.get(productId);

          const quantity = 1 + Math.floor(seededRandom() * 3);

          items.push({
            productId: product.id,
            productName: product.name,
            category: product.category,
            quantity,
            unitPrice: product.price,
            revenue: roundMoney(product.price * quantity)
          });
        }

        const cancelled = seededRandom() < 0.025;

        const transaction = {
          id: `DEMO-${isoDate.replace(/-/g, "")}-${String(index + 1).padStart(3, "0")}`,
          date: isoDate,
          hour,
          timestamp,
          paymentMethod: seededRandom() < 0.55 ? "cash" : "upi",
          status: cancelled ? "cancelled" : "generated",
          items
        };

        transaction.revenue = roundMoney(
          items.reduce((sum, item) => sum + item.revenue, 0)
        );

        transactions.push(transaction);
      }
    }

    return transactions;
  }

  const demoTransactions = generateDemoTransactions();

  const minimumAvailableDate =
    demoTransactions[0].date;

  const maximumAvailableDate =
    demoTransactions[demoTransactions.length - 1].date;

  // ==================================================
  // 6. POPULATE PRODUCT / CATEGORY FILTERS
  // ==================================================

  function populateCategoryOptions() {
    const previousValue = categorySelect.value;

    const categories = [
      ...new Set(demoProducts.map(product => product.category))
    ].sort((a, b) => a.localeCompare(b));

    categorySelect.innerHTML = `
      <option value="">All Categories</option>
      ${categories.map(category => `
        <option value="${escapeHTML(category)}">
          ${escapeHTML(category)}
        </option>
      `).join("")}
    `;

    if (categories.includes(previousValue)) {
      categorySelect.value = previousValue;
    }
  }

  function populateProductOptions() {
    const previousValue = productSelect.value;
    const selectedCategory = categorySelect.value;

    const products = demoProducts
      .filter(product => (
        !selectedCategory || product.category === selectedCategory
      ))
      .sort((a, b) => a.name.localeCompare(b.name));

    productSelect.innerHTML = `
      <option value="">All Products</option>
      ${products.map(product => `
        <option value="${escapeHTML(product.id)}">
          ${escapeHTML(product.name)}
        </option>
      `).join("")}
    `;

    if (products.some(product => product.id === previousValue)) {
      productSelect.value = previousValue;
    }
  }

  categorySelect.addEventListener("change", () => {
    populateProductOptions();
  });

  populateCategoryOptions();
  populateProductOptions();

  // ==================================================
  // 7. DATE RANGE FILTERS
  // ==================================================

  function getSelectedDateRange() {
    const today = new Date();

    today.setHours(0, 0, 0, 0);

    const todayString = localDateString(today);
    const period = periodSelect.value;

    if (period === "today") {
      return {
        from: todayString,
        to: todayString,
        label: "Today",
        valid: true
      };
    }

    if (period === "7days" || period === "30days") {
      const count = period === "7days" ? 7 : 30;

      return {
        from: localDateString(addDays(today, 1 - count)),
        to: todayString,
        label: period === "7days" ? "Last 7 Days" : "Last 30 Days",
        valid: true
      };
    }

    if (period === "month") {
      const firstDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        1
      );

      return {
        from: localDateString(firstDay),
        to: todayString,
        label: "This Month",
        valid: true
      };
    }

    if (period === "previousMonth") {
      const firstDay = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1
      );

      const lastDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        0
      );

      return {
        from: localDateString(firstDay),
        to: localDateString(lastDay),
        label: "Previous Month",
        valid: true
      };
    }

    if (period === "year") {
      const firstDay = new Date(today.getFullYear(), 0, 1);

      return {
        from: localDateString(firstDay),
        to: todayString,
        label: "This Year",
        valid: true
      };
    }

    if (period === "custom") {
      const from = dateFromInput.value;
      const to = dateToInput.value;

      if (!parseLocalDate(from) || !parseLocalDate(to)) {
        return {
          valid: false,
          message: "Select valid start and end dates."
        };
      }

      if (from > to) {
        return {
          valid: false,
          message: "The start date cannot be later than the end date."
        };
      }

      return {
        from,
        to,
        label: "Custom Range",
        valid: true
      };
    }

    if (period === "all") {
      return {
        from: minimumAvailableDate,
        to: maximumAvailableDate,
        label: "All Available Data",
        valid: true
      };
    }

    return {
      valid: false,
      message: "Please select a valid reporting period."
    };
  }

  function updateCustomRangeVisibility() {
    const visible = periodSelect.value === "custom";

    customRange.hidden = !visible;

    dateFromInput.required = visible;
    dateToInput.required = visible;
  }

  periodSelect.addEventListener("change", updateCustomRangeVisibility);

  updateCustomRangeVisibility();

  // ==================================================
  // 8. COMPARISON PERIOD
  // ==================================================

  function getPreviousDateRange(currentRange) {
    if (periodSelect.value === "all") {
      return null;
    }

    const currentFrom = parseLocalDate(currentRange.from);
    const currentTo = parseLocalDate(currentRange.to);

    if (!currentFrom || !currentTo) {
      return null;
    }

    if (periodSelect.value === "previousMonth") {
      const previousFrom = new Date(
        currentFrom.getFullYear(),
        currentFrom.getMonth() - 1,
        1
      );

      const previousTo = new Date(
        currentFrom.getFullYear(),
        currentFrom.getMonth(),
        0
      );

      return {
        from: localDateString(previousFrom),
        to: localDateString(previousTo),
        label: "Previous Month"
      };
    }

    if (periodSelect.value === "year") {
      const previousFrom = new Date(
        currentFrom.getFullYear() - 1,
        0,
        1
      );

      const previousTo = new Date(
        currentTo.getFullYear() - 1,
        currentTo.getMonth(),
        currentTo.getDate()
      );

      return {
        from: localDateString(previousFrom),
        to: localDateString(previousTo),
        label: "Same Period Last Year"
      };
    }

    const dayCount = Math.round(
      (currentTo.getTime() - currentFrom.getTime()) / 86400000
    ) + 1;

    const previousTo = addDays(currentFrom, -1);
    const previousFrom = addDays(previousTo, -(dayCount - 1));

    return {
      from: localDateString(previousFrom),
      to: localDateString(previousTo),
      label: "Previous Comparable Period"
    };
  }

  // ==================================================
  // 9. APPLY PRODUCT AND DATE FILTERS
  // ==================================================

  function matchesSelectedProduct(item) {
    const selectedCategory = categorySelect.value;
    const selectedProduct = productSelect.value;

    if (
      selectedCategory &&
      item.category !== selectedCategory
    ) {
      return false;
    }

    if (
      selectedProduct &&
      item.productId !== selectedProduct
    ) {
      return false;
    }

    return true;
  }

  function getTransactionsInRange(range) {
    if (!range) return [];

    const result = [];

    for (const transaction of demoTransactions) {
      if (
        transaction.date < range.from ||
        transaction.date > range.to
      ) {
        continue;
      }

      // Exclude cancelled records from valid sales.
      if (transaction.status !== "generated") {
        continue;
      }

      const items = transaction.items.filter(matchesSelectedProduct);

      if (items.length === 0) {
        continue;
      }

      const revenue = roundMoney(
        items.reduce((sum, item) => sum + item.revenue, 0)
      );

      result.push({
        ...transaction,
        items,
        revenue
      });
    }

    return result;
  }

  // ==================================================
  // 10. ANALYTICS CALCULATIONS
  // ==================================================

  function analyse(transactions) {
    const revenue = roundMoney(
      transactions.reduce(
        (sum, transaction) => sum + transaction.revenue,
        0
      )
    );

    const invoiceCount = transactions.length;

    const unitsSold = transactions.reduce(
      (sum, transaction) => (
        sum + transaction.items.reduce(
          (itemSum, item) => itemSum + item.quantity,
          0
        )
      ),
      0
    );

    const averageOrderValue = invoiceCount > 0
      ? roundMoney(revenue / invoiceCount)
      : 0;

    const productStats = new Map();
    const categoryStats = new Map();

    for (const transaction of transactions) {
      for (const item of transaction.items) {
        if (!productStats.has(item.productId)) {
          productStats.set(item.productId, {
            id: item.productId,
            name: item.productName,
            category: item.category,
            units: 0,
            revenue: 0,
            invoiceCount: 0
          });
        }

        const product = productStats.get(item.productId);

        product.units += item.quantity;
        product.revenue += item.revenue;
        product.invoiceCount += 1;

        if (!categoryStats.has(item.category)) {
          categoryStats.set(item.category, {
            name: item.category,
            productIds: new Set(),
            units: 0,
            revenue: 0
          });
        }

        const category = categoryStats.get(item.category);

        category.productIds.add(item.productId);
        category.units += item.quantity;
        category.revenue += item.revenue;
      }
    }

    const products = Array.from(productStats.values())
      .map(product => ({
        ...product,
        revenue: roundMoney(product.revenue)
      }))
      .sort((a, b) => b.revenue - a.revenue);

    const categories = Array.from(categoryStats.values())
      .map(category => ({
        ...category,
        productCount: category.productIds.size,
        revenue: roundMoney(category.revenue)
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      revenue,
      invoiceCount,
      unitsSold,
      averageOrderValue,
      products,
      categories
    };
  }

  function getRevenueShare(revenue, totalRevenue) {
    if (totalRevenue <= 0) return 0;

    return (revenue / totalRevenue) * 100;
  }

  // ==================================================
  // 11. TIME-SERIES GROUPING
  // ==================================================

  function getWeekStart(date) {
    const start = new Date(date);

    const day = start.getDay();
    const daysBack = day === 0 ? 6 : day - 1;

    start.setDate(start.getDate() - daysBack);
    start.setHours(0, 0, 0, 0);

    return start;
  }

  function groupTransactionsByTime(transactions, granularity) {
    const groups = new Map();

    if (granularity === "hour") {
      for (let hour = 0; hour < 24; hour++) {
        groups.set(hour, {
          key: String(hour),
          label: formatHour(hour),
          revenue: 0,
          count: 0
        });
      }

      for (const transaction of transactions) {
        const bucket = groups.get(transaction.hour);

        bucket.revenue += transaction.revenue;
        bucket.count += 1;
      }

      return Array.from(groups.values()).map(bucket => ({
        ...bucket,
        revenue: roundMoney(bucket.revenue)
      }));
    }

    for (const transaction of transactions) {
      const date = parseLocalDate(transaction.date);

      if (!date) continue;

      let key;
      let label;

      if (granularity === "day") {
        key = transaction.date;
        label = formatShortDate(transaction.date);
      } else if (granularity === "week") {
        const weekStart = getWeekStart(date);

        key = localDateString(weekStart);
        label = formatShortDate(key);
      } else {
        key = transaction.date.slice(0, 7);
        label = formatMonth(`${key}-01`);
      }

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label,
          revenue: 0,
          count: 0
        });
      }

      const bucket = groups.get(key);

      bucket.revenue += transaction.revenue;
      bucket.count += 1;
    }

    return Array.from(groups.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(bucket => ({
        ...bucket,
        revenue: roundMoney(bucket.revenue)
      }));
  }

  function groupTransactionsByWeekday(transactions) {
    const groups = WEEKDAYS.map((day, index) => ({
      key: index,
      label: day.slice(0, 3),
      revenue: 0,
      count: 0
    }));

    for (const transaction of transactions) {
      const date = parseLocalDate(transaction.date);

      if (!date) continue;

      const bucket = groups[date.getDay()];

      bucket.revenue += transaction.revenue;
      bucket.count += 1;
    }

    return groups.map(bucket => ({
      ...bucket,
      revenue: roundMoney(bucket.revenue)
    }));
  }

  // ==================================================
  // 12. SVG CHART HELPERS
  // ==================================================

  /*
   * Charts use native SVG, so no third-party chart library
   * or external API is required for the frontend demo.
   */

  function showChartMessage(container, message) {
    container.innerHTML = `
      <div
        style="
          min-height:220px;
          display:flex;
          align-items:center;
          justify-content:center;
          padding:24px;
          text-align:center;
          color:#6b7280;
          font-size:13px;
          line-height:1.7;
        "
      >
        ${escapeHTML(message)}
      </div>
    `;
  }

  function svgText(x, y, text, options = {}) {
    const anchor = options.anchor || "start";
    const size = options.size || 11;
    const fill = options.fill || "#6b7280";
    const weight = options.weight || 400;

    return `
      <text
        x="${x}"
        y="${y}"
        text-anchor="${anchor}"
        font-size="${size}"
        font-weight="${weight}"
        fill="${fill}"
      >${escapeHTML(text)}</text>
    `;
  }

  function renderLineChart(container, points) {
    if (!points.length) {
      showChartMessage(container, "No sales data for this period.");
      return;
    }

    const width = 900;
    const height = 320;

    const left = 76;
    const right = 22;
    const top = 25;
    const bottom = 58;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    const maximum = Math.max(
      1,
      ...points.map(point => point.revenue)
    );

    const gridCount = 4;

    let svg = `
      <svg
        viewBox="0 0 ${width} ${height}"
        width="100%"
        role="img"
        aria-label="Sales revenue trend chart"
        xmlns="http://www.w3.org/2000/svg"
      >
    `;

    // Grid and Y-axis labels.
    for (let index = 0; index <= gridCount; index++) {
      const ratio = index / gridCount;

      const y = top + ratio * plotHeight;
      const value = maximum * (1 - ratio);

      svg += `
        <line
          x1="${left}"
          y1="${y}"
          x2="${width - right}"
          y2="${y}"
          stroke="#e5e7eb"
          stroke-width="1"
        />
      `;

      svg += svgText(
        left - 10,
        y + 4,
        compactMoney(value),
        { anchor: "end", size: 10 }
      );
    }

    const coordinates = points.map((point, index) => {
      const x = points.length === 1
        ? left + plotWidth / 2
        : left + (index / (points.length - 1)) * plotWidth;

      const y = top + plotHeight -
        (point.revenue / maximum) * plotHeight;

      return {
        x,
        y,
        point
      };
    });

    // X-axis labels.
    const maximumLabels = 8;

    const labelStep = Math.max(
      1,
      Math.ceil(points.length / maximumLabels)
    );

    coordinates.forEach((coordinate, index) => {
      const isLast = index === points.length - 1;

      if (index % labelStep !== 0 && !isLast) {
        return;
      }

      svg += svgText(
        coordinate.x,
        height - 22,
        coordinate.point.label,
        { anchor: "middle", size: 10 }
      );
    });

    const path = coordinates.map((coordinate, index) => (
      `${index === 0 ? "M" : "L"} ${coordinate.x} ${coordinate.y}`
    )).join(" ");

    svg += `
      <path
        d="${path}"
        fill="none"
        stroke="#111111"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    `;

    coordinates.forEach(coordinate => {
      svg += `
        <circle
          cx="${coordinate.x}"
          cy="${coordinate.y}"
          r="4"
          fill="#111111"
          stroke="#ffffff"
          stroke-width="1.5"
        >
          <title>
            ${escapeHTML(coordinate.point.label)}:
            ${money(coordinate.point.revenue)}
          </title>
        </circle>
      `;
    });

    svg += "</svg>";

    container.innerHTML = svg;
  }

  function renderHorizontalBarChart(
    container,
    items,
    labelKey,
    valueKey,
    formatter = compactMoney
  ) {
    if (!items.length || !items.some(item => item[valueKey] > 0)) {
      showChartMessage(container, "No product or category sales data available.");
      return;
    }

    const width = 900;
    const rowHeight = 36;
    const height = Math.max(240, items.length * rowHeight + 30);

    const left = 190;
    const right = 95;
    const top = 12;

    const plotWidth = width - left - right;

    const maximum = Math.max(
      1,
      ...items.map(item => item[valueKey])
    );

    let svg = `
      <svg
        viewBox="0 0 ${width} ${height}"
        width="100%"
        role="img"
        aria-label="Ranked business performance bar chart"
        xmlns="http://www.w3.org/2000/svg"
      >
    `;

    items.forEach((item, index) => {
      const y = top + index * rowHeight;

      const barWidth =
        (item[valueKey] / maximum) * plotWidth;

      svg += svgText(
        left - 12,
        y + 19,
        item[labelKey],
        {
          anchor: "end",
          size: 11,
          fill: "#374151",
          weight: index === 0 ? 700 : 400
        }
      );

      svg += `
        <rect
          x="${left}"
          y="${y + 4}"
          width="${plotWidth}"
          height="18"
          rx="3"
          fill="#f3f4f6"
        />

        <rect
          x="${left}"
          y="${y + 4}"
          width="${Math.max(0, barWidth)}"
          height="18"
          rx="3"
          fill="${index === 0 ? "#111111" : "#777777"}"
        >
          <title>
            ${escapeHTML(item[labelKey])}: ${formatter(item[valueKey])}
          </title>
        </rect>
      `;

      svg += svgText(
        width - right + 12,
        y + 19,
        formatter(item[valueKey]),
        { size: 10, fill: "#111111" }
      );
    });

    svg += "</svg>";

    container.innerHTML = svg;
  }

  function renderVerticalBarChart(
    container,
    items,
    formatter = compactMoney,
    options = {}
  ) {
    if (!items.length) {
      showChartMessage(container, "No data available for this chart.");
      return;
    }

    const width = 900;
    const height = 300;

    const left = 60;
    const right = 20;
    const top = 24;
    const bottom = 58;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    const maximum = Math.max(
      1,
      ...items.map(item => item.revenue)
    );

    const gap = items.length > 16 ? 3 : 8;

    const barWidth = Math.max(
      2,
      (plotWidth - gap * items.length) / items.length
    );

    let svg = `
      <svg
        viewBox="0 0 ${width} ${height}"
        width="100%"
        role="img"
        aria-label="Business sales bar chart"
        xmlns="http://www.w3.org/2000/svg"
      >
    `;

    for (let index = 0; index <= 4; index++) {
      const ratio = index / 4;
      const y = top + ratio * plotHeight;
      const value = maximum * (1 - ratio);

      svg += `
        <line
          x1="${left}"
          y1="${y}"
          x2="${width - right}"
          y2="${y}"
          stroke="#e5e7eb"
          stroke-width="1"
        />
      `;

      svg += svgText(
        left - 8,
        y + 4,
        formatter(value),
        { anchor: "end", size: 10 }
      );
    }

    items.forEach((item, index) => {
      const x = left + index * (barWidth + gap);

      const barHeight =
        (item.revenue / maximum) * plotHeight;

      const y = top + plotHeight - barHeight;

      svg += `
        <rect
          x="${x}"
          y="${y}"
          width="${barWidth}"
          height="${barHeight}"
          rx="2"
          fill="${barHeight > 0 ? "#111111" : "#e5e7eb"}"
        >
          <title>
            ${escapeHTML(item.label)}: ${formatter(item.revenue)}
          </title>
        </rect>
      `;

      const labelStep = Math.max(
        1,
        Math.ceil(items.length / 10)
      );

      if (index % labelStep === 0 || index === items.length - 1) {
        svg += svgText(
          x + barWidth / 2,
          height - 25,
          item.label,
          { anchor: "middle", size: 9 }
        );
      }
    });

    svg += "</svg>";

    container.innerHTML = svg;
  }

  // ==================================================
  // 13. EXECUTIVE KPI UPDATES
  // ==================================================

  function formatChange(current, previous) {
    if (previous === null || previous === undefined) {
      return "No comparable period";
    }

    if (previous === 0) {
      return current === 0
        ? "No change"
        : "New activity; previous value was zero";
    }

    const change = ((current - previous) / previous) * 100;

    const label = change > 0
      ? "increase"
      : change < 0
        ? "decrease"
        : "no change";

    return `${Math.abs(change).toFixed(1)}% ${label} vs previous period`;
  }

  function calculateGrowth(current, previous) {
    if (previous === null || previous === undefined) {
      return "—";
    }

    if (previous === 0) {
      return current === 0 ? "0%" : "N/A";
    }

    const change = ((current - previous) / previous) * 100;

    return `${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
  }

  function renderExecutiveKPIs(current, previous) {
    $("#reportRevenue").textContent = money(current.revenue);

    $("#reportInvoiceCount").textContent =
      integer(current.invoiceCount);

    $("#reportAverageOrder").textContent =
      money(current.averageOrderValue);

    $("#reportGrowth").textContent =
      calculateGrowth(
        current.revenue,
        previous?.revenue ?? null
      );

    $("#reportRevenueChange").textContent =
      formatChange(current.revenue, previous?.revenue ?? null);

    $("#reportInvoiceChange").textContent =
      formatChange(
        current.invoiceCount,
        previous?.invoiceCount ?? null
      );

    $("#reportGrowthDescription").textContent =
      previous
        ? previous.label
        : "No comparable period available";
  }

  // ==================================================
  // 14. PRODUCT PERFORMANCE TABLE
  // ==================================================

  function renderProductTable(analysis) {
    const body = $("#productPerformanceBody");

    if (!analysis.products.length) {
      body.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:28px;">
            No product sales were recorded for the selected filters.
          </td>
        </tr>
      `;

      return;
    }

    body.innerHTML = analysis.products.map((product, index) => {
      const share = getRevenueShare(
        product.revenue,
        analysis.revenue
      );

      let performance = "Low Volume";

      if (index === 0) {
        performance = "Top Performer";
      } else if (share >= 15) {
        performance = "Strong";
      } else if (share >= 5) {
        performance = "Moderate";
      }

      return `
        <tr>
          <td>${index + 1}</td>

          <td>
            <div class="cust-name">
              ${escapeHTML(product.name)}
            </div>
            <div class="cust-sub">
              ${escapeHTML(product.id)}
            </div>
          </td>

          <td>${escapeHTML(product.category)}</td>

          <td>${integer(product.units)}</td>

          <td class="num">
            ${money(product.revenue)}
          </td>

          <td>
            ${percentage(share)}
          </td>

          <td>
            <span class="pill ${index === 0 ? "paid" : "pending"}">
              ${performance}
            </span>
          </td>
        </tr>
      `;
    }).join("");
  }

  // ==================================================
  // 15. CATEGORY PERFORMANCE TABLE
  // ==================================================

  function renderCategoryTable(analysis) {
    const body = $("#categoryPerformanceBody");

    if (!analysis.categories.length) {
      body.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:28px;">
            No category sales were found for this reporting period.
          </td>
        </tr>
      `;

      return;
    }

    body.innerHTML = analysis.categories.map(category => {
      const share = getRevenueShare(
        category.revenue,
        analysis.revenue
      );

      return `
        <tr>
          <td>
            <div class="cust-name">
              ${escapeHTML(category.name)}
            </div>
          </td>

          <td>${integer(category.productCount)}</td>

          <td>${integer(category.units)}</td>

          <td class="num">
            ${money(category.revenue)}
          </td>

          <td>
            ${percentage(share)}
          </td>
        </tr>
      `;
    }).join("");
  }

  // ==================================================
  // 16. PERIOD COMPARISON TABLE
  // ==================================================

  function renderComparisonTable(current, previous) {
    const body = $("#periodComparisonBody");

    if (!previous) {
      body.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center;padding:28px;">
            Select a reporting period with comparable historical data.
          </td>
        </tr>
      `;

      return;
    }

    const metrics = [
      {
        label: "Sales Revenue",
        current: current.revenue,
        previous: previous.revenue,
        format: money
      },
      {
        label: "Invoices",
        current: current.invoiceCount,
        previous: previous.invoiceCount,
        format: integer
      },
      {
        label: "Average Order Value",
        current: current.averageOrderValue,
        previous: previous.averageOrderValue,
        format: money
      },
      {
        label: "Units Sold",
        current: current.unitsSold,
        previous: previous.unitsSold,
        format: integer
      }
    ];

    body.innerHTML = metrics.map(metric => {
      const difference = metric.current - metric.previous;

      return `
        <tr>
          <td>${escapeHTML(metric.label)}</td>

          <td class="num">
            ${metric.format(metric.current)}
          </td>

          <td class="num">
            ${metric.format(metric.previous)}
          </td>

          <td class="num">
            ${difference > 0 ? "+" : ""}${metric.format(difference)}
          </td>

          <td>
            ${calculateGrowth(metric.current, metric.previous)}
          </td>
        </tr>
      `;
    }).join("");
  }

  // ==================================================
  // 17. AUTOMATED BUSINESS INSIGHTS
  // ==================================================

  function setInsight(titleId, textId, title, text) {
    $(titleId).textContent = title;
    $(textId).textContent = text;
  }

  function renderInsights(
    current,
    previous,
    trendPoints,
    hourlyPoints,
    weekdayPoints
  ) {
    const insightsStatus = $("#insightsStatus");

    if (current.invoiceCount === 0) {
      insightsStatus.textContent = "Insufficient Data";

      setInsight(
        "#insightSalesTitle",
        "#insightSalesText",
        "No sales found",
        "Try a wider date range or remove product filters."
      );

      setInsight(
        "#insightProductTitle",
        "#insightProductText",
        "No product ranking",
        "Product recommendations require matching invoice line items."
      );

      setInsight(
        "#insightTimeTitle",
        "#insightTimeText",
        "No demand pattern",
        "Select a period containing sales before drawing operational conclusions."
      );

      setInsight(
        "#insightCategoryTitle",
        "#insightCategoryText",
        "No category activity",
        "No category contribution can be calculated from the current selection."
      );

      return;
    }

    insightsStatus.textContent = "Demo Insights";

    // Sales trend.
    if (previous && previous.revenue > 0) {
      const change =
        ((current.revenue - previous.revenue) / previous.revenue) * 100;

      if (change > 5) {
        setInsight(
          "#insightSalesTitle",
          "#insightSalesText",
          "Revenue is increasing",
          `Revenue increased by ${change.toFixed(1)}% compared with the previous period. Validate the pattern using actual sales data.`
        );
      } else if (change < -5) {
        setInsight(
          "#insightSalesTitle",
          "#insightSalesText",
          "Revenue is declining",
          `Revenue decreased by ${Math.abs(change).toFixed(1)}%. Review recent demand, product availability and operating conditions.`
        );
      } else {
        setInsight(
          "#insightSalesTitle",
          "#insightSalesText",
          "Revenue is relatively stable",
          `Revenue changed by ${change.toFixed(1)}%. Check longer-term trends before changing business strategy.`
        );
      }
    } else {
      setInsight(
        "#insightSalesTitle",
        "#insightSalesText",
        "Establish a baseline",
        "A reliable growth comparison requires a previous period with valid sales."
      );
    }

    // Product performance.
    const topProduct = current.products[0];

    if (topProduct) {
      const share = getRevenueShare(
        topProduct.revenue,
        current.revenue
      );

      setInsight(
        "#insightProductTitle",
        "#insightProductText",
        topProduct.name,
        `Highest-revenue product in this selection, contributing ${percentage(share)} of filtered sales revenue. Consider its availability and consistency of supply.`
      );
    }

    // Time-of-day performance.
    const bestHour = hourlyPoints.reduce(
      (best, point) => (
        !best || point.revenue > best.revenue ? point : best
      ),
      null
    );

    if (bestHour && bestHour.revenue > 0) {
      setInsight(
        "#insightTimeTitle",
        "#insightTimeText",
        `Strongest hour: ${bestHour.label}`,
        `This hour recorded the highest revenue in the selected period. Use actual preparation times and order volumes when planning staff coverage.`
      );
    } else {
      setInsight(
        "#insightTimeTitle",
        "#insightTimeText",
        "No peak hour identified",
        "More transaction activity is needed to identify meaningful operating patterns."
      );
    }

    // Category performance.
    const topCategory = current.categories[0];

    if (topCategory) {
      const share = getRevenueShare(
        topCategory.revenue,
        current.revenue
      );

      setInsight(
        "#insightCategoryTitle",
        "#insightCategoryText",
        topCategory.name,
        `Leading category by revenue, contributing ${percentage(share)} of filtered sales. Review category breadth and product availability.`
      );
    }

    const note = $("#businessInsightsDisclaimer");

    note.textContent =
      "These rule-based insights use illustrative demo transactions. " +
      "They identify patterns, not guaranteed causes or forecasts.";
  }

  // ==================================================
  // 18. RENDER ALL CHARTS
  // ==================================================

  function renderCharts(current, selectedRange) {
    const granularity = granularitySelect.value;

    const trendPoints = groupTransactionsByTime(
      current.transactions,
      granularity
    );

    renderLineChart(
      $("#salesTrendChart"),
      trendPoints
    );

    const trendLabel = $("#salesTrendPeriodLabel");

    trendLabel.textContent = selectedRange.label;

    const insightTrend = $("#salesTrendInsight");

    if (current.transactions.length > 0) {
      const maximumPoint = trendPoints.reduce(
        (best, point) => (
          !best || point.revenue > best.revenue ? point : best
        ),
        null
      );

      insightTrend.textContent = maximumPoint
        ? `Peak interval: ${maximumPoint.label}`
        : "No peak interval";
    } else {
      insightTrend.textContent = "No sales data available.";
    }

    // Top products by revenue.
    renderHorizontalBarChart(
      $("#productRevenueChart"),
      current.analysis.products.slice(0, 8),
      "name",
      "revenue",
      compactMoney
    );

    // Revenue by category.
    renderHorizontalBarChart(
      $("#categoryRevenueChart"),
      current.analysis.categories,
      "name",
      "revenue",
      compactMoney
    );

    // Hourly revenue.
    const hourlyPoints = groupTransactionsByTime(
      current.transactions,
      "hour"
    );

    renderVerticalBarChart(
      $("#hourlySalesChart"),
      hourlyPoints,
      compactMoney
    );

    // Weekday revenue.
    const weekdayPoints = groupTransactionsByWeekday(
      current.transactions
    );

    renderVerticalBarChart(
      $("#weekdaySalesChart"),
      weekdayPoints,
      compactMoney
    );

    // Best hour.
    const bestHour = hourlyPoints.reduce(
      (best, point) => (
        !best || point.revenue > best.revenue ? point : best
      ),
      null
    );

    $("#peakHourInsight").innerHTML = bestHour && bestHour.revenue > 0
      ? `
        <p class="kpi-sub">
          <strong>Highest-revenue hour:</strong>
          ${escapeHTML(bestHour.label)} — ${money(bestHour.revenue)}
        </p>
      `
      : `
        <p class="kpi-sub">
          No peak hour identified in this selection.
        </p>
      `;

    // Best weekday.
    const bestWeekday = weekdayPoints.reduce(
      (best, point) => (
        !best || point.revenue > best.revenue ? point : best
      ),
      null
    );

    $("#weekdayInsight").innerHTML =
      bestWeekday && bestWeekday.revenue > 0
        ? `
          <p class="kpi-sub">
            <strong>Highest-revenue weekday:</strong>
            ${escapeHTML(bestWeekday.label)} — ${money(bestWeekday.revenue)}
          </p>
        `
        : `
          <p class="kpi-sub">
            No leading weekday identified.
          </p>
        `;

    return {
      trendPoints,
      hourlyPoints,
      weekdayPoints
    };
  }

  // ==================================================
  // 19. EXPORT HELPERS
  // ==================================================

  function csvCell(value) {
    let text = String(value ?? "");

    // Protect CSV exports against common spreadsheet formula injection.
    if (/^[\s]*[=+\-@]/.test(text)) {
      text = "'" + text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCSV(rows, filename) {
    if (!rows.length) {
      showMessage("There is no report data to export.", true);
      return;
    }

    const content = rows
      .map(row => row.map(csvCell).join(","))
      .join("\r\n");

    const blob = new Blob(
      ["\uFEFF", content],
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
  }

  function buildProductExportRows(analysis) {
    return [
      [
        "Rank",
        "Product",
        "Category",
        "Units Sold",
        "Revenue INR",
        "Revenue Share Percent"
      ],

      ...analysis.products.map((product, index) => [
        index + 1,
        product.name,
        product.category,
        product.units,
        product.revenue.toFixed(2),
        getRevenueShare(product.revenue, analysis.revenue).toFixed(2)
      ])
    ];
  }

  // ==================================================
  // 20. FULL REPORT EXPORT
  // ==================================================

  let latestReport = null;

  function exportFullReport() {
    if (!latestReport) {
      showMessage("Apply a valid report filter before exporting.", true);
      return;
    }

    const {
      currentRange,
      current,
      previous,
      charts
    } = latestReport;

    const rows = [];

    rows.push(["Restaurant Business Analytics Report"]);
    rows.push(["Data status", "Illustrative demo data"]);
    rows.push(["Reporting period", currentRange.label]);
    rows.push(["From date", currentRange.from]);
    rows.push(["To date", currentRange.to]);
    rows.push(["Category filter", categorySelect.value || "All Categories"]);
    rows.push([
      "Product filter",
      productMap.get(productSelect.value)?.name || "All Products"
    ]);

    rows.push([]);

    rows.push(["EXECUTIVE SUMMARY"]);
    rows.push(["Metric", "Value"]);

    rows.push(["Sales Revenue INR", current.revenue.toFixed(2)]);
    rows.push(["Invoices", current.invoiceCount]);
    rows.push(["Units Sold", current.unitsSold]);
    rows.push(["Average Order Value INR", current.averageOrderValue.toFixed(2)]);

    if (previous) {
      rows.push(["Previous Period Revenue INR", previous.revenue.toFixed(2)]);
      rows.push(["Previous Period Invoices", previous.invoiceCount]);
    }

    rows.push([]);

    rows.push(["SALES TREND"]);
    rows.push(["Interval", "Revenue INR", "Invoice Count"]);

    charts.trendPoints.forEach(point => {
      rows.push([
        point.label,
        point.revenue.toFixed(2),
        point.count
      ]);
    });

    rows.push([]);

    rows.push(["PRODUCT PERFORMANCE"]);

    rows.push([
      "Rank",
      "Product",
      "Category",
      "Units Sold",
      "Revenue INR",
      "Revenue Share Percent"
    ]);

    current.analysis.products.forEach((product, index) => {
      rows.push([
        index + 1,
        product.name,
        product.category,
        product.units,
        product.revenue.toFixed(2),
        getRevenueShare(
          product.revenue,
          current.revenue
        ).toFixed(2)
      ]);
    });

    rows.push([]);

    rows.push(["CATEGORY PERFORMANCE"]);

    rows.push([
      "Category",
      "Unique Products Sold",
      "Units Sold",
      "Revenue INR",
      "Revenue Share Percent"
    ]);

    current.analysis.categories.forEach(category => {
      rows.push([
        category.name,
        category.productCount,
        category.units,
        category.revenue.toFixed(2),
        getRevenueShare(
          category.revenue,
          current.revenue
        ).toFixed(2)
      ]);
    });

    rows.push([]);

    rows.push(["HOURLY PERFORMANCE"]);
    rows.push(["Hour", "Revenue INR", "Invoice Count"]);

    charts.hourlyPoints.forEach(point => {
      rows.push([
        point.label,
        point.revenue.toFixed(2),
        point.count
      ]);
    });

    rows.push([]);

    rows.push(["WEEKDAY PERFORMANCE"]);
    rows.push(["Weekday", "Revenue INR", "Invoice Count"]);

    charts.weekdayPoints.forEach(point => {
      rows.push([
        point.label,
        point.revenue.toFixed(2),
        point.count
      ]);
    });

    downloadCSV(
      rows,
      `business-analytics-${localDateString()}.csv`
    );

    showMessage(
      "Full analytics report exported. The report uses demo data.",
      false
    );
  }

  exportButton.addEventListener("click", exportFullReport);

  exportProductsButton.addEventListener("click", () => {
    if (!latestReport) {
      showMessage("Apply a valid report filter first.", true);
      return;
    }

    downloadCSV(
      buildProductExportRows(latestReport.current.analysis),
      `product-performance-${localDateString()}.csv`
    );
  });

  // ==================================================
  // 21. APPLY REPORT FILTERS
  // ==================================================

  function applyReportFilters() {
    clearMessage();

    const selectedRange = getSelectedDateRange();

    if (!selectedRange.valid) {
      showMessage(selectedRange.message, true);
      return;
    }

    const currentTransactions = getTransactionsInRange(selectedRange);

    const currentAnalysis = analyse(currentTransactions);

    const previousRange = getPreviousDateRange(selectedRange);

    let previousAnalysis = null;

    if (previousRange) {
      const previousTransactions = getTransactionsInRange(previousRange);

      previousAnalysis = analyse(previousTransactions);

      previousAnalysis.label = previousRange.label;
    }

    const current = {
      ...currentAnalysis,
      transactions: currentTransactions
    };

    const previous = previousAnalysis;

    renderExecutiveKPIs(current, previous);

    renderProductTable(currentAnalysis);
    renderCategoryTable(currentAnalysis);
    renderComparisonTable(current, previous);

    const charts = renderCharts(current, selectedRange);

    renderInsights(
      current,
      previous,
      charts.trendPoints,
      charts.hourlyPoints,
      charts.weekdayPoints
    );

    latestReport = {
      currentRange: selectedRange,
      current,
      previous,
      charts
    };

    dataStatus.textContent = "Demo Data";

    $("#businessInsightsDisclaimer").textContent =
      "All displayed figures and insights currently use illustrative demo transactions. " +
      "Connect Firebase Realtime Database before using the reports for actual business decisions.";
  }

  // ==================================================
  // 22. EVENT LISTENERS
  // ==================================================

  filtersForm.addEventListener("submit", event => {
    event.preventDefault();
    applyReportFilters();
  });

  filtersForm.addEventListener("reset", () => {
    window.setTimeout(() => {
      updateCustomRangeVisibility();
      populateProductOptions();
      clearMessage();
      applyReportFilters();
    }, 0);
  });

  refreshButton.addEventListener("click", () => {
    /*
     * This refresh recalculates the report from current demo
     * data. It does not contact a database or external API.
     */

    applyReportFilters();

    showMessage(
      "Report recalculated from demo data. No database is connected yet.",
      false
    );
  });

  // ==================================================
  // 23. INITIALISE
  // ==================================================

  updateCustomRangeVisibility();

  applyReportFilters();

  console.info(
    "Reports Analytics initialised with illustrative demo transactions.",
    {
      transactions: demoTransactions.length,
      products: demoProducts.length,
      availableFrom: minimumAvailableDate,
      availableTo: maximumAvailableDate
    }
  );
})();
