import type { CompanionActionDefinitions } from '@companion-module/base';
import type { PresentoolInstance } from './main';

export function buildActions(self: PresentoolInstance): CompanionActionDefinitions {
  const presentationChoices = self.connection.presentations.map((p) => ({ id: p.id, label: p.title }));

  return {
    next: {
      name: 'Next slide',
      options: [],
      callback: async () => self.connection.click({ type: 'next' }),
    },
    prev: {
      name: 'Previous slide',
      options: [],
      callback: async () => self.connection.click({ type: 'prev' }),
    },
    first: {
      name: 'First slide',
      options: [],
      callback: async () => self.connection.click({ type: 'first' }),
    },
    last: {
      name: 'Last slide',
      options: [],
      callback: async () => self.connection.click({ type: 'last' }),
    },
    blank: {
      name: 'Toggle blank screen',
      options: [],
      callback: async () => self.connection.click({ type: 'blank' }),
    },
    goto: {
      name: 'Go to slide…',
      options: [
        {
          id: 'index',
          type: 'number',
          label: 'Slide number',
          default: 1,
          min: 1,
          max: 9999,
        },
      ],
      callback: async (action) => {
        const idx = Number(action.options.index) || 1;
        self.connection.click({ type: 'goto', index: idx });
      },
    },
    start: {
      name: 'Start slideshow',
      options: [],
      callback: async () => self.connection.click({ type: 'start' }),
    },
    end: {
      name: 'Exit slideshow',
      options: [],
      callback: async () => self.connection.click({ type: 'end' }),
    },
    select: {
      name: 'Switch presentation',
      options: [
        {
          id: 'presentationId',
          type: 'dropdown',
          label: 'Presentation',
          default: presentationChoices[0]?.id ?? '',
          choices: presentationChoices.length
            ? presentationChoices
            : [{ id: '', label: '(no presentations loaded)' }],
        },
      ],
      callback: async (action) => {
        const id = String(action.options.presentationId ?? '');
        if (id) self.connection.selectPresentation(id);
      },
    },
  };
}
