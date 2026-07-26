document.addEventListener('DOMContentLoaded', () => {
    let selectedGinFile = null;
    let analyzedAppJson = null;

    const appsTable = document.getElementById('apps-table');
    const appsTableBody = document.getElementById('apps-table-body');
    const loadingSpinner = document.getElementById('loading-spinner');
    const errorMessage = document.getElementById('error-message');
    const logoutButton = document.getElementById('logoutButton');
    const aboutButton = document.getElementById('aboutButton');

    // --- Modal Elements ---
    const confirmationModal = new bootstrap.Modal(document.getElementById('confirmationModal'));
    const modalTitle = document.getElementById('modal-title');
    const modalBodyText = document.getElementById('modal-body-text');
    const modalConfirmButton = document.getElementById('modal-confirm-button');
    let confirmAction = null;

    const installModal = new bootstrap.Modal(document.getElementById('installModal'));
    const installWizardTabs = {
        perms: new bootstrap.Tab(document.getElementById('tab-link-perms')),
        db: new bootstrap.Tab(document.getElementById('tab-link-db')),
        confirm: new bootstrap.Tab(document.getElementById('tab-link-confirm')),
    };

    const installStep1 = document.getElementById('install-step-1-upload');
    const installStep2 = document.getElementById('install-step-2-wizard');
    const wizardNextBtn = document.getElementById('wizard-next-btn');
    const wizardSpinner = document.getElementById('install-wizard-spinner');

    const installForm = document.getElementById('install-form');
    const installModalTitle = document.getElementById('install-modal-title');
    const installModalBody = document.getElementById('install-modal-body');
    const appNameInput = document.getElementById('appNameInput');
    const packageFileInput = document.getElementById('packageFileInput');
    const installButtonText = document.getElementById('install-button-text');
    const installModeInput = document.getElementById('install-mode-input');
    const installErrorMessage = document.getElementById('install-error-message');
    const installConfirmButton = document.getElementById('install-confirm-button');
    const installWizardError = document.getElementById('install-wizard-error');

    const permissionsModal = new bootstrap.Modal(document.getElementById('permissionsModal'));
    const permissionsModalTitle = document.getElementById('permissions-modal-title');
    const permissionsModalBody = document.getElementById('permissions-modal-body');
    const permissionsSaveButton = document.getElementById('permissions-save-button');
    let currentPermissionsAppName = null;

    // --- Main Function to Fetch and Render Apps ---
    async function fetchAndRenderApps() {
        try {
            const response = await fetch('/glade/api/apps', { credentials: 'include' });

            if (response.status === 401) {
                // Session expired or invalid, redirect to login
                window.location.href = '/glade/login.html';
                return;
            }

            if (!response.ok) {
                throw new Error(`Server responded with status: ${response.status}`);
            }

            const data = await response.json();

            if (data.status === 'success') {
                renderTable(data.apps);
            } else {
                showError(data.error || 'Failed to fetch app data.');
            }
        } catch (error) {
            showError(error.message);
        } finally {
            loadingSpinner.classList.add('d-none');
        }
    }

    // --- UI Helper Functions ---
    function showError(message) {
        errorMessage.textContent = `Error: ${message}`;
        errorMessage.classList.remove('d-none');
    }

    function renderTable(apps) {
        appsTableBody.innerHTML = ''; // Clear existing rows
        if (apps.length === 0) {
            appsTableBody.innerHTML = '<tr><td colspan="3" class="text-center">No applications found.</td></tr>';
        } else {
            apps.forEach(app => {
                const row = document.createElement('tr');
                const appName = app.name;
                row.innerHTML = `
                    <td>${appName}</td>
                    <td><span>${app.version}</span></td>
                    <td class="text-end actions-group">
                        <!-- Primary, standalone actions with original styling -->
                        <button title="Launch App" class="btn btn-transparent btn-sm action-launch" data-app="${appName}">
                            <div class="btn-mark bg-info"></div>Launch
                        </button>
                        <button title="Edit Permissions" class="btn btn-transparent btn-sm action-permissions" data-bs-toggle="modal" data-bs-target="#permissionsModal" data-app="${appName}">
                            <div class="btn-mark bg-warning"></div>Permissions
                        </button>
                        
                        <!-- Dropdown for all other actions -->
                        <div class="dropdown d-inline-block">
                            <button class="btn btn-transparent btn-sm dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">
                                More Actions
                            </button>
                            <ul class="dropdown-menu">
                                <li title="Reload App"><a class="dropdown-item action-reload" href="#" data-app="${appName}">
                                    <div class="btn-mark bg-info"></div>Reload
                                </a></li>
                                <li><hr class="dropdown-divider"></li>
                                <li title="Download App Package (.gin)"><a class="dropdown-item action-package" href="#" data-app="${appName}">
                                    <div class="btn-mark bg-info"></div>Download
                                </a></li>
                                <li title="Upgrade App"><a class="dropdown-item action-upgrade" href="#" data-bs-toggle="modal" data-bs-target="#installModal" data-app="${appName}">
                                    <div class="btn-mark bg-success"></div>Upgrade
                                </a></li>
                                <li title="Rollback App"><a class="dropdown-item action-rollback" href="#" data-app="${appName}">
                                    <div class="btn-mark bg-warning"></div>Rollback
                                </a></li>
                                <li><hr class="dropdown-divider"></li>
                                <li title="Uninstall App"><a class="dropdown-item text-danger action-delete" href="#" data-app="${appName}">
                                    <div class="btn-mark bg-danger"></div>Uninstall
                                </a></li>
                            </ul>
                        </div>
                    </td>
                `;
                appsTableBody.appendChild(row);
            });
        }
        appsTable.classList.remove('d-none');
    }

    // --- Event Listeners ---
    aboutButton.addEventListener('click', async () => {
        window.open('https://gingerhome.github.io/gingee-docs/', '_blank');
    });
    
    logoutButton.addEventListener('click', async () => {
        await fetch('/glade/logout', { method: 'POST', credentials: 'include' });
        window.location.href = '/glade/login.html';
    });

    appsTableBody.addEventListener('click', (event) => {
        // Target can be a button OR a dropdown anchor tag
        const target = event.target.closest('button, a.dropdown-item');
        if (!target) return;

        const appName = target.dataset.app;
        if (!appName) return;

        // --- Dropdown Reset Logic ---
        const dropdownButton = target.closest('td')?.querySelector('.dropdown-toggle');
        if (dropdownButton) {
            setTimeout(() => {
                dropdownButton.textContent = 'More Actions';
            }, 200); // Small delay for better UX
        }
        // --- End Reset Logic ---

        if (target.classList.contains('action-launch')) {
            window.open('/' + appName, '_blank');
        }
        else if (target.classList.contains('action-permissions')) {
            openPermissionsModal(appName);
        }
        else if (target.classList.contains('action-upgrade')) {
            // Note: Modal is also triggered by data-bs-* attributes
            installModalTitle.textContent = `Upgrade Application: ${appName}`;
            appNameInput.value = appName;
            appNameInput.readOnly = true;
            installModeInput.dataset.mode = 'upgrade';
        }
        else if (target.classList.contains('action-reload')) {
            modalTitle.textContent = `Reload Application`;
            modalBodyText.textContent = `Are you sure you want to force a reload of the '${appName}' application? This will re-initialize its configuration and restart its services.`;
            modalConfirmButton.className = 'btn btn-info';
            confirmAction = () => reloadApp(appName);
            confirmationModal.show();
        }
        else if (target.classList.contains('action-package')) {
            window.location.href = `/glade/api/package?app=${appName}`;
        }
        else if (target.classList.contains('action-rollback')) {
            openRollbackModal(appName);
        }
        else if (target.classList.contains('action-delete')) {
            modalTitle.textContent = `Delete Application`;
            modalBodyText.textContent = `Are you sure you want to permanently delete the application '${appName}'? This action cannot be undone.`;
            modalConfirmButton.className = 'btn btn-danger';
            confirmAction = () => deleteAapp(appName);
            confirmationModal.show();
        }
    });


    packageFileInput.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        selectedGinFile = file;

        installStep1.classList.add('d-none');
        wizardSpinner.classList.remove('d-none');
        installConfirmButton.classList.add('d-none'); // Hide main button during analysis

        try {
            const { appJson, pmft } = await InstallerWizard.analyzeGinFile(file);
            analyzedAppJson = appJson;

            const wizardPanes = {
                permsPane: document.getElementById('tab-pane-perms'),
                dbPane: document.getElementById('tab-pane-db'),
                confirmPane: document.getElementById('tab-pane-confirm')
            };
            InstallerWizard.renderWizardTabs(wizardPanes, appJson, pmft);

            wizardSpinner.classList.add('d-none');
            installStep2.classList.remove('d-none');
            wizardNextBtn.classList.remove('d-none');

            installWizardTabs.perms.show();
        } catch (error) {
            wizardSpinner.classList.add('d-none');
            showInstallError(error.message);
        }
    });

    function showInstallError(message) {
        installWizardError.textContent = message;
        installWizardError.classList.remove('d-none');
    }

    function hideInstallError() {
        installWizardError.classList.add('d-none');
        installWizardError.textContent = '';
    }

    wizardNextBtn.addEventListener('click', () => {
        const activeTab = document.querySelector('#install-wizard-tabs .nav-link.active');
        if (activeTab.id === 'tab-link-perms') {
            document.getElementById('tab-link-db').classList.remove('disabled');
            installWizardTabs.db.show();
        } else if (activeTab.id === 'tab-link-db') {
            document.getElementById('tab-link-confirm').classList.remove('disabled');
            installWizardTabs.confirm.show();
            wizardNextBtn.classList.add('d-none'); // Hide "Next"
            installConfirmButton.classList.remove('d-none'); // Show the final button

            // Set the state to 'wizard-confirm' so the click handler knows what to do.
            installModeInput.value = 'wizard-confirm';
        }
    });

    installConfirmButton.addEventListener('click', async () => {
        // Only proceed if we are in the wizard confirmation step.
        const mode = installModeInput.value;
        if (mode !== 'wizard-confirm') {
            return;
        }

        setInstallButtonLoading(true);

        try {
            // Step 1: Gather permissions and DB config from the dynamic wizard form.
            const grantedPermissions = Array.from(document.querySelectorAll('#permissions-form-glade .form-check-input:checked')).map(cb => cb.value);
            const dbConfig = InstallerWizard.buildDbConfigFromForm(analyzedAppJson.db);

            // Step 2: Create the final app.json in memory.
            const finalAppJson = { ...analyzedAppJson };
            if (dbConfig.length > 0) {
                finalAppJson.db = dbConfig;
            }

            // Step 3: Repackage the .gin file in the browser with the new app.json.
            const finalPackageBlob = await InstallerWizard.repackGinFile(selectedGinFile, finalAppJson);

            // Step 4: Construct FormData for the final upload.
            const formData = new FormData();
            formData.append('package', finalPackageBlob, selectedGinFile.name);
            formData.append('appName', appNameInput.value);
            formData.append('permissions', JSON.stringify(grantedPermissions));

            const installOrUpgrade = installModeInput.dataset.mode; // 'install' or 'upgrade'
            const url = installOrUpgrade === 'install' ? '/glade/api/install' : '/glade/api/upgrade';

            // Step 5: Send the final, configured package to the server.
            const response = await fetch(url, {
                method: 'POST',
                body: formData,
                credentials: 'include'
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'An unknown server error occurred during installation.');
            }

            installModal.hide();
            fetchAndRenderApps(); // Refresh the main app list on success.

        } catch (error) {
            // Create and display an error message inside the modal for better UX.
            const confirmPane = document.getElementById('tab-pane-confirm');
            let errorDiv = confirmPane.querySelector('.alert-danger');
            if (!errorDiv) {
                errorDiv = document.createElement('div');
                errorDiv.className = 'alert alert-danger mt-3';
                confirmPane.appendChild(errorDiv);
            }
            errorDiv.textContent = `Installation Failed: ${error.message}`;
        } finally {
            setInstallButtonLoading(false);
        }
    });


    installForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        setInstallButtonLoading(true);

        try {
            const grantedPermissions = Array.from(document.querySelectorAll('#permissions-form-glade .form-check-input:checked')).map(cb => cb.value);
            const dbConfig = InstallerWizard.buildDbConfigFromForm(analyzedAppJson.db);
            const finalPackageBlob = await InstallerWizard.repackGinFile(selectedGinFile, { ...analyzedAppJson, db: dbConfig });

            const formData = new FormData();
            formData.append('package', finalPackageBlob, selectedGinFile.name);
            formData.append('appName', appNameInput.value);
            formData.append('permissions', JSON.stringify(grantedPermissions));

            const mode = installModeInput.value;
            const url = mode === 'install' ? '/glade/api/install' : '/glade/api/upgrade';

            const response = await fetch(url, { method: 'POST', body: formData, credentials: 'include' });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'An unknown server error occurred.');
            }

            installModal.hide();
            fetchAndRenderApps();

        } catch (error) {
            alert(`Installation Failed: ${error.message}`); // Simple error for now
        } finally {
            setInstallButtonLoading(false);
        }
    });

    function resetInstallModal() {
        selectedGinFile = null;
        analyzedAppJson = null;

        hideInstallError();

        if (appNameInput) appNameInput.value = '';
        if (packageFileInput) packageFileInput.value = '';

        installStep1.classList.remove('d-none');
        installStep2.classList.add('d-none');
        wizardSpinner.classList.add('d-none');

        const wizardPanes = {
            permsPane: document.getElementById('tab-pane-perms'),
            dbPane: document.getElementById('tab-pane-db'),
            confirmPane: document.getElementById('tab-pane-confirm')
        };

        wizardPanes.permsPane.innerHTML = '';
        wizardPanes.dbPane.innerHTML = '';
        wizardPanes.confirmPane.innerHTML = '';

        // Hide wizard buttons and show the main one (which will be hidden again on file select)
        wizardNextBtn.classList.add('d-none');
        installConfirmButton.classList.remove('d-none');

        // Reset and disable tabs
        installWizardTabs.perms.show();
        document.getElementById('tab-link-db').classList.add('disabled');
        document.getElementById('tab-link-confirm').classList.add('disabled');
    }

    document.getElementById('installModal').addEventListener('show.bs.modal', (event) => {
        resetInstallModal();

        // Determine if we are in 'install' or 'upgrade' mode from the button that triggered the modal
        const button = event.relatedTarget;
        if (button && button.classList.contains('btn-upgrade')) {
            const appName = button.dataset.app;
            installModalTitle.textContent = `Upgrade Application: ${appName}`;
            appNameInput.value = appName;
            appNameInput.readOnly = true;
            installModeInput.dataset.mode = 'upgrade';
            installButtonText.textContent = 'Upgrade';
        } else {
            installModalTitle.textContent = 'Install Application';
            appNameInput.readOnly = false;
            installModeInput.dataset.mode = 'install';
            installButtonText.textContent = 'Install';
        }

        // Set the initial state for the button handler.
        installModeInput.value = 'initial-upload';
    });

    document.getElementById('installModal').addEventListener('hidden.bs.modal', resetInstallModal);

    modalConfirmButton.addEventListener('click', () => {
        if (typeof confirmAction === 'function') {
            confirmAction();
        }
        confirmationModal.hide();
    });

    async function openRollbackModal(appName) {
        modalTitle.textContent = `Rollback Application: ${appName}`;
        modalBodyText.innerHTML = '<div class="text-center p-3"><div class="spinner-border" role="status"></div><p class="mt-2">Analyzing backup...</p></div>';
        modalConfirmButton.className = 'btn btn-warning'; // Style button for rollback
        modalConfirmButton.disabled = true; // Disable until analysis is complete
        confirmationModal.show();

        try {
            // Step 1 & 2: Fetch both backup analysis and current permissions concurrently
            const [analysisRes, currentPermsRes] = await Promise.all([
                fetch(`/glade/api/analyze-backup?app=${appName}`, { credentials: 'include' }),
                fetch(`/glade/api/get-permissions?app=${appName}`, { credentials: 'include' })
            ]);

            if (!analysisRes.ok || !currentPermsRes.ok) {
                throw new Error('Failed to retrieve necessary information from the server.');
            }

            const analysis = await analysisRes.json();
            const currentPerms = await currentPermsRes.json();

            if (analysis.status !== 'success' || currentPerms.status !== 'success') {
                throw new Error(analysis.error || currentPerms.error || 'Server analysis failed.');
            }

            // Step 3: Compare permissions and build the confirmation UI
            const backupMandatory = new Set(analysis.permissions.mandatory || []);
            const currentGranted = new Set(currentPerms.grantedPermissions);

            const toRevoke = [...currentGranted].filter(p => !backupMandatory.has(p));
            const toGrant = [...backupMandatory].filter(p => !currentGranted.has(p));

            let diffHtml = `
                <p>This will roll back the application to <strong>version ${analysis.version}</strong>.</p>
                <p>Please review the following permission changes:</p>
            `;

            if (toGrant.length === 0 && toRevoke.length === 0) {
                diffHtml += '<div class="alert alert-success">No permission changes are required for this rollback.</div>';
            } else {
                if (toGrant.length > 0) {
                    diffHtml += '<p class="text-success"><strong>Permissions to be GRANTED:</strong> ' + toGrant.join(', ') + '</p>';
                }
                if (toRevoke.length > 0) {
                    diffHtml += '<p class="text-danger"><strong>Permissions to be REVOKED:</strong> ' + toRevoke.join(', ') + '</p>';
                }
            }
            diffHtml += '<p class="mt-3">Do you approve these changes and want to proceed?</p>';

            modalBodyText.innerHTML = diffHtml;

            // Step 4: Wire up the confirm button for the final action
            confirmAction = () => executeRollback(appName, Array.from(backupMandatory));
            modalConfirmButton.disabled = false;

        } catch (error) {
            modalBodyText.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    }

    async function executeRollback(appName, finalPermissions) {
        setConfirmButtonLoading(true);
        try {
            // Step 5: Execute the rollback with the final, approved permission set
            const response = await fetch('/glade/api/rollback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appName: appName,
                    permissions: finalPermissions
                }),
                credentials: 'include'
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'Rollback failed on the server.');
            }

            confirmationModal.hide();
            fetchAndRenderApps(); // Refresh the list on success

        } catch (error) {
            modalBodyText.querySelector('.alert-danger')?.remove(); // Remove old error
            const errorDiv = document.createElement('div');
            errorDiv.className = 'alert alert-danger mt-3';
            errorDiv.textContent = error.message;
            modalBodyText.appendChild(errorDiv);
        } finally {
            setConfirmButtonLoading(false);
        }
    }

    async function openPermissionsModal(appName) {
        currentPermissionsAppName = appName;
        permissionsModalTitle.textContent = `Edit Permissions for: ${appName}`;
        // Set loading state BEFORE showing the modal
        permissionsModalBody.innerHTML = '<div class="text-center p-3"><div class="spinner-border" role="status"></div></div>';
        permissionsModal.show();

        try {
            const response = await fetch(`/glade/api/get-permissions?app=${appName}`, { credentials: 'include' });
            if (!response.ok) throw new Error('Failed to load permissions data.');

            const data = await response.json();
            if (data.status !== 'success') throw new Error(data.error || 'Server error.');

            renderPermissionsForm(data.allPermissions, data.grantedPermissions);
        } catch (error) {
            permissionsModalBody.innerHTML = `<div class="alert alert-danger">${error.message}</div>`;
        }
    }

    function renderPermissionsForm(allPermissions, grantedPermissions) {
        permissionsModalBody.innerHTML = '';
        const form = document.createElement('form');
        form.id = 'permissions-form';

        for (const key in allPermissions) {
            const description = allPermissions[key];
            const isChecked = grantedPermissions.includes(key);

            const div = document.createElement('div');
            div.className = 'form-check mb-2';
            div.innerHTML = `
                <input class="form-check-input" type="checkbox" value="${key}" id="perm-${key}" ${isChecked ? 'checked' : ''}>
                <label class="form-check-label" for="perm-${key}">
                    <strong>${key}</strong>: ${description}
                </label>
            `;
            form.appendChild(div);
        }
        permissionsModalBody.appendChild(form);
    }

    permissionsSaveButton.addEventListener('click', async () => {
        if (!currentPermissionsAppName) return;

        setPermissionsButtonLoading(true);
        const checkboxes = document.querySelectorAll('#permissions-form .form-check-input:checked');
        const newPermissions = Array.from(checkboxes).map(cb => cb.value);

        try {
            const response = await fetch('/glade/api/set-permissions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    appName: currentPermissionsAppName,
                    permissions: newPermissions
                }),
                credentials: 'include'
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to save permissions.');
            }

            permissionsModal.hide();
        } catch (error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'alert alert-danger mt-3';
            errorDiv.textContent = error.message;
            permissionsModalBody.appendChild(errorDiv);
        } finally {
            setPermissionsButtonLoading(false);
        }
    });

    function setPermissionsButtonLoading(isLoading) {
        const spinner = permissionsSaveButton.querySelector('.spinner-border');
        const text = permissionsSaveButton.querySelector('#permissions-save-button-text');
        if (isLoading) {
            permissionsSaveButton.disabled = true;
            spinner.classList.remove('d-none');
            text.textContent = 'Saving...';
        } else {
            permissionsSaveButton.disabled = false;
            spinner.classList.add('d-none');
            text.textContent = 'Save Changes';
        }
    }

    async function reloadApp(appName) {
        setConfirmButtonLoading(true);
        try {
            const response = await fetch(`/glade/api/reload-app?app=${appName}`, { method: 'POST', credentials: 'include' });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.message || 'Reload failed on the server.');
            }
            confirmationModal.hide();
            // Optional: Add a success notification/toast here.
        } catch (error) {
            modalBodyText.querySelector('.alert-danger')?.remove();
            const errorDiv = document.createElement('div');
            errorDiv.className = 'alert alert-danger mt-3';
            errorDiv.textContent = error.message;
            modalBodyText.appendChild(errorDiv);
        } finally {
            setConfirmButtonLoading(false);
        }
    }

    // --- API Call Functions ---
    async function deleteAapp(appName) {
        try {
            const response = await fetch(`/glade/api/delete?app=${appName}`, { method: 'DELETE', credentials: 'include' });
            if (!response.ok) throw new Error('Failed to delete application.');
            fetchAndRenderApps(); // Refresh the list
        } catch (error) {
            showError(error.message);
        }
    }

    async function packageApp(appName) {
        // This triggers a file download, so we just redirect the window.
        window.location.href = `/glade/api/package?app=${appName}`;
    }

    function setConfirmButtonLoading(isLoading) {
        if (isLoading) {
            modalConfirmButton.disabled = true;
            modalConfirmButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...`;
        } else {
            modalConfirmButton.disabled = false;
            modalConfirmButton.innerHTML = 'Confirm';
        }
    }

    document.getElementById('confirmationModal').addEventListener('hidden.bs.modal', () => {
        modalBodyText.innerHTML = '';
        confirmAction = null;
        setConfirmButtonLoading(false);
    });

    function setInstallButtonLoading(isLoading) {
        const spinner = installConfirmButton.querySelector('.spinner-border');
        const text = installConfirmButton.querySelector('#install-button-text');
        if (isLoading) {
            installConfirmButton.disabled = true;
            spinner.classList.remove('d-none');
            text.textContent = 'Processing...';
        } else {
            installConfirmButton.disabled = false;
            spinner.classList.add('d-none');
            text.textContent = 'Install';
        }
    }

    function escapeHtml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // --- Schedules / Run now Admin ---
    const scheduleStatsPanel = document.getElementById('schedule-stats-panel');
    const scheduleTableBody = document.getElementById('schedule-table-body');
    const scheduleAdminError = document.getElementById('schedule-admin-error');
    const scheduleAdminInfo = document.getElementById('schedule-admin-info');
    const scheduleRefreshBtn = document.getElementById('schedule-refresh-btn');
    const scheduleAppFilter = document.getElementById('schedule-app-filter');
    const scheduleAdminModalEl = document.getElementById('scheduleAdminModal');
    let cachedScheduleJobs = [];

    function showScheduleError(msg) {
        if (!scheduleAdminError) return;
        scheduleAdminError.textContent = msg || '';
        scheduleAdminError.classList.toggle('d-none', !msg);
    }

    function showScheduleInfo(msg) {
        if (!scheduleAdminInfo) return;
        scheduleAdminInfo.textContent = msg || '';
        scheduleAdminInfo.classList.toggle('d-none', !msg);
    }

    function filterScheduleJobs(jobs) {
        const q = (scheduleAppFilter && scheduleAppFilter.value.trim().toLowerCase()) || '';
        if (q.length < 3) return jobs;
        return jobs.filter((j) => String(j.appName || '').toLowerCase().includes(q));
    }

    function renderScheduleTable(jobs) {
        if (!scheduleTableBody) return;
        if (!jobs || jobs.length === 0) {
            const q = (scheduleAppFilter && scheduleAppFilter.value.trim()) || '';
            const emptyMsg =
                q.length >= 3
                    ? `No schedules matching “${escapeHtml(q)}”`
                    : 'No registered schedules on this node';
            scheduleTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">${emptyMsg}</td></tr>`;
            return;
        }
        scheduleTableBody.innerHTML = jobs
            .map((j) => {
                const next = j.nextRunAt ? new Date(j.nextRunAt).toLocaleString() : '—';
                const status = j.running
                    ? 'running'
                    : j.lastStatus != null
                      ? String(j.lastStatus)
                      : '—';
                const statusClass =
                    status === 'ok'
                        ? 'text-success'
                        : status === 'error' || status === 'timeout'
                          ? 'text-danger'
                          : status === 'running'
                            ? 'text-primary'
                            : 'text-muted';
                const errTitle = j.lastError ? escapeHtml(j.lastError) : '';
                const app = escapeHtml(j.appName);
                const name = escapeHtml(j.name);
                return `<tr>
                        <td>${app}</td>
                        <td class="font-monospace small">${name}</td>
                        <td class="small font-monospace">${escapeHtml(j.cron)} <span class="text-muted">${escapeHtml(j.timezone || '')}</span></td>
                        <td class="small">${escapeHtml(j.targetSummary || j.targetType || '—')}</td>
                        <td class="small">${escapeHtml(next)}</td>
                        <td class="small ${statusClass}" title="${errTitle}">${escapeHtml(status)}</td>
                        <td class="text-end text-nowrap">
                            <button type="button" class="queue-action-link schedule-run-now"
                                data-app="${app}" data-job="${name}"
                                ${j.running ? 'disabled' : ''}
                                title="Run this job immediately on this node">Run now</button>
                        </td>
                    </tr>`;
            })
            .join('');
    }

    async function loadScheduleAdmin() {
        showScheduleError('');
        showScheduleInfo('');
        try {
            const res = await fetch('/glade/api/schedule-list', { credentials: 'include' });
            if (res.status === 401) {
                window.location.href = '/glade/login.html';
                return;
            }
            const data = await res.json();
            if (data.status !== 'success') throw new Error(data.error || 'Failed to load schedules');

            const s = data.statusInfo || {};
            if (scheduleStatsPanel) {
                scheduleStatsPanel.innerHTML = [
                    `<strong>Scheduler:</strong> ${s.enabled ? 'enabled' : 'disabled'}`,
                    `<strong>Timezone:</strong> ${escapeHtml(s.timezone || 'UTC')}`,
                    `<strong>Coordination:</strong> ${escapeHtml((s.coordination && s.coordination.driver) || 'none')}`,
                    `<strong>Jobs:</strong> ${s.jobCount ?? 0}`,
                    `<strong>Running:</strong> ${s.runningCount ?? 0}`
                ].join(' &nbsp;·&nbsp; ');
            }
            if (!s.enabled) {
                showScheduleInfo(
                    'Scheduler is disabled on this node (scheduler.enabled is false). No jobs are registered; enable it in gingee.json and restart to use Run now.'
                );
            }

            cachedScheduleJobs = data.jobs || [];
            renderScheduleTable(filterScheduleJobs(cachedScheduleJobs));
        } catch (e) {
            showScheduleError(e.message);
        }
    }

    if (scheduleAdminModalEl) {
        scheduleAdminModalEl.addEventListener('shown.bs.modal', () => {
            loadScheduleAdmin();
        });
    }
    if (scheduleRefreshBtn) {
        scheduleRefreshBtn.addEventListener('click', () => loadScheduleAdmin());
    }
    if (scheduleAppFilter) {
        scheduleAppFilter.addEventListener('input', () => {
            renderScheduleTable(filterScheduleJobs(cachedScheduleJobs));
        });
    }
    if (scheduleTableBody) {
        scheduleTableBody.addEventListener('click', async (e) => {
            const runBtn = e.target.closest('.schedule-run-now');
            if (!runBtn) return;
            e.preventDefault();
            e.stopPropagation();
            const appName = runBtn.dataset.app || runBtn.getAttribute('data-app');
            const jobName = runBtn.dataset.job || runBtn.getAttribute('data-job');
            if (!appName || !jobName) {
                showScheduleError('Missing app or job name.');
                return;
            }
            try {
                showScheduleError('');
                showScheduleInfo('');
                runBtn.disabled = true;
                const res = await fetch('/glade/api/schedule-run', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ appName, jobName })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || data.status !== 'success') {
                    throw new Error(data.error || `Run now failed (${res.status})`);
                }
                const r = data.result || {};
                showScheduleInfo(
                    `Ran ${appName}/${jobName} → ${r.lastStatus || 'done'}` +
                        (r.lastError ? ` (${r.lastError})` : '')
                );
                await loadScheduleAdmin();
            } catch (err) {
                showScheduleError(err.message);
                await loadScheduleAdmin();
            }
        });
    }

    // --- Queue live + DLQ Admin ---
    const queueStatsPanel = document.getElementById('queue-stats-panel');
    const queueLiveBody = document.getElementById('queue-live-body');
    const queueDlqBody = document.getElementById('queue-dlq-body');
    const queueAdminError = document.getElementById('queue-admin-error');
    const queueRefreshBtn = document.getElementById('queue-refresh-btn');
    const queueLiveRefresh = document.getElementById('queue-live-refresh');
    const queueAppFilter = document.getElementById('queue-dlq-app-filter');
    const queueAdminModalEl = document.getElementById('queueAdminModal');
    let cachedDlqJobs = [];
    let cachedLiveJobs = [];
    let queueAutoTimer = null;

    function showQueueError(msg) {
        if (!queueAdminError) return;
        queueAdminError.textContent = msg || '';
        queueAdminError.classList.toggle('d-none', !msg);
    }

    function filterQueueJobsByApp(jobs) {
        const q = (queueAppFilter && queueAppFilter.value.trim().toLowerCase()) || '';
        if (q.length < 3) return jobs;
        return jobs.filter((j) => String(j.appName || '').toLowerCase().includes(q));
    }

    function formatRunAt(j) {
        if (j.startedAt) return new Date(j.startedAt).toLocaleString();
        if (j.runAt) return new Date(j.runAt).toLocaleString();
        if (j.createdAt) return new Date(j.createdAt).toLocaleString();
        return '—';
    }

    function stateBadgeClass(state) {
        if (state === 'running') return 'text-primary';
        if (state === 'waiting') return 'text-info';
        if (state === 'delayed') return 'text-warning';
        if (state === 'pending') return 'text-secondary';
        return 'text-muted';
    }

    function renderLiveTable(jobs) {
        if (!queueLiveBody) return;
        if (!jobs || jobs.length === 0) {
            const q = (queueAppFilter && queueAppFilter.value.trim()) || '';
            const emptyMsg =
                q.length >= 3
                    ? `No live jobs matching “${escapeHtml(q)}”`
                    : 'No live jobs';
            queueLiveBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">${emptyMsg}</td></tr>`;
            return;
        }
        queueLiveBody.innerHTML = jobs
            .map((j) => {
                const id = escapeHtml(j.id);
                const state = j.state || '—';
                return `<tr>
                        <td class="font-monospace small" title="${id}">${id.slice(0, 12)}…</td>
                        <td>${escapeHtml(j.appName)}</td>
                        <td>${escapeHtml(j.name)}</td>
                        <td class="small ${stateBadgeClass(state)}">${escapeHtml(state)}</td>
                        <td>${escapeHtml(j.attempt)}/${escapeHtml(j.maxAttempts)}</td>
                        <td class="small">${escapeHtml(formatRunAt(j))}</td>
                        <td class="small text-muted">${escapeHtml(j.scope || '—')}</td>
                    </tr>`;
            })
            .join('');
    }

    function renderDlqTable(jobs) {
        if (!queueDlqBody) return;
        if (!jobs || jobs.length === 0) {
            const q = (queueAppFilter && queueAppFilter.value.trim()) || '';
            const emptyMsg =
                q.length >= 3
                    ? `No dead-letter jobs matching “${escapeHtml(q)}”`
                    : 'No dead-letter jobs';
            queueDlqBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">${emptyMsg}</td></tr>`;
            return;
        }
        queueDlqBody.innerHTML = jobs
            .map((j) => {
                const failedAt = j.failedAt ? new Date(j.failedAt).toLocaleString() : '—';
                const err = j.error ? String(j.error).slice(0, 120) : '—';
                const id = escapeHtml(j.id);
                return `<tr>
                        <td class="font-monospace small">${id.slice(0, 12)}…</td>
                        <td>${escapeHtml(j.appName)}</td>
                        <td>${escapeHtml(j.name)}</td>
                        <td>${escapeHtml(j.attempt)}/${escapeHtml(j.maxAttempts)}</td>
                        <td class="small">${escapeHtml(failedAt)}</td>
                        <td class="small text-danger" title="${escapeHtml(j.error || '')}">${escapeHtml(err)}</td>
                        <td class="text-end text-nowrap">
                            <button type="button" class="queue-action-link queue-dlq-retry" data-id="${id}" title="Re-enqueue with a fresh attempt budget">Retry</button>
                            <button type="button" class="queue-action-link queue-dlq-discard" data-id="${id}" title="Remove from dead-letter queue">Discard</button>
                        </td>
                    </tr>`;
            })
            .join('');
    }

    function applyQueueFilters() {
        renderLiveTable(filterQueueJobsByApp(cachedLiveJobs));
        renderDlqTable(filterQueueJobsByApp(cachedDlqJobs));
    }

    async function loadQueueAdmin() {
        showQueueError('');
        try {
            const [statsRes, liveRes, dlqRes] = await Promise.all([
                fetch('/glade/api/queue-stats', { credentials: 'include' }),
                fetch('/glade/api/queue-live-list?limit=200', { credentials: 'include' }),
                fetch('/glade/api/queue-dlq-list?limit=200', { credentials: 'include' })
            ]);
            if (statsRes.status === 401 || liveRes.status === 401 || dlqRes.status === 401) {
                window.location.href = '/glade/login.html';
                return;
            }
            const statsData = await statsRes.json();
            const liveData = await liveRes.json();
            const dlqData = await dlqRes.json();
            if (statsData.status !== 'success') throw new Error(statsData.error || 'Failed to load queue stats');
            if (liveData.status !== 'success') throw new Error(liveData.error || 'Failed to load live jobs');
            if (dlqData.status !== 'success') throw new Error(dlqData.error || 'Failed to load DLQ');

            const s = statsData.stats || {};
            if (queueStatsPanel) {
                const parts = [
                    `<strong>Enabled:</strong> ${s.enabled ? 'yes' : 'no'}`,
                    `<strong>Driver:</strong> ${escapeHtml(s.driver || '—')}`,
                    `<strong>In flight:</strong> ${s.inFlight ?? 0}`,
                    `<strong>Waiting (node):</strong> ${s.waiting ?? 0}`,
                    `<strong>Concurrency:</strong> ${s.concurrency ?? '—'}`
                ];
                if (s.pendingCount != null) {
                    parts.push(`<strong>Pending (driver):</strong> ${s.pendingCount}`);
                }
                if (s.delayedCount != null) {
                    parts.push(`<strong>Delayed:</strong> ${s.delayedCount}`);
                }
                parts.push(`<strong>DLQ:</strong> ${s.dlqCount ?? 0}`);
                queueStatsPanel.innerHTML = parts.join(' &nbsp;·&nbsp; ');
            }

            cachedLiveJobs = liveData.jobs || [];
            cachedDlqJobs = dlqData.jobs || [];
            applyQueueFilters();
        } catch (e) {
            showQueueError(e.message);
        }
    }

    function stopQueueAutoRefresh() {
        if (queueAutoTimer) {
            clearInterval(queueAutoTimer);
            queueAutoTimer = null;
        }
    }

    function startQueueAutoRefresh() {
        stopQueueAutoRefresh();
        if (!queueLiveRefresh || !queueLiveRefresh.checked) return;
        queueAutoTimer = setInterval(() => {
            if (queueAdminModalEl && queueAdminModalEl.classList.contains('show')) {
                loadQueueAdmin();
            }
        }, 3000);
    }

    if (queueAdminModalEl) {
        queueAdminModalEl.addEventListener('shown.bs.modal', () => {
            loadQueueAdmin();
            startQueueAutoRefresh();
        });
        queueAdminModalEl.addEventListener('hidden.bs.modal', () => {
            stopQueueAutoRefresh();
        });
    }
    if (queueRefreshBtn) {
        queueRefreshBtn.addEventListener('click', () => loadQueueAdmin());
    }
    if (queueLiveRefresh) {
        queueLiveRefresh.addEventListener('change', () => {
            if (queueLiveRefresh.checked) startQueueAutoRefresh();
            else stopQueueAutoRefresh();
        });
    }
    if (queueAppFilter) {
        queueAppFilter.addEventListener('input', () => {
            applyQueueFilters();
        });
    }
    if (queueDlqBody) {
        queueDlqBody.addEventListener('click', async (e) => {
            const retryBtn = e.target.closest('.queue-dlq-retry');
            const discardBtn = e.target.closest('.queue-dlq-discard');
            if (!retryBtn && !discardBtn) return;
            e.preventDefault();
            e.stopPropagation();
            const jobId =
                (retryBtn || discardBtn).dataset.id ||
                (retryBtn || discardBtn).getAttribute('data-id');
            if (!jobId) {
                showQueueError('Missing job id for this action.');
                return;
            }
            try {
                showQueueError('');
                if (retryBtn) {
                    retryBtn.disabled = true;
                    const res = await fetch('/glade/api/queue-dlq-retry', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jobId })
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || data.status !== 'success') {
                        throw new Error(data.error || `Retry failed (${res.status})`);
                    }
                } else if (discardBtn) {
                    if (!confirm('Discard this dead-letter job permanently?')) return;
                    discardBtn.disabled = true;
                    const res = await fetch('/glade/api/queue-dlq-discard', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ jobId })
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || data.status !== 'success') {
                        throw new Error(data.error || `Discard failed (${res.status})`);
                    }
                }
                await loadQueueAdmin();
            } catch (err) {
                showQueueError(err.message);
                await loadQueueAdmin();
            }
        });
    }

    // --- Initial Load ---
    fetchAndRenderApps();
});
