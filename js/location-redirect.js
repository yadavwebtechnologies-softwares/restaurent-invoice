/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Restaurant Location Redirect
   Firebase path:
   publicInvoiceVerification/businessLocation

   Priority:
   1. Saved Google Maps URL
   2. Saved business address
   3. Show a safe error
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

  function setMapsLink(url) {
    const link = $("openGoogleMaps");
    if (!link) return;

    link.href = url;
    link.hidden = false;
  }

  function validateGoogleMapsURL(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    let url;

    try {
      url = new URL(value.trim());
    } catch (_) {
      return null;
    }

    if (url.protocol !== "https:") {
      return null;
    }

    const host = url.hostname.toLowerCase();

    const isGoogleMapsDomain =
      host === "google.com" ||
      host.endsWith(".google.com");

    const isMapsShortLink =
      host === "maps.app.goo.gl" ||
      (host === "goo.gl" && url.pathname.startsWith("/maps/"));

    if (isGoogleMapsDomain) {
      if (!url.pathname.toLowerCase().startsWith("/maps")) {
        return null;
      }

      return url.href;
    }

    if (isMapsShortLink) {
      return url.href;
    }

    return null;
  }

  function createMapsSearchURL(address) {
    const value = String(address ?? "").trim();

    if (!value || value.length > 500) {
      return null;
    }

    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", value);

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
        record.recordStatus !== "configured"
      ) {
        throw new Error("Saved restaurant location is invalid.");
      }

      const businessName =
        typeof record.businessName === "string"
          ? record.businessName.trim().slice(0, 150)
          : "";

      const address =
        typeof record.businessAddress === "string"
          ? record.businessAddress.trim()
          : "";

      const savedMapsURL = validateGoogleMapsURL(
        record.businessMapsUrl
      );

      const mapsURL =
        savedMapsURL ||
        createMapsSearchURL(address);

      if (!mapsURL) {
        throw new Error(
          "No valid Google Maps URL or business address is saved."
        );
      }

      setText(
        "locationBusinessName",
        businessName || "Find Our Restaurant"
      );

      setText("locationAddress", address || "Restaurant location selected on map.");

      setMapsLink(mapsURL);
      setStatus("Opening restaurant location in Google Maps...");

      window.location.assign(mapsURL);

    } catch (error) {
      console.error(
        "Business location loading failed:",
        error instanceof Error ? error.message : "Unknown error"
      );

      setStatus(
        "Unable to open the restaurant location. Please contact the business."
      );
    }
  }

  loadBusinessLocation();

})();
