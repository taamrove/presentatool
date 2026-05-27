import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base';
import type { PresentoolInstance } from './main';

export function buildFeedbacks(self: PresentoolInstance): CompanionFeedbackDefinitions {
  return {
    connected: {
      type: 'boolean',
      name: 'Connected to Presentool',
      description: 'True while the module is connected to the Presentool desktop',
      defaultStyle: {
        bgcolor: combineRgb(0, 128, 0),
        color: combineRgb(255, 255, 255),
      },
      options: [],
      callback: () => self.connection.connected,
    },
    on_slide: {
      type: 'boolean',
      name: 'On a specific slide',
      description: 'True when the current slide equals the configured number',
      defaultStyle: {
        bgcolor: combineRgb(76, 154, 255),
        color: combineRgb(0, 0, 0),
      },
      options: [
        { id: 'index', type: 'number', label: 'Slide number', default: 1, min: 1, max: 9999 },
      ],
      callback: (fb) => self.connection.slide?.index === Number(fb.options.index),
    },
  };
}
