
/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Print and PDF Export Module

   Responsibilities:
   - Print the invoice already rendered by invoice.js.
   - Let the browser print dialog save the invoice as PDF.
   - Do not read or write Firebase.
   - Do not create duplicate button listeners.
   ========================================================= */

(function () {
  "use strict";

  function getElement(id) {
    return document.getElementById(id);
  }

  function setMessage(message, type) {
    const element = getElement("invoiceMessage");
    if (!element) return;

    element.textContent = message || "";
    element.classList.remove(
      "is-success",
      "is-error",
      "is-warning"
    );

    if (type) {
      element.classList.add("is-" + type);
    }
  }

  function validateInvoice() {
    const preview = getElement("invoicePreviewSection");
    const printSheet = getElement("invoicePrintSheet");
    const invoiceNumber = getElement("printInvoiceNumber");

    if (!preview || preview.hidden || !printSheet) {
      setMessage(
        "Record An Invoice Before Printing.",
        "warning"
      );
      return false;
    }

    if (
      !invoiceNumber ||
      !invoiceNumber.textContent.trim()
    ) {
      setMessage(
        "Invoice Details Are Not Ready For Printing.",
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

    setMessage("");

    // Use the invoice preview already rendered by invoice.js.
    window.print();

    return true;
  }

  function printPDF() {
    // In the browser print dialog, select "Save as PDF".
    return print();
  }

  /*
   * invoice.js owns the Print Invoice button's click handler.
   * This module only exposes methods for invoice.js to call.
   */
  window.restaurantPrintExport = Object.freeze({
    print: print,
    printPDF: printPDF
  });
})();
