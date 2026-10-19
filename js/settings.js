/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Business Settings — Live Firebase Integration
   Database root: restaurantBilling/settings/
   Public location: publicInvoiceVerification/businessLocation
   Interactive map picker with automatic Google Maps URL
   Safe manual refresh; preserves dirty forms
   Shared dashboard loading animation
   No demo data, localStorage persistence or secrets
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const SETTINGS_PATH = "restaurantBilling/settings";
  const PUBLIC_LOCATION_PATH =
    "publicInvoiceVerification/businessLocation";
  const LOADING_REVEAL_MS = 270;

  const $ = (id) => document.getElementById(id);

  const state = {
    db: null,
    api: null,
    settings: {},
    loaded: false,
    ready: false,
    busy: new Set(),
    dirty: new Set(),
    subscriptions: [],
    unregisterPageRefresh: null,
    disposed: false,

    map: null,
    marker: null,
    mapInitialized: false,
    selectedMapLocation: null,
    suppressMapURLInput: false,

    // Shared loading animation state
    loadingPhase: "loading",
    revealTimer: null
  };

  const ui = window.restaurantUI;

  /* ---------------------------------------------------------
     1. Shared loading animation
     Reuses the existing dashboard CSS. No new CSS required.
     --------------------------------------------------------- */

  function revealSettingsPage() {
    if (
      state.disposed ||
      state.loadingPhase !== "loading"
    ) {
      return;
    }

    state.loadingPhase = "revealing";

    document.body.classList.remove("is-dashboard-loading");
    document.body.classList.add("is-dashboard-revealing");

    clearTimeout(state.revealTimer);

    state.revealTimer = window.setTimeout(function () {
      document.body.classList.remove("is-dashboard-revealing");

      state.loadingPhase = "complete";
      state.revealTimer = null;
    }, LOADING_REVEAL_MS);
  }

  function finishSettingsLoadingImmediately() {
    clearTimeout(state.revealTimer);
    state.revealTimer = null;

    document.body.classList.remove(
      "is-dashboard-loading",
      "is-dashboard-revealing"
    );

    state.loadingPhase = "complete";
  }

  /* ---------------------------------------------------------
     2. Common helpers
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
    node.classList.remove("is-success", "is-error", "is-warning");

    if (type) node.classList.add("is-" + type);
  }

  function setStatus(message, type) {
    const node = $("settingsPageStatus");
    if (!node) return;

    node.textContent = message || "";
    node.classList.remove("is-connected", "is-error", "is-warning");

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

  function storedValue(object, keys) {
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

    return "";
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

  function validateGoogleMapsURL(value) {
    if (!value) return "";

    const normalized = validateURL(value, "Google Maps URL");
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();

    const validHost =
      hostname === "google.com" ||
      hostname.endsWith(".google.com") ||
      hostname === "maps.app.goo.gl" ||
      hostname === "goo.gl";

    if (!validHost) {
      throw new Error(
        "Use a Google Maps link or select a location on the map."
      );
    }

    if (
      (hostname === "google.com" || hostname.endsWith(".google.com")) &&
      !url.pathname.toLowerCase().startsWith("/maps")
    ) {
      throw new Error("Enter a valid Google Maps link.");
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
      typeof api.update !== "function" ||
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

  function validCoordinates(latitude, longitude) {
    return (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }

  function readCoordinates(object) {
    const latitude = numberValue(object?.businessLatitude);
    const longitude = numberValue(object?.businessLongitude);

    if (
      latitude === null ||
      longitude === null ||
      !validCoordinates(latitude, longitude)
    ) {
      return null;
    }

    return { latitude, longitude };
  }

  function mapsURLFromCoordinates(latitude, longitude) {
    if (!validCoordinates(latitude, longitude)) {
      throw new Error("Selected map coordinates are invalid.");
    }

    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set(
      "query",
      latitude.toFixed(7) + "," + longitude.toFixed(7)
    );

    return url.href;
  }

  /* ---------------------------------------------------------
     3. Read saved settings
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
     4. Business profile form
     --------------------------------------------------------- */

  function updateMapsPreviewLink(value) {
    const link = $("previewBusinessMapsLink");
    if (!link) return;

    let validURL = "";

    try {
      validURL = validateGoogleMapsURL(textValue(value));
    } catch (_) {
      validURL = "";
    }

    if (!validURL) {
      link.hidden = true;
      link.removeAttribute("href");
      return;
    }

    link.href = validURL;
    link.hidden = false;
  }

  function updateCoordinateDisplay(location) {
    const display = $("businessLocationCoordinates");
    if (!display) return;

    if (!location) {
      display.textContent = "No map pin selected.";
      return;
    }

    display.textContent =
      "Selected coordinates: " +
      location.latitude.toFixed(6) + ", " +
      location.longitude.toFixed(6);
  }

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
      "logoImageUrl",
      "logo"
    ]));

    const mapsURL = textValue(firstValue(profile, [
      "businessMapsUrl",
      "googleMapsUrl",
      "mapsUrl"
    ]) || "");

    assignInput("businessMapsUrlInput", mapsURL);
    updateMapsPreviewLink(mapsURL);

    state.selectedMapLocation = readCoordinates(profile);
    updateCoordinateDisplay(state.selectedMapLocation);

    if (state.mapInitialized && state.selectedMapLocation) {
      setMapMarker(
        state.selectedMapLocation.latitude,
        state.selectedMapLocation.longitude,
        false
      );
    }
  }

  function buildBusinessProfile() {
    const name = textValue($("businessNameInput")?.value);

    if (!name) {
      $("businessNameInput")?.focus();
      throw new Error("Business name is required.");
    }

    const email = textValue($("businessEmailInput")?.value);

    if (
      email &&
      $("businessEmailInput") &&
      !$("businessEmailInput").validity.valid
    ) {
      $("businessEmailInput").focus();
      throw new Error("Enter a valid business email.");
    }

    const phone = textValue($("businessPhoneInput")?.value);

    const logo = validateURL(
      textValue($("businessLogoUrlInput")?.value),
      "Logo URL"
    );

    const mapsURL = validateGoogleMapsURL(
      textValue($("businessMapsUrlInput")?.value)
    );

    const coordinates = state.selectedMapLocation;

    return {
      ...makeMetadata(),
      businessName: name,
      businessTagline: textValue($("businessTaglineInput")?.value),
      businessAddress: textValue($("businessAddressInput")?.value),
      businessPhone: phone,
      businessEmail: email,
      businessLogoUrl: logo,
      businessMapsUrl: mapsURL,
      businessLatitude: coordinates ? coordinates.latitude : null,
      businessLongitude: coordinates ? coordinates.longitude : null
    };
  }

  /* ---------------------------------------------------------
     5. Interactive map picker
     --------------------------------------------------------- */

  function setMapPickerVisibility(visible) {
    const panel = $("businessMapPickerPanel");
    const button = $("pickBusinessLocationBtn");

    if (!panel || !button) return;

    panel.hidden = !visible;
    button.setAttribute("aria-expanded", String(visible));
    button.textContent = visible
      ? "Hide Location Map"
      : "Pick Location on Map";

    if (visible) {
      initializeMap();
    }
  }

  function setMapPickerStatus(message, type) {
    const node = $("businessMapPickerStatus");
    if (!node) return;

    node.textContent = message;
    node.classList.remove("is-success", "is-error", "is-warning");

    if (type) node.classList.add("is-" + type);
  }

  function syncMapSelection(latitude, longitude, updateURL) {
    if (!validCoordinates(latitude, longitude)) {
      setMapPickerStatus("Invalid map coordinates.", "error");
      return;
    }

    state.selectedMapLocation = {
      latitude: Number(latitude),
      longitude: Number(longitude)
    };

    updateCoordinateDisplay(state.selectedMapLocation);

    if (updateURL) {
      const input = $("businessMapsUrlInput");

      if (input) {
        state.suppressMapURLInput = true;
        input.value = mapsURLFromCoordinates(latitude, longitude);
        state.suppressMapURLInput = false;
      }

      updateMapsPreviewLink(input?.value || "");
      state.dirty.add("businessProfileForm");
    }

    const useButton = $("useSelectedBusinessLocationBtn");
    if (useButton) useButton.disabled = false;

    setMapPickerStatus(
      "Pin selected. Google Maps URL generated automatically. Save Business Profile to store it.",
      "success"
    );
  }

  function setMapMarker(latitude, longitude, updateURL) {
    if (!state.map || !window.L) return;

    const point = [latitude, longitude];

    if (!state.marker) {
      state.marker = window.L.marker(point, {
        draggable: true
      }).addTo(state.map);

      state.marker.on("dragend", function (event) {
        const position = event.target.getLatLng();

        syncMapSelection(
          position.lat,
          position.lng,
          true
        );
      });
    } else {
      state.marker.setLatLng(point);
    }

    if (updateURL) {
      state.map.panTo(point);
    }

    syncMapSelection(latitude, longitude, updateURL);
  }

  function initializeMap() {
    const container = $("businessLocationMap");
    if (!container) return;

    if (state.mapInitialized && state.map) {
      window.setTimeout(function () {
        state.map.invalidateSize();
      }, 100);

      return;
    }

    if (!window.L || typeof window.L.map !== "function") {
      setMapPickerStatus(
        "Map library could not load. Check your internet connection and reload Settings.",
        "error"
      );

      const useButton = $("useSelectedBusinessLocationBtn");
      if (useButton) useButton.disabled = true;

      return;
    }

    const saved = state.selectedMapLocation;

    const initialCenter = saved
      ? [saved.latitude, saved.longitude]
      : [26.2, 92.9];

    const initialZoom = saved ? 16 : 6;

    try {
      state.map = window.L.map(container, {
        zoomControl: true,
        scrollWheelZoom: true
      }).setView(initialCenter, initialZoom);

      window.L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
        }
      ).addTo(state.map);

      state.map.on("click", function (event) {
        setMapMarker(
          event.latlng.lat,
          event.latlng.lng,
          true
        );
      });

      state.map.on("locationerror", function () {
        setMapPickerStatus(
          "Map location is unavailable. You can still select a pin manually.",
          "warning"
        );
      });

      state.mapInitialized = true;

      if (saved) {
        setMapMarker(saved.latitude, saved.longitude, false);

        setMapPickerStatus(
          "Saved pin loaded. Click another point or drag the marker to change it.",
          "connected"
        );
      } else {
        setMapPickerStatus(
          "Move or zoom the map, then click the restaurant's exact location to place a pin."
        );

        const useButton = $("useSelectedBusinessLocationBtn");
        if (useButton) useButton.disabled = true;
      }

      window.setTimeout(function () {
        if (state.map) state.map.invalidateSize();
      }, 150);

    } catch (error) {
      console.error("Map initialization failed:", error);

      setMapPickerStatus(
        "Unable to initialize the map. Reload Settings and try again.",
        "error"
      );
    }
  }

  function useSelectedLocation() {
    const location = state.selectedMapLocation;

    if (!location || !validCoordinates(
      location.latitude,
      location.longitude
    )) {
      setMapPickerStatus(
        "Click the map and select a location first.",
        "warning"
      );
      return;
    }

    const mapsInput = $("businessMapsUrlInput");

    if (mapsInput) {
      mapsInput.value = mapsURLFromCoordinates(
        location.latitude,
        location.longitude
      );
    }

    updateMapsPreviewLink(mapsInput?.value || "");
    state.dirty.add("businessProfileForm");

    showMessage(
      "businessProfileMessage",
      "Map location selected. Click Save Business Profile to store the address and Google Maps link.",
      "success"
    );

    setMapPickerVisibility(false);
  }

  function bindMapPicker() {
    $("pickBusinessLocationBtn")?.addEventListener(
      "click",
      function () {
        const panel = $("businessMapPickerPanel");

        setMapPickerVisibility(Boolean(panel?.hidden));
      }
    );

    $("closeBusinessMapPickerBtn")?.addEventListener(
      "click",
      function () {
        setMapPickerVisibility(false);
      }
    );

    $("useSelectedBusinessLocationBtn")?.addEventListener(
      "click",
      useSelectedLocation
    );

    $("businessMapsUrlInput")?.addEventListener(
      "input",
      function () {
        if (state.suppressMapURLInput) return;

        /*
         * Manual edits clear the selected coordinates because
         * the typed link may not match the previously selected pin.
         */
        state.selectedMapLocation = null;
        updateCoordinateDisplay(null);
        updateMapsPreviewLink(this.value);
        state.dirty.add("businessProfileForm");

        const useButton = $("useSelectedBusinessLocationBtn");
        if (useButton) useButton.disabled = true;
      }
    );

    $("businessMapsUrlInput")?.addEventListener(
      "change",
      function () {
        updateMapsPreviewLink(this.value);
      }
    );
  }

  /* ---------------------------------------------------------
     6. Invoice preferences
     --------------------------------------------------------- */

  function getExistingInvoiceSettings() {
    const settings = state.settings || {};
    const forms = settings.forms || {};

    return (
      settings.invoiceSettings ||
      settings.invoice ||
      forms.invoiceSettingsForm ||
      {}
    );
  }

  function populateInvoiceSettings() {
    if (state.dirty.has("invoiceSettingsForm")) return;

    const settings = readSections().invoiceSettings;

    assignInput("invoicePrefixInput", getFieldValue(settings, [
      "invoicePrefix",
      "prefix"
    ]));

    assignInput("invoiceFooterInput", storedValue(settings, [
      "invoiceFooter",
      "footerText",
      "footer"
    ]));

    assignInput("thankYouMessageInput", storedValue(settings, [
      "thankYouMessage",
      "invoiceThankYouMessage"
    ]));

    assignInput("termsLine1Input", storedValue(settings, [
      "termsLine1",
      "invoiceTermsLine1"
    ]));

    assignInput("termsLine2Input", storedValue(settings, [
      "termsLine2",
      "invoiceTermsLine2"
    ]));

    assignInput("authorisedSignatoryInput", storedValue(settings, [
      "authorisedSignatory",
      "authorizedSignatory",
      "signatureLabel"
    ]));

    assignInput("dailySalesTargetInput", getFieldValue(settings, [
      "dailySalesTarget",
      "dailyTarget"
    ]));
  }

  function buildInvoiceSettings() {
    const prefix = textValue($("invoicePrefixInput")?.value);
    const footer = textValue($("invoiceFooterInput")?.value);

    const thankYouMessage = textValue($("thankYouMessageInput")?.value);
    const termsLine1 = textValue($("termsLine1Input")?.value);
    const termsLine2 = textValue($("termsLine2Input")?.value);
    const authorisedSignatory = textValue(
      $("authorisedSignatoryInput")?.value
    );

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

        throw new Error(
          "Enter a valid non-negative daily sales target."
        );
      }
    }

    const result = {
      ...getExistingInvoiceSettings(),
      ...makeMetadata(),

      invoicePrefix: prefix,
      invoiceFooter: footer,
      thankYouMessage: thankYouMessage,
      termsLine1: termsLine1,
      termsLine2: termsLine2,
      authorisedSignatory: authorisedSignatory
    };

    delete result.invoiceThankYouMessage;
    delete result.invoiceTermsLine1;
    delete result.invoiceTermsLine2;
    delete result.authorizedSignatory;
    delete result.signatureLabel;
    delete result.dailyTarget;

    if (dailySalesTarget !== null) {
      result.dailySalesTarget = dailySalesTarget;
    } else {
      delete result.dailySalesTarget;
    }

    return result;
  }

  /* ---------------------------------------------------------
     7. Tax and discount
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
     8. Payment settings
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
    const accountName = textValue($("paymentAccountNameInput")?.value);

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
     9. Dynamic branding
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

    document.querySelectorAll("[data-business-name]").forEach((node) => {
      node.textContent = name;
    });

    document.querySelectorAll("[data-business-tagline]").forEach((node) => {
      node.textContent = tagline;
    });

    setText("sidebarBusinessName", name);
    setText("sidebarBusinessTagline", tagline);
    setText("businessFooterName", name);

    const mark = $("brandMark");

    if (mark) {
      mark.textContent = name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((word) => word.charAt(0).toUpperCase())
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
     10. Populate clean forms and dirty tracking
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
    ].forEach((id) => {
      const form = $(id);
      if (!form) return;

      form.addEventListener("input", () => markFormDirty(form));
      form.addEventListener("change", () => markFormDirty(form));
    });
  }

  /* ---------------------------------------------------------
     11. Save settings section
     --------------------------------------------------------- */

  async function saveSection(
    formId,
    sectionKey,
    builder,
    messageId,
    buttonId
  ) {
    if (state.busy.has(formId)) return;

    showMessage(messageId, "");

    let record;

    try {
      requireOwner();

      if (!state.ready || !state.loaded) {
        throw new Error(
          "Settings are still loading. Please try again."
        );
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
    const originalLabel = button ? button.textContent : "";

    if (button) {
      button.disabled = true;
      button.textContent = "Saving...";
    }

    if (form) form.setAttribute("aria-busy", "true");

    setStatus("Saving " + sectionKey + "...", "warning");

    try {
      requireOwner();

      const targetRef = state.api.ref(
        state.db,
        SETTINGS_PATH + "/" + sectionKey
      );

      if (sectionKey === "businessProfile") {
        const address = textValue(record.businessAddress);
        const mapsURL = textValue(record.businessMapsUrl);
        const coordinates = readCoordinates(record);

        const locationConfigured = Boolean(address || mapsURL);

        const locationRecord = {
          recordType: "business-location",
          recordStatus: locationConfigured
            ? "configured"
            : "not-configured",
          verificationId: "businessLocation",
          businessName: textValue(record.businessName),
          businessAddress: address,
          businessMapsUrl: mapsURL,
          businessLatitude: coordinates
            ? coordinates.latitude
            : null,
          businessLongitude: coordinates
            ? coordinates.longitude
            : null,
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now()
        };

        const updates = {};

        updates[SETTINGS_PATH + "/" + sectionKey] = record;
        updates[PUBLIC_LOCATION_PATH] = locationRecord;

        /*
         * Keep the existing atomic save:
         * Business Profile and public location record save together.
         */
        await state.api.update(
          state.api.ref(state.db),
          updates
        );

      } else {
        await state.api.set(targetRef, record);
      }

      state.settings[sectionKey] = record;
      state.dirty.delete(formId);

      populateCleanForms();

      showMessage(
        messageId,
        "Settings saved successfully.",
        "success"
      );

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
        code: error && error.code
          ? error.code
          : "settings-save-error"
      });

      const message =
        error && (
          error.code === "PERMISSION_DENIED" ||
          error.code === "permission-denied"
        )
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

      if (form) form.removeAttribute("aria-busy");
    }
  }

  /* ---------------------------------------------------------
     12. Manual refresh
     --------------------------------------------------------- */

  async function refreshSettingsPage() {
    if (state.disposed || !state.db || !state.api) {
      throw new Error("Settings page is not ready to refresh.");
    }

    requireOwner();

    if (state.busy.size > 0) {
      throw new Error(
        "A settings save is in progress. Refresh after it finishes."
      );
    }

    if (typeof state.api.get !== "function") {
      throw new Error("Firebase settings refresh is unavailable.");
    }

    setStatus("Refreshing saved settings...", "warning");

    /*
     * Read the existing settings root only.
     * No extra realtime listener is created.
     * Do not replace the local state until the read succeeds.
     */
    const snapshot = await state.api.get(
      state.api.ref(state.db, SETTINGS_PATH)
    );

    if (state.disposed) return;

    const data = snapshot.exists() ? snapshot.val() : {};

    state.settings =
      data && typeof data === "object"
        ? data
        : {};

    state.loaded = true;
    state.ready = true;

    /*
     * The populate functions skip any form marked dirty.
     * Therefore unsaved fields are not overwritten by Refresh.
     */
    populateCleanForms();

    setStatus(
      state.dirty.size
        ? "Latest saved settings loaded. Unsaved form changes were preserved."
        : "Settings refreshed and synchronized.",
      "connected"
    );

    setText("sidebarConnectionStatus", "Database connected");
    setText("settingsFooterStatus", "Settings refreshed");

    if (!state.dirty.size) {
      setText("settingsSaveStatus", "Settings are synchronized.");
    } else {
      setText(
        "settingsSaveStatus",
        "Some forms have unsaved changes."
      );
    }

    document.dispatchEvent(
      new CustomEvent("restaurant-settings-updated", {
        detail: {
          section: "refresh",
          settings: state.settings
        }
      })
    );
  }

  /* ---------------------------------------------------------
     13. Live database subscription
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

        const data = snapshot.exists() ? snapshot.val() : {};

        state.settings =
          data && typeof data === "object"
            ? data
            : {};

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

        // Reveal the populated forms after the initial data arrives.
        revealSettingsPage();
      },

      function (error) {
        if (state.disposed) return;

        console.error("Settings database read failed:", {
          code: error && error.code
            ? error.code
            : "unknown"
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

        // Do not keep the loading animation running after an error.
        revealSettingsPage();
      }
    );

    if (typeof unsubscribe === "function") {
      state.subscriptions.push(unsubscribe);
    }
  }

  /* ---------------------------------------------------------
     14. Initialize protected Settings page
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
        throw new Error(
          "Only the authorized owner can access settings."
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
          firebase.error?.message ||
          "Firebase initialization failed."
        );
      }

      const connected = getFirebase();

      state.db = connected.db;
      state.api = connected.api;

      /*
       * Register the safe page-specific handler after
       * authentication and Firebase initialization.
       */
      if (
        ui &&
        typeof ui.registerPageRefresh === "function"
      ) {
        state.unregisterPageRefresh =
          ui.registerPageRefresh(refreshSettingsPage);
      }

      bindDirtyTracking();
      bindMapPicker();
      subscribeSettings();

    } catch (error) {
      if (state.disposed) return;

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

      setText(
        "settingsSaveStatus",
        "Settings could not be initialized."
      );

      setText("sidebarConnectionStatus", "Connection error");

      // Authentication/Firebase errors must not leave a spinner behind.
      finishSettingsLoadingImmediately();
    }
  }

  /* ---------------------------------------------------------
     15. Bind save forms
     --------------------------------------------------------- */

  $("businessProfileForm")?.addEventListener(
    "submit",
    function (event) {
      event.preventDefault();

      saveSection(
        "businessProfileForm",
        "businessProfile",
        buildBusinessProfile,
        "businessProfileMessage",
        "saveBusinessProfileBtn"
      );
    }
  );

  $("invoiceSettingsForm")?.addEventListener(
    "submit",
    function (event) {
      event.preventDefault();

      saveSection(
        "invoiceSettingsForm",
        "invoiceSettings",
        buildInvoiceSettings,
        "invoiceSettingsMessage",
        "saveInvoiceSettingsBtn"
      );
    }
  );

  $("taxSettingsForm")?.addEventListener(
    "submit",
    function (event) {
      event.preventDefault();

      saveSection(
        "taxSettingsForm",
        "taxSettings",
        buildTaxSettings,
        "taxSettingsMessage",
        "saveTaxSettingsBtn"
      );
    }
  );

  $("paymentSettingsForm")?.addEventListener(
    "submit",
    function (event) {
      event.preventDefault();

      saveSection(
        "paymentSettingsForm",
        "paymentSettings",
        buildPaymentSettings,
        "paymentSettingsMessage",
        "savePaymentSettingsBtn"
      );
    }
  );

  /* ---------------------------------------------------------
     16. Cleanup
     --------------------------------------------------------- */

  window.addEventListener("pagehide", function () {
    state.disposed = true;

    clearTimeout(state.revealTimer);
    state.revealTimer = null;

    state.subscriptions.forEach((unsubscribe) => {
      try {
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      } catch (_) {
        /* Listener cleanup */
      }
    });

    state.subscriptions = [];

    if (typeof state.unregisterPageRefresh === "function") {
      state.unregisterPageRefresh();
      state.unregisterPageRefresh = null;
    }

    if (state.map) {
      state.map.remove();
      state.map = null;
      state.marker = null;
      state.mapInitialized = false;
    }
  });

  initialize();

})();
