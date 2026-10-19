function printInvoice() {
  const preview = $("invoicePreviewSection");

  if (!preview || preview.hidden) {
    setMessage(
      "Record An Invoice Before Printing.",
      "warning"
    );
    return;
  }

  const printExport = window.restaurantPrintExport;

  if (
    printExport &&
    typeof printExport.print === "function"
  ) {
    printExport.print();
    return;
  }

  // Fallback if the separate export module is unavailable.
  window.print();
}
