
"use strict";

/**
 * Restaurant Billing Software
 * Shared Firebase configuration and services.
 *
 * Loads public Firebase configuration from Cloudflare Worker.
 * Initializes one shared Firebase App, Authentication and Realtime Database.
 * Makes the Firebase SDK modules available to page-specific scripts.
 */

(() => {
  // Reuse the shared service if this file has already executed.
  if (window.restaurantFirebase?.ready) {
    return;
  }

  const CONFIG_URL =
    "https://restaurant-billing-config.yadavsubba2003.workers.dev/api/firebase-config";

  const SDK_VERSION = "12.19.0";

  const SDK_BASE =
    `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

  const firebaseServices = {
    app: null,
    auth: null,
    db: null,
    config: null,
    sdk: null,
    error: null,
    ready: null
  };

  window.restaurantFirebase = firebaseServices;

  firebaseServices.ready = (async () => {
    try {
      // Load Firebase configuration from the Cloudflare Worker.
      const response = await fetch(CONFIG_URL, {
        method: "GET",
        headers: {
          Accept: "application/json"
        },
        cache: "no-store"
      });

      if (!response.ok) {
        throw new Error(
          `Firebase configuration request failed: HTTP ${response.status}`
        );
      }

      const firebaseConfig = await response.json();

      const requiredFields = [
        "apiKey",
        "authDomain",
        "databaseURL",
        "projectId",
        "appId"
      ];

      const missingFields = requiredFields.filter(
        field =>
          typeof firebaseConfig[field] !== "string" ||
          !firebaseConfig[field].trim()
      );

      if (missingFields.length > 0) {
        throw new Error(
          `Missing Firebase configuration fields: ${missingFields.join(", ")}`
        );
      }

      // Load all Firebase modules from the same SDK version.
      const [
        appSDK,
        authSDK,
        databaseSDK
      ] = await Promise.all([
        import(`${SDK_BASE}/firebase-app.js`),
        import(`${SDK_BASE}/firebase-auth.js`),
        import(`${SDK_BASE}/firebase-database.js`)
      ]);

      // Reuse the default app if it was already initialized.
      const existingApps = appSDK.getApps();

      const app = existingApps.find(
        existingApp => existingApp.name === "[DEFAULT]"
      ) || appSDK.initializeApp(firebaseConfig);

      // Initialize shared Auth and Realtime Database services.
      const auth = authSDK.getAuth(app);
      const db = databaseSDK.getDatabase(app);

      // Expose the shared instances.
      firebaseServices.app = app;
      firebaseServices.auth = auth;
      firebaseServices.db = db;
      firebaseServices.config = firebaseConfig;

      // Share the SDK functions so page-specific files do not
      // need to initialize a separate Firebase App.
      firebaseServices.sdk = {
        app: appSDK,
        auth: authSDK,
        database: databaseSDK
      };

      console.info(
        "Restaurant Billing: shared Firebase services initialized.",
        {
          projectId: firebaseConfig.projectId,
          sdkVersion: SDK_VERSION
        }
      );

      window.dispatchEvent(
        new CustomEvent("restaurant-firebase-ready", {
          detail: {
            app,
            auth,
            db,
            config: firebaseConfig,
            sdk: firebaseServices.sdk
          }
        })
      );

      return firebaseServices;
    } catch (error) {
      firebaseServices.error = error;

      console.error(
        "Restaurant Billing: Firebase initialization failed.",
        error
      );

      window.dispatchEvent(
        new CustomEvent("restaurant-firebase-error", {
          detail: { error }
        })
      );

      return null;
    }
  })();
})();
