"use strict";

/*
 * Restaurant Billing Software
 * File: js/settings.js
 *
 * Phase 1: Frontend control room.
 *
 * Features:
 * - Business profile settings
 * - Branding and invoice preferences
 * - Tax and pricing configuration
 * - Cash / UPI settings
 * - Billing preferences
 * - Product and inventory rules
 * - Reporting preferences
 * - Data export/import
 * - Logo and UPI QR image previews
 * - Unsaved-change handling
 * - Browser-local demo persistence
 *
 * IMPORTANT:
 * Browser-local persistence is for this frontend demo only.
 * Firebase Realtime Database integration will replace it.
 *
 * Uploaded image files are previewed, not permanently uploaded.
 * Authentication credentials and secrets are never exported.
 */

(() => {
  // ==================================================
  // 1. CONFIGURATION
  // ==================================================

  const STORAGE_KEY = "restaurantBilling.settings.demo.v1";

  const APPLICATION_ID = "restaurant-billing";

  const SCHEMA_VERSION = 1;

  const MAX_IMPORT_SIZE = 2 * 1024 * 1024;

  const MAX_LOGO_SIZE = 1 * 1024 * 1024;

  const MAX_QR_SIZE = 2 * 1024 * 1024;

  const FORM_IDS = [
    "businessProfileForm",
    "brandSettingsForm",
    "invoiceSettingsForm",
    "taxPricingForm",
    "paymentSettingsForm",
    "billingPreferencesForm",
    "productSettingsForm",
    "reportSettingsForm"
  ];

  const STATUS_IDS = {
    businessProfileForm: "businessProfileStatus",
    brandSettingsForm: "brandSettingsStatus",
    invoiceSettingsForm: "invoiceSettingsStatus",
    taxPricingForm: "taxPricingStatus",
    paymentSettingsForm: "paymentSettingsStatus",
    billingPreferencesForm: "billingPreferencesStatus",
    productSettingsForm: "productSettingsStatus",
    reportSettingsForm: "reportSettingsStatus"
  };

  const SETTINGS_FORM_TITLES = {
    businessProfileForm: "Business Profile",
    brandSettingsForm: "Brand Identity",
    invoiceSettingsForm: "Invoice Configuration",
    taxPricingForm: "Tax & Pricing",
    paymentSettingsForm: "Payment Settings",
    billingPreferencesForm: "Billing Preferences",
    productSettingsForm: "Product & Inventory",
    reportSettingsForm: "Reports & Analytics"
  };

  // ==================================================
  // 2. DOM HELPERS
  // ==================================================

  const $ = (selector, parent = document) =>
    parent.querySelector(selector);

  const $$ = (selector, parent = document) =>
    Array.from(parent.querySelectorAll(selector));

  const toast = $("#settingsToast");

  const globalStatus = $("#globalSettingsStatus");

  const refreshButton = $("#refreshSettingsBtn");

  const exportSettingsButton = $("#exportSettingsBtn");

  const exportBackupButton = $("#downloadSettingsBackupBtn");

  const importFileInput = $("#settingsImportFile");

  const saveAccountButton = $("#saveAccountSettingsBtn");

  if (!toast || !globalStatus) {
    console.error("Settings: Required page elements were not found.");
    return;
  }

  // ==================================================
  // 3. RUNTIME STATE
  // ==================================================

  let toastTimer = null;

  let hasUnsavedChanges = false;

  let canUseLocalStorage = true;

  let imageObjectURLs = {
    logo: null,
    qr: null
  };

  let removedImages = {
    logo: false,
    qr: false
  };

  let savedState = createDefaultState();

  // ==================================================
  // 4. DEFAULT SETTINGS STATE
  // ==================================================

  function createDefaultState() {
    return {
      application: APPLICATION_ID,
      schemaVersion: SCHEMA_VERSION,
      forms: {},
      misc: {
        sessionTimeout: "10"
      }
    };
  }

  // ==================================================
  // 5. USER FEEDBACK
  // ==================================================

  function showToast(message, type = "info") {
    toast.textContent = message;

    toast.dataset.type = type;

    toast.hidden = false;

    window.clearTimeout(toastTimer);

    toastTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 5000);
  }

  function setGlobalStatus(message) {
    globalStatus.textContent = message;
  }

  function setFormStatus(formId, message) {
    const statusId = STATUS_IDS[formId];

    if (!statusId) return;

    const element = document.getElementById(statusId);

    if (element) {
      element.textContent = message;
    }
  }

  function setDataManagementStatus(message) {
    const element = $("#dataManagementStatus");

    if (element) {
      element.textContent = message;
    }
  }

  // ==================================================
  // 6. LOCAL STORAGE
  // ==================================================

  function isValidStoredState(value) {
    return Boolean(
      value &&
      typeof value === "object" &&
      value.application === APPLICATION_ID &&
      value.schemaVersion === SCHEMA_VERSION &&
      value.forms &&
      typeof value.forms === "object" &&
      !Array.isArray(value.forms)
    );
  }

  function readStoredState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);

      if (!isValidStoredState(parsed)) {
        console.warn("Settings: Stored data has an unsupported format.");
        return null;
      }

      return parsed;
    } catch (error) {
      canUseLocalStorage = false;

      console.warn(
        "Settings: Local storage is unavailable.",
        error
      );

      return null;
    }
  }

  function writeStoredState() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(savedState)
      );

      canUseLocalStorage = true;

      return true;
    } catch (error) {
      canUseLocalStorage = false;

      console.warn(
        "Settings: Unable to persist settings locally.",
        error
      );

      return false;
    }
  }

  // ==================================================
  // 7. READ FORM VALUES
  // ==================================================

  function readFormValues(form) {
    const values = {};

    for (const element of Array.from(form.elements)) {
      if (
        !element.id ||
        element.disabled ||
        element.type === "file" ||
        element.type === "button" ||
        element.type === "submit" ||
        element.type === "reset"
      ) {
        continue;
      }

      if (element.type === "checkbox") {
        values[element.id] = element.checked;
        continue;
      }

      if (element.type === "radio") {
        if (element.checked) {
          values[element.name] = element.value;
        }

        continue;
      }

      values[element.id] = element.value;
    }

    return values;
  }

  function readAllCurrentSettings() {
    const result = createDefaultState();

    for (const formId of FORM_IDS) {
      const form = document.getElementById(formId);

      if (form) {
        result.forms[formId] = readFormValues(form);
      }
    }

    result.misc.sessionTimeout =
      $("#sessionTimeout")?.value || "10";

    return result;
  }

  // ==================================================
  // 8. APPLY SAVED SETTINGS TO THE FORMS
  // ==================================================

  function applyFormValues(form, values) {
    if (!form || !values || typeof values !== "object") {
      return;
    }

    const entries = Object.entries(values);

    for (const [elementId, value] of entries) {
      const element = document.getElementById(elementId);

      if (
        !element ||
        !form.contains(element) ||
        element.disabled ||
        element.type === "file"
      ) {
        continue;
      }

      if (
        element.type === "button" ||
        element.type === "submit" ||
        element.type === "reset"
      ) {
        continue;
      }

      if (element.type === "checkbox") {
        if (typeof value === "boolean") {
          element.checked = value;
        }

        continue;
      }

      if (element.type === "radio") {
        if (typeof value === "string") {
          element.checked = element.value === value;
        }

        continue;
      }

      if (
        typeof value !== "string" &&
        typeof value !== "number"
      ) {
        continue;
      }

      const stringValue = String(value);

      if (element instanceof HTMLSelectElement) {
        const optionExists = Array.from(element.options).some(
          option => option.value === stringValue
        );

        if (optionExists) {
          element.value = stringValue;
        }

        continue;
      }

      element.value = stringValue;
    }
  }

  function applySavedState(state) {
    if (!isValidStoredState(state)) {
      return;
    }

    for (const formId of FORM_IDS) {
      const form = document.getElementById(formId);

      if (!form) continue;

      const values = state.forms[formId];

      if (values && typeof values === "object") {
        applyFormValues(form, values);
      }
    }

    if (state.misc && typeof state.misc === "object") {
      const timeout = $("#sessionTimeout");

      if (timeout && typeof state.misc.sessionTimeout === "string") {
        timeout.value = state.misc.sessionTimeout;
      }
    }

    updatePaymentControls();
    updateInvoiceQRControls();
  }

  // ==================================================
  // 9. DIRTY-CHANGE TRACKING
  // ==================================================

  function setUnsavedState(formId) {
    hasUnsavedChanges = true;

    setGlobalStatus(
      `${SETTINGS_FORM_TITLES[formId] || "Settings"} contains unsaved changes.`
    );

    setFormStatus(
      formId,
      "Unsaved changes — save this section to keep your configuration."
    );
  }

  function markAllSettingsSaved() {
    hasUnsavedChanges = false;

    setGlobalStatus(
      canUseLocalStorage
        ? "Settings are saved in this browser's demo storage. Firebase synchronisation is pending."
        : "Settings are currently available only in this page session."
    );
  }

  for (const formId of FORM_IDS) {
    const form = document.getElementById(formId);

    if (!form) continue;

    form.addEventListener("input", () => {
      setUnsavedState(formId);
    });

    form.addEventListener("change", () => {
      setUnsavedState(formId);
    });

    form.addEventListener("reset", () => {
      window.setTimeout(() => {
        const confirmedState = savedState.forms[formId];

        if (confirmedState) {
          applyFormValues(form, confirmedState);
        }

        setFormStatus(
          formId,
          "Restored the last saved settings for this section."
        );
      }, 0);
    });
  }

  // ==================================================
  // 10. FORM VALIDATION
  // ==================================================

  function validateForm(form) {
    if (!form.checkValidity()) {
      form.reportValidity();

      showToast(
        "Please review the highlighted fields and correct any invalid values.",
        "error"
      );

      return false;
    }

    return true;
  }

  function validateBusinessProfile() {
    const gstin = $("#businessGstin").value.trim();

    if (gstin && gstin.length !== 15) {
      showToast(
        "The GSTIN should contain 15 characters. Verify the value before saving.",
        "error"
      );

      $("#businessGstin").focus();

      return false;
    }

    return true;
  }

  function validateTaxPricing() {
    const taxEnabled = $("#taxEnabled").checked;

    const taxRate = Number($("#defaultTaxRate").value);

    const discountLimit = Number(
      $("#defaultDiscountLimit").value
    );

    if (
      !Number.isFinite(taxRate) ||
      taxRate < 0 ||
      taxRate > 100
    ) {
      showToast(
        "The default tax rate must be between 0 and 100.",
        "error"
      );

      $("#defaultTaxRate").focus();

      return false;
    }

    if (
      !Number.isFinite(discountLimit) ||
      discountLimit < 0
    ) {
      showToast(
        "The maximum discount must be a valid non-negative amount.",
        "error"
      );

      $("#defaultDiscountLimit").focus();

      return false;
    }

    if (!taxEnabled && taxRate > 0) {
      const confirmed = window.confirm(
        "Tax calculation is disabled, but a default tax rate is configured. " +
        "Save both settings as they are?"
      );

      if (!confirmed) {
        $("#taxEnabled").focus();

        return false;
      }
    }

    return true;
  }

  function validatePaymentSettings() {
    const upiEnabled = $("#upiPaymentEnabled").checked;

    const upiId = $("#upiVpa").value.trim();

    if (!upiEnabled) {
      return true;
    }

    if (upiId && !/^[^@\s]+@[^@\s]+$/.test(upiId)) {
      showToast(
        "Enter a UPI ID in the usual name@provider format.",
        "error"
      );

      $("#upiVpa").focus();

      return false;
    }

    return true;
  }

  function validateProductSettings() {
    const threshold = Number($("#lowStockThreshold").value);

    if (
      !Number.isSafeInteger(threshold) ||
      threshold < 0
    ) {
      showToast(
        "Low-stock threshold must be a valid non-negative whole number.",
        "error"
      );

      $("#lowStockThreshold").focus();

      return false;
    }

    return true;
  }

  // ==================================================
  // 11. SAVE A SETTINGS SECTION
  // ==================================================

  function saveFormSettings(formId, validationCallback = null) {
    const form = document.getElementById(formId);

    if (!form) return false;

    if (!validateForm(form)) {
      return false;
    }

    if (
      typeof validationCallback === "function" &&
      !validationCallback()
    ) {
      return false;
    }

    /*
     * Update only this section's saved configuration.
     * Other sections with unsaved edits remain unsaved.
     */

    savedState.forms[formId] = readFormValues(form);

    const persisted = writeStoredState();

    setFormStatus(
      formId,
      persisted
        ? `${SETTINGS_FORM_TITLES[formId]} saved locally in demo mode.`
        : `${SETTINGS_FORM_TITLES[formId]} saved for this page session only.`
    );

    /*
     * Image files are not included in the settings object.
     * Real asset upload will require backend-managed storage.
     */

    if (
      formId === "brandSettingsForm" &&
      $("#businessLogoFile").files.length > 0
    ) {
      setFormStatus(
        formId,
        "Text settings saved. Logo preview is temporary; permanent image upload is pending."
      );
    }

    if (
      formId === "paymentSettingsForm" &&
      $("#upiQRImage").files.length > 0
    ) {
      setFormStatus(
        formId,
        "Payment settings saved. QR preview is temporary; permanent image upload is pending."
      );
    }

    if (formId === "paymentSettingsForm") {
      updatePaymentControls();
    }

    if (formId === "invoiceSettingsForm") {
      updateInvoiceQRControls();
    }

    if (formId === "businessProfileForm") {
      updateBrandDisplayName();
    }

    if (formId === "reportSettingsForm") {
      updateReportDefaultsStatus();
    }

    /*
     * Recalculate whether other forms have unsaved edits by
     * checking them against their saved snapshots.
     */

    updateDirtyState();

    showToast(
      persisted
        ? `${SETTINGS_FORM_TITLES[formId]} saved in demo storage.`
        : `${SETTINGS_FORM_TITLES[formId]} saved in memory for this session.`,
      persisted ? "success" : "info"
    );

    return true;
  }

  // ==================================================
  // 12. ATTACH SAVE HANDLERS
  // ==================================================

  $("#businessProfileForm").addEventListener("submit", event => {
    event.preventDefault();

    saveFormSettings(
      "businessProfileForm",
      validateBusinessProfile
    );
  });

  $("#brandSettingsForm").addEventListener("submit", event => {
    event.preventDefault();

    saveFormSettings("brandSettingsForm");
  });

  $("#invoiceSettingsForm").addEventListener("submit", event => {
    event.preventDefault();

    saveFormSettings("invoiceSettingsForm");
  });

  $("#taxPricingForm").addEventListener("submit", event => {
    event.preventDefault();

    saveFormSettings(
      "taxPricingForm",
      validateTaxPricing
    );
  });

  $("#paymentSettingsForm").addEventListener("submit", event => {
    event.preventDefault();

    saveFormSettings(
      "paymentSettingsForm",
      validatePaymentSettings
    );
  });

  $("#billingPreferencesForm").addEventListener("submit", event => {
    event.preventDefault();

    saveFormSettings("billingPreferencesForm");
  });

  $("#productSettingsForm").addEventListener("submit", event => {
    event.preventDefault();

    saveFormSettings(
      "productSettingsForm",
      validateProductSettings
    );
  });

  $("#reportSettingsForm").addEventListener("submit", event => {
    event.preventDefault();

    saveFormSettings("reportSettingsForm");
  });

  // ==================================================
  // 13. UNSAVED-STATE COMPARISON
  // ==================================================

  function valuesEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function updateDirtyState() {
    let dirty = false;

    for (const formId of FORM_IDS) {
      const form = document.getElementById(formId);

      if (!form) continue;

      const current = readFormValues(form);

      const saved = savedState.forms[formId] || {};

      if (!valuesEqual(current, saved)) {
        dirty = true;

        setFormStatus(
          formId,
          "Unsaved changes — save this section to keep your configuration."
        );
      }
    }

    const timeoutValue = $("#sessionTimeout").value;

    const savedTimeout = savedState.misc?.sessionTimeout || "10";

    if (timeoutValue !== savedTimeout) {
      dirty = true;
    }

    if (
      $("#businessLogoFile").files.length > 0 ||
      $("#upiQRImage").files.length > 0
    ) {
      dirty = true;
    }

    hasUnsavedChanges = dirty;

    if (dirty) {
      setGlobalStatus(
        "Some configuration sections contain unsaved changes."
      );
    } else {
      markAllSettingsSaved();
    }
  }

  // ==================================================
  // 14. IMAGE PREVIEW HELPERS
  // ==================================================

  function releaseImageURL(type) {
    const oldURL = imageObjectURLs[type];

    if (oldURL) {
      URL.revokeObjectURL(oldURL);
      imageObjectURLs[type] = null;
    }
  }

  function previewImageFile(
    input,
    imageElement,
    placeholderElement,
    type,
    maxSize
  ) {
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      showToast(
        "Please select a valid image file.",
        "error"
      );

      input.value = "";

      return;
    }

    if (file.size > maxSize) {
      showToast(
        `The selected image exceeds the allowed ${Math.round(maxSize / 1024)} KB size.`,
        "error"
      );

      input.value = "";

      return;
    }

    const allowedTypes = type === "logo"
      ? [
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/svg+xml"
        ]
      : [
          "image/png",
          "image/jpeg",
          "image/webp"
        ];

    if (!allowedTypes.includes(file.type)) {
      showToast(
        "This image format is not supported for the selected upload.",
        "error"
      );

      input.value = "";

      return;
    }

    releaseImageURL(type);

    const objectURL = URL.createObjectURL(file);

    imageObjectURLs[type] = objectURL;

    imageElement.onload = () => {
      imageElement.style.display = "block";
      placeholderElement.style.display = "none";
    };

    imageElement.onerror = () => {
      releaseImageURL(type);

      imageElement.removeAttribute("src");
      imageElement.style.display = "none";

      placeholderElement.style.display = "block";

      input.value = "";

      showToast(
        "The selected image could not be displayed.",
        "error"
      );
    };

    imageElement.src = objectURL;

    removedImages[type] = false;
  }

  // ==================================================
  // 15. LOGO PREVIEW
  // ==================================================

  const logoInput = $("#businessLogoFile");

  const logoPreview = $("#businessLogoPreview");

  const logoPlaceholder = $("#businessLogoPlaceholder");

  $("#businessLogoFile").addEventListener("change", () => {
    const file = logoInput.files?.[0];

    if (!file) return;

    previewImageFile(
      logoInput,
      logoPreview,
      logoPlaceholder,
      "logo",
      MAX_LOGO_SIZE
    );

    setUnsavedState("brandSettingsForm");
  });

  $("#removeBusinessLogoBtn").addEventListener("click", () => {
    releaseImageURL("logo");

    logoInput.value = "";

    logoPreview.removeAttribute("src");
    logoPreview.style.display = "none";

    logoPlaceholder.style.display = "block";

    removedImages.logo = true;

    setUnsavedState("brandSettingsForm");

    showToast(
      "Logo selection cleared from the preview. Save the branding configuration to confirm your changes.",
      "info"
    );
  });

  // ==================================================
  // 16. UPI QR PREVIEW
  // ==================================================

  const qrInput = $("#upiQRImage");

  const qrPreview = $("#upiQRPreview");

  const qrPlaceholder = $("#upiQRPlaceholder");

  qrInput.addEventListener("change", () => {
    const file = qrInput.files?.[0];

    if (!file) return;

    previewImageFile(
      qrInput,
      qrPreview,
      qrPlaceholder,
      "qr",
      MAX_QR_SIZE
    );

    setUnsavedState("paymentSettingsForm");
  });

  $("#removeUPIQRBtn").addEventListener("click", () => {
    releaseImageURL("qr");

    qrInput.value = "";

    qrPreview.removeAttribute("src");
    qrPreview.style.display = "none";

    qrPlaceholder.style.display = "block";

    removedImages.qr = true;

    setUnsavedState("paymentSettingsForm");

    showToast(
      "UPI QR selection cleared from the preview. Save the payment configuration to confirm the change.",
      "info"
    );
  });

  // ==================================================
  // 17. INVOICE QR DISPLAY CONTROLS
  // ==================================================

  function updateInvoiceQRControls() {
    const invoiceQR = $("#invoiceShowUPIQR");

    const paymentQR = $("#upiQRDisplayEnabled");

    if (!invoiceQR || !paymentQR) return;

    /*
     * Both controls affect whether a UPI QR should eventually
     * appear in the invoice.
     *
     * The actual invoice page must read these settings from
     * the shared configuration source after integration.
     */

    if (!$("#upiPaymentEnabled").checked) {
      paymentQR.checked = false;
      paymentQR.disabled = true;
    } else {
      paymentQR.disabled = false;
    }

    const upiEnabled = $("#upiPaymentEnabled").checked;

    if (!upiEnabled) {
      invoiceQR.checked = false;
    }
  }

  function updatePaymentControls() {
    const upiEnabled = $("#upiPaymentEnabled").checked;

    const upiId = $("#upiVpa");

    const payee = $("#upiPayeeName");

    const qrUpload = $("#upiQRImage");

    const qrDisplay = $("#upiQRDisplayEnabled");

    /*
     * Preserve entered settings while disabling the relevant
     * controls. Disabling is an interface rule, not security.
     */

    upiId.disabled = !upiEnabled;

    payee.disabled = !upiEnabled;

    qrUpload.disabled = !upiEnabled;

    qrDisplay.disabled = !upiEnabled;

    updateInvoiceQRControls();
  }

  $("#upiPaymentEnabled").addEventListener("change", () => {
    updatePaymentControls();

    setUnsavedState("paymentSettingsForm");
  });

  // ==================================================
  // 18. BRAND NAME PREVIEW
  // ==================================================

  function updateBrandDisplayName() {
    const businessName = $("#businessName").value.trim();

    const displayName = $("#brandDisplayName").value.trim();

    const effectiveName = displayName || businessName;

    /*
     * Current pages still contain placeholder business names.
     * A shared branding update will be implemented when pages
     * are connected to the common settings source.
     */

    if (effectiveName) {
      document.title = `${effectiveName} | Settings`;
    } else {
      document.title = "Settings | Restaurant Billing";
    }
  }

  $("#businessName").addEventListener(
    "input",
    updateBrandDisplayName
  );

  $("#brandDisplayName").addEventListener(
    "input",
    updateBrandDisplayName
  );

  // ==================================================
  // 19. REPORT DEFAULTS STATUS
  // ==================================================

  function updateReportDefaultsStatus() {
    const period = $("#defaultReportPeriod").value;

    const interval = $("#defaultChartInterval").value;

    const message =
      `Default report view: ${period}; chart interval: ${interval}. ` +
      "The reports page must read these values after shared settings integration.";

    setFormStatus("reportSettingsForm", message);
  }

  // ==================================================
  // 20. EXPORT SETTINGS AS JSON
  // ==================================================

  function createExportPayload() {
    const current = readAllCurrentSettings();

    /*
     * Only configuration fields are exported.
     *
     * Excluded:
     * - Uploaded files and image contents
     * - Authentication tokens
     * - Passwords
     * - Private API keys
     * - Service-account credentials
     */

    return {
      application: APPLICATION_ID,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      note:
        "Frontend demo settings only. This file is not a complete database backup.",
      settings: {
        forms: current.forms,
        misc: current.misc
      }
    };
  }

  function downloadJSON(payload, filename) {
    const json = JSON.stringify(payload, null, 2);

    const blob = new Blob(
      [json],
      { type: "application/json;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");

    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function exportSettings() {
    const payload = createExportPayload();

    const date = new Date().toISOString().slice(0, 10);

    downloadJSON(
      payload,
      `restaurant-settings-${date}.json`
    );

    showToast(
      "Settings configuration exported. Uploaded images and database records are not included.",
      "success"
    );

    setDataManagementStatus(
      `Settings export created on ${new Date().toLocaleString()}.`
    );
  }

  exportSettingsButton.addEventListener(
    "click",
    exportSettings
  );

  exportBackupButton.addEventListener(
    "click",
    exportSettings
  );

  // ==================================================
  // 21. VALIDATE IMPORTED SETTINGS
  // ==================================================

  function validateImportedPayload(payload) {
    if (
      !payload ||
      typeof payload !== "object" ||
      payload.application !== APPLICATION_ID ||
      !Number.isInteger(payload.schemaVersion) ||
      payload.schemaVersion !== SCHEMA_VERSION ||
      !payload.settings ||
      typeof payload.settings !== "object"
    ) {
      throw new Error(
        "This file is not a supported Restaurant Billing settings export."
      );
    }

    if (
      !payload.settings.forms ||
      typeof payload.settings.forms !== "object" ||
      Array.isArray(payload.settings.forms)
    ) {
      throw new Error("The settings file has an invalid forms section.");
    }

    return true;
  }

  function applyImportedPayload(payload) {
    const imported = payload.settings;

    for (const formId of FORM_IDS) {
      const form = document.getElementById(formId);

      const values = imported.forms?.[formId];

      if (
        !form ||
        !values ||
        typeof values !== "object" ||
        Array.isArray(values)
      ) {
        continue;
      }

      applyFormValues(form, values);
    }

    if (
      imported.misc &&
      typeof imported.misc.sessionTimeout === "string"
    ) {
      const timeout = $("#sessionTimeout");

      const validOption = Array.from(timeout.options).some(
        option => option.value === imported.misc.sessionTimeout
      );

      if (validOption) {
        timeout.value = imported.misc.sessionTimeout;
      }
    }

    // Uploaded image files are never imported from JSON.
    logoInput.value = "";

    logoPreview.removeAttribute("src");
    logoPreview.style.display = "none";
    logoPlaceholder.style.display = "block";

    qrInput.value = "";

    qrPreview.removeAttribute("src");
    qrPreview.style.display = "none";
    qrPlaceholder.style.display = "block";

    const newState = createDefaultState();

    newState.forms = {};

    for (const formId of FORM_IDS) {
      const form = document.getElementById(formId);

      if (!form) continue;

      newState.forms[formId] = readFormValues(form);
    }

    newState.misc.sessionTimeout =
      $("#sessionTimeout").value || "10";

    savedState = newState;

    const persisted = writeStoredState();

    for (const formId of FORM_IDS) {
      setFormStatus(
        formId,
        persisted
          ? "Imported configuration saved locally in demo mode."
          : "Imported configuration applied for this page session only."
      );
    }

    updatePaymentControls();
    updateInvoiceQRControls();
    updateBrandDisplayName();
    updateDirtyState();

    showToast(
      persisted
        ? "Settings imported and saved in browser-local demo storage."
        : "Settings imported for this page session, but local persistence is unavailable.",
      persisted ? "success" : "info"
    );

    setDataManagementStatus(
      "Settings imported. Uploaded assets were not imported."
    );
  }

  // ==================================================
  // 22. IMPORT SETTINGS FILE
  // ==================================================

  importFileInput.addEventListener("change", async () => {
    const file = importFileInput.files?.[0];

    if (!file) return;

    if (file.size > MAX_IMPORT_SIZE) {
      showToast(
        "The settings file is too large. The maximum permitted size is 2 MB.",
        "error"
      );

      importFileInput.value = "";

      return;
    }

    if (hasUnsavedChanges) {
      const proceed = window.confirm(
        "You have unsaved changes. Importing settings will replace the current form values. Continue?"
      );

      if (!proceed) {
        importFileInput.value = "";
        return;
      }
    }

    try {
      const text = await file.text();

      const payload = JSON.parse(text);

      validateImportedPayload(payload);

      /*
       * Save a snapshot so validation failures can restore
       * the last saved configuration.
       */

      const previousState = JSON.parse(
        JSON.stringify(savedState)
      );

      try {
        applyImportedPayload(payload);

        const invalidForm = FORM_IDS.find(formId => {
          const form = document.getElementById(formId);

          return form && !form.checkValidity();
        });

        if (invalidForm) {
          throw new Error(
            `Imported settings contain invalid values in ${SETTINGS_FORM_TITLES[invalidForm]}.`
          );
        }
      } catch (error) {
        savedState = previousState;

        applySavedState(savedState);

        throw error;
      }
    } catch (error) {
      console.error("Settings import failed:", error);

      showToast(
        error instanceof Error
          ? error.message
          : "Unable to import settings.",
        "error"
      );
    } finally {
      importFileInput.value = "";
    }
  });

  // ==================================================
  // 23. SESSION PREFERENCE
  // ==================================================

  saveAccountButton.addEventListener("click", () => {
    const timeout = $("#sessionTimeout").value;

    const validTimeouts = [
      "5",
      "10",
      "15",
      "30"
    ];

    if (!validTimeouts.includes(timeout)) {
      showToast("Select a supported session timeout.", "error");
      return;
    }

    savedState.misc.sessionTimeout = timeout;

    const persisted = writeStoredState();

    $("#accountSettingsStatus").textContent = persisted
      ? "Session timeout preference saved locally. Authentication integration is still pending."
      : "Session timeout preference applied for this session only.";

    updateDirtyState();

    showToast(
      persisted
        ? "Session preference saved in demo mode."
        : "Session preference applied for the current session.",
      persisted ? "success" : "info"
    );
  });

  $("#sessionTimeout").addEventListener("change", () => {
    setGlobalStatus("Session timeout preference has unsaved changes.");
  });

  // ==================================================
  // 24. RESET / REFRESH SETTINGS
  // ==================================================

  function reloadSavedSettings() {
    const stored = readStoredState();

    if (stored) {
      savedState = stored;
    } else {
      /*
       * With no saved configuration, retain the current default
       * form values as the starting demo state.
       */

      savedState = createDefaultState();

      for (const formId of FORM_IDS) {
        const form = document.getElementById(formId);

        if (form) {
          savedState.forms[formId] = readFormValues(form);
        }
      }

      savedState.misc.sessionTimeout =
        $("#sessionTimeout").value || "10";
    }

    applySavedState(savedState);

    releaseImageURL("logo");
    releaseImageURL("qr");

    logoInput.value = "";
    qrInput.value = "";

    removedImages.logo = false;
    removedImages.qr = false;

    logoPreview.removeAttribute("src");
    logoPreview.style.display = "none";
    logoPlaceholder.style.display = "block";

    qrPreview.removeAttribute("src");
    qrPreview.style.display = "none";
    qrPlaceholder.style.display = "block";

    hasUnsavedChanges = false;

    for (const formId of FORM_IDS) {
      setFormStatus(
        formId,
        "Current form values restored from the saved demo configuration."
      );
    }

    updateBrandDisplayName();
    updatePaymentControls();
    updateInvoiceQRControls();

    markAllSettingsSaved();
  }

  refreshButton.addEventListener("click", () => {
    if (hasUnsavedChanges) {
      const proceed = window.confirm(
        "Discard your unsaved changes and reload the last saved settings?"
      );

      if (!proceed) return;
    }

    reloadSavedSettings();

    showToast(
      "Saved configuration reloaded.",
      "success"
    );
  });

  // ==================================================
  // 25. UNSAVED-CHANGE BROWSER WARNING
  // ==================================================

  window.addEventListener("beforeunload", event => {
    if (!hasUnsavedChanges) return;

    event.preventDefault();

    event.returnValue = "";
  });

  // ==================================================
  // 26. SETTINGS NAVIGATION
  // ==================================================

  const navLinks = $$(".settings-nav a[href^='#']");

  for (const link of navLinks) {
    link.addEventListener("click", () => {
      for (const candidate of navLinks) {
        candidate.classList.remove("active");
      }

      link.classList.add("active");
    });
  }

  if ("IntersectionObserver" in window) {
    const sectionObserver = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort(
            (a, b) =>
              b.intersectionRatio - a.intersectionRatio
          );

        if (!visible.length) return;

        const activeSectionId = visible[0].target.id;

        for (const link of navLinks) {
          const isActive =
            link.getAttribute("href") === `#${activeSectionId}`;

          link.classList.toggle("active", isActive);
        }
      },
      {
        rootMargin: "-90px 0px -60% 0px",
        threshold: [0.05, 0.2, 0.4, 0.6]
      }
    );

    for (const link of navLinks) {
      const id = link.getAttribute("href").slice(1);

      const section = document.getElementById(id);

      if (section) {
        sectionObserver.observe(section);
      }
    }
  }

  // ==================================================
  // 27. INITIALISE SETTINGS
  // ==================================================

  const existingState = readStoredState();

  if (existingState) {
    savedState = existingState;

    applySavedState(savedState);

    for (const formId of FORM_IDS) {
      setFormStatus(
        formId,
        "Saved demo configuration loaded."
      );
    }
  } else {
    /*
     * Use current HTML defaults as the first configuration.
     * Nothing is written to storage until the owner saves.
     */

    savedState = createDefaultState();

    for (const formId of FORM_IDS) {
      const form = document.getElementById(formId);

      if (form) {
        savedState.forms[formId] = readFormValues(form);
      }
    }

    savedState.misc.sessionTimeout =
      $("#sessionTimeout").value || "10";
  }

  updatePaymentControls();
  updateInvoiceQRControls();
  updateBrandDisplayName();
  updateReportDefaultsStatus();

  markAllSettingsSaved();

  console.info("Settings Control Room initialised.", {
    demoMode: true,
    localStorageAvailable: canUseLocalStorage,
    configuredSections: FORM_IDS.length
  });
})();
