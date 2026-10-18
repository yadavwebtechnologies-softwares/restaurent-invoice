(async () => {
  "use strict";

  await new Promise(resolve => setTimeout(resolve, 3000));

  const status = document.getElementById("dashboardStatus")?.textContent?.trim() || "";
  const footer = document.getElementById("dashboardFooterStatus")?.textContent?.trim() || "";
  const inlineStyles = [...document.querySelectorAll("[style]")].map(element => ({
    tag: element.tagName.toLowerCase(),
    id: element.id || "(no id)",
    className: typeof element.className === "string" ? element.className : "(svg/class object)",
    style: element.getAttribute("style")
  }));

  const fb = window.restaurantFirebase;
  const requiredIds = [
    "todayRevenueValue",
    "invoicesTodayValue",
    "averageBillValue",
    "totalInvoicesValue",
    "weeklySalesChart",
    "paymentSplitLegend",
    "monthlyTrendList",
    "topCategoriesList",
    "topProductsList",
    "recentInvoicesBody"
  ];

  const missing = requiredIds.filter(id => !document.getElementById(id));
  const owner = fb?.auth?.currentUser;

  const checks = [
    {
      check: "Dashboard initialization",
      status: /connected|live database updates/i.test(status) ? "PASS" :
        /failed|denied|error/i.test(status) ? "FAIL" : "WARN",
      detail: status
    },
    {
      check: "Realtime dashboard script",
      status: typeof window.restaurantFirebase?.sdk?.database?.onValue === "function"
        ? "PASS" : "FAIL",
      detail: "Firebase Realtime Database listener availability"
    },
    {
      check: "Owner session",
      status: owner?.uid === "20wif9y7LQhBZgFPDsAlrQpFjnI2" ? "PASS" : "FAIL",
      detail: owner ? "Signed-in account checked" : "No current signed-in user"
    },
    {
      check: "Required dashboard elements",
      status: missing.length ? "FAIL" : "PASS",
      detail: missing.length ? missing.join(", ") : "All required elements exist"
    },
    {
      check: "Live values rendered",
      status: status.includes("connected") ? "PASS" : "WARN",
      detail: "Revenue: " +
        (document.getElementById("todayRevenueValue")?.textContent?.trim() || "empty") +
        "; invoices: " +
        (document.getElementById("totalInvoicesValue")?.textContent?.trim() || "empty")
    },
    {
      check: "Inline style attributes",
      status: inlineStyles.length ? "FAIL" : "PASS",
      detail: inlineStyles.length
        ? `${inlineStyles.length} element(s) still have style attributes`
        : "No style attributes found in the current DOM"
    },
    {
      check: "Database footer status",
      status: "INFO",
      detail: footer
    }
  ];

  console.group("Restaurant Billing — Dashboard Retest");
  console.table(checks);

  if (inlineStyles.length) {
    console.log("Inline style locations — inspect these elements:");
    console.table(inlineStyles);
  }

  console.log({
    result: checks.some(item => item.status === "FAIL")
      ? "FAIL"
      : checks.some(item => item.status === "WARN")
        ? "CHECK WARNINGS"
        : "CHECKS PASSED"
  });

  console.log("Sensitive configuration values and invoice/customer records were not printed.");
  console.groupEnd();
})();
