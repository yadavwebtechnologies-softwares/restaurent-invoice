/* =========================================================
   RESTAURANT BILLING SOFTWARE
   Owner Authentication
   No registration, demo accounts or embedded secrets
   ========================================================= */

(function () {
  "use strict";

  const OWNER_UID = "20wif9y7LQhBZgFPDsAlrQpFjnI2";
  const DASHBOARD_URL = "dashboard.html";

  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("loginEmail");
  const passwordInput = document.getElementById("loginPassword");

  const submitButton = document.getElementById("loginSubmitBtn");
  const buttonLabel = document.getElementById("loginButtonLabel");
  const togglePasswordButton = document.getElementById("togglePassword");
  const forgotPasswordButton = document.getElementById("forgotPasswordBtn");

  const loginMessage = document.getElementById("loginMessage");
  const systemStatus = document.getElementById("authSystemStatus");
  const emailError = document.getElementById("loginEmailError");
  const passwordError = document.getElementById("loginPasswordError");

  if (!form || !emailInput || !passwordInput || !submitButton) {
    console.error("Authentication initialization failed: login form elements are missing.");
    return;
  }

  let authReady = false;
  let isSubmitting = false;
  let isRedirecting = false;
  let firebaseAuth = null;
  let firebaseSDK = null;

  function setMessage(message, type) {
    if (!loginMessage) return;

    loginMessage.textContent = message || "";
    loginMessage.classList.remove(
      "is-success",
      "is-error",
      "is-warning"
    );

    if (type) {
      loginMessage.classList.add("is-" + type);
    }
  }

  function setSystemStatus(message, type) {
    if (!systemStatus) return;

    systemStatus.textContent = message || "";
    systemStatus.classList.remove(
      "is-connected",
      "is-error",
      "is-warning"
    );

    if (type === "connected") {
      systemStatus.classList.add("is-connected");
    } else if (type === "error") {
      systemStatus.classList.add("is-error");
    } else if (type === "warning") {
      systemStatus.classList.add("is-warning");
    }
  }

  function setFieldError(field, message) {
    if (!field) return;

    field.textContent = message || "";
  }

  function clearFieldErrors() {
    setFieldError(emailError, "");
    setFieldError(passwordError, "");

    emailInput.removeAttribute("aria-invalid");
    passwordInput.removeAttribute("aria-invalid");
  }

  function setBusy(busy, label) {
    isSubmitting = busy;

    submitButton.disabled = busy || !authReady;
    emailInput.readOnly = busy;
    passwordInput.readOnly = busy;

    if (buttonLabel) {
      buttonLabel.textContent = label ||
        (busy ? "Please wait..." : "Sign In");
    }

    if (forgotPasswordButton) {
      forgotPasswordButton.disabled = busy || !authReady;
    }

    if (togglePasswordButton) {
      togglePasswordButton.disabled = busy;
    }
  }

  function getReadableAuthError(error, operation) {
    const code = error && error.code ? error.code : "";

    if (code.includes("network-request-failed")) {
      return "Network connection failed. Check your internet and try again.";
    }

    if (code.includes("too-many-requests")) {
      return "Too many attempts. Please wait before trying again.";
    }

    if (code.includes("invalid-credential") ||
        code.includes("invalid-login-credentials") ||
        code.includes("user-not-found") ||
        code.includes("wrong-password")) {
      return "Email or password is incorrect.";
    }

    if (code.includes("invalid-email")) {
      return "Enter a valid email address.";
    }

    if (code.includes("user-disabled")) {
      return "This account is disabled. Contact the account administrator.";
    }

    if (code.includes("email-not-found")) {
      return "No account was found for this email address.";
    }

    if (code.includes("operation-not-allowed")) {
      return "This sign-in method is not enabled in Firebase Authentication.";
    }

    if (code.includes("unauthorized-domain")) {
      return "This website domain is not authorized in Firebase Authentication.";
    }

    if (operation === "reset" &&
        code.includes("invalid-continue-uri")) {
      return "Password reset configuration requires administrator attention.";
    }

    return operation === "reset"
      ? "Unable to send the password reset email. Please try again."
      : "Unable to sign in. Check your connection and try again.";
  }

  function getFirebase() {
    const shared = window.restaurantFirebase;

    if (!shared || !shared.ready || !shared.auth || !shared.sdk) {
      throw new Error("Firebase Authentication is not ready.");
    }

    const authAPI = shared.sdk.auth;

    if (
      typeof authAPI.signInWithEmailAndPassword !== "function" ||
      typeof authAPI.onAuthStateChanged !== "function" ||
      typeof authAPI.signOut !== "function" ||
      typeof authAPI.sendPasswordResetEmail !== "function"
    ) {
      throw new Error("Required Firebase Authentication methods are unavailable.");
    }

    firebaseAuth = shared.auth;
    firebaseSDK = authAPI;

    return { auth: firebaseAuth, api: firebaseSDK };
  }

  function redirectToDashboard() {
    if (isRedirecting) return;

    isRedirecting = true;
    setSystemStatus("Sign-in verified. Opening dashboard...", "connected");

    window.location.replace(DASHBOARD_URL);
  }

  async function rejectUnauthorizedUser(user) {
    try {
      await firebaseSDK.signOut(firebaseAuth);
    } catch (error) {
      console.error("Unauthorized session sign-out failed:", error);
    }

    isRedirecting = false;
    setBusy(false);

    setMessage(
      "This account is not authorized to access this business.",
      "error"
    );

    setSystemStatus("Owner authorization failed.", "error");
  }

  async function handleLogin(event) {
    event.preventDefault();

    if (isSubmitting || isRedirecting) return;

    clearFieldErrors();
    setMessage("");

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    let hasError = false;

    if (!email || !emailInput.validity.valid) {
      setFieldError(emailError, "Enter a valid email address.");
      emailInput.setAttribute("aria-invalid", "true");
      hasError = true;
    }

    if (!password) {
      setFieldError(passwordError, "Enter your password.");
      passwordInput.setAttribute("aria-invalid", "true");
      hasError = true;
    }

    if (hasError) {
      setMessage("Please correct the fields marked above.", "error");

      if (!email || !emailInput.validity.valid) {
        emailInput.focus();
      } else {
        passwordInput.focus();
      }

      return;
    }

    if (!authReady) {
      setMessage("Authentication is still initializing. Try again shortly.", "warning");
      return;
    }

    setBusy(true, "Signing In");
    setSystemStatus("Verifying owner credentials...");

    try {
      const { auth, api } = getFirebase();

      const credential = await api.signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = credential.user;

      if (!user || user.uid !== OWNER_UID) {
        await rejectUnauthorizedUser(user);
        return;
      }

      redirectToDashboard();

    } catch (error) {
      console.error("Owner sign-in failed:", {
        code: error && error.code ? error.code : "unknown"
      });

      setBusy(false);
      setMessage(getReadableAuthError(error, "login"), "error");
      setSystemStatus("Sign-in could not be completed.", "error");
    }
  }

  async function handlePasswordReset() {
    if (isSubmitting || isRedirecting) return;

    clearFieldErrors();
    setMessage("");

    const email = emailInput.value.trim();

    if (!email || !emailInput.validity.valid) {
      setFieldError(emailError, "Enter your email address first.");
      emailInput.setAttribute("aria-invalid", "true");
      emailInput.focus();

      setMessage("Enter your account email to request a password reset.", "warning");
      return;
    }

    if (!authReady) {
      setMessage("Authentication is still initializing. Try again shortly.", "warning");
      return;
    }

    setBusy(true, "Please Wait");
    setSystemStatus("Requesting password reset...");

    try {
      const { auth, api } = getFirebase();

      await api.sendPasswordResetEmail(auth, email);

      setBusy(false);
      setMessage(
        "If the account is eligible, Firebase will send a password reset email.",
        "success"
      );

      setSystemStatus("Password reset request submitted.", "connected");

    } catch (error) {
      console.error("Password reset request failed:", {
        code: error && error.code ? error.code : "unknown"
      });

      setBusy(false);
      setMessage(getReadableAuthError(error, "reset"), "error");
      setSystemStatus("Password reset could not be completed.", "error");
    }
  }

  function handlePasswordVisibility() {
    const showPassword = passwordInput.type === "password";

    passwordInput.type = showPassword ? "text" : "password";

    if (togglePasswordButton) {
      togglePasswordButton.textContent = showPassword ? "Hide" : "Show";
      togglePasswordButton.setAttribute(
        "aria-pressed",
        String(showPassword)
      );
      togglePasswordButton.setAttribute(
        "aria-label",
        showPassword ? "Hide password" : "Show password"
      );
    }
  }

  function connectFirebase() {
    const shared = window.restaurantFirebase;

    if (!shared || !shared.readyPromise) {
      setSystemStatus("Firebase configuration loader is unavailable.", "error");
      setBusy(false);
      return;
    }

    setBusy(true, "Connecting");

    shared.readyPromise
      .then(function (ready) {
        if (!ready || !shared.ready) {
          throw new Error(
            shared.error?.message || "Firebase initialization failed."
          );
        }

        getFirebase();

        firebaseSDK.onAuthStateChanged(
          firebaseAuth,
          async function (user) {
            if (isRedirecting) return;

            if (user) {
              if (user.uid === OWNER_UID) {
                redirectToDashboard();
                return;
              }

              await rejectUnauthorizedUser(user);
              return;
            }

            authReady = true;
            setBusy(false);
            setMessage("");
            setSystemStatus("Ready for owner sign-in.", "connected");
          },
          function (error) {
            authReady = false;
            setBusy(false);

            console.error("Authentication state observer failed:", {
              code: error && error.code ? error.code : "unknown"
            });

            setMessage(
              "Unable to verify the current session. Reload and try again.",
              "error"
            );

            setSystemStatus("Authentication state unavailable.", "error");
          }
        );
      })
      .catch(function (error) {
        authReady = false;
        setBusy(false);

        console.error("Firebase setup failed:", error);
        setMessage(
          "Authentication could not initialize. Check the Worker configuration and reload.",
          "error"
        );

        setSystemStatus("Firebase connection failed.", "error");
      });
  }

  /* Prevent edits from being treated as persistent errors. */
  emailInput.addEventListener("input", function () {
    setFieldError(emailError, "");
    emailInput.removeAttribute("aria-invalid");
  });

  passwordInput.addEventListener("input", function () {
    setFieldError(passwordError, "");
    passwordInput.removeAttribute("aria-invalid");
  });

  form.addEventListener("submit", handleLogin);

  if (togglePasswordButton) {
    togglePasswordButton.addEventListener(
      "click",
      handlePasswordVisibility
    );
  }

  if (forgotPasswordButton) {
    forgotPasswordButton.addEventListener(
      "click",
      handlePasswordReset
    );
  }

  connectFirebase();

})();
