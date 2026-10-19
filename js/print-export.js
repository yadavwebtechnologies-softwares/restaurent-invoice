"use strict";

/*
 * Restaurant Billing Software
 * File: js/print-export.js
 *
 * Purpose:
 * - Read saved Firebase invoice settings.
 * - Reflect business branding and editable footer text
 *   in the existing invoice preview.
 * - Keep the payment method and payment status in the
 *   bottom payment section.
 * - Handle printing / Save as PDF separately.
 *
 * Database:
 * restaurantBilling/settings/
 *
 * No demo data.
 * No localStorage persistence.
 * No Firebase secrets.
 */

(function () {
  "use strict";

  const SETTINGS_PATH = "restaurantBilling/settings";

  const state = {
    db: null,
    api: null,
    settings: {},
    unsubscribe: null,
    ready: false,
    disposed: false
  };

  const $ = function (id) {
    return document.getElementById(id);
  };

  /* -------------------------------------------------------
     1. Helpers
     ------------------------------------------------------- */

  function textValue(value) {
    return String(value ?? "").trim();
  }

  function getSection(root, keys) {
    for (const key of keys) {
      const value = root && root[key];

      if (value && typeof value === "object") {
        return value;
      }
    }

    return {};
  }

  /*
   * Find a saved value while preserving intentionally
   * cleared text fields.
   */
  function getSavedValue(object, keys) {
    for (const key of keys) {
      if (
        object &&
        Object.prototype.hasOwnProperty.call(object, key) &&
        object[key] !== null &&
        object[key] !== undefined
      ) {
        return object[key];
      }
    }

    return undefined;
  }

  function setText(id, value) {
    const node = $(id);

    if (!node || value === undefined) {
      return;
    }

    const nextValue = String(value ?? "");

    if (node.textContent !== nextValue) {
      node.textContent = nextValue;
    }
  }

  function setOptionalText(id, value) {
    const node = $(id);

    if (!node || value === undefined) {
      return;
    }

    const nextValue = textValue(value);

    if (node.textContent !== nextValue) {
      node.textContent = nextValue;
    }

    node.hidden = !nextValue;
  }

  function isSafeImageURL(value) {
    if (!value) {
      return false;
    }

    try {
      const url = new URL(value);

      return (
        url.protocol === "https:" ||
        url.protocol === "http:"
      );
    } catch {
      return false;
    }
  }

  function setBusinessLogo(value) {
    const logo = $("printBusinessLogo");

    if (!logo) {
      return;
    }

    const url = textValue(value);

    if (!url || !isSafeImageURL(url)) {
      logo.removeAttribute("src");
      logo.hidden = true;
      return;
    }

    if (logo.getAttribute("src") !== url) {
      logo.src = url;
    }

    logo.hidden = false;
  }

  /* -------------------------------------------------------
     2. Render multiline footer without injecting HTML
     ------------------------------------------------------- */

  function setFooterLines(id, values) {
    const node = $(id);

    if (!node) {
      return;
    }

    const lines = values
      .map(textValue)
      .filter(Boolean);

    const signature = JSON.stringify(lines);

    if (node.dataset.renderedLines === signature) {
      node.hidden = lines.length === 0;
      return;
    }

    node.replaceChildren();

    lines.forEach(function (line, index) {
      if (index > 0) {
        node.appendChild(
          document.createElement("br")
        );
      }

      node.appendChild(
        document.createTextNode(line)
      );
    });

    node.dataset.renderedLines = signature;
    node.hidden = lines.length === 0;
  }

  /* -------------------------------------------------------
     3. Apply Business Profile settings
     ------------------------------------------------------- */

  function applyBusinessProfile(profile) {
    const name = getSavedValue(profile, [
      "businessName",
      "name"
    ]);

    const tagline = getSavedValue(profile, [
      "businessTagline",
      "tagline",
      "description"
    ]);

    const address = getSavedValue(profile, [
      "businessAddress",
      "address"
    ]);

    const phone = getSavedValue(profile, [
      "businessPhone",
      "phone",
      "contactPhone"
    ]);

    const email = getSavedValue(profile, [
      "businessEmail",
      "email"
    ]);

    const logoURL = getSavedValue(profile, [
      "businessLogoUrl",
      "logoUrl",
      "logoImageUrl",
      "logo"
    ]);

    if (name !== undefined) {
      setOptionalText("printBusinessName", name);
    }

    if (tagline !== undefined) {
      setOptionalText("printBusinessTagline", tagline);
    }

    if (address !== undefined) {
      setOptionalText("printBusinessAddress", address);
    }

    if (phone !== undefined || email !== undefined) {
      const contactParts = [
        textValue(phone),
        textValue(email)
      ].filter(Boolean);

      setOptionalText(
        "printBusinessContact",
        contactParts.join(" | ")
      );
    }

    if (logoURL !== undefined) {
      setBusinessLogo(logoURL);
    }
  }

  /* -------------------------------------------------------
     4. Apply invoice text settings
     ------------------------------------------------------- */

  function applyInvoiceSettings(settings) {
    const thankYou = getSavedValue(settings, [
      "thankYouMessage",
      "invoiceThankYouMessage"
    ]);

    const footer = getSavedValue(settings, [
      "invoiceFooter",
      "footerText",
      "footer"
    ]);

    const terms1 = getSavedValue(settings, [
      "termsLine1",
      "invoiceTermsLine1"
    ]);

    const terms2 = getSavedValue(settings, [
      "termsLine2",
      "invoiceTermsLine2"
    ]);

    const signatory = getSavedValue(settings, [
      "authorisedSignatory",
      "authorizedSignatory",
      "signatureLabel"
    ]);

    if (thankYou !== undefined) {
      setOptionalText(
        "printThankYouMessage",
        thankYou
      );
    }

    if (
      footer !== undefined ||
      terms1 !== undefined ||
      terms2 !== undefined
    ) {
      setFooterLines("printInvoiceFooterText", [
        footer ?? "",
        terms1 ?? "",
        terms2 ?? ""
      ]);
    }

    if (signatory !== undefined) {
      setOptionalText(
        "printSignatureLabel",
        signatory
      );

      const signatureSection = $("printSignatureSection");

      if (signatureSection) {
        signatureSection.hidden = !textValue(signatory);
      }
    }

    /*
     * Reflect the configured tax label.
     * Invoice amounts continue to be calculated and
     * populated by the existing invoice.js logic.
     */
    const taxEnabled = getSavedValue(settings, [
      "taxEnabled",
      "enableTax",
      "enabled"
    ]);

    const taxRate = getSavedValue(settings, [
      "taxRate",
      "rate",
      "taxPercentage"
    ]);

    const taxLabel = $("printInvoiceTaxLabel");
    const taxRow = $("printTaxRow");

    if (taxEnabled !== undefined && taxRow) {
      const enabled =
        taxEnabled === true ||
        taxEnabled === 1 ||
        taxEnabled === "1" ||
        taxEnabled === "true";

      if (!enabled) {
        taxRow.hidden = true;
      } else if (
        taxRate !== undefined &&
        textValue(taxRate) !== ""
      ) {
        if (taxLabel) {
          taxLabel.textContent =
            "GST (" + textValue(taxRate) + "%)";
        }
      }
    }

    /*
     * Deliberately do not replace the invoice number,
     * item rows, payment method, payment status or totals.
     * Those belong to the saved invoice and billing logic.
     */
  }

  /* -------------------------------------------------------
     5. Apply all saved settings
     ------------------------------------------------------- */

  function applySettings(settings) {
    state.settings = (
      settings && typeof settings === "object"
    ) ? settings : {};

    const profile = getSection(state.settings, [
      "businessProfile",
      "business",
      "profile"
    ]);

    const invoice = getSection(state.settings, [
      "invoiceSettings",
      "invoice"
    ]);

    const tax = getSection(state.settings, [
      "taxSettings",
      "tax"
    ]);

    const payment = getSection(state.settings, [
      "paymentSettings",
      "payment"
    ]);

    applyBusinessProfile(profile);
    applyInvoiceSettings(invoice);

    /*
     * Keep these settings available to other invoice
     * modules without changing their existing calculations.
     */
    document.dispatchEvent(
      new CustomEvent("restaurant-invoice-settings-ready", {
        detail: {
          businessProfile: profile,
          invoiceSettings: invoice,
          taxSettings: tax,
          paymentSettings: payment
        }
      })
    );

    state.ready = true;
  }

  /* -------------------------------------------------------
     6. Firebase connection
     ------------------------------------------------------- */

  function getFirebase() {
    const firebase = window.restaurantFirebase;

    if (
      !firebase ||
      !firebase.ready ||
      !firebase.db ||
      !firebase.sdk ||
      !firebase.sdk.database
    ) {
      throw new Error(
        "Firebase Realtime Database is unavailable."
      );
    }

    const api = firebase.sdk.database;

    if (
      typeof api.ref !== "function" ||
      typeof api.onValue !== "function"
    ) {
      throw new Error(
        "Required Firebase database methods are unavailable."
      );
    }

    return {
      db: firebase.db,
      api: api
    };
  }

  async function initialize() {
    try {
      const access = window.restaurantAccess;

      if (!access || !access.readyPromise) {
        throw new Error(
          "Owner authorization is not ready."
        );
      }

      const authorized = await access.readyPromise;

      if (
        !authorized ||
        !access.authorized ||
        !access.user
      ) {
        throw new Error(
          "Authorized owner access is required."
        );
      }

      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.readyPromise) {
        throw new Error(
          "Firebase configuration loader is unavailable."
        );
      }

      const ready = await firebase.readyPromise;

      if (!ready || !firebase.ready) {
        throw new Error(
          "Firebase initialization failed."
        );
      }

      if (state.disposed) {
        return;
      }

      const connected = getFirebase();

      state.db = connected.db;
      state.api = connected.api;

      const reference = state.api.ref(
        state.db,
        SETTINGS_PATH
      );

      state.unsubscribe = state.api.onValue(
        reference,

        function (snapshot) {
          if (state.disposed) {
            return;
          }

          const data = snapshot.exists()
            ? snapshot.val()
            : {};

          applySettings(data);
        },

        function (error) {
          console.error(
            "Invoice settings could not be loaded:",
            error && error.code
              ? error.code
              : "unknown"
          );
        }
      );
    } catch (error) {
      console.error(
        "Print/export initialization failed:",
        error instanceof Error
          ? error.message
          : "Unknown error"
      );
    }
  }

  /* -------------------------------------------------------
     7. Print / Save as PDF
     ------------------------------------------------------- */

  function printInvoice() {
    if (!state.ready) {
      window.alert(
        "Invoice settings are still loading. Please try again."
      );

      return;
    }

    window.print();
  }

  /*
   * Capture the print button before an older click handler
   * can trigger a duplicate print dialog.
   */
  document.addEventListener(
    "click",
    function (event) {
      const button = event.target instanceof Element
        ? event.target.closest(
            "#printInvoiceBtn, #btn-print, #downloadPDFBtn"
          )
        : null;

      if (!button) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      printInvoice();
    },
    true
  );

  window.addEventListener("beforeprint", function () {
    if (state.ready) {
      applySettings(state.settings);
    }
  });

  window.addEventListener("pagehide", function () {
    state.disposed = true;

    if (typeof state.unsubscribe === "function") {
      state.unsubscribe();
    }

    state.unsubscribe = null;
  });

  /*
   * Public interface for other page scripts.
   */
  window.restaurantPrintExport = {
    printInvoice: printInvoice,

    getSettings: function () {
      return state.settings;
    },

    isReady: function () {
      return state.ready;
    },

    refresh: function () {
      applySettings(state.settings);
    }
  };

  initialize();
})();
