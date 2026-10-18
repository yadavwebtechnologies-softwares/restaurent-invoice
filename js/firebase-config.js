/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Firebase Configuration and Initialization
   Configuration source: Cloudflare Worker
   No hardcoded credentials or secrets
   ========================================================= */

(function () {
  "use strict";

  const WORKER_CONFIG_URL =
    "https://restaurant-billing-config.yadavsubba2003.workers.dev/api/firebase-config";

  const FIREBASE_SDK_VERSION = "12.19.0";

  const state = {
    app: null,
    auth: null,
    db: null,
    sdk: null,
    error: null,
    ready: false,
    initialized: false
  };

  /*
   * Publish the shared state before initialization,
   * so other scripts can wait for state.readyPromise.
   */
  window.restaurantFirebase = state;

  function getConfigFromResponse(payload) {
    if (!payload || typeof payload !== "object") {
      throw new Error("Worker returned an invalid configuration response.");
    }

    const candidates = [
      payload.firebaseConfig,
      payload.config,
      payload.data?.firebaseConfig,
      payload.data?.config,
      payload.data,
      payload
    ];

    const config = candidates.find(function (candidate) {
      return (
        candidate &&
        typeof candidate === "object" &&
        typeof candidate.apiKey === "string" &&
        typeof candidate.authDomain === "string" &&
        typeof candidate.projectId === "string" &&
        typeof candidate.databaseURL === "string" &&
        typeof candidate.appId === "string"
      );
    });

    if (!config) {
      throw new Error(
        "Worker response is missing required Firebase Web Configuration fields."
      );
    }

    return {
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      databaseURL: config.databaseURL,
      projectId: config.projectId,
      appId: config.appId,
      ...(config.storageBucket
        ? { storageBucket: config.storageBucket }
        : {}),
      ...(config.messagingSenderId
        ? { messagingSenderId: config.messagingSenderId }
        : {})
    };
  }

  async function fetchFirebaseConfig() {
    const response = await fetch(WORKER_CONFIG_URL, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(
        "Cloudflare Worker configuration request failed with HTTP " +
        response.status + "."
      );
    }

    let payload;

    try {
      payload = await response.json();
    } catch {
      throw new Error(
        "Cloudflare Worker did not return valid JSON."
      );
    }

    return getConfigFromResponse(payload);
  }

  async function loadFirebaseSDK() {
    const base =
      "https://www.gstatic.com/firebasejs/" +
      FIREBASE_SDK_VERSION + "/";

    const [appSDK, authSDK, databaseSDK] = await Promise.all([
      import(base + "firebase-app.js"),
      import(base + "firebase-auth.js"),
      import(base + "firebase-database.js")
    ]);

    return {
      app: appSDK,
      auth: authSDK,
      database: databaseSDK
    };
  }

  async function initializeFirebase() {
    try {
      state.error = null;
      state.ready = false;

      /*
       * Load configuration through the existing Worker.
       * Firebase client configuration is not an Admin secret.
       */
      const firebaseConfig = await fetchFirebaseConfig();

      const sdk = await loadFirebaseSDK();

      const existingApps = sdk.app.getApps();

      state.app = existingApps.length
        ? sdk.app.getApp()
        : sdk.app.initializeApp(firebaseConfig);

      state.auth = sdk.auth.getAuth(state.app);
      state.db = sdk.database.getDatabase(state.app);

      /*
       * Shared SDK interface for page-specific scripts.
       * Use the same Firebase app, auth instance and database
       * throughout this website.
       */
      state.sdk = {
        app: sdk.app,
        auth: {
          ...sdk.auth
        },
        database: {
          ...sdk.database
        }
      };

      state.initialized = true;
      state.ready = true;

      document.dispatchEvent(
        new CustomEvent("restaurant-firebase-ready")
      );

      return true;

    } catch (error) {
      state.error = {
        message: error instanceof Error
          ? error.message
          : "Firebase initialization failed."
      };

      state.initialized = false;
      state.ready = false;

      document.dispatchEvent(
        new CustomEvent("restaurant-firebase-error", {
          detail: {
            message: state.error.message
          }
        })
      );

      return false;
    }
  }

  /*
   * A single initialization promise avoids multiple
   * Firebase initialization attempts from page scripts.
   */
  state.readyPromise = initializeFirebase();

})();
