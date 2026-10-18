/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Business Settings — Live Firebase Integration
   Database root: restaurantBilling/settings/
   No demo data, localStorage persistence or secrets
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const SETTINGS_PATH = "restaurantBilling/settings";

  const $ = function (id) {
    return document.getElementById(id);
  };

  const state = {
    db: null,
    api: null,
    settings: {},
    loaded: false,
    ready: false,
    busy: new Set(),
    dirty: new Set(),
    subscriptions: [],
    disposed: false
  };

  const ui = window.restaurantUI;

  /* ---------------------------------------------------------
     1. Common helpers
     --------------------------------------------------------- */

  function setText(id, value) {
    if (ui && typeof ui.setText === "function") {
      ui.setText(id, value);
      return;
    }

    const node = $(id);
    if (node) node.textContent = String(value ?? "");
  }

  function showMessage(id, message, type) {
    const node = $(id);
    if (!node) return;

    node.textContent = message || "";

    node.classList.remove(
      "is-success",
      "is-error",
      "is-warning"
    );

    if (type) node.classList.add("is-" + type);
  }

  function setStatus(message, type) {
    const node = $("settingsPageStatus");
    if (!node) return;

    node.textContent = message || "";

    node.classList.remove(
      "is-connected",
      "is-error",
      "is-warning"
    );

    if (type) node.classList.add("is-" + type);
  }

  function textValue(value) {
    return String(value ?? "").trim();
  }

  function numberValue(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  }

  function firstValue(object, keys) {
    for (const key of keys) {
      const value = object && object[key];

      if (value !== null && value !== undefined && value !== "") {
        return value;
      }
    }

    return null;
  }

  function booleanValue(value) {
    return value === true ||
      value === 1 ||
      value === "1" ||
      value === "true";
  }

  function requireOwner() {
    const access = window.restaurantAccess;

    if (
      !access ||
      !access.ready ||
      !access.authorized ||
      !access.user ||
      access.user.uid !== OWNER_UID
    ) {
      throw new Error("Only the authorized owner can update settings.");
    }

    return access.user;
  }

  function validateURL(value, label) {
    if (!value) return "";

    let url;

    try {
      url = new URL(value);
    } catch {
      throw new Error(label + " must be a valid URL.");
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error(label + " must use HTTP or HTTPS.");
    }

    return url.href;
  }

  function getFirebase() {
    const firebase = window.restaurantFirebase;

    if (
      !firebase ||
      !firebase.ready ||
      !firebase.db ||
      !firebase.sdk ||
      !firebase.sdk.database
    ) {
      throw new Error("Firebase Realtime Database is unavailable.");
    }

    const api = firebase.sdk.database;

    if (
      typeof api.ref !== "function" ||
      typeof api.get !== "function" ||
      typeof api.set !== "function" ||
      typeof api.onValue !== "function"
    ) {
      throw new Error("Required Firebase database methods are unavailable.");
    }

    return { db: firebase.db, api: api };
  }

  function makeMetadata() {
    return {
      ownerUid: OWNER_UID,
      updatedAt: new Date().toISOString(),
      updatedAtMs: Date.now()
    };
  }

  /* ---------------------------------------------------------
     2. Read canonical and older saved settings
     --------------------------------------------------------- */

  function readSections() {
    const settings = state.settings || {};
    const forms = settings.forms || {};

    return {
      businessProfile:
        settings.businessProfile ||
        settings.business ||
        settings.profile ||
        forms.businessProfileForm ||
        forms.businessProfile ||
        settings,

      invoiceSettings:
        settings.invoiceSettings ||
        settings.invoice ||
        forms.invoiceSettingsForm ||
        settings,

      taxSettings:
        settings.taxSettings ||
        settings.tax ||
        forms.taxSettingsForm ||
        settings,

      paymentSettings:
        settings.paymentSettings ||
        settings.payment ||
        forms.paymentSettingsForm ||
        settings
    };
  }

  function getFieldValue(section, keys) {
    return firstValue(section, keys);
  }

  function assignInput(id, value) {
    const node = $(id);
    if (!node) return;

    node.value = value === null || value === undefined
      ? ""
      : String(value);
  }

  function assignCheckbox(id, value) {
    const node = $(id);
    if (node) node.checked = booleanValue(value);
  }

  /* ---------------------------------------------------------
     3. Business profile form
     --------------------------------------------------------- */

  function populateBusinessProfile() {
    if (state.dirty.has("businessProfileForm")) return;

    const profile = readSections().businessProfile;

    assignInput("businessNameInput", getFieldValue(profile, [
      "businessName",
      "name"
    ]));

    assignInput("businessTaglineInput", getFieldValue(profile, [
      "businessTagline",
      "tagline",
      "description"
    ]));

    assignInput("businessAddressInput", getFieldValue(profile, [
      "businessAddress",
      "address"
    ]));

    assignInput("businessPhoneInput", getFieldValue(profile, [
      "businessPhone",
      "phone",
      "contactPhone"
    ]));

    assignInput("businessEmailInput", getFieldValue(profile, [
      "businessEmail",
      "email"
    ]));

    assignInput("businessLogoUrlInput", getFieldValue(profile, [
      "businessLogoUrl",
      "logoUrl",
      "logo"
    ]));
  }

  function buildBusinessProfile() {
    const name = textValue($("businessNameInput")?.value);

    if (!name) {
      $("businessNameInput")?.focus();
      throw new Error("Business name is required.");
    }

    const email = textValue($("businessEmailInput")?.value);

    if (email && $("businessEmailInput") &&
        !$("businessEmailInput").validity.valid) {
      $("businessEmailInput").focus();
      throw new Error("Enter a valid business email.");
    }

    const phone = textValue($("businessPhoneInput")?.value);
    const logo = validateURL(
      textValue($("businessLogoUrlInput")?.value),
      "Logo URL"
    );

    return {
      ...makeMetadata(),
      businessName: name,
      businessTagline: textValue($("businessTaglineInput")?.value),
      businessAddress: textValue($("businessAddressInput")?.value),
      businessPhone: phone,
      businessEmail: email,
      businessLogoUrl: logo
    };
  }

  /* ---------------------------------------------------------
     4. Invoice preferences form
     --------------------------------------------------------- */

  function populateInvoiceSettings() {
    if (state.dirty.has("invoiceSettingsForm")) return;

    const settings = readSections().invoiceSettings;

    assignInput("invoicePrefixInput", getFieldValue(settings, [
      "invoicePrefix",
      "prefix"
    ]));

    assignInput("invoiceFooterInput", getFieldValue(settings, [
      "invoiceFooter",
      "footerText",
      "footer"
    ]));

    assignInput("dailySalesTargetInput", getFieldValue(settings, [
      "dailySalesTarget",
      "dailyTarget"
    ]));
  }

  function buildInvoiceSettings() {
    const prefix = textValue($("invoicePrefixInput")?.value);
    const footer = textValue($("invoiceFooterInput")?.value);
    const targetText = textValue($("dailySalesTargetInput")?.value);

    if (!prefix || !/^[A-Za-z0-9-]+$/.test(prefix)) {
      $("invoicePrefixInput")?.focus();

      throw new Error(
        "Invoice prefix is required and may contain only letters, numbers and hyphens."
      );
    }

    let dailySalesTarget = null;

    if (targetText) {
      dailySalesTarget = numberValue(targetText);

      if (
        dailySalesTarget === null ||
        dailySalesTarget < 0 ||
        dailySalesTarget > 999999999
      ) {
        $("dailySalesTargetInput")?.focus();
        throw new Error("Enter a valid non-negative daily sales target.");
      }
    }

    const result = {
      ...makeMetadata(),
      invoicePrefix: prefix,
      invoiceFooter: footer
    };

    if (dailySalesTarget !== null) {
      result.dailySalesTarget = dailySalesTarget;
    }

    return result;
  }

  /* ---------------------------------------------------------
     5. Tax and discount form
     --------------------------------------------------------- */

  function populateTaxSettings() {
    if (state.dirty.has("taxSettingsForm")) return;

    const settings = readSections().taxSettings;

    assignCheckbox("taxEnabledInput", getFieldValue(settings, [
      "taxEnabled",
      "enableTax",
      "enabled"
    ]));

    assignInput("taxRateInput", getFieldValue(settings, [
      "taxRate",
      "rate",
      "taxPercentage"
    ]));

    assignCheckbox("discountEnabledInput", getFieldValue(settings, [
      "discountEnabled",
      "enableDiscount"
    ]));

    assignInput("maximumDiscountInput", getFieldValue(settings, [
      "maximumDiscount",
      "maxDiscount",
      "maximumDiscountPercent"
    ]));
  }

  function buildTaxSettings() {
    const taxEnabled = Boolean($("taxEnabledInput")?.checked);
    const taxText = textValue($("taxRateInput")?.value);

    const discountEnabled = Boolean($("discountEnabledInput")?.checked);
    const discountText = textValue($("maximumDiscountInput")?.value);

    let taxRate = numberValue(taxText);

    if (taxEnabled && taxRate === null) {
      $("taxRateInput")?.focus();
      throw new Error("Enter a tax rate when tax is enabled.");
    }

    if (taxRate === null) taxRate = 0;

    if (taxRate < 0 || taxRate > 100) {
      $("taxRateInput")?.focus();
      throw new Error("Tax rate must be between 0 and 100 percent.");
    }

    let maximumDiscount = numberValue(discountText);

    if (discountEnabled && maximumDiscount === null) {
      $("maximumDiscountInput")?.focus();

      throw new Error(
        "Enter the maximum discount when discounts are enabled."
      );
    }

    if (maximumDiscount === null) maximumDiscount = 0;

    if (maximumDiscount < 0 || maximumDiscount > 100) {
      $("maximumDiscountInput")?.focus();

      throw new Error(
        "Maximum discount must be between 0 and 100 percent."
      );
    }

    return {
      ...makeMetadata(),
      taxEnabled: taxEnabled,
      taxRate: taxRate,
      discountEnabled: discountEnabled,
      maximumDiscount: maximumDiscount
    };
  }

  /* ---------------------------------------------------------
     6. Payment and QR settings form
     --------------------------------------------------------- */

  function populatePaymentSettings() {
    if (state.dirty.has("paymentSettingsForm")) return;

    const settings = readSections().paymentSettings;

    assignInput("upiIdInput", getFieldValue(settings, [
      "upiId",
      "upiID",
      "vpa"
    ]));

    assignInput("paymentAccountNameInput", getFieldValue(settings, [
      "paymentAccountName",
      "accountName",
      "payeeName"
    ]));
  }

  function buildPaymentSettings() {
    const upiId = textValue($("upiIdInput")?.value);
    const accountName = textValue(
      $("paymentAccountNameInput")?.value
    );

    if (
      upiId &&
      (
        upiId.length > 100 ||
        !/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/.test(upiId)
      )
    ) {
      $("upiIdInput")?.focus();
      throw new Error("Enter a valid UPI ID, or leave it blank.");
    }

    return {
      ...makeMetadata(),
      upiId: upiId,
      paymentAccountName: accountName
    };
  }

  /* ---------------------------------------------------------
     7. Dynamic branding
     --------------------------------------------------------- */

  function renderBranding() {
    const profile = readSections().businessProfile;

    const name = textValue(getFieldValue(profile, [
      "businessName",
      "name"
    ]));

    const tagline = textValue(getFieldValue(profile, [
      "businessTagline",
      "tagline",
      "description"
    ]));

    document.querySelectorAll("[data-business-name]").forEach(
      function (node) {
        node.textContent = name;
      }
    );

    document.querySelectorAll("[data-business-tagline]").forEach(
      function (node) {
        node.textContent = tagline;
      }
    );

    setText("sidebarBusinessName", name);
    setText("sidebarBusinessTagline", tagline);
    setText("businessFooterName", name);

    const mark = $("brandMark");

    if (mark) {
      mark.textContent = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (word) {
          return word.charAt(0).toUpperCase();
        })
        .join("");
    }

    const access = window.restaurantAccess;
    const displayName = textValue(
      access?.user?.displayName ||
      access?.user?.email ||
      ""
    );

    setText("ownerDisplayName", displayName);
    setText(
      "ownerAvatar",
      displayName ? displayName.charAt(0).toUpperCase() : ""
    );
    setText("ownerDisplayRole", "Owner");
  }

  /* ---------------------------------------------------------
     8. Populate forms without overwriting unsaved edits
     --------------------------------------------------------- */

  function populateCleanForms() {
    populateBusinessProfile();
    populateInvoiceSettings();
    populateTaxSettings();
    populatePaymentSettings();
    renderBranding();
  }

  function markFormDirty(form) {
    if (form && form.id) {
      state.dirty.add(form.id);
    }
  }

  function bindDirtyTracking() {
    [
      "businessProfileForm",
      "invoiceSettingsForm",
      "taxSettingsForm",
      "paymentSettingsForm"
    ].forEach(function (id) {
      const form = $(id);

      if (!form) return;

      form.addEventListener("input", function () {
        markFormDirty(form);
      });

      form.addEventListener("change", function () {
        markFormDirty(form);
      });
    });
  }

  /* ---------------------------------------------------------
     9. Save one settings section only
     --------------------------------------------------------- */

  async function saveSection(formId, sectionKey, builder, messageId, buttonId) {
    if (state.busy.has(formId)) return;

    showMessage(messageId, "");

    let record;

    try {
      requireOwner();

      if (!state.ready || !state.loaded) {
        throw new Error("Settings are still loading. Please try again.");
      }

      record = builder();

    } catch (error) {
      showMessage(
        messageId,
        error instanceof Error ? error.message : "Invalid settings.",
        "error"
      );

      return;
    }

    state.busy.add(formId);

    const form = $(formId);
    const button = $(buttonId);

    const originalLabel = button
      ? button.textContent
      : "";

    if (button) {
      button.disabled = true;
      button.textContent = "Saving...";
    }

    if (form) {
      form.setAttribute("aria-busy", "true");
    }

    setStatus("Saving " + sectionKey + "...", "warning");

    try {
      requireOwner();

      const targetRef = state.api.ref(
        state.db,
        SETTINGS_PATH + "/" + sectionKey
      );

      /*
       * Write only to this settings section. Other sections
       * under restaurantBilling/settings are left untouched.
       */
      await state.api.set(targetRef, record);

      state.settings[sectionKey] = record;
      state.dirty.delete(formId);

      populateCleanForms();
      showMessage(messageId, "Settings saved successfully.", "success");

      setStatus("Settings saved and synchronized.", "connected");
      setText("sidebarConnectionStatus", "Database connected");
      setText("settingsFooterStatus", "Settings saved");

      setText(
        "settingsSaveStatus",
        "Saved successfully at " +
        new Intl.DateTimeFormat("en-IN", {
          dateStyle: "medium",
          timeStyle: "short"
        }).format(new Date())
      );

      document.dispatchEvent(
        new CustomEvent("restaurant-settings-updated", {
          detail: {
            section: sectionKey,
            settings: state.settings
          }
        })
      );

    } catch (error) {
      console.error("Settings save failed:", {
        section: sectionKey,
        code: error && error.code ? error.code : "settings-save-error"
      });

      const message =
        error && error.code === "PERMISSION_DENIED"
          ? "Database permission denied. Check Firebase Security Rules."
          : error instanceof Error
            ? error.message
            : "Unable to save settings.";

      showMessage(messageId, message, "error");
      setStatus("Settings could not be saved.", "error");

    } finally {
      state.busy.delete(formId);

      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }

      if (form) {
        form.removeAttribute("aria-busy");
      }
    }
  }

  /* ---------------------------------------------------------
     10. Live database subscription
     --------------------------------------------------------- */

  function subscribeSettings() {
    const reference = state.api.ref(
      state.db,
      SETTINGS_PATH
    );

    const unsubscribe = state.api.onValue(
      reference,

      function (snapshot) {
        if (state.disposed) return;

        const data = snapshot.exists()
          ? snapshot.val()
          : {};

        state.settings =
          data && typeof data === "object" ? data : {};

        state.loaded = true;
        state.ready = true;

        populateCleanForms();

        setStatus(
          "Settings connected. Live database updates are enabled.",
          "connected"
        );

        setText("sidebarConnectionStatus", "Database connected");
        setText("settingsFooterStatus", "Live settings connected");

        if (!state.dirty.size) {
          setText("settingsSaveStatus", "Settings are synchronized.");
        }
      },

      function (error) {
        console.error("Settings database read failed:", {
          code: error && error.code ? error.code : "unknown"
        });

        state.loaded = false;
        state.ready = false;

        setStatus(
          "Unable to load settings. Check connection and database permissions.",
          "error"
        );

        setText(
          "settingsSaveStatus",
          "Saved settings could not be loaded."
        );
      }
    );

    state.subscriptions.push(unsubscribe);
  }

  /* ---------------------------------------------------------
     11. Initialize protected settings page
     --------------------------------------------------------- */

  async function initialize() {
    try {
      setStatus("Verifying owner session...", "warning");

      const access = window.restaurantAccess;

      if (!access || !access.readyPromise) {
        throw new Error("Owner authorization is unavailable.");
      }

      const authorized = await access.readyPromise;

      if (
        !authorized ||
        !access.authorized ||
        !access.user ||
        access.user.uid !== OWNER_UID
      ) {
        throw new Error("Only the authorized owner can access settings.");
      }

      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.readyPromise) {
        throw new Error("Firebase configuration loader is unavailable.");
      }

      const ready = await firebase.readyPromise;

      if (!ready || !firebase.ready) {
        throw new Error(
          firebase.error?.message || "Firebase initialization failed."
        );
      }

      const connected = getFirebase();

      state.db = connected.db;
      state.api = connected.api;

      bindDirtyTracking();
      subscribeSettings();

    } catch (error) {
      console.error("Settings initialization failed:", {
        message: error instanceof Error
          ? error.message
          : "Unknown initialization error"
      });

      setStatus(
        error instanceof Error
          ? error.message
          : "Settings could not be initialized.",
        "error"
      );
    }
  }

  /* ---------------------------------------------------------
     12. Bind save forms
     --------------------------------------------------------- */

  $("businessProfileForm")?.addEventListener("submit", function (event) {
    event.preventDefault();

    saveSection(
      "businessProfileForm",
      "businessProfile",
      buildBusinessProfile,
      "businessProfileMessage",
      "saveBusinessProfileBtn"
    );
  });

  $("invoiceSettingsForm")?.addEventListener("submit", function (event) {
    event.preventDefault();

    saveSection(
      "invoiceSettingsForm",
      "invoiceSettings",
      buildInvoiceSettings,
      "invoiceSettingsMessage",
      "saveInvoiceSettingsBtn"
    );
  });

  $("taxSettingsForm")?.addEventListener("submit", function (event) {
    event.preventDefault();

    saveSection(
      "taxSettingsForm",
      "taxSettings",
      buildTaxSettings,
      "taxSettingsMessage",
      "saveTaxSettingsBtn"
    );
  });

  $("paymentSettingsForm")?.addEventListener("submit", function (event) {
    event.preventDefault();

    saveSection(
      "paymentSettingsForm",
      "paymentSettings",
      buildPaymentSettings,
      "paymentSettingsMessage",
      "savePaymentSettingsBtn"
    );
  });

  /* ---------------------------------------------------------
     13. Clean up live listeners
     --------------------------------------------------------- */

  window.addEventListener("pagehide", function () {
    state.disposed = true;

    state.subscriptions.forEach(function (unsubscribe) {
      try {
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      } catch (_) {
        /* Listener cleanup */
      }
    });

    state.subscriptions = [];
  });

  initialize();

})();
