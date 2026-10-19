console.log("[Pacome Debug] background.js started v6 - Workflow Automation");

// Option C: Automatisation du Workflow de Configuration
// L'utilisateur crée le compte manuellement UNE FOIS, ensuite auto-config instantanée

async function showFirstTimeSetupNotification() {
    console.log("[Pacome Debug] Showing first-time setup notification");

    // Check if we've shown this before
    const { firstTimeSetupShown } = await browser.storage.local.get("firstTimeSetupShown");

    if (!firstTimeSetupShown) {
        console.log("[Pacome Debug] First time - showing setup instructions");

        // Show notification with action button
        const notificationId = await messenger.notifications.create({
            type: "basic",
            iconUrl: "icon48.png",
            title: "Configuration Filelink MDrive",
            message: "Pour activer Filelink, ajoutez un compte MDrive dans les paramètres (1 clic). L'extension configurera automatiquement vos identifiants Pacome.",
            eventTime: Date.now()
        });

        // Mark as shown
        await browser.storage.local.set({ firstTimeSetupShown: true });

        console.log(`[Pacome Debug] Notification created: ${notificationId}`);
    }
}

async function autoConfigureAccount(accountId) {
    console.log(`[Pacome Debug] Auto-configuring account ${accountId}...`);

    const ncc = new CloudConnection(accountId);
    await ncc.load();

    // Check if account needs configuration
    const needsConfig = !ncc.serverUrl || !ncc.username;

    if (needsConfig && browser.pacomeLogin) {
        console.log(`[Pacome Debug] Account ${accountId} needs configuration. Fetching Pacome credentials...`);

        try {
            const creds = await browser.pacomeLogin.findCredentials();
            if (creds) {
                console.log(`[Pacome Debug] Found Pacome credentials for ${creds.username}`);

                // Auto-configure with Pacome credentials and hardcoded URL
                ncc.serverUrl = "https://bnum.din.gouv.fr/mdrive/";
                ncc.username = creds.username;
                ncc.password = creds.password;
                ncc.storageFolder = "/Pièces Jointes";
                ncc.useDlPassword = false;
                ncc.useExpiry = false;

                await ncc.store();

                // Verify connection and update capabilities
                console.log("[Pacome Debug] Verifying connection...");
                const answer = await ncc.updateUserId();
                if (!answer._failed) {
                    await Promise.all([
                        ncc.updateFreeSpaceInfo(),
                        ncc.updateCapabilities()
                    ]);
                    await ncc.updateConfigured();

                    console.log(`[Pacome Debug] ✅ Account ${accountId} auto-configured successfully!`);

                    // Show success notification
                    await messenger.notifications.create({
                        type: "basic",
                        iconUrl: "icon48.png",
                        title: "Filelink MDrive configuré",
                        message: `Compte configuré automatiquement pour ${creds.username}. Vous pouvez maintenant utiliser Filelink !`,
                        eventTime: Date.now()
                    });
                } else {
                    console.error(`[Pacome Debug] Connection verification failed: ${answer.status}`);
                    ncc.laststatus = answer.status;
                }

                await ncc.store();

            } else {
                console.log("[Pacome Debug] No Pacome credentials found. Cannot auto-configure.");
            }
        } catch (e) {
            console.error(`[Pacome Debug] Auto-configuration failed for ${accountId}:`, e);
        }
    } else if (!needsConfig) {
        console.log(`[Pacome Debug] Account ${accountId} already configured.`);
    }
}

// Initialize on startup
messenger.cloudFile.getAllAccounts().then(async allAccounts => {
    console.log(`[Pacome Debug] getAllAccounts returned ${allAccounts.length} accounts`);

    if (allAccounts.length === 0) {
        // No accounts - show first-time setup notification
        await showFirstTimeSetupNotification();
    } else {
        // Check each account and auto-configure if needed
        for (let account of allAccounts) {
            await autoConfigureAccount(account.id);
        }
    }
});

// If the current TB version does not support button labels, it uses the title instead
if (!messenger.composeAction.setLabel) {
    const manifest = browser.runtime.getManifest();
    if (manifest.compose_action && manifest.compose_action.default_label) {
        messenger.composeAction.setTitle({
            title: manifest.compose_action.default_label.replace(
                /^__MSG_([@\w]+)__$/, (matched, key) => {
                    return browser.i18n.getMessage(key) || matched;
                }),
        });
    }
}

messenger.cloudFile.onFileUpload.addListener(async (account, { id, name, data }) => {
    console.log(`[Pacome Debug] onFileUpload triggered for account ${account.id}, file ${name}`);
    const ncc = new CloudConnection(account.id);
    await ncc.load();
    return ncc.uploadFile(makeUploadId(account, id), name, data);
});

messenger.cloudFile.onFileUploadAbort.addListener(
    (account, fileId) => {
        /* global allAbortControllers */
        // defined in davclient.js
        const abortController = allAbortControllers.get(makeUploadId(account, fileId));
        if (abortController) {
            abortController.abort();
        }
        Status.remove(makeUploadId(account, fileId));
    });

/** Don't delete any files because we want to reuse uploads.  */
messenger.cloudFile.onFileDeleted.addListener(
    (account, fileId) => {
        Status.remove(makeUploadId(account, fileId));
    });

/** Auto-configure newly added accounts */
messenger.cloudFile.onAccountAdded.addListener(async account => {
    console.log(`[Pacome Debug] ✨ New account added: ${account.id}`);
    await autoConfigureAccount(account.id);
});

messenger.cloudFile.onAccountDeleted.addListener(accountId => {
    console.log(`[Pacome Debug] onAccountDeleted triggered for account ${accountId}`);
    const ncc = new CloudConnection(accountId);
    ncc.deleteAccount();
});

async function updateAccount(accountId) {
    console.log(`[Pacome Debug] updateAccount called for ${accountId}`);
    const ncc = new CloudConnection(accountId);
    await ncc.load();
    upgradeOldConfigurations();

    // Check if login works
    const answer = await ncc.updateUserId();
    ncc.laststatus = null;
    if (answer._failed) {
        ncc.laststatus = answer.status;
    } else {
        await Promise.all([ncc.updateFreeSpaceInfo(), ncc.updateCapabilities(),]);
        await ncc.updateConfigured();
    }
    ncc.store();

    function upgradeOldConfigurations() {
        if (ncc.serverUrl && !ncc.serverUrl.endsWith('/')) {
            ncc.serverUrl += '/';
        }
    }
}

/**
 * The fileId is only unique within one account. makeUploadId creates a string
 * that identifies the upload even if more than one account is active.
 * @param {CloudFileAccount} account The CloudFileAccount as supplied by Thunderbird
 * @param {number} fileId The fileId supplied by Thunderbird
 */
function makeUploadId(account, fileId) {
    return `${account.id}_${fileId}`;
}

/* global CloudConnection, Status */
