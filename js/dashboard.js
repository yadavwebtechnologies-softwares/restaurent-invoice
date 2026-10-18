(async () => {
  const response = await fetch(
    new URL(`js/dashboard.js?check=${Date.now()}`, location.href),
    { cache: "no-store" }
  );

  const source = await response.text();

  console.table([
    {
      check: "HTTP response",
      result: response.ok ? "PASS" : "FAIL",
      detail: String(response.status)
    },
    {
      check: "Application code",
      result:
        source.includes("waitForFirebase") &&
        source.includes("Dashboard initialization failed")
          ? "PASS"
          : "FAIL",
      detail: `${source.length} characters`
    },
    {
      check: "Diagnostic pasted into app file",
      result: source.includes("Sensitive configuration values") ||
        source.includes("Restaurant Billing — Dashboard Retest")
          ? "FAIL"
          : "PASS",
      detail: "Checking for diagnostic-script content"
    }
  ]);
})();
