import { combineRgb, type CompanionPresetDefinitions } from '@companion-module/base';

export function buildPresets(): CompanionPresetDefinitions {
  const black = combineRgb(0, 0, 0);
  const white = combineRgb(255, 255, 255);
  const blue = combineRgb(37, 99, 235);
  const grey = combineRgb(40, 40, 50);
  const red = combineRgb(180, 40, 40);

  return {
    next: {
      type: 'button',
      category: 'Clicker',
      name: 'Next',
      style: { text: 'NEXT\\n$(presentatool:slide_index)/$(presentatool:slide_total)', size: '14', color: white, bgcolor: blue },
      steps: [{ down: [{ actionId: 'next', options: {} }], up: [] }],
      feedbacks: [{ feedbackId: 'connected', options: {}, style: { bgcolor: blue, color: white } }],
    },
    prev: {
      type: 'button',
      category: 'Clicker',
      name: 'Previous',
      style: { text: 'PREV', size: '18', color: white, bgcolor: grey },
      steps: [{ down: [{ actionId: 'prev', options: {} }], up: [] }],
      feedbacks: [],
    },
    blank: {
      type: 'button',
      category: 'Clicker',
      name: 'Blank',
      style: { text: 'BLANK', size: '14', color: white, bgcolor: black },
      steps: [{ down: [{ actionId: 'blank', options: {} }], up: [] }],
      feedbacks: [],
    },
    end: {
      type: 'button',
      category: 'Clicker',
      name: 'Exit',
      style: { text: 'EXIT', size: '14', color: white, bgcolor: red },
      steps: [{ down: [{ actionId: 'end', options: {} }], up: [] }],
      feedbacks: [],
    },
    title: {
      type: 'button',
      category: 'Now playing',
      name: 'Current slide title',
      style: { text: '$(presentatool:slide_title)', size: '7', color: white, bgcolor: black },
      steps: [{ down: [], up: [] }],
      feedbacks: [],
    },
  };
}
