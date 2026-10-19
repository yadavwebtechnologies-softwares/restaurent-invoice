"use strict";

/*
 * Restaurant Billing Software
 * File: js/print-export.js
 *
 * Separate print/export module.
 * Uses the existing invoice preview and saved settings.
 * Does not create or modify invoice records.
 */

(function () {
  "use strict";

  function print() {
    const preview = document.getElementById(
      "invoicePreviewSection"
    );

    if (!preview || preview.hidden) {
      return false;
    }

    if (typeof window.print !== "function") {
      console.error("Browser printing is unavailable.");
      return false;
    }

    window.print();
    return true;
  }

  window.restaurantPrintExport = Object.freeze({
    print: print
  });
})();
