var ExtensionCommon;
try {
    ({ ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs"));
} catch (e) {
    try {
        ({ ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm"));
    } catch (e2) {
        if (typeof ExtensionCommon === "undefined") {
            console.error("[Pacome Experiment] FATAL: ExtensionCommon not found!", e, e2);
        }
    }
}

var ExtensionParent;
try {
    ({ ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs"));
} catch (e) {
    try {
        ({ ExtensionParent } = ChromeUtils.import("resource://gre/modules/ExtensionParent.jsm"));
    } catch (e2) {
        console.error("[Pacome Experiment] ExtensionParent not found", e2);
    }
}


var Services;
try {
    ({ Services } = ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs"));
} catch (e) {
    try {
        ({ Services } = ChromeUtils.import("resource://gre/modules/Services.jsm"));
    } catch (e2) {
        if (typeof Services === "undefined") {
            console.error("[Pacome Experiment] FATAL: Services not found!");
        }
    }
}

var PacomeAuthUtils;
try {
    ({ PacomeAuthUtils } = ChromeUtils.importESModule("resource:///modules/pacome/pacomeAuthUtils.mjs"));
} catch (e) {
    console.log("[Pacome Experiment] PacomeAuthUtils not found", e);
}

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;

const FILELINK_ORIGIN = "https://bnum.din.gouv.fr";
const FILELINK_REALM = "filelink-nextcloud-melanie2";

async function getAllLogins() {
    const svc = Services || globalThis.Services;
    if (!svc || !svc.logins) {
        console.error("[Pacome Experiment] Services.logins is not available");
        return [];
    }

    try {
        if (typeof svc.logins.getAllLoginsAsync === "function") {
            return await svc.logins.getAllLoginsAsync();
        }
    } catch (e) {
        console.warn("[Pacome Experiment] getAllLoginsAsync error:", e);
    }

    try {
        if (typeof svc.logins.getAllLogins === "function") {
            return svc.logins.getAllLogins();
        }
    } catch (e) {
        console.warn("[Pacome Experiment] getAllLogins error:", e);
    }

    return [];
}

async function findFilelinkLogins() {
    const svc = Services || globalThis.Services;
    if (!svc || !svc.logins) {
        console.error("[Pacome Experiment] Services.logins is not available");
        return [];
    }

    // 1. Try searchLoginsAsync (Modern Thunderbird 115 / 128 / 153+)
    if (typeof svc.logins.searchLoginsAsync === "function") {
        try {
            // Search with origin + httpRealm
            let logins = await svc.logins.searchLoginsAsync({
                origin: FILELINK_ORIGIN,
                httpRealm: FILELINK_REALM,
            });
            if (logins && logins.length > 0) {
                console.log(`[Pacome Experiment] Found ${logins.length} login(s) via searchLoginsAsync(origin, httpRealm)`);
                return logins;
            }

            // Search with hostname + httpRealm
            logins = await svc.logins.searchLoginsAsync({
                hostname: FILELINK_ORIGIN,
                httpRealm: FILELINK_REALM,
            });
            if (logins && logins.length > 0) {
                console.log(`[Pacome Experiment] Found ${logins.length} login(s) via searchLoginsAsync(hostname, httpRealm)`);
                return logins;
            }

            // Search with httpRealm alone
            logins = await svc.logins.searchLoginsAsync({
                httpRealm: FILELINK_REALM,
            });
            if (logins && logins.length > 0) {
                console.log(`[Pacome Experiment] Found ${logins.length} login(s) via searchLoginsAsync(httpRealm)`);
                return logins;
            }
        } catch (e) {
            console.warn("[Pacome Experiment] searchLoginsAsync failed:", e);
        }
    }

    // 2. Try findLogins (legacy Thunderbird if still present)
    if (typeof svc.logins.findLogins === "function") {
        try {
            let logins = svc.logins.findLogins(FILELINK_ORIGIN, null, FILELINK_REALM);
            if (logins && logins.length > 0) {
                console.log(`[Pacome Experiment] Found ${logins.length} login(s) via findLogins`);
                return logins;
            }
            logins = svc.logins.findLogins(FILELINK_ORIGIN, "", FILELINK_REALM);
            if (logins && logins.length > 0) {
                console.log(`[Pacome Experiment] Found ${logins.length} login(s) via findLogins(empty actionURL)`);
                return logins;
            }
        } catch (e) {
            console.warn("[Pacome Experiment] findLogins failed:", e);
        }
    }

    // 3. Fallback: inspect all logins (covers supplier "https://bnum.din.gouv.fr (filelink-nextcloud-melanie2)")
    try {
        const all = await getAllLogins();
        console.log(`[Pacome Experiment] Fallback checking ${all.length} logins from getAllLogins`);

        let matches = all.filter(l => {
            const host = l.hostname || l.origin || "";
            const realm = l.httpRealm || "";

            if (realm === FILELINK_REALM) return true;
            if (host === `${FILELINK_ORIGIN} (${FILELINK_REALM})`) return true;
            if (host.includes("bnum.din.gouv.fr") && realm.includes("filelink")) return true;
            if (host.includes("bnum.din.gouv.fr") && host.includes("filelink")) return true;
            return false;
        });

        if (matches.length > 0) {
            console.log(`[Pacome Experiment] Found ${matches.length} login(s) matching filelink realm/supplier`);
            return matches;
        }

        // Secondary fallback: any login with hostname containing bnum.din.gouv.fr
        matches = all.filter(l => {
            const host = l.hostname || l.origin || "";
            return host.includes("bnum.din.gouv.fr");
        });
        if (matches.length > 0) {
            console.log(`[Pacome Experiment] Found ${matches.length} login(s) on bnum.din.gouv.fr`);
            return matches;
        }
    } catch (e) {
        console.warn("[Pacome Experiment] Fallback all logins error:", e);
    }

    // 4. Memory cache fallback from PacomeAuthUtils if available
    try {
        if (typeof PacomeAuthUtils !== "undefined" && PacomeAuthUtils?._lastSavedPassword) {
            const cached = PacomeAuthUtils._lastSavedPassword;
            if (cached.mdp && (cached.username || cached.uid)) {
                console.log("[Pacome Experiment] Found credentials in PacomeAuthUtils._lastSavedPassword");
                return [{
                    username: cached.username || cached.uid,
                    password: cached.mdp
                }];
            }
        }
    } catch (e) {
        console.warn("[Pacome Experiment] PacomeAuthUtils._lastSavedPassword check error:", e);
    }

    return [];
}

var pacomeLogin = class extends ExtensionCommon.ExtensionAPI {
    onStartup() {
        console.log("[Pacome Experiment] onStartup called");
    }

    getAPI(context) {
        const api = {
            pacomeLogin: {
                async getPassword(username) {
                    console.log(`[Pacome Experiment] getPassword called for: ${username}`);
                    try {
                        const logins = await findFilelinkLogins();
                        if (!logins || logins.length === 0) {
                            console.log(`[Pacome Experiment] No filelink logins found in password manager`);
                            return null;
                        }

                        if (!username) {
                            console.log(`[Pacome Experiment] No username provided, returning first login password`);
                            return logins[0].password;
                        }

                        // 1. Exact match
                        let match = logins.find(l => l.username === username);
                        if (match) {
                            console.log(`[Pacome Experiment] Exact match found for ${username}`);
                            return match.password;
                        }

                        // 2. Case-insensitive match
                        match = logins.find(l => l.username && l.username.toLowerCase() === username.toLowerCase());
                        if (match) {
                            console.log(`[Pacome Experiment] Case-insensitive match found for ${username}`);
                            return match.password;
                        }

                        // 3. User part match (e.g. before @ or .-)
                        const normalize = u => (u || "").split('@')[0].split('.-.')[0].toLowerCase();
                        const normUser = normalize(username);
                        match = logins.find(l => normalize(l.username) === normUser);
                        if (match) {
                            console.log(`[Pacome Experiment] Normalized user match found for ${username} (${match.username})`);
                            return match.password;
                        }

                        // 4. Single entry fallback
                        if (logins.length === 1) {
                            console.log(`[Pacome Experiment] Single login available, using it for ${username}`);
                            return logins[0].password;
                        }

                        console.log(`[Pacome Experiment] No password found among ${logins.length} logins for ${username}`);
                        return null;
                    } catch (e) {
                        console.error("[Pacome Experiment] getPassword error:", e);
                        return null;
                    }
                },

                async createAccount(type, name) {
                    console.log(`[Pacome Experiment] createAccount called with type=${type}, name=${name}`);
                    try {
                        let cloudMgr = null;

                        // --- STRATEGY: ExtensionParent Probe ---
                        if (ExtensionParent && ExtensionParent.apiManager) {
                            try {
                                console.log("[Pacome Experiment] Probing ExtensionParent.apiManager...");
                                // apiManager has a Map of modules? or globalModules?
                                // Let's try to 'generate' the API to trigger loading if needed?
                                // No, browsing the loaded modules via the manager structure

                                // Note: Implementation varies by TB version.
                                // Often: ExtensionParent.apiManager.modules.get("cloudFile")

                                if (ExtensionParent.apiManager.modules) {
                                    if (ExtensionParent.apiManager.modules.has("cloudFile")) {
                                        console.log("[Pacome Experiment] ExtensionParent has 'cloudFile' module!");
                                        let mod = ExtensionParent.apiManager.modules.get("cloudFile");
                                        // Inspect the module proxy/obj
                                        console.log(`[Pacome Experiment] 'cloudFile' module keys: ${Object.keys(mod || {})}`);

                                        // Often the scope is hidden, but maybe an export?
                                        if (mod.CloudFileAccountManager) cloudMgr = mod.CloudFileAccountManager;
                                    }
                                } else {
                                    console.log("[Pacome Experiment] apiManager.modules is undefined. Trying globals...");
                                    // older TB?
                                }
                            } catch (e) { console.error("ExtensionParent probe failed", e); }
                        }

                        // --- STRATEGY: Manual Pref Write (The "Brute Force" Fallback) ---
                        if (!cloudMgr) {
                            console.warn("[Pacome Experiment] MANAGER NOT FOUND. Attempting Manual Preference Write...");

                            // 1. Generate a new Account Key
                            let newKey = "account" + Date.now();

                            // 2. Read existing accounts string
                            let existingAccounts = "";
                            try { existingAccounts = Services.prefs.getStringPref("mail.cloud_files.accounts"); } catch (e) { }

                            let accounts = existingAccounts ? existingAccounts.split(",") : [];
                            if (!accounts.includes(newKey)) {
                                accounts.push(newKey);

                                console.log(`[Pacome Experiment] Writing prefs for new account: ${newKey}`);
                                // 3. Write Prefs
                                Services.prefs.setStringPref("mail.cloud_files.accounts", accounts.join(","));
                                Services.prefs.setStringPref(`mail.cloud_files.account.${newKey}.type`, type);
                                Services.prefs.setStringPref(`mail.cloud_files.account.${newKey}.displayName`, name);

                                // Initialize standard default prefs for a cloud account if needed
                                // (e.g. oauth, settingsUrl, etc. - usually handled by the extension afterward)

                                console.log("[Pacome Experiment] SUCCESS (Manual Write). Account registered in prefs.");
                                return newKey;
                            } else {
                                console.log("[Pacome Experiment] Account key generation collision? Retrying not implemented.");
                                return newKey; // Assume it worked or existed
                            }
                        }

                        // Normal path (if manager found)
                        let key = cloudMgr.createAccount(type);
                        let account = cloudMgr.getAccount(key);
                        account.displayName = name;
                        return key;

                    } catch (e) {
                        console.error("[Pacome Experiment] Failed to create account:", e);
                        throw e;
                    }
                },

                async findCredentials() {
                    console.log("[Pacome Experiment] findCredentials called");
                    try {
                        const logins = await findFilelinkLogins();
                        if (logins && logins.length > 0) {
                            const first = logins[0];
                            console.log(`[Pacome Experiment] findCredentials returning credentials for ${first.username}`);
                            return {
                                username: first.username,
                                password: first.password
                            };
                        }

                        console.log("[Pacome Experiment] findCredentials: No credentials found");
                        return null;
                    } catch (e) {
                        console.error("[Pacome Experiment] findCredentials error:", e);
                        return null;
                    }
                }
            },
        };
        return api;
    }
};

var pacomeLogin = pacomeLogin;
if (typeof exports !== 'undefined') {
    exports.pacomeLogin = pacomeLogin;
}
