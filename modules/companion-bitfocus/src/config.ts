import type { SomeCompanionConfigField } from '@companion-module/base';

export function configFields(): SomeCompanionConfigField[] {
  return [
    {
      type: 'static-text',
      id: 'info',
      width: 12,
      label: 'About',
      value:
        'Drives a Presentool desktop instance over its local WebSocket API. ' +
        'Generate an API token in Presentool: Settings → Bitfocus Companion / API token.',
    },
    {
      type: 'textinput',
      id: 'host',
      label: 'Host',
      width: 8,
      default: '127.0.0.1',
      regex: '/^[A-Za-z0-9._\\-]+$/',
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
      label: 'API token',
      width: 12,
      tooltip: 'Generated in Presentool → Settings → Bitfocus Companion',
    },
  ];
}
