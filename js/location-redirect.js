/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Google Maps Location Redirect
   Firebase path:
   publicInvoiceVerification/businessLocation

   No Cloudflare Worker changes.
   No API keys or secrets in this file.
   ========================================================= */

(function () {
  "use strict";

  const LOCATION_PATH =
    "publicInvoiceVerification/businessLocation";

  const $ = (id) => document.getElementById(id);

  function setText(id, value) {
    const element = $(id);
    if (element) {
      element.textContent = String(value ?? "");
    }
  }

  function setStatus(message) {
    setText("locationStatus", message);
  }

  function showMapsLink(url) {
    const link = $("openGoogleMaps");
    if (!link) return;

    link.href = url;
    link.hidden = false;
  }

  function buildMapsURL(address) {
    const url = new URL("https://www.google.com/maps/search/");

    url.searchParams.set("api", "1");
    url.searchParams.set("query", address);

    return url.href;
  }

  async function loadBusinessLocation() {
    setStatus("Loading restaurant location...");

    try {
      const firebase = window.restaurantFirebase;

      if (!firebase || !firebase.readyPromise) {
        throw new Error("Firebase configuration is unavailable.");
      }

      const initialized = await firebase.readyPromise;

      if (
        !initialized ||
        !firebase.ready ||
        !firebase.db ||
        !firebase.sdk ||
        !firebase.sdk.database
      ) {
        throw new Error("Firebase connection is unavailable.");
      }

      const api = firebase.sdk.database;

      if (
        typeof api.ref !== "function" ||
        typeof api.get !== "function"
      ) {
        throw new Error("Firebase read functionality is unavailable.");
      }

      const reference = api.ref(firebase.db, LOCATION_PATH);
      const snapshot = await api.get(reference);

      if (!snapshot.exists()) {
        throw new Error("Restaurant location has not been configured.");
      }

      const record = snapshot.val();

      if (
        !record ||
        typeof record !== "object" ||
        Array.isArray(record) ||
        record.recordType !== "business-location" ||
        record.verificationId !== "businessLocation" ||
        record.recordStatus !== "configured" ||
        typeof record.businessAddress !== "string"
      ) {
        throw new Error("Saved restaurant location is invalid.");
      }

      const address = record.businessAddress.trim();

      if (!address || address.length > 500) {
        throw new Error("A valid restaurant address was not found.");
      }

      const businessName =
        typeof record.businessName === "string"
          ? record.businessName.trim().slice(0, 150)
          : "";

      const mapsURL = buildMapsURL(address);

      setText(
        "locationBusinessName",
        businessName || "Find Our Restaurant"
      );

      setText("locationAddress", address);
      showMapsLink(mapsURL);
      setStatus("Opening restaurant location in Google Maps...");

      /*
       * Navigate to the Maps URL constructed from the saved address.
       * The database value is treated as address text, not as a URL.
       */
      window.setTimeout(function () {
        window.location.assign(mapsURL);
      }, 800);

    } catch (error) {
      console.error(
        "Business location loading failed:",
        error && error.message
          ? error.message
          : "Unknown error"
      );

      setStatus(
        "Unable to load the restaurant location. Please contact the business."
      );
    }
  }

  loadBusinessLocation();

})();
