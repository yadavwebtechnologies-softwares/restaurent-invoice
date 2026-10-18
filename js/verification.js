/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Public Invoice Verification
   Verification must be confirmed by the Cloudflare API.
   Never trust the QR URL alone.
   ========================================================= */

(function () {
  "use strict";

  const API_URL =
    "https://restaurant-billing-config.yadavsubba2003.workers.dev/api/verify-invoice";

  const $ = (id) => document.getElementById(id);

  let requestController = null;

  function setText(id, value) {
    const element = $(id);
    if (element) {
      element.textContent = value === null || value === undefined
        ? ""
        : String(value);
    }
  }

  function showSection(id, visible) {
    const element = $(id);
    if (element) element.hidden = !visible;
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

  function formatMoney(value) {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount < 0) {
      return "Not Available";
    }

    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function formatDate(value) {
    if (!value) return "Not Available";

    const raw = String(value);

    // Invoice dates are stored as YYYY-MM-DD.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);

    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);

      const date = new Date(year, month - 1, day);

      if (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
      ) {
        return new Intl.DateTimeFormat("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }).format(date);
      }

      return "Not Available";
    }

    const date = new Date(raw);

    if (Number.isNaN(date.getTime())) {
      return "Not Available";
    }

    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    }).format(date);
  }

  function renderVerifiedInvoice(invoice) {
    setText(
      "verifiedBusinessName",
      invoice.businessName || "Not Available"
    );

    setText(
      "verifiedInvoiceNumber",
      invoice.invoiceNumber || "Not Available"
    );

    setText(
      "verifiedInvoiceDate",
      formatDate(invoice.invoiceDate)
    );

    setText(
      "verifiedGrandTotal",
      formatMoney(invoice.grandTotal)
    );

    setText(
      "verifiedPaymentStatus",
      invoice.paymentStatus || "Not Available"
    );

    setText("verifiedRecordStatus", "Valid");

    showSection("verificationDetails", true);
    showSection("verificationHelp", false);

    setStatus(
      "success",
      "Invoice Verified",
      "The verification service confirmed this invoice record."
    );
  }

  function showNotVerified(message) {
    showSection("verificationDetails", false);

    setStatus(
      "error",
      "Invoice Not Verified",
      message || "The service could not confirm this invoice."
    );

    showHelp(
      "Check that the QR code is complete, or contact the business " +
      "that issued the invoice."
    );
  }

  async function verifyInvoice() {
    showSection("verificationDetails", false);
    showSection("verificationHelp", false);

    setStatus(
      "checking",
      "Checking Invoice",
      "Contacting the verification service..."
    );

    const params = new URLSearchParams(window.location.search);
    const invoiceId = (params.get("invoice") || "").trim();

    /*
     * Firebase-generated keys normally use letters, digits,
     * hyphens and underscores. Reject unexpected query values.
     */
    if (
      !invoiceId ||
      invoiceId.length > 128 ||
      !/^[A-Za-z0-9_-]+$/.test(invoiceId)
    ) {
      showNotVerified(
        "The verification link is missing or contains an invalid invoice ID."
      );
      return;
    }

    if (!window.fetch || !window.AbortController) {
      setStatus(
        "error",
        "Verification Unavailable",
        "This browser does not support the required verification request."
      );

      showHelp("Open the invoice link in an updated browser.");
      return;
    }

    if (requestController) {
      requestController.abort();
    }

    requestController = new AbortController();

    const timeoutId = window.setTimeout(() => {
      requestController?.abort();
    }, 15000);

    try {
      const endpoint = new URL(API_URL);
      endpoint.searchParams.set("invoice", invoiceId);

      const response = await window.fetch(endpoint.href, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: requestController.signal
      });

      if (!response.ok) {
        throw new Error("verification-service-unavailable");
      }

      const result = await response.json();

      /*
       * A successful HTTP response alone is not enough.
       * The API must explicitly confirm the invoice.
       */
      if (result?.verified !== true || !result.invoice) {
        showNotVerified(
          "No verified invoice record was returned for this QR code."
        );
        return;
      }

      const invoice = result.invoice;

      /*
       * Display only the fields used by this public page.
       * The service should return a minimal, safe response.
       */
      if (
        typeof invoice.invoiceNumber !== "string" ||
        invoice.recordStatus !== "valid" ||
        !Number.isFinite(Number(invoice.grandTotal)) ||
        Number(invoice.grandTotal) < 0
      ) {
        showNotVerified(
          "The returned record did not meet verification requirements."
        );
        return;
      }

      renderVerifiedInvoice(invoice);

    } catch (error) {
      console.error(
        "Invoice verification request failed:",
        error && error.name === "AbortError"
          ? "Request timed out or was cancelled."
          : "Verification service request failed."
      );

      showSection("verificationDetails", false);

      setStatus(
        "warning",
        "Verification Service Unavailable",
        "The invoice could not be verified right now. No authenticity " +
        "confirmation has been given."
      );

      showHelp(
        "Try again later. If the problem continues, contact the business " +
        "that issued the invoice."
      );

    } finally {
      window.clearTimeout(timeoutId);
      requestController = null;
    }
  }

  verifyInvoice();

})();
