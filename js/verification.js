/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Direct Firebase Invoice Verification
   Database: publicInvoiceVerification/{verificationId}

   No Cloudflare Worker call.
   No secret key.
   Verification fails closed.
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";

  const VERIFICATION_PATH = "publicInvoiceVerification";

  const $ = (id) => document.getElementById(id);

  /* ---------------------------------------------------------
     1. Safe UI helpers
     --------------------------------------------------------- */

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent =
        value === null || value === undefined
          ? ""
          : String(value);
    }
  }

  function showSection(id, visible) {
    const element = $(id);

    if (element) {
      element.hidden = !visible;
    }
  }

  function setStatus(type, title, message) {
    const status = $("verificationStatus");

    if (status) {
      status.classList.remove(
        "verification-status-checking",
        "verification-status-success",
        "verification-status-error",
        "verification-status-warning"
      );

      status.classList.add("verification-status-" + type);
    }

    setText("verificationStatusTitle", title);
    setText("verificationStatusMessage", message);
  }

  function showHelp(message) {
    setText("verificationHelpMessage", message);
    showSection("verificationHelp", true);
  }

  /* ---------------------------------------------------------
     2. Display formatting
     --------------------------------------------------------- */

  function formatMoney(value) {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      return "Not Available";
    }

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  }

  function formatDate(value) {
    if (typeof value !== "string") {
      return "Not Available";
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

    if (!match) {
      return "Not Available";
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    const date = new Date(Date.UTC(year, month - 1, day));

    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return "Not Available";
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC"
    }).format(date);
  }

  /* ---------------------------------------------------------
     3. Validate QR invoice ID
     --------------------------------------------------------- */

  function getVerificationId() {
    const params = new URLSearchParams(window.location.search);
    const invoiceId = (params.get("invoice") || "").trim();

    if (
      !invoiceId ||
      invoiceId.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(invoiceId)
    ) {
      return null;
    }

    return invoiceId;
  }

  /* ---------------------------------------------------------
     4. Firebase initialization
     --------------------------------------------------------- */

  async function getFirebaseDatabase() {
    const firebase = window.restaurantFirebase;

    if (!firebase || !firebase.readyPromise) {
      throw new Error("firebase-not-initialized");
    }

    const initialized = await firebase.readyPromise;

    if (
      !initialized ||
      !firebase.ready ||
      !firebase.db ||
      !firebase.sdk ||
      !firebase.sdk.database
    ) {
      throw new Error("firebase-unavailable");
    }

    const api = firebase.sdk.database;

    if (
      typeof api.ref !== "function" ||
      typeof api.get !== "function"
    ) {
      throw new Error("firebase-read-api-unavailable");
    }

    return {
      db: firebase.db,
      api: api
    };
  }

  /* ---------------------------------------------------------
     5. Read one verification record
     --------------------------------------------------------- */

  async function readVerificationRecord(invoiceId) {
    const firebase = await getFirebaseDatabase();

    const path =
      VERIFICATION_PATH + "/" + invoiceId;

    const reference = firebase.api.ref(
      firebase.db,
      path
    );

    const snapshot = await firebase.api.get(reference);

    if (!snapshot.exists()) {
      return null;
    }

    const record = snapshot.val();

    if (
      !record ||
      typeof record !== "object" ||
      Array.isArray(record)
    ) {
      return null;
    }

    return record;
  }

  /* ---------------------------------------------------------
     6. Validate the saved record
     --------------------------------------------------------- */

  function isValidVerificationRecord(record, invoiceId) {
    if (!record || typeof record !== "object") {
      return false;
    }

    /*
     * The verification ID must match the requested database key.
     */
    if (record.verificationId !== invoiceId) {
      return false;
    }

    /*
     * This must belong to the authorized restaurant software owner.
     */
    if (record.ownerUid !== OWNER_UID) {
      return false;
    }

    /*
     * Reject void, cancelled, missing or unknown record states.
     */
    if (record.recordStatus !== "valid") {
      return false;
    }

    if (
      typeof record.businessName !== "string" ||
      !record.businessName.trim()
    ) {
      return false;
    }

    if (
      typeof record.invoiceNumber !== "string" ||
      !record.invoiceNumber.trim()
    ) {
      return false;
    }

    if (!formatDate(record.invoiceDate) ||
        formatDate(record.invoiceDate) === "Not Available") {
      return false;
    }

    if (
      typeof record.grandTotal !== "number" ||
      !Number.isFinite(record.grandTotal) ||
      record.grandTotal < 0
    ) {
      return false;
    }

    if (
      typeof record.paymentStatus !== "string" ||
      !record.paymentStatus.trim()
    ) {
      return false;
    }

    return true;
  }

  /* ---------------------------------------------------------
     7. Display the verified fields only
     --------------------------------------------------------- */

  function renderVerifiedRecord(record) {
    setText(
      "verifiedBusinessName",
      record.businessName
    );

    setText(
      "verifiedInvoiceNumber",
      record.invoiceNumber
    );

    setText(
      "verifiedInvoiceDate",
      formatDate(record.invoiceDate)
    );

    setText(
      "verifiedGrandTotal",
      formatMoney(record.grandTotal)
    );

    setText(
      "verifiedPaymentStatus",
      record.paymentStatus
    );

    setText(
      "verifiedRecordStatus",
      "Valid"
    );

    showSection("verificationDetails", true);
    showSection("verificationHelp", false);

    setStatus(
      "success",
      "Invoice Verified",
      "A matching invoice verification record was found in Firebase."
    );
  }

  /* ---------------------------------------------------------
     8. Not-found and error states
     --------------------------------------------------------- */

  function showNotVerified() {
    showSection("verificationDetails", false);

    setStatus(
      "error",
      "Invoice Not Verified",
      "No matching valid verification record was found."
    );

    showHelp(
      "Check the QR code or contact the business that issued the invoice."
    );
  }

  function showServiceError() {
    showSection("verificationDetails", false);

    setStatus(
      "warning",
      "Verification Unavailable",
      "Firebase could not confirm this invoice. No verification success is claimed."
    );

    showHelp(
      "Check your internet connection and try again later."
    );
  }

  /* ---------------------------------------------------------
     9. Main verification
     --------------------------------------------------------- */

  async function verifyInvoice() {
    showSection("verificationDetails", false);
    showSection("verificationHelp", false);

    setStatus(
      "checking",
      "Checking Invoice",
      "Connecting to Firebase..."
    );

    const invoiceId = getVerificationId();

    if (!invoiceId) {
      showNotVerified();
      return;
    }

    try {
      const record = await readVerificationRecord(invoiceId);

      if (!record) {
        showNotVerified();
        return;
      }

      if (!isValidVerificationRecord(record, invoiceId)) {
        showNotVerified();
        return;
      }

      renderVerifiedRecord(record);

    } catch (error) {
      /*
       * Do not expose database configuration or internal errors
       * to public visitors.
       */
      console.error(
        "Invoice verification failed:",
        error && error.message
          ? error.message
          : "Unknown error"
      );

      showServiceError();
    }
  }

  /* ---------------------------------------------------------
     10. Start
     --------------------------------------------------------- */

  verifyInvoice();

})();
