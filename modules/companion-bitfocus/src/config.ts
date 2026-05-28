import type { SomeCompanionConfigField } from '@companion-module/base';

export function configFields(): SomeCompanionConfigField[] {
  return [
    {
      type: 'static-text',
      id: 'info',
      width: 12,
      label: 'About',
      value:
        'Drives a Presentatool desktop instance over its local WebSocket API. ' +
        'Leave Host blank and the module will auto-discover the desktop on ' +
        'the LAN via mDNS — useful when you have several Presentatool ' +
        'machines and just want this connection to attach to the closest ' +
        'one. The API token is also optional on the LAN; Presentatool ' +
        'trusts private-network controllers by default. Set a host and a ' +
        'token only when reaching the desktop from outside the LAN, or if ' +
        '"Trust LAN controllers" has been disabled in Presentatool → ' +
        'Settings → Network.',
    },
    {
      type: 'textinput',
      id: 'host',
      label: 'Host (blank = auto-discover)',
      width: 8,
      default: '',
      tooltip: 'IP or hostname of the Presentatool desktop. Leave blank to find it via mDNS.',
    },
    {
      type: 'number',
      id: 'port',
      label: 'Port',
      width: 4,
      default: 4711,
      min: 1,
      max: 65535,
    },
    {
      type: 'textinput',
      id: 'token',
      label: 'API token (optional)',
      width: 12,
      tooltip: 'Only required if Presentatool is reachable but not on the LAN, or if LAN trust is off.',
    },
  ];
}
