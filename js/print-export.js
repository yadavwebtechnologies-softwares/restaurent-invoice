
/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Print and PDF Export Module
   Uses the existing invoice preview and saved settings.
   No Firebase connection or duplicate event listeners.
   ========================================================= */

(function () {
  "use strict";

  function getElement(id) {
    return document.getElementById(id);
  }

  function setMessage(message, type) {
    const messageElement =
      getElement("invoiceMessage") ||
      getElement("formMessage") ||
      getElement("statusMessage");

    if (!messageElement) return;

    messageElement.textContent = message;
    messageElement.dataset.type = type || "warning";
    messageElement.hidden = !message;
  }

  function validateInvoice() {
    const preview = getElement("invoicePreviewSection");
    const printSheet = getElement("invoicePrintSheet");

    if (!preview || preview.hidden || !printSheet) {
      setMessage(
        "Record an invoice before printing.",
        "warning"
      );
      return false;
    }

    const invoiceNumber = getElement("printInvoiceNumber");

    if (
      !invoiceNumber ||
      !invoiceNumber.textContent.trim()
    ) {
      setMessage(
        "Invoice details are not ready for printing.",
        "warning"
      );
      return false;
    }

    return true;
  }

  function print() {
    if (!validateInvoice()) {
      return false;
    }

    setMessage("", "");

    // Uses the existing invoice preview and print CSS.
    window.print();

    return true;
  }

  function printPDF() {
    // In the browser print dialog, choose "Save as PDF".
    return print();
  }

  window.restaurantPrintExport = Object.freeze({
    print,
    printPDF
  });
})();
