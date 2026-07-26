/**
 * Install vs Upgrade mode resolution for Glade's #installModal.
 * Pure helpers — used by cl_dashboard.js and unit tests.
 *
 * Lifecycle mode is stored on #install-mode-input[data-mode] ('install' | 'upgrade').
 * The input's .value is only the wizard step ('initial-upload' | 'wizard-confirm').
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GladeInstallModalMode = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Resolve install vs upgrade from the element that opened #installModal.
   * Upgrade triggers use class action-upgrade (dropdown) or legacy btn-upgrade;
   * the top-level Install button has neither.
   *
   * @param {object|null|undefined} trigger - event.relatedTarget from show.bs.modal
   * @returns {{ mode: 'install'|'upgrade', appName: string|null }}
   */
  function resolveInstallModalMode(trigger) {
    if (!trigger || !trigger.classList) {
      return { mode: 'install', appName: null };
    }
    const isUpgrade =
      trigger.classList.contains('action-upgrade') ||
      trigger.classList.contains('btn-upgrade') ||
      (typeof trigger.getAttribute === 'function' &&
        trigger.getAttribute('data-mode') === 'upgrade');
    let appName = null;
    if (trigger.dataset && trigger.dataset.app != null) {
      appName = String(trigger.dataset.app).trim();
    }
    if (isUpgrade && appName) {
      return { mode: 'upgrade', appName };
    }
    return { mode: 'install', appName: null };
  }

  /**
   * API path for the lifecycle operation.
   * @param {'install'|'upgrade'|string|null|undefined} mode
   * @returns {string}
   */
  function lifecycleApiUrl(mode) {
    return mode === 'upgrade' ? '/glade/api/upgrade' : '/glade/api/install';
  }

  /**
   * Read lifecycle mode from the hidden input's data-mode attribute.
   * @param {{ dataset?: { mode?: string } }|null|undefined} modeInput
   * @returns {'install'|'upgrade'}
   */
  function getInstallLifecycleMode(modeInput) {
    return modeInput && modeInput.dataset && modeInput.dataset.mode === 'upgrade'
      ? 'upgrade'
      : 'install';
  }

  /**
   * App names that cannot be uninstalled from Glade (matches platform RESERVED_DELETE).
   * @param {string} appName
   * @returns {boolean}
   */
  function isReservedAppName(appName) {
    return String(appName || '').toLowerCase() === 'glade';
  }

  return {
    resolveInstallModalMode,
    lifecycleApiUrl,
    getInstallLifecycleMode,
    isReservedAppName
  };
});
