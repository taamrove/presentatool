import type { CompanionVariableDefinition, CompanionVariableValues } from '@companion-module/base';
import type { PresentoolInstance } from './main';

export function variableDefinitions(): CompanionVariableDefinition[] {
  return [
    { variableId: 'connected', name: 'Module connected to Presentool' },
    { variableId: 'host', name: 'Presentool device name' },
    { variableId: 'slide_index', name: 'Current slide number' },
    { variableId: 'slide_total', name: 'Total slides' },
    { variableId: 'slide_title', name: 'Current slide title' },
    { variableId: 'slide_notes', name: 'Current slide notes' },
    { variableId: 'next_title', name: 'Next slide title' },
    { variableId: 'presentation_title', name: 'Selected presentation title' },
  ];
}

export function variableValues(self: PresentoolInstance): CompanionVariableValues {
  const s = self.connection.slide;
  const firstPres = self.connection.presentations[0];
  return {
    connected: self.connection.connected ? 'true' : 'false',
    host: self.connection.hostName,
    slide_index: s?.index ?? '',
    slide_total: s?.total ?? '',
    slide_title: s?.title ?? '',
    slide_notes: s?.notes ?? '',
    next_title: s?.nextTitle ?? '',
    presentation_title: firstPres?.title ?? '',
  };
}
