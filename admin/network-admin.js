(() => {
    const TEXT = {
        en: {
            title: 'Network settings',
            subtitle: 'Configure Ethernet and WI-FI interfaces on the device',
            refresh: 'Refresh',
            adapterRunning: 'Adapter is running',
            adapterStopped: 'Adapter is not running',
            noInterfaces: 'No network interfaces detected.',
            instanceStopped: 'The adapter instance is not running.',
            loading: 'Loading…',
            currentValues: 'Current network values',
            ipv4Config: 'IPv4 configuration',
            connectionProfile: 'Connection profile',
            useDhcp: 'Use DHCP',
            staticIp: 'Static IPv4 address',
            subnet: 'Subnet mask or prefix',
            subnetHint: 'Examples: 255.255.255.0 or 24',
            gateway: 'Default gateway',
            dnsServers: 'DNS servers',
            dnsHint: 'One entry per line or separated by commas',
            apply: 'Apply network settings',
            reset: 'Reset changes',
            warning:
                'Applying network changes may interrupt the current connection. If the IP address changes, reopen the admin page using the new address.',
            wifiNetworks: 'WI-FI networks',
            scanWifi: 'Scan WI-FI',
            disconnect: 'Disconnect',
            connect: 'Connect',
            connected: 'connected',
            notConnected: 'not connected',
            enterPassword: 'Enter WI-FI password',
            password: 'WI-FI password',
            cancel: 'Cancel',
            submit: 'Apply',
            interfaceNotEditable: 'This interface cannot be edited with NetworkManager.',
            wifiNeedsProfile: 'Connect to a WI-FI network first to edit its IP settings.',
            noWifiFound: 'No WI-FI networks found.',
            saveFailed: 'Unable to save network settings',
            profileMissing: 'No editable NetworkManager profile found for this interface.',
            profileCreating: 'A dedicated Ethernet profile will be created automatically if needed.',
            noActiveConnection: 'No active connection',
            status: 'Status',
            ip4: 'IPv4',
            ip4Mask: 'IPv4 netmask',
            ip6: 'IPv6',
            ip6Mask: 'IPv6 netmask',
            dnsRecord: 'DNS record',
            saved: 'Network settings saved. The connection will be reapplied shortly.',
            busy: 'Processing…',
        },
        de: {
            title: 'Netzwerk-Einstellungen',
            subtitle: 'Ethernet- und WLAN-Schnittstellen des Geräts konfigurieren',
            refresh: 'Aktualisieren',
            adapterRunning: 'Adapter läuft',
            adapterStopped: 'Adapter läuft nicht',
            noInterfaces: 'Keine Netzwerkschnittstellen erkannt.',
            instanceStopped: 'Die Adapter-Instanz läuft nicht.',
            loading: 'Lade …',
            currentValues: 'Aktuelle Netzwerkwerte',
            ipv4Config: 'IPv4-Konfiguration',
            connectionProfile: 'Verbindungsprofil',
            useDhcp: 'DHCP verwenden',
            staticIp: 'Statische IPv4-Adresse',
            subnet: 'Subnetzmaske oder Präfix',
            subnetHint: 'Beispiele: 255.255.255.0 oder 24',
            gateway: 'Standardgateway',
            dnsServers: 'DNS-Server',
            dnsHint: 'Ein Eintrag pro Zeile oder durch Kommas getrennt',
            apply: 'Netzwerkeinstellungen anwenden',
            reset: 'Änderungen zurücksetzen',
            warning:
                'Das Anwenden der Netzwerkeinstellungen kann die aktuelle Verbindung unterbrechen. Wenn sich die IP-Adresse ändert, öffne die Admin-Seite mit der neuen Adresse erneut.',
            wifiNetworks: 'WLAN-Netzwerke',
            scanWifi: 'WLAN scannen',
            disconnect: 'Trennen',
            connect: 'Verbinden',
            connected: 'verbunden',
            notConnected: 'nicht verbunden',
            enterPassword: 'WLAN-Passwort eingeben',
            password: 'WLAN-Passwort',
            cancel: 'Abbrechen',
            submit: 'Anwenden',
            interfaceNotEditable: 'Diese Schnittstelle kann nicht über NetworkManager bearbeitet werden.',
            wifiNeedsProfile: 'Verbinde dich zuerst mit einem WLAN, um dessen IP-Einstellungen zu bearbeiten.',
            noWifiFound: 'Keine WLAN-Netzwerke gefunden.',
            saveFailed: 'Netzwerkeinstellungen konnten nicht gespeichert werden',
            profileMissing: 'Für diese Schnittstelle wurde kein bearbeitbares NetworkManager-Profil gefunden.',
            profileCreating: 'Falls nötig wird automatisch ein eigenes Ethernet-Profil angelegt.',
            noActiveConnection: 'Keine aktive Verbindung',
            status: 'Status',
            ip4: 'IPv4',
            ip4Mask: 'IPv4-Netzmaske',
            ip6: 'IPv6',
            ip6Mask: 'IPv6-Netzmaske',
            dnsRecord: 'DNS-Eintrag',
            saved: 'Netzwerkeinstellungen gespeichert. Die Verbindung wird in Kürze neu angewendet.',
            busy: 'Verarbeite …',
        },
    };

    const lang = (navigator.language || 'en').toLowerCase().startsWith('de') ? 'de' : 'en';
    const t = key => TEXT[lang][key] || TEXT.en[key] || key;

    const query = parseQuery();
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const adapterName = pathParts[pathParts.length - 2] || 'wireless-settings';
    const instance = query.instance !== undefined ? parseInt(query.instance, 10) || 0 : parseInt(window.location.search.slice(1), 10) || 0;
    const adapterInstance = `${adapterName}.${instance}`;
    const aliveStateId = `system.adapter.${adapterName}.${instance}.alive`;

    const state = {
        alive: false,
        loading: false,
        interfaces: [],
        edited: {},
        tab: '',
        wifi: [],
        wifiConnection: '',
        toast: '',
        toastError: false,
        passwordTarget: null,
        theme: 'light',
    };

    let socket;
    let systemThemeMedia;

    function resolveSystemTheme() {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    function updateThemeColorMeta(theme) {
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.setAttribute('content', theme === 'dark' ? '#10131a' : '#f5f7fb');
        }
    }

    function applySystemTheme() {
        state.theme = resolveSystemTheme();
        document.documentElement.dataset.theme = state.theme;
        document.documentElement.style.colorScheme = state.theme;
        updateThemeColorMeta(state.theme);
    }

    function bindSystemTheme() {
        if (!window.matchMedia || systemThemeMedia) {
            return;
        }
        systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => {
            applySystemTheme();
            render();
        };
        if (typeof systemThemeMedia.addEventListener === 'function') {
            systemThemeMedia.addEventListener('change', handler);
        } else if (typeof systemThemeMedia.addListener === 'function') {
            systemThemeMedia.addListener(handler);
        }
    }

    function parseQuery() {
        const result = {};
        (window.location.search || '')
            .replace(/^\?/, '')
            .replace(/#.*$/, '')
            .split('&')
            .filter(Boolean)
            .forEach(item => {
                const [rawName, rawValue] = item.split('=');
                result[decodeURIComponent(rawName)] = rawValue === undefined ? true : decodeURIComponent(rawValue);
            });
        return result;
    }

    function clone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function escapeHtml(value) {
        return `${value ?? ''}`
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeDnsList(value) {
        if (!value) {
            return [];
        }
        if (Array.isArray(value)) {
            return value.map(item => `${item}`.trim()).filter(Boolean);
        }
        return `${value}`
            .split(/[\n,;]+/)
            .map(item => item.trim())
            .filter(Boolean);
    }

    function normalizeConfig(interfaceItem) {
        return JSON.stringify({
            dhcp: !!interfaceItem?.dhcp,
            configIp4: `${interfaceItem?.configIp4 || ''}`.trim(),
            configIp4subnet: `${interfaceItem?.configIp4subnet || ''}`.trim(),
            configGateway: `${interfaceItem?.configGateway || ''}`.trim(),
            configDns: normalizeDnsList(interfaceItem?.configDns),
        });
    }

    function selectedInterface() {
        return state.interfaces.find(item => item.iface === state.tab) || null;
    }

    function editedInterface() {
        const selected = selectedInterface();
        if (!selected) {
            return null;
        }
        if (!state.edited[selected.iface]) {
            state.edited[selected.iface] = clone(selected);
        }
        return state.edited[selected.iface];
    }

    function isDirty(iface) {
        const original = state.interfaces.find(item => item.iface === iface);
        const changed = state.edited[iface];
        if (!original || !changed) {
            return false;
        }
        return normalizeConfig(original) !== normalizeConfig(changed);
    }

    function setToast(message, isError = false) {
        state.toast = message;
        state.toastError = isError;
        render();
        if (message) {
            window.clearTimeout(setToast.timer);
            setToast.timer = window.setTimeout(() => {
                state.toast = '';
                state.toastError = false;
                render();
            }, 5000);
        }
    }

    async function getStateAsync(id) {
        return new Promise((resolve, reject) => {
            socket.emit('getState', id, (error, result) => {
                if (error) {
                    reject(new Error(error));
                } else {
                    resolve(result);
                }
            });
        });
    }

    async function sendToAsync(command, message) {
        return new Promise(resolve => socket.emit('sendTo', adapterInstance, command, message, resolve));
    }

    function sortInterfaces(interfaces) {
        const list = [...interfaces];
        list.sort((a, b) => (`${a.mac}` > `${b.mac}` ? -1 : 1));
        list.sort((a, b) => (a.type === 'wifi' && b.type === 'wifi' ? 0 : a.type === 'wifi' ? -1 : 1));
        list.sort((a, b) => (!a.virtual && !b.virtual ? 0 : !a.virtual ? -1 : 1));
        return list.filter(item => item.ip4 !== '127.0.0.1');
    }

    function chooseTab() {
        if (state.interfaces.find(item => item.iface === state.tab)) {
            return;
        }
        const savedTab = window.localStorage.getItem(`network.${instance}.tab`);
        if (savedTab && state.interfaces.find(item => item.iface === savedTab)) {
            state.tab = savedTab;
            return;
        }
        if (state.interfaces.find(item => item.iface === 'wlan0')) {
            state.tab = 'wlan0';
            return;
        }
        const wifi = state.interfaces.find(item => item.type === 'wifi');
        if (wifi) {
            state.tab = wifi.iface;
            return;
        }
        state.tab = state.interfaces[0]?.iface || '';
    }

    async function loadAlive() {
        try {
            const alive = await getStateAsync(aliveStateId);
            state.alive = !!alive?.val;
        } catch {
            state.alive = false;
        }
    }

    async function loadInterfaces() {
        const interfaces = (await sendToAsync('interfaces', null)) || [];
        state.interfaces = sortInterfaces(interfaces);
        const newEdited = {};
        for (const iface of state.interfaces) {
            newEdited[iface.iface] = clone(iface);
        }
        state.edited = newEdited;
        chooseTab();
        if (state.tab) {
            window.localStorage.setItem(`network.${instance}.tab`, state.tab);
        }
    }

    async function loadWifi() {
        const selected = selectedInterface();
        state.wifi = [];
        state.wifiConnection = '';
        if (!selected || selected.type !== 'wifi' || !state.alive) {
            return;
        }
        state.wifiConnection = (await sendToAsync('wifiConnection', { iface: selected.iface })) || '';
        let wifi = (await sendToAsync('wifi', null)) || [];
        wifi = wifi.filter(item => item.ssid && item.ssid.trim());
        wifi.sort((a, b) => {
            const connectedA = a.ssid === state.wifiConnection;
            const connectedB = b.ssid === state.wifiConnection;
            if (connectedA) {
                return -1;
            }
            if (connectedB) {
                return 1;
            }
            return b.quality - a.quality;
        });
        state.wifi = wifi;
    }

    async function refreshAll(withWifi = true) {
        state.loading = true;
        render();
        try {
            await loadAlive();
            if (state.alive) {
                await loadInterfaces();
                if (withWifi) {
                    await loadWifi();
                }
            } else {
                state.interfaces = [];
                state.edited = {};
                state.wifi = [];
                state.wifiConnection = '';
            }
        } catch (error) {
            setToast(`${t('saveFailed')}: ${error.message || error}`, true);
        } finally {
            state.loading = false;
            render();
        }
    }

    async function refreshWifiOnly() {
        state.loading = true;
        render();
        try {
            await loadWifi();
        } catch (error) {
            setToast(`${t('saveFailed')}: ${error.message || error}`, true);
        } finally {
            state.loading = false;
            render();
        }
    }

    function statusIcon(status, type) {
        if (type === 'wifi') {
            return status === 'connected' ? '📶' : '📡';
        }
        return status === 'connected' ? '🔌' : '🧩';
    }

    function renderTabs() {
        if (!state.interfaces.length) {
            return `<div class="notice">${escapeHtml(state.alive ? t('noInterfaces') : t('instanceStopped'))}</div>`;
        }
        return `<div class="tabs">${state.interfaces
            .map(
                item => `<button class="tab-btn ${item.iface === state.tab ? 'active' : ''}" data-action="select-tab" data-iface="${escapeHtml(item.iface)}">
                        <span class="tab-status">${statusIcon(item.status, item.type)}</span>
                        <span>${escapeHtml(item.iface)}</span>
                    </button>`,
            )
            .join('')}</div>`;
    }

    function renderCurrentValues(selected) {
        const dns = Array.isArray(selected.dns) ? selected.dns : [];
        return `
            <div class="card">
                <h2>${escapeHtml(t('currentValues'))}</h2>
                <div class="grid-fields">
                    <div class="field">
                        <label>${escapeHtml(t('status'))}</label>
                        <input value="${escapeHtml(selected.status || '')}" disabled />
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('ip4'))}</label>
                        <input value="${escapeHtml(selected.ip4 || '')}" disabled />
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('ip4Mask'))}</label>
                        <input value="${escapeHtml(selected.ip4subnet || '')}" disabled />
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('gateway'))}</label>
                        <input value="${escapeHtml(selected.gateway || '')}" disabled />
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('ip6'))}</label>
                        <input value="${escapeHtml(selected.ip6 || '')}" disabled />
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('ip6Mask'))}</label>
                        <input value="${escapeHtml(selected.ip6subnet || '')}" disabled />
                    </div>
                    ${dns
                        .map(
                            (record, index) => `<div class="field">
                                <label>${escapeHtml(`${t('dnsRecord')} ${index + 1}`)}</label>
                                <input value="${escapeHtml(record)}" disabled />
                            </div>`,
                        )
                        .join('')}
                </div>
            </div>`;
    }

    function renderConfigEditor(selected, edited) {
        const dirty = isDirty(selected.iface);
        const editable = !!edited.editable;
        const wifiNeedsProfile = edited.type === 'wifi' && !edited.connection;
        const disableSave = !editable || state.loading || wifiNeedsProfile || (!edited.dhcp && (!edited.configIp4 || !edited.configIp4subnet));
        return `
            <div class="card">
                <h2>${escapeHtml(t('ipv4Config'))}</h2>
                <div class="grid-fields">
                    <div class="field">
                        <label>${escapeHtml(t('connectionProfile'))}</label>
                        <input value="${escapeHtml(edited.connection || (edited.type === 'ethernet' ? t('profileCreating') : t('noActiveConnection')))}" disabled />
                    </div>
                    <div class="inline-switch">
                        <div>
                            <strong>${escapeHtml(t('useDhcp'))}</strong>
                        </div>
                        <label class="switch">
                            <input type="checkbox" id="dhcp-toggle" ${edited.dhcp ? 'checked' : ''} ${!editable ? 'disabled' : ''} />
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('staticIp'))}</label>
                        <input id="config-ip4" value="${escapeHtml(edited.configIp4 || '')}" ${edited.dhcp || !editable ? 'disabled' : ''} />
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('subnet'))}</label>
                        <input id="config-subnet" value="${escapeHtml(edited.configIp4subnet || '')}" ${edited.dhcp || !editable ? 'disabled' : ''} />
                        <small>${escapeHtml(t('subnetHint'))}</small>
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('gateway'))}</label>
                        <input id="config-gateway" value="${escapeHtml(edited.configGateway || '')}" ${edited.dhcp || !editable ? 'disabled' : ''} />
                    </div>
                    <div class="field">
                        <label>${escapeHtml(t('dnsServers'))}</label>
                        <textarea id="config-dns" rows="4" ${!editable ? 'disabled' : ''}>${escapeHtml(
                            normalizeDnsList(edited.configDns).join('\n'),
                        )}</textarea>
                        <small>${escapeHtml(t('dnsHint'))}</small>
                    </div>
                </div>
                ${!editable ? `<div class="notice">${escapeHtml(t('interfaceNotEditable'))}</div>` : ''}
                ${wifiNeedsProfile ? `<div class="notice">${escapeHtml(t('wifiNeedsProfile'))}</div>` : ''}
                <div class="actions">
                    <button class="btn primary" data-action="apply-config" ${!dirty || disableSave ? 'disabled' : ''}>${
                        state.loading ? `<span class="spinner"></span>${escapeHtml(t('busy'))}` : escapeHtml(t('apply'))
                    }</button>
                    <button class="btn" data-action="reset-config" ${!dirty || state.loading ? 'disabled' : ''}>${escapeHtml(t('reset'))}</button>
                </div>
                <div class="warning">${escapeHtml(t('warning'))}</div>
            </div>`;
    }

    function renderWifi(selected) {
        if (selected.type !== 'wifi') {
            return '';
        }
        return `
            <div class="card">
                <div class="topbar" style="margin-bottom: 12px;">
                    <div class="title-group">
                        <h2>${escapeHtml(t('wifiNetworks'))}</h2>
                        <div class="subtitle">${escapeHtml(state.wifiConnection ? `${state.wifiConnection} ${t('connected')}` : t('notConnected'))}</div>
                    </div>
                    <div class="top-actions">
                        <button class="btn" data-action="scan-wifi" ${state.loading ? 'disabled' : ''}>${escapeHtml(t('scanWifi'))}</button>
                    </div>
                </div>
                <div class="wifi-list">
                    ${state.wifi.length ? state.wifi.map(item => renderWifiRow(item)).join('') : `<div class="empty">${escapeHtml(t('noWifiFound'))}</div>`}
                </div>
            </div>`;
    }

    function renderWifiRow(network) {
        const connected = network.ssid === state.wifiConnection;
        const openNetwork = `${network.security || ''}`.includes('--');
        const quality = Number(network.quality || 0);
        const signal = quality > 80 ? '▂▄▆█' : quality > 60 ? '▂▄▆_' : quality > 30 ? '▂▄__' : '▂___';
        return `
            <div class="wifi-item">
                <div class="wifi-info">
                    <div class="wifi-name">${escapeHtml(network.ssid)} ${connected ? '✅' : ''}</div>
                    <div class="wifi-meta">${escapeHtml(`${signal}  ${Math.round(quality)}%  •  ${network.speed || ''}  •  CH ${network.channel || ''}  •  ${network.security || '--'}`)}</div>
                </div>
                <div class="wifi-actions">
                    ${connected
                        ? `<button class="btn" data-action="disconnect-wifi">${escapeHtml(t('disconnect'))}</button>`
                        : `<button class="btn primary" data-action="connect-wifi" data-ssid="${escapeHtml(network.ssid)}" data-open="${openNetwork}">${escapeHtml(t('connect'))}</button>`}
                </div>
            </div>`;
    }

    function renderModal() {
        if (!state.passwordTarget) {
            return '';
        }
        return `
            <div class="modal-backdrop" id="wifi-modal-backdrop">
                <div class="modal">
                    <h3>${escapeHtml(t('enterPassword'))}</h3>
                    <div class="field">
                        <label>${escapeHtml(t('password'))}</label>
                        <input id="wifi-password-input" type="password" autocomplete="current-password" />
                    </div>
                    <div class="actions">
                        <button class="btn primary" data-action="confirm-wifi-password">${escapeHtml(t('submit'))}</button>
                        <button class="btn" data-action="cancel-wifi-password">${escapeHtml(t('cancel'))}</button>
                    </div>
                </div>
            </div>`;
    }

    function renderToast() {
        if (!state.toast) {
            return '';
        }
        return `<div class="toast ${state.toastError ? 'error' : ''}">${escapeHtml(state.toast)}</div>`;
    }

    function render() {
        applySystemTheme();
        const root = document.getElementById('root');
        const selected = selectedInterface();
        const edited = editedInterface();

        root.innerHTML = `
            <div class="app">
                <div class="topbar">
                    <div class="title-group">
                        <h1>${escapeHtml(t('title'))}</h1>
                        <div class="subtitle">${escapeHtml(t('subtitle'))}</div>
                    </div>
                    <div class="top-actions">
                        <div class="badge ${state.alive ? 'ok' : 'err'}">${escapeHtml(state.alive ? t('adapterRunning') : t('adapterStopped'))}</div>
                        <button class="btn" data-action="refresh-all" ${state.loading ? 'disabled' : ''}>${escapeHtml(t('refresh'))}</button>
                    </div>
                </div>
                ${state.loading ? `<div class="notice"><span class="spinner"></span>${escapeHtml(t('loading'))}</div>` : ''}
                ${renderTabs()}
                ${selected && edited ? `<div class="layout">${renderCurrentValues(selected)}${renderConfigEditor(selected, edited)}${renderWifi(selected)}</div>` : ''}
                ${renderModal()}
                ${renderToast()}
            </div>`;

        attachEvents();

        if (state.passwordTarget) {
            const input = document.getElementById('wifi-password-input');
            if (input) {
                input.focus();
            }
        }
    }

    function attachEvents() {
        document.querySelectorAll('[data-action="select-tab"]').forEach(button => {
            button.onclick = async event => {
                const iface = event.currentTarget.getAttribute('data-iface');
                state.tab = iface;
                window.localStorage.setItem(`network.${instance}.tab`, iface);
                await refreshWifiOnly();
            };
        });

        const refreshButton = document.querySelector('[data-action="refresh-all"]');
        if (refreshButton) {
            refreshButton.onclick = () => refreshAll(true);
        }

        const dhcpToggle = document.getElementById('dhcp-toggle');
        if (dhcpToggle) {
            dhcpToggle.onchange = event => {
                const edited = editedInterface();
                if (!edited) {
                    return;
                }
                edited.dhcp = !!event.target.checked;
                if (edited.dhcp) {
                    edited.configIp4 = '';
                    edited.configIp4subnet = '';
                    edited.configGateway = '';
                }
                render();
            };
        }

        bindInput('config-ip4', value => {
            const edited = editedInterface();
            if (edited) {
                edited.configIp4 = value;
            }
        });
        bindInput('config-subnet', value => {
            const edited = editedInterface();
            if (edited) {
                edited.configIp4subnet = value;
            }
        });
        bindInput('config-gateway', value => {
            const edited = editedInterface();
            if (edited) {
                edited.configGateway = value;
            }
        });
        bindInput('config-dns', value => {
            const edited = editedInterface();
            if (edited) {
                edited.configDns = normalizeDnsList(value);
            }
        });

        const applyButton = document.querySelector('[data-action="apply-config"]');
        if (applyButton) {
            applyButton.onclick = () => applyConfig();
        }
        const resetButton = document.querySelector('[data-action="reset-config"]');
        if (resetButton) {
            resetButton.onclick = () => resetConfig();
        }
        const scanButton = document.querySelector('[data-action="scan-wifi"]');
        if (scanButton) {
            scanButton.onclick = () => refreshWifiOnly();
        }

        document.querySelectorAll('[data-action="connect-wifi"]').forEach(button => {
            button.onclick = async event => {
                const ssid = event.currentTarget.getAttribute('data-ssid');
                const openNetwork = event.currentTarget.getAttribute('data-open') === 'true';
                if (openNetwork) {
                    await connectWifi(ssid, '');
                } else {
                    state.passwordTarget = { ssid };
                    render();
                }
            };
        });

        const disconnectButton = document.querySelector('[data-action="disconnect-wifi"]');
        if (disconnectButton) {
            disconnectButton.onclick = () => disconnectWifi();
        }

        const confirmPassword = document.querySelector('[data-action="confirm-wifi-password"]');
        if (confirmPassword) {
            confirmPassword.onclick = async () => {
                const input = document.getElementById('wifi-password-input');
                const password = input ? input.value : '';
                const target = state.passwordTarget;
                state.passwordTarget = null;
                render();
                if (target?.ssid) {
                    await connectWifi(target.ssid, password);
                }
            };
        }

        const cancelPassword = document.querySelector('[data-action="cancel-wifi-password"]');
        if (cancelPassword) {
            cancelPassword.onclick = () => {
                state.passwordTarget = null;
                render();
            };
        }

        const modalBackdrop = document.getElementById('wifi-modal-backdrop');
        if (modalBackdrop) {
            modalBackdrop.onclick = event => {
                if (event.target === modalBackdrop) {
                    state.passwordTarget = null;
                    render();
                }
            };
        }

        document.onkeydown = event => {
            if (event.key === 'Escape' && state.passwordTarget) {
                state.passwordTarget = null;
                render();
            }
        };
    }

    function bindInput(id, handler) {
        const input = document.getElementById(id);
        if (!input) {
            return;
        }
        input.oninput = event => {
            handler(event.target.value);
            const selected = selectedInterface();
            if (selected) {
                const applyButton = document.querySelector('[data-action="apply-config"]');
                const resetButton = document.querySelector('[data-action="reset-config"]');
                if (applyButton) {
                    applyButton.disabled = !isDirty(selected.iface);
                }
                if (resetButton) {
                    resetButton.disabled = !isDirty(selected.iface);
                }
            }
        };
    }

    async function applyConfig() {
        const selected = selectedInterface();
        const edited = editedInterface();
        if (!selected || !edited) {
            return;
        }
        state.loading = true;
        render();
        try {
            const result = await sendToAsync('setInterfaceConfig', {
                iface: edited.iface,
                type: edited.type,
                dhcp: !!edited.dhcp,
                ip4: edited.configIp4 || '',
                ip4subnet: edited.configIp4subnet || '',
                gateway: edited.configGateway || '',
                dns: normalizeDnsList(edited.configDns),
            });
            if (result?.success) {
                setToast(result.message || t('saved'));
                window.setTimeout(() => refreshAll(true), 3000);
            } else {
                setToast(result?.message || t('saveFailed'), true);
            }
        } catch (error) {
            setToast(`${t('saveFailed')}: ${error.message || error}`, true);
        } finally {
            state.loading = false;
            render();
        }
    }

    function resetConfig() {
        const selected = selectedInterface();
        if (!selected) {
            return;
        }
        state.edited[selected.iface] = clone(selected);
        render();
    }

    async function connectWifi(ssid, password) {
        const selected = selectedInterface();
        if (!selected) {
            return;
        }
        state.loading = true;
        render();
        try {
            const result = await sendToAsync('wifiConnect', {
                ssid,
                password,
                iface: selected.iface,
            });
            if (result === true) {
                setToast(`${ssid} ${t('connected')}`);
            } else {
                setToast(`${ssid}: ${result}`, true);
            }
            await refreshAll(true);
        } catch (error) {
            setToast(`${ssid}: ${error.message || error}`, true);
        } finally {
            state.loading = false;
            render();
        }
    }

    async function disconnectWifi() {
        state.loading = true;
        render();
        try {
            const result = await sendToAsync('wifiDisconnect', {
                ssid: state.wifiConnection || '',
            });
            if (result === true) {
                setToast(t('disconnect'));
            } else {
                setToast(`${result}`, true);
            }
            await refreshAll(true);
        } catch (error) {
            setToast(`${error.message || error}`, true);
        } finally {
            state.loading = false;
            render();
        }
    }

    window.initializeWirelessSettingsAdmin = async function initializeWirelessSettingsAdmin() {
        applySystemTheme();
        bindSystemTheme();
        socket = window.io.connect();
        socket.on('connect', () => {
            refreshAll(true).catch(error => setToast(`${t('saveFailed')}: ${error.message || error}`, true));
        });
        socket.on('disconnect', () => {
            state.alive = false;
            render();
        });
        await refreshAll(true);
    };
})();
