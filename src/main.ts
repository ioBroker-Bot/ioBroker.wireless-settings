import { Adapter, type AdapterOptions } from '@iobroker/adapter-core';
import { execFile } from 'node:child_process';
import { getServers as getDnsServers } from 'node:dns';
import { isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';

type ConnectionState = 'connected' | 'disconnected' | 'connecting' | 'unavailable' | 'unmanaged' | 'unknown';

interface WirelessNetwork {
    security: '--' | 'WPA' | 'WPA2';
    ssid: string;
    quality: number;
    channel: number;
    speed: string;
}

interface NetworkInterface {
    iface: string;
    ip4: string;
    ip4subnet: string;
    ip6: string;
    ip6subnet: string;
    mac: string;
    gateway: string;
    dhcp: boolean;
    dns: string[];
    configIp4: string;
    configIp4subnet: string;
    configGateway: string;
    configDns: string[];
    connection: string;
    type: 'ethernet' | 'loopback' | 'wifi' | 'wifi-p2p';
    editable: boolean;
    virtual?: boolean;
    status: ConnectionState;
}

interface SetInterfaceConfigInput {
    iface: string;
    type: 'ethernet' | 'wifi';
    dhcp: boolean;
    ip4?: string;
    ip4subnet?: string;
    gateway?: string;
    dns?: string[] | string;
}

interface SetInterfaceConfigResult {
    success: boolean;
    message: string;
    connection?: string;
    scheduled?: boolean;
}

interface ConnectionProfile {
    dhcp: boolean;
    ip4: string;
    ip4subnet: string;
    gateway: string;
    dns: string[];
}

interface ExecuteOptions {
    sudo?: boolean;
    logCommand?: string;
    logErrors?: boolean;
}

interface ConnectionInfo {
    name: string;
    type: string;
}

// Take the logic for WI-FI here
// https://github.com/RPi-Distro/raspi-config/blob/bookworm/raspi-config#L2848
/**
 * The adapter instance
 */
class NetworkSettings extends Adapter {
    private cmdRunning: string | boolean = false;
    private stopping: boolean = false;

    constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'wireless-settings',
            unload: (cb: () => void): Promise<void> => this.unload(cb),
            ready: () => this.main(),
            message: obj => {
                if (typeof obj === 'object' && obj?.callback) {
                    if (obj.command === 'interfaces') {
                        void this.onInterfaces().then(result =>
                            this.sendTo(obj.from, obj.command, result, obj.callback),
                        );
                    } else if (obj.command === 'wifi') {
                        void this.onWifi().then(result => this.sendTo(obj.from, obj.command, result, obj.callback));
                    } else if (obj.command === 'dns') {
                        this.sendTo(obj.from, obj.command, this.onDns(), obj.callback);
                    } else if (obj.command === 'wifiConnection') {
                        void this.onWifiConnection(obj.message).then(result =>
                            this.sendTo(obj.from, obj.command, result, obj.callback),
                        );
                    } else if (obj.command === 'wifiConnect') {
                        void this.onWifiConnect(obj.message).then(result =>
                            this.sendTo(obj.from, obj.command, result, obj.callback),
                        );
                    } else if (obj.command === 'wifiDisconnect') {
                        void this.onWifiDisconnect(obj.message).then(result =>
                            this.sendTo(obj.from, obj.command, result, obj.callback),
                        );
                    } else if (obj.command === 'setInterfaceConfig') {
                        void this.onSetInterfaceConfig(obj.message).then(result =>
                            this.sendTo(obj.from, obj.command, result, obj.callback),
                        );
                    } else {
                        this.log.error(`Unknown command: ${obj.command}`);
                    }
                }
            },
        });
    }

    private static quoteArgForLog(arg: string): string {
        if (arg === '') {
            return '""';
        }
        return /[\s"]/g.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
    }

    private execFileAsync(command: string, args: string[] = [], options: ExecuteOptions = {}): Promise<string> {
        if (this.stopping) {
            return Promise.resolve('');
        }

        const logCommand =
            options.logCommand ||
            `${options.sudo ? 'sudo ' : ''}${command} ${args.map(NetworkSettings.quoteArgForLog).join(' ')}`.trim();
        const actualCommand = options.sudo ? 'sudo' : command;
        const actualArgs = options.sudo ? [command, ...args] : args;

        this.cmdRunning = logCommand;

        return new Promise((resolve, reject) => {
            try {
                execFile(
                    actualCommand,
                    actualArgs,
                    { maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' },
                    (error, stdout, stderr) => {
                        this.cmdRunning = false;
                        const stdoutText = stdout?.trim() || '';
                        const stderrText = stderr?.trim() || '';

                        if (error || stderrText) {
                            const message = stderrText || error?.message || 'Unknown execution error';
                            if (options.logErrors !== false) {
                                this.log.error(`Cannot execute: ${message}`);
                            } else {
                                this.log.debug(`Command failed "${logCommand}": ${message}`);
                            }
                            reject(new Error(message));
                            return;
                        }

                        this.log.debug(`Result for "${logCommand}": ${stdoutText}`);
                        resolve(stdoutText);
                    },
                );
            } catch (e) {
                this.cmdRunning = false;
                if (options.logErrors !== false) {
                    this.log.error(`Cannot execute.: ${e}`);
                }
                reject(new Error(e instanceof Error ? e.message : String(e)));
            }
        });
    }

    getInterfaces(): string[] {
        const ifaces = networkInterfaces();
        return Object.keys(ifaces).filter(iface => !ifaces[iface]?.[0]?.internal);
    }

    waitForEnd(callback?: (timeout: boolean) => void, _started?: number): void {
        _started = _started || Date.now();
        if (this.cmdRunning && Date.now() - _started < 4000) {
            setTimeout(() => this.waitForEnd(callback, _started), 200);
        } else if (callback) {
            callback(Date.now() - _started >= 4000);
        }
    }

    async unload(callback: () => void): Promise<void> {
        this.stopping = true;
        await this.setState('info.connection', false, true);
        this.waitForEnd(timeout => {
            timeout && this.log.warn(`Timeout by waiting of command: ${this.cmdRunning}`);
            if (callback) {
                callback();
            }
        });
    }

    async main(): Promise<void> {
        const interfaces: string[] = this.getInterfaces();
        if (interfaces.length) {
            await this.setState('info.connection', true, true);
        }
    }

    static parseTable(text: string): Record<string, string>[] {
        const lines = text.split('\n').filter(line => line.trim());
        let header = lines.shift();
        if (!header) {
            return [];
        }
        const positions: { name: string; position: number }[] = [];
        const parts = header.split(/\s+/).filter(i => i);
        let offset = 0;
        // Get the position of each word in line
        parts.forEach((part, i) => {
            const pos = header.indexOf(part);
            positions[i] = { name: part, position: pos + offset };
            header = header.substring(pos);
            offset += pos;
            const space = header.indexOf(' ');
            if (space !== -1) {
                offset += space;
                header = header.substring(space);
            }
        });

        const result: Record<string, string>[] = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const obj: Record<string, string> = {};
            positions.forEach((pos: { name: string; position: number }, i) => {
                const from = pos.position;
                const to = i !== positions.length - 1 ? positions[i + 1].position : line.length;
                obj[pos.name] = line.substring(from, to).trim();
            });
            result.push(obj);
        }

        return result;
    }

    private static firstNonEmptyLine(text: string): string {
        return (
            text
                .split('\n')
                .map(line => line.trim())
                .find(line => line) || ''
        );
    }

    private static parseList(text: string): string[] {
        return text
            .split(/[\n,]+/)
            .map(item => item.trim())
            .filter(item => item && item !== '--');
    }

    private static normalizeConnectionName(text: string): string {
        const connection = NetworkSettings.firstNonEmptyLine(text);
        return connection === '--' ? '' : connection;
    }

    private static normalizeConnectionState(state: string): ConnectionState {
        const value = state.split(' ')[0].trim().toLowerCase();
        if (
            value === 'connected' ||
            value === 'disconnected' ||
            value === 'connecting' ||
            value === 'unavailable' ||
            value === 'unmanaged'
        ) {
            return value;
        }
        return 'unknown';
    }

    private static parseIpv4Address(text: string): { address: string; prefix: number } | null {
        const firstAddress = NetworkSettings.parseList(text)[0];
        if (!firstAddress) {
            return null;
        }

        const parts = firstAddress.split('/');
        if (parts.length !== 2 || !isIPv4(parts[0])) {
            return null;
        }

        const prefix = parseInt(parts[1], 10);
        if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
            return null;
        }

        return { address: parts[0], prefix };
    }

    private static prefixToNetmask(prefix: number): string {
        if (prefix < 0 || prefix > 32) {
            return '';
        }
        const octets: number[] = [];
        let bits = prefix;
        for (let i = 0; i < 4; i++) {
            const usedBits = Math.min(8, Math.max(bits, 0));
            octets.push(usedBits === 0 ? 0 : 256 - 2 ** (8 - usedBits));
            bits -= usedBits;
        }
        return octets.join('.');
    }

    private static netmaskToPrefix(netmask: string): number | null {
        const octets = netmask
            .trim()
            .split('.')
            .map(value => parseInt(value, 10));

        if (octets.length !== 4 || octets.some(value => Number.isNaN(value) || value < 0 || value > 255)) {
            return null;
        }

        const binary = octets.map(value => value.toString(2).padStart(8, '0')).join('');
        if (!/^1*0*$/.test(binary)) {
            return null;
        }

        return binary.replace(/0/g, '').length;
    }

    private static normalizeIpv4Prefix(subnet: string): number | null {
        const value = subnet.trim();
        if (!value) {
            return null;
        }

        const cleanValue = value.startsWith('/') ? value.substring(1) : value;
        if (/^\d+$/.test(cleanValue)) {
            const prefix = parseInt(cleanValue, 10);
            if (prefix >= 0 && prefix <= 32) {
                return prefix;
            }
            return null;
        }

        return NetworkSettings.netmaskToPrefix(cleanValue);
    }

    private static matchesConnectionType(connectionType: string, ifaceType: NetworkInterface['type']): boolean {
        if (ifaceType === 'ethernet') {
            return connectionType.includes('ethernet');
        }
        if (ifaceType === 'wifi') {
            return connectionType.includes('wireless') || connectionType.includes('wifi');
        }
        return false;
    }

    private async getNmcliDeviceField(iface: string, field: string): Promise<string> {
        return this.execFileAsync('nmcli', ['-g', field, 'device', 'show', iface], { logErrors: false }).catch(() => '');
    }

    private async getNmcliConnectionField(connection: string, field: string): Promise<string> {
        return this.execFileAsync('nmcli', ['-g', field, 'connection', 'show', connection], {
            logErrors: false,
        }).catch(() => '');
    }

    private async getDeviceConnectionName(iface: string): Promise<string> {
        const connection = await this.getNmcliDeviceField(iface, 'GENERAL.CONNECTION');
        return NetworkSettings.normalizeConnectionName(connection);
    }

    private async listConnectionProfiles(): Promise<ConnectionInfo[]> {
        const lines = await this.execFileAsync('nmcli', ['-t', '-e', 'no', '-f', 'NAME,TYPE', 'connection', 'show'], {
            logErrors: false,
        }).catch(() => '');

        return lines
            .split('\n')
            .map(line => line.trim())
            .filter(line => line)
            .map(line => {
                const parts = line.split(':');
                const type = parts.pop() || '';
                const name = parts.join(':').trim();
                return { name, type: type.trim() };
            })
            .filter(item => item.name && item.type);
    }

    private async findConnectionForInterface(iface: string, ifaceType: NetworkInterface['type']): Promise<string> {
        const activeConnection = await this.getDeviceConnectionName(iface);
        if (activeConnection) {
            return activeConnection;
        }

        const connections = await this.listConnectionProfiles();
        for (const connection of connections) {
            if (!NetworkSettings.matchesConnectionType(connection.type, ifaceType)) {
                continue;
            }
            const connectionIface = NetworkSettings.firstNonEmptyLine(
                await this.getNmcliConnectionField(connection.name, 'connection.interface-name'),
            );
            if (connectionIface === iface) {
                return connection.name;
            }
        }

        return '';
    }

    private async ensureEthernetConnection(iface: string): Promise<string> {
        const connection = `ioBroker-${iface}`;
        const existingConnection = NetworkSettings.normalizeConnectionName(
            await this.getNmcliConnectionField(connection, 'connection.id'),
        );
        if (existingConnection) {
            return existingConnection;
        }

        await this.execFileAsync(
            'nmcli',
            ['connection', 'add', 'type', 'ethernet', 'ifname', iface, 'con-name', connection, 'autoconnect', 'yes'],
            { sudo: true },
        );
        return connection;
    }

    private async readConnectionProfile(connection: string): Promise<ConnectionProfile> {
        const method = NetworkSettings.firstNonEmptyLine(await this.getNmcliConnectionField(connection, 'ipv4.method'));
        const ip4Address = NetworkSettings.parseIpv4Address(await this.getNmcliConnectionField(connection, 'ipv4.addresses'));
        const gateway = NetworkSettings.firstNonEmptyLine(await this.getNmcliConnectionField(connection, 'ipv4.gateway'));
        const dns = NetworkSettings.parseList(await this.getNmcliConnectionField(connection, 'ipv4.dns'));

        return {
            dhcp: method === 'auto',
            ip4: ip4Address?.address || '',
            ip4subnet: ip4Address ? NetworkSettings.prefixToNetmask(ip4Address.prefix) : '',
            gateway,
            dns,
        };
    }

    private scheduleConnectionApply(iface: string, connection: string): void {
        setTimeout(() => {
            if (this.stopping) {
                return;
            }

            void (async () => {
                try {
                    await this.execFileAsync('nmcli', ['device', 'reapply', iface], {
                        sudo: true,
                        logErrors: false,
                    });
                    this.log.info(`Applied connection profile "${connection}" on ${iface} via device reapply`);
                } catch {
                    try {
                        await this.execFileAsync(
                            'nmcli',
                            ['--wait', '15', 'connection', 'up', 'id', connection, 'ifname', iface],
                            { sudo: true },
                        );
                        this.log.info(`Reconnected interface ${iface} with profile "${connection}"`);
                    } catch (e) {
                        this.log.error(`Cannot reactivate connection "${connection}" on ${iface}: ${e}`);
                    }
                }
            })();
        }, 250);
    }

    async onInterfaces(): Promise<NetworkInterface[]> {
        if (this.stopping) {
            return [];
        }

        const ifaces = networkInterfaces();
        const result: NetworkInterface[] = [];

        Object.keys(ifaces).forEach(iface => {
            const ifaceEntries = ifaces[iface];
            if (!ifaceEntries?.length || ifaceEntries[0].internal) {
                return;
            }

            const ip4 = ifaceEntries.find(addr => addr.family === 'IPv4');
            const ip6 = ifaceEntries.find(addr => addr.family === 'IPv6');
            result.push({
                iface,
                ip4: ip4?.address || '',
                ip4subnet: ip4?.netmask || '',
                ip6: ip6?.address || '',
                ip6subnet: ip6?.netmask || '',
                mac: ifaceEntries[0].mac,
                gateway: '',
                dhcp: true,
                dns: [],
                configIp4: '',
                configIp4subnet: '',
                configGateway: '',
                configDns: [],
                connection: '',
                type: 'ethernet',
                status: 'disconnected',
                editable: false,
            });
        });

        const lines = await this.execFileAsync('nmcli', ['device', 'status'], { logErrors: false }).catch(() => '');
        const items = NetworkSettings.parseTable(lines);
        // DEVICE         TYPE      STATE                   CONNECTION
        // eth0           ethernet  connected               Wired connection 1
        // lo             loopback  connected (externally)  lo
        // wlan0          wifi      connected               Android12345
        // p2p-dev-wlan0  wifi-p2p  disconnected            --

        // Extract status
        for (let i = 0; i < items.length; i++) {
            if (items[i].TYPE === 'loopback' || items[i].TYPE === 'wifi-p2p') {
                continue;
            }
            const item = result.find(resultItem => resultItem.iface === items[i].DEVICE);
            if (item) {
                item.status = NetworkSettings.normalizeConnectionState(items[i].STATE);
                item.type = items[i].TYPE as 'ethernet' | 'loopback' | 'wifi' | 'wifi-p2p';
            } else {
                result.push({
                    iface: items[i].DEVICE,
                    status: NetworkSettings.normalizeConnectionState(items[i].STATE),
                    ip4: '',
                    ip4subnet: '',
                    ip6: '',
                    ip6subnet: '',
                    mac: '',
                    gateway: '',
                    dhcp: true,
                    dns: [],
                    configIp4: '',
                    configIp4subnet: '',
                    configGateway: '',
                    configDns: [],
                    connection: '',
                    type: items[i].TYPE as 'ethernet' | 'loopback' | 'wifi' | 'wifi-p2p',
                    editable: false,
                });
            }
        }

        for (const item of result) {
            item.gateway = NetworkSettings.firstNonEmptyLine(await this.getNmcliDeviceField(item.iface, 'IP4.GATEWAY'));
            item.dns = NetworkSettings.parseList(await this.getNmcliDeviceField(item.iface, 'IP4.DNS'));
            if (!item.dns.length && item.status === 'connected') {
                item.dns = getDnsServers();
            }

            item.connection = await this.findConnectionForInterface(item.iface, item.type);
            if (item.connection) {
                const profile = await this.readConnectionProfile(item.connection);
                item.dhcp = profile.dhcp;
                item.configIp4 = profile.ip4;
                item.configIp4subnet = profile.ip4subnet;
                item.configGateway = profile.gateway;
                item.configDns = profile.dns;
            }

            item.editable = (item.type === 'ethernet' || item.type === 'wifi') && item.status !== 'unmanaged';
        }

        return result;
    }

    async onWifi(): Promise<WirelessNetwork[]> {
        const networks: WirelessNetwork[] = [];

        if (!this.stopping) {
            const iwlist = await this.execFileAsync('nmcli', ['dev', 'wifi', 'list', '--rescan', 'yes'], {
                sudo: true,
            });
            // IN-USE  BSSID              SSID                MODE   CHAN  RATE        SIGNAL  BARS  SECURITY
            // *       BA:FF:16:XX:F7:94  Android12356        Infra  6     130 Mbit/s  100     ▂▄▆█  WPA2
            //         78:FF:20:XX:5B:83  SSID 1 2         3  Infra  6     130 Mbit/s  92      ▂▄▆█  --
            //         7E:FF:20:XX:5B:83  --                  Infra  6     130 Mbit/s  89      ▂▄▆█  WPA2
            //         78:FF:20:XX:31:29  SSID 1 2         3  Infra  11    130 Mbit/s  72      ▂▄▆_  --
            //         7E:FF:20:XX:31:29  --                  Infra  11    130 Mbit/s  67      ▂▄▆_  WPA2
            //         7E:FF:20:XX:5B:83  SSID 1 2         3  Infra  48    270 Mbit/s  67      ▂▄▆_  --
            //         78:FF:58:XX:1F:1F  SSID 1 2         3  Infra  11    130 Mbit/s  59      ▂▄▆_  --
            //         18:FF:29:XX:C8:29  SSID 1 2         3  Infra  6     130 Mbit/s  55      ▂▄__  --
            //         78:FF:58:XX:1E:31  SSID 1 2         3  Infra  11    130 Mbit/s  54      ▂▄__  --
            //         1E:FF:29:XX:57:2A  --                  Infra  1     195 Mbit/s  45      ▂▄__  WPA2
            //         18:FF:29:XX:57:2A  SSID 1 2         3  Infra  1     195 Mbit/s  44      ▂▄__  --
            //         18:FF:29:XX:1D:6C  SSID 1 2         3  Infra  6     195 Mbit/s  44      ▂▄__  --
            //         7E:FF:20:XX:31:29  SSID 1 2         3  Infra  36    270 Mbit/s  44      ▂▄__  --
            //         22:FF:29:XX:57:2A  PRIVATE             Infra  1     195 Mbit/s  42      ▂▄__  WPA2
            //         18:FF:29:XX:1D:69  SSID 1 2         3  Infra  6     195 Mbit/s  37      ▂▄__  --
            //         44:FF:4A:XX:03:C4  Do5irak655767       Infra  9     65 Mbit/s   37      ▂▄__  WPA2
            //         78:FF:58:XX:1F:1A  SSID 1 2         3  Infra  6     130 Mbit/s  32      ▂▄__  --
            //         1E:FF:29:XX:1D:69  SSID 1 2         3  Infra  40    405 Mbit/s  24      ▂___  --
            //         22:FF:29:XX:1D:69  --                  Infra  40    405 Mbit/s  22      ▂___  WPA2
            // Parse information
            // Get from the first line the position of the columns
            const items: Record<string, string>[] = NetworkSettings.parseTable(iwlist);
            items.forEach(item => {
                if (item.SSID === '--') {
                    return;
                }
                networks.push({
                    security: item.SECURITY as '--' | 'WPA' | 'WPA2',
                    ssid: item.SSID,
                    quality: parseFloat(item.SIGNAL),
                    speed: item.RATE,
                    channel: parseInt(item.CHAN, 10),
                });
            });
        }

        // Remove SSID with the same name and take the strongest one
        let changed;
        do {
            changed = false;
            for (let i = networks.length - 1; i >= 0; i--) {
                const ssid = networks[i].ssid;
                const pos = networks.findIndex((item, j) => j !== i && item.ssid === ssid);
                if (pos !== -1) {
                    // find the strongest signal in the list
                    let max = i;
                    for (let j = 0; j < networks.length; j++) {
                        if (networks[j].ssid === ssid && networks[j].quality > networks[max].quality) {
                            max = j;
                        }
                    }
                    const strongest: WirelessNetwork = networks[max];
                    // delete all SSID with the same name
                    for (let j = networks.length - 1; j >= 0; j--) {
                        if (networks[j].ssid === ssid) {
                            networks.splice(j, 1);
                        }
                    }
                    networks.push(strongest);
                    changed = true;
                    break;
                }
            }
        } while (changed);

        return networks;
    }

    onDns(): string[] {
        return getDnsServers();
    }

    async onWifiConnection(input: { iface: string }): Promise<string> {
        if (this.stopping) {
            return '';
        }
        return this.getDeviceConnectionName(input.iface);
    }

    async onWifiConnect(input: { ssid: string; password: string; iface: string }): Promise<true | string> {
        if (this.stopping) {
            return 'Instance is stopping';
        }
        try {
            let result = await this.execFileAsync('nmcli', ['radio', 'wifi']);
            if (result !== 'enabled') {
                result = await this.execFileAsync('nmcli', ['radio', 'wifi', 'on'], { sudo: true });
            }
            this.log.debug(`Enable radio => ${result}`);
        } catch (e) {
            this.log.error(`Cannot enable radio: ${e}`);
        }

        try {
            const args = ['device', 'wifi', 'connect', input.ssid];
            if (input.password) {
                args.push('password', input.password);
            }
            args.push('ifname', input.iface);
            const result = await this.execFileAsync('nmcli', args, {
                sudo: true,
                logCommand: `sudo nmcli device wifi connect ${NetworkSettings.quoteArgForLog(input.ssid)} ${
                    input.password ? 'password *** ' : ''
                }ifname ${NetworkSettings.quoteArgForLog(input.iface)}`.trim(),
            });
            this.log.debug(`Set wifi "${input.ssid}" on "${input.iface}" => ${result}`);
            if (result.includes('successfully')) {
                return true;
            }
            return result;
        } catch (e) {
            this.log.error(`Cannot connect to wifi: ${e}`);
            return `Cannot connect to wifi: ${e}`;
        }
    }

    async onWifiDisconnect(input: { ssid: string }): Promise<true | string> {
        if (this.stopping) {
            return 'Instance is stopping';
        }
        try {
            const result = await this.execFileAsync('nmcli', ['connection', 'down', 'id', input.ssid], { sudo: true });
            this.log.debug(`Disable wifi "${input.ssid}" => ${result}`);
            if (result.includes('successfully')) {
                return true;
            }
            return result;
        } catch (e) {
            this.log.error(`Cannot disconnect from wifi: ${e}`);
            return `Cannot disconnect from wifi: ${e}`;
        }
    }

    async onSetInterfaceConfig(input: SetInterfaceConfigInput): Promise<SetInterfaceConfigResult> {
        if (this.stopping) {
            return { success: false, message: 'Instance is stopping' };
        }
        if (!input?.iface) {
            return { success: false, message: 'Interface is required' };
        }
        if (input.type !== 'ethernet' && input.type !== 'wifi') {
            return { success: false, message: 'Only ethernet and WI-FI interfaces are supported' };
        }

        try {
            let connection = await this.findConnectionForInterface(input.iface, input.type);
            if (!connection && input.type === 'ethernet') {
                connection = await this.ensureEthernetConnection(input.iface);
            }
            if (!connection) {
                return { success: false, message: 'No editable NetworkManager profile found for this interface' };
            }

            const dnsList = Array.isArray(input.dns)
                ? input.dns.map(item => `${item}`.trim()).filter(Boolean)
                : NetworkSettings.parseList(input.dns || '');
            const invalidDns = dnsList.find(dns => !isIPv4(dns));
            if (invalidDns) {
                return { success: false, message: `Invalid DNS server: ${invalidDns}` };
            }

            if (input.dhcp) {
                await this.execFileAsync(
                    'nmcli',
                    [
                        'connection',
                        'modify',
                        connection,
                        'ipv4.method',
                        'auto',
                        'ipv4.addresses',
                        '',
                        'ipv4.gateway',
                        '',
                        'ipv4.dns',
                        dnsList.join(','),
                        'ipv4.ignore-auto-dns',
                        dnsList.length ? 'yes' : 'no',
                    ],
                    { sudo: true },
                );
            } else {
                const ip4 = (input.ip4 || '').trim();
                const prefix = NetworkSettings.normalizeIpv4Prefix(input.ip4subnet || '');
                const gateway = (input.gateway || '').trim();

                if (!isIPv4(ip4)) {
                    return { success: false, message: 'Invalid IPv4 address' };
                }
                if (prefix === null) {
                    return { success: false, message: 'Invalid subnet mask' };
                }
                if (gateway && !isIPv4(gateway)) {
                    return { success: false, message: 'Invalid gateway address' };
                }

                await this.execFileAsync(
                    'nmcli',
                    [
                        'connection',
                        'modify',
                        connection,
                        'ipv4.method',
                        'manual',
                        'ipv4.addresses',
                        `${ip4}/${prefix}`,
                        'ipv4.gateway',
                        gateway,
                        'ipv4.dns',
                        dnsList.join(','),
                        'ipv4.ignore-auto-dns',
                        'no',
                    ],
                    { sudo: true },
                );
            }

            this.scheduleConnectionApply(input.iface, connection);
            return {
                success: true,
                message: 'Network settings saved. The connection will be reapplied shortly.',
                connection,
                scheduled: true,
            };
        } catch (e) {
            return { success: false, message: `Cannot save network settings: ${e}` };
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new NetworkSettings(options);
} else {
    // otherwise start the instance directly
    (() => new NetworkSettings())();
}
