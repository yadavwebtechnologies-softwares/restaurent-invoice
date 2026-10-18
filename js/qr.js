/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Real QR Code Generator
   Compatible with invoice.js
   No API keys, secrets or fake QR patterns
   ========================================================= */

(function () {
  "use strict";

  const CDN_SOURCES = [
    "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"
  ];

  let libraryPromise = null;

  /* ---------------------------------------------------------
     1. Load QR library from a pinned public CDN
     --------------------------------------------------------- */

  function loadQRLibrary() {
    if (
      window.QRCode &&
      typeof window.QRCode === "function"
    ) {
      return Promise.resolve(window.QRCode);
    }

    if (libraryPromise) {
      return libraryPromise;
    }

    libraryPromise = new Promise(function (resolve, reject) {
      let sourceIndex = 0;

      function tryNextSource() {
        if (
          window.QRCode &&
          typeof window.QRCode === "function"
        ) {
          resolve(window.QRCode);
          return;
        }

        if (sourceIndex >= CDN_SOURCES.length) {
          reject(
            new Error(
              "QR library could not load. Check your internet connection."
            )
          );

          return;
        }

        const source = CDN_SOURCES[sourceIndex++];
        const script = document.createElement("script");

        script.src = source;
        script.async = true;
        script.crossOrigin = "anonymous";
        script.dataset.restaurantQrLibrary = "true";

        script.onload = function () {
          if (
            window.QRCode &&
            typeof window.QRCode === "function"
          ) {
            resolve(window.QRCode);
          } else {
            script.remove();
            tryNextSource();
          }
        };

        script.onerror = function () {
          script.remove();
          tryNextSource();
        };

        document.head.appendChild(script);
      }

      tryNextSource();
    }).catch(function (error) {
      /*
       * Permit a later retry if both CDN requests fail.
       */
      libraryPromise = null;
      throw error;
    });

    return libraryPromise;
  }

  /* ---------------------------------------------------------
     2. Validate inputs
     --------------------------------------------------------- */

  function validate(container, payload, options) {
    if (!(container instanceof HTMLElement)) {
      throw new TypeError("A valid QR container element is required.");
    }

    if (typeof payload !== "string" || !payload.trim()) {
      throw new TypeError("QR payload must be a non-empty string.");
    }

    if (payload.length > 2900) {
      throw new RangeError(
        "QR payload is too large. Use a shorter URL or verification reference."
      );
    }

    const width = Number(options.width || 108);
    const height = Number(options.height || 108);

    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 64 ||
      height < 64 ||
      width > 1024 ||
      height > 1024
    ) {
      throw new RangeError("QR dimensions must be between 64 and 1024 pixels.");
    }

    return {
      width: Math.round(width),
      height: Math.round(height)
    };
  }

  /* ---------------------------------------------------------
     3. Render a real QR code
     --------------------------------------------------------- */

  async function generate(container, payload, options) {
    const settings = options || {};
    const dimensions = validate(container, payload, settings);

    const QRCodeLibrary = await loadQRLibrary();

    /*
     * Remove any QR code from a previous invoice preview.
     */
    container.replaceChildren();

    const qrHost = document.createElement("div");
    qrHost.className = "qr-rendered-content";

    container.appendChild(qrHost);

    const correctionLevels = QRCodeLibrary.CorrectLevel || {};

    try {
      new QRCodeLibrary(qrHost, {
        text: payload,
        width: dimensions.width,
        height: dimensions.height,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel:
          correctionLevels.M !== undefined
            ? correctionLevels.M
            : correctionLevels.L
      });
    } catch (error) {
      container.replaceChildren();
      throw new Error("QR code generation failed.");
    }

    /*
     * The QR library renders an actual image/canvas,
     * not a static decorative placeholder.
     */
    const renderedCode = qrHost.querySelector("canvas, img");

    if (!renderedCode) {
      container.replaceChildren();
      throw new Error("QR code output could not be rendered.");
    }

    return {
      container: container,
      payloadLength: payload.length,
      width: dimensions.width,
      height: dimensions.height,
      element: renderedCode
    };
  }

  /* ---------------------------------------------------------
     4. Public interface for invoice.js
     --------------------------------------------------------- */

  window.restaurantQR = Object.freeze({
    generate: generate
  });

})();
