
// This module exports functions to handle the client-side installation wizard.
const InstallerWizard = (() => {

    const PERMISSION_DESCRIPTIONS = {
        "cache": "Allows the app to use the caching service for storing and retrieving data.",
        "db": "Allows the app to connect to and query the database(s) you configure for it.",
        "fs": "Grants full read/write access within the app's own secure directories (`box` and `web`).",
        "httpclient": "Permits the app to make outbound network requests to any external API or website.",
        "platform": "PRIVILEGED: Allows managing the lifecycle of other applications on the server. Grant with extreme caution.",
        "pdf": "Allows the app to generate and manipulate PDF documents.",
        "zip": "Allows the app to create and extract ZIP archives.",
        "image": "Allows the app to manipulate image files."
    };

    async function analyzeGinFile(file) {
        if (!window.JSZip) throw new Error("JSZip library has not loaded.");
        const zip = await JSZip.loadAsync(file);
        const appJsonFile = zip.file("box/app.json");
        const pmftFile = zip.file("box/pmft.json");
        if (!appJsonFile || !pmftFile) {
            throw new Error("Invalid package: Missing app.json or pmft.json in the box directory.");
        }
        const appJson = JSON.parse(await appJsonFile.async("string"));
        const pmft = JSON.parse(await pmftFile.async("string"));
        return { appJson, pmft };
    }

    function renderWizardTabs(panes, appJson, pmft) {
        const { permsPane, dbPane, confirmPane } = panes;

        // Render Permissions Tab
        const mandatoryPerms = pmft.permissions.mandatory || [];
        const optionalPerms = pmft.permissions.optional || [];
        permsPane.innerHTML = (mandatoryPerms.length > 0 || optionalPerms.length > 0) ? `
            <p class="text-muted">Review the permissions requested by this application. Mandatory permissions are pre-selected.</p>
            <div id="permissions-form-glade">
                ${mandatoryPerms.map(p => `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" value="${p}" id="perm-install-${p}" checked disabled>
                        <label class="form-check-label" for="perm-install-${p}"><strong>${p}</strong> (Mandatory): ${PERMISSION_DESCRIPTIONS[p] || ''}</label>
                    </div>`).join('')}
                ${optionalPerms.map(p => `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" value="${p}" id="perm-install-${p}">
                        <label class="form-check-label" for="perm-install-${p}"><strong>${p}</strong> (Optional): ${PERMISSION_DESCRIPTIONS[p] || ''}</label>
                    </div>`).join('')}
            </div>` : '<p>This application requires no special permissions.</p>';

        // Render Database Tab
        const dbConnections = appJson.db || [];
        if (dbConnections.length === 0) {
            dbPane.innerHTML = '<p>This application does not require any special configuration.</p>';
        } else if (dbConnections.length === 1) {
            // If there is only one connection, render the simple view.
            const dbReq = dbConnections[0];
            dbPane.innerHTML = `
                <p class="text-muted">Please provide or confirm the database connection details for your server.</p>
                <div class="p-2 border rounded mb-2">
                    <p class="mb-1"><strong>Connection:</strong> ${dbReq.name} (Type: ${dbReq.type})</p>
                    ${Object.keys(dbReq).filter(k => k !== 'name' && k !== 'type').map(key => `
                        <div class="mb-2">
                            <input type="${key === 'password' ? 'password' : 'text'}" class="form-control form-control-sm" data-db-index="0" data-db-name="${dbReq.name}" name="${key}" placeholder="${key.charAt(0).toUpperCase() + key.slice(1)}" value="${key === 'password' ? '' : (dbReq[key] || '')}">
                        </div>
                    `).join('')}
                </div>`;
        } else {
            // If there are multiple connections, render the accordion.
            dbPane.innerHTML = `
                <p class="text-muted">This application requires multiple database connections. Please configure each one.</p>
                <div class="accordion" id="db-config-accordion">
                    ${dbConnections.map((dbReq, index) => `
                        <div class="accordion-item">
                            <h2 class="accordion-header" id="heading-${index}">
                                <button class="accordion-button ${index > 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#collapse-${index}">
                                    Connection #${index + 1}: ${dbReq.name} (${dbReq.type})
                                </button>
                            </h2>
                            <div id="collapse-${index}" class="accordion-collapse collapse ${index === 0 ? 'show' : ''}" data-bs-parent="#db-config-accordion">
                                <div class="accordion-body">
                                    ${Object.keys(dbReq).filter(k => k !== 'name' && k !== 'type').map(key => `
                                        <div class="mb-2">
                                            <label class="form-label-sm">${key.charAt(0).toUpperCase() + key.slice(1)}:</label>
                                            <input type="${key === 'password' ? 'password' : 'text'}" class="form-control form-control-sm" data-db-index="${index}" data-db-name="${dbReq.name}" name="${key}" placeholder="${key}" value="${key === 'password' ? '' : (dbReq[key] || '')}">
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>`;
        }

        // Render Confirmation Tab
        confirmPane.innerHTML = `
            <h4>Ready to Install</h4>
            <p>Please review the details below. Clicking the final confirmation button will begin the installation process.</p>
            <div class="alert alert-info">
                <strong>App:</strong> ${appJson.name} (v${appJson.version})<br>
                <strong>Description:</strong> <em>${appJson.description}</em>
            </div>
        `;
    }

    function buildDbConfigFromForm(originalDbConfig) {
        if (!originalDbConfig || originalDbConfig.length === 0) return [];
        const newDbConfigs = [];
        originalDbConfig.forEach((dbReq, index) => {
            const newConfig = { ...dbReq };
            const inputs = document.querySelectorAll(`#install-modal-body [data-db-index="${index}"]`);
            inputs.forEach(input => {
                if (input.value || input.name === 'password') { // Always include password field even if empty
                    newConfig[input.name] = input.value;
                }
            });
            newDbConfigs.push(newConfig);
        });
        return newDbConfigs;
    }

    async function repackGinFile(originalFile, newAppJson) {
        const zip = await JSZip.loadAsync(originalFile);
        zip.file("box/app.json", JSON.stringify(newAppJson, null, 2));
        return await zip.generateAsync({ type: "blob" });
    }

    return {
        analyzeGinFile,
        renderWizardTabs,
        buildDbConfigFromForm,
        repackGinFile
    };
})();
